// Operator identity — a memorable codename + a human objective line.
//
// "Grow Operator 87" is a row in a table. "Atlas — grows capital steadily"
// is something you adopt and root for. The codename is deterministic from the
// policy id (stable across sessions, no storage), so the same operator is
// always the same name everywhere it's shown.

import type { OperatorGoal } from "@/lib/operator-goal";

// Celestial / mythic — short, memorable, neutral.
const CODENAMES = [
  "Atlas",
  "Orion",
  "Vega",
  "Nova",
  "Juno",
  "Cyrus",
  "Mira",
  "Onyx",
  "Lyra",
  "Solis",
  "Vesta",
  "Kepler",
  "Astra",
  "Rhea",
  "Titan",
  "Halcyon",
  "Echo",
  "Pax",
  "Indra",
  "Zephyr",
  "Cassia",
  "Draco",
  "Elara",
  "Faro",
];

export function operatorCodename(policyId: string | null | undefined): string {
  if (!policyId || policyId.length < 4) return "Operator";
  let h = 0;
  for (let i = 2; i < policyId.length; i++) {
    h = (h * 31 + policyId.charCodeAt(i)) >>> 0;
  }
  return CODENAMES[h % CODENAMES.length];
}

/** Objective from the operator mode — used where only the mode is known
 *  (Results page, fleet comparison) rather than the full goal. */
export function objectiveFromMode(mode: string | null | undefined): string {
  if (mode === "protect") return "Protect capital";
  if (mode === "aggressive") return "Beat passive SUI";
  if (mode === "grow") return "Grow steadily";
  return "Manage capital under mandate";
}

/** A human objective line from the user's goal — what this operator is FOR. */
export function objectiveLabel(goal: OperatorGoal | null | undefined): string {
  if (!goal) return "Manage capital under your mandate";
  if (goal.type === "preserve") return "Protect capital";
  if (goal.type === "edge") return "Beat passive SUI";
  if (goal.type === "grow") {
    return goal.targetPct && goal.horizonDays
      ? `Grow ${goal.targetPct}% in ${goal.horizonDays} days`
      : "Grow capital steadily";
  }
  return "Manage capital under your mandate";
}
