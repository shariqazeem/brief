// Market-regime classifier · the operator's "understanding" layer.
//
// Before it decides anything, the operator first asks "what kind of market is
// this?" and classifies it into one of a few regimes. The regime then gates +
// frames the decision: you don't trade a range the way you trade a trend, and
// a stretched, fading tape (mean-reversion) is a stand-aside, not a chase.
//
// Deterministic + scale-stable: built from ROC (trend strength/direction),
// RSI (stretch), and MA alignment · NOT raw annualized vol (which is
// scale-sensitive on a thin testnet pool). A third party recomputes it exactly.

import type { SignalBundle } from "./signals.js";

export type RegimeKind =
  | "trending-up"
  | "trending-down"
  | "breakout"
  | "range-bound"
  | "mean-reversion";

export type Regime = {
  kind: RegimeKind;
  label: string;
  /** One-line, human, from the numbers. */
  note: string;
  /** Does this regime offer a directional edge worth taking at all? */
  tradeable: boolean;
  /** How a trend-follower should stand toward it. */
  stance: "follow" | "fade" | "stand-aside";
};

// Thresholds on 30m ROC (fraction). Scale-stable across assets.
const SOME = 0.0025; // 0.25% · a trend exists at all
const STRONG = 0.006; // 0.6% · a strong directional move
const SHARP = 0.012; // 1.2% · a breakout-grade move

export function classifyRegime(s: SignalBundle): Regime {
  const roc30 = s.roc_30m ?? 0;
  const a = Math.abs(roc30);
  const up = roc30 >= 0;
  const rsi = s.rsi_60m ?? 50;
  const vol = s.realized_vol_60m;
  const volNote = vol != null ? ` · vol ${(vol * 100).toFixed(0)}%` : "";
  const aligned =
    s.sma_15m != null && s.sma_60m != null ? (s.sma_15m >= s.sma_60m ? 1 : -1) : 0;
  const overbought = rsi >= 75;
  const oversold = rsi <= 25;

  // 1) Mean-reversion · stretched RSI while the trend is NOT strong: the move
  //    is exhausting and likely to snap back. A fade signal, so: stand aside.
  if ((overbought || oversold) && a < STRONG) {
    return {
      kind: "mean-reversion",
      label: "Mean-reversion",
      note: `RSI ${rsi.toFixed(0)} ${overbought ? "overbought" : "oversold"}, trend fading · stretched and likely to revert${volNote}.`,
      tradeable: false,
      stance: "fade",
    };
  }

  // 2) Breakout · a sharp directional expansion. A trend worth following.
  if (a >= SHARP) {
    return {
      kind: "breakout",
      label: "Breakout",
      note: `Sharp ${up ? "up" : "down"} move · 30m ROC ${(roc30 * 100).toFixed(2)}%${volNote}.`,
      tradeable: true,
      stance: "follow",
    };
  }

  // 3) Trending · a clear directional move with the MA agreeing (or neutral).
  if (a >= SOME && (aligned === 0 || up === aligned > 0)) {
    return {
      kind: up ? "trending-up" : "trending-down",
      label: up ? "Trending up" : "Trending down",
      note: `30m ROC ${(roc30 * 100).toFixed(2)}%, short MA ${aligned >= 0 ? "above" : "below"} long · a directional trend${volNote}.`,
      tradeable: true,
      stance: "follow",
    };
  }

  // 4) Range-bound · flat tape, no trend to ride. Stand aside.
  return {
    kind: "range-bound",
    label: "Range-bound",
    note: `Flat tape · 30m ROC ${(roc30 * 100).toFixed(2)}%, no clean direction${volNote}.`,
    tradeable: false,
    stance: "stand-aside",
  };
}
