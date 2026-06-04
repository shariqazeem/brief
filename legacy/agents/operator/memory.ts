// Per-policy in-memory state for the operator agent. Lets the decision
// pipeline behave as if it remembers prior actions (concentration, recent
// rotations, score history, mission objective, behavioral posture) without
// requiring a database.
//
// On agent process restart this map is empty — but `hydration.ts` walks
// the agent's own past Operator + Rejection WorkObjects on-chain and
// rebuilds memory, so a fresh process resumes with continuity.

import type { Plan, PlanStepStatus } from "./plan.js";

export type ReplanReason =
  | "user_requested"
  | "exhausted"
  | "regime_shift"
  | "abort_cluster";

export type OperatorPosture =
  | "neutral"        // baseline
  | "defensive"      // many recent rejections / near exhaustion / kill regime
  | "assured"        // long streak of high-confidence decisive actions
  | "exploratory";   // multiple consecutive HOLDs — broaden venue selection

/**
 * Reason a cycle did NOT deploy capital. Tracked in memory so the next
 * successful WorkObject embeds the recent skip history, and so the
 * "agent paused" beats are auditable.
 */
export type SkipReason =
  | "below_threshold"          // no venue scored above SKIP_THRESHOLD
  | "awaiting_gas_funding"     // wallet free SUI < amount + gas headroom
  | "awaiting_validator"       // staking path couldn't resolve a validator
  | "no_executable_venue"      // policy authorizes only non-executable venues
  | null;

export type OperatorMemory = {
  policyId: string;
  cycles: number;
  /** Recent venue choices, newest first, capped at 5. */
  recentVenues: string[];
  /** Per-venue total spent (in MIST) so we can compute current concentration. */
  venueDeployedMist: Record<string, bigint>;
  /** Per-venue cycle count — used to detect "held N cycles in a row." */
  venueCounts: Record<string, number>;
  /** Last action's chosen score (0–1). */
  lastScore: number;
  /** Rolling mean of confidence over recent actions (0–1). */
  averageConfidence: number;
  /** Last action's MIST size. */
  lastActionSizeMist: bigint;
  /** Last action's wall-clock ms. */
  lastActionAtMs: number;
  /** Total Operator actions minted under this policy. */
  totalActions: number;
  /** Total Rejection WorkObjects minted under this policy. */
  rejectedAttempts: number;
  /** Last detected concentration fraction (0–1) on the active venue. */
  lastConcentration: number;
  /** How many consecutive cycles ended without deploying. */
  consecutiveHolds: number;
  /** How many consecutive on-chain rejections happened. */
  consecutiveRejections: number;
  /** How many consecutive cycles ended in awaiting_gas_funding. Drives
   *  the visible "agent paused" badge and posture defensiveness. */
  consecutiveGasShortfalls: number;
  /** Lifetime count of gas-funding skips for this policy. */
  totalGasShortfalls: number;
  /** Last cycle's gas deficit, in MIST. 0 when not gas-shortfalling. */
  lastGasDeficitMist: bigint;
  /** Why the last non-deploy cycle skipped. */
  lastSkipReason: SkipReason;
  /** Operational tilt derived from recent outcomes. */
  posture: OperatorPosture;
  /** User-supplied mandate copy ("Preserve capital while …"). Off-chain; the
   *  policy's Move struct has no objective field, so we store it per-loop. */
  objective?: string;
  /** True once hydration from chain history has been attempted at least once. */
  hydrated: boolean;
  /** Currently-active multi-step plan composed by the LLM (or fallback). Null
   *  before the first plan has been minted; set after Strategy WO is on-chain. */
  activePlan: Plan | null;
  /** On-chain id of the StrategyObject WO carrying the active plan. */
  activePlanWoId: string | null;
  /** When a re-plan is pending. Set by user-triggered /api/operator/replan
   *  or by the loop itself on auto-triggers (exhausted / regime_shift). The
   *  loop consumes this on its next cycle, clears it, and composes a new plan. */
  replanRequested: { reason: ReplanReason; at: number } | null;
};

const STORE = new Map<string, OperatorMemory>();

export function getMemory(policyId: string): OperatorMemory {
  let m = STORE.get(policyId);
  if (!m) {
    m = {
      policyId,
      cycles: 0,
      recentVenues: [],
      venueDeployedMist: {},
      venueCounts: {},
      lastScore: 0.5,
      averageConfidence: 0.5,
      lastActionSizeMist: 0n,
      lastActionAtMs: 0,
      totalActions: 0,
      rejectedAttempts: 0,
      lastConcentration: 0,
      consecutiveHolds: 0,
      consecutiveRejections: 0,
      consecutiveGasShortfalls: 0,
      totalGasShortfalls: 0,
      lastGasDeficitMist: 0n,
      lastSkipReason: null,
      posture: "neutral",
      objective: undefined,
      hydrated: false,
      activePlan: null,
      activePlanWoId: null,
      replanRequested: null,
    };
    STORE.set(policyId, m);
  }
  return m;
}

export function setActivePlan(
  policyId: string,
  plan: Plan,
  strategyObjectId: string,
): void {
  const m = getMemory(policyId);
  m.activePlan = plan;
  m.activePlanWoId = strategyObjectId;
  // A fresh plan resets the rejection streak so a prior bad cycle doesn't
  // immediately re-trigger an abort-cluster re-plan.
  m.consecutiveRejections = 0;
}

export function updatePlanStepStatus(
  policyId: string,
  stepId: string,
  status: PlanStepStatus,
): void {
  const m = getMemory(policyId);
  if (!m.activePlan) return;
  const step = m.activePlan.steps.find((s) => s.id === stepId);
  if (!step) return;
  step.status = status;
}

export function requestReplan(policyId: string, reason: ReplanReason): void {
  const m = getMemory(policyId);
  // De-dupe: if a re-plan is already queued, don't overwrite with a different
  // reason — the first reason wins for telemetry clarity.
  if (m.replanRequested) return;
  m.replanRequested = { reason, at: Date.now() };
}

export function consumeReplanRequest(policyId: string): ReplanReason | null {
  const m = getMemory(policyId);
  const req = m.replanRequested;
  if (!req) return null;
  m.replanRequested = null;
  return req.reason;
}

export function setObjective(policyId: string, objective: string | undefined): void {
  if (!objective) return;
  const m = getMemory(policyId);
  m.objective = objective;
}

export function recordAction(
  policyId: string,
  venue: string,
  amount: bigint,
  score: number,
  confidence: number,
  concentrationFracAfter: number,
): void {
  const m = getMemory(policyId);
  m.cycles++;
  m.totalActions++;
  m.recentVenues = [venue, ...m.recentVenues.filter((v) => v !== venue)].slice(0, 5);
  m.venueDeployedMist[venue] = (m.venueDeployedMist[venue] ?? 0n) + amount;
  m.venueCounts[venue] = (m.venueCounts[venue] ?? 0) + 1;
  m.lastScore = score;
  m.lastActionSizeMist = amount;
  m.lastActionAtMs = Date.now();
  m.lastConcentration = concentrationFracAfter;
  m.consecutiveHolds = 0;
  m.consecutiveRejections = 0;
  m.consecutiveGasShortfalls = 0;
  m.lastSkipReason = null;
  m.lastGasDeficitMist = 0n;
  // Exponential moving average of confidence — α=0.30 → fairly responsive
  // but smooths out single-cycle blips.
  m.averageConfidence = m.averageConfidence * 0.7 + confidence * 0.3;
  m.posture = derivePosture(m);
}

export function recordCycleSkip(
  policyId: string,
  reason: SkipReason = "below_threshold",
): void {
  const m = getMemory(policyId);
  m.cycles++;
  m.consecutiveHolds++;
  m.consecutiveRejections = 0;
  m.lastSkipReason = reason;
  if (reason !== "awaiting_gas_funding") {
    m.consecutiveGasShortfalls = 0;
    m.lastGasDeficitMist = 0n;
  }
  m.posture = derivePosture(m);
}

/**
 * Record a cycle that couldn't deploy because the agent wallet was
 * underfunded. Tracked separately so the audit trail can surface
 * `awaiting_gas_funding` beats without conflating them with "no good
 * opportunity" holds.
 */
export function recordGasShortfall(
  policyId: string,
  deficitMist: bigint,
): void {
  const m = getMemory(policyId);
  m.cycles++;
  m.consecutiveGasShortfalls++;
  m.totalGasShortfalls++;
  m.lastGasDeficitMist = deficitMist;
  m.lastSkipReason = "awaiting_gas_funding";
  // Don't reset consecutiveHolds — a gas shortfall is also a non-deploy.
  m.consecutiveHolds++;
  m.consecutiveRejections = 0;
  m.posture = derivePosture(m);
}

export function recordRejection(policyId: string): void {
  const m = getMemory(policyId);
  m.rejectedAttempts++;
  m.consecutiveRejections++;
  m.consecutiveHolds = 0;
  m.consecutiveGasShortfalls = 0;
  m.lastGasDeficitMist = 0n;
  m.posture = derivePosture(m);
}

/**
 * Derive a behavioral posture from current memory state. The output is the
 * sole input the evaluator uses for the "adaptive tone" tilt — keeping the
 * derivation here (one function) makes the whole signal auditable.
 */
function derivePosture(m: OperatorMemory): OperatorPosture {
  if (m.consecutiveRejections >= 2) return "defensive";
  if (m.consecutiveGasShortfalls >= 2) return "defensive";
  if (m.consecutiveHolds >= 3) return "exploratory";
  if (m.averageConfidence >= 0.72 && m.totalActions >= 3) return "assured";
  return "neutral";
}

/** Snapshot of memory the operator embeds into Operator payloads. */
export function memorySnapshot(m: OperatorMemory): {
  posture: OperatorPosture;
  cycles: number;
  total_actions: number;
  rejected_attempts: number;
  consecutive_holds: number;
  consecutive_rejections: number;
  consecutive_gas_shortfalls: number;
  total_gas_shortfalls: number;
  last_gas_deficit_mist: string;
  last_skip_reason: SkipReason;
  average_confidence: number;
  recent_venues: string[];
  hydrated: boolean;
} {
  return {
    posture: m.posture,
    cycles: m.cycles,
    total_actions: m.totalActions,
    rejected_attempts: m.rejectedAttempts,
    consecutive_holds: m.consecutiveHolds,
    consecutive_rejections: m.consecutiveRejections,
    consecutive_gas_shortfalls: m.consecutiveGasShortfalls,
    total_gas_shortfalls: m.totalGasShortfalls,
    last_gas_deficit_mist: m.lastGasDeficitMist.toString(),
    last_skip_reason: m.lastSkipReason,
    average_confidence: Number(m.averageConfidence.toFixed(3)),
    recent_venues: [...m.recentVenues],
    hydrated: m.hydrated,
  };
}

/**
 * Forget everything we knew about this policy — called when the loop ends
 * (revoked / expired / exhausted). Keeps the in-memory map from growing
 * unbounded across long-running sessions.
 */
export function forgetPolicy(policyId: string): void {
  STORE.delete(policyId);
}
