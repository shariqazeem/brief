// Operator Language System — the single source of operational vocabulary
// used across the product. No screen, badge, button, or microcopy should
// reach for a generic SaaS / DeFi word like "active", "recent actions",
// or "portfolio". Every visible string in the operator console derives
// from this file (or a small explicit override with a reason).
//
// The naming convention reinforces the product philosophy:
//
//   "The AI is not trusted. The policy is."
//
// So labels are about *the operator operating inside a policy envelope*,
// not about money moving inside a portfolio.

import { OPERATOR_STATE_LABEL, type OperatorState } from "./operator-state";

// ---------------------------------------------------------------------------
// Operator state — richer copy built on top of OPERATOR_STATE_LABEL (which
// lives in operator-state.ts so the derivation module has no cyclical
// dependency on this file). Surfaces that just need the badge label can
// import OPERATOR_STATE_LABEL directly; surfaces that need verb + tooltip
// reach for OPERATOR_STATE_COPY here.
// ---------------------------------------------------------------------------

export const OPERATOR_STATE_COPY: Record<
  OperatorState,
  { label: string; verb: string; oneLine: string }
> = {
  online: {
    label: OPERATOR_STATE_LABEL.online,
    verb: "engaged",
    oneLine: "Operator has come online and is preparing its first cycle.",
  },
  scanning: {
    label: OPERATOR_STATE_LABEL.scanning,
    verb: "scanning",
    oneLine: "Evaluating venues against the policy envelope.",
  },
  deploying: {
    label: OPERATOR_STATE_LABEL.deploying,
    verb: "deploying",
    oneLine: "Submitting an atomic transaction to the chain.",
  },
  blocked: {
    label: OPERATOR_STATE_LABEL.blocked,
    verb: "blocked",
    oneLine: "Chain enforcement just aborted an attempted spend.",
  },
  revoked: {
    label: OPERATOR_STATE_LABEL.revoked,
    verb: "revoked",
    oneLine: "Mandate revoked — operator suspended on-chain.",
  },
  expired: {
    label: OPERATOR_STATE_LABEL.expired,
    verb: "expired",
    oneLine: "Policy expiry reached — operator has stood down.",
  },
  exhausted: {
    label: OPERATOR_STATE_LABEL.exhausted,
    verb: "exhausted",
    oneLine: "Budget envelope spent in full — operator at rest.",
  },
  awaiting: {
    label: OPERATOR_STATE_LABEL.awaiting,
    verb: "awaiting",
    oneLine: "Operator proposed an action that exceeds the auto-approve band.",
  },
};

// ---------------------------------------------------------------------------
// Section headers — replace generic SaaS labels with operational language.
// ---------------------------------------------------------------------------

export const SECTION = {
  /** Activity stream header — was "recent actions". */
  activity: "TELEMETRY",
  /** Operator card eyebrow — was "operator". */
  operator: "OPERATOR",
  /** The envelope sub-section — was "constraints" / "settings". */
  envelope: "POLICY ENVELOPE",
  /** The deployment drawer — was "allocation". */
  deployment: "DEPLOYED CAPITAL",
  /** The performance drawer — was "performance" / "metrics". */
  performance: "RETURN PROFILE",
  /** History list — was "past operators". */
  history: "PRIOR OPERATORS",
  /** Decision sub-panel — new in Phase C. */
  decision: "DECISION TRACE",
} as const;

// ---------------------------------------------------------------------------
// Verbs / nouns — the operational lexicon. Every action in the timeline,
// every button, every status uses these.
// ---------------------------------------------------------------------------

export const TERMS = {
  // Action verbs (what the operator does)
  deploy: "deploy",
  rotate: "rotate",
  hold: "hold position",
  scan: "scan",
  enforce: "enforce",
  abort: "abort",
  settle: "settle",
  evaluate: "evaluate",
  grant: "grant",
  revoke: "revoke",

  // Nouns
  operator: "operator",
  policy: "policy",
  envelope: "envelope",
  mandate: "mandate",
  venue: "venue",
  cycle: "cycle",
  cap: "cap",
  cover: "concentration",

  // Outcomes — constitutional language. Avoid "error" / "failed" / "denied".
  accepted: "accepted on-chain",
  enforced: "policy enforced on-chain",
  rejected: "rejected by policy",
  aborted: "aborted on-chain",
  authorityRevoked: "authority revoked",
  policyIntervention: "policy intervention",
  chainAborted: "chain aborted",
  operatorStoodDown: "operator stood down",
  mandateTerminated: "mandate terminated",
  killSwitch: "kill switch",
} as const;

// ---------------------------------------------------------------------------
// Action telemetry — labels for each row kind in the activity stream.
// ---------------------------------------------------------------------------

export const ACTION_LABEL = {
  /** A successful Operator action — capital deployed into a venue. */
  deployed: "DEPLOYED",
  /** A Rejection — chain aborted the attempt. */
  aborted: "CHAIN ABORTED",
  /** The grant event — when the operator was first engaged. */
  granted: "MANDATE GRANTED",
  /** When the operator's loop voluntarily stops. */
  stood_down: "OPERATOR STOOD DOWN",
  /** Inline live telemetry — operator is between cycles. */
  scanning_now: "SCANNING VENUES",
  /** Inline live telemetry — submission in flight. */
  deploying_now: "DEPLOYING",
} as const;

// ---------------------------------------------------------------------------
// Rejection reason copy — already lived in ActivityStream.tsx; move here
// so other surfaces (banners, header tooltips) can use the same strings.
// ---------------------------------------------------------------------------

export const REJECTION_REASON: Record<string, { short: string; long: string }> = {
  revoked: {
    short: "authority revoked",
    long: "Mandate revoked by owner — the agent's attempted spend was aborted on-chain.",
  },
  expired: {
    short: "expiry reached",
    long: "Policy expiry reached — the agent's attempted spend was aborted on-chain.",
  },
  budget_exceeded: {
    short: "envelope exhausted",
    long: "Budget envelope full — over-spend aborted on-chain.",
  },
  venue_not_allowed: {
    short: "venue outside envelope",
    long: "Venue is not in the policy allowlist — trade aborted on-chain.",
  },
  not_agent: {
    short: "signer outside mandate",
    long: "Only the bound agent address can spend against this policy.",
  },
  unknown_policy_abort: {
    short: "policy intervention",
    long: "Policy enforcement aborted the transaction on-chain.",
  },
};

// ---------------------------------------------------------------------------
// Empty states — every empty space in the product gets honest, operational
// copy. Never "no data" or "nothing here yet".
// ---------------------------------------------------------------------------

export const EMPTY = {
  noOperator: "No operator engaged.",
  scanningFirstCycle: "Scanning venues — first opportunity any moment now.",
  noPriorOperators: "No prior operators yet. Each one persists on-chain.",
  noDeployedCapital:
    "No capital deployed yet. First scan completes shortly.",
  noTelemetry: "Awaiting first telemetry from the operator.",
  noConstraintsChanged: "Envelope unchanged since grant.",
} as const;

// ---------------------------------------------------------------------------
// CTA labels — confident, action-oriented, never SaaS-y.
// ---------------------------------------------------------------------------

export const CTA = {
  activate: "Activate operator",
  revoke: "Revoke mandate",
  confirmRevoke: "Revoke now",
  cancel: "Cancel",
  signing: "Signing…",
  showDetails: "Show telemetry detail",
  hideDetails: "Hide detail",
  grantAnother: "Grant another operator",
  viewOnChain: "View on Sui",
  acknowledge: "Acknowledge",
} as const;

// ---------------------------------------------------------------------------
// Header / chrome
// ---------------------------------------------------------------------------

export const CHROME = {
  /** Sticky header brand. */
  brand: "Brief",
  /** Disconnected-state hero. */
  heroLine: "Autonomous financial operators on Sui.",
  /** Philosophy line used in multiple places. */
  philosophy: "the AI is not trusted · the policy is",
  /** Footer attribution. */
  builtFor: "Sui Overflow 2026 · sub-tracks 2 + 3",
} as const;
