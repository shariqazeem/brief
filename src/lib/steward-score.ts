// Steward Score · how well an operator PROTECTED the capital it was trusted
// with, on a 0-100 scale. This is the leaderboard's default ranking, and it is
// deliberately NOT raw P&L: an operator that gambled its way to a big number
// should not outrank one that preserved capital with discipline.
//
// Five weighted components (see docs/steward-score.md for the full formula):
//   Capital Preservation  30  · downside capture vs simply holding the asset
//   Drawdown Discipline   20  · worst drawdown vs the mode's allowed envelope
//   Policy Compliance     20  · starts 100; agent-caused on-chain aborts subtract
//   Risk Efficiency       15  · realized return per unit of drawdown taken
//   Realized Return       15  · fee-inclusive return vs holding cash
//
// Pure + deterministic over the inputs, so the API, the docs, and any test all
// agree. Inputs come from the operator's on-disk lifetime stats (fee-inclusive
// marks) plus its mode; no network calls here.

export type StewardMode = "protect" | "grow" | "aggressive";

export type StewardInputs = {
  mode: StewardMode;
  /** Deposited capital (USD) · the return baseline. */
  deposit: number;
  /** Asset mid at launch and now · the buy-and-hold benchmark. */
  launchMid: number;
  lastMid: number;
  /** Latest marked portfolio value (USD), fee-inclusive. */
  lastValue: number;
  /** Worst drawdown from peak ever seen (positive %). */
  worstDrawdownPct: number;
  /** Count of on-chain aborts CAUSED by the agent's own attempt (not owner
   *  revokes). Should be zero; each one subtracts from Policy Compliance. */
  agentAborts?: number;
  /** Owner withdrew capital · scoring is not meaningful, return null. */
  withdrawn?: boolean;
};

export type StewardBreakdown = {
  capitalPreservation: number; // 0-100
  drawdownDiscipline: number; // 0-100
  policyCompliance: number; // 0-100
  riskEfficiency: number; // 0-100
  realizedReturn: number; // 0-100
};

export type StewardResult = {
  score: number; // 0-100
  breakdown: StewardBreakdown;
  returnPct: number; // operator's fee-inclusive return (%)
  holdReturnPct: number; // buy-and-hold the asset (%)
};

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

/** Worst drawdown the mode is expected to stay within (percent). Exceeding it
 *  zeroes the discipline component. */
const DRAWDOWN_ENVELOPE: Record<StewardMode, number> = {
  protect: 6,
  grow: 12,
  aggressive: 20,
};

export const STEWARD_WEIGHTS = {
  capitalPreservation: 0.3,
  drawdownDiscipline: 0.2,
  policyCompliance: 0.2,
  riskEfficiency: 0.15,
  realizedReturn: 0.15,
} as const;

export function stewardScore(inp: StewardInputs): StewardResult | null {
  if (inp.withdrawn) return null;
  if (!(inp.deposit > 0)) return null; // never funded → not scorable

  const ret = (inp.lastValue - inp.deposit) / inp.deposit; // fee-inclusive fraction
  const hold =
    inp.launchMid > 0 && inp.lastMid > 0 ? (inp.lastMid - inp.launchMid) / inp.launchMid : 0;
  const dd = Math.max(0, inp.worstDrawdownPct);

  // 1) Capital Preservation · downside capture vs holding the asset.
  let capitalPreservation: number;
  if (hold < 0) {
    // The asset fell. Capture = how much of that fall the operator absorbed.
    // 0 = avoided it entirely (or made money), 1 = fell exactly with it.
    const capture = clamp((Math.min(ret, 0) / hold) * 100, 0, 100) / 100;
    capitalPreservation = clamp((1 - capture) * 100);
  } else {
    // The asset rose/flat. Preserving = not losing money; growing too is ideal.
    capitalPreservation = ret >= 0 ? 100 : clamp(100 + (ret / Math.max(hold, 0.01)) * 100);
  }

  // 2) Drawdown Discipline · worst drawdown vs the mode's allowed envelope.
  const envelope = DRAWDOWN_ENVELOPE[inp.mode];
  const drawdownDiscipline = clamp((1 - dd / envelope) * 100);

  // 3) Policy Compliance · starts perfect; agent-caused aborts subtract 25 each.
  const policyCompliance = clamp(100 - Math.max(0, inp.agentAborts ?? 0) * 25);

  // 4) Risk Efficiency · realized return per unit of drawdown taken. A floor on
  // the denominator stops a near-zero-drawdown operator from dominating on noise.
  const riskUnit = Math.max(dd / 100, 0.02);
  const riskEfficiency = clamp(50 + (ret / riskUnit) * 25);

  // 5) Realized Return · fee-inclusive, vs holding cash (0%). +5% → 100, -5% → 0.
  const realizedReturn = clamp(50 + ret * 1000);

  const breakdown: StewardBreakdown = {
    capitalPreservation,
    drawdownDiscipline,
    policyCompliance,
    riskEfficiency,
    realizedReturn,
  };

  const score = clamp(
    breakdown.capitalPreservation * STEWARD_WEIGHTS.capitalPreservation +
      breakdown.drawdownDiscipline * STEWARD_WEIGHTS.drawdownDiscipline +
      breakdown.policyCompliance * STEWARD_WEIGHTS.policyCompliance +
      breakdown.riskEfficiency * STEWARD_WEIGHTS.riskEfficiency +
      breakdown.realizedReturn * STEWARD_WEIGHTS.realizedReturn,
  );

  return {
    score: Math.round(score),
    breakdown: {
      capitalPreservation: Math.round(capitalPreservation),
      drawdownDiscipline: Math.round(drawdownDiscipline),
      policyCompliance: Math.round(policyCompliance),
      riskEfficiency: Math.round(riskEfficiency),
      realizedReturn: Math.round(realizedReturn),
    },
    returnPct: Number((ret * 100).toFixed(2)),
    holdReturnPct: Number((hold * 100).toFixed(2)),
  };
}
