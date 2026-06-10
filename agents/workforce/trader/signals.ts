// Deterministic, fast technical signals over a rolling price history.
//
// No LLM in the hot loop; nothing here samples randomness. Every value
// is derivable from the persisted history file, so a third party
// recomputes the agent's reasoning bit-for-bit.

import type { PricePoint } from "./price-history.js";

/** Find the price point closest to `nowMs - lookbackMs` (within tolerance).
 *  Returns null when the history doesn't reach back that far. */
export function pointAt(
  history: PricePoint[],
  nowMs: number,
  lookbackMs: number,
): PricePoint | null {
  if (history.length === 0) return null;
  const target = nowMs - lookbackMs;
  // History is append-only chronological; binary-search-ish for the
  // last point whose ts <= target.
  let best: PricePoint | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.ts <= target) {
      best = history[i]!;
      break;
    }
  }
  return best;
}

/** Rate of change as a fraction over the lookback window (e.g. 0.005 = +0.5%). */
export function roc(
  history: PricePoint[],
  nowMs: number,
  lookbackMs: number,
): number | null {
  if (history.length === 0) return null;
  const past = pointAt(history, nowMs, lookbackMs);
  if (!past) return null;
  const cur = history[history.length - 1]!.price;
  if (past.price === 0) return null;
  return (cur - past.price) / past.price;
}

/** Simple moving average of prices observed within the lookback window. */
export function sma(
  history: PricePoint[],
  nowMs: number,
  lookbackMs: number,
): number | null {
  const cutoff = nowMs - lookbackMs;
  let sum = 0;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.ts < cutoff) break;
    sum += history[i]!.price;
    count += 1;
  }
  if (count < 2) return null;
  return sum / count;
}

/** Annualized realized vol = stdev(log returns) * sqrt(365*24h / dtMean).
 *  Approximates the volatility surface's lower bound; we use it to
 *  reality-check SVI implied vol. */
export function realizedVol(
  history: PricePoint[],
  nowMs: number,
  lookbackMs: number,
): number | null {
  const cutoff = nowMs - lookbackMs;
  const window: PricePoint[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.ts < cutoff) break;
    window.push(history[i]!);
  }
  window.reverse();
  if (window.length < 3) return null;
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]!.price;
    const cur = window[i]!.price;
    if (prev <= 0 || cur <= 0) continue;
    returns.push(Math.log(cur / prev));
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdev = Math.sqrt(variance);
  // Annualize: scale by sqrt(samples per year). dt mean across the window.
  const dt =
    (window[window.length - 1]!.ts - window[0]!.ts) / (window.length - 1);
  if (dt <= 0) return null;
  const samplesPerYear = (365 * 24 * 60 * 60 * 1000) / dt;
  return stdev * Math.sqrt(samplesPerYear);
}

/** Wilder RSI on log-returns. Output 0..100. Pivots near 50; >70 reads
 *  overextended UP, <30 overextended DOWN. */
export function rsi(
  history: PricePoint[],
  nowMs: number,
  lookbackMs: number,
): number | null {
  const cutoff = nowMs - lookbackMs;
  const window: PricePoint[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.ts < cutoff) break;
    window.push(history[i]!);
  }
  window.reverse();
  if (window.length < 4) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < window.length; i++) {
    const diff = window[i]!.price - window[i - 1]!.price;
    if (diff > 0) gains += diff;
    else losses += -diff;
  }
  if (gains + losses === 0) return 50;
  const rs = losses === 0 ? Infinity : gains / losses;
  return 100 - 100 / (1 + rs);
}

/** Standard normal CDF via the Abramowitz–Stegun approximation
 *  (max abs error 7.5e-8). Used to map d2 → Pr(F_T > K) under
 *  Black-Scholes-style log-normal assumptions. */
export function normCdf(x: number): number {
  // Constants of the AS 26.2.17 approximation.
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228; // 1 / sqrt(2*pi)
  const absx = Math.abs(x);
  const k = 1 / (1 + p * absx);
  const term =
    c *
    Math.exp(-absx * absx * 0.5) *
    (b1 * k + b2 * k ** 2 + b3 * k ** 3 + b4 * k ** 4 + b5 * k ** 5);
  return x >= 0 ? 1 - term : term;
}

/** Bundle of signals the strategies act on. Each field is null when the
 *  history doesn't reach back far enough — strategies treat null as
 *  "no signal, sit out." */
export type SignalBundle = {
  spot: number | null;
  ts: number;
  roc_5m: number | null;
  roc_30m: number | null;
  roc_60m: number | null;
  sma_15m: number | null;
  sma_60m: number | null;
  rsi_60m: number | null;
  realized_vol_60m: number | null;
};

export function computeSignals(
  history: PricePoint[],
  nowMs = Date.now(),
): SignalBundle {
  const last = history[history.length - 1];
  return {
    spot: last?.price ?? null,
    ts: nowMs,
    roc_5m: roc(history, nowMs, 5 * 60_000),
    roc_30m: roc(history, nowMs, 30 * 60_000),
    roc_60m: roc(history, nowMs, 60 * 60_000),
    sma_15m: sma(history, nowMs, 15 * 60_000),
    sma_60m: sma(history, nowMs, 60 * 60_000),
    rsi_60m: rsi(history, nowMs, 60 * 60_000),
    realized_vol_60m: realizedVol(history, nowMs, 60 * 60_000),
  };
}
