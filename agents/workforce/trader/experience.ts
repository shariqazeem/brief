// The Brief Operator's Experience Engine — memory, not logs.
//
// Before every decision the operator recalls structurally SIMILAR past
// situations and lets their outcomes reshape its confidence:
//
//   "Found 3 similar situations: 2 settled against → confidence reduced."
//
// Each decision is stored as a regime fingerprint + outcome. Pending ACTs
// settle against later price (won the directional call or not). The store is
// the operator's working memory (fast local read); a snapshot is anchored on
// Walrus by the loop so the memory is verifiable, not just claimed.
//
// This is deliberately NOT a bag of indicators — it is recall over the same
// real signals the engine already reasons on. The engine consumes the recall
// via `opts.memory`; the Move policy still gates execution.

import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { SignalBundle } from "./signals.js";

export type RegimeFingerprint = {
  /** 30m rate of change (signed fraction). */
  roc30: number;
  /** RSI 60m, 0–100. */
  rsi: number;
  /** Short-vs-long MA alignment. */
  trend: -1 | 0 | 1;
  /** Realized 60m vol (fraction). */
  vol: number;
};

export type DecisionOutcome = "win" | "loss" | "abstained" | "pending";

/** The full, replayable story of one decision — what the operator saw,
 *  remembered, feared, and concluded. Drives the Brain / Decision Replay page. */
export type ExperienceDetail = {
  regimeLabel?: string;
  regimeReview?: string;
  thesis: string;
  counterargument: string;
  riskReview: string;
  executionReview: string;
  mandateReview: string;
  policyReview: string;
  verdict: string;
  recallNote: string;
  recallFound: number;
  recallWins: number;
  recallLosses: number;
  txDigest?: string | null;
};

export type ExperienceRecord = {
  ts: number;
  taskId: string;
  /** Monotonic decision number (1-based) for stable "Decision #N" references. */
  seq?: number;
  regime: RegimeFingerprint;
  direction: "up" | "down";
  /** Whether the operator acted (true) or abstained (false). */
  decided: boolean;
  /** Confidence at decision time (0–1). */
  confidence: number;
  /** Spot mid at decision. */
  mid: number;
  outcome: DecisionOutcome;
  /** Realized move in the operator's favour (signed fraction), once settled. */
  outcomePct?: number;
  /** Full reasoning for replay (Brain page). */
  detail?: ExperienceDetail;
};

/** Next monotonic decision number for a record list. */
export function nextSeq(recs: ExperienceRecord[]): number {
  const last = recs[recs.length - 1];
  return (last?.seq ?? recs.length) + 1;
}

export type ExperienceStats = {
  total: number;
  acts: number;
  wins: number;
  losses: number;
  abstained: number;
  /** Settled win rate over all acts (0–100), or null if none settled. */
  winRate: number | null;
  /** Win rate of the most recent settled acts vs the prior block — the
   *  "operator evolves" signal. null when not enough settled history. */
  recentWinRate: number | null;
  priorWinRate: number | null;
};

export function experienceStats(recs: ExperienceRecord[], block = 10): ExperienceStats {
  const acts = recs.filter((r) => r.decided);
  const wins = acts.filter((r) => r.outcome === "win").length;
  const losses = acts.filter((r) => r.outcome === "loss").length;
  const abstained = recs.filter((r) => !r.decided).length;
  const settled = acts.filter((r) => r.outcome === "win" || r.outcome === "loss");
  const winRate = settled.length ? (wins / settled.length) * 100 : null;
  const rate = (rs: ExperienceRecord[]) =>
    rs.length ? (rs.filter((r) => r.outcome === "win").length / rs.length) * 100 : null;
  const recent = settled.slice(-block);
  const prior = settled.slice(-2 * block, -block);
  return {
    total: recs.length,
    acts: acts.length,
    wins,
    losses,
    abstained,
    winRate,
    recentWinRate: recent.length >= 3 ? rate(recent) : null,
    priorWinRate: prior.length >= 3 ? rate(prior) : null,
  };
}

export type Recall = {
  matches: ExperienceRecord[];
  /** Human line for the journal / risk review. */
  note: string;
  /** Multiplies engine confidence (≤1 dampens, >1 reinforces). */
  confidenceMult: number;
  found: number;
  wins: number;
  losses: number;
  abstained: number;
};

const DIR = ".cursors";
const fileFor = (policyId: string) =>
  path.join(DIR, `operator-experience-${policyId.slice(2, 14)}.json`);

/** Compact regime descriptor from the live signal bundle. */
export function regimeOf(s: SignalBundle): RegimeFingerprint {
  const trend: -1 | 0 | 1 =
    s.sma_15m != null && s.sma_60m != null
      ? s.sma_15m > s.sma_60m
        ? 1
        : s.sma_15m < s.sma_60m
          ? -1
          : 0
      : 0;
  return {
    roc30: s.roc_30m ?? 0,
    rsi: s.rsi_60m ?? 50,
    trend,
    vol: s.realized_vol_60m ?? 0,
  };
}

export async function loadExperience(policyId: string): Promise<ExperienceRecord[]> {
  try {
    const raw = await fs.readFile(fileFor(policyId), "utf8");
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as ExperienceRecord[]) : [];
  } catch {
    return [];
  }
}

export async function saveExperience(
  policyId: string,
  recs: ExperienceRecord[],
): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  // Keep the most recent 500 — ample for recall, bounded on disk.
  await fs.writeFile(fileFor(policyId), JSON.stringify(recs.slice(-500), null, 2));
}

// Normalized distance between two regimes (lower = more similar). Each axis is
// scaled so a "meaningful" difference is ~1 unit, then combined Euclidean.
function regimeDistance(a: RegimeFingerprint, b: RegimeFingerprint): number {
  const droc = (a.roc30 - b.roc30) / 0.01; // 1% ROC ≈ 1 unit
  const drsi = (a.rsi - b.rsi) / 20; // 20 RSI pts ≈ 1 unit
  const dtrend = a.trend === b.trend ? 0 : 1; // categorical
  const dvol = (a.vol - b.vol) / 0.01; // 1% vol ≈ 1 unit
  return Math.sqrt(droc * droc + drsi * drsi + dtrend * dtrend + dvol * dvol);
}

const SIMILAR_THRESHOLD = 1.5; // regimes within this distance count as "similar"

/** Recall the K most similar past situations and derive a confidence shaping. */
export function recallSimilar(
  history: ExperienceRecord[],
  current: RegimeFingerprint,
  k = 3,
): Recall {
  const matches = history
    .map((r) => ({ r, d: regimeDistance(current, r.regime) }))
    .filter((x) => x.d <= SIMILAR_THRESHOLD)
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((x) => x.r);

  const wins = matches.filter((r) => r.outcome === "win").length;
  const losses = matches.filter((r) => r.outcome === "loss").length;
  const abstained = matches.filter((r) => r.outcome === "abstained").length;
  const settled = wins + losses;

  if (matches.length === 0) {
    return {
      matches: [],
      note: "First time in conditions like these — recording it so future cycles can recall how it played out.",
      confidenceMult: 1,
      found: 0,
      wins: 0,
      losses: 0,
      abstained: 0,
    };
  }

  let confidenceMult = 1;
  let verdict: string;
  if (settled === 0) {
    verdict = "none settled yet — confidence held";
  } else if (losses > wins) {
    confidenceMult = losses >= 2 * Math.max(1, wins) ? 0.7 : 0.85;
    verdict = `${losses} of ${settled} settled against → confidence reduced`;
  } else if (wins > losses) {
    confidenceMult = 1.08;
    verdict = `${wins} of ${settled} settled in favour → confidence reinforced`;
  } else {
    verdict = `mixed (${wins}W/${losses}L) → confidence held`;
  }

  return {
    matches,
    note: `Found ${matches.length} similar situation${matches.length === 1 ? "" : "s"}: ${verdict}.`,
    confidenceMult,
    found: matches.length,
    wins,
    losses,
    abstained,
  };
}

/** Settle pending ACT records whose horizon elapsed, by comparing the decision
 *  mid to the current mid: a directional call wins if the market moved its way. */
export function settlePending(
  history: ExperienceRecord[],
  currentMid: number,
  now: number,
  horizonMs: number,
): { history: ExperienceRecord[]; settled: number } {
  let settled = 0;
  const out = history.map((r) => {
    if (r.outcome !== "pending" || now - r.ts < horizonMs) return r;
    const moved = (currentMid - r.mid) / (r.mid || 1);
    const favor = r.direction === "up" ? moved : -moved;
    settled++;
    return {
      ...r,
      outcome: (favor >= 0 ? "win" : "loss") as DecisionOutcome,
      outcomePct: favor,
    };
  });
  return { history: out, settled };
}

/** Human-readable experience log for the Walrus snapshot — the verifiable
 *  memory anyone can audit. `mandateLine` (optional) anchors the user's
 *  investment mandate alongside the operator's track record. */
export function experienceMarkdown(
  policyId: string,
  recs: ExperienceRecord[],
  mandateLine?: string,
): string {
  const wins = recs.filter((r) => r.outcome === "win").length;
  const losses = recs.filter((r) => r.outcome === "loss").length;
  const abst = recs.filter((r) => r.outcome === "abstained").length;
  const lines = recs
    .slice(-50)
    .map((r, i) => {
      const when = new Date(r.ts).toISOString();
      const reg = `roc30 ${(r.regime.roc30 * 100).toFixed(2)}% · rsi ${r.regime.rsi.toFixed(
        0,
      )} · trend ${r.regime.trend} · vol ${(r.regime.vol * 100).toFixed(2)}%`;
      const act = r.decided ? `ACT ${r.direction.toUpperCase()}` : "NO TRADE";
      const out =
        r.outcome === "pending"
          ? "pending"
          : r.outcome === "abstained"
            ? "abstained"
            : `${r.outcome}${r.outcomePct != null ? ` (${(r.outcomePct * 100).toFixed(2)}%)` : ""}`;
      return `${i + 1}. ${when} — [${reg}] → ${act} @ $${r.mid.toFixed(3)} · conf ${(
        r.confidence * 100
      ).toFixed(0)}% · ${out}`;
    })
    .join("\n");
  return [
    `# Brief Operator — Experience`,
    `policy: ${policyId}`,
    mandateLine ? `mandate: ${mandateLine}` : `mandate: (none set)`,
    `decisions: ${recs.length} · wins ${wins} · losses ${losses} · abstained ${abst}`,
    ``,
    `The operator recalls similar past regimes before each decision and lets`,
    `their outcomes reshape its confidence. This is that memory, on Walrus.`,
    ``,
    `## Recent decisions`,
    lines || "_none yet_",
    ``,
  ].join("\n");
}
