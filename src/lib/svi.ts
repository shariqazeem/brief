// SVI vol-surface math shared by the web tier · mirrors the agent's
// agents/workforce/trader/vol-surface.ts so the smile the dashboard
// draws is bit-identical to the one the trader priced against.
//
//   w(k) = a + b · ( ρ·(k − m) + √((k − m)² + σ²) )      (total variance)
//   d₂   = (−k − ½·w(k)) / √w(k),  Pr(F_T > K) = N(d₂)
//
// Pure math · safe in both the browser bundle and API routes.

export type SviSurface = {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
  spotUsd: number;
  forwardUsd: number;
  expiryMs: number;
};

export type SmilePoint = {
  /** Log-moneyness k = log(K/F). */
  k: number;
  /** Strike in USD at this k. */
  strikeUsd: number;
  /** Annualized implied vol, as a percentage (e.g. 62.4). */
  ivPct: number;
};

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Standard normal CDF (Abramowitz–Stegun 26.2.17, max err 7.5e-8). */
export function normCdf(x: number): number {
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;
  const absx = Math.abs(x);
  const k = 1 / (1 + p * absx);
  const term =
    c *
    Math.exp(-absx * absx * 0.5) *
    (b1 * k + b2 * k ** 2 + b3 * k ** 3 + b4 * k ** 4 + b5 * k ** 5);
  return x >= 0 ? 1 - term : term;
}

/** SVI total implied variance at log-moneyness k. */
export function sviTotalVariance(s: SviSurface, k: number): number {
  const dk = k - s.m;
  return s.a + s.b * (s.rho * dk + Math.sqrt(dk * dk + s.sigma * s.sigma));
}

/** Market-implied Pr(F_T > strike). Null when the surface is degenerate. */
export function impliedProbUp(
  s: SviSurface,
  strikeUsd: number,
): number | null {
  if (s.forwardUsd <= 0 || strikeUsd <= 0) return null;
  const k = Math.log(strikeUsd / s.forwardUsd);
  const w = sviTotalVariance(s, k);
  if (!Number.isFinite(w) || w <= 0) return null;
  const sqrtW = Math.sqrt(w);
  const d2 = (-k - 0.5 * w) / sqrtW;
  return normCdf(d2);
}

/** Sample the smile curve as annualized IV across k ∈ [−range, +range].
 *  T is floored at 60s so IV doesn't blow up at the expiry boundary. */
export function sampleSmile(
  s: SviSurface,
  opts: { points?: number; range?: number; nowMs?: number } = {},
): SmilePoint[] {
  const points = opts.points ?? 41;
  const range = opts.range ?? 0.08;
  const nowMs = opts.nowMs ?? Date.now();
  const tMs = Math.max(s.expiryMs - nowMs, 60_000);
  const tYears = tMs / YEAR_MS;
  const out: SmilePoint[] = [];
  for (let i = 0; i < points; i++) {
    const k = -range + (2 * range * i) / (points - 1);
    const w = sviTotalVariance(s, k);
    if (!Number.isFinite(w) || w <= 0) continue;
    out.push({
      k,
      strikeUsd: s.forwardUsd * Math.exp(k),
      ivPct: Math.sqrt(w / tYears) * 100,
    });
  }
  return out;
}

/** Log-moneyness of a strike on this surface (for the strike pin). */
export function strikeK(s: SviSurface, strikeUsd: number): number | null {
  if (s.forwardUsd <= 0 || strikeUsd <= 0) return null;
  return Math.log(strikeUsd / s.forwardUsd);
}
