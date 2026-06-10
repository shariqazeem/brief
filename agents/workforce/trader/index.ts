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
  decide,
  STRATEGIES,
  type Direction,
  type StrategyDecision,
  type StrategyId,
} from "./strategy.js";

const POLL_MS = 3000;
const REDEEM_POLL_MS = 30_000;
const CURSOR_PATH = ".cursors/trader-workforce.json";
const POSITIONS_PATH = ".cursors/trader-positions.json";
const MANAGER_PATH = ".cursors/trader-manager.json";
const SCHEMA_VERSION = 1n;

const DEFAULT_STRATEGY: StrategyId = "conservative";

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
};

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
}): string {
  const expiry = new Date(args.market.oracle.expiry).toISOString();
  const strikeUsd = Number(args.market.strikeRaw) / PRICE_SCALAR;
  const spotUsd = Number(args.market.spotRaw) / PRICE_SCALAR;
  return [
    `# Trader decision · ${args.decision.strategy}`,
    "",
    `**Direction:** ${args.decision.direction.toUpperCase()}`,
    `**Quantity:** ${args.decision.quantity} dUSDC contracts`,
    `**Market:** BTC oracle \`${args.market.oracle.oracle_id}\``,
    `**Strike:** $${strikeUsd.toFixed(2)}  ·  **Spot at decision:** $${spotUsd.toFixed(2)}`,
    `**Expiry (UTC):** ${expiry}`,
    `**Mode:** ${args.mode}` +
      (args.mintTxDigest ? `  ·  mint tx \`${args.mintTxDigest}\`` : ""),
    "",
    `## Reasoning`,
    args.decision.reasoning,
  ].join("\n");
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
  const decision = decide(strategyId, {
    oracle: market.oracle,
    spotRaw: market.spotRaw,
    recentSettled,
    nowMs: Date.now(),
  });
  if (spec.quantity && spec.quantity > 0) {
    decision.quantity = spec.quantity;
  }
  console.log(
    `[trader] strategy=${strategyId} direction=${decision.direction} qty=${decision.quantity} strike=$${(Number(market.strikeRaw) / PRICE_SCALAR).toFixed(2)} spot=$${(Number(market.spotRaw) / PRICE_SCALAR).toFixed(2)} expiry=${new Date(market.oracle.expiry).toISOString()}`,
  );
  console.log(`[trader] reasoning: ${decision.reasoning}`);

  // ---- 3) Decide mode (live vs simulated) -----
  const managerDusdcBase = await readManagerDusdcBalance(ctx, managerId);
  const costDusdcBase = BigInt(decision.quantity) * BigInt(DUSDC_BASE);
  const hasFunds = managerDusdcBase >= costDusdcBase;
  const hasGate = !!spec.policyId;
  let mode: ExecutionMode = hasFunds && hasGate ? "live" : "simulated";
  let mintDigest: string | null = null;
  let simReason: string | null = null;
  if (!hasFunds) {
    simReason = `Manager dUSDC ${Number(managerDusdcBase) / DUSDC_BASE} < required ${decision.quantity} — top up the PredictManager to flip to live.`;
  } else if (!hasGate) {
    simReason = `No policy_id in task spec — live trades must be gated by an OperatorPolicy with venue "${venue}".`;
  }
  console.log(
    `[trader] mode=${mode} manager_dusdc=${Number(managerDusdcBase) / DUSDC_BASE} hasFunds=${hasFunds} hasGate=${hasGate}`,
  );

  // ---- 4) LIVE: build + submit the policy-gated mint -----
  if (mode === "live" && spec.policyId) {
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
      // Track the position locally for the auto-redeem service.
      const positions = await loadPositions();
      positions.push({
        taskId: notice.taskId,
        oracleId: market.oracle.oracle_id,
        expiryMs: market.oracle.expiry,
        strike: market.strikeRaw.toString(),
        isUp: decision.direction === "up",
        quantity: decision.quantity,
        costDusdc: Number(costDusdcBase) / DUSDC_BASE,
        mintTxDigest: mintDigest,
        mintedAtMs: Date.now(),
        strategy: decision.strategy,
      });
      await savePositions(positions);
    } catch (e) {
      // Fall back to simulated so we still deliver a coherent task,
      // and the user can see what the mint *would* have done.
      mode = "simulated";
      simReason = `Live mint failed: ${(e as Error).message.slice(0, 160)}`;
      console.warn(`[trader] live mint failed, falling back to simulated:`, e);
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
        decision,
        market,
        mode,
        mintTxDigest: mintDigest,
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
    } catch (e) {
      console.warn("[trader] walrus reasoning upload failed:", e);
    }

    // Append to the persistent journal + upload the cumulative blob.
    try {
      const prior = await loadJournal(spec.policyId ?? null);
      const entry: JournalEntry = {
        taskId: notice.taskId,
        traderName: spec.traderName ?? null,
        strategy: decision.strategy,
        decidedAtMs: Date.now(),
        market: {
          oracleId: market.oracle.oracle_id,
          expiryMs: market.oracle.expiry,
          strike: Number(market.strikeRaw),
          spotAtDecision: Number(market.spotRaw),
        },
        decision: {
          direction: decision.direction,
          quantity: decision.quantity,
          reasoning: decision.reasoning,
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
        strategy: decision.strategy,
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
    } catch (e) {
      console.warn("[trader] walrus journal upload failed:", e);
    }
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
    decision,
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
}

// === Auto-redeem service ===

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
        console.warn(
          `[trader-redeem] redeem failed task=${p.taskId.slice(0, 12)}…: ${res.effects?.status?.error}`,
        );
        remaining.push(p);
      }
    } catch (e) {
      console.warn(
        `[trader-redeem] redeem error task=${p.taskId.slice(0, 12)}…:`,
        (e as Error).message,
      );
      remaining.push(p);
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
        console.error(
          `[trader] task ${notice.taskId.slice(0, 10)}… handler failed:`,
          (e as Error)?.message ?? e,
        );
      }
    },
  });
}

main().catch((e) => {
  console.error("[trader] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
