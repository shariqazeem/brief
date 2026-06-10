// Read DeepBook Predict's on-chain SVI vol surface and derive the
// market-implied probability that a BTC option settles UP at a given
// strike. This is the foundation of the vol-aware quant strategy.
//
// SVI parameterization (Gatheral): total implied variance at log-moneyness k
//
//   w(k) = a + b · ( ρ·(k − m) + √((k − m)² + σ²) )
//
// where k = log(K / F). For a binary call (Predict's "settles UP at K")
// at expiry T, the Black-Scholes-style risk-neutral prob:
//
//   d₂ = (log(F/K) − ½·w(k)) / √w(k)
//   Pr(F_T > K) = N(d₂)
//
// (We use w(k) directly because SVI parameterizes total variance
// already, so σ·√T = √w(k) and no separate T factor appears.)
//
// All on-chain values are scaled by 1e9. a, b, σ are u64 nonneg; ρ and
// m are I64 (signed). ρ ∈ [-1, 1] after scaling; m is a log-moneyness
// shift.

import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";

import { PREDICT_PACKAGE, PRICE_SCALAR } from "./signal-shared.js";
import { normCdf } from "./signals.js";
import type { AgentContext } from "../../lib/sui.js";

/** Raw on-chain SVI tuple + spot/forward/expiry. All scaled by 1e9
 *  (PRICE_SCALAR) except expiry which is ms. */
export type RawSurfaceSnapshot = {
  /** Total-variance constant. Scaled by 1e9. */
  a: bigint;
  /** Variance slope. Scaled by 1e9. */
  b: bigint;
  /** Asymmetry parameter, signed, in [-1, +1] after / 1e9. */
  rho: bigint;
  /** Log-moneyness shift, signed, / 1e9. */
  m: bigint;
  /** Curvature, nonneg, / 1e9. */
  sigma: bigint;
  /** Current spot, scaled by 1e9. */
  spot: bigint;
  /** Risk-neutral forward, scaled by 1e9. */
  forward: bigint;
  /** Expiry timestamp ms. */
  expiryMs: bigint;
};

/** Decoded surface in real units — easier to reason about and to
 *  serialize into the Walrus reasoning blob. */
export type SurfaceSnapshot = {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
  spotUsd: number;
  forwardUsd: number;
  expiryMs: number;
};

/** Parse the Sui Predict module's I64 BCS encoding. */
function parseI64(bytes: number[]): bigint {
  if (bytes.length < 9) {
    throw new Error(`I64 needs 9 bytes, got ${bytes.length}`);
  }
  // 8 little-endian magnitude bytes followed by 1 negative-flag byte
  // (0 = positive, 1 = negative).
  const mag = BigInt(bcs.U64.parse(Uint8Array.from(bytes.slice(0, 8))));
  const negative = bytes[8] !== 0;
  return negative ? -mag : mag;
}

/** One devInspect PTB that reads the entire surface in one round-trip. */
export async function readSurfaceRaw(
  ctx: AgentContext,
  oracleId: string,
): Promise<RawSurfaceSnapshot> {
  const tx = new Transaction();
  const svi = tx.moveCall({
    target: `${PREDICT_PACKAGE}::oracle::svi`,
    arguments: [tx.object(oracleId)],
  });
  for (const fn of ["svi_a", "svi_b", "svi_rho", "svi_m", "svi_sigma"]) {
    tx.moveCall({ target: `${PREDICT_PACKAGE}::oracle::${fn}`, arguments: [svi] });
  }
  for (const fn of ["spot_price", "forward_price", "expiry"]) {
    tx.moveCall({
      target: `${PREDICT_PACKAGE}::oracle::${fn}`,
      arguments: [tx.object(oracleId)],
    });
  }
  const r = await ctx.client.devInspectTransactionBlock({
    sender: ctx.address,
    transactionBlock: tx,
  });
  const results = r.results ?? [];
  // Command 0 is the svi(oracle) call which returns the SVIParams ref;
  // commands 1..5 are svi_a, svi_b, svi_rho, svi_m, svi_sigma; commands
  // 6..8 are spot/forward/expiry.
  function readU64At(idx: number): bigint {
    const ret = results[idx]?.returnValues?.[0];
    if (!ret) throw new Error(`SVI read: missing return at ${idx}`);
    return BigInt(bcs.U64.parse(Uint8Array.from(ret[0])));
  }
  function readI64At(idx: number): bigint {
    const ret = results[idx]?.returnValues?.[0];
    if (!ret) throw new Error(`SVI read: missing I64 return at ${idx}`);
    return parseI64(ret[0]);
  }
  return {
    a: readU64At(1),
    b: readU64At(2),
    rho: readI64At(3),
    m: readI64At(4),
    sigma: readU64At(5),
    spot: readU64At(6),
    forward: readU64At(7),
    expiryMs: readU64At(8),
  };
}

export function decodeSurface(raw: RawSurfaceSnapshot): SurfaceSnapshot {
  const s = (v: bigint) => Number(v) / PRICE_SCALAR;
  return {
    a: s(raw.a),
    b: s(raw.b),
    rho: s(raw.rho),
    m: s(raw.m),
    sigma: s(raw.sigma),
    spotUsd: s(raw.spot),
    forwardUsd: s(raw.forward),
    expiryMs: Number(raw.expiryMs),
  };
}

/** SVI total implied variance at log-moneyness k. */
export function sviTotalVariance(s: SurfaceSnapshot, k: number): number {
  const dk = k - s.m;
  return s.a + s.b * (s.rho * dk + Math.sqrt(dk * dk + s.sigma * s.sigma));
}

/** Market-implied probability Pr(F_T > strike) under the SVI surface.
 *  Returns 0..1. Returns null when the surface is degenerate (negative
 *  variance) or inputs are invalid — the strategy treats this as "no
 *  market signal, sit out." */
export function impliedProbUp(
  s: SurfaceSnapshot,
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

/** Pretty-print the surface for the Walrus reasoning markdown. */
export function describeSurface(s: SurfaceSnapshot): string {
  return [
    `forward $${s.forwardUsd.toFixed(2)}`,
    `spot $${s.spotUsd.toFixed(2)}`,
    `a=${s.a.toFixed(6)}`,
    `b=${s.b.toFixed(6)}`,
    `ρ=${s.rho.toFixed(4)}`,
    `m=${s.m.toFixed(6)}`,
    `σ=${s.sigma.toFixed(6)}`,
  ].join(", ");
}
