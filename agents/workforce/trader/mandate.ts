// The user's investment MANDATE · a specific human objective the operator
// acts on, and a risk limit it cannot talk itself past.
//
//   "Grow my capital 15% in 6 months while avoiding drawdowns above 8%."
//
// The mandate is stored on Walrus (a verifiable instruction from the human)
// and enforced live: the operator marks its portfolio to market each cycle,
// tracks the peak, and if the drawdown from peak hits the mandate's limit it
// STANDS DOWN · it will not open new risk that violates the human's objective.
// The on-chain budget cap is the hard floor; this is the tighter, human guard.

import { promises as fs } from "node:fs";
import * as path from "node:path";

export type Mandate = {
  /** Target return over the horizon, percent (e.g. 15 = +15%). */
  targetReturnPct: number;
  /** Horizon in days (e.g. 180). */
  horizonDays: number;
  /** Max tolerated drawdown from peak, percent (e.g. 8). The hard guard. */
  maxDrawdownPct: number;
};

/** Parse + validate a mandate from registry/JSON. maxDrawdownPct is required
 *  (it's the enforced guard); the rest default sensibly. Null = no mandate. */
export function normalizeMandate(m: unknown): Mandate | null {
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  const t = Number(o.targetReturnPct);
  const h = Number(o.horizonDays);
  const d = Number(o.maxDrawdownPct);
  if (!Number.isFinite(d) || d <= 0) return null;
  return {
    targetReturnPct: Number.isFinite(t) && t > 0 ? t : 0,
    horizonDays: Number.isFinite(h) && h > 0 ? h : 30,
    maxDrawdownPct: Math.min(90, d),
  };
}

const DIR = ".cursors";
const fileFor = (policyId: string) =>
  path.join(DIR, `operator-mandate-${policyId.slice(2, 14)}.json`);

export type MandateState = { peakValue: number; updatedMs: number };

export async function loadMandateState(policyId: string): Promise<MandateState | null> {
  try {
    const raw = await fs.readFile(fileFor(policyId), "utf8");
    const p = JSON.parse(raw) as MandateState;
    return Number.isFinite(p?.peakValue) ? p : null;
  } catch {
    return null;
  }
}

export async function saveMandateState(policyId: string, s: MandateState): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(fileFor(policyId), JSON.stringify(s));
}

export type MandateEval = {
  /** Portfolio progress vs the initial deposit, percent (signed). */
  progressPct: number;
  /** Current drawdown from peak, percent (0+). */
  drawdownPct: number;
  /** True when drawdown ≥ the mandate's limit · the operator must stand down. */
  breached: boolean;
  /** One-line objective summary for the banner. */
  summary: string;
  /** Human review line for the decision. */
  review: string;
};

export function mandateSummary(m: Mandate): string {
  const grow = m.targetReturnPct > 0 ? `Grow ${m.targetReturnPct}% in ${m.horizonDays}d · ` : "";
  return `${grow}max ${m.maxDrawdownPct}% drawdown`;
}

/** Mark the portfolio to market and judge it against the mandate. */
export function evalMandate(args: {
  mandate: Mandate;
  /** Current portfolio value (USDC: quote + base·mid). */
  currentValue: number;
  /** Initial deposit (USDC). */
  initialValue: number;
  /** Peak value seen so far (USDC). */
  peakValue: number;
}): MandateEval {
  const { mandate, currentValue, initialValue } = args;
  const peak = Math.max(args.peakValue, currentValue, initialValue);
  const progressPct = initialValue > 0 ? ((currentValue - initialValue) / initialValue) * 100 : 0;
  const drawdownPct = peak > 0 ? Math.max(0, ((peak - currentValue) / peak) * 100) : 0;
  const breached = drawdownPct >= mandate.maxDrawdownPct;
  const review = breached
    ? `Mandate guard TRIPPED · drawdown ${drawdownPct.toFixed(
        1,
      )}% reached the ${mandate.maxDrawdownPct}% limit you set. Standing down: no new risk until it recovers.`
    : `Mandate: ${progressPct >= 0 ? "+" : ""}${progressPct.toFixed(1)}%${
        mandate.targetReturnPct > 0 ? ` toward ${mandate.targetReturnPct}%` : ""
      } · drawdown ${drawdownPct.toFixed(1)}% of the ${mandate.maxDrawdownPct}% limit. Within mandate.`;
  return { progressPct, drawdownPct, breached, summary: mandateSummary(mandate), review };
}
