// Trader strategies — deterministic, no LLM in the hot loop. Each
// strategy is a pure function over real on-chain signals (price history,
// vol surface) and produces a decision *or returns null to sit out*.
// The reasoning string lists the actual numbers it acted on so the
// Walrus memory is verifiable, not vibes.

import type { IndexerOracle } from "../lib/predict.js";
import type { SignalBundle } from "./signals.js";
import type { SurfaceSnapshot } from "./vol-surface.js";
import {
  describeSurface,
  impliedProbUp,
} from "./vol-surface.js";

export type Direction = "up" | "down";

export type StrategyId =
  | "conservative"
  | "momentum"
  | "contrarian"
  | "quant";

export type StrategyInput = {
  asset: string; // "BTC" / "SUI" / "WAL" / "DEEP"
  /** Live spot in USD (number, already scaled). */
  spotUsd: number;
  /** Bundle of computed signals (rolling ROC, SMA, RSI, realized vol). */
  signals: SignalBundle;
  /** Recently-settled BTC oracles, newest first — kept as a coarse trend
   *  proxy for cold-start (when price history hasn't accumulated yet). */
  recentSettled: IndexerOracle[];
  /** The candidate market for THIS bet — for BTC Predict, the strike
   *  + expiry. For spot the strike is the open-mid (so MA/ROC drives it). */
  market: {
    strikeUsd: number;
    expiryMs: number;
    oracle?: IndexerOracle;
  };
  /** Live vol surface — only present on BTC Predict bets. The quant
   *  strategy requires it; others ignore it. */
  surface?: SurfaceSnapshot | null;
  nowMs: number;
};

export type StrategyDecision = {
  strategy: StrategyId;
  direction: Direction;
  /** Position size in base units (dUSDC contracts for BTC,
   *  base-asset units for spot). Scaled by conviction. */
  quantity: number;
  /** 0..1 — how strongly the strategy backs this bet. Drives sizing
   *  + UI surfacing. */
  conviction: number;
  /** Plain-English reasoning citing the actual signal values used. */
  reasoning: string;
};

const STRATEGY_DEFAULT_QUANTITY: Record<StrategyId, number> = {
  conservative: 1,
  momentum: 2,
  contrarian: 2,
  quant: 2,
};

// =============================================================================
// Helpers
// =============================================================================

function pct(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "n/a";
  return `${(x * 100).toFixed(2)}%`;
}

function fmt(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "n/a";
  return x.toFixed(digits);
}

function msUntil(ms: number, nowMs: number): string {
  const dt = ms - nowMs;
  if (dt < 0) return "expired";
  const mins = Math.floor(dt / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
}

/** Round conviction to a base-unit multiplier (1..3). */
function convictionToQty(base: number, conviction: number): number {
  const mult = conviction >= 0.7 ? 3 : conviction >= 0.4 ? 2 : 1;
  return Math.max(1, Math.min(base * mult, base + 2));
}

// =============================================================================
// Strategies
// =============================================================================

/** Conservative: tiny size, only fires when the signal is unambiguous.
 *  No edge → returns null (deliberately sits out). */
function conservative(input: StrategyInput): StrategyDecision | null {
  const { signals, asset, spotUsd } = input;
  const sma15 = signals.sma_15m;
  const sma60 = signals.sma_60m;
  const rsi = signals.rsi_60m ?? 50;
  // Sit out unless the 15m and 60m MA agree on direction AND RSI is in
  // the trending range (40..60 is too noisy; >60 already overbought).
  if (sma15 === null || sma60 === null) {
    return null;
  }
  const above15 = spotUsd > sma15;
  const above60 = spotUsd > sma60;
  // Conviction is the agreement between MAs + the gap from spot.
  const direction: Direction =
    above15 && above60 ? "up" : !above15 && !above60 ? "down" : "up";
  if (above15 !== above60) {
    return null; // disagreement → no trade
  }
  // RSI guard — if we'd be buying into an overbought tape (RSI > 70) or
  // selling into oversold (RSI < 30), sit out.
  if (direction === "up" && rsi > 70) return null;
  if (direction === "down" && rsi < 30) return null;
  const gap = Math.abs(spotUsd - sma60) / sma60;
  const conviction = Math.min(0.6, 0.3 + gap * 10);
  const baseQty = STRATEGY_DEFAULT_QUANTITY.conservative;
  return {
    strategy: "conservative",
    direction,
    quantity: baseQty, // conservative never upsizes — discipline
    conviction,
    reasoning:
      `Conservative on ${asset}: spot $${fmt(spotUsd)} ` +
      `${direction === "up" ? "above" : "below"} both 15m SMA $${fmt(sma15)} ` +
      `and 60m SMA $${fmt(sma60)} (gap ${pct(gap)}). RSI(60m) ${fmt(rsi, 1)}. ` +
      `Smallest viable position (${baseQty}) — discipline over conviction. ` +
      `Sits out when MAs disagree or RSI is at an extreme.`,
  };
}

/** Momentum: trend-follow the realized ROC. Skip flat tape. */
function momentum(input: StrategyInput): StrategyDecision | null {
  const { signals, asset, spotUsd } = input;
  const roc5 = signals.roc_5m;
  const roc30 = signals.roc_30m;
  const sma15 = signals.sma_15m;
  if (sma15 === null) {
    // Cold start (no history yet) — fall back to the BTC settled-bar
    // momentum from the indexer so we don't sit out the first cycle.
    return cold_momentum(input);
  }
  const recent = roc30 ?? roc5 ?? 0;
  // Threshold of 0.05% / 0.1% / 0.2% maps to flat / weak / strong trend
  const abs = Math.abs(recent);
  if (abs < 0.0005) {
    // < 0.05% over 30m → no trend
    return null;
  }
  const direction: Direction = recent > 0 ? "up" : "down";
  // Conviction scales with ROC magnitude clipped to ~0.5%.
  const conviction = Math.min(0.9, 0.3 + abs * 100);
  const baseQty = STRATEGY_DEFAULT_QUANTITY.momentum;
  const qty = convictionToQty(baseQty, conviction);
  const rocWindow = roc30 !== null ? "30m" : "5m";
  const rocSrc =
    roc30 !== null
      ? `30m ROC ${pct(roc30)} (5m ${pct(roc5)})`
      : `5m ROC ${pct(roc5)} (no 30m history yet)`;
  return {
    strategy: "momentum",
    direction,
    quantity: qty,
    conviction,
    reasoning:
      `Momentum on ${asset}: ${rocSrc}, ` +
      `15m SMA $${fmt(sma15)} vs spot $${fmt(spotUsd)} → ` +
      `${spotUsd > sma15 ? "above" : "below"} the short MA. ` +
      `Leaning ${direction.toUpperCase()} with conviction ${conviction.toFixed(2)} → qty ${qty} ` +
      `(${rocWindow} window).`,
  };
}

/** Cold-start fallback: when no price history exists, use the BTC
 *  indexer's recent settled bars as the trend proxy. Same vote-counting
 *  rule the old momentum strategy used. */
function cold_momentum(input: StrategyInput): StrategyDecision {
  const { recentSettled, asset, spotUsd } = input;
  const votes = countDeltaVotes(recentSettled);
  const direction: Direction = votes.up >= votes.down ? "up" : "down";
  return {
    strategy: "momentum",
    direction,
    quantity: STRATEGY_DEFAULT_QUANTITY.momentum,
    conviction: 0.4,
    reasoning:
      `Momentum on ${asset} (cold-start; no rolling price history yet): ` +
      `last ${votes.up + votes.down} settled bars closed UP ${votes.up} vs DOWN ${votes.down}. ` +
      `Leaning ${direction.toUpperCase()} near $${fmt(spotUsd)}.`,
  };
}

/** Contrarian: fade overextended moves. Skip if no extension. */
function contrarian(input: StrategyInput): StrategyDecision | null {
  const { signals, asset, spotUsd } = input;
  const rsi = signals.rsi_60m;
  const sma60 = signals.sma_60m;
  if (rsi === null || sma60 === null) {
    return cold_contrarian(input);
  }
  // RSI > 70 → overbought, fade DOWN. RSI < 30 → oversold, fade UP.
  if (rsi >= 30 && rsi <= 70) return null; // not extended
  const direction: Direction = rsi > 70 ? "down" : "up";
  const extension = rsi > 70 ? (rsi - 70) / 30 : (30 - rsi) / 30;
  const conviction = Math.min(0.85, 0.4 + extension * 0.8);
  const baseQty = STRATEGY_DEFAULT_QUANTITY.contrarian;
  const qty = convictionToQty(baseQty, conviction);
  return {
    strategy: "contrarian",
    direction,
    quantity: qty,
    conviction,
    reasoning:
      `Contrarian on ${asset}: RSI(60m) ${fmt(rsi, 1)} → ` +
      `${rsi > 70 ? "overbought" : "oversold"}; ` +
      `60m SMA $${fmt(sma60)} vs spot $${fmt(spotUsd)}. ` +
      `Fading ${direction.toUpperCase()} with conviction ${conviction.toFixed(2)} → qty ${qty}.`,
  };
}

function cold_contrarian(input: StrategyInput): StrategyDecision {
  const { recentSettled, asset, spotUsd } = input;
  const votes = countDeltaVotes(recentSettled.slice(0, 3));
  const lastUp = votes.up > votes.down;
  const direction: Direction = lastUp ? "down" : "up";
  return {
    strategy: "contrarian",
    direction,
    quantity: STRATEGY_DEFAULT_QUANTITY.contrarian,
    conviction: 0.4,
    reasoning:
      `Contrarian on ${asset} (cold-start): last 3 settled bars went UP ${votes.up}; ` +
      `fading ${direction.toUpperCase()} near $${fmt(spotUsd)}.`,
  };
}

/** Quant/Vol — the centerpiece. Computes the market-implied probability
 *  of UP at the candidate strike from the SVI surface, derives the
 *  agent's own probability estimate from rolling signals, bets when the
 *  two disagree by more than EDGE_THRESHOLD. Skips otherwise.
 *
 *  Only applies to BTC Predict markets (requires a surface). */
function quant(input: StrategyInput): StrategyDecision | null {
  const { signals, asset, surface, market, spotUsd } = input;
  if (asset !== "BTC" || !surface) {
    // For spot assets we fall back to momentum — every personality
    // should produce SOMETHING when no surface exists, otherwise the
    // user "adopted Quant" sits out forever on non-BTC days.
    return momentum(input);
  }
  const marketP = impliedProbUp(surface, market.strikeUsd);
  if (marketP === null) return null;

  // Build an agent estimate from real signals:
  //   start at 50%, shift by ROC sign + magnitude, by RSI direction, and
  //   by whether spot is above its 60m MA. Each lever capped at ±10%.
  let agentP = 0.5;
  const roc30 = signals.roc_30m ?? 0;
  agentP += Math.max(-0.1, Math.min(0.1, roc30 * 20)); // ±10% at ±0.5%
  const rsi = signals.rsi_60m ?? 50;
  agentP += Math.max(-0.06, Math.min(0.06, (rsi - 50) / 100)); // ±6% at extremes
  const sma60 = signals.sma_60m;
  if (sma60 !== null) {
    const gap = (spotUsd - sma60) / sma60;
    agentP += Math.max(-0.05, Math.min(0.05, gap * 25)); // ±5% at ±0.2%
  }
  agentP = Math.max(0.05, Math.min(0.95, agentP));

  const edge = agentP - marketP;
  const EDGE_THRESHOLD = 0.05;
  if (Math.abs(edge) < EDGE_THRESHOLD) return null; // no edge → sit out

  const direction: Direction = edge > 0 ? "up" : "down";
  // Conviction maps |edge| ∈ [0.05, 0.25] → [0.4, 0.9]
  const conviction = Math.min(0.9, 0.4 + (Math.abs(edge) - EDGE_THRESHOLD) * 5);
  const baseQty = STRATEGY_DEFAULT_QUANTITY.quant;
  const qty = convictionToQty(baseQty, conviction);

  return {
    strategy: "quant",
    direction,
    quantity: qty,
    conviction,
    reasoning:
      `Quant/Vol on ${asset}: surface ${describeSurface(surface)}. ` +
      `Market-implied Pr(UP @ $${fmt(market.strikeUsd)}) = ${pct(marketP)}. ` +
      `Agent's signal estimate ${pct(agentP)} from ROC30m=${pct(roc30)}, ` +
      `RSI(60m)=${fmt(rsi, 1)}, ` +
      `spot vs 60m SMA ${sma60 ? pct((spotUsd - sma60) / sma60) : "n/a"}. ` +
      `Edge ${pct(edge)} (threshold ±${pct(EDGE_THRESHOLD)}). ` +
      `Betting ${direction.toUpperCase()} at conviction ${conviction.toFixed(2)} → qty ${qty}.`,
  };
}

// =============================================================================
// Registry + facade
// =============================================================================

export const STRATEGIES: Record<
  StrategyId,
  (input: StrategyInput) => StrategyDecision | null
> = {
  conservative,
  momentum,
  contrarian,
  quant,
};

/** Pick a strategy and return its decision, OR null when the strategy
 *  sees no edge and declines to trade. The trader treats null by
 *  delivering a simulated decision with a `no edge today` reason so the
 *  full task lifecycle still completes + the journal records the
 *  abstention. Honest behaviour: not every cycle is a bet. */
export function decide(
  strategy: StrategyId,
  input: StrategyInput,
): StrategyDecision | null {
  const fn = STRATEGIES[strategy];
  if (!fn) throw new Error(`unknown strategy: ${strategy}`);
  return fn(input);
}

// =============================================================================
// Compatibility shim for the BTC cold-start path
// =============================================================================

function countDeltaVotes(
  oracles: IndexerOracle[],
): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (let i = 0; i < oracles.length - 1; i++) {
    const cur = oracles[i].settlement_price ?? 0;
    const prev = oracles[i + 1].settlement_price ?? 0;
    if (cur > prev) up++;
    else if (cur < prev) down++;
  }
  return { up, down };
}

// =============================================================================
// Operating parameters — the operator's declared thresholds. baselineParams
// mirrors the hardcoded constants each strategy uses above; the manifesto
// records these to Walrus so the operator's "contract" is verifiable.
// (Goal-based calibration layers on top later; with no goal these ARE the
// live thresholds, so the manifesto stays honest.)
// =============================================================================

export type StrategyParams = {
  /** Quant edge threshold (quant only). */
  minEdge: number;
  /** Momentum flat-tape band — |ROC| below this = no trend. */
  rocThreshold: number;
  /** RSI overbought / oversold guards. */
  rsiHigh: number;
  rsiLow: number;
  /** Conviction-scaled position-size ceiling. */
  maxQty: number;
};

export function baselineParams(strategy: StrategyId): StrategyParams {
  return {
    minEdge: 0.05,
    rocThreshold: 0.0005,
    rsiHigh: 70,
    rsiLow: 30,
    maxQty:
      strategy === "conservative"
        ? 1
        : STRATEGY_DEFAULT_QUANTITY[strategy] + 2,
  };
}

// =============================================================================
// Abstention reasoning — when a strategy sits out (returns null) the trader
// still delivers an honest "capital preserved" decision. This renders the
// per-strategy reason in plain English, citing the live numbers, so PRESERVE
// reads as a deliberate, intelligent choice — not a gap. Pure formatting:
// it does not change any decision.
// =============================================================================

export function abstentionReason(
  strategy: StrategyId,
  signals: SignalBundle,
  asset: string,
  spotUsd: number,
): string {
  const roc30 = signals.roc_30m;
  const rsi = signals.rsi_60m;
  const sma15 = signals.sma_15m;
  const sma60 = signals.sma_60m;
  switch (strategy) {
    case "conservative": {
      if (sma15 === null || sma60 === null) {
        return `Sentinel preserved capital on ${asset}: moving averages are still warming up — not enough history to confirm a clean trend. No bet without confirmation.`;
      }
      if (spotUsd > sma15 !== spotUsd > sma60) {
        return `Sentinel preserved capital on ${asset}: 15m SMA $${fmt(sma15)} and 60m SMA $${fmt(sma60)} disagree on direction (spot $${fmt(spotUsd)}). No clean trend to commit to — discipline over a forced bet.`;
      }
      return `Sentinel preserved capital on ${asset}: RSI(60m) ${fmt(rsi ?? 50, 1)} is at an extreme against the trend — refusing to chase. Waiting for a calmer entry.`;
    }
    case "momentum":
      return `Momentum preserved capital on ${asset}: 30m ROC ${pct(roc30)} sits inside the ±0.05% flat-tape band — no trend to ride. Capital held until a real move emerges.`;
    case "contrarian":
      return `Contrarian preserved capital on ${asset}: RSI(60m) ${fmt(rsi ?? 50, 1)} is in the neutral 30–70 band — no overextension to fade. No crowd to lean against right now.`;
    case "quant":
      return `Quant preserved capital on ${asset}: the signal edge is under the ±5% threshold against the live vol surface — not mispriced enough to risk capital. (ROC30m ${pct(roc30)}, RSI ${fmt(rsi ?? 50, 1)}.)`;
    default:
      return `${strategy} preserved capital on ${asset}: no signal cleared the threshold.`;
  }
}
