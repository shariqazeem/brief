// AI advisor · the load-bearing LLM decision layer (Phase 1).
//
// Brief's engine is deterministic by default. This turns it into an LLM-GUIDED
// agent: on a budget-safe cadence, it sends the operator's real context to
// CommonStack and returns a confidence MODIFIER, a direction, a veto, and a
// thesis. The caller folds these into the decision engine via `opts.ai` (so they
// actually move the act-gate + allocator), and the Move policy still gates
// execution downstream. The AI can sharpen or veto conviction; it can NEVER
// fabricate a trade the deterministic signals don't support, and it can NEVER
// touch funds — that stays on-chain.
//
// COST SAFETY: only called when a trade is plausible (tradeable regime + a base
// confidence floor), rate-limited per operator, and hard-capped per week — so it
// stays inside the small LLM budget. Returns null (→ deterministic) on mock
// mode, a missing key, or any error.

import { callLlm, extractJson, llmMode } from "../../lib/llm.js";
import { activeLlmKey, loadEnv } from "../../lib/env.js";

export type AiAdvice = {
  thesis: string;
  counterargument: string;
  /** Modifier applied to the deterministic confidence: -0.30 .. +0.20. */
  confidenceMod: number;
  direction: "up" | "down" | "abstain";
  /** Hard stand-down regardless of confidence. */
  veto: boolean;
  rationale: string;
  /** Model id, e.g. "claude-haiku-4-5". */
  source: string;
  /** The exact prompt + raw response · anchored to Walrus for verifiable AI. */
  prompt: string;
  raw: string;
};

export type AiAdvisorInput = {
  policyId: string;
  asset: string;
  midUsd: number;
  mode: string;
  regimeLabel: string;
  tradeable: boolean;
  baseConfidence: number;
  baseDirection: "up" | "down";
  roc30: number;
  roc4h: number;
  roc24h: number;
  rsi: number;
  vol: number;
  budgetUsedPct: number;
  exposurePct: number;
  portfolioUsd: number;
  recallNote: string;
  mandateNote?: string;
};

const AI_MIN_INTERVAL_MS = 8 * 60_000; // ≥8 min between AI calls per operator
const WEEKLY_CAP = 800; // hard backstop well under the LLM budget
const BASE_CONF_FLOOR = 0.18; // don't spend AI on obvious no-ops

const lastAiAt = new Map<string, number>();
let weekStartMs = 0;
let weekCalls = 0;

function withinWeeklyBudget(now: number): boolean {
  if (weekStartMs === 0 || now - weekStartMs > 7 * 24 * 3600_000) {
    weekStartMs = now;
    weekCalls = 0;
  }
  return weekCalls < WEEKLY_CAP;
}

/** True when a real LLM key is configured (BRIEF_LLM_MODE=llm or a key set). */
export function aiAdvisorActive(): boolean {
  return llmMode(loadEnv()) === "llm";
}

export async function maybeAiAdvise(
  input: AiAdvisorInput,
): Promise<AiAdvice | null> {
  const env = loadEnv();
  if (llmMode(env) !== "llm") return null; // mock / no key → deterministic
  const apiKey = activeLlmKey(env);
  if (!apiKey) return null;
  // Cost gates: only when a trade is plausible, rate-limited, under the weekly cap.
  if (!input.tradeable || input.baseConfidence < BASE_CONF_FLOOR) return null;
  const now = Date.now();
  if (now - (lastAiAt.get(input.policyId) ?? 0) < AI_MIN_INTERVAL_MS) return null;
  if (!withinWeeklyBudget(now)) return null;

  const model = process.env.COMMONSTACK_MODEL || "claude-haiku-4-5";
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const prompt = [
    `You are the risk-and-conviction advisor for an autonomous on-chain trading operator on Sui DeepBook.`,
    `Operator mode: ${input.mode} (protect = cautious, grow = balanced, aggressive = bolder).`,
    `Asset: ${input.asset} at $${input.midUsd}.`,
    `Market: regime "${input.regimeLabel}" (${input.tradeable ? "tradeable" : "stand-aside"}). ROC 30m ${pct(input.roc30)}, 4h ${pct(input.roc4h)}, 24h ${pct(input.roc24h)}. RSI ${input.rsi.toFixed(0)}. Realized vol ${pct(input.vol)}.`,
    `Position: ${pct(input.exposurePct)} of a $${input.portfolioUsd.toFixed(2)} book is in ${input.asset}; ${input.budgetUsedPct.toFixed(0)}% of the trading allowance used.`,
    `The deterministic engine leans ${input.baseDirection.toUpperCase()} at confidence ${input.baseConfidence.toFixed(2)} (0-1).`,
    input.recallNote ? `Memory of similar past setups: ${input.recallNote}` : ``,
    input.mandateNote ? `Owner mandate: ${input.mandateNote}` : ``,
    ``,
    `Your job: adjust conviction, not invent trades. You may sharpen or dampen the engine's confidence and you may VETO. Prefer a veto or a negative modifier when the edge is weak, momentum is overextended (high RSI on a long), or volatility is spiking. Be conservative — capital preservation beats forcing a trade. Return ONLY JSON.`,
  ]
    .filter(Boolean)
    .join("\n");

  const schema = `{"direction":"up|down|abstain","confidenceMod":<number -0.30..0.20>,"veto":<boolean>,"thesis":"<=160 chars","counterargument":"<=160 chars","rationale":"<=200 chars"}`;

  try {
    const raw = await callLlm({
      apiKey,
      model,
      prompt,
      jsonSchemaHint: schema,
      maxTokens: 320,
    });
    const j = extractJson<{
      direction?: string;
      confidenceMod?: number;
      veto?: boolean;
      thesis?: string;
      counterargument?: string;
      rationale?: string;
    }>(raw);
    lastAiAt.set(input.policyId, now);
    weekCalls++;
    const dir =
      j.direction === "up" || j.direction === "down" ? j.direction : "abstain";
    const mod = Math.max(-0.3, Math.min(0.2, Number(j.confidenceMod) || 0));
    return {
      thesis: (j.thesis ?? "").slice(0, 200) || "Conviction reviewed by the AI advisor.",
      counterargument:
        (j.counterargument ?? "").slice(0, 200) || "Downside weighed by the AI advisor.",
      confidenceMod: mod,
      direction: dir,
      veto: j.veto === true,
      rationale: (j.rationale ?? "").slice(0, 240),
      source: model,
      prompt,
      raw,
    };
  } catch (e) {
    console.warn(
      `[ai-advisor] skipped: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
    );
    return null;
  }
}
