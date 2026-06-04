// Operator State Language — the precise vocabulary used throughout the
// operator console. Every visible status pill, every heartbeat label,
// every aria-live announcement derives from this enum. Keeping it in
// one file means we never drift between "Active" / "Running" / "Live"
// across surfaces.
//
// The state is a pure derivation from on-chain data (policy + latest
// action) plus wall-clock time. No off-chain state is involved.

import type { OperatorPolicyDecoded } from "./operator-policy-client";
import type { DecodedWorkObject } from "./work-object";

export type OperatorState =
  | "online"        // just granted, no actions yet, < 30s ago
  | "scanning"      // between cycles, looking for opportunities
  | "deploying"     // an action minted in the last 2s
  | "blocked"       // last attempt was a Rejection, policy revoked
  | "revoked"       // policy.revoked = true
  | "expired"       // policy.expires_at_ms reached
  | "exhausted"     // policy.spent >= budget_cap
  | "awaiting";     // a Proposal is awaiting user Approval (future)

// State labels — operational, not SaaS. Used directly by header + operator
// card. Richer per-state copy (verb, one-line description) lives in the
// Operator Language System at src/lib/operator-language.ts.
export const OPERATOR_STATE_LABEL: Record<OperatorState, string> = {
  online: "OPERATOR ENGAGED",
  scanning: "SCANNING",
  deploying: "DEPLOYING",
  blocked: "BLOCKED BY POLICY",
  revoked: "REVOKED",
  expired: "EXPIRED",
  exhausted: "BUDGET EXHAUSTED",
  awaiting: "AWAITING APPROVAL",
};

export type StateTone = "live" | "ended" | "kill";

export function operatorStateTone(state: OperatorState): StateTone {
  if (state === "revoked" || state === "blocked") return "kill";
  if (state === "expired" || state === "exhausted") return "ended";
  return "live";
}

const DEPLOY_WINDOW_MS = 2000;
const ONLINE_WINDOW_MS = 30_000;

/**
 * Derive the operator's state from on-chain artifacts.
 *
 * Inputs:
 *  - the policy (current chain state)
 *  - the latest action WorkObject parented to this policy (newest first)
 *  - the wall-clock time the caller wants to evaluate against
 */
export function deriveOperatorState(
  policy: OperatorPolicyDecoded,
  latestAction: DecodedWorkObject | undefined,
  nowMs: number,
): OperatorState {
  // Terminal states first
  if (policy.revoked) {
    return latestAction && latestAction.kind === "Rejection" ? "blocked" : "revoked";
  }
  if (nowMs >= Number(policy.expiresAtMs)) return "expired";
  if (policy.spent >= policy.budgetCap) return "exhausted";

  // Just-deployed (in the brief window after a successful action)
  if (
    latestAction &&
    latestAction.kind === "Operator" &&
    nowMs - Number(latestAction.timestampMs) < DEPLOY_WINDOW_MS
  ) {
    return "deploying";
  }

  // No actions yet, recently granted
  if (
    !latestAction &&
    nowMs - Number(policy.createdAtMs) < ONLINE_WINDOW_MS
  ) {
    return "online";
  }

  return "scanning";
}

/**
 * Time-since the policy was granted, formatted for human eyes.
 * "12s" / "4m" / "1h 23m" / "2d 4h"
 */
export function formatUptime(sinceMs: bigint, nowMs: number): string {
  const diff = Math.max(0, nowMs - Number(sinceMs));
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return `${h}h ${remM}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/**
 * Seconds until the next operator polling cycle, given the latest action
 * (or grant time when no actions yet) and the configured cycle length.
 */
export function secondsUntilNextScan(
  policy: OperatorPolicyDecoded,
  latestActionMs: number | null,
  cycleMs: number,
  nowMs: number,
): number {
  const base = latestActionMs ?? Number(policy.createdAtMs);
  return Math.max(0, Math.ceil((base + cycleMs - nowMs) / 1000));
}
