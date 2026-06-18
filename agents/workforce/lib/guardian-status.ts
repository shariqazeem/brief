// Shared Risk-Guardian status · written by the guardian agent, read by the
// trader (to respect a pause) and the web tier (to show it). Kept in its own
// module so importing it never triggers an agent's main loop.

import { promises as fs } from "node:fs";
import * as path from "node:path";

export const GUARDIAN_STATUS_PATH = path.join(
  ".cursors",
  "guardian-status.json",
);

export type GuardianOperator = {
  paused: boolean;
  /** Human-readable reason for the current state. */
  reason: string;
  /** "ok" | "watch" | "paused" · drives the UI colour. */
  severity: "ok" | "watch" | "paused";
  /** Realized vol (annualized) + worst drawdown the guardian last saw. */
  vol: number | null;
  drawdownPct: number;
  /** When the current paused/active state began. */
  since: number;
  updatedMs: number;
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
