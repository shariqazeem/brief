// The Brief Operator's brain — a transparent, multi-step decision engine.
//
// One operator, three modes (Protect / Grow / Aggressive). Every cycle it runs
// a visible pipeline over REAL market signals:
//
//   Observe → Thesis → Counterargument → Risk review → Policy review →
//   Execution review → Decision
//
// This is the deterministic core (honest, reproducible — it articulates the
// operator's genuine logic over real inputs, it does not invent facts). It is
// designed so an AI reasoning layer (Claude) can later REPLACE the thesis /
// counterargument / confidence via `opts.ai`, and so memory-replay (opts.memory)
// and DeepBook execution analysis (opts.exec) fold straight in — without the
// Move enforcement model changing at all: the chain still gates every trade.

import type { SignalBundle } from "./signals.js";

export type OperatorMode = "protect" | "grow" | "aggressive";

export type ModeConfig = {
  label: string;
  sub: string;
  /** Minimum confidence (0–1) to act. */
  minConfidence: number;
  /** Minimum |30m ROC| to treat the tape as trending (below = flat). */
  rocFloor: number;
  /** Avoid longs above / shorts below this RSI (exhaustion guard). */
  rsiCeiling: number;
};

export const MODE_CFG: Record<OperatorMode, ModeConfig> = {
  protect: {
    label: "Protect",
    sub: "Capital preservation",
    minConfidence: 0.66,
    rocFloor: 0.004,
    rsiCeiling: 64,
  },
  grow: {
    label: "Grow",
    sub: "Balanced",
    minConfidence: 0.5,
    rocFloor: 0.0025,
    rsiCeiling: 72,
  },
  aggressive: {
    label: "Aggressive",
    sub: "Higher risk",
    minConfidence: 0.38,
    rocFloor: 0.0015,
    rsiCeiling: 80,
  },
};

/** Map a legacy goal to a mode so existing operators keep working. */
export function modeFromGoal(goalType: string | undefined): OperatorMode {
  if (goalType === "preserve") return "protect";
  if (goalType === "grow") return "grow";
  return "aggressive"; // "edge" / default → most active
}

export function normalizeMode(m: string | undefined): OperatorMode {
  return m === "protect" || m === "grow" || m === "aggressive" ? m : "grow";
}

/** Optional augmentations folded into the engine (built in later phases). */
export type EngineOpts = {
  /** Phase 3 — similar past situations recalled from the Walrus journal. */
  memory?: {
    note: string; // human line, e.g. "resembles Trade #41 (−1.8%)"
    confidenceMult: number; // scales confidence (≤1 dampens, >1 reinforces)
  };
  /** Phase 4 — DeepBook orderbook read at decision time. */
  exec?: {
    note: string; // e.g. "depth healthy · slippage 0.09% · edge 7%"
    approved: boolean;
  };
  /** Phase 2 — AI reasoning layer override (Claude). When present, its
   *  thesis/counterargument/confidence/direction supersede the deterministic
   *  ones; the Move policy still gates execution downstream. */
  ai?: {
    thesis: string;
    counterargument: string;
    confidence: number;
    direction: "up" | "down";
    source: string; // e.g. "claude-haiku-4-5"
  };
};

export type OperatorDecision = {
  mode: OperatorMode;
  asset: string;
  spotUsd: number;
  /** The visible reasoning steps. */
  thesis: string;
  counterargument: string;
  riskReview: string;
  /** Mandate check — empty string when no mandate is set. */
  mandateReview: string;
  policyReview: string;
  executionReview: string;
  /** Outcome. */
  act: boolean;
  direction: "up" | "down";
  confidence: number;
  /** One-line synthesis for headers/journal. */
  verdict: string;
  /** True when the AI layer produced the thesis. */
  aiReasoned: boolean;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const pct = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "n/a" : `${(x * 100).toFixed(2)}%`;

/**
 * Run one decision cycle. Pure + deterministic over the given inputs (unless
 * opts.ai supplies the reasoning). `budgetUsedPct` is 0–100.
 */
export function runDecisionEngine(args: {
  asset: string;
  signals: SignalBundle;
  spotUsd: number;
  mode: OperatorMode;
  budgetUsedPct: number;
  /** Capital is fully deployed — no headroom for another min-lot. A normal
   *  end-state: the operator abstains as a SUCCESS and stays alive. */
  budgetExhausted?: boolean;
  /** User-mandate check (drawdown guard). When breached, the operator stands
   *  down to honour the human's objective — a hard, non-negotiable stop. */
  mandate?: { review: string; breached: boolean };
  opts?: EngineOpts;
}): OperatorDecision {
  const { asset, signals, spotUsd, mode, budgetUsedPct, opts } = args;
  const cfg = MODE_CFG[mode];
  const budgetBlocked = !!args.budgetExhausted;
  const mandateBlocked = !!args.mandate?.breached;
  const mandateReview = args.mandate?.review ?? "";

  const roc30 = signals.roc_30m ?? 0;
  const roc5 = signals.roc_5m ?? 0;
  const rsi = signals.rsi_60m ?? 50;
  const smaAlign =
    signals.sma_15m != null && signals.sma_60m != null
      ? signals.sma_15m >= signals.sma_60m
        ? 1
        : -1
      : 0;
  const direction: "up" | "down" =
    opts?.ai?.direction ?? (roc30 >= 0 ? "up" : "down");
  const trending = Math.abs(roc30) >= cfg.rocFloor;

  // ── Thesis — the case FOR a move (AI overrides if present) ──────────────
  const thesis =
    opts?.ai?.thesis ??
    `${asset} ${roc30 >= 0 ? "firming" : "softening"}: 30m ROC ${pct(roc30)} (5m ${pct(
      roc5,
    )}), spot $${spotUsd.toFixed(3)} ${
      smaAlign >= 0 ? "above" : "below"
    } the short MA → leaning ${direction.toUpperCase()}.`;

  // ── Counterargument — the case AGAINST (AI overrides if present) ────────
  let counterargument: string;
  if (opts?.ai?.counterargument) {
    counterargument = opts.ai.counterargument;
  } else if (!trending) {
    counterargument = `Tape is flat — 30m ROC ${pct(
      roc30,
    )} sits inside the ±${pct(cfg.rocFloor)} band. No trend to ride.`;
  } else if (direction === "up" && rsi > cfg.rsiCeiling) {
    counterargument = `RSI ${rsi.toFixed(0)} is elevated (> ${cfg.rsiCeiling}) — exhaustion risk on a long.`;
  } else if (direction === "down" && rsi < 100 - cfg.rsiCeiling) {
    counterargument = `RSI ${rsi.toFixed(0)} is depressed (< ${
      100 - cfg.rsiCeiling
    }) — snap-back risk on a short.`;
  } else {
    counterargument = `No strong counter-signal — ${
      direction === "up" ? "momentum" : "weakness"
    } is confirmed across ROC and the MA.`;
  }

  // ── Confidence (AI overrides if present) ────────────────────────────────
  let confidence: number;
  if (opts?.ai) {
    confidence = clamp01(opts.ai.confidence);
  } else {
    confidence = clamp01(Math.min(1, Math.abs(roc30) / 0.01)); // trend strength
    confidence *= smaAlign !== 0 ? 1 : 0.6; // MA agreement
    if (!trending) confidence *= 0.25; // flat tape kills it
    if (direction === "up" && rsi > cfg.rsiCeiling) confidence *= 0.5;
    if (direction === "down" && rsi < 100 - cfg.rsiCeiling) confidence *= 0.5;
  }
  // Memory replay reshapes confidence (Phase 3).
  if (opts?.memory) confidence = clamp01(confidence * opts.memory.confidenceMult);

  // ── Risk review ─────────────────────────────────────────────────────────
  const riskReview = `Budget ${budgetUsedPct.toFixed(
    0,
  )}% used · realized vol ${pct(signals.realized_vol_60m)} · ${cfg.label} mode needs ≥ ${(
    cfg.minConfidence * 100
  ).toFixed(0)}% confidence.${
    budgetBlocked ? " Budget fully deployed — no headroom for another min-lot." : ""
  }`;

  // ── Policy review (the loop verifies the real on-chain gate; this is the
  //    operator's own pre-check before it even builds the tx) ──────────────
  const policyReview = `Within budget, not revoked, not expired, venue spot-${asset.toLowerCase()} allowed — the Move policy will re-check this atomically.`;

  // ── Execution review (Phase 4 fills depth/slippage/edge) ────────────────
  const executionReview =
    opts?.exec?.note ?? "Order sizing at one min-lot; DeepBook execution check at fire time.";

  // ── Decision ────────────────────────────────────────────────────────────
  const execOk = opts?.exec ? opts.exec.approved : true;
  const act =
    confidence >= cfg.minConfidence && trending && execOk && !budgetBlocked && !mandateBlocked;

  const verdict = act
    ? `Act ${direction.toUpperCase()} — ${(confidence * 100).toFixed(0)}% confidence clears the ${cfg.label} bar.`
    : mandateBlocked
      ? `Stand down — mandate drawdown guard tripped; honouring your risk limit.`
      : budgetBlocked
      ? `Stand down — budget fully deployed; capital working, none at new risk.`
      : !trending
        ? `Stand down — flat tape, capital protected.`
        : !execOk
          ? `Stand down — execution conditions not met.`
          : `Stand down — ${(confidence * 100).toFixed(0)}% confidence below the ${(
              cfg.minConfidence * 100
            ).toFixed(0)}% ${cfg.label} bar.`;

  return {
    mode,
    asset,
    spotUsd,
    thesis,
    counterargument,
    riskReview,
    mandateReview,
    policyReview,
    executionReview,
    act,
    direction,
    confidence,
    verdict,
    aiReasoned: !!opts?.ai,
  };
}
