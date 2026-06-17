// GET /api/leaderboard · chain-aggregated AI-trader competition board.
//
// Walks live testnet data and emits per-adopted-trader (per-policy) stats:
//
//   policy_id, name, owner (address), agent (trader wallet),
//   budget_cap_sui, spent_sui, revoked,
//   trade_count, distinct_assets, modes (live | simulated),
//   journal_entries (Walrus depth),
//   realized_pnl_usd, win_count, loss_count (closed spot positions),
//   open_position_count (BTC mints still waiting on oracle settle),
//   journal_walrus_blob_id  ← link target for the row → "their Walrus memory"
//
// Data sources:
//   - `operator_policy::PolicyCreated` events → every adopted trader
//   - `task::TaskPosted` events filtered to predict-btc capability →
//     every dispatched trader task
//   - Each task's `deliverable_id` → parsed inline JSON body (trader name,
//     asset, mode, mint_tx_digest, journal_walrus_blob_id, …)
//   - The trader's `.cursors/trader-spot-positions.json` (read from disk
//     on the same host) → realized P&L for closed spot positions
//
// Caching: 30-second in-memory cache so first-load is snappy and a
// hundred sequential refreshes don't pummel the RPC. The aggregation
// itself takes ~3-5s on first miss.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  getJsonRpcFullnodeUrl,
  SuiJsonRpcClient,
} from "@mysten/sui/jsonRpc";

const PACKAGE_ID =
  process.env.NEXT_PUBLIC_BRIEF_PACKAGE_ID ??
  "0xe550ace873c02768dbaca7de3a2d64a28acd3f7c51551c9c97b704703e95fb9d";
const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as
  | "testnet"
  | "mainnet";

const SPOT_CURSOR_PATH = path.resolve(
  process.cwd(),
  ".cursors/trader-spot-positions.json",
);

type StoredSpotPosition = {
  id: string;
  taskId: string;
  asset: string;
  poolKey: string;
  direction: "up" | "down";
  baseQty: number;
  openQuoteBase: string;
  openTxDigest: string;
  policyId: string;
  openedAtMs: number;
  closeAtMs: number;
  strategy: string;
  status: "open" | "closed" | "failed";
  closeTxDigest?: string;
  closeQuoteBase?: string;
  realizedPnlBase?: string;
  closedAtMs?: number;
};

type LeaderboardRow = {
  policy_id: string;
  name: string;
  owner: string;
  agent: string;
  budget_cap_sui: number;
  spent_sui: number;
  revoked: boolean;
  trade_count: number;
  distinct_assets: string[];
  live_count: number;
  simulated_count: number;
  journal_entries: number;
  journal_walrus_blob_id: string | null;
  reasoning_walrus_blob_id: string | null;
  realized_pnl_usd: number;
  win_count: number;
  loss_count: number;
  open_position_count: number;
  created_at_ms: number;
  last_trade_at_ms: number;
};

type LeaderboardResponse = {
  ok: boolean;
  generated_at_ms: number;
  cache_ttl_ms: number;
  network: "testnet" | "mainnet";
  package_id: string;
  rows: LeaderboardRow[];
  errors?: string[];
};

let CACHE: { at: number; payload: LeaderboardResponse } | null = null;
// Single-flight guard: one in-flight aggregation shared by all callers,
// so a cache miss under load can't stampede the fullnode (100 concurrent
// VUs were each recomputing the on-chain walk → 6s p95). Combined with
// stale-while-revalidate below, no request ever blocks on aggregation
// once a first result exists.
let INFLIGHT: Promise<LeaderboardResponse> | null = null;
function aggregateOnce(): Promise<LeaderboardResponse> {
  if (INFLIGHT) return INFLIGHT;
  INFLIGHT = aggregate()
    .then((payload) => {
      CACHE = { at: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      INFLIGHT = null;
    });
  return INFLIGHT;
}
const CACHE_TTL_MS = 30_000;

// Local helper: unwrap an Option<String> field which Sui returns as
// either a plain string, null, or an `{ vec: [string] }` shape.
function unwrapOptionString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.length > 0 ? v : null;
  if (typeof v === "object" && v !== null) {
    const o = v as { vec?: unknown };
    if (Array.isArray(o.vec) && typeof o.vec[0] === "string") {
      return o.vec[0] as string;
    }
  }
  return null;
}

async function loadSpotPositions(): Promise<StoredSpotPosition[]> {
  try {
    const raw = await fs.readFile(SPOT_CURSOR_PATH, "utf8");
    return JSON.parse(raw) as StoredSpotPosition[];
  } catch {
    return [];
  }
}

async function aggregate(): Promise<LeaderboardResponse> {
  const errors: string[] = [];
  const client = new SuiJsonRpcClient({
    network: NETWORK,
    url: getJsonRpcFullnodeUrl(NETWORK),
  });

  // ---- 1) Walk PolicyCreated events -----------------------------------
  const policies = new Map<string, LeaderboardRow>();
  let cursor: { eventSeq: string; txDigest: string } | null = null;
  let scanned = 0;
  // The brief package emits PolicyCreated under
  // `${pkg}::operator_policy::PolicyCreated`. We page through events
  // newest-first and stop after 200 · enough for the demo and bounded
  // for the testnet RPC.
  for (let page = 0; page < 4; page++) {
    let res;
    try {
      res = await client.queryEvents({
        query: {
          MoveEventType: `${PACKAGE_ID}::operator_policy::PolicyCreated`,
        },
        cursor,
        limit: 50,
        order: "descending",
      });
    } catch (e) {
      errors.push(`policy events page ${page}: ${(e as Error).message}`);
      break;
    }
    for (const ev of res.data ?? []) {
      scanned++;
      const f = ev.parsedJson as Record<string, unknown> | null;
      if (!f) continue;
      const id = String(f.id ?? "");
      if (!id || policies.has(id)) continue;
      policies.set(id, {
        policy_id: id,
        name: String(f.name ?? "Untitled operator"),
        owner: String(f.owner ?? ""),
        agent: String(f.agent ?? ""),
        budget_cap_sui: Number(BigInt(String(f.budget_cap ?? "0"))) / 1e9,
        spent_sui: 0,
        revoked: false,
        trade_count: 0,
        distinct_assets: [],
        live_count: 0,
        simulated_count: 0,
        journal_entries: 0,
        journal_walrus_blob_id: null,
        reasoning_walrus_blob_id: null,
        realized_pnl_usd: 0,
        win_count: 0,
        loss_count: 0,
        open_position_count: 0,
        created_at_ms: Number(BigInt(String(f.created_at_ms ?? "0"))),
        last_trade_at_ms: 0,
      });
    }
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor as { eventSeq: string; txDigest: string };
  }

  // ---- 2) Hydrate live policy state (spent / revoked) -----------------
  const policyIds = Array.from(policies.keys());
  const POLICY_BATCH = 10;
  for (let i = 0; i < policyIds.length; i += POLICY_BATCH) {
    const batch = policyIds.slice(i, i + POLICY_BATCH);
    let res;
    try {
      res = await client.multiGetObjects({
        ids: batch,
        options: { showContent: true },
      });
    } catch (e) {
      errors.push(`policy fetch batch ${i}: ${(e as Error).message}`);
      continue;
    }
    for (const obj of res) {
      const id = obj.data?.objectId ?? "";
      const f = (obj.data?.content as { fields?: Record<string, unknown> })
        ?.fields;
      const row = policies.get(id);
      if (!row || !f) continue;
      row.spent_sui = Number(BigInt(String(f.spent ?? "0"))) / 1e9;
      row.revoked = Boolean(f.revoked);
    }
  }

  // ---- 3) Walk TaskPosted events filtered to predict-btc, fetch
  //         deliverables, parse bodies ----------------------------------
  cursor = null;
  const recentTasks: Array<{
    taskId: string;
    deliverableId: string | null;
    policyId: string | null;
    bodyJson: Record<string, unknown> | null;
  }> = [];
  const TASKS_LIMIT = 100;
  for (let page = 0; page < 6 && recentTasks.length < TASKS_LIMIT; page++) {
    let res;
    try {
      res = await client.queryEvents({
        query: { MoveEventType: `${PACKAGE_ID}::task::TaskPosted` },
        cursor,
        limit: 50,
        order: "descending",
      });
    } catch (e) {
      errors.push(`task events page ${page}: ${(e as Error).message}`);
      break;
    }
    for (const ev of res.data ?? []) {
      const f = ev.parsedJson as Record<string, unknown> | null;
      if (!f) continue;
      const cap = String(f.primary_capability ?? "");
      if (cap !== "predict-btc") continue;
      const taskId = String(f.task_id ?? "");
      if (!taskId) continue;
      recentTasks.push({
        taskId,
        deliverableId: null,
        policyId: null,
        bodyJson: null,
      });
      if (recentTasks.length >= TASKS_LIMIT) break;
    }
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor as { eventSeq: string; txDigest: string };
  }

  // Hydrate tasks → policyId + deliverableId
  const TASK_BATCH = 25;
  for (let i = 0; i < recentTasks.length; i += TASK_BATCH) {
    const batch = recentTasks.slice(i, i + TASK_BATCH);
    let res;
    try {
      res = await client.multiGetObjects({
        ids: batch.map((b) => b.taskId),
        options: { showContent: true },
      });
    } catch (e) {
      errors.push(`task fetch batch ${i}: ${(e as Error).message}`);
      continue;
    }
    for (let j = 0; j < res.length; j++) {
      const f = (res[j].data?.content as { fields?: Record<string, unknown> })
        ?.fields;
      if (!f) continue;
      batch[j]!.policyId = unwrapOptionString(f.parent_policy);
      batch[j]!.deliverableId = unwrapOptionString(f.deliverable_id);
    }
  }

  // Hydrate deliverables
  const deliverableIds = recentTasks
    .map((t) => t.deliverableId)
    .filter((x): x is string => !!x);
  const DELIVERABLE_BATCH = 25;
  const deliverableBodies = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < deliverableIds.length; i += DELIVERABLE_BATCH) {
    const batch = deliverableIds.slice(i, i + DELIVERABLE_BATCH);
    let res;
    try {
      res = await client.multiGetObjects({
        ids: batch,
        options: { showContent: true },
      });
    } catch (e) {
      errors.push(`deliverable fetch batch ${i}: ${(e as Error).message}`);
      continue;
    }
    for (const obj of res) {
      const id = obj.data?.objectId;
      if (!id) continue;
      const f = (obj.data?.content as { fields?: Record<string, unknown> })
        ?.fields;
      const payload = (f?.payload as number[] | undefined) ?? [];
      if (!payload.length) continue;
      try {
        const text = new TextDecoder().decode(new Uint8Array(payload));
        deliverableBodies.set(id, JSON.parse(text));
      } catch {
        /* malformed body · skip */
      }
    }
  }

  // Aggregate into per-policy rows
  for (const t of recentTasks) {
    if (!t.policyId || !t.deliverableId) continue;
    const row = policies.get(t.policyId);
    if (!row) continue;
    const body = deliverableBodies.get(t.deliverableId);
    if (!body) continue;
    row.trade_count += 1;
    const mode = String(
      (body.execution as Record<string, unknown> | undefined)?.mode ?? "",
    );
    if (mode === "live") row.live_count += 1;
    else if (mode === "simulated") row.simulated_count += 1;
    const asset = String(
      (body.market as Record<string, unknown> | undefined)?.underlying ?? "",
    );
    if (asset && !row.distinct_assets.includes(asset)) {
      row.distinct_assets.push(asset);
    }
    const journalEntries = Number(
      (body.execution as Record<string, unknown> | undefined)?.journal_entries ??
        0,
    );
    if (journalEntries > row.journal_entries) {
      row.journal_entries = journalEntries;
      const jblob = String(
        (body.execution as Record<string, unknown> | undefined)
          ?.journal_walrus_blob_id ?? "",
      );
      if (jblob && jblob !== "null") row.journal_walrus_blob_id = jblob;
      const rblob = String(
        (body.execution as Record<string, unknown> | undefined)
          ?.walrus_blob_id ?? "",
      );
      if (rblob && rblob !== "null") row.reasoning_walrus_blob_id = rblob;
    }
    const producedAt = Number(
      (body.metadata as Record<string, unknown> | undefined)?.produced_at_ms ?? 0,
    );
    if (producedAt > row.last_trade_at_ms) row.last_trade_at_ms = producedAt;
  }

  // ---- 4) Fold spot-position realized P&L from local cursor -----------
  //
  // The cursor lives on the same VM as the trader process; we read it
  // directly. Every position has the open/close tx digests (verifiable
  // on Suiscan), the realized P&L base units, and the policy id · so
  // we can attribute closed-bet P&L to the right policy row.
  const positions = await loadSpotPositions();
  for (const p of positions) {
    const row = policies.get(p.policyId);
    if (!row) continue;
    if (p.status === "closed" && p.realizedPnlBase) {
      const pnlUsd = Number(BigInt(p.realizedPnlBase)) / 1e6;
      row.realized_pnl_usd += pnlUsd;
      if (pnlUsd > 0) row.win_count += 1;
      else if (pnlUsd < 0) row.loss_count += 1;
    } else if (p.status === "open") {
      row.open_position_count += 1;
    }
  }

  void scanned;
  const rows = Array.from(policies.values())
    // Sort: live trades desc, then realized P&L desc, then distinct
    // assets desc · rewards activity + multi-asset + profitability.
    .sort((a, b) => {
      if (b.live_count !== a.live_count) return b.live_count - a.live_count;
      if (b.realized_pnl_usd !== a.realized_pnl_usd)
        return b.realized_pnl_usd - a.realized_pnl_usd;
      return b.distinct_assets.length - a.distinct_assets.length;
    });

  return {
    ok: true,
    generated_at_ms: Date.now(),
    cache_ttl_ms: CACHE_TTL_MS,
    network: NETWORK,
    package_id: PACKAGE_ID,
    rows,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const headers = {
    "Cache-Control": `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`,
  };
  // Fresh cache → serve immediately.
  if (CACHE && Date.now() - CACHE.at < CACHE_TTL_MS) {
    return Response.json(CACHE.payload, {
      headers: { ...headers, "X-Brief-Leaderboard": "cached" },
    });
  }
  // Stale cache → serve it now, refresh once in the background. No
  // caller waits on the (expensive) on-chain aggregation when we already
  // have a slightly-old answer · the heart of surviving 100 concurrent.
  if (CACHE) {
    void aggregateOnce().catch(() => {});
    return Response.json(CACHE.payload, {
      headers: { ...headers, "X-Brief-Leaderboard": "stale-revalidating" },
    });
  }
  // Cold start (no cache yet) → await the single shared aggregation.
  try {
    const payload = await aggregateOnce();
    return Response.json(payload, {
      headers: { ...headers, "X-Brief-Leaderboard": "fresh" },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
