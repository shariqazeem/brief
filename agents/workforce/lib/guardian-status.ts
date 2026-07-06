// Shared Risk-Guardian status · written by the guardian agent, read by the
// trader (to respect a pause) and the web tier (to show it). Kept in its own
// module so importing it never triggers an agent's main loop.

import { promises as fs } from "node:fs";
import * as path from "node:path";

export const GUARDIAN_STATUS_PATH = path.join(
  ".cursors",
  "guardian-status.json",
);

/** Graduated risk level from the asset-relative vol percentile. The trader maps
 *  this to behaviour: normal = full size, elevated = smaller positions, extreme
 *  = no NEW exposure (hold/reduce only), crash = move to cash. */
export type RiskLevel = "normal" | "elevated" | "extreme" | "crash";

/** Per-asset risk state · each asset is judged ONLY against its own 60m-vol
 *  history, so DEEP's normal wildness gates DEEP exposure without freezing a
 *  calm SUI position on the same operator. This is the fix for the "one spiking
 *  asset freezes the whole operator" bug. */
export type AssetGuardState = {
  /** Graduated level from this asset's OWN vol percentile. */
  level: RiskLevel;
  /** Human-legible reason (renders in the UI Guard step). */
  reason: string;
  /** Realized 60m vol (annualized) for this asset. */
  vol: number | null;
  /** This vol's percentile within the asset's own trailing distribution. */
  pct: number | null;
  /** True at extreme+ · no NEW exposure to THIS asset (hold or reduce only). */
  pausedNewExposure: boolean;
};

export type GuardianOperator = {
  /** True only at crash (full stop to cash) · a SUMMARY across the whole
   *  operator (worst asset OR portfolio drawdown). elevated/extreme keep it
   *  operating at reduced size. Per-asset gating lives in `assets` below; the
   *  trader reads THAT for the specific asset it is evaluating this cycle. */
  paused: boolean;
  /** Human-readable reason for the current (summary) state. */
  reason: string;
  /** "ok" | "watch" | "paused" · drives the UI colour. */
  severity: "ok" | "watch" | "paused";
  /** Realized vol (annualized) of the worst asset + worst drawdown seen. */
  vol: number | null;
  drawdownPct: number;
  /** When the current state began. */
  since: number;
  updatedMs: number;
  /** Graduated risk level SUMMARY (worst asset OR drawdown). */
  riskLevel?: RiskLevel;
  /** Worst asset's vol percentile within its own trailing distribution. */
  volPct?: number | null;
  /** Per-asset risk state · keyed by asset symbol (SUI/WAL/DEEP). Each asset is
   *  judged only against its own history, so one spiking asset gates only its
   *  own exposure. The trader reads `assets[asset]` for the asset it is
   *  evaluating; absent → fall back to the `riskLevel` summary. */
  assets?: Record<string, AssetGuardState>;
  /** Portfolio-level risk that halts EVERYTHING regardless of per-asset vol · a
   *  drawdown-limit breach (with hysteresis) or a manual force. */
  portfolio?: {
    /** True while the portfolio drawdown pause is engaged (halts all assets). */
    drawdownPause: boolean;
    /** Current drawdown from peak (%) that drives the pause. */
    drawdownPct: number;
  };
};

export type GuardianStatus = {
  updatedMs: number;
  operators: Record<string, GuardianOperator>;
};

export async function loadGuardianStatus(): Promise<GuardianStatus> {
  try {
    const raw = await fs.readFile(GUARDIAN_STATUS_PATH, "utf8");
    const parsed = JSON.parse(raw) as GuardianStatus;
    if (parsed && typeof parsed === "object" && parsed.operators) return parsed;
  } catch {
    /* no status yet */
  }
  return { updatedMs: 0, operators: {} };
}

export async function saveGuardianStatus(s: GuardianStatus): Promise<void> {
  try {
    await fs.mkdir(path.dirname(GUARDIAN_STATUS_PATH), { recursive: true });
    const tmp = GUARDIAN_STATUS_PATH + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(s, null, 2));
    await fs.rename(tmp, GUARDIAN_STATUS_PATH);
  } catch {
    /* never escalate */
  }
}

/** Is this operator currently paused by the guardian? */
export function guardianPausedFor(
  s: GuardianStatus,
  policyId: string,
): GuardianOperator | null {
  const o = s.operators[policyId];
  return o && o.paused ? o : null;
}
