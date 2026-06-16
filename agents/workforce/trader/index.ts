// Trader Agent — autonomous BTC up/down on DeepBook Predict, gated by
// the same OperatorPolicy + kill switch that runs the Workforce.
//
// This agent is the engine for the Phase-3 "Adopt an AI trader"
// product. It listens for predict-btc tasks (capability filter), picks
// the nearest usable BTC oracle, runs one of three strategies
// (conservative / momentum / contrarian), and either:
//   - LIVE (manager has dUSDC AND we have a policy + spec to gate
//     against): submits the policy-gated atomic mint PTB
//         operator_policy::record_spend(policy, cost, "predict-btc")
//       → market_key::new(...)
//       → predict::mint<DUSDC>(...)
//   - SIMULATED (dUSDC unfunded OR no policy attached): composes the
//     same decision as a deliverable and skips the mint.
//
// In parallel, an auto-redeem service scans positions we've taken,
// detects settled oracles, and calls predict::redeem_permissionless —
// which is by design not gated by the policy, so payouts still flow
// even after a user revokes (the kill switch blocks NEW mints, not
// the user's right to claim what they already won).
//
// Boot pattern mirrors the existing Treasury agent so the same multi-
// wallet env + inbox + recovery machinery applies unchanged.

import fs from "node:fs/promises";
import path from "node:path";
import { Transaction } from "@mysten/sui/transactions";

import { loadEnv } from "../../lib/env.js";
import { makeAgentContextFor, type AgentContext } from "../../lib/sui.js";
import { signAndExecuteWithRetry } from "../../lib/sui-retry.js";
import { augmentRegistration } from "../lib/agent-registry.js";
import { startTaskInbox, type TaskPostedNotice } from "../lib/inbox.js";
import { recoverStuckTasks } from "../lib/recovery.js";
import {
  appendMintAndSubmit,
  buildAcceptTaskTx,
  fetchTask,
} from "../lib/task.js";
import {
  hasWalrusFunding,
  uploadToWalrus,
  walrusEnabled,
} from "../../lib/walrus.js";
import { consolidateSuiCoins } from "../../lib/sui-coin-consolidate.js";
import { getMarket, type MarketSpec } from "../lib/markets.js";
import { closeSpot, openSpot, readSpotMid } from "./spot-handler.js";
import {
  buildFuelDepositTx,
  buildGatedSpotTx,
  gatedCoinTypes,
  readBmAssetBalance,
  type GatedNetwork,
} from "../lib/deepbook-spot.js";
import { appendPoint, loadHistory } from "./price-history.js";
import { computeSignals, type SignalBundle } from "./signals.js";
import {
  decodeSurface,
  impliedProbUp,
  readSurfaceRaw,
  type SurfaceSnapshot,
} from "./vol-surface.js";
import { emitAgentEvent } from "../lib/agent-events.js";
import {
  appendSpotPosition,
  dueSpotPositions,
  loadSpotPositions,
  markSpotPositionClosed,
  type SpotPosition,
} from "./spot-positions.js";
import {
  buildCreateManagerTx,
  buildGatedMintTx,
  buildRedeemPermissionlessTx,
  DUSDC_BASE,
  fetchActiveBtcOracles,
  fetchRecentSettledBtcOracles,
  nearestTickStrike,
  PRICE_SCALAR,
  readManagerDusdcBalance,
  readOracleIsSettled,
  readOracleSpot,
  type IndexerOracle,
} from "../lib/predict.js";
import {
  abstentionReason,
  baselineParams,
  calibrateParams,
  decide,
  STRATEGIES,
  type Direction,
  type OperatorGoal,
  type StrategyDecision,
  type StrategyId,
} from "./strategy.js";
import {
  runDecisionEngine,
  modeFromGoal,
  normalizeMode,
} from "./decision-engine.js";

const POLL_MS = 3000;
const REDEEM_POLL_MS = 30_000;
const CURSOR_PATH = ".cursors/trader-workforce.json";
const POSITIONS_PATH = ".cursors/trader-positions.json";
const MANAGER_PATH = ".cursors/trader-manager.json";
const SCHEMA_VERSION = 1n;

const DEFAULT_STRATEGY: StrategyId = "conservative";

/** Spot positions auto-close one hour after open by default — short
 *  enough that a demo can show a complete cycle in one session, long
 *  enough that a thoughtful directional bet actually has room to move. */
const SPOT_HORIZON_MS = 60 * 60 * 1000;
/** How often the auto-close service scans the durable cursor for due
 *  positions. Matches the redeem loop cadence. */
const SPOT_CLOSE_POLL_MS = 30_000;

// === Spec parsing ===

type TraderSpec = {
  context?: string;
  /** Override strategy from the dispatched mission. */
  strategy?: StrategyId;
  /** Optional policy + venue to gate the mint against. */
  policyId?: string;
  venue?: string;
  /** Override quantity (in dUSDC contracts). */
  quantity?: number;
  /** User-given name for the trader — surfaced in the memory journal
   *  header so the same Walrus blob reads as "Bolt's memory" / etc. */
  traderName?: string;
  /** Explicit asset override (BTC / SUI / WAL / DEEP). When set, the
   *  router skips bundle inspection and routes straight to this asset. */
  asset?: string;
  /** Market bundle the user picked at adoption — the policy's
   *  allowed_venues already narrows on chain. We rotate within the
   *  bundle here to choose a concrete asset per task. */
  markets?: "btc_only" | "sui_ecosystem" | "all";
  /** Goal the user set at adoption — deterministically calibrates the
   *  operating thresholds. Absent → baseline (pre-goal behaviour). */
  goal?: OperatorGoal;
};

/** Pick the asset to bet on this task. Explicit `spec.asset` wins;
 *  otherwise we honour the user's bundle by rotating through the
 *  allowed assets keyed deterministically by the task id (so the same
 *  task always resolves to the same asset if the trader retries). */
function chooseAsset(spec: TraderSpec, taskId: string): "BTC" | "SUI" | "WAL" | "DEEP" {
  const explicit = (spec.asset ?? "").toUpperCase();
  if (explicit === "BTC" || explicit === "SUI" || explicit === "WAL" || explicit === "DEEP") {
    return explicit;
  }
  const bundle = spec.markets ?? "btc_only";
  if (bundle === "btc_only") return "BTC";
  // For sui_ecosystem / all: rotate SUI/WAL/DEEP using task id hash.
  // BTC is intentionally excluded from spot rotation — the bundle's BTC
  // share gets a dedicated dispatch (the user adopting "all" can still
  // trigger a BTC task via the existing dispatch path).
  // Weighted rotation by task-id hash: SUI 50% / DEEP 30% / WAL 20%.
  // WAL's DeepBook pool is the flakiest on testnet (readSpotMid often
  // returns nothing), so it gets the smallest share — and handleSpotTask
  // falls back across pools if the chosen one is unreadable anyway.
  const roll = (parseInt(taskId.slice(2, 10), 16) >>> 0) % 100;
  if (roll < 50) return "SUI";
  if (roll < 80) return "DEEP";
  return "WAL";
}

function parseSpec(raw: string): TraderSpec {
  const t = raw.trim();
  if (!t) return {};
  if (t.startsWith("{")) {
    try {
      return JSON.parse(t) as TraderSpec;
    } catch {
      return { context: t };
    }
  }
  return { context: t };
}

// === Local position store ===

type StoredPosition = {
  taskId: string;
  oracleId: string;
  expiryMs: number;
  strike: string; // bigint as string for JSON
  isUp: boolean;
  quantity: number;
  costDusdc: number;
  mintTxDigest: string;
  mintedAtMs: number;
  strategy: StrategyId;
};

async function loadPositions(): Promise<StoredPosition[]> {
  try {
    const raw = await fs.readFile(POSITIONS_PATH, "utf8");
    return JSON.parse(raw) as StoredPosition[];
  } catch {
    return [];
  }
}

async function savePositions(xs: StoredPosition[]): Promise<void> {
  await fs.mkdir(path.dirname(POSITIONS_PATH), { recursive: true });
  await fs.writeFile(POSITIONS_PATH, JSON.stringify(xs, null, 2));
}

// === Memory journal — the Walrus-backed agent memory ===

type JournalEntry = {
  taskId: string;
  traderName: string | null;
  strategy: StrategyId;
  decidedAtMs: number;
  market: {
    oracleId: string;
    expiryMs: number;
    strike: number;
    spotAtDecision: number;
  };
  decision: {
    direction: Direction;
    quantity: number;
    reasoning: string;
  };
  execution: {
    mode: ExecutionMode;
    mintTxDigest: string | null;
    walrusReasoningBlobId: string | null;
  };
};

function journalPath(policyId: string | null): string {
  // Per-policy journal keeps each adopted trader's memory siloed — a
  // judge can adopt a second trader without their first one's history
  // contaminating the new identity's blob.
  const slug = policyId ? policyId.slice(2, 14) : "no-policy";
  return path.join(".cursors", "trader-journals", `${slug}.json`);
}

async function loadJournal(
  policyId: string | null,
): Promise<JournalEntry[]> {
  try {
    const raw = await fs.readFile(journalPath(policyId), "utf8");
    return JSON.parse(raw) as JournalEntry[];
  } catch {
    return [];
  }
}

async function saveJournal(
  policyId: string | null,
  entries: JournalEntry[],
): Promise<void> {
  const p = journalPath(policyId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(entries, null, 2));
}

// === Operator manifesto ===
// Published once per policy to Walrus: the operator's declared identity,
// operating parameters, and a pledge of what it will and won't do. It is
// the operator's verifiable "contract" alongside the on-chain policy —
// declared intent + code enforcement. Best-effort; never blocks a task.

type ManifestState = {
  policyId: string | null;
  published: boolean;
  blobId: string | null;
  atMs: number;
};

function manifestPath(policyId: string | null): string {
  const slug = policyId ? policyId.slice(2, 14) : "no-policy";
  return path.join(".cursors", "trader-manifest", `${slug}.json`);
}

async function loadManifestState(
  policyId: string | null,
): Promise<ManifestState | null> {
  try {
    return JSON.parse(
      await fs.readFile(manifestPath(policyId), "utf8"),
    ) as ManifestState;
  } catch {
    return null;
  }
}

async function saveManifestState(
  policyId: string | null,
  s: ManifestState,
): Promise<void> {
  const p = manifestPath(policyId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(s, null, 2));
}

/** Human label for a goal — used in reasoning + logs. */
function goalLabel(goal?: OperatorGoal): string {
  if (!goal || goal.type === "edge") return "edge-seeking goal";
  if (goal.type === "preserve") return "capital-preservation goal";
  return `${goal.targetPct ?? "?"}%-in-${goal.horizonDays ?? "?"}d growth goal`;
}

function buildManifesto(spec: TraderSpec, strategy: StrategyId, asset: string) {
  const base = baselineParams(strategy);
  const calibrated = calibrateParams(strategy, spec.goal);
  return {
    schema: "brief.operator-manifesto.v2",
    operatorId: spec.traderName ?? strategy,
    personality: strategy,
    policyId: spec.policyId ?? null,
    firstAsset: asset,
    adoptedAtMs: Date.now(),
    goal: spec.goal ?? null,
    calibratedParams: {
      minEdge: calibrated.minEdge,
      maxQty: calibrated.maxQty,
      convictionFloor: calibrated.convictionFloor,
    },
    baselineParams: {
      minEdge: base.minEdge,
      maxQty: base.maxQty,
      convictionFloor: base.convictionFloor,
    },
    enforcedOnChain: {
      policyObject: spec.policyId ?? null,
      note: "budget cap, allowed venues, expiry and the revoke kill-switch are enforced on the OperatorPolicy object — not by this agent",
    },
    pledge:
      "I will act only when a genuine edge exists. " +
      "I will preserve capital when conditions don't meet my threshold. " +
      "I will never exceed the policy the chain enforces. " +
      "My owner can revoke me at any time.",
  };
}

/** Publish the operator's manifesto to Walrus exactly once per policy.
 *  Call ONLY when Walrus is reachable + funded (inside the walFunded
 *  block). Fully best-effort — never throws, never blocks the task. */
async function publishManifestoOnce(
  ctx: AgentContext,
  spec: TraderSpec,
  strategy: StrategyId,
  asset: string,
  taskId: string,
): Promise<void> {
  try {
    const prior = await loadManifestState(spec.policyId ?? null);
    if (prior?.published) return;
    const manifesto = buildManifesto(spec, strategy, asset);
    const uploaded = await uploadToWalrus(
      new TextEncoder().encode(JSON.stringify(manifesto, null, 2)),
      ctx.client,
      ctx.keypair,
    );
    console.log(
      `[trader] walrus manifesto blob=${uploaded.blobId} (${uploaded.uploadMs}ms)`,
    );
    emitAgentEvent("walrus_uploaded", {
      policyId: spec.policyId ?? null,
      taskId,
      asset,
      data: { kind: "manifesto", blob_id: uploaded.blobId, upload_ms: uploaded.uploadMs },
    });
    await saveManifestState(spec.policyId ?? null, {
      policyId: spec.policyId ?? null,
      published: true,
      blobId: uploaded.blobId,
      atMs: Date.now(),
    });
  } catch (e) {
    console.warn(
      "[trader] manifesto publish skipped:",
      String((e as Error)?.message ?? e).slice(0, 120),
    );
  }
}

/** Render the journal as human-readable markdown — what we upload to
 *  Walrus as the trader's persistent memory. The agent could also
 *  read these entries back as input for future decisions; for now the
 *  ask is "verifiable, growing memory" and this delivers that. */
function journalMarkdown(args: {
  traderName: string | null;
  strategy: StrategyId | null;
  entries: JournalEntry[];
  policyId: string | null;
}): string {
  const head = [
    `# ${args.traderName ?? "Trader"} · memory`,
    "",
    `> The complete decision log for this trader, regenerated every`,
    `> time it makes a new move and uploaded as a single Walrus blob.`,
    `> Each blob is content-addressed — anyone can verify the trader`,
    `> hasn't rewritten its history.`,
    "",
    `**Strategy:** ${args.strategy ?? "(unknown)"}`,
    `**Policy id:** ${args.policyId ?? "(unbound)"}`,
    `**Entries:** ${args.entries.length}`,
    `**Generated:** ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ];
  const body = args.entries.map((e, i) => {
    const expiry = new Date(e.market.expiryMs).toISOString();
    const decidedAt = new Date(e.decidedAtMs).toISOString();
    const strikeUsd = e.market.strike / PRICE_SCALAR;
    const spotUsd = e.market.spotAtDecision / PRICE_SCALAR;
    return [
      `## #${i + 1} — ${e.decision.direction.toUpperCase()} on BTC (${e.execution.mode})`,
      "",
      `**Decided:** ${decidedAt}`,
      `**Strategy:** ${e.strategy}`,
      `**Strike:** $${strikeUsd.toFixed(2)}  ·  **Spot at decision:** $${spotUsd.toFixed(2)}`,
      `**Stake:** ${e.decision.quantity} dUSDC contracts`,
      `**Expiry:** ${expiry}`,
      `**Task id:** \`${e.taskId}\``,
      e.execution.mintTxDigest
        ? `**Mint tx:** \`${e.execution.mintTxDigest}\``
        : `**Mint tx:** _none (simulated)_`,
      e.execution.walrusReasoningBlobId
        ? `**Reasoning blob:** \`${e.execution.walrusReasoningBlobId}\``
        : "",
      "",
      `### Reasoning`,
      "",
      e.decision.reasoning,
      "",
      "---",
      "",
    ].filter(Boolean).join("\n");
  });
  return head.concat(body).join("\n");
}

// === Manager id management ===

async function ensureManager(ctx: AgentContext): Promise<string> {
  const fromEnv = process.env.BRIEF_PREDICT_MANAGER_ID?.trim();
  if (fromEnv?.startsWith("0x")) return fromEnv;
  try {
    const raw = await fs.readFile(MANAGER_PATH, "utf8");
    const parsed = JSON.parse(raw) as { id?: string };
    if (parsed.id?.startsWith("0x")) return parsed.id;
  } catch {
    /* create one below */
  }
  console.log("[trader] no PredictManager configured — creating one…");
  const res = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: buildCreateManagerTx(),
    options: { showEffects: true, showObjectChanges: true },
  });
  const created = (res.objectChanges ?? []).find(
    (c) =>
      c.type === "created" &&
      typeof (c as { objectType?: string }).objectType === "string" &&
      (c as { objectType?: string }).objectType?.includes(
        "::predict_manager::PredictManager",
      ),
  ) as { objectId?: string } | undefined;
  if (!created?.objectId) throw new Error("create_manager returned no id");
  await fs.mkdir(path.dirname(MANAGER_PATH), { recursive: true });
  await fs.writeFile(
    MANAGER_PATH,
    JSON.stringify({ id: created.objectId, createdAtMs: Date.now() }, null, 2),
  );
  console.log(
    `[trader] created PredictManager ${created.objectId} (tx=${res.digest})`,
  );
  return created.objectId;
}

// === Market selection ===

type MarketChoice = {
  oracle: IndexerOracle;
  spotRaw: bigint;
  strikeRaw: bigint;
};

async function chooseMarket(ctx: AgentContext): Promise<MarketChoice | null> {
  const actives = await fetchActiveBtcOracles();
  if (actives.length === 0) return null;
  const nowMs = Date.now();
  // Skip oracles within the 30s staleness window of expiry — too risky.
  const usable = actives.filter((o) => o.expiry - nowMs > 60_000);
  if (usable.length === 0) return null;
  const oracle = usable[0];
  const spotRaw = await readOracleSpot(ctx, oracle.oracle_id);
  const strikeRaw = nearestTickStrike(
    spotRaw,
    BigInt(oracle.min_strike),
    BigInt(oracle.tick_size),
  );
  return { oracle, spotRaw, strikeRaw };
}

// === Deliverable shape ===

type ExecutionMode = "live" | "simulated";

type TraderDeliverable = {
  task_title: string;
  primary_capability: string;
  spec_context: string;
  strategy: StrategyId;
  market: {
    oracle_id: string;
    underlying: string;
    expiry_ms: number;
    strike: number; // 1e9-scaled
    tick_size: number;
    spot_at_decision: number;
  };
  decision: {
    direction: Direction;
    quantity: number;
    cost_dusdc_base: number; // base units (6 decimals)
    reasoning: string;
  };
  execution: {
    mode: ExecutionMode;
    mint_tx_digest: string | null;
    walrus_blob_id: string | null;
    reason_if_simulated: string | null;
    /** Per-trader cumulative memory journal — every prior decision +
     *  outcome rolled into one markdown blob uploaded to Walrus. Each
     *  task version-bumps the blob; the UI surfaces this as
     *  "{Name}'s memory · on Walrus" so a judge can open and read the
     *  trader's full history content-addressed. */
    journal_walrus_blob_id: string | null;
    /** Number of decisions in the journal at this version. */
    journal_entries: number;
  };
  metadata: {
    produced_by: string;
    produced_at_ms: number;
    schema_version: number;
    manager_id: string;
    policy_id: string | null;
    venue: string;
  };
};

function composeDeliverable(args: {
  notice: TaskPostedNotice;
  spec: TraderSpec;
  market: MarketChoice;
  decision: StrategyDecision;
  mode: ExecutionMode;
  costDusdcBase: bigint;
  mintTxDigest: string | null;
  walrusBlobId: string | null;
  reasonIfSimulated: string | null;
  journalWalrusBlobId: string | null;
  journalEntries: number;
  managerId: string;
  policyId: string | null;
  venue: string;
  agentAddress: string;
}): TraderDeliverable {
  return {
    task_title: args.notice.title,
    primary_capability: args.notice.primaryCapability,
    spec_context: args.spec.context ?? "(no context provided in spec)",
    strategy: args.decision.strategy,
    market: {
      oracle_id: args.market.oracle.oracle_id,
      underlying: args.market.oracle.underlying_asset,
      expiry_ms: args.market.oracle.expiry,
      strike: Number(args.market.strikeRaw),
      tick_size: args.market.oracle.tick_size,
      spot_at_decision: Number(args.market.spotRaw),
    },
    decision: {
      direction: args.decision.direction,
      quantity: args.decision.quantity,
      cost_dusdc_base: Number(args.costDusdcBase),
      reasoning: args.decision.reasoning,
    },
    execution: {
      mode: args.mode,
      mint_tx_digest: args.mintTxDigest,
      walrus_blob_id: args.walrusBlobId,
      reason_if_simulated: args.reasonIfSimulated,
      journal_walrus_blob_id: args.journalWalrusBlobId,
      journal_entries: args.journalEntries,
    },
    metadata: {
      produced_by: args.agentAddress,
      produced_at_ms: Date.now(),
      schema_version: Number(SCHEMA_VERSION),
      manager_id: args.managerId,
      policy_id: args.policyId,
      venue: args.venue,
    },
  };
}

function reasoningMarkdown(args: {
  decision: StrategyDecision;
  market: MarketChoice;
  mode: ExecutionMode;
  mintTxDigest: string | null;
  signals?: SignalBundle;
  surface?: SurfaceSnapshot | null;
}): string {
  const expiry = new Date(args.market.oracle.expiry).toISOString();
  const strikeUsd = Number(args.market.strikeRaw) / PRICE_SCALAR;
  const spotUsd = Number(args.market.spotRaw) / PRICE_SCALAR;
  const lines: string[] = [
    `# Trader decision · ${args.decision.strategy}`,
    "",
    `**Direction:** ${args.decision.direction.toUpperCase()}`,
    `**Quantity:** ${args.decision.quantity} dUSDC contracts`,
    `**Conviction:** ${args.decision.conviction.toFixed(2)} / 1.00`,
    `**Market:** BTC oracle \`${args.market.oracle.oracle_id}\``,
    `**Strike:** $${strikeUsd.toFixed(2)}  ·  **Spot at decision:** $${spotUsd.toFixed(2)}`,
    `**Expiry (UTC):** ${expiry}`,
    `**Mode:** ${args.mode}` +
      (args.mintTxDigest ? `  ·  mint tx \`${args.mintTxDigest}\`` : ""),
  ];
  if (args.signals) {
    const fmtPct = (x: number | null | undefined) =>
      x === null || x === undefined || !Number.isFinite(x)
        ? "n/a"
        : `${(x * 100).toFixed(3)}%`;
    const fmtNum = (x: number | null | undefined, d = 2) =>
      x === null || x === undefined || !Number.isFinite(x)
        ? "n/a"
        : x.toFixed(d);
    lines.push(
      "",
      `## Signals at decision time`,
      `- **ROC 5m / 30m / 60m:** ${fmtPct(args.signals.roc_5m)} / ${fmtPct(args.signals.roc_30m)} / ${fmtPct(args.signals.roc_60m)}`,
      `- **SMA 15m / 60m:** $${fmtNum(args.signals.sma_15m)} / $${fmtNum(args.signals.sma_60m)}`,
      `- **RSI 60m:** ${fmtNum(args.signals.rsi_60m, 1)}`,
      `- **Realized vol 60m (annualized):** ${fmtPct(args.signals.realized_vol_60m)}`,
    );
  }
  if (args.surface) {
    const s = args.surface;
    lines.push(
      "",
      `## SVI vol surface (live, on-chain)`,
      `- **Forward:** $${s.forwardUsd.toFixed(2)}  ·  **Spot:** $${s.spotUsd.toFixed(2)}`,
      `- **SVI params:** a=${s.a.toFixed(6)}, b=${s.b.toFixed(6)}, ρ=${s.rho.toFixed(4)}, m=${s.m.toFixed(6)}, σ=${s.sigma.toFixed(6)}`,
    );
  }
  lines.push("", `## Reasoning`, args.decision.reasoning);
  return lines.join("\n");
}

// === Task handler ===

async function handleTask(
  ctx: AgentContext,
  managerId: string,
  notice: TaskPostedNotice,
): Promise<void> {
  console.log(
    `[trader] task ${notice.taskId.slice(0, 12)}… "${notice.title}" bounty=${(Number(notice.bountyAmount) / 1e9).toFixed(3)} SUI`,
  );

  const t = await fetchTask(ctx, notice.taskId);
  if (t.status === "delivered" || t.status === "approved" || t.status === "expired") {
    console.log(`[trader] task already ${t.status}, skipping`);
    return;
  }

  // ---- 1) Accept (or resume) -----
  if (t.status === "open") {
    console.log("[trader] accepting…");
    const acceptRes = await signAndExecuteWithRetry(
      ctx,
      () => buildAcceptTaskTx(ctx, notice.taskId),
      { showEffects: true },
      {
        label: "trader:accept",
        attempts: 3,
        alreadyDone: async () => {
          try {
            const cur = await fetchTask(ctx, notice.taskId);
            if (
              cur.status === "accepted" &&
              cur.assignedTo.toLowerCase() === ctx.address.toLowerCase()
            ) {
              return "done";
            }
            if (cur.status === "delivered" || cur.status === "approved") {
              return "done";
            }
          } catch {
            /* fall through */
          }
          return null;
        },
      },
    );
    if (acceptRes.effects?.status?.status !== "success") {
      throw new Error(
        `accept failed: ${acceptRes.effects?.status?.error ?? "unknown"}`,
      );
    }
  } else if (
    t.status === "accepted" &&
    t.assignedTo.toLowerCase() === ctx.address.toLowerCase()
  ) {
    console.log("[trader] resuming previously-accepted task to deliver");
  } else {
    console.log(
      `[trader] task in unexpected state ${t.status}; skipping`,
    );
    return;
  }

  // ---- 2) Decide market + direction -----
  const spec = parseSpec(t.specBlob);

  // ---- Asset router -----
  // The trader can play BTC (Predict, binary up/down at expiry) or
  // SUI/WAL/DEEP (DeepBook spot, directional buy/sell over a horizon).
  // Whoever dispatches the task picks the asset via `spec.asset`, or
  // we infer one from the adopted policy's market bundle (`spec.markets`)
  // — the policy's `allowed_venues` already narrowed the user's
  // authorization at grant time.
  //
  // The BTC path below this branch stays byte-for-byte unchanged so the
  // proven live BTC trader is never put at risk by spot wiring.
  const asset = chooseAsset(spec, notice.taskId);
  emitAgentEvent("task_started", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset,
    data: { title: notice.title, strategy: spec.strategy ?? DEFAULT_STRATEGY },
  });
  if (asset !== "BTC") {
    await handleSpotTask(ctx, asset, t, notice, spec);
    return;
  }

  const strategyId = spec.strategy ?? DEFAULT_STRATEGY;
  if (!STRATEGIES[strategyId]) {
    throw new Error(`unknown strategy in spec: ${strategyId}`);
  }
  const venue = spec.venue ?? "predict-btc";

  const market = await chooseMarket(ctx);
  if (!market) {
    throw new Error(
      "no usable active BTC oracle (all expired within staleness window?)",
    );
  }
  const recentSettled = await fetchRecentSettledBtcOracles(10);

  // Observe the live spot and append to rolling history BEFORE deciding,
  // so the freshest tick is always one of the signals. Then compute the
  // signal bundle (ROC / SMA / RSI / realized vol) from disk.
  const spotUsdNow = Number(market.spotRaw) / PRICE_SCALAR;
  emitAgentEvent("observe", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset: "BTC",
    data: {
      spot_usd: spotUsdNow,
      oracle_id: market.oracle.oracle_id,
      strike_usd: Number(market.strikeRaw) / PRICE_SCALAR,
      expiry_ms: market.oracle.expiry,
    },
  });
  await appendPoint("BTC", { ts: Date.now(), price: spotUsdNow });
  const history = await loadHistory("BTC");
  const signals = computeSignals(history, Date.now());
  emitAgentEvent("signals", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset: "BTC",
    data: { signals },
  });

  // Read the live SVI vol surface — the centerpiece input the quant
  // strategy diverges from. We tolerate a read failure (cold RPC) by
  // proceeding without it; strategies that need it return null and the
  // trader honestly delivers a simulated abstention.
  let surface: SurfaceSnapshot | null = null;
  try {
    const raw = await readSurfaceRaw(ctx, market.oracle.oracle_id);
    surface = decodeSurface(raw);
    emitAgentEvent("svi", {
      policyId: spec.policyId ?? null,
      taskId: notice.taskId,
      asset: "BTC",
      data: { ok: true, surface },
    });
  } catch (e) {
    console.warn(
      "[trader] SVI surface read failed:",
      String((e as Error)?.message ?? e).slice(0, 120),
    );
    emitAgentEvent("svi", {
      policyId: spec.policyId ?? null,
      taskId: notice.taskId,
      asset: "BTC",
      data: { ok: false },
    });
  }

  const strikeUsd = Number(market.strikeRaw) / PRICE_SCALAR;
  // Goal-calibrated thresholds (no goal → baseline, byte-identical).
  const params = calibrateParams(strategyId, spec.goal);
  let decision = decide(strategyId, {
    asset: "BTC",
    spotUsd: spotUsdNow,
    signals,
    recentSettled,
    market: {
      strikeUsd,
      expiryMs: market.oracle.expiry,
      oracle: market.oracle,
    },
    surface,
    params,
    nowMs: Date.now(),
  });
  if (decision && spec.quantity && spec.quantity > 0) {
    decision.quantity = spec.quantity;
  }
  // Goal gates (no-op at baseline): cap size to maxQty, and abstain if the
  // conviction is below the calibrated floor. Conviction captured before
  // nulling so the abstention reason can cite it.
  let floorConv: number | null = null;
  if (decision) {
    decision.quantity = Math.min(decision.quantity, params.maxQty);
    if (decision.conviction < params.convictionFloor) {
      floorConv = decision.conviction;
      decision = null;
    }
  }
  // Goal-aware: when acting, say WHY the thresholds are what they are.
  if (decision && spec.goal && spec.goal.type !== "edge") {
    decision.reasoning += ` Thresholds calibrated for your ${goalLabel(spec.goal)}.`;
  }
  // The honest per-strategy "capital preserved" reason, computed once when
  // the strategy sat out (feeds both the decision event + simulated mode).
  const abstainReason = decision
    ? null
    : floorConv !== null
      ? `${strategyId} preserved capital on BTC: conviction ${floorConv.toFixed(2)} is below the ${params.convictionFloor.toFixed(2)} floor calibrated for your ${goalLabel(spec.goal)} — not strong enough to risk capital.`
      : abstentionReason(strategyId, signals, "BTC", spotUsdNow, params);
  if (decision) {
    console.log(
      `[trader] strategy=${strategyId} direction=${decision.direction} qty=${decision.quantity} conv=${decision.conviction.toFixed(2)} strike=$${strikeUsd.toFixed(2)} spot=$${spotUsdNow.toFixed(2)} expiry=${new Date(market.oracle.expiry).toISOString()}`,
    );
    console.log(`[trader] reasoning: ${decision.reasoning}`);
  } else {
    console.log(
      `[trader] strategy=${strategyId} → no-edge abstention (signals: ROC30m=${signals.roc_30m ?? "n/a"} RSI60m=${signals.rsi_60m ?? "n/a"})`,
    );
  }
  emitAgentEvent("decision", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset: "BTC",
    data: {
      strategy: strategyId,
      decided: !!decision,
      direction: decision?.direction ?? null,
      quantity: decision?.quantity ?? 0,
      conviction: decision?.conviction ?? 0,
      reasoning: decision?.reasoning ?? abstainReason,
      strike_usd: strikeUsd,
      spot_usd: spotUsdNow,
      market_p: surface ? impliedProbUp(surface, strikeUsd) : null,
    },
  });

  // ---- 3) Decide mode (live vs simulated) -----
  // No-edge abstention is HONEST: we still deliver the task with a
  // simulated label so the journal records why we sat out.
  const managerDusdcBase = await readManagerDusdcBalance(ctx, managerId);
  const fallbackQty = 1; // accounting only — never actually minted
  const costDusdcBase =
    BigInt(decision?.quantity ?? fallbackQty) * BigInt(DUSDC_BASE);
  const hasFunds = managerDusdcBase >= costDusdcBase;
  const hasGate = !!spec.policyId;
  let mode: ExecutionMode =
    decision && hasFunds && hasGate ? "live" : "simulated";
  let mintDigest: string | null = null;
  let simReason: string | null = null;
  if (!decision) {
    // Honest, per-strategy "why I preserved capital" — cites live numbers.
    simReason = abstainReason;
  } else if (!hasFunds) {
    simReason = `Manager dUSDC ${Number(managerDusdcBase) / DUSDC_BASE} < required ${decision.quantity} — top up the PredictManager to flip to live.`;
  } else if (!hasGate) {
    simReason = `No policy_id in task spec — live trades must be gated by an OperatorPolicy with venue "${venue}".`;
  }
  console.log(
    `[trader] mode=${mode} manager_dusdc=${Number(managerDusdcBase) / DUSDC_BASE} hasFunds=${hasFunds} hasGate=${hasGate} hasDecision=${!!decision}`,
  );
  emitAgentEvent("mode", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset: "BTC",
    data: { mode, sim_reason: simReason },
  });

  // Materialize a placeholder for the journal + deliverable when the
  // strategy abstained. Direction is recorded as the would-have-been
  // direction (cold-start signal) so the journal still reads coherent;
  // quantity 0 makes the abstention explicit downstream.
  const recordDecision = decision ?? {
    strategy: strategyId,
    direction: "up" as const,
    quantity: 0,
    conviction: 0,
    reasoning:
      simReason ?? `${strategyId} abstained — no signal cleared the threshold.`,
  };

  // ---- 4) LIVE: build + submit the policy-gated mint -----
  if (decision && mode === "live" && spec.policyId) {
    // record_spend amount is denominated in MIST (9 decimals) but our
    // cost is in dUSDC base units (6 decimals). Multiply by 1000 so the
    // policy budget caps the trader's dollar spend cleanly.
    const recordSpendAmount = costDusdcBase * 1000n;
    const mintTx = buildGatedMintTx({
      briefPackage: ctx.packageId,
      policyId: spec.policyId,
      venue,
      managerId,
      oracleId: market.oracle.oracle_id,
      expiryMs: market.oracle.expiry,
      strike: market.strikeRaw,
      isUp: decision.direction === "up",
      quantity: BigInt(decision.quantity),
      recordSpendAmount,
    });
    emitAgentEvent("mint_pending", {
      policyId: spec.policyId ?? null,
      taskId: notice.taskId,
      asset: "BTC",
      data: {
        direction: decision.direction,
        quantity: decision.quantity,
        oracle_id: market.oracle.oracle_id,
      },
    });
    try {
      const res = await signAndExecuteWithRetry(
        ctx,
        () => mintTx,
        { showEffects: true, showEvents: true },
        { label: "trader:mint", attempts: 2 },
      );
      if (res.effects?.status?.status !== "success") {
        throw new Error(res.effects?.status?.error ?? "mint failed");
      }
      mintDigest = res.digest;
      console.log(`[trader] LIVE mint ok tx=${mintDigest}`);
      emitAgentEvent("mint_landed", {
        policyId: spec.policyId ?? null,
        taskId: notice.taskId,
        asset: "BTC",
        data: { tx: mintDigest },
      });
      // Track the position locally for the auto-redeem service.
      const positions = await loadPositions();
      positions.push({
        taskId: notice.taskId,
        oracleId: market.oracle.oracle_id,
        expiryMs: market.oracle.expiry,
        strike: market.strikeRaw.toString(),
        isUp: decision!.direction === "up",
        quantity: decision!.quantity,
        costDusdc: Number(costDusdcBase) / DUSDC_BASE,
        mintTxDigest: mintDigest,
        mintedAtMs: Date.now(),
        strategy: decision!.strategy,
      });
      await savePositions(positions);
    } catch (e) {
      // Fall back to simulated so we still deliver a coherent task,
      // and the user can see what the mint *would* have done.
      mode = "simulated";
      simReason = `Live mint failed: ${(e as Error).message.slice(0, 160)}`;
      console.warn(`[trader] live mint failed, falling back to simulated:`, e);
      emitAgentEvent("mint_failed", {
        policyId: spec.policyId ?? null,
        taskId: notice.taskId,
        asset: "BTC",
        data: { error: (e as Error).message.slice(0, 160) },
      });
    }
  }

  // ---- 5) Walrus uploads — per-decision reasoning + cumulative journal.
  //
  // Two separate blobs per task when WAL is funded:
  //   (a) reasoning  — just this decision's markdown (the "agent's
  //                    thinking on this trade")
  //   (b) journal    — the trader's entire prior memory + this entry
  //                    rolled into one blob (the "agent that remembers
  //                    and builds over time" story for the Walrus track)
  //
  // Both upload independently. Either may fail without breaking the
  // task — we just don't surface that blob.
  let walrusBlobId: string | null = null;
  let journalBlobId: string | null = null;
  let journalEntries = 0;
  // Pre-flight: consolidate the wallet's SUI coins into one object.
  // The Walrus SDK auto-picks gas coins; if any fragment is smaller
  // than the requested storage cost it aborts at `balance::split`.
  // Mint deliveries fragment SUI through change outputs every cycle,
  // so we merge here right before the Walrus uploads.
  if (walrusEnabled()) {
    try {
      const c = await consolidateSuiCoins(ctx.client, ctx.keypair);
      if (c.merged) {
        console.log(
          `[trader] consolidated ${c.coinsBefore} SUI coins → 1 (${(Number(c.balance) / 1e9).toFixed(4)} SUI) tx=${c.digest}`,
        );
      }
    } catch (e) {
      console.warn("[trader] coin consolidation skipped:", String((e as Error)?.message ?? e).slice(0, 120));
    }
  }
  const walFunded = walrusEnabled()
    ? await hasWalrusFunding(ctx.client, ctx.address)
    : false;

  if (walFunded) {
    try {
      const md = reasoningMarkdown({
        decision: recordDecision,
        market,
        mode,
        mintTxDigest: mintDigest,
        signals,
        surface,
      });
      const uploaded = await uploadToWalrus(
        new TextEncoder().encode(md),
        ctx.client,
        ctx.keypair,
      );
      walrusBlobId = uploaded.blobId;
      console.log(
        `[trader] walrus reasoning blob=${walrusBlobId} (${uploaded.uploadMs}ms)`,
      );
      emitAgentEvent("walrus_uploaded", {
        policyId: spec.policyId ?? null,
        taskId: notice.taskId,
        asset: "BTC",
        data: { kind: "reasoning", blob_id: walrusBlobId, upload_ms: uploaded.uploadMs },
      });
    } catch (e) {
      console.warn("[trader] walrus reasoning upload failed:", e);
    }

    // Append to the persistent journal + upload the cumulative blob.
    try {
      const prior = await loadJournal(spec.policyId ?? null);
      const entry: JournalEntry = {
        taskId: notice.taskId,
        traderName: spec.traderName ?? null,
        strategy: recordDecision.strategy,
        decidedAtMs: Date.now(),
        market: {
          oracleId: market.oracle.oracle_id,
          expiryMs: market.oracle.expiry,
          strike: Number(market.strikeRaw),
          spotAtDecision: Number(market.spotRaw),
        },
        decision: {
          direction: recordDecision.direction,
          quantity: recordDecision.quantity,
          reasoning: recordDecision.reasoning,
        },
        execution: {
          mode,
          mintTxDigest: mintDigest,
          walrusReasoningBlobId: walrusBlobId,
        },
      };
      const updated = [...prior, entry];
      await saveJournal(spec.policyId ?? null, updated);
      journalEntries = updated.length;
      const journalMd = journalMarkdown({
        traderName: spec.traderName ?? null,
        strategy: recordDecision.strategy,
        entries: updated,
        policyId: spec.policyId ?? null,
      });
      const uploaded = await uploadToWalrus(
        new TextEncoder().encode(journalMd),
        ctx.client,
        ctx.keypair,
      );
      journalBlobId = uploaded.blobId;
      console.log(
        `[trader] walrus journal blob=${journalBlobId} entries=${journalEntries} (${uploaded.uploadMs}ms)`,
      );
      emitAgentEvent("walrus_uploaded", {
        policyId: spec.policyId ?? null,
        taskId: notice.taskId,
        asset: "BTC",
        data: { kind: "journal", blob_id: journalBlobId, entries: journalEntries, upload_ms: uploaded.uploadMs },
      });
    } catch (e) {
      console.warn("[trader] walrus journal upload failed:", e);
    }

    // First task for this policy → publish the operator's manifesto to
    // Walrus (idempotent via the per-policy flag; never blocks the task).
    await publishManifestoOnce(ctx, spec, strategyId, "BTC", notice.taskId);
  } else if (walrusEnabled()) {
    console.log(
      "[trader] walrus enabled but wallet has no WAL — inline only",
    );
  }

  // Compose the deliverable AFTER the blob ids are known so they're
  // captured in the on-chain JSON the dashboard reads.
  const deliverable = composeDeliverable({
    notice,
    spec,
    market,
    decision: recordDecision,
    mode,
    costDusdcBase,
    mintTxDigest: mintDigest,
    walrusBlobId,
    reasonIfSimulated: simReason,
    journalWalrusBlobId: journalBlobId,
    journalEntries,
    managerId,
    policyId: spec.policyId ?? null,
    venue,
    agentAddress: ctx.address,
  });

  // ---- 6) Mint deliverable + submit task (atomic) -----
  // The deliverable JSON is small (~1 KB) so we ALWAYS inline it on chain.
  // The reasoning + journal markdown blobs live on Walrus and are linked
  // from inside the JSON's `execution.*` — the dashboard reads those
  // directly off the parsed body to render the prominent memory panel.
  //
  // The on-chain `walrus_blob_id` field prefers the journal blob so
  // anyone inspecting the Deliverable on Suiscan jumps straight to the
  // cumulative running memory; falls back to the reasoning blob if the
  // journal upload failed.
  const inlinePayload = new TextEncoder().encode(JSON.stringify(deliverable));
  const onChainWalrusBlobId = journalBlobId ?? walrusBlobId;

  function buildTraderDeliverTx(): Transaction {
    const tx = new Transaction();
    appendMintAndSubmit(tx, ctx, {
      taskId: notice.taskId,
      deliverableOwner: notice.poster,
      schemaVersion: SCHEMA_VERSION,
      inlinePayload,
      walrusBlobId: onChainWalrusBlobId,
      paymentAmount: 0n,
    });
    return tx;
  }
  const submitRes = await signAndExecuteWithRetry(
    ctx,
    buildTraderDeliverTx,
    { showEffects: true },
    {
      label: "trader:submit",
      attempts: 3,
      alreadyDone: async () => {
        try {
          const cur = await fetchTask(ctx, notice.taskId);
          if (
            (cur.status === "delivered" || cur.status === "approved") &&
            cur.deliverableId
          ) {
            return "done";
          }
        } catch {
          /* fall through */
        }
        return null;
      },
    },
  );
  if (submitRes.effects?.status?.status !== "success") {
    throw new Error(
      `delivery PTB failed: ${submitRes.effects?.status?.error ?? "unknown"}`,
    );
  }
  console.log(
    `[trader] delivered. tx=${submitRes.digest} mode=${mode}` +
      (mintDigest ? ` mint=${mintDigest}` : "") +
      (walrusBlobId ? ` walrus=${walrusBlobId}` : ""),
  );
  emitAgentEvent("delivered", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset: "BTC",
    data: { tx: submitRes.digest, mode },
  });
}

// === Spot task handler — DeepBook v3 directional bet over a horizon ===
//
// Mirrors the BTC handler's lifecycle: pick direction from strategy,
// build the atomic policy-gated open PTB (record_spend + market order),
// persist to a durable cursor, then emit the same TraderDeliverable
// shape with the asset name in `market.underlying`. The auto-close
// service below scans the cursor and closes each position when its
// horizon elapses.
// Close a spot task HONESTLY when every DeepBook pool is unreadable —
// delivers a simulated deliverable whose reason_if_simulated names the
// infra failure, so the task completes (not stranded in `accepted`) and
// the UI can show "infra hiccup — dispatch again" instead of a silent
// hang. Reuses the same inline-deliverable + appendMintAndSubmit path
// as a normal spot delivery.
async function deliverSpotInfraFailure(
  ctx: AgentContext,
  notice: TaskPostedNotice,
  spec: TraderSpec,
  strategyId: StrategyId,
  balanceManagerId: string,
  asset: "SUI" | "WAL" | "DEEP",
  reason: string,
): Promise<void> {
  const simReason =
    `Infra: every DeepBook spot pool was unreadable this cycle ` +
    `(${asset} last: ${reason}). Task closed honestly as simulated — ` +
    `no bet placed. Dispatch again to retry.`;
  const deliverable: TraderDeliverable = {
    task_title: notice.title,
    primary_capability: notice.primaryCapability,
    spec_context: spec.context ?? "(no context provided in spec)",
    strategy: strategyId,
    market: {
      oracle_id: "",
      underlying: asset,
      expiry_ms: Date.now() + SPOT_HORIZON_MS,
      strike: 0,
      tick_size: 0,
      spot_at_decision: 0,
    },
    decision: {
      direction: "up",
      quantity: 0,
      cost_dusdc_base: 0,
      reasoning: simReason,
    },
    execution: {
      mode: "simulated",
      mint_tx_digest: null,
      walrus_blob_id: null,
      reason_if_simulated: simReason,
      journal_walrus_blob_id: null,
      journal_entries: 0,
    },
    metadata: {
      produced_by: ctx.address,
      produced_at_ms: Date.now(),
      schema_version: Number(SCHEMA_VERSION),
      manager_id: balanceManagerId,
      policy_id: spec.policyId ?? null,
      venue: `spot-${asset.toLowerCase()}`,
    },
  };
  const inlinePayload = new TextEncoder().encode(JSON.stringify(deliverable));
  const submitRes = await signAndExecuteWithRetry(
    ctx,
    () => {
      const tx = new Transaction();
      appendMintAndSubmit(tx, ctx, {
        taskId: notice.taskId,
        deliverableOwner: notice.poster,
        schemaVersion: SCHEMA_VERSION,
        inlinePayload,
        walrusBlobId: null,
        paymentAmount: 0n,
      });
      return tx;
    },
    { showEffects: true },
    {
      label: "trader-spot:fail-deliver",
      attempts: 3,
      alreadyDone: async () => {
        try {
          const cur = await fetchTask(ctx, notice.taskId);
          if (
            (cur.status === "delivered" || cur.status === "approved") &&
            cur.deliverableId
          ) {
            return "done";
          }
        } catch {
          /* fall through */
        }
        return null;
      },
    },
  );
  if (submitRes.effects?.status?.status !== "success") {
    throw new Error(
      `spot infra-failure delivery PTB failed: ${submitRes.effects?.status?.error ?? "unknown"}`,
    );
  }
  console.log(
    `[trader-spot] infra-failure honest delivery tx=${submitRes.digest} asset=${asset}`,
  );
  emitAgentEvent("delivered", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset,
    data: { tx: submitRes.digest, mode: "simulated" },
  });
}

async function handleSpotTask(
  ctx: AgentContext,
  asset: "SUI" | "WAL" | "DEEP",
  _t: Awaited<ReturnType<typeof fetchTask>>,
  notice: TaskPostedNotice,
  spec: TraderSpec,
): Promise<void> {
  const strategyId = spec.strategy ?? DEFAULT_STRATEGY;
  const balanceManagerId = (
    process.env.BRIEF_BALANCE_MANAGER_ID ?? ""
  ).trim();
  if (!balanceManagerId) {
    throw new Error(
      "spot path: BRIEF_BALANCE_MANAGER_ID not set; cannot route SUI/WAL/DEEP bets",
    );
  }

  // Resolve a WORKING (asset, market, mid) — testnet DeepBook pools
  // (WAL especially) often return nothing from readSpotMid, which used
  // to throw and strand the task in `accepted` forever. Instead we try
  // the chosen asset first, then fall back across [SUI, DEEP, WAL]
  // (SUI = most liquid). Each hop emits "asset_fallback"; if every pool
  // is dark we close the task HONESTLY as simulated rather than hang.
  const FALLBACK_ORDER: Array<"SUI" | "WAL" | "DEEP"> = ["SUI", "DEEP", "WAL"];
  const candidates = [asset, ...FALLBACK_ORDER.filter((a) => a !== asset)];
  let market = getMarket(asset);
  let midUsd = NaN;
  let resolved = false;
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]!;
    const m = getMarket(cand);
    try {
      midUsd = await readSpotMid(ctx, m);
      asset = cand;
      market = m;
      resolved = true;
      break;
    } catch (e) {
      const reason = String((e as Error)?.message ?? e).slice(0, 120);
      console.warn(`[trader-spot] ${cand} pool read failed: ${reason}`);
      const next = candidates[i + 1];
      if (next) {
        emitAgentEvent("asset_fallback", {
          policyId: spec.policyId ?? null,
          taskId: notice.taskId,
          asset: cand,
          data: { from: cand, to: next, reason },
        });
      } else {
        // Every spot pool is unreadable — close the task honestly.
        emitAgentEvent("task_failed", {
          policyId: spec.policyId ?? null,
          taskId: notice.taskId,
          asset: cand,
          data: { error: `all spot pools unavailable — last: ${reason}` },
        });
        await deliverSpotInfraFailure(
          ctx,
          notice,
          spec,
          strategyId,
          balanceManagerId,
          asset,
          reason,
        );
        return;
      }
    }
  }
  if (!resolved) return; // unreachable — the loop either resolves or returns

  // Observe spot mid and append to rolling history BEFORE deciding —
  // every spot bet uses the same signal-based strategy logic the BTC
  // path does. Spot pools have no SVI surface, so the quant strategy
  // falls back to momentum here (and conservative/contrarian rely on
  // SMA + RSI exactly as on BTC).
  await appendPoint(asset, { ts: Date.now(), price: midUsd });
  const history = await loadHistory(asset);
  const signals = computeSignals(history, Date.now());
  emitAgentEvent("observe", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset,
    data: { spot_usd: midUsd, oracle_id: market.spotPoolId ?? null },
  });
  emitAgentEvent("signals", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset,
    data: { signals },
  });

  const baseQty = market.minOrderQty ?? 1;

  // Goal-calibrated params threaded for consistency. Spot has no SVI
  // surface (so minEdge is moot) and uses a fixed min-order size (maxQty
  // moot), so calibration is effectively a BTC-Predict feature — spot
  // behaviour is unchanged.
  const params = calibrateParams(strategyId, spec.goal);
  const candidateDecision = decide(strategyId, {
    asset,
    spotUsd: midUsd,
    signals,
    recentSettled: [],
    market: {
      strikeUsd: midUsd,
      expiryMs: Date.now() + SPOT_HORIZON_MS,
    },
    surface: null,
    params,
    nowMs: Date.now(),
  });

  // Spot positions use the pool's minimum order size — conviction
  // doesn't change quantity for SUI/WAL/DEEP. (Going bigger would need
  // multiple market orders; we keep this disciplined.)
  const direction: "up" | "down" =
    candidateDecision?.direction ?? (strategyId === "contrarian" ? "down" : "up");
  const conviction = candidateDecision?.conviction ?? 0;
  const notionalUsd = baseQty * midUsd;
  const reasoning =
    candidateDecision?.reasoning ??
    abstentionReason(strategyId, signals, asset, midUsd, params);
  console.log(
    `[trader-spot] asset=${asset} strategy=${strategyId} direction=${direction} conv=${conviction.toFixed(2)} qty=${baseQty} mid=$${midUsd.toFixed(4)} notional=$${notionalUsd.toFixed(4)}` +
      (candidateDecision ? "" : " (no-edge abstention)"),
  );
  console.log(`[trader-spot] reasoning: ${reasoning}`);
  emitAgentEvent("decision", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset,
    data: {
      strategy: strategyId,
      decided: !!candidateDecision,
      direction,
      quantity: baseQty,
      conviction,
      reasoning,
      spot_usd: midUsd,
      market_p: null,
    },
  });

  // Pre-flight: consolidate SUI coins. Same fix that protects Walrus
  // applies to DeepBook PTBs — both auto-pick gas and abort at
  // `balance::split` if the picked coin is too small.
  try {
    const c = await consolidateSuiCoins(ctx.client, ctx.keypair);
    if (c.merged) {
      console.log(
        `[trader-spot] consolidated ${c.coinsBefore} SUI → 1 (${(Number(c.balance) / 1e9).toFixed(4)} SUI) tx=${c.digest}`,
      );
    }
  } catch (e) {
    console.warn(
      "[trader-spot] coin consolidation skipped:",
      String((e as Error)?.message ?? e).slice(0, 120),
    );
  }

  // Decide mode (live vs simulated) — spot has no manager-balance gate
  // (the BM is funded once at setup), so we only need the policy gate.
  const hasGate = !!spec.policyId;
  let mode: ExecutionMode = hasGate ? "live" : "simulated";
  let openDigest: string | null = null;
  let openQuoteBase: bigint = 0n;
  let simReason: string | null = null;
  if (!hasGate) {
    simReason = `No policy_id in task spec — live spot bets must be gated by an OperatorPolicy with venue "spot-${asset.toLowerCase()}".`;
  }
  emitAgentEvent("mode", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset,
    data: { mode, sim_reason: simReason },
  });

  // ---- LIVE: open the position via the proven openSpot helper -----
  if (mode === "live" && spec.policyId) {
    emitAgentEvent("mint_pending", {
      policyId: spec.policyId ?? null,
      taskId: notice.taskId,
      asset,
      data: { direction, quantity: baseQty },
    });
    try {
      const open = await openSpot({
        ctx,
        market,
        direction,
        briefPackage: ctx.packageId,
        policyId: spec.policyId,
        balanceManagerId,
      });
      openDigest = open.digest;
      openQuoteBase = open.quoteBase;
      console.log(
        `[trader-spot] LIVE open ok tx=${openDigest} quoteBase=${openQuoteBase}`,
      );
      emitAgentEvent("spot_opened", {
        policyId: spec.policyId ?? null,
        taskId: notice.taskId,
        asset,
        data: { tx: openDigest, direction, base_qty: baseQty },
      });
      const positionId = `${asset.toLowerCase()}-${notice.taskId.slice(2, 14)}`;
      await appendSpotPosition({
        id: positionId,
        taskId: notice.taskId,
        traderName: spec.traderName ?? null,
        asset,
        poolKey: market.spotPoolKey!,
        direction,
        baseQty,
        openQuoteBase: openQuoteBase.toString(),
        openTxDigest: openDigest,
        policyId: spec.policyId,
        openedAtMs: Date.now(),
        closeAtMs: Date.now() + SPOT_HORIZON_MS,
        strategy: strategyId,
        status: "open",
      });
    } catch (e) {
      mode = "simulated";
      simReason = `Live spot open failed: ${(e as Error).message.slice(0, 160)}`;
      console.warn(`[trader-spot] live open failed, falling back to simulated:`, e);
      emitAgentEvent("mint_failed", {
        policyId: spec.policyId ?? null,
        taskId: notice.taskId,
        asset,
        data: { error: (e as Error).message.slice(0, 160) },
      });
    }
  }

  // ---- Walrus uploads (per-decision reasoning + cumulative journal)
  let walrusBlobId: string | null = null;
  let journalBlobId: string | null = null;
  let journalEntries = 0;
  const walFunded = walrusEnabled()
    ? await hasWalrusFunding(ctx.client, ctx.address)
    : false;
  if (walFunded) {
    try {
      const md = reasoningMarkdown({
        decision: {
          strategy: strategyId,
          direction,
          quantity: baseQty,
          conviction,
          reasoning,
        },
        signals,
        market: {
          oracle: {
            oracle_id: market.spotPoolId!,
            underlying_asset: asset,
            expiry: Date.now() + SPOT_HORIZON_MS,
            min_strike: 0,
            tick_size: 0,
          } as IndexerOracle,
          spotRaw: BigInt(Math.floor(midUsd * 1e9)),
          strikeRaw: BigInt(Math.floor(midUsd * 1e9)),
        },
        mode,
        mintTxDigest: openDigest,
      });
      const uploaded = await uploadToWalrus(
        new TextEncoder().encode(md),
        ctx.client,
        ctx.keypair,
      );
      walrusBlobId = uploaded.blobId;
      console.log(
        `[trader-spot] walrus reasoning blob=${walrusBlobId} (${uploaded.uploadMs}ms)`,
      );
      emitAgentEvent("walrus_uploaded", {
        policyId: spec.policyId ?? null,
        taskId: notice.taskId,
        asset,
        data: { kind: "reasoning", blob_id: walrusBlobId, upload_ms: uploaded.uploadMs },
      });
    } catch (e) {
      console.warn("[trader-spot] walrus reasoning upload failed:", e);
    }
    try {
      const prior = await loadJournal(spec.policyId ?? null);
      const entry: JournalEntry = {
        taskId: notice.taskId,
        traderName: spec.traderName ?? null,
        strategy: strategyId,
        decidedAtMs: Date.now(),
        market: {
          oracleId: market.spotPoolId!,
          expiryMs: Date.now() + SPOT_HORIZON_MS,
          strike: Math.floor(midUsd * 1e9),
          spotAtDecision: Math.floor(midUsd * 1e9),
        },
        decision: { direction, quantity: baseQty, reasoning },
        execution: {
          mode,
          mintTxDigest: openDigest,
          walrusReasoningBlobId: walrusBlobId,
        },
      };
      const updated = [...prior, entry];
      await saveJournal(spec.policyId ?? null, updated);
      journalEntries = updated.length;
      const journalMd = journalMarkdown({
        traderName: spec.traderName ?? null,
        strategy: strategyId,
        entries: updated,
        policyId: spec.policyId ?? null,
      });
      const uploaded = await uploadToWalrus(
        new TextEncoder().encode(journalMd),
        ctx.client,
        ctx.keypair,
      );
      journalBlobId = uploaded.blobId;
      console.log(
        `[trader-spot] walrus journal blob=${journalBlobId} entries=${journalEntries} (${uploaded.uploadMs}ms)`,
      );
      emitAgentEvent("walrus_uploaded", {
        policyId: spec.policyId ?? null,
        taskId: notice.taskId,
        asset,
        data: { kind: "journal", blob_id: journalBlobId, entries: journalEntries, upload_ms: uploaded.uploadMs },
      });
    } catch (e) {
      console.warn("[trader-spot] walrus journal upload failed:", e);
    }

    // First task for this policy → publish the operator's manifesto.
    await publishManifestoOnce(ctx, spec, strategyId, asset, notice.taskId);
  }

  // ---- Compose + submit deliverable -----
  const deliverable: TraderDeliverable = {
    task_title: notice.title,
    primary_capability: notice.primaryCapability,
    spec_context: spec.context ?? "(no context provided in spec)",
    strategy: strategyId,
    market: {
      oracle_id: market.spotPoolId!,
      underlying: asset,
      expiry_ms: Date.now() + SPOT_HORIZON_MS,
      strike: Math.floor(midUsd * 1e9),
      tick_size: 0,
      spot_at_decision: Math.floor(midUsd * 1e9),
    },
    decision: {
      direction,
      quantity: baseQty,
      cost_dusdc_base: Math.floor(notionalUsd * 1e6),
      reasoning,
    },
    execution: {
      mode,
      mint_tx_digest: openDigest,
      walrus_blob_id: walrusBlobId,
      reason_if_simulated: simReason,
      journal_walrus_blob_id: journalBlobId,
      journal_entries: journalEntries,
    },
    metadata: {
      produced_by: ctx.address,
      produced_at_ms: Date.now(),
      schema_version: Number(SCHEMA_VERSION),
      manager_id: balanceManagerId,
      policy_id: spec.policyId ?? null,
      venue: `spot-${asset.toLowerCase()}`,
    },
  };
  const inlinePayload = new TextEncoder().encode(JSON.stringify(deliverable));
  const onChainWalrusBlobId = journalBlobId ?? walrusBlobId;

  function buildSpotDeliverTx(): Transaction {
    const tx = new Transaction();
    appendMintAndSubmit(tx, ctx, {
      taskId: notice.taskId,
      deliverableOwner: notice.poster,
      schemaVersion: SCHEMA_VERSION,
      inlinePayload,
      walrusBlobId: onChainWalrusBlobId,
      paymentAmount: 0n,
    });
    return tx;
  }
  const submitRes = await signAndExecuteWithRetry(
    ctx,
    buildSpotDeliverTx,
    { showEffects: true },
    {
      label: "trader-spot:submit",
      attempts: 3,
      alreadyDone: async () => {
        try {
          const cur = await fetchTask(ctx, notice.taskId);
          if (
            (cur.status === "delivered" || cur.status === "approved") &&
            cur.deliverableId
          ) {
            return "done";
          }
        } catch {
          /* fall through */
        }
        return null;
      },
    },
  );
  if (submitRes.effects?.status?.status !== "success") {
    throw new Error(
      `spot delivery PTB failed: ${submitRes.effects?.status?.error ?? "unknown"}`,
    );
  }
  console.log(
    `[trader-spot] delivered tx=${submitRes.digest} mode=${mode}` +
      (openDigest ? ` open=${openDigest}` : "") +
      (walrusBlobId ? ` walrus=${walrusBlobId}` : ""),
  );
  emitAgentEvent("delivered", {
    policyId: spec.policyId ?? null,
    taskId: notice.taskId,
    asset,
    data: { tx: submitRes.digest, mode },
  });
}

// === Auto-close spot loop — closes positions when their horizon elapses ===
//
// Idempotent: a position that's already past status="closed" is skipped.
// On a tx failure we leave the position in status="open" so the next
// tick retries. Closes have no policy gate, so even after revoke this
// loop continues to settle whatever's on the book — mirrors the
// "past wins still pay out" guarantee from the BTC redeem path.
async function autoCloseSpotTick(ctx: AgentContext): Promise<void> {
  const due = await dueSpotPositions(Date.now());
  if (due.length === 0) return;
  const balanceManagerId = (
    process.env.BRIEF_BALANCE_MANAGER_ID ?? ""
  ).trim();
  if (!balanceManagerId) return;
  // Consolidate the trader's SUI coins before close attempts — gas
  // fragmentation here causes the same balance::split aborts that hit
  // Walrus uploads in the BTC path.
  try {
    const c = await consolidateSuiCoins(ctx.client, ctx.keypair);
    if (c.merged) {
      console.log(
        `[trader-spot-close] consolidated ${c.coinsBefore} SUI → 1 (${(Number(c.balance) / 1e9).toFixed(4)} SUI) tx=${c.digest}`,
      );
    }
  } catch (e) {
    console.warn(
      "[trader-spot-close] coin consolidation skipped:",
      String((e as Error)?.message ?? e).slice(0, 120),
    );
  }
  for (const p of due) {
    try {
      const market = getMarket(p.asset);
      console.log(
        `[trader-spot-close] ${p.asset} ${p.direction} qty=${p.baseQty} task=${p.taskId.slice(0, 12)}… — closing`,
      );
      const r = await closeSpot({
        ctx,
        market,
        originalDirection: p.direction,
        baseQty: p.baseQty,
        openQuoteBase: BigInt(p.openQuoteBase),
        balanceManagerId,
      });
      await markSpotPositionClosed(p.id, {
        closeTxDigest: r.digest,
        closeQuoteBase: r.closeQuoteBase,
        realizedPnlBase: r.realizedPnlBase,
      });
      const pnlUsd = Number(r.realizedPnlBase) / 1e6;
      console.log(
        `[trader-spot-close] closed ${p.asset} task=${p.taskId.slice(0, 12)}… tx=${r.digest} pnl=${pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(6)} DBUSDC`,
      );
    } catch (e) {
      console.warn(
        `[trader-spot-close] close error ${p.asset} task=${p.taskId.slice(0, 12)}…:`,
        (e as Error).message,
      );
      // Leave position open; next tick will retry.
    }
  }
}

function startAutoCloseSpotLoop(ctx: AgentContext): void {
  console.log(
    `[trader-spot-close] open · poll=${SPOT_CLOSE_POLL_MS}ms horizon=${SPOT_HORIZON_MS}ms`,
  );
  void (async () => {
    while (true) {
      try {
        await autoCloseSpotTick(ctx);
      } catch (e) {
        console.warn("[trader-spot-close] tick error:", (e as Error).message);
      }
      await new Promise((r) => setTimeout(r, SPOT_CLOSE_POLL_MS));
    }
  })();
}

// === Autonomous gated-spot loop — the operator that is actually ALIVE ===
//
// Unlike handleTask (inbox-driven, house BM, owner proof), this loop drives
// every ADOPTED non-custodial operator on its own. Each registered user has
// their OWN BalanceManager, a delegated TradeCap, and an OperatorPolicy.
// Every tick the operator observes SUI, runs its goal-calibrated strategy,
// and — ONLY on genuine edge — fires a policy-gated DeepBook market order
// from the user's BM via the delegated TradeCap (record_spend +
// place_market_order, atomic). It can trade; it can NEVER withdraw. The
// instant the user revokes, record_spend aborts EPolicyRevoked and this
// loop retires the operator (in-memory skip + durable registry flag).
//
// Honest by construction: most ticks abstain (capital preserved), and a BM
// that can't cover DeepBook's DEEP fee — or lacks the inventory for the
// chosen side — is skipped with a clear reason rather than firing a doomed
// tx. The whole cascade emits the SAME SSE events as handleSpotTask, so the
// existing operator dashboard renders the autonomous loop unchanged.

const OPERATOR_REGISTRY_PATH = ".cursors/operator-registry.json";
const GATED_LOOP_POLL_MS = 45_000;
// --- Fuel (DEEP for DeepBook fees; scalar = 1e6 on both networks) ---
// SUI/USDC isn't a whitelisted pool, so every order pays its fee in DEEP.
// The operator keeps a small DEEP "fuel tank" in the user's BM, topped up
// by the house via the delegated DepositCap. The user never thinks about
// DEEP — they deposit USDC, the operator trades USDC, fuel is handled.
/** Below this the BM can't reliably pay a fee → refuel before trading. */
const FUEL_FLOOR_BASE = 50_000n; // 0.05 DEEP
/** Below this we flag the tank amber ("low fuel") on the dashboard. */
const FUEL_LOW_BASE = 200_000n; // 0.2 DEEP
/** DEEP deposited per refuel (human units). "~$2 of DEEP" in the UI. */
const FUEL_TOPUP_DEEP = 2;
/** When a refuel fails (house DEEP reserve dry), back off this long before
 *  trying again — the reserve is shared across operators, so this is global. */
const FUEL_DRY_COOLDOWN_MS = 5 * 60_000;
/** Epoch ms until which the house DEEP reserve looked dry — skip top-ups. */
let houseFuelDryUntilMs = 0;

type FuelLevel = "ok" | "low" | "empty";
function fuelLevelOf(deepBase: bigint): FuelLevel {
  if (deepBase < FUEL_FLOOR_BASE) return "empty";
  if (deepBase < FUEL_LOW_BASE) return "low";
  return "ok";
}

/** Base order size. Both testnet SUI/DBUSDC and mainnet SUI/USDC have
 *  minSize 1 SUI / lotSize 0.1; we trade exactly one min-lot per edge —
 *  disciplined, with the policy's budget cap as the real ceiling. */
const GATED_BASE_QTY = 1;
/** Venue label record_spend asserts against — must be in the policy's
 *  allowed_venues (the adoption PTB grants "spot-sui"). */
const GATED_VENUE = "spot-sui";

/** Operators retired this process (revoked/expired/budget/venue) — never
 *  retried until restart (and the registry flag makes it durable). */
const gatedSkip = new Set<string>();
/** Mainnet operators we've already logged as "awaiting publish" once. */
const loggedMainnetSkip = new Set<string>();

type OperatorRegistryEntry = {
  policyId: string;
  bmId: string;
  tradeCapId: string;
  /** Delegated DepositCap — lets the operator top up its DEEP fuel tank
   *  (deposit-not-withdraw). Null for pre-fuel adoptions. */
  depositCapId?: string | null;
  owner: string;
  personality: StrategyId;
  /** The Brief Operator mode (Protect/Grow/Aggressive). Absent → derived
   *  from the legacy goal so existing operators keep working. */
  mode?: string;
  goal?: OperatorGoal;
  network: GatedNetwork;
  revoked: boolean;
  adoptedAtMs: number;
};

async function loadOperatorRegistry(): Promise<OperatorRegistryEntry[]> {
  try {
    const raw = await fs.readFile(OPERATOR_REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OperatorRegistryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Flip an operator's `revoked` flag in the registry so a killed/expired
 *  operator stays retired across trader restarts. Best-effort. */
async function markOperatorRevokedInRegistry(policyId: string): Promise<void> {
  try {
    const list = await loadOperatorRegistry();
    let changed = false;
    for (const e of list) {
      if (e.policyId === policyId && !e.revoked) {
        e.revoked = true;
        changed = true;
      }
    }
    if (changed) {
      await fs.writeFile(OPERATOR_REGISTRY_PATH, JSON.stringify(list, null, 2));
    }
  } catch {
    /* best-effort */
  }
}

/** Normalize a registry goal blob into a strategy OperatorGoal. */
function registryGoal(g: OperatorRegistryEntry["goal"]): OperatorGoal {
  if (g && (g.type === "grow" || g.type === "preserve")) return g;
  return { type: "edge" };
}

/** Stable per-operator event-stream id so the dashboard groups all of one
 *  operator's heartbeats under a single evolving "Now" cascade. */
function gatedTaskId(e: OperatorRegistryEntry): string {
  return `gated-${e.policyId.slice(2, 14)}`;
}

/** True iff an error from the gated PTB is a TERMINAL operator_policy abort
 *  (revoked / expired / budget / venue / not-agent) → retire the operator.
 *  Transient RPC errors are already retried inside signAndExecuteWithRetry,
 *  so a Move abort in OUR policy module that surfaces here is terminal. */
function isTerminalPolicyAbort(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err);
  return /MoveAbort/i.test(m) && /operator_policy/i.test(m);
}

/** Best-effort: append this trade to the operator's Walrus memory journal
 *  and publish its manifesto once. Never blocks the trade; never throws. */
async function recordGatedMemory(
  ctx: AgentContext,
  e: OperatorRegistryEntry,
  strategy: StrategyId,
  goal: OperatorGoal,
  direction: Direction,
  midUsd: number,
  reasoning: string,
  digest: string,
  taskId: string,
): Promise<void> {
  const walFunded = walrusEnabled()
    ? await hasWalrusFunding(ctx.client, ctx.address)
    : false;
  if (!walFunded) return;
  const prior = await loadJournal(e.policyId);
  const entry: JournalEntry = {
    taskId,
    traderName: null,
    strategy,
    decidedAtMs: Date.now(),
    market: {
      oracleId: "",
      expiryMs: Date.now() + SPOT_HORIZON_MS,
      strike: Math.floor(midUsd * 1e9),
      spotAtDecision: Math.floor(midUsd * 1e9),
    },
    decision: { direction, quantity: GATED_BASE_QTY, reasoning },
    execution: { mode: "live", mintTxDigest: digest, walrusReasoningBlobId: null },
  };
  const updated = [...prior, entry];
  await saveJournal(e.policyId, updated);
  const md = journalMarkdown({
    traderName: null,
    strategy,
    entries: updated,
    policyId: e.policyId,
  });
  try {
    const up = await uploadToWalrus(
      new TextEncoder().encode(md),
      ctx.client,
      ctx.keypair,
    );
    emitAgentEvent("walrus_uploaded", {
      policyId: e.policyId,
      taskId,
      asset: "SUI",
      data: {
        kind: "journal",
        blob_id: up.blobId,
        entries: updated.length,
        upload_ms: up.uploadMs,
      },
    });
  } catch {
    /* journal upload best-effort */
  }
  // Manifesto (idempotent per policy). Reuse the same publisher as the
  // task path via a minimal synthetic spec.
  await publishManifestoOnce(
    ctx,
    { policyId: e.policyId, traderName: undefined, goal, strategy, markets: "sui_ecosystem" },
    strategy,
    "SUI",
    taskId,
  );
}

/** Read the policy's budget utilization (0–100) — feeds the risk review. */
/** The policy's budget in base units (6dp DBUSDC/USDC for spot), plus the
 *  used %. `remaining` lets the loop pre-check headroom and abstain GRACEFULLY
 *  at the cap instead of attempting a doomed record_spend that aborts and
 *  retires the operator. cap=0 means "unreadable" → caller should not gate on it. */
async function readPolicyBudget(
  ctx: AgentContext,
  policyId: string,
): Promise<{ pct: number; cap: number; spent: number; remaining: number }> {
  try {
    const o = await ctx.client.getObject({
      id: policyId,
      options: { showContent: true },
    });
    const f = (o.data?.content as { fields?: Record<string, unknown> })?.fields;
    const cap = Number(f?.budget_cap ?? 0);
    const spent = Number(f?.spent ?? 0);
    const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
    return { pct, cap, spent, remaining: Math.max(0, cap - spent) };
  } catch {
    return { pct: 0, cap: 0, spent: 0, remaining: 0 };
  }
}

/** Run one autonomous decision cycle for a single adopted operator. May
 *  place exactly one gated order (on edge + funded) or abstain. Throws on a
 *  terminal policy abort so the caller can retire the operator. */
async function runGatedOperator(
  ctx: AgentContext,
  e: OperatorRegistryEntry,
  midUsd: number,
  signals: SignalBundle,
): Promise<void> {
  // Legacy label kept for the journal/manifesto; the decision is the unified
  // operator engine below, calibrated by the operator's mode.
  const strategy: StrategyId = STRATEGIES[e.personality]
    ? e.personality
    : DEFAULT_STRATEGY;
  const goal = registryGoal(e.goal);
  const mode = e.mode ? normalizeMode(e.mode) : modeFromGoal(e.goal?.type);
  const taskId = gatedTaskId(e);

  emitAgentEvent("observe", {
    policyId: e.policyId,
    taskId,
    asset: "SUI",
    data: { spot_usd: midUsd, oracle_id: null },
  });
  emitAgentEvent("signals", {
    policyId: e.policyId,
    taskId,
    asset: "SUI",
    data: { signals },
  });

  // The Brief Operator's decision engine — ONE operator, mode-calibrated, a
  // transparent 7-step pipeline over the real signals (Observe → Thesis →
  // Counterargument → Risk → Policy → Execution → Decision). AI reasoning,
  // memory replay and DeepBook execution analysis fold in via opts in later
  // phases; the Move policy gates execution regardless.
  const budget = await readPolicyBudget(ctx, e.policyId);
  const eng = runDecisionEngine({
    asset: "SUI",
    signals,
    spotUsd: midUsd,
    mode,
    budgetUsedPct: budget.pct,
  });
  const direction: Direction = eng.direction;
  const reasoning = `${eng.thesis} ${eng.counterargument} → ${eng.verdict}`;

  emitAgentEvent("decision", {
    policyId: e.policyId,
    taskId,
    asset: "SUI",
    data: {
      strategy: mode,
      decided: eng.act,
      direction,
      quantity: eng.act ? GATED_BASE_QTY : 0,
      conviction: eng.confidence,
      reasoning,
      spot_usd: midUsd,
      market_p: null,
      // the visible decision-engine pipeline
      mode,
      thesis: eng.thesis,
      counterargument: eng.counterargument,
      risk_review: eng.riskReview,
      policy_review: eng.policyReview,
      execution_review: eng.executionReview,
      verdict: eng.verdict,
      ai_reasoned: eng.aiReasoned,
    },
  });

  // Abstained — capital preserved, no trade. A first-class outcome (the
  // dashboard frames it as a win, not an absence).
  if (!eng.act) {
    emitAgentEvent("mode", {
      policyId: e.policyId,
      taskId,
      asset: "SUI",
      data: { mode: "simulated", sim_reason: eng.verdict },
    });
    return;
  }

  // Decision to act — verify the BM can actually execute before firing.
  const coins = gatedCoinTypes(e.network);
  const isBid = direction === "up";

  // record_spend amount (quote, 6dp): one min-lot of SUI at the current mid.
  const recordSpendAmount = BigInt(
    Math.max(1, Math.floor(GATED_BASE_QTY * midUsd * 1e6)),
  );

  // ---- BUDGET HEADROOM: stay alive at the cap ---------------------------
  // Hitting the budget cap is a NORMAL end-state, not a failure. If the next
  // order wouldn't fit, abstain gracefully (capital fully deployed) — never
  // attempt a doomed record_spend that aborts EBudgetExceeded and retires the
  // operator. (The on-chain refusal proof comes from the REVOKE kill switch.)
  if (budget.cap > 0 && Number(recordSpendAmount) > budget.remaining) {
    const r = `Operator leaned ${direction.toUpperCase()} but its budget is fully deployed — ${(
      budget.spent / 1e6
    ).toFixed(2)} of ${(budget.cap / 1e6).toFixed(
      2,
    )} spent, less than one min-lot left. No trade; the leash held. Top up the budget to let it keep working.`;
    emitAgentEvent("mode", {
      policyId: e.policyId,
      taskId,
      asset: "SUI",
      data: { mode: "simulated", sim_reason: r },
    });
    console.log(
      `[trader-gated] ${e.policyId.slice(0, 10)}… ${direction} budget fully deployed — abstain (alive)`,
    );
    return;
  }

  // ---- FUEL: the operator's DEEP tank pays DeepBook fees -----------------
  // SUI/USDC isn't whitelisted, so each order needs DEEP. If the tank is
  // empty, the house tops it up via the delegated DepositCap (deposit-not-
  // withdraw). If it can't (no DepositCap, or the house reserve is dry), the
  // operator idles with an amber "awaiting fuel" — alive, capital untouched.
  let deepBal = await readBmAssetBalance(ctx, e.bmId, coins.deep);
  if (deepBal < FUEL_FLOOR_BASE && e.depositCapId && Date.now() >= houseFuelDryUntilMs) {
    try {
      const fres = await signAndExecuteWithRetry(
        ctx,
        () =>
          buildFuelDepositTx(ctx, {
            network: e.network,
            bmId: e.bmId,
            tradeCapId: e.tradeCapId,
            depositCapId: e.depositCapId!,
            deepHumanQty: FUEL_TOPUP_DEEP,
          }),
        { showEffects: true },
        { label: "trader-gated:fuel", attempts: 2 },
      );
      if (fres.effects?.status?.status !== "success") {
        throw new Error(fres.effects?.status?.error ?? "fuel deposit failed");
      }
      deepBal = BigInt(Math.floor(FUEL_TOPUP_DEEP * 1e6)); // topped up
      console.log(
        `[trader-gated] fueled ${e.policyId.slice(0, 10)}… +${FUEL_TOPUP_DEEP} DEEP tx=${fres.digest}`,
      );
    } catch (err) {
      // The shared house reserve looks dry — back off for all operators.
      houseFuelDryUntilMs = Date.now() + FUEL_DRY_COOLDOWN_MS;
      console.warn(
        `[trader-gated] fuel top-up failed (house DEEP reserve dry?) for ${e.policyId.slice(0, 10)}…:`,
        String((err as Error)?.message ?? err).slice(0, 120),
      );
    }
  }
  // Always surface the current fuel level — drives the dashboard fuel gauge.
  emitAgentEvent("fuel", {
    policyId: e.policyId,
    taskId,
    asset: "SUI",
    data: {
      deep_base: Number(deepBal),
      deep_human: Number(deepBal) / 1e6,
      level: fuelLevelOf(deepBal),
    },
  });
  if (deepBal < FUEL_FLOOR_BASE) {
    const r = `The operator decided ${direction.toUpperCase()} SUI but is out of fuel — its DEEP tank (DeepBook fees) is empty${e.depositCapId ? " and the house reserve couldn't top it up" : " and it has no delegated DepositCap to refuel"}. Alive, awaiting fuel; capital untouched.`;
    emitAgentEvent("mode", {
      policyId: e.policyId,
      taskId,
      asset: "SUI",
      data: { mode: "simulated", sim_reason: r },
    });
    console.log(
      `[trader-gated] ${e.policyId.slice(0, 10)}… ${direction} but out of fuel — skip`,
    );
    return;
  }

  // Inventory guard: UP buys SUI with quote (USDC/DBUSDC); DOWN sells SUI
  // base. A freshly-adopted BM holds only quote, so it can buy but not yet
  // short — skip honestly instead of aborting on chain.
  const needType = isBid ? coins.quote : coins.base;
  const needAmount = isBid
    ? recordSpendAmount
    : BigInt(Math.floor(GATED_BASE_QTY * 1e9));
  const haveBal = await readBmAssetBalance(ctx, e.bmId, needType);
  if (haveBal < needAmount) {
    const sideAsset = isBid ? "USDC" : "SUI";
    const r = `Operator decided ${direction.toUpperCase()} SUI but the BalanceManager's ${sideAsset} inventory is insufficient for a 1-SUI ${isBid ? "buy" : "sell"} — no trade; capital untouched.`;
    emitAgentEvent("mode", {
      policyId: e.policyId,
      taskId,
      asset: "SUI",
      data: { mode: "simulated", sim_reason: r },
    });
    console.log(
      `[trader-gated] ${e.policyId.slice(0, 10)}… ${direction} insufficient ${sideAsset} inventory — skip`,
    );
    return;
  }

  // LIVE: the policy-gated DeepBook order from the user's own BM.
  emitAgentEvent("mode", {
    policyId: e.policyId,
    taskId,
    asset: "SUI",
    data: { mode: "live", sim_reason: null },
  });
  emitAgentEvent("mint_pending", {
    policyId: e.policyId,
    taskId,
    asset: "SUI",
    data: { direction, quantity: GATED_BASE_QTY },
  });
  const res = await signAndExecuteWithRetry(
    ctx,
    () =>
      buildGatedSpotTx(ctx, {
        network: e.network,
        briefPackage: ctx.packageId,
        policyId: e.policyId,
        bmId: e.bmId,
        tradeCapId: e.tradeCapId,
        venue: GATED_VENUE,
        recordSpendAmount,
        baseQty: GATED_BASE_QTY,
        isBid,
      }),
    { showEffects: true, showEvents: true },
    { label: "trader-gated:open", attempts: 2 },
  );
  if (res.effects?.status?.status !== "success") {
    throw new Error(res.effects?.status?.error ?? "gated open failed");
  }
  const digest = res.digest;
  console.log(
    `[trader-gated] LIVE ${strategy} ${direction} ${GATED_BASE_QTY} SUI op=${e.policyId.slice(0, 10)}… tx=${digest}`,
  );
  emitAgentEvent("spot_opened", {
    policyId: e.policyId,
    taskId,
    asset: "SUI",
    data: { tx: digest, direction, base_qty: GATED_BASE_QTY },
  });
  await recordGatedMemory(
    ctx,
    e,
    strategy,
    goal,
    direction,
    midUsd,
    reasoning,
    digest,
    taskId,
  ).catch(() => {});
  emitAgentEvent("delivered", {
    policyId: e.policyId,
    taskId,
    asset: "SUI",
    data: { tx: digest, mode: "live" },
  });
}

async function gatedSpotTick(ctx: AgentContext): Promise<void> {
  const registry = (await loadOperatorRegistry()).filter(
    (e) => !e.revoked && !gatedSkip.has(e.policyId),
  );
  if (registry.length === 0) return;

  // Mainnet operators wait for the mainnet trader context (set up after the
  // mainnet publish wires a mainnet client + package). Log once each.
  for (const e of registry.filter((x) => x.network === "mainnet")) {
    if (!loggedMainnetSkip.has(e.policyId)) {
      console.log(
        `[trader-gated] mainnet operator ${e.policyId.slice(0, 10)}… awaiting mainnet publish + context — skipping`,
      );
      loggedMainnetSkip.add(e.policyId);
    }
  }
  const testnetOps = registry.filter((e) => e.network === "testnet");
  if (testnetOps.length === 0) return;

  // Observe the SUI pool ONCE per tick (same mid for every testnet
  // operator); warm the rolling history; compute the shared signal bundle.
  let midUsd: number;
  try {
    midUsd = await readSpotMid(ctx, getMarket("SUI"));
  } catch (err) {
    console.warn(
      "[trader-gated] SUI mid read failed this tick:",
      String((err as Error)?.message ?? err).slice(0, 120),
    );
    return;
  }
  if (!Number.isFinite(midUsd) || midUsd <= 0) return;
  await appendPoint("SUI", { ts: Date.now(), price: midUsd });
  const history = await loadHistory("SUI");
  const signals = computeSignals(history, Date.now());

  // Consolidate the operator wallet's SUI once before signing across BMs —
  // many gated orders from one wallet fragment gas otherwise.
  try {
    const c = await consolidateSuiCoins(ctx.client, ctx.keypair);
    if (c.merged) {
      console.log(
        `[trader-gated] consolidated ${c.coinsBefore} SUI → 1 (${(Number(c.balance) / 1e9).toFixed(4)} SUI) tx=${c.digest}`,
      );
    }
  } catch (err) {
    console.warn(
      "[trader-gated] coin consolidation skipped:",
      String((err as Error)?.message ?? err).slice(0, 120),
    );
  }

  for (const e of testnetOps) {
    try {
      await runGatedOperator(ctx, e, midUsd, signals);
    } catch (err) {
      if (isTerminalPolicyAbort(err)) {
        gatedSkip.add(e.policyId);
        await markOperatorRevokedInRegistry(e.policyId);
        console.log(
          `[trader-gated] operator ${e.policyId.slice(0, 10)}… RETIRED (policy refused): ${String((err as Error)?.message ?? err).slice(0, 100)}`,
        );
        emitAgentEvent("mint_failed", {
          policyId: e.policyId,
          taskId: gatedTaskId(e),
          asset: "SUI",
          data: {
            error: "chain refused — operator retired (revoked / expired / budget reached)",
            terminal: true,
          },
        });
      } else {
        console.warn(
          `[trader-gated] operator ${e.policyId.slice(0, 10)}… tick error:`,
          String((err as Error)?.message ?? err).slice(0, 140),
        );
      }
    }
  }
}

function startGatedSpotLoop(ctx: AgentContext): void {
  console.log(
    `[trader-gated] open · poll=${GATED_LOOP_POLL_MS}ms (autonomous non-custodial operators via delegated TradeCap)`,
  );
  void (async () => {
    while (true) {
      try {
        await gatedSpotTick(ctx);
      } catch (e) {
        console.warn("[trader-gated] tick error:", (e as Error).message);
      }
      await new Promise((r) => setTimeout(r, GATED_LOOP_POLL_MS));
    }
  })();
}

// === Price history poller ===

/** Cadence for the rolling spot/mid observation loop. 60s keeps signal
 *  computation snappy without flooding the RPC; 600 points = ~10 h of
 *  rolling history. */
const PRICE_HISTORY_POLL_MS = 60_000;

async function priceHistoryTick(
  ctx: AgentContext,
  _managerId: string,
): Promise<void> {
  const nowMs = Date.now();
  // BTC — read the live spot from the nearest-expiry active oracle.
  try {
    const actives = await fetchActiveBtcOracles();
    const oracle = actives.find((o) => o.expiry - nowMs > 60_000);
    if (oracle) {
      const spotRaw = await readOracleSpot(ctx, oracle.oracle_id);
      const price = Number(spotRaw) / PRICE_SCALAR;
      await appendPoint("BTC", { ts: nowMs, price });
    }
  } catch (e) {
    console.warn(
      "[trader-prices] BTC observation failed:",
      String((e as Error)?.message ?? e).slice(0, 120),
    );
  }
  // Spot assets — read the live pool mid for each market in the registry.
  for (const asset of ["SUI", "WAL", "DEEP"] as const) {
    try {
      const market = getMarket(asset);
      const mid = await readSpotMid(ctx, market);
      if (Number.isFinite(mid) && mid > 0) {
        await appendPoint(asset, { ts: nowMs, price: mid });
      }
    } catch (e) {
      console.warn(
        `[trader-prices] ${asset} observation failed:`,
        String((e as Error)?.message ?? e).slice(0, 120),
      );
    }
  }
}

function startPriceHistoryLoop(ctx: AgentContext, managerId: string): void {
  console.log(
    `[trader-prices] open · poll=${PRICE_HISTORY_POLL_MS}ms assets=[BTC, SUI, WAL, DEEP]`,
  );
  void (async () => {
    while (true) {
      try {
        await priceHistoryTick(ctx, managerId);
      } catch (e) {
        console.warn("[trader-prices] tick error:", (e as Error).message);
      }
      await new Promise((r) => setTimeout(r, PRICE_HISTORY_POLL_MS));
    }
  })();
}

// === Auto-redeem service ===

/** A redeem failure is TERMINAL when the chain aborts inside the predict
 *  module — the position is already redeemed or in a state that can never
 *  redeem. Such positions must be dropped (not retried forever), or they
 *  flood the logs every poll. Transient RPC errors don't match this. */
function isTerminalRedeemAbort(msg: string): boolean {
  return /MoveAbort/i.test(msg) && /predict_manager|::predict::/i.test(msg);
}

async function autoRedeemTick(
  ctx: AgentContext,
  managerId: string,
): Promise<void> {
  const positions = await loadPositions();
  if (positions.length === 0) return;
  const remaining: StoredPosition[] = [];
  for (const p of positions) {
    let settled = false;
    try {
      settled = await readOracleIsSettled(ctx, p.oracleId);
    } catch {
      remaining.push(p);
      continue;
    }
    if (!settled) {
      remaining.push(p);
      continue;
    }
    console.log(
      `[trader-redeem] settled position ${p.oracleId.slice(0, 12)}… qty=${p.quantity} — redeeming`,
    );
    try {
      const tx = buildRedeemPermissionlessTx({
        managerId,
        oracleId: p.oracleId,
        expiryMs: p.expiryMs,
        strike: BigInt(p.strike),
        isUp: p.isUp,
        quantity: BigInt(p.quantity),
      });
      const res = await ctx.client.signAndExecuteTransaction({
        signer: ctx.keypair,
        transaction: tx,
        options: { showEffects: true },
      });
      if (res.effects?.status?.status === "success") {
        console.log(
          `[trader-redeem] payout claimed task=${p.taskId.slice(0, 12)}… tx=${res.digest}`,
        );
      } else {
        const err = res.effects?.status?.error ?? "";
        if (isTerminalRedeemAbort(err)) {
          // Permanently un-redeemable (already redeemed / invalid state) —
          // DROP it so it stops retrying forever and flooding the logs.
          console.warn(
            `[trader-redeem] dropping un-redeemable position task=${p.taskId.slice(0, 12)}… (terminal: ${err.slice(0, 80)})`,
          );
        } else {
          console.warn(
            `[trader-redeem] redeem failed task=${p.taskId.slice(0, 12)}…: ${err}`,
          );
          remaining.push(p);
        }
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (isTerminalRedeemAbort(msg)) {
        console.warn(
          `[trader-redeem] dropping un-redeemable position task=${p.taskId.slice(0, 12)}… (terminal: ${msg.slice(0, 80)})`,
        );
      } else {
        console.warn(
          `[trader-redeem] redeem error task=${p.taskId.slice(0, 12)}…:`,
          msg.slice(0, 120),
        );
        remaining.push(p);
      }
    }
  }
  if (remaining.length !== positions.length) {
    await savePositions(remaining);
  }
}

function startAutoRedeemLoop(ctx: AgentContext, managerId: string): void {
  console.log(
    `[trader-redeem] open inbox · poll=${REDEEM_POLL_MS}ms manager=${managerId.slice(0, 10)}…`,
  );
  void (async () => {
    while (true) {
      try {
        await autoRedeemTick(ctx, managerId);
      } catch (e) {
        console.warn("[trader-redeem] tick error:", (e as Error).message);
      }
      await new Promise((r) => setTimeout(r, REDEEM_POLL_MS));
    }
  })();
}

// === Boot ===

async function main(): Promise<void> {
  const env = loadEnv();
  // Multi-wallet mode: signs as TREASURY_SECRET_KEY (we share the wallet
  // with DeepBook v3 — same address owns the PredictManager and the
  // DeepBook BalanceManager). Reputation accrues on the same on-chain
  // AgentRegistration with two capabilities.
  const ctx = makeAgentContextFor(env, "treasury");
  console.log(
    `[trader] booting · pkg=${ctx.packageId.slice(0, 10)}… address=${ctx.address}…`,
  );

  const managerId = await ensureManager(ctx);
  console.log(`[trader] manager=${managerId}`);

  const reg = await augmentRegistration(ctx, {
    displayName: "BTC Trader",
    capabilities: ["predict-btc"],
    acceptsObjectTypes: ["Task"],
    producesObjectTypes: ["Deliverable"],
    basePricePerCall: 1_000_000_000n,
    endpointUrl: "",
    bioBlob: "",
  });
  console.log(
    `[trader] active · reg=${reg.id.slice(0, 10)}… capabilities=[${reg.capabilities.join(", ")}]`,
  );

  // Self-healing recovery scan, mirroring the other specialists.
  await recoverStuckTasks(ctx, {
    capabilityFilter: "predict-btc",
    label: "trader-recovery",
    onTask: (notice) => handleTask(ctx, managerId, notice),
  });

  // Spin up the auto-redeem service (runs forever in parallel with inbox).
  startAutoRedeemLoop(ctx, managerId);
  // Warm the rolling price history every minute for BTC + each spot
  // pool, so when a task fires the signals already reflect ~10–60
  // minutes of real action. Strategies degrade gracefully when the
  // history hasn't yet reached a given lookback window.
  startPriceHistoryLoop(ctx, managerId);
  // Spin up the spot auto-close service (mirrors auto-redeem for spot
  // positions — closes settle at the position's horizon).
  startAutoCloseSpotLoop(ctx);
  // Autonomous non-custodial operators — the always-on engine that trades
  // each adopted user's OWN BalanceManager via its delegated TradeCap,
  // gated by their OperatorPolicy. This is the "alive" loop for the mainnet
  // product: testnet operators trade now; mainnet operators light up once
  // the mainnet publish wires a mainnet trader context.
  startGatedSpotLoop(ctx);

  await startTaskInbox({
    ctx,
    cursorPath: CURSOR_PATH,
    pollMs: POLL_MS,
    assignedToFilter: ctx.address,
    capabilityFilter: "predict-btc",
    label: "trader-inbox",
    onTask: async (notice) => {
      try {
        await handleTask(ctx, managerId, notice);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 200);
        console.error(
          `[trader] task ${notice.taskId.slice(0, 10)}… handler failed:`,
          msg,
        );
        // The wire must never go silent — surface the failure to the
        // dashboard even when the handler threw before its own emits.
        // (We log + emit but don't re-throw: the inbox cursor should
        // still advance so a poison task can't loop forever.)
        emitAgentEvent("task_failed", {
          policyId: notice.parentPolicy ?? null,
          taskId: notice.taskId,
          data: { error: msg },
        });
      }
    },
  });
}

main().catch((e) => {
  console.error("[trader] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
