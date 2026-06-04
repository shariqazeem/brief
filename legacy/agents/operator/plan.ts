// Plan composer — turns a user's English goal into a structured multi-step
// plan the operator executes deterministically. Single LLM call per plan;
// agent at rest costs zero. Falls back to a rule-based plan if the LLM is
// unavailable (no key / 5xx / parse failure) so the loop never blocks.

import { callLlm, extractJson, llmMode, type LlmEnv } from "../lib/llm.js";
import type { MarketSnapshot } from "./signals.js";
import type { WorldState } from "./world-state.js";
import type { OperatorPolicyDecoded } from "../lib/operator-policy.js";

// ---------------------------------------------------------------------------
// Plan schema — versioned so the agent can refuse to execute future shapes.
// ---------------------------------------------------------------------------

export const PLAN_SCHEMA_VERSION = 1;

export type PlanStepStatus = "pending" | "active" | "done" | "skipped" | "failed";

export type PlanStepVenue = "SuiSystem" | "DeepBook";

export type PlanStepTrigger =
  | { kind: "immediate" }
  | { kind: "deepbook_spread_below_bps"; bps: number }
  | { kind: "deepbook_spread_above_bps"; bps: number }
  | { kind: "validator_apy_above_pct"; pct: number }
  | { kind: "validator_apy_below_pct"; pct: number }
  | { kind: "after_step"; step_id: string };

export type PlanStep = {
  id: string;
  venue: PlanStepVenue;
  intent: string;
  amount_sui: number;
  trigger: PlanStepTrigger;
  max_attempts: number;
  status: PlanStepStatus;
};

export type RebalanceTrigger =
  | { kind: "drawdown_above_pct"; pct: number }
  | { kind: "validator_apy_drift_below_pct"; pct: number }
  | { kind: "deepbook_spread_widens_above_bps"; bps: number };

export type Plan = {
  schema_version: number;
  thesis: string;
  reasoning_summary: string;
  goal_text: string;
  steps: PlanStep[];
  rebalance_triggers: RebalanceTrigger[];
  model_tag: string;
  source: "llm" | "fallback";
  created_at_ms: number;
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export type PlanComposerInput = {
  goalText: string;
  policy: OperatorPolicyDecoded;
  snapshot: MarketSnapshot;
  worldState: WorldState;
  /** Optional live SuiSystem APY% so the LLM can reason about it (signals.SuiSystem
   * doesn't carry real validator APY — that's fetched separately in staking.ts). */
  validatorApyPct?: number | null;
};

/**
 * Compose a plan. Returns the structured plan + the raw reasoning text
 * (so the caller can offload to Walrus). Never throws — falls back to a
 * deterministic heuristic plan when the LLM is unavailable so the operator
 * loop is never blocked on inference.
 */
export async function composePlan(
  input: PlanComposerInput,
): Promise<{ plan: Plan; rawReasoning: string }> {
  const env: LlmEnv = {
    commonstackApiKey: process.env.COMMONSTACK_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  };

  if (llmMode(env) === "mock" || !env.commonstackApiKey) {
    const plan = fallbackPlan(input, "llm_disabled");
    return { plan, rawReasoning: "LLM disabled — fallback heuristic plan." };
  }

  // Commonstack accounts often have a concurrency cap of 1 — two parallel
  // operator loops both calling composePlan trip a 429 "Limit Exceed" on
  // the second. Serialize per process so back-to-back plans share the lane.
  await acquireLlmLane();
  try {
    const prompt = buildPrompt(input);
    const raw = await callLlm({
      apiKey: env.commonstackApiKey,
      system: SYSTEM_PROMPT,
      prompt,
      jsonSchemaHint: JSON_SCHEMA_HINT,
      maxTokens: 800,
    });
    const parsed = extractJson<LlmPlanResponse>(raw);
    const plan = normalizePlan(parsed, input, raw);
    return { plan, rawReasoning: raw };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.warn(`[plan] LLM compose failed (${msg}) — falling back`);
    const plan = fallbackPlan(input, "llm_error");
    return {
      plan,
      rawReasoning: `LLM call failed: ${msg}\n\nUsing fallback heuristic plan.`,
    };
  } finally {
    releaseLlmLane();
  }
}

// Tiny in-process mutex. Only ONE LLM compose in flight per agent process —
// matches the Commonstack account's concurrency cap so we don't waste a
// call to land a 429. Queued callers wait their turn; nothing reorders.
let llmLaneBusy = false;
const llmLaneWaiters: Array<() => void> = [];

async function acquireLlmLane(): Promise<void> {
  if (!llmLaneBusy) {
    llmLaneBusy = true;
    return;
  }
  return new Promise<void>((resolve) => {
    llmLaneWaiters.push(resolve);
  });
}

function releaseLlmLane(): void {
  const next = llmLaneWaiters.shift();
  if (next) {
    // Hand the lane to the next waiter directly — busy stays true.
    next();
  } else {
    llmLaneBusy = false;
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  "You are the planning agent for a policy-bound autonomous operator on Sui testnet.",
  "Your job: read the user's plain-English goal + on-chain policy + live market signal,",
  "and produce a deterministic multi-step plan the runtime executes step by step.",
  "",
  "HARD RULES:",
  "1. Only venues SuiSystem (staking) and DeepBook (SUI/DBUSDC market making) exist.",
  "2. Sui System staking minimum is 1 SUI per step. Never propose a SuiSystem step below 1.0 SUI.",
  "3. Total of step amounts MUST be <= the policy budget cap.",
  "4. No single step may exceed (budget × max_concentration_fraction).",
  "5. Steps execute in order. Each step has one venue, one amount, one trigger.",
  "6. Triggers gate when a step starts. Use {kind: 'immediate'} for steps that should run now.",
  "7. rebalance_triggers fire AFTER the plan is executing — keep to 0-2 of them.",
  "8. Output JSON ONLY. No prose outside the JSON object.",
].join("\n");

const JSON_SCHEMA_HINT = `{
  "thesis": string,
  "reasoning_summary": string,
  "steps": [
    {
      "id": string,
      "venue": "SuiSystem" | "DeepBook",
      "intent": string,
      "amount_sui": number,
      "trigger": { "kind": "immediate" } |
                 { "kind": "deepbook_spread_below_bps", "bps": number } |
                 { "kind": "deepbook_spread_above_bps", "bps": number } |
                 { "kind": "validator_apy_above_pct", "pct": number } |
                 { "kind": "validator_apy_below_pct", "pct": number } |
                 { "kind": "after_step", "step_id": string },
      "max_attempts": number
    }
  ],
  "rebalance_triggers": [
    { "kind": "drawdown_above_pct", "pct": number } |
    { "kind": "validator_apy_drift_below_pct", "pct": number } |
    { "kind": "deepbook_spread_widens_above_bps", "bps": number }
  ]
}`;

function buildPrompt(input: PlanComposerInput): string {
  const { goalText, policy, snapshot, worldState, validatorApyPct } = input;
  const budgetSui = Number(policy.budgetCap) / 1e9;
  const spentSui = Number(policy.spent) / 1e9;
  const remainingSui = budgetSui - spentSui;
  const hoursToExpiry =
    (Number(policy.expiresAtMs) - Date.now()) / (1000 * 60 * 60);
  const concentrationPct = policy.maxConcentrationBps / 100;
  const dbSig = snapshot.signals.DeepBook;

  return [
    `User goal: "${goalText}"`,
    ``,
    `Policy (on-chain, immutable for this plan):`,
    `  - Budget cap: ${budgetSui.toFixed(2)} SUI`,
    `  - Already spent: ${spentSui.toFixed(2)} SUI`,
    `  - Remaining envelope: ${remainingSui.toFixed(2)} SUI`,
    `  - Max concentration per venue: ${concentrationPct.toFixed(0)}% of budget`,
    `  - Allowed venues: ${policy.allowedVenues.join(", ")}`,
    `  - Risk tolerance: ${policy.riskTolerance}`,
    `  - Hours until expiry: ${Math.max(0, hoursToExpiry).toFixed(1)}`,
    ``,
    `Live market signal (taken ${Math.round((Date.now() - snapshot.fetched_at_ms) / 1000)}s ago):`,
    `  - DeepBook SUI/DBUSDC: spread ${formatBps(dbSig?.raw.spread_bps)}, depth ${formatNum(dbSig?.raw.depth_sui)} SUI`,
    `  - SuiSystem top validator APY: ${formatPct(validatorApyPct ?? null)}`,
    `  - World regime: ${worldState.regime} — ${worldState.caption}`,
    `  - Data degraded: ${snapshot.degraded}`,
    ``,
    `Produce a plan of 1-4 steps that pursues the goal within the policy.`,
    `Aim for an end-state allocation that matches the goal's risk and time horizon.`,
    `If the goal mentions a specific condition ("stake unless DeepBook spreads tighten below 30 bps"),`,
    `encode that into triggers, not prose.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// LLM response → typed Plan, with normalization + clamping
// ---------------------------------------------------------------------------

type LlmPlanResponse = {
  thesis?: unknown;
  reasoning_summary?: unknown;
  steps?: unknown;
  rebalance_triggers?: unknown;
};

const DEFAULT_MODEL_TAG = "deepseek/deepseek-v4-flash";

function normalizePlan(
  raw: LlmPlanResponse,
  input: PlanComposerInput,
  rawText: string,
): Plan {
  const stepsArr = Array.isArray(raw.steps) ? raw.steps : [];
  const triggersArr = Array.isArray(raw.rebalance_triggers)
    ? raw.rebalance_triggers
    : [];

  const budgetSui = Number(input.policy.budgetCap) / 1e9;
  const maxPerStepSui = budgetSui * (input.policy.maxConcentrationBps / 10000);

  const steps: PlanStep[] = [];
  let runningTotal = 0;
  for (let i = 0; i < stepsArr.length && steps.length < 4; i++) {
    const s = stepsArr[i] as Record<string, unknown>;
    const venue = String(s?.venue ?? "");
    if (venue !== "SuiSystem" && venue !== "DeepBook") continue;
    if (!input.policy.allowedVenues.includes(venue)) continue;

    let amount = Number(s?.amount_sui ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    amount = Math.min(amount, maxPerStepSui);
    if (venue === "SuiSystem" && amount < 1.0) amount = 1.0;
    if (runningTotal + amount > budgetSui) amount = budgetSui - runningTotal;
    if (amount <= 0) break;
    runningTotal += amount;

    const trigger = normalizeTrigger(s?.trigger);
    const id = typeof s?.id === "string" && s.id ? s.id : `step-${steps.length + 1}`;
    const intent =
      typeof s?.intent === "string"
        ? s.intent.slice(0, 160)
        : defaultIntent(venue, amount);
    const maxAttempts =
      typeof s?.max_attempts === "number" && s.max_attempts > 0
        ? Math.min(Math.floor(s.max_attempts), 8)
        : 3;

    steps.push({
      id,
      venue,
      intent,
      amount_sui: round4(amount),
      trigger,
      max_attempts: maxAttempts,
      status: "pending",
    });
  }

  if (steps.length === 0) {
    return fallbackPlan(input, "llm_no_valid_steps");
  }

  const rebalanceTriggers: RebalanceTrigger[] = [];
  for (const t of triggersArr.slice(0, 2)) {
    const norm = normalizeRebalanceTrigger(t);
    if (norm) rebalanceTriggers.push(norm);
  }

  const thesis =
    typeof raw.thesis === "string" && raw.thesis.trim()
      ? raw.thesis.trim().slice(0, 320)
      : `Pursue: ${input.goalText.slice(0, 200)}`;
  const reasoningSummary =
    typeof raw.reasoning_summary === "string" && raw.reasoning_summary.trim()
      ? raw.reasoning_summary.trim().slice(0, 320)
      : "";

  return {
    schema_version: PLAN_SCHEMA_VERSION,
    thesis,
    reasoning_summary: reasoningSummary,
    goal_text: input.goalText,
    steps,
    rebalance_triggers: rebalanceTriggers,
    model_tag: DEFAULT_MODEL_TAG,
    source: "llm",
    created_at_ms: Date.now(),
  };
  void rawText; // raw text is offloaded to Walrus by the caller
}

function normalizeTrigger(raw: unknown): PlanStepTrigger {
  if (!raw || typeof raw !== "object") return { kind: "immediate" };
  const r = raw as Record<string, unknown>;
  const k = String(r.kind ?? "");
  if (k === "immediate") return { kind: "immediate" };
  if (k === "deepbook_spread_below_bps" && typeof r.bps === "number") {
    return { kind: "deepbook_spread_below_bps", bps: r.bps };
  }
  if (k === "deepbook_spread_above_bps" && typeof r.bps === "number") {
    return { kind: "deepbook_spread_above_bps", bps: r.bps };
  }
  if (k === "validator_apy_above_pct" && typeof r.pct === "number") {
    return { kind: "validator_apy_above_pct", pct: r.pct };
  }
  if (k === "validator_apy_below_pct" && typeof r.pct === "number") {
    return { kind: "validator_apy_below_pct", pct: r.pct };
  }
  if (k === "after_step" && typeof r.step_id === "string") {
    return { kind: "after_step", step_id: r.step_id };
  }
  return { kind: "immediate" };
}

function normalizeRebalanceTrigger(raw: unknown): RebalanceTrigger | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const k = String(r.kind ?? "");
  if (k === "drawdown_above_pct" && typeof r.pct === "number") {
    return { kind: "drawdown_above_pct", pct: r.pct };
  }
  if (k === "validator_apy_drift_below_pct" && typeof r.pct === "number") {
    return { kind: "validator_apy_drift_below_pct", pct: r.pct };
  }
  if (k === "deepbook_spread_widens_above_bps" && typeof r.bps === "number") {
    return { kind: "deepbook_spread_widens_above_bps", bps: r.bps };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fallback heuristic — runs when LLM is unavailable or returns garbage.
// Honors the same constraints (1 SUI stake floor, concentration cap).
// ---------------------------------------------------------------------------

function fallbackPlan(input: PlanComposerInput, reason: string): Plan {
  const { policy, goalText } = input;
  const budgetSui = Number(policy.budgetCap) / 1e9;
  const maxPerStepSui = budgetSui * (policy.maxConcentrationBps / 10000);
  const allowsStake = policy.allowedVenues.includes("SuiSystem");
  const allowsDb = policy.allowedVenues.includes("DeepBook");

  const steps: PlanStep[] = [];
  if (allowsStake && allowsDb) {
    // 70/30 stake/LP split
    const stakeAmt = Math.max(1.0, Math.min(maxPerStepSui, budgetSui * 0.7));
    const lpAmt = Math.min(maxPerStepSui, budgetSui - stakeAmt);
    if (stakeAmt >= 1.0) {
      steps.push({
        id: "step-1",
        venue: "SuiSystem",
        intent: `Stake ${stakeAmt.toFixed(2)} SUI to the highest-APY active validator`,
        amount_sui: round4(stakeAmt),
        trigger: { kind: "immediate" },
        max_attempts: 3,
        status: "pending",
      });
    }
    if (lpAmt > 0.05) {
      steps.push({
        id: "step-2",
        venue: "DeepBook",
        intent: `Provide ${lpAmt.toFixed(2)} SUI of liquidity on the DeepBook SUI/DBUSDC pool`,
        amount_sui: round4(lpAmt),
        trigger: { kind: "immediate" },
        max_attempts: 3,
        status: "pending",
      });
    }
  } else if (allowsStake) {
    const amt = Math.max(1.0, Math.min(maxPerStepSui, budgetSui));
    steps.push({
      id: "step-1",
      venue: "SuiSystem",
      intent: `Stake ${amt.toFixed(2)} SUI to the highest-APY active validator`,
      amount_sui: round4(amt),
      trigger: { kind: "immediate" },
      max_attempts: 3,
      status: "pending",
    });
  } else if (allowsDb) {
    const amt = Math.min(maxPerStepSui, budgetSui);
    steps.push({
      id: "step-1",
      venue: "DeepBook",
      intent: `Provide ${amt.toFixed(2)} SUI of liquidity on the DeepBook SUI/DBUSDC pool`,
      amount_sui: round4(amt),
      trigger: { kind: "immediate" },
      max_attempts: 3,
      status: "pending",
    });
  }

  return {
    schema_version: PLAN_SCHEMA_VERSION,
    thesis:
      goalText.trim()
        ? `Pursue: ${goalText.slice(0, 200)}`
        : "Operate within the envelope using a baseline allocation.",
    reasoning_summary: `Fallback heuristic plan (${reason}). 70/30 stake/LP if both venues allowed, else single-venue full allocation.`,
    goal_text: goalText,
    steps,
    rebalance_triggers: [],
    model_tag: "fallback/heuristic",
    source: "fallback",
    created_at_ms: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Plan execution helpers — used by the operator loop to drive the runtime.
// ---------------------------------------------------------------------------

/** Find the next executable step: pending, with a satisfied trigger. */
export function nextExecutableStep(
  plan: Plan,
  snapshot: MarketSnapshot,
): PlanStep | null {
  for (const step of plan.steps) {
    if (step.status !== "pending") continue;
    if (!triggerSatisfied(step.trigger, plan, snapshot)) continue;
    return step;
  }
  return null;
}

export function triggerSatisfied(
  trigger: PlanStepTrigger,
  plan: Plan,
  snapshot: MarketSnapshot,
): boolean {
  switch (trigger.kind) {
    case "immediate":
      return true;
    case "after_step": {
      const dep = plan.steps.find((s) => s.id === trigger.step_id);
      return !!dep && (dep.status === "done" || dep.status === "skipped");
    }
    case "deepbook_spread_below_bps": {
      const bps = snapshot.signals.DeepBook?.raw.spread_bps;
      return typeof bps === "number" && bps < trigger.bps;
    }
    case "deepbook_spread_above_bps": {
      const bps = snapshot.signals.DeepBook?.raw.spread_bps;
      return typeof bps === "number" && bps > trigger.bps;
    }
    case "validator_apy_above_pct": {
      const apy = snapshot.signals.SuiSystem?.raw.apy_pct;
      return typeof apy === "number" && apy > trigger.pct;
    }
    case "validator_apy_below_pct": {
      const apy = snapshot.signals.SuiSystem?.raw.apy_pct;
      return typeof apy === "number" && apy < trigger.pct;
    }
  }
}

export function planExhausted(plan: Plan): boolean {
  return plan.steps.every(
    (s) => s.status === "done" || s.status === "skipped" || s.status === "failed",
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function defaultIntent(venue: PlanStepVenue, amount: number): string {
  if (venue === "SuiSystem") {
    return `Stake ${amount.toFixed(2)} SUI to the highest-APY validator`;
  }
  return `Provide ${amount.toFixed(2)} SUI of liquidity on DeepBook SUI/DBUSDC`;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function formatBps(n: number | null | undefined): string {
  if (typeof n !== "number") return "n/a";
  return `${n.toFixed(0)} bps`;
}

function formatNum(n: number | null | undefined): string {
  if (typeof n !== "number") return "n/a";
  return n.toFixed(2);
}

function formatPct(n: number | null | undefined): string {
  if (typeof n !== "number") return "n/a";
  return `${n.toFixed(2)}%`;
}
