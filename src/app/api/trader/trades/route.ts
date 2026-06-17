// GET /api/trader/trades?policy_id=0x…&limit=40
//
// Decision history for one adopted trader: every journal entry the
// agent wrote (BTC mints + spot opens, live and honest abstentions)
// plus the realized-P&L curve from closed DeepBook spot positions.
// Feeds the leaderboard sparklines and the mind canvas's trade strip.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 15_000;
const cache = new Map<
  string,
  { generatedAtMs: number; payload: Record<string, unknown> }
>();

type JournalEntry = {
  taskId: string;
  strategy: string;
  decidedAtMs: number;
  market?: { oracleId?: string; strike?: number; spotAtDecision?: number; expiryMs?: number };
  decision?: { direction?: string; quantity?: number; reasoning?: string };
  execution?: { mode?: string; mintTxDigest?: string | null; walrusReasoningBlobId?: string | null };
};

type SpotPosition = {
  policyId?: string;
  status?: string;
  closedAtMs?: number;
  realizedPnlBase?: string;
  asset?: string;
};

export async function GET(req: NextRequest) {
  const policyId = req.nextUrl.searchParams.get("policy_id");
  if (!policyId || !policyId.startsWith("0x")) {
    return NextResponse.json({ ok: false, error: "policy_id required" }, { status: 400 });
  }
  const limit = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get("limit") ?? 40) || 40));

  const key = `${policyId}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.generatedAtMs < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload);
  }

  // Journal file slug mirrors agents/workforce/trader/index.ts journalPath().
  const slug = policyId.slice(2, 14);
  let entries: JournalEntry[] = [];
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), ".cursors", "trader-journals", `${slug}.json`),
      "utf8",
    );
    const arr = JSON.parse(raw) as JournalEntry[];
    if (Array.isArray(arr)) entries = arr;
  } catch {
    /* no journal yet */
  }

  let positions: SpotPosition[] = [];
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), ".cursors", "trader-spot-positions.json"),
      "utf8",
    );
    const arr = JSON.parse(raw) as SpotPosition[];
    if (Array.isArray(arr)) positions = arr;
  } catch {
    /* no spot positions yet */
  }

  const decisions = entries
    .slice(-limit)
    .map((e) => ({
      ts: e.decidedAtMs,
      task_id: e.taskId,
      strategy: e.strategy,
      direction: e.decision?.direction ?? null,
      quantity: e.decision?.quantity ?? 0,
      abstained: (e.decision?.quantity ?? 0) === 0,
      mode: e.execution?.mode ?? "simulated",
      mint_tx: e.execution?.mintTxDigest ?? null,
      strike_usd: e.market?.strike ? e.market.strike / 1e9 : null,
      spot_usd: e.market?.spotAtDecision ? e.market.spotAtDecision / 1e9 : null,
      // Additive: the journal already records these · exposing them lets
      // the dashboard show the past thesis and compute real settlement
      // (did spot cross the strike in the called direction by expiry).
      expiry_ms: e.market?.expiryMs ?? null,
      oracle_id: e.market?.oracleId ?? null,
      reasoning: e.decision?.reasoning ?? null,
      walrus_reasoning_blob_id: e.execution?.walrusReasoningBlobId ?? null,
    }))
    .reverse();

  // Cumulative realized P&L from closed spot positions (dUSDC, 6dp) -
  // same conversion the leaderboard uses.
  const closed = positions
    .filter((p) => p.policyId === policyId && p.status === "closed" && p.realizedPnlBase)
    .sort((a, b) => (a.closedAtMs ?? 0) - (b.closedAtMs ?? 0));
  let cum = 0;
  const pnlSeries = closed.map((p) => {
    cum += Number(BigInt(p.realizedPnlBase!)) / 1e6;
    return { ts: p.closedAtMs ?? 0, cum: Number(cum.toFixed(6)) };
  });

  const payload = {
    ok: true,
    generated_at_ms: Date.now(),
    policy_id: policyId,
    decisions,
    pnl_series: pnlSeries,
    realized_pnl_usd: Number(cum.toFixed(6)),
  };
  cache.set(key, { generatedAtMs: Date.now(), payload });
  return NextResponse.json(payload);
}
