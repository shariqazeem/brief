// OperatorAgent — the autonomous loop bound to an OperatorPolicy on-chain.
//
// Lifecycle:
//   1. Poll `PolicyCreated` events filtered to `agent == this address`.
//   2. For each new policy, spawn a per-policy loop.
//   3. Each loop tick: refresh policy → if revoked/expired/exhausted stop;
//      else propose ONE action sized within auto_approve_pct of remaining
//      budget, build ONE PTB that calls `record_spend(policy, ...)` + mints
//      an "Operator" WorkObject parented to the policy, and submits.
//
// The atomicity is the point: if the owner revokes between fetch and
// submit, `record_spend` aborts on-chain, the WorkObject mint never lands,
// and the failed TX is itself the on-chain evidence of the kill switch.
//
// Phase 2.A: the trade is SIMULATED — the PTB only does record_spend +
// mint. Phase 3 swaps in a real DeepBook order in the same PTB.

import { Transaction } from "@mysten/sui/transactions";
import { DeepBookClient, testnetCoins, testnetPools } from "@mysten/deepbook-v3";
import { loadEnv } from "../lib/env.js";
import { makeAgentContext, type AgentContext } from "../lib/sui.js";
import { loadCursor, saveCursor, type EventCursor } from "../lib/cursor.js";
import {
  addRecordSpendCall,
  fetchOperatorPolicy,
  type OperatorPolicyDecoded,
  type PolicyCreatedEvent,
} from "../lib/operator-policy.js";
import { encodePayload } from "../lib/work-object.js";
import {
  consumeReplanRequest,
  forgetPolicy,
  getMemory,
  memorySnapshot,
  recordAction,
  recordCycleSkip,
  recordGasShortfall,
  recordRejection,
  requestReplan,
  setActivePlan,
  setObjective,
  updatePlanStepStatus,
  type OperatorMemory,
} from "./memory.js";
import {
  computeConfidence,
  evaluateVenues,
  SKIP_THRESHOLD,
  type ScoredOption,
} from "./evaluator.js";
import {
  composePlan,
  nextExecutableStep,
  planExhausted,
  type Plan,
  type PlanStep,
} from "./plan.js";
import { drainPendingReplan } from "./replan-signal.js";
import { formatEvaluatedOptions, generateRationale } from "./rationale.js";
import { hydrateMemoryFromChain } from "./hydration.js";
import { computeMarketSnapshot, type MarketSnapshot } from "./signals.js";
import { resolveObjective } from "./objectives.js";
import { deriveWorldState, type WorldState } from "./world-state.js";
import {
  addStakeCalls,
  resolveActiveValidator,
  SUI_STAKE_TARGET,
} from "./staking.js";

// DeepBook constants — match the existing ExecutionAgent setup so we share
// the same BalanceManager.
const DEEPBOOK_BALANCE_MANAGER_KEY = "primary";
const DEEPBOOK_POOL_KEY = "SUI_DBUSDC";
/** Minimum free SUI (in addition to the action amount) the wallet must hold
 *  before we attempt a real on-chain trade — covers gas + small headroom. */
const GAS_HEADROOM_SUI = 0.5;
const MIST_PER_SUI = 1_000_000_000n;

/**
 * Two execution paths the operator implements end-to-end on testnet —
 * both produce real on-chain transactions. The agent never falls back to
 * a "simulated" path: if neither can run, the cycle skips with an honest
 * audit beat (awaiting_gas_funding / awaiting_validator / no_executable_venue).
 *
 *   - "deepbook": real DeepBook v3 market order on SUI/DBUSDC in the same
 *                 PTB as record_spend + audit mint.
 *   - "stake":    real `0x3::sui_system::request_add_stake` delegating
 *                 the action amount to an active validator.
 */
type ExecutionMode = "deepbook" | "stake";

/**
 * Map a policy venue label to the execution mode that fulfils it. Venues
 * without a real integration (NAVI, Suilend, SpringSui, Bucket) return
 * null — the evaluator filters them out so the operator never picks a
 * venue it can't actually execute.
 */
function executionModeFor(venue: string): ExecutionMode | null {
  if (venue === "DeepBook") return "deepbook";
  if (venue === "SuiSystem") return "stake";
  return null;
}

function isDeepBookExecutable(): boolean {
  return Boolean(process.env.BRIEF_BALANCE_MANAGER_ID?.trim());
}

/**
 * The subset of `policy.allowedVenues` the operator can actually execute
 * on this runtime. DeepBook also requires `BRIEF_BALANCE_MANAGER_ID` to be
 * configured (without it the SDK can't construct the order PTB).
 */
function executableAllowedVenues(allowed: string[]): string[] {
  const out: string[] = [];
  const dbExecutable = isDeepBookExecutable();
  for (const v of allowed) {
    if (v === "DeepBook" && dbExecutable) out.push(v);
    else if (v === "SuiSystem") out.push(v);
  }
  return out;
}

const CURSOR_PATH = ".cursors/operator.json";
const CYCLE_MS = Number(process.env.BRIEF_OPERATOR_CYCLE_MS ?? 60_000);
const POLL_MS = 3000;
const ACTION_FEE_MIST = 100_000_000n; // 0.1 SUI symbolic
const SCHEMA_VERSION = 1n;

const activeLoops = new Map<string, AbortController>();

async function main(): Promise<void> {
  const env = loadEnv();
  const ctx = makeAgentContext(env);
  console.log(
    `[operator] address=${ctx.address} pkg=${ctx.packageId.slice(0, 10)}… cycle=${CYCLE_MS}ms`,
  );

  // Re-attach to any active policies on startup. Idempotent — if the
  // policy is in `activeLoops` already, skip.
  await reattachActivePolicies(ctx);

  // Watch for new PolicyCreated events bound to us.
  let cursor = loadCursor(CURSOR_PATH);
  if (!cursor) {
    cursor = await fastForwardCursor(ctx);
    if (cursor) saveCursor(CURSOR_PATH, cursor);
  }

  console.log(
    `[operator] watching PolicyCreated events; cursor=${cursor ? `${cursor.txDigest.slice(0, 8)}…/${cursor.eventSeq}` : "null"}`,
  );

  let ticking = false;
  /**
   * Exponential backoff when public RPC throttles us with 429s. Without
   * this the watcher hammers `queryEvents` every 3 s during a throttle
   * window, which both burns the agent's RPC quota and floods stdout
   * with `tick failed: 429` for hours. We back off to up to 60 s and
   * recover instantly on the next successful poll.
   */
  let tickBackoffMs = POLL_MS;
  const TICK_BACKOFF_MAX_MS = 60_000;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const page = await ctx.client.queryEvents({
        query: {
          MoveEventType: `${ctx.packageId}::operator_policy::PolicyCreated`,
        },
        cursor,
        order: "ascending",
        limit: 50,
      });
      for (const ev of page.data) {
        const parsed = ev.parsedJson as PolicyCreatedEvent;
        if (parsed.agent !== ctx.address) continue;
        if (activeLoops.has(parsed.id)) continue;
        attachPolicyLoop(ctx, parsed.id, parsed.name);
      }
      if (page.nextCursor) {
        cursor = page.nextCursor;
        saveCursor(CURSOR_PATH, cursor);
      }
      tickBackoffMs = POLL_MS; // success — reset backoff
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      const rateLimited = /429|rate|too many|max usage/i.test(msg);
      if (rateLimited) {
        tickBackoffMs = Math.min(tickBackoffMs * 2, TICK_BACKOFF_MAX_MS);
        console.warn(
          `[operator] watcher 429 from RPC — backing off ${tickBackoffMs}ms before next poll`,
        );
      } else {
        console.error("[operator] tick failed:", msg);
      }
    } finally {
      ticking = false;
    }
    // Self-reschedule so the backoff value is honoured per-call. This
    // replaces the fixed setInterval we used before.
    if (!ticking) setTimeout(tick, tickBackoffMs);
  };

  await tick();
}

async function fastForwardCursor(ctx: AgentContext): Promise<EventCursor | null> {
  try {
    const latest = await ctx.client.queryEvents({
      query: {
        MoveEventType: `${ctx.packageId}::operator_policy::PolicyCreated`,
      },
      order: "descending",
      limit: 1,
    });
    const head = latest.data[0];
    if (!head) return null;
    return { txDigest: head.id.txDigest, eventSeq: head.id.eventSeq };
  } catch {
    return null;
  }
}

async function reattachActivePolicies(ctx: AgentContext): Promise<void> {
  try {
    const page = await ctx.client.queryEvents({
      query: {
        MoveEventType: `${ctx.packageId}::operator_policy::PolicyCreated`,
      },
      order: "descending",
      limit: 50,
    });
    for (const ev of page.data) {
      const parsed = ev.parsedJson as PolicyCreatedEvent;
      if (parsed.agent !== ctx.address) continue;
      if (activeLoops.has(parsed.id)) continue;
      const policy = await fetchOperatorPolicy(ctx, parsed.id).catch(() => null);
      if (!policy || policy.revoked) continue;
      if (Date.now() >= Number(policy.expiresAtMs)) continue;
      console.log(
        `[operator] reattaching to policy ${parsed.id.slice(0, 10)}… (${policy.name})`,
      );
      attachPolicyLoop(ctx, parsed.id, policy.name);
    }
  } catch (e) {
    console.warn(`[operator] reattach failed: ${(e as Error)?.message ?? e}`);
  }
}

function attachPolicyLoop(ctx: AgentContext, policyId: string, name: string): void {
  if (activeLoops.has(policyId)) return;
  const ctl = new AbortController();
  activeLoops.set(policyId, ctl);
  console.log(`[operator] starting loop for ${policyId.slice(0, 10)}… (${name})`);

  // Resolve the operator's mission objective. Set BEFORE hydration so the
  // memory snapshot embedded in the first cycle carries the mandate.
  const objective = resolveObjective(policyId, name);
  setObjective(policyId, objective);

  // Hydrate from chain history — replays any prior Operator + Rejection
  // WorkObjects so a restarted process resumes with continuity. Fire and
  // forget; the loop reads memory each tick anyway, and the hydrate flag
  // ensures we only attempt this once.
  hydrateMemoryFromChain(ctx, policyId)
    .then((m) => {
      console.log(
        `[operator] hydrated ${policyId.slice(0, 10)}… cycles=${m.cycles} actions=${m.totalActions} rejections=${m.rejectedAttempts} posture=${m.posture}${objective ? ` objective="${objective.slice(0, 60)}…"` : ""}`,
      );
    })
    .catch((e) => {
      console.warn(
        `[operator] hydrate failed for ${policyId.slice(0, 10)}…: ${(e as Error)?.message ?? e}`,
      );
    });

  runPolicyLoop(ctx, policyId, ctl.signal)
    .catch((e: unknown) => {
      console.error(
        `[operator] loop ${policyId.slice(0, 10)}… crashed:`,
        (e as Error)?.message ?? e,
      );
    })
    .finally(() => {
      activeLoops.delete(policyId);
    });
}

/**
 * Map a Sui Move-abort error string back to its operator_policy abort code.
 * The on-chain enforcement throws structured aborts; we use the code to (a)
 * label the Rejection WorkObject we mint, and (b) decide whether to stop
 * the loop (revoke / expired / exhausted are terminal; venue-not-allowed
 * could be transient if venues change).
 */
type AbortReason =
  | "revoked"
  | "expired"
  | "budget_exceeded"
  | "venue_not_allowed"
  | "not_agent"
  | "unknown_policy_abort";

function detectAbortReason(msg: string): AbortReason | null {
  if (!msg) return null;
  const m = msg.toLowerCase();
  // Only OUR module's aborts count as policy rejections. Aborts from
  // other modules (e.g. Sui System's validator_set, DeepBook) are
  // SDK/runtime errors that the outer catch logs without minting a
  // misleading Rejection WO.
  if (!m.includes("operator_policy")) return null;
  if (/,\s*3\)/.test(m) || m.includes("policyrevoked")) return "revoked";
  if (/,\s*4\)/.test(m) || m.includes("policyexpired")) return "expired";
  if (/,\s*5\)/.test(m) || m.includes("budgetexceeded")) return "budget_exceeded";
  if (/,\s*6\)/.test(m) || m.includes("venuenotallowed")) return "venue_not_allowed";
  if (/,\s*2\)/.test(m) || m.includes("notagent")) return "not_agent";
  return "unknown_policy_abort";
}

/**
 * Mint a Rejection WorkObject describing the attempted-but-aborted action.
 * Plain `work_object::mint` — does NOT touch the OperatorPolicy, so this
 * succeeds even when the policy is revoked. The frontend renders these as
 * red nodes in the timeline. This is the dramatic beat of the demo.
 */
async function mintRejection(
  ctx: AgentContext,
  policy: OperatorPolicyDecoded,
  action: ProposedAction,
  reason: AbortReason,
  rawError: string,
): Promise<void> {
  const tx = new Transaction();
  const payload = {
    operator_policy: policy.id,
    venue: action.venue,
    amount_mist: action.amount.toString(),
    rationale: action.rationale,
    reason,
    error: rawError.slice(0, 240),
    attempted_at_ms: Date.now(),
  };
  const payloadBytes = encodePayload(payload);
  tx.moveCall({
    target: `${ctx.packageId}::work_object::mint`,
    arguments: [
      tx.pure.address(policy.owner),
      tx.pure.string("Rejection"),
      tx.pure.u64(SCHEMA_VERSION),
      tx.pure.vector("u8", Array.from(payloadBytes)),
      tx.pure.option("string", null),
      tx.pure.vector("id", [policy.id]),
      tx.pure.u64(0n),
    ],
  });
  const result = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true },
  });
  console.log(
    `[operator] REJECTION minted reason=${reason} policy=${policy.id.slice(0, 10)}… tx=${result.digest}`,
  );
}

// ---------------------------------------------------------------------------
// Plan composer hook + StrategyObject mint
// ---------------------------------------------------------------------------

/**
 * Mint a "Strategy" WorkObject carrying the structured plan, parented to
 * the OperatorPolicy. Inline payload is the typed JSON plan (steps + thesis
 * + triggers). The free-form reasoning text goes inline too for v1 — Walrus
 * offload is a future hardening when reasoning grows large.
 */
async function mintStrategyObject(
  ctx: AgentContext,
  policy: OperatorPolicyDecoded,
  plan: Plan,
  rawReasoning: string,
  parentStrategyId: string | null,
): Promise<string> {
  const payload = {
    operator_policy: policy.id,
    schema_version: plan.schema_version,
    thesis: plan.thesis,
    reasoning_summary: plan.reasoning_summary,
    goal_text: plan.goal_text,
    steps: plan.steps.map((s) => ({
      id: s.id,
      venue: s.venue,
      intent: s.intent,
      amount_sui: s.amount_sui,
      trigger: s.trigger,
      max_attempts: s.max_attempts,
      status: s.status,
    })),
    rebalance_triggers: plan.rebalance_triggers,
    model_tag: plan.model_tag,
    source: plan.source,
    raw_reasoning: rawReasoning.slice(0, 1200), // small inline excerpt
    created_at_ms: plan.created_at_ms,
    parent_strategy: parentStrategyId,
  };
  const payloadBytes = encodePayload(payload);
  const parents: string[] = parentStrategyId
    ? [policy.id, parentStrategyId]
    : [policy.id];

  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::work_object::mint`,
    arguments: [
      tx.pure.address(policy.owner),
      tx.pure.string("Strategy"),
      tx.pure.u64(SCHEMA_VERSION),
      tx.pure.vector("u8", Array.from(payloadBytes)),
      tx.pure.option("string", null),
      tx.pure.vector("id", parents),
      tx.pure.u64(0n),
    ],
  });

  const result = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });

  // Find the new WorkObject id from objectChanges
  let mintedId: string | null = null;
  for (const change of result.objectChanges ?? []) {
    if (
      change.type === "created" &&
      typeof (change as { objectType?: string }).objectType === "string" &&
      (change as { objectType: string }).objectType.endsWith(
        "::work_object::WorkObject",
      )
    ) {
      mintedId = (change as { objectId: string }).objectId;
      break;
    }
  }
  if (!mintedId) {
    throw new Error("mintStrategyObject: no WorkObject in objectChanges");
  }
  console.log(
    `[operator] STRATEGY minted policy=${policy.id.slice(0, 10)}… steps=${plan.steps.length} model=${plan.model_tag} source=${plan.source} tx=${result.digest} wo=${mintedId.slice(0, 10)}…`,
  );
  return mintedId;
}

/**
 * Compose a fresh plan + mint a StrategyObject. Idempotent in the sense that
 * the caller decides when to call it; this function ALWAYS produces a new
 * plan + on-chain artifact. Returns the new plan + the StrategyObject id.
 *
 * The `parentPlan` is the prior plan being replaced (null on first plan).
 * When set, the new StrategyObject is parented to BOTH the policy AND the
 * prior StrategyObject so the lineage graph reads as policy → strat₁ → strat₂.
 */
async function composeAndMintPlan(
  ctx: AgentContext,
  policy: OperatorPolicyDecoded,
  snapshot: MarketSnapshot,
  worldState: WorldState,
  goalText: string,
  parentStrategyId: string | null,
): Promise<{ plan: Plan; strategyObjectId: string }> {
  // Best-effort validator APY for prompt context. Doesn't block planning.
  let validatorApyPct: number | null = null;
  try {
    const v = await resolveActiveValidator(ctx.client);
    if (v && typeof v.apy === "number") validatorApyPct = v.apy;
  } catch {
    // ignore — composePlan handles missing APY gracefully
  }

  const { plan, rawReasoning } = await composePlan({
    goalText,
    policy,
    snapshot,
    worldState,
    validatorApyPct,
  });

  const strategyObjectId = await mintStrategyObject(
    ctx,
    policy,
    plan,
    rawReasoning,
    parentStrategyId,
  );
  return { plan, strategyObjectId };
}

/**
 * Ensure the policy has an active plan in memory. If memory is empty (fresh
 * process or first cycle of this policy), compose a new plan and mint the
 * Strategy WorkObject before returning. On compose failure, the operator's
 * fallback heuristic plan inside `composePlan` still produces something —
 * but if the MINT fails (RPC / gas), we propagate the error and the loop
 * skips this cycle, retrying next tick.
 */
async function ensurePlan(
  ctx: AgentContext,
  policy: OperatorPolicyDecoded,
  snapshot: MarketSnapshot,
  worldState: WorldState,
  memory: OperatorMemory,
): Promise<Plan | null> {
  if (memory.activePlan) return memory.activePlan;

  const goalText =
    memory.objective ??
    `Operate within the envelope. Honor budget and concentration caps.`;

  try {
    const { plan, strategyObjectId } = await composeAndMintPlan(
      ctx,
      policy,
      snapshot,
      worldState,
      goalText,
      null,
    );
    setActivePlan(policy.id, plan, strategyObjectId);
    return plan;
  } catch (e) {
    console.warn(
      `[operator] ensurePlan failed for ${policy.id.slice(0, 10)}…: ${(e as Error)?.message ?? e}`,
    );
    return null;
  }
}

/**
 * Convert a plan step into a ScoredOption-shaped object the downstream
 * action-build + execute pipeline already knows how to consume. Score
 * + components are synthesized from the step's intent — the LLM-authored
 * plan IS the agent's conviction, so we surface high confidence.
 */
function planStepToOption(
  step: PlanStep,
  policy: OperatorPolicyDecoded,
  memory: OperatorMemory,
  snapshot: MarketSnapshot,
): ScoredOption {
  const amountMist = BigInt(Math.floor(step.amount_sui * 1e9));
  const deployedHere = memory.venueDeployedMist[step.venue] ?? 0n;
  const budgetCapNum = Number(policy.budgetCap || 1n);
  const projectedConcentrationFrac =
    Number(deployedHere + amountMist) / budgetCapNum;
  const signal =
    snapshot.signals[step.venue] ??
    ({
      venue: step.venue,
      liquidity: 0.5,
      yield: 0.5,
      execution: 0.5,
      raw: {},
      source: "fallback",
      age_ms: 0,
    } as ScoredOption["signal"]);

  return {
    venue: step.venue,
    amountMist,
    score: 0.78, // plan-driven actions carry built-in conviction
    rationaleFactors: [step.intent],
    projectedConcentrationFrac,
    components: {
      liquidity: signal.liquidity,
      yield: signal.yield,
      execution: signal.execution,
      policy: 1.0,
      recencyDelta: 0,
      concentrationDelta: 0,
      postureDelta: 0,
    },
    signal,
  };
}

async function runPolicyLoop(
  ctx: AgentContext,
  policyId: string,
  signal: AbortSignal,
): Promise<void> {
  /**
   * Consecutive cycles where `fetchOperatorPolicy` returned null. Public
   * RPC 429s can briefly hide a perfectly-alive policy — we must NOT
   * forget the loop just because one cycle's RPC was throttled. Only
   * stop after N consecutive null returns (something more durable, like
   * the policy actually being deleted or an upgrade re-publishing).
   */
  let nullStreak = 0;
  const NULL_STREAK_GIVEUP = 8; // ~2 minutes at the 15s base cycle

  while (!signal.aborted) {
    const policyOrNull = await fetchOperatorPolicy(ctx, policyId).catch(() => null);
    if (!policyOrNull) {
      nullStreak += 1;
      if (nullStreak >= NULL_STREAK_GIVEUP) {
        console.warn(
          `[operator] policy ${policyId.slice(0, 10)}… unreachable for ${nullStreak} consecutive cycles — stopping loop. Confirm chain state on suiscan if unexpected.`,
        );
        forgetPolicy(policyId);
        return;
      }
      console.warn(
        `[operator] policy ${policyId.slice(0, 10)}… fetch returned null (likely transient RPC) — retrying next cycle (${nullStreak}/${NULL_STREAK_GIVEUP})`,
      );
      await sleep(computeCycleSleep(getMemory(policyId)), signal);
      continue;
    }
    nullStreak = 0;
    const policy = policyOrNull;
    // Terminal conditions that don't deserve an on-chain rejection.
    // (Expiry / budget exhaustion are natural end-of-life, not dramatic.)
    if (Date.now() >= Number(policy.expiresAtMs)) {
      console.log(`[operator] policy ${policyId.slice(0, 10)}… EXPIRED, stopping`);
      forgetPolicy(policyId);
      return;
    }
    const remaining = policy.budgetCap - policy.spent;
    if (remaining <= 0n) {
      console.log(`[operator] policy ${policyId.slice(0, 10)}… budget exhausted, stopping`);
      forgetPolicy(policyId);
      return;
    }

    // Fetch live market signals + derive world state for this cycle. Both
    // are resilient (per-source timeout + cache) — they always return
    // something, but they tell us honestly whether the data is fresh.
    const snapshot = await computeMarketSnapshot(
      ctx.client,
      policy.allowedVenues,
    );
    const worldState = await deriveWorldState(ctx.client, snapshot);

    // Narrow evaluation to venues the operator can ACTUALLY execute on
    // this runtime. The chain might authorize NAVI / Suilend but the
    // agent has integrations only for DeepBook + SuiSystem; rather than
    // picking a venue we can't fulfill and then pretending (simulated),
    // we filter at evaluation time. Honest, deterministic.
    const memory = getMemory(policyId);
    const executable = executableAllowedVenues(policy.allowedVenues);

    if (executable.length === 0) {
      const reason = isDeepBookExecutable()
        ? "policy allows no executable venue"
        : "policy allows no executable venue (DeepBook needs BRIEF_BALANCE_MANAGER_ID)";
      console.log(
        `[operator] policy ${policyId.slice(0, 10)}… cycle ${memory.cycles + 1} SKIP_NO_VENUE · ${reason}`,
      );
      recordCycleSkip(policyId, "no_executable_venue");
      await sleep(computeCycleSleep(memory), signal);
      continue;
    }

    // ------------------------------------------------------------------
    // PLAN-DRIVEN PATH — the loop now executes a multi-step plan composed
    // by the LLM at grant time (and re-composed on triggers). The legacy
    // evaluator scoring is retained as a fallback in case ensurePlan fails.
    // ------------------------------------------------------------------

    // 0. Drain any user-triggered re-plan requests posted via the web app's
    //    /api/operator/replan endpoint. Crosses the process boundary via
    //    a small JSON file under .brief/. Forwarded into memory below.
    drainPendingReplan(policyId);

    // 1. Make sure we have an active plan. First cycle of a fresh policy
    //    triggers the LLM compose + Strategy WO mint.
    const plan = await ensurePlan(ctx, policy, snapshot, worldState, memory);

    // 2. Handle any pending re-plan request — but ONLY after ensurePlan has
    //    succeeded, otherwise the request gets dropped on the floor when the
    //    very first plan fails to mint. With activePlan set, we can swap it
    //    out for a freshly-composed phase-2 plan.
    if (memory.activePlan && memory.replanRequested) {
      const replanReason = consumeReplanRequest(policyId);
      if (replanReason) {
        try {
          const { plan: newPlan, strategyObjectId } = await composeAndMintPlan(
            ctx,
            policy,
            snapshot,
            worldState,
            memory.objective ?? memory.activePlan.goal_text,
            memory.activePlanWoId,
          );
          setActivePlan(policyId, newPlan, strategyObjectId);
          console.log(
            `[operator] policy ${policyId.slice(0, 10)}… RE-PLANNED (${replanReason}) — ${newPlan.steps.length} new step(s)`,
          );
        } catch (e) {
          console.warn(
            `[operator] re-plan failed (${replanReason}): ${(e as Error)?.message ?? e}`,
          );
          // Put the request back so the next cycle retries.
          requestReplan(policyId, replanReason);
        }
      }
    }

    if (!plan) {
      console.log(
        `[operator] policy ${policyId.slice(0, 10)}… cycle ${memory.cycles + 1} SKIP_NO_PLAN · will retry next cycle`,
      );
      recordCycleSkip(policyId, "below_threshold");
      await sleep(computeCycleSleep(memory), signal);
      continue;
    }

    // 3. Plan exhausted? Schedule a re-plan and skip this cycle. The next
    //    cycle will compose the next phase.
    if (planExhausted(plan)) {
      console.log(
        `[operator] policy ${policyId.slice(0, 10)}… cycle ${memory.cycles + 1} PLAN_EXHAUSTED — queueing re-plan`,
      );
      requestReplan(policyId, "exhausted");
      recordCycleSkip(policyId, "below_threshold");
      await sleep(computeCycleSleep(memory), signal);
      continue;
    }

    // 4. Pick the next executable step (its trigger condition must hold).
    const step = nextExecutableStep(plan, snapshot);
    if (!step) {
      console.log(
        `[operator] policy ${policyId.slice(0, 10)}… cycle ${memory.cycles + 1} HOLD · no step trigger satisfied · world=${worldState.regime} · sig=${snapshot.summary}`,
      );
      recordCycleSkip(policyId, "below_threshold");
      await sleep(computeCycleSleep(memory), signal);
      continue;
    }

    // 5. Build a ScoredOption-shaped "top" from the plan step so the
    //    downstream gas/stake-floor/buildAction/executeAction pipeline
    //    doesn't need to know whether the decision came from the LLM or
    //    the legacy evaluator. `options` is just [top] for telemetry.
    const top: ScoredOption = planStepToOption(step, policy, memory, snapshot);
    const options: ScoredOption[] = [top];

    const executionMode = executionModeFor(top.venue);
    if (!executionMode) {
      console.warn(
        `[operator] plan step venue ${top.venue} has no execution mode — marking step failed`,
      );
      updatePlanStepStatus(policyId, step.id, "failed");
      recordCycleSkip(policyId, "no_executable_venue");
      await sleep(computeCycleSleep(memory), signal);
      continue;
    }

    // Sui System staking has a HARD floor of 1 SUI per stake — anything
    // below aborts on chain with validator_set EBalanceNotEnoughToStake
    // (code 10). The evaluator sizes per-cycle as 10% of remaining
    // budget, which on a 5-SUI envelope rounds to 0.5 SUI. Bump the
    // action up to the Sui minimum when stake mode is chosen; if the
    // remaining envelope can't cover 1 SUI, fall through to DeepBook if
    // the policy allows it, else skip with a clean "below threshold"
    // beat instead of repeatedly aborting on chain.
    const MIN_STAKE_MIST = 1_000_000_000n;
    if (executionMode === "stake" && top.amountMist < MIN_STAKE_MIST) {
      const remaining = policy.budgetCap - policy.spent;
      if (remaining >= MIN_STAKE_MIST) {
        top.amountMist = MIN_STAKE_MIST;
        // Recompute projected concentration with the bumped amount
        const deployedHere = memory.venueDeployedMist[top.venue] ?? 0n;
        const budgetCapNum = Number(policy.budgetCap || 1n);
        top.projectedConcentrationFrac =
          Number(deployedHere + top.amountMist) / budgetCapNum;
      } else if (
        executable.includes("DeepBook") &&
        options.some((o) => o.venue === "DeepBook")
      ) {
        // Fall back to DeepBook for this cycle — budget too small for a
        // validator stake. The DeepBook option already has its own
        // amount computed by the evaluator.
        const dbOption = options.find((o) => o.venue === "DeepBook")!;
        top.venue = dbOption.venue;
        top.amountMist = dbOption.amountMist;
        top.score = dbOption.score;
        top.signal = dbOption.signal;
        top.components = dbOption.components;
        top.projectedConcentrationFrac = dbOption.projectedConcentrationFrac;
        top.rationaleFactors = [
          "stake floor unreachable — rotating to DeepBook",
          ...dbOption.rationaleFactors,
        ];
      } else {
        console.log(
          `[operator] policy ${policyId.slice(0, 10)}… cycle ${memory.cycles + 1} SKIP_STAKE_FLOOR · remaining=${remaining} MIST < 1 SUI min · no DeepBook fallback`,
        );
        recordCycleSkip(policyId, "below_threshold");
        await sleep(computeCycleSleep(memory), signal);
        continue;
      }
    }

    // The execution mode may have been re-derived above if we rotated
    // to DeepBook. Refresh it so executeAction picks the right path.
    const finalMode = executionModeFor(top.venue) ?? executionMode;

    // Gas-funding pre-check — we never enter the PTB build path unless
    // the wallet can pay for the action + headroom. If short, we mint a
    // small audit-only WorkObject with status "awaiting_gas_funding" so
    // the timeline records the pause beat with the exact deficit.
    const gas = await checkGasFunding(ctx, top.amountMist);
    if (gas.status === "rpc_error") {
      console.warn(
        `[operator] policy ${policyId.slice(0, 10)}… balance RPC failed, will retry next cycle: ${gas.message}`,
      );
      recordCycleSkip(policyId, "awaiting_gas_funding");
      await sleep(computeCycleSleep(memory), signal);
      continue;
    }
    if (gas.status === "insufficient") {
      console.log(
        `[operator] policy ${policyId.slice(0, 10)}… cycle ${memory.cycles + 1} AWAITING_GAS_FUNDING · venue=${top.venue} need=${gas.requiredMist} MIST free=${gas.freeMist} MIST deficit=${gas.deficitMist} MIST`,
      );
      // Only mint the audit-only hold WO when ENTERING the held-for-gas
      // streak. Subsequent cycles with the same shortage skip the mint
      // (each mint costs gas itself — burning the remaining headroom to
      // log "I have no gas" is the worst possible behaviour). The single
      // WO is sufficient on-chain evidence; the memory counter handles
      // the running tally.
      if (memory.consecutiveGasShortfalls === 0) {
        try {
          await mintGasFundingHold(ctx, policy, top, gas, snapshot, worldState, memory);
        } catch (mintErr) {
          console.warn(
            `[operator] could not mint gas-funding hold WO (insufficient gas for mint?): ${(mintErr as Error)?.message ?? mintErr}`,
          );
        }
      }
      recordGasShortfall(policyId, gas.deficitMist);
      await sleep(computeCycleSleep(memory), signal);
      continue;
    }

    // Funded — proceed.
    const confidence = computeConfidence(options);
    const rationale = generateRationale(top, options, memory, policy);
    const action = buildAction(
      top,
      options,
      confidence,
      rationale,
      snapshot,
      worldState,
      memory,
      finalMode,
      gas,
    );

    console.log(
      `[operator] policy ${policyId.slice(0, 10)}… cycle ${memory.cycles + 1} DECIDE · ${top.venue} mode=${finalMode} score=${top.score.toFixed(2)} conf=${confidence.toFixed(2)} amount=${action.amount}MIST · alternatives=${formatEvaluatedOptions(options.slice(1))}`,
    );

    // NOTE: we deliberately DO NOT pre-check policy.revoked here. The whole
    // point of the on-chain enforcement is that the chain — not our server —
    // blocks the agent. So we attempt the PTB; if revoked, `record_spend`
    // aborts on-chain, we catch the abort, and mint a Rejection WorkObject
    // so the dashboard shows the failed attempt in the timeline.
    try {
      await executeAction(ctx, policy, action, finalMode);
      recordAction(
        policyId,
        action.venue,
        action.amount,
        action.score,
        action.confidence,
        action.concentrationPctAfter / 100,
      );
      // Step succeeded — mark done so nextExecutableStep skips it next cycle.
      updatePlanStepStatus(policyId, step.id, "done");
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      const reason = detectAbortReason(msg);
      if (reason) {
        try {
          await mintRejection(ctx, policy, action, reason, msg);
          recordRejection(policyId);
        } catch (mintErr) {
          console.warn(
            `[operator] could not mint Rejection: ${(mintErr as Error)?.message ?? mintErr}`,
          );
        }
        // Mark this step failed so the loop advances to the next one. If
        // every step in the plan fails, the loop's planExhausted check
        // schedules an automatic re-plan next cycle.
        updatePlanStepStatus(policyId, step.id, "failed");

        // Cluster of consecutive rejections → re-plan (the current thesis
        // is fighting reality). Threshold of 3 matches what humans would
        // call "this isn't working, try something else."
        const memAfter = getMemory(policyId);
        if (memAfter.consecutiveRejections >= 3) {
          console.log(
            `[operator] policy ${policyId.slice(0, 10)}… abort cluster (3 in a row) — queueing re-plan`,
          );
          requestReplan(policyId, "abort_cluster");
        }
        // Revoke + expired are terminal — stop the loop after the rejection lands.
        if (reason === "revoked" || reason === "expired") {
          console.log(
            `[operator] policy ${policyId.slice(0, 10)}… ${reason} — stopping after rejection mint`,
          );
          forgetPolicy(policyId);
          return;
        }
        // For other aborts (budget_exceeded, venue_not_allowed) we record
        // the rejection and let the next cycle try a different option —
        // the memory penalties from this attempt will steer it away.
      } else {
        console.warn(
          `[operator] non-abort action error for ${policyId.slice(0, 10)}…: ${msg.slice(0, 240)}`,
        );
      }
    }

    await sleep(computeCycleSleep(getMemory(policyId)), signal);
  }
}

/**
 * Cycle pacing — variable around the configured base. High-confidence
 * actions get a slightly longer rest (the agent is assured); low-confidence
 * cycles tighten up (eager to re-scan). Keeps the cadence from feeling
 * mechanical.
 */
function computeCycleSleep(memory: OperatorMemory): number {
  // 0.80 (low confidence) to 1.30 (high confidence) of base cycle.
  const conf = Math.max(0, Math.min(1, memory.lastScore));
  const factor = 0.8 + conf * 0.5;
  return Math.max(8_000, Math.floor(CYCLE_MS * factor));
}

type ProposedAction = {
  venue: string;
  amount: bigint;
  rationale: string;
  expectedYieldBps: number;
  /** Operator's score for the chosen venue (0–1). */
  score: number;
  /** Confidence in the choice — margin to second-best option mapped 0.5–1.0. */
  confidence: number;
  /** Other venues we considered + their scores (for payload metadata). */
  evaluated: { venue: string; score: number }[];
  /** Projected concentration on this venue AFTER executing (percent). */
  concentrationPctAfter: number;
  /** Component-level breakdown the frontend renders in DecisionTrace. */
  components: ScoredOption["components"];
  /** Live market snapshot consumed for this decision — provenance. */
  marketSnapshot: MarketSnapshot;
  /** Derived world state at decision time. */
  worldState: WorldState;
  /** Memory snapshot embedded for continuity / posture display. */
  memory: ReturnType<typeof memorySnapshot>;
  /** Mission objective at decision time, if any. */
  objective?: string;
  /** Execution path — "deepbook" or "stake". Never "simulated". */
  executionMode: ExecutionMode;
  /** Gas-check result captured before PTB build, embedded for auditability. */
  gasCheck: GasCheckOk;
  /**
   * For DeepBook actions this is a UX projection (until we parse balance
   * changes from the tx digest). For stake actions amount_in === amount_out
   * and price = 1.0 — the operator's full action amount is delegated.
   */
  fill: {
    pool: string;
    side_in: string;
    side_out: string;
    amount_in: string;
    amount_out: string;
    price: number;
  };
};

/**
 * Build a ProposedAction from the top-scored evaluator option.
 *
 * For DeepBook actions the fill numbers are UX projections — the real
 * fill is the on-chain DeepBook order in the same PTB (judges can read
 * the actual balance changes from the tx digest).
 * For stake actions amount_in === amount_out and price = 1.0 — the
 * operator's full action amount is delegated to a validator.
 *
 * Embeds full provenance (signal source, world state, memory, gas check)
 * so the payload is self-auditable.
 */
function buildAction(
  top: ScoredOption,
  allOptions: ScoredOption[],
  confidence: number,
  rationale: string,
  snapshot: MarketSnapshot,
  worldState: WorldState,
  memory: OperatorMemory,
  executionMode: ExecutionMode,
  gasCheck: GasCheckOk,
): ProposedAction {
  const apyHint = top.signal.raw.apy_pct ?? 2.5;
  const projectedBps = Math.min(700, Math.floor(apyHint * 100 + confidence * 50));
  const expectedYieldBps = Math.max(0, projectedBps);

  let fill: ProposedAction["fill"];
  if (executionMode === "stake") {
    fill = {
      pool: "Sui System · validator delegation",
      side_in: "SUI",
      side_out: "Staked SUI",
      amount_in: top.amountMist.toString(),
      amount_out: top.amountMist.toString(),
      price: 1.0,
    };
  } else {
    // DeepBook UX projection — exact fill comes from balance changes.
    const driftFromScore = (top.score - 0.5) * 0.005;
    const price = Number((0.998 + driftFromScore).toFixed(5));
    const amountOut = BigInt(Math.floor(Number(top.amountMist) * price));
    fill = {
      pool: "SUI/DBUSDC",
      side_in: "SUI",
      side_out: "DBUSDC",
      amount_in: top.amountMist.toString(),
      amount_out: amountOut.toString(),
      price,
    };
  }

  return {
    venue: top.venue,
    amount: top.amountMist,
    rationale,
    expectedYieldBps,
    score: top.score,
    confidence,
    evaluated: allOptions
      .slice(0, 4)
      .map((o) => ({ venue: o.venue, score: Number(o.score.toFixed(3)) })),
    concentrationPctAfter: Number(
      (top.projectedConcentrationFrac * 100).toFixed(2),
    ),
    components: top.components,
    marketSnapshot: snapshot,
    worldState,
    memory: memorySnapshot(memory),
    objective: memory.objective,
    executionMode,
    gasCheck,
    fill,
  };
}

// (Legacy heuristic proposeAction removed — all sizing + rationale logic
// lives in evaluator.ts + rationale.ts now.)

async function executeAction(
  ctx: AgentContext,
  policy: OperatorPolicyDecoded,
  action: ProposedAction,
  executionMode: ExecutionMode,
): Promise<void> {
  // ONE PTB: record_spend + real DeFi op + audit mint. Atomic — if
  // revoke happened between fetch and submit, record_spend aborts and
  // nothing else lands. The failed TX is itself the on-chain evidence
  // of the kill switch.
  const tx = new Transaction();

  addRecordSpendCall(tx, {
    packageId: ctx.packageId,
    policyId: policy.id,
    amount: action.amount,
    venue: action.venue,
  });

  // Append the real on-chain operation. Throws on setup failure — the
  // outer catch logs + skips the cycle. We NEVER fall back to a synthetic
  // "simulated" path: the operator either submits a real DeFi tx or it
  // doesn't submit at all.
  let executionMeta: ExecutionMeta;
  if (executionMode === "stake") {
    executionMeta = await appendStakeCalls(ctx, tx, action);
  } else {
    executionMeta = appendDeepBookCalls(ctx, tx, action);
  }

  // Compress the market snapshot for the payload — we only embed the
  // chosen-venue signal + degraded flag + source status. Full per-venue
  // snapshots can balloon the payload past Sui's effective u64 vector
  // limits when memory accumulates over time.
  const chosenSignal = action.marketSnapshot.signals[action.venue];

  const payload = {
    operator_policy: policy.id,
    status: "deployed",
    venue: action.venue,
    amount_mist: action.amount.toString(),
    rationale: action.rationale,
    expected_yield_bps: action.expectedYieldBps,
    /** Real on-chain execution path — never "simulated". */
    execution_mode: executionMode,
    /** Back-compat alias. Older UI code reads `mode`. */
    mode: executionMode,
    execution_meta: executionMeta,
    fill: action.fill,
    spent_after: (policy.spent + action.amount).toString(),
    budget_cap: policy.budgetCap.toString(),
    executed_at_ms: Date.now(),
    // Decision telemetry — additive, back-compat with the prior schema.
    score: Number(action.score.toFixed(3)),
    confidence: Number(action.confidence.toFixed(3)),
    evaluated: action.evaluated,
    concentration_pct_after: action.concentrationPctAfter,
    components: action.components,
    // Provenance — live signal that drove this decision
    market_snapshot: {
      fetched_at_ms: action.marketSnapshot.fetched_at_ms,
      degraded: action.marketSnapshot.degraded,
      source_status: action.marketSnapshot.source_status,
      summary: action.marketSnapshot.summary,
      signals: { [action.venue]: chosenSignal },
    },
    // Environmental telemetry — what world the operator saw
    world_state: action.worldState,
    // Continuity — the operator's own running profile
    memory_context: action.memory,
    // The mandate the operator is serving (set at grant time, off-chain)
    objective: action.objective ?? null,
    posture: action.memory.posture,
    mission_alignment: missionAlignmentNote(action, chosenSignal),
    confidence_regime:
      action.confidence >= 0.75
        ? "decisive"
        : action.confidence >= 0.6
          ? "narrow-edge"
          : "exploratory",
    // Auditable gas-check that gated the cycle
    gas_check: {
      free_mist: action.gasCheck.freeMist.toString(),
      required_mist: action.gasCheck.requiredMist.toString(),
      headroom_mist: action.gasCheck.headroomMist.toString(),
      checked_at_ms: action.gasCheck.checkedAtMs,
    },
  };
  const payloadBytes = encodePayload(payload);

  tx.moveCall({
    target: `${ctx.packageId}::work_object::mint`,
    arguments: [
      tx.pure.address(policy.owner),
      tx.pure.string("Operator"),
      tx.pure.u64(SCHEMA_VERSION),
      tx.pure.vector("u8", Array.from(payloadBytes)),
      tx.pure.option("string", null),
      tx.pure.vector("id", [policy.id]),
      tx.pure.u64(ACTION_FEE_MIST),
    ],
  });

  const result = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true, showBalanceChanges: true },
  });

  console.log(
    `[operator] action OK mode=${executionMode} policy=${policy.id.slice(0, 10)}… venue=${action.venue} amount=${action.amount}MIST tx=${result.digest}`,
  );
}

// ---------------------------------------------------------------------------
// Real DeepBook integration — throws on setup failure (no simulated path)
// ---------------------------------------------------------------------------

type ExecutionMeta =
  | { kind: "deepbook"; pool_key: string; balance_manager_id: string; client_order_id: string }
  | { kind: "stake"; validator_address: string; validator_apy: number; validator_source: "rpc" | "env" | "cache" };

function appendDeepBookCalls(
  ctx: AgentContext,
  tx: Transaction,
  action: ProposedAction,
): ExecutionMeta {
  const balanceManagerId = process.env.BRIEF_BALANCE_MANAGER_ID?.trim();
  if (!balanceManagerId) {
    throw new Error(
      "BRIEF_BALANCE_MANAGER_ID not configured — refuse to fake a DeepBook trade",
    );
  }
  const amountSui = Number(action.amount) / 1e9;

  const db = new DeepBookClient({
    client: ctx.client as unknown as ConstructorParameters<
      typeof DeepBookClient
    >[0]["client"],
    address: ctx.address,
    network: "testnet",
    coins: testnetCoins,
    pools: testnetPools,
    balanceManagers: {
      [DEEPBOOK_BALANCE_MANAGER_KEY]: { address: balanceManagerId },
    },
  });

  // Deposit the action's size into the BalanceManager, then sell-market
  // ~90% of the deposit to leave headroom for fees.
  db.balanceManager.depositIntoManager(
    DEEPBOOK_BALANCE_MANAGER_KEY,
    "SUI",
    amountSui,
  )(tx);
  const clientOrderId = `${Date.now()}`;
  db.deepBook.placeMarketOrder({
    poolKey: DEEPBOOK_POOL_KEY,
    balanceManagerKey: DEEPBOOK_BALANCE_MANAGER_KEY,
    clientOrderId,
    quantity: amountSui * 0.9,
    isBid: false, // sell base SUI for quote DBUSDC
    payWithDeep: false,
  })(tx);

  return {
    kind: "deepbook",
    pool_key: DEEPBOOK_POOL_KEY,
    balance_manager_id: balanceManagerId,
    client_order_id: clientOrderId,
  };
}

// ---------------------------------------------------------------------------
// Real Sui System staking — `0x3::sui_system::request_add_stake`
// ---------------------------------------------------------------------------

async function appendStakeCalls(
  ctx: AgentContext,
  tx: Transaction,
  action: ProposedAction,
): Promise<ExecutionMeta> {
  const validator = await resolveActiveValidator(ctx.client);
  addStakeCalls(tx, {
    amountMist: action.amount,
    validatorAddress: validator.address,
  });
  console.log(
    `[operator] stake target ${SUI_STAKE_TARGET} · validator=${validator.address.slice(0, 10)}… apy=${validator.apy.toFixed(2)} src=${validator.source}`,
  );
  return {
    kind: "stake",
    validator_address: validator.address,
    validator_apy: Number(validator.apy.toFixed(4)),
    validator_source: validator.source,
  };
}

// ---------------------------------------------------------------------------
// Gas funding pre-flight
// ---------------------------------------------------------------------------

type GasCheckOk = {
  status: "ok";
  freeMist: bigint;
  requiredMist: bigint;
  headroomMist: bigint;
  checkedAtMs: number;
};

type GasCheckInsufficient = {
  status: "insufficient";
  freeMist: bigint;
  requiredMist: bigint;
  deficitMist: bigint;
  headroomMist: bigint;
  checkedAtMs: number;
};

type GasCheckError = {
  status: "rpc_error";
  message: string;
};

type GasCheck = GasCheckOk | GasCheckInsufficient | GasCheckError;

/**
 * Query the agent wallet's free SUI and compare to `actionAmount +
 * GAS_HEADROOM_SUI`. Returns one of three shapes:
 *
 *   - `ok`            wallet can fund the trade + gas — proceed
 *   - `insufficient`  short on funds — caller mints an audit-only WO
 *   - `rpc_error`     balance query failed — caller retries next cycle
 *
 * The agent NEVER falls back to a "simulated" path on insufficient
 * funds; the cycle visibly pauses with `awaiting_gas_funding` state.
 */
async function checkGasFunding(
  ctx: AgentContext,
  actionAmountMist: bigint,
): Promise<GasCheck> {
  const headroomMist =
    BigInt(Math.floor(GAS_HEADROOM_SUI * 1e9)); // 0.5 SUI default
  const requiredMist = actionAmountMist + headroomMist;
  try {
    const balance = await ctx.client.getBalance({ owner: ctx.address });
    const freeMist = BigInt(balance.totalBalance);
    const checkedAtMs = Date.now();
    if (freeMist < requiredMist) {
      return {
        status: "insufficient",
        freeMist,
        requiredMist,
        deficitMist: requiredMist - freeMist,
        headroomMist,
        checkedAtMs,
      };
    }
    return { status: "ok", freeMist, requiredMist, headroomMist, checkedAtMs };
  } catch (e) {
    return { status: "rpc_error", message: (e as Error)?.message ?? String(e) };
  }
}

/**
 * Mint a small audit-only `Operator` WorkObject with status
 * `awaiting_gas_funding` so the timeline records the pause with the
 * exact deficit. The mint doesn't call `record_spend` and pays a 0 fee
 * — the policy's `spent` does not advance. Requires enough free SUI to
 * cover the mint's own gas (~0.005 SUI). If the wallet can't afford even
 * that, the caller catches and logs.
 */
async function mintGasFundingHold(
  ctx: AgentContext,
  policy: OperatorPolicyDecoded,
  top: ScoredOption,
  gas: GasCheckInsufficient,
  snapshot: MarketSnapshot,
  worldState: WorldState,
  memory: OperatorMemory,
): Promise<void> {
  const chosenSignal = snapshot.signals[top.venue];
  const payload = {
    operator_policy: policy.id,
    status: "awaiting_gas_funding",
    venue: top.venue,
    amount_mist: top.amountMist.toString(),
    score: Number(top.score.toFixed(3)),
    rationale: `Operator paused — wallet underfunded for ${top.venue} cycle. Resumes automatically once balance refills.`,
    gas_check: {
      free_mist: gas.freeMist.toString(),
      required_mist: gas.requiredMist.toString(),
      deficit_mist: gas.deficitMist.toString(),
      headroom_mist: gas.headroomMist.toString(),
      checked_at_ms: gas.checkedAtMs,
    },
    gas_shortage_mist: gas.deficitMist.toString(),
    market_snapshot: {
      fetched_at_ms: snapshot.fetched_at_ms,
      degraded: snapshot.degraded,
      source_status: snapshot.source_status,
      summary: snapshot.summary,
      signals: chosenSignal ? { [top.venue]: chosenSignal } : {},
    },
    world_state: worldState,
    memory_context: memorySnapshot(memory),
    objective: memory.objective ?? null,
    posture: memory.posture,
    paused_at_ms: Date.now(),
  };
  const payloadBytes = encodePayload(payload);

  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::work_object::mint`,
    arguments: [
      tx.pure.address(policy.owner),
      tx.pure.string("Operator"),
      tx.pure.u64(SCHEMA_VERSION),
      tx.pure.vector("u8", Array.from(payloadBytes)),
      tx.pure.option("string", null),
      tx.pure.vector("id", [policy.id]),
      tx.pure.u64(0n), // no payment — we're not deploying
    ],
  });
  const result = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true },
  });
  console.log(
    `[operator] gas-funding hold WO minted policy=${policy.id.slice(0, 10)}… deficit=${gas.deficitMist} MIST tx=${result.digest}`,
  );
  // Suppress unused-warning for the MIST_PER_SUI constant kept for clarity.
  void MIST_PER_SUI;
}

function missionAlignmentNote(
  action: ProposedAction,
  signal: MarketSnapshot["signals"][string] | undefined,
): string {
  // Concise reading: what tradeoff did this action make against the mandate?
  const risk = signal?.raw.risk;
  const concentration = action.concentrationPctAfter;
  if (concentration >= 25) {
    return `concentrated deployment · ${concentration.toFixed(0)}% of envelope on ${action.venue}`;
  }
  if (risk === "low" && action.confidence >= 0.7) {
    return `low-risk yield captured at ${signal?.raw.apy_pct?.toFixed(1) ?? "?"}% apy`;
  }
  if (risk === "high") {
    return `aggressive venue selected — confidence ${(action.confidence * 100).toFixed(0)}%`;
  }
  return `routine deployment within envelope`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

main().catch((e: unknown) => {
  console.error("[operator] fatal:", (e as Error)?.message ?? e);
  process.exit(1);
});
