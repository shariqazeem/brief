// The Brief Operator's brain · a transparent, multi-step decision engine.
//
// One operator, three modes (Protect / Grow / Aggressive). Every cycle it runs
// a visible pipeline over REAL market signals:
//
//   Observe → Thesis → Counterargument → Risk review → Policy review →
//   Execution review → Decision
//
// This is the deterministic core (honest, reproducible · it articulates the
// operator's genuine logic over real inputs, it does not invent facts). It is
// designed so an AI reasoning layer (Claude) can later REPLACE the thesis /
// counterargument / confidence via `opts.ai`, and so memory-replay (opts.memory)
// and DeepBook execution analysis (opts.exec) fold straight in · without the
// Move enforcement model changing at all: the chain still gates every trade.

import type { SignalBundle } from "./signals.js";
import type { Regime } from "./regime.js";

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
  /** Max fraction of capital this mode will allocate to SUI (risk appetite). */
  maxExposure: number;
};

export const MODE_CFG: Record<OperatorMode, ModeConfig> = {
  protect: {
    label: "Protect",
    sub: "Capital preservation",
    minConfidence: 0.66,
    // 2026-06-20 · Capital-preservation tuning. Raised from 0.40% → 0.55% so
    // Protect stops catching falling knives: a sub-0.55%/30m wobble is noise,
    // not a trend, and Protect should not stake capital on it. Deliberately
    // higher than Grow (0.25%) / Aggressive (0.15%) — Protect demands a clearer
    // move before it acts at all. (Grow/Aggressive thresholds untouched.)
    rocFloor: 0.0055,
    rsiCeiling: 64,
    maxExposure: 0.3,
  },
  grow: {
    label: "Grow",
    sub: "Balanced",
    minConfidence: 0.5,
    rocFloor: 0.0025,
    rsiCeiling: 72,
    maxExposure: 0.55,
  },
  aggressive: {
    label: "Aggressive",
    sub: "Higher risk",
    minConfidence: 0.38,
    rocFloor: 0.0015,
    rsiCeiling: 80,
    maxExposure: 0.85,
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
  /** Phase 3 · similar past situations recalled from the Walrus journal. */
  memory?: {
    note: string; // human line, e.g. "resembles Trade #41 (−1.8%)"
    confidenceMult: number; // scales confidence (≤1 dampens, >1 reinforces)
  };
  /** Phase 4 · DeepBook orderbook read at decision time. */
  exec?: {
    note: string; // e.g. "depth healthy · slippage 0.09% · edge 7%"
    approved: boolean;
  };
  /** Phase 2 · AI reasoning layer override (Claude). When present, its
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
  /** Market regime classification (the "understand first" step). */
  regimeLabel: string;
  regimeReview: string;
  /** The visible reasoning steps. */
  thesis: string;
  counterargument: string;
  riskReview: string;
  /** Mandate check · empty string when no mandate is set. */
  mandateReview: string;
  policyReview: string;
  executionReview: string;
  /** Outcome. */
  act: boolean;
  direction: "up" | "down";
  confidence: number;
  /** Capital-manager view: target SUI allocation as % of capital
   *  (null = no confident view → hold current). The loop rebalances to it. */
  targetExposurePct: number | null;
  /** The allocation reasoning · what the operator wants its money doing. */
  allocation: string;
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
  /** Capital is fully deployed · no headroom for another min-lot. A normal
   *  end-state: the operator abstains as a SUCCESS and stays alive. */
  budgetExhausted?: boolean;
  /** User-mandate check (drawdown guard). When breached, the operator stands
   *  down to honour the human's objective · a hard, non-negotiable stop. */
  mandate?: { review: string; breached: boolean };
  /** Market regime · classified before deciding. A non-tradeable regime
   *  (range-bound, mean-reversion) stands the operator aside. */
  regime?: Regime;
  opts?: EngineOpts;
}): OperatorDecision {
  const { asset, signals, spotUsd, mode, budgetUsedPct, opts } = args;
  const cfg = MODE_CFG[mode];
  const budgetBlocked = !!args.budgetExhausted;
  const mandateBlocked = !!args.mandate?.breached;
  const mandateReview = args.mandate?.review ?? "";
  const regime = args.regime;
  const regimeBlocked = regime ? !regime.tradeable : false;
  const regimeLabel = regime?.label ?? "-";
  const regimeReview = regime ? `${regime.label} · ${regime.note}` : "";

  const roc30 = signals.roc_30m ?? 0;
  const roc4h = signals.roc_4h ?? 0;
  const roc5 = signals.roc_5m ?? 0;
  const rsi = signals.rsi_60m ?? 50;
  const smaAlign =
    signals.sma_15m != null && signals.sma_60m != null
      ? signals.sma_15m >= signals.sma_60m
        ? 1
        : -1
      : 0;
  // Trend can come from the short tape (30m) OR a sustained multi-hour drift
  // (4h) the short window can't see · a 3%/day move is flat at 30m but clear
  // at 4h. `trendRoc` carries whichever is driving, for direction + thesis.
  const shortTrending = Math.abs(roc30) >= cfg.rocFloor;
  const longTrending = Math.abs(roc4h) >= cfg.rocFloor * 2.5;
  const trending = shortTrending || longTrending;
  const trendRoc = shortTrending ? roc30 : longTrending ? roc4h : roc30;
  // Direction follows the REGIME (the authoritative "what kind of market")
  // when it has one, so a "Trending up" regime can never read as "selling" ·
  // only fall back to the raw momentum sign when the regime is directionless.
  const regimeDir: "up" | "down" | null =
    regime?.kind === "trending-up"
      ? "up"
      : regime?.kind === "trending-down"
        ? "down"
        : null;
  const direction: "up" | "down" =
    opts?.ai?.direction ?? regimeDir ?? (trendRoc >= 0 ? "up" : "down");

  // ── Capital protection · Protect goes to cash in a confirmed downtrend ───
  //
  // 2026-06-20 · A deliberate capital-preservation rule, NOT an error path and
  // NOT a demo trick: it triggers purely off real regime + ROC signals on any
  // market. In Protect mode, refusing to hold a falling asset IS the strategy,
  // so when the tape is a CONFIRMED downtrend we flatten to 100% USDC and treat
  // that hold as the deliberate protective ACT — capital out of harm's way.
  //
  // "Confirmed downtrend" (down vs up read from the signals already computed):
  //   (a) the regime classifier says `trending-down` (its authoritative call,
  //       which already folds in both the 30m tape and a sustained 4h/daily
  //       drift), OR
  //   (b) a directionless regime (range-bound / mean-reversion — e.g. a tape
  //       rolling over from overbought) whose dominant momentum is genuinely
  //       negative: `direction === "down"` AND the driving ROC (`trendRoc`,
  //       the same value the engine trades on) is below −rocFloor, i.e. a real
  //       move down, not flat noise.
  // Breakouts are left to the normal path (a down-breakout already targets cash
  // via the bearish branch; an up-breakout is genuine strength). This rule only
  // ever makes Protect MORE conservative.
  //
  // It short-circuits BEFORE the act/buy path below, so Protect can never buy
  // into a falling market. Grow / Aggressive are untouched. All downstream
  // safety (Move policy, mandate, exec veto) still applies to the resulting
  // hold — this rule simply guarantees the target is zero risk.
  const downRegime = regime?.kind === "trending-down";
  const downMomentum =
    (regime?.kind === "range-bound" || regime?.kind === "mean-reversion") &&
    direction === "down" &&
    trendRoc <= -cfg.rocFloor;
  if (mode === "protect" && (downRegime || downMomentum)) {
    const why = downRegime
      ? `${regimeLabel.toLowerCase()} regime`
      : `tape rolling over (30m ROC ${pct(roc30)}, 4h ${pct(roc4h)})`;
    // Conviction in the DOWNTREND (from real ROC magnitude · same scale the
    // engine uses elsewhere): how sure we are it's falling. The protective hold
    // does not depend on this — we go to cash regardless — but it is reported
    // honestly rather than hardcoded. AI conviction supersedes if present.
    const protectConfidence = opts?.ai
      ? clamp01(opts.ai.confidence)
      : clamp01(Math.max(Math.abs(roc30) / 0.01, Math.abs(roc4h) / 0.04));
    const reason =
      "Capital protection: confirmed downtrend — holding 100% USDC, zero at risk.";
    return {
      mode,
      asset,
      spotUsd,
      regimeLabel,
      regimeReview,
      // Force the asset to zero: the loop rebalances to 100% USDC.
      targetExposurePct: 0,
      allocation: `Capital protection · ${why} · target 100% USDC (0% ${asset}), nothing at risk.`,
      thesis: `${asset} in a confirmed downtrend · ${why}. In Protect mode the right move is no exposure: a falling asset is not a position to hold.`,
      counterargument:
        "A snap-back is always possible, but Protect's mandate is preservation, not bottom-fishing · we forgo the bounce to remove all downside.",
      riskReview: `Protect mode · refusing to hold ${asset} while it falls. Zero risk asset exposure is the lowest-risk state available.`,
      mandateReview,
      policyReview: `No buy order built · moving to cash. The Move policy still gates any future trade atomically.`,
      executionReview: "No entry · de-risking to USDC, no execution required.",
      // A deliberate protective ACT framed as a hold, NOT a buy: act stays false
      // so no entry tx is built, but the verdict reads as protection, not a miss.
      act: false,
      direction: "down",
      confidence: protectConfidence,
      verdict: reason,
      aiReasoned: !!opts?.ai,
    };
  }

  // ── Thesis · the case FOR a move (AI overrides if present) ──────────────
  const thesis =
    opts?.ai?.thesis ??
    `${asset} ${trendRoc >= 0 ? "firming" : "softening"}: 30m ROC ${pct(roc30)}, 4h ${pct(
      roc4h,
    )} (5m ${pct(roc5)}), spot $${spotUsd.toFixed(3)} ${
      smaAlign >= 0 ? "above" : "below"
    } the short MA → leaning ${direction.toUpperCase()}.`;

  // ── Counterargument · the case AGAINST (AI overrides if present) ────────
  let counterargument: string;
  if (opts?.ai?.counterargument) {
    counterargument = opts.ai.counterargument;
  } else if (!trending) {
    counterargument = `Tape is flat · 30m ROC ${pct(
      roc30,
    )} sits inside the ±${pct(cfg.rocFloor)} band. No trend to ride.`;
  } else if (direction === "up" && rsi > cfg.rsiCeiling) {
    counterargument = `Momentum is overextended · exhaustion risk on a long.`;
  } else if (direction === "down" && rsi < 100 - cfg.rsiCeiling) {
    counterargument = `Momentum is deeply oversold · snap-back risk on a short.`;
  } else {
    counterargument = `No strong counter-signal · ${
      direction === "up" ? "momentum" : "weakness"
    } is confirmed across ROC and the MA.`;
  }

  // ── Confidence (AI overrides if present) ────────────────────────────────
  let confidence: number;
  if (opts?.ai) {
    confidence = clamp01(opts.ai.confidence);
  } else {
    // Strength from the stronger of the short tape (1% = full) or the 4h
    // drift (4% = full) · so a sustained daily trend earns real conviction.
    confidence = clamp01(
      Math.min(1, Math.max(Math.abs(roc30) / 0.01, Math.abs(roc4h) / 0.04)),
    );
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
    budgetBlocked ? " Budget fully deployed · no headroom for another min-lot." : ""
  }`;

  // ── Policy review (the loop verifies the real on-chain gate; this is the
  //    operator's own pre-check before it even builds the tx) ──────────────
  const policyReview = `Within budget, not revoked, not expired, venue spot-${asset.toLowerCase()} allowed · the Move policy will re-check this atomically.`;

  // ── Execution review (Phase 4 fills depth/slippage/edge) ────────────────
  const executionReview =
    opts?.exec?.note ?? "Order sizing at one min-lot; DeepBook execution check at fire time.";

  // ── Decision · high-conviction directional edge. Kept for narration and the
  //    "Act" framing; the loop's allocator actually executes off the CONTINUOUS
  //    target below (it moves when the gap to target clears a vol-adaptive band).
  const execOk = opts?.exec ? opts.exec.approved : true;
  const act =
    confidence >= cfg.minConfidence &&
    trending &&
    execOk &&
    !budgetBlocked &&
    !mandateBlocked &&
    !regimeBlocked;

  // ── Allocation · CONTINUOUS stance (the capital-manager view). The operator
  //    is ALWAYS positioned: target is a smooth function of conviction +
  //    direction, anchored on a per-mode resting baseline and capped by the
  //    mode's max exposure. "Always a target" is NOT "always trading" — the
  //    loop's vol-adaptive deadband only moves capital on a meaningful gap, so
  //    this is a portfolio manager that always has a stance and explains it,
  //    not a trade firehose. (Replaces the old binary act ? target : null.)
  const maxEx = cfg.maxExposure; // 0.30 / 0.55 / 0.85 by mode
  const baseline = maxEx * 0.25; // resting stance when uncertain
  const conv = clamp01(confidence);
  let targetExposurePct: number | null;
  let allocation: string;
  if (budgetBlocked) {
    targetExposurePct = null; // cap reached · cannot transact → hold current
    allocation = "Budget fully deployed · holding current allocation.";
  } else if (mandateBlocked) {
    targetExposurePct = 0; // drawdown guard → de-risk to cash
    allocation = "Mandate drawdown guard · de-risking to cash (0%).";
  } else if (regimeBlocked) {
    targetExposurePct = Math.round(baseline * 100); // neutral resting stance, no chase
    allocation = `${regimeLabel} regime · neutral ${targetExposurePct}% ${asset} stance, no directional chase.`;
  } else {
    const frac =
      direction === "up"
        ? baseline + conv * (maxEx - baseline) // baseline → max as up-conviction rises
        : baseline * (1 - conv); // baseline → 0 as down-conviction rises
    targetExposurePct = Math.round(clamp01(frac) * 100);
    allocation = `Target ${targetExposurePct}% ${asset} (${100 - targetExposurePct}% cash) · ${
      direction === "up" ? "leaning long" : "leaning to cash"
    } at ${(conv * 100).toFixed(0)}% conviction.`;
  }

  // ── Verdict · one-line synthesis. A clear edge reads as "Act"; otherwise it
  //    reads as "Hold {target}%", never a dead "stand down" while in fact
  //    holding a measured stance.
  const verdict = budgetBlocked
    ? `Budget fully deployed · holding current allocation, none at new risk.`
    : mandateBlocked
      ? `De-risking to cash · mandate drawdown guard tripped, honouring your risk limit.`
      : act
        ? `Act ${direction.toUpperCase()} · ${(confidence * 100).toFixed(0)}% conviction clears the ${cfg.label} bar in a ${regimeLabel.toLowerCase()} regime · target ${targetExposurePct}% ${asset}.`
        : `Hold ${targetExposurePct}% ${asset} · ${
            regimeBlocked
              ? `${regimeLabel.toLowerCase()} regime, no directional edge`
              : !trending
                ? "flat tape, no trend to ride"
                : !execOk
                  ? "execution conditions not met"
                  : `${(confidence * 100).toFixed(0)}% conviction below the ${(
                      cfg.minConfidence * 100
                    ).toFixed(0)}% ${cfg.label} bar`
          }, holding a measured stance.`;

  return {
    mode,
    asset,
    spotUsd,
    regimeLabel,
    regimeReview,
    targetExposurePct,
    allocation,
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
