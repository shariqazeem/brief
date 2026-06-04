// Ambient World State — lightweight environmental telemetry the operator
// reads each cycle. The signal is intentionally coarse: a single regime
// label + a few raw inputs. The goal is to make the operator's behavior
// adapt visibly to the surrounding market climate without faking depth.
//
// Sources:
//   - Sui checkpoint cadence — proxy for chain congestion
//   - Cross-venue APY dispersion in the market snapshot — proxy for
//     yield volatility / "is something happening today"
//   - Average TVL across signaled venues — proxy for liquidity climate
//
// All inputs are cheap and resilient (the snapshot already exists; the
// Sui RPC call has a 1500ms timeout). If everything fails we emit a
// "unknown" regime — the operator still functions.

import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { MarketSnapshot } from "./signals.js";

export type WorldRegime =
  | "calm"        // tight dispersion, healthy TVL, low chain congestion
  | "elevated"    // wider yield dispersion → volatility rising
  | "defensive"   // shrinking liquidity → operator should narrow venues
  | "fragmented"  // mixed signals — depth thin in some venues, fat in others
  | "stressed"    // multiple signals degraded or extreme readings
  | "unknown";    // no fresh data — degraded mode

export type WorldState = {
  regime: WorldRegime;
  /** One-line UX-ready description; safe to surface verbatim. */
  caption: string;
  /** Raw inputs surfaced into the WorkObject payload. */
  inputs: {
    checkpoint_lag_ms: number | null;
    yield_dispersion: number | null;
    median_tvl_usd: number | null;
    degraded_signal: boolean;
  };
};

const RPC_TIMEOUT_MS = 1500;

export async function deriveWorldState(
  client: SuiJsonRpcClient,
  snapshot: MarketSnapshot,
): Promise<WorldState> {
  const checkpointLag = await fetchCheckpointLag(client);

  const yields: number[] = [];
  const tvls: number[] = [];
  for (const sig of Object.values(snapshot.signals)) {
    if (typeof sig.raw.apy_pct === "number") yields.push(sig.raw.apy_pct);
    if (typeof sig.raw.tvl_usd === "number") tvls.push(sig.raw.tvl_usd);
  }

  const dispersion = yields.length >= 2 ? stddev(yields) : null;
  const medianTvl = tvls.length > 0 ? median(tvls) : null;

  // Compose the regime. Keep boundaries explicit + auditable.
  const inputs: WorldState["inputs"] = {
    checkpoint_lag_ms: checkpointLag,
    yield_dispersion: dispersion,
    median_tvl_usd: medianTvl,
    degraded_signal: snapshot.degraded,
  };

  if (snapshot.degraded || dispersion === null) {
    return {
      regime: "unknown",
      caption: "telemetry partial · running on cached posture",
      inputs,
    };
  }

  // Degraded sub-states
  if (checkpointLag !== null && checkpointLag > 3000) {
    return {
      regime: "stressed",
      caption: "chain checkpoint lag elevated · cautious cadence",
      inputs,
    };
  }
  if (medianTvl !== null && medianTvl < 5_000_000) {
    return {
      regime: "defensive",
      caption: "liquidity climate thinning · prefer audited venues",
      inputs,
    };
  }
  if (dispersion > 12) {
    return {
      regime: "elevated",
      caption: "yield dispersion widening · venue selection sensitive",
      inputs,
    };
  }
  if (dispersion > 6) {
    return {
      regime: "fragmented",
      caption: "mixed venue signal · rotation pressure rising",
      inputs,
    };
  }
  return {
    regime: "calm",
    caption: "liquidity stable · deployment confidence intact",
    inputs,
  };
}

// ---------------------------------------------------------------------------
// RPC: checkpoint lag
// ---------------------------------------------------------------------------

async function fetchCheckpointLag(
  client: SuiJsonRpcClient,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, RPC_TIMEOUT_MS);
    client
      .getLatestCheckpointSequenceNumber()
      .then(async (seq) => {
        if (settled) return;
        try {
          const cp = await client.getCheckpoint({ id: String(seq) });
          const ms = Number(cp.timestampMs ?? 0);
          const lag = Date.now() - ms;
          if (!settled) {
            settled = true;
            clearTimeout(t);
            resolve(Math.max(0, lag));
          }
        } catch {
          if (!settled) {
            settled = true;
            clearTimeout(t);
            resolve(null);
          }
        }
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(null);
      });
  });
}

// ---------------------------------------------------------------------------
// Stats utilities
// ---------------------------------------------------------------------------

function stddev(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
