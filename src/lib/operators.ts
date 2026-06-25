// Operator personalities · the single product source of truth.
//
// Users hire a NAMED operator with a specific mandate, not a vague risk slider.
// This file defines Mira / Echo / Nova once: their copy, their default universe,
// their budget suggestion, and the concrete behaviour params the backend must
// respect. The adopt flow resolves a template into (a) the on-chain policy
// (allowed_venues from the universe, budget cap) and (b) the registry entry
// (mode, personality, universe, cooldown) the trader reads. "Modes" still exist
// internally, but the user thinks in operators.
//
// The hard thesis is unchanged: AI proposes, Sui enforces. Every "promise" here
// is bounded by the Move policy · the universe is an on-chain allow-list, the
// budget is an on-chain cap, and the owner can revoke at any time.

/** Internal risk mode the backend's decision engine is calibrated by. */
export type OperatorModeSlug = "protect" | "grow" | "aggressive";

/** Internal deterministic strategy slug (the backend's MODE_CFG / strategy). */
export type OperatorStrategySlug = "conservative" | "momentum" | "contrarian";

/** A tradeable asset in an operator's universe. */
export type OperatorAsset = "SUI" | "WAL" | "DEEP";

export type OperatorTemplate = {
  /** url/registry slug · stable id. */
  slug: "mira" | "echo" | "nova";
  /** Display name. */
  name: string;
  /** Short role under the name (e.g. "Capital Guardian"). */
  role: string;
  /** One-line promise shown on the card and the dashboard. */
  promise: string;
  /** Internal mode mapping (drives backend thresholds). */
  mode: OperatorModeSlug;
  /** Internal strategy mapping. */
  strategy: OperatorStrategySlug;
  /** Default tradeable universe · enforced on-chain via allowed_venues. */
  universe: OperatorAsset[];
  /** Assets the user MAY add (not on by default) · keeps the default safe. */
  optionalUniverse: OperatorAsset[];
  /** Suggested starting budget in USDC. */
  defaultBudgetUsd: number;
  /** Max share of capital this operator will hold in its risk asset (0-1). */
  maxExposure: number;
  /** Minimum executed-trade spacing (seconds) · the backend's cooldown. */
  cooldownSec: number;
  /** One-word risk posture for the card. */
  riskPosture: "Defensive" | "Active" | "Experimental";
  /** Expected cadence copy for the card. */
  cadence: string;
  /** Who this operator is best for. */
  bestFor: string;
  /** UI accent token (hex) · matches the semantic palette. */
  accent: string;
  /** Small glyph for the card/header. */
  glyph: string;
  /** Whether to show an "experimental" warning. */
  experimental?: boolean;
  /** Legacy goal blob written to the registry (keeps existing backend working). */
  goal: { type: "preserve" | "grow" | "edge"; targetPct?: number; horizonDays?: number };
  /** Longer public explanation (operator page / card expand). */
  explanation: string;
  /** Copy for the adoption confirm step. */
  adoptionCopy: string;
  /** Copy shown before the operator has any history. */
  emptyState: string;
  /** Hard safety guarantees · what this operator can NEVER do (true for all,
   *  restated per operator so the promise is always next to the limit). */
  neverDoes: string[];
};

/** Asset → DeepBook venue label used by the Move policy's allowed_venues. */
export function venueForAsset(asset: OperatorAsset): string {
  return `spot-${asset.toLowerCase()}`;
}

/** The on-chain allow-list for a universe · this is what enforces the universe. */
export function venuesForUniverse(universe: OperatorAsset[]): string[] {
  return universe.map(venueForAsset);
}

const NEVER_DOES_BASE = [
  "Withdraw your funds · it only ever holds a trade capability, never a withdraw capability.",
  "Exceed its budget · the Move policy caps cumulative spend and aborts the trade if it would go over.",
  "Trade an asset outside its universe · the policy's allowed_venues rejects it on-chain.",
  "Keep trading after you revoke · one signature freezes it permanently.",
];

export const OPERATOR_TEMPLATES: OperatorTemplate[] = [
  {
    slug: "mira",
    name: "Mira",
    role: "Capital Guardian",
    promise: "Preserves capital first. Acts only when the edge is durable.",
    mode: "protect",
    strategy: "conservative",
    universe: ["SUI"],
    optionalUniverse: [],
    defaultBudgetUsd: 10,
    maxExposure: 0.3,
    cooldownSec: 4 * 60 * 60, // 4h · slow and deliberate
    riskPosture: "Defensive",
    cadence: "Most days: holds. Acts only on a clear, durable edge.",
    bestFor: "First-time users who want safety over upside.",
    accent: "#10B981",
    glyph: "◈",
    goal: { type: "preserve" },
    explanation:
      "Mira keeps most of your capital in USDC and takes only a small SUI position when the trend is confirmed and risk is low. She would rather miss a rally than sit through a drawdown. When volatility rises she reduces exposure before she stops, and in a real crash she moves to cash.",
    adoptionCopy:
      "You are hiring Mira to protect your capital. She trades only SUI, holds mostly cash, and acts sparingly. You can withdraw or revoke at any time.",
    emptyState:
      "Mira is reading the market. She holds cash until a durable edge appears · that patience is the point.",
    neverDoes: NEVER_DOES_BASE,
  },
  {
    slug: "echo",
    name: "Echo",
    role: "Momentum Operator",
    promise: "Moves with confirmed momentum in small, capped allocation shifts.",
    mode: "aggressive",
    strategy: "momentum",
    universe: ["SUI"],
    optionalUniverse: ["DEEP"], // DEEP-ready only if you explicitly turn it on
    defaultBudgetUsd: 10,
    maxExposure: 0.85,
    cooldownSec: 20 * 60, // 20m · visibly active, still spaced to avoid spam
    riskPosture: "Active",
    cadence: "Most days: several small allocation changes.",
    bestFor: "Users who want to see the operator working, with a hard leash.",
    accent: "#F59E0B",
    glyph: "◆",
    goal: { type: "edge" },
    explanation:
      "Echo follows confirmed momentum and is the most visibly active operator. Instead of waiting for perfect conviction, it nudges its target allocation in small steps (typically 5 to 15 percent) and rebalances only when the gap is meaningful, with a cooldown between trades so it never spams. It tolerates more churn than Mira, but the Guardian still shrinks its size in elevated volatility and the chain still caps everything.",
    adoptionCopy:
      "You are hiring Echo to ride confirmed momentum in small, capped steps. It trades SUI by default (DEEP only if you enable it), moves more often than Mira, and can never withdraw or exceed budget.",
    emptyState:
      "Echo is waiting for momentum to confirm. When it does, it will tilt in small steps and explain each one.",
    neverDoes: NEVER_DOES_BASE,
  },
  {
    slug: "nova",
    name: "Nova",
    role: "Experimental Learner",
    promise: "Tests small ideas with a tiny budget and maximum transparency.",
    mode: "grow",
    strategy: "contrarian",
    universe: ["SUI"],
    optionalUniverse: ["WAL", "DEEP"],
    defaultBudgetUsd: 5,
    maxExposure: 0.4,
    cooldownSec: 60 * 60, // 1h · frequent-ish, tiny sizes
    riskPosture: "Experimental",
    cadence: "Frequent tiny moves · learning, not performance.",
    bestFor: "Curious users who want to watch an agent learn in public.",
    accent: "#4DA2FF",
    glyph: "◇",
    experimental: true,
    goal: { type: "grow", targetPct: 5, horizonDays: 30 },
    explanation:
      "Nova is the lab. It takes tiny positions, acts more often than Mira, and writes a heavy journal so you can watch it form and test ideas. It is explicitly experimental: it optimizes for learning and transparency, not returns. Same hard leash as every operator.",
    adoptionCopy:
      "You are hiring Nova as an experiment. It uses a tiny budget, takes small frequent positions, and journals everything. It is not performance-first · adopt it to watch an agent learn.",
    emptyState:
      "Nova is just getting started. It will take small positions and write down what it learns from each one.",
    neverDoes: NEVER_DOES_BASE,
  },
];

export function operatorTemplate(slug: string | null | undefined): OperatorTemplate | undefined {
  return OPERATOR_TEMPLATES.find((t) => t.slug === slug);
}

/** Resolve the display identity for an operator from its registry/template data,
 *  with a graceful fallback for legacy operators that predate templates. */
export function operatorIdentity(args: {
  templateSlug?: string | null;
  name?: string | null;
  role?: string | null;
  mode?: string | null;
  fallbackName?: string | null; // e.g. the deterministic codename
}): { name: string; role: string; legacy: boolean } {
  const t = operatorTemplate(args.templateSlug ?? undefined);
  if (t) return { name: t.name, role: t.role, legacy: false };
  // Legacy: no template · use the stored/codename name + a clean role from mode.
  const role =
    args.role ??
    (args.mode === "protect"
      ? "Capital operator"
      : args.mode === "aggressive"
        ? "Momentum operator"
        : args.mode === "grow"
          ? "Growth operator"
          : "Capital operator");
  return { name: args.name ?? args.fallbackName ?? "Operator", role, legacy: true };
}
