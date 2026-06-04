// Human-readable rationale generator for operator actions.
//
// Builds one short, deliberate sentence per cycle from a deterministic
// pattern bank. Selection is seeded by cycle count so a single operator
// never repeats the same phrasing across consecutive cycles but the output
// is still reproducible.
//
// Stitches together:
//   1. an opening — keyed off the margin to the next-best option
//   2. an optional secondary factor (live yield, rotation, signal quality)
//   3. a memory reference (rotation from prior venue)
//   4. a concentration warning when nearing the cap
//   5. an adaptive-posture closer (defensive / exploratory / assured)
//
// Tone is operational and mildly clipped. Posture banks make the agent
// sound like it is reading the room — different on a 3-rejection streak
// than on a calm exploratory cycle.

import type { OperatorPolicyDecoded } from "../lib/operator-policy.js";
import type { OperatorMemory, OperatorPosture } from "./memory.js";
import type { ScoredOption } from "./evaluator.js";

// ---------------------------------------------------------------------------
// Pattern banks
// ---------------------------------------------------------------------------

type DecisiveOpener = (chosen: string, factor: string) => string;
const DECISIVE_OPENERS: DecisiveOpener[] = [
  (c, f) => `${c}: ${f}`,
  (c, f) => `${c} dominates — ${f}`,
  (c, f) => `${c} stands out · ${f}`,
  (c, f) => `${c} clears the field · ${f}`,
  (c, f) => `${c} holds the edge · ${f}`,
  (c, f) => `${c} chosen on ${f}`,
];

type EdgeOpener = (chosen: string, second: string, factor: string) => string;
const EDGE_OPENERS: EdgeOpener[] = [
  (c, s, f) => `${c} edges ${s} (${f})`,
  (c, s, f) => `${c} over ${s} · ${f}`,
  (c, s, f) => `${c} clears ${s} narrowly · ${f}`,
  (c, s, f) => `${c} picked over ${s} — ${f}`,
  (c, s, f) => `narrow margin · ${c} over ${s}`,
  (c, s, f) => `${c} wins on ${f}, ${s} second`,
];

type CloseOpener = (chosen: string, second: string) => string;
const CLOSE_OPENERS: CloseOpener[] = [
  (c, s) => `close call vs ${s} — went ${c}`,
  (c, s) => `${c} by a hair vs ${s}`,
  (c, s) => `fine line · ${c} selected over ${s}`,
  (c, s) => `${c} squeaks past ${s}`,
  (c, s) => `${c} marginal over ${s}`,
  (c, s) => `dead heat · ${c} called over ${s}`,
];

type RotationHint = (prev: string) => string;
const ROTATION_HINTS: RotationHint[] = [
  (p) => `rotated from ${p}`,
  (p) => `rotation out of ${p}`,
  (p) => `off ${p} this cycle`,
  (p) => `fresh from ${p}`,
  (p) => `pivoted from ${p}`,
];

type ConcentrationHint = (venue: string, pct: number) => string;
const CONCENTRATION_HINTS: ConcentrationHint[] = [
  (v, p) => `${v} will sit at ${p}% of envelope`,
  (v, p) => `concentration on ${v} climbing to ${p}%`,
  (v, p) => `approaching cap on ${v} (${p}%)`,
  (v, p) => `${v} pushing concentration to ${p}%`,
];

const POSTURE_CLOSERS: Record<OperatorPosture, string[]> = {
  neutral: [],
  defensive: [
    "defensive posture maintained",
    "tightening allocation after rejection streak",
    "leaning toward audited venues",
    "risk-off cadence holds",
  ],
  exploratory: [
    "broader scan after consecutive holds",
    "venue rotation widening",
    "scouting alternatives this cycle",
    "exploring beyond recent picks",
  ],
  assured: [
    "high-confidence streak sustained",
    "calm pacing under wide margins",
    "settled rhythm — no oscillation",
    "decisive cadence preserved",
  ],
};

// ---------------------------------------------------------------------------
// Deterministic-but-varied pattern selector
// ---------------------------------------------------------------------------

function pickIndex(seed: number, salt: number, len: number): number {
  let h = (seed + 1) * 2654435761 + salt * 0x9e3779b9;
  h ^= h >>> 13;
  h ^= h << 7;
  h ^= h >>> 17;
  return Math.abs(h) % len;
}

// ---------------------------------------------------------------------------
// Public — generateRationale
// ---------------------------------------------------------------------------

export function generateRationale(
  chosen: ScoredOption,
  allOptions: ScoredOption[],
  memory: OperatorMemory,
  policy: OperatorPolicyDecoded,
): string {
  const second = allOptions[1];
  const margin = second ? chosen.score - second.score : 1;
  const seed = memory.cycles + 1;

  const parts: string[] = [];

  // 1. Opening — decisive / edge / close
  const primaryFactor =
    chosen.rationaleFactors[0] ?? formatBestFitFactor(chosen);
  if (margin > 0.18) {
    const i = pickIndex(seed, 0, DECISIVE_OPENERS.length);
    parts.push(DECISIVE_OPENERS[i]!(chosen.venue, primaryFactor));
  } else if (margin > 0.08) {
    const i = pickIndex(seed, 1, EDGE_OPENERS.length);
    parts.push(
      EDGE_OPENERS[i]!(
        chosen.venue,
        second?.venue ?? "alternatives",
        primaryFactor,
      ),
    );
  } else {
    const i = pickIndex(seed, 2, CLOSE_OPENERS.length);
    parts.push(CLOSE_OPENERS[i]!(chosen.venue, second?.venue ?? "alternatives"));
  }

  // 2. Optional secondary factor (skip if already mentioned in opener)
  const opening = parts[0]!;
  const secondaryFactor = chosen.rationaleFactors.find(
    (f, idx) => idx > 0 && !opening.includes(f),
  );
  if (secondaryFactor) parts.push(secondaryFactor);

  // 3. Rotation hint when applicable
  const lastVenue = memory.recentVenues[0];
  if (
    lastVenue &&
    lastVenue !== chosen.venue &&
    !parts.some(
      (p) =>
        p.toLowerCase().includes("rotat") ||
        p.toLowerCase().includes("pivoted") ||
        p.toLowerCase().includes("off "),
    )
  ) {
    const i = pickIndex(seed, 3, ROTATION_HINTS.length);
    parts.push(ROTATION_HINTS[i]!(lastVenue));
  }

  // 4. Concentration warning near the cap
  const maxFrac = policy.maxConcentrationBps / 10_000;
  if (
    chosen.projectedConcentrationFrac >= maxFrac * 0.7 &&
    !parts.some(
      (p) =>
        p.toLowerCase().includes("concentration") ||
        p.toLowerCase().includes("envelope") ||
        p.toLowerCase().includes("cap"),
    )
  ) {
    const i = pickIndex(seed, 4, CONCENTRATION_HINTS.length);
    const pct = Math.round(chosen.projectedConcentrationFrac * 100);
    parts.push(CONCENTRATION_HINTS[i]!(chosen.venue, pct));
  }

  // 5. Posture closer — appended when not neutral and not already implied
  const closers = POSTURE_CLOSERS[memory.posture];
  if (closers.length > 0) {
    const i = pickIndex(seed, 5, closers.length);
    parts.push(closers[i]!);
  }

  return parts.join(" · ");
}

function formatBestFitFactor(chosen: ScoredOption): string {
  // Fall back to whatever signal data we have if the evaluator didn't
  // produce an explicit factor list. Keeps the opener informative even on
  // degenerate-input edge cases.
  const r = chosen.signal.raw;
  if (typeof r.apy_pct === "number" && r.apy_pct > 0) {
    return `${r.apy_pct.toFixed(1)}% live apy`;
  }
  return "best fit";
}

/**
 * One-line summary of what alternatives the agent considered — for the
 * activity payload's `evaluated` field so a curious user can inspect the
 * decision basis. Compact: "DeepBook 0.71 · NAVI 0.64 · Suilend 0.55".
 */
export function formatEvaluatedOptions(options: ScoredOption[]): string {
  return options.map((o) => `${o.venue} ${o.score.toFixed(2)}`).join(" · ");
}
