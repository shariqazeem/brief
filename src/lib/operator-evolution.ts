// Operator Evolution — the fourth pillar. Not memory, not logs: the story of
// the operator getting *better* over time. Everything is derived from the REAL
// decision archive + ledger + lifetime stats — milestones are real timestamps
// and real counts, lessons are real per-regime edges. Nothing is invented; this
// is what makes the operator feel alive instead of merely smart.

"use client";

import {
  buildPlaybookStats,
  REGIME_LABEL,
  type DecisionRecord,
  type PlaybookStat,
  type RegimeKind,
} from "@/lib/operator-scorecard";
import type { LedgerEvent, OperatorStats } from "@/lib/operator-ledger";

export type Milestone = {
  day: number; // 1-based day since launch
  ts: number;
  title: string;
  detail: string;
  kind: "start" | "regime" | "allocation" | "win" | "now";
};

export type Evolution = {
  lessonsLearned: number;
  regimesUnderstood: number;
  /** The single strongest learned procedure, stated plainly. */
  mostValuable: { label: string; statement: string; applied: number } | null;
  milestones: Milestone[];
  playbooks: PlaybookStat[];
};

const dayOf = (ts: number, launch: number) =>
  Math.max(1, Math.floor((ts - launch) / 86_400_000) + 1);

function mostValuableLesson(playbooks: PlaybookStat[]): Evolution["mostValuable"] {
  if (!playbooks.length) return null;
  // Prefer a tradeable regime with proven positive edge; else the most-repeated
  // stand-aside discipline (also a real, valuable lesson).
  const acted = playbooks
    .filter((p) => p.bestAction === "act" && p.avgOutcomePct != null)
    .sort((a, b) => (b.avgOutcomePct ?? 0) - (a.avgOutcomePct ?? 0))[0];
  if (acted && (acted.avgOutcomePct ?? 0) > 0) {
    return {
      label: acted.label,
      statement: `${acted.label} regimes reward acting — +${(acted.avgOutcomePct ?? 0).toFixed(1)}% on average over ${acted.wins + acted.losses} settled.`,
      applied: acted.acts,
    };
  }
  const aside = playbooks
    .filter((p) => p.bestAction === "stand-aside")
    .sort((a, b) => b.occurrences - a.occurrences)[0];
  if (aside) {
    return {
      label: aside.label,
      statement:
        aside.kind === "trending-down"
          ? "Trending-down regimes are best met by moving to cash — capital protected through the drop."
          : `${aside.label} regimes are best sat out — no durable edge, so it stands aside and preserves capital.`,
      applied: aside.abstentions,
    };
  }
  return null;
}

export function computeEvolution(
  decisions: DecisionRecord[],
  ledger: LedgerEvent[],
  stats: OperatorStats | null,
): Evolution {
  const playbooks = buildPlaybookStats(decisions);
  const lessonsLearned = playbooks.filter((p) => p.bestAction !== "insufficient").length;
  const regimesUnderstood = playbooks.length;
  const mostValuable = mostValuableLesson(playbooks);

  // Ascending by time for the narrative timeline.
  const asc = [...decisions].filter((d) => d.ts > 0).sort((a, b) => a.ts - b.ts);
  const launch = stats?.launchTs ?? asc[0]?.ts ?? 0;
  const milestones: Milestone[] = [];

  if (asc.length) {
    milestones.push({
      day: 1,
      ts: asc[0].ts,
      title: "Began observing the market",
      detail: "First read of the tape — no memory to lean on yet. Every cycle since has added to it.",
      kind: "start",
    });
  }

  // First time each regime was encountered → "learned to read it".
  const seen = new Set<string>();
  const pbByKind = new Map(playbooks.map((p) => [p.kind, p]));
  for (const d of asc) {
    const k = d.regimeKind as RegimeKind | undefined;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (milestones.length === 1 && d.ts === asc[0].ts) continue; // skip dup with start
    const pb = pbByKind.get(k);
    milestones.push({
      day: dayOf(d.ts, launch),
      ts: d.ts,
      title: `Learned to read ${REGIME_LABEL[k].toLowerCase()}`,
      detail: pb ? pb.learned : "Recording how this regime plays out.",
      kind: "regime",
    });
  }

  // First real allocation (from the ledger).
  const ascLedger = [...ledger].filter((e) => e.ts > 0).sort((a, b) => a.ts - b.ts);
  const firstMove = ascLedger[0];
  if (firstMove) {
    const settled = firstMove.outcome === "win" || firstMove.outcome === "loss";
    const favor = (firstMove.outcomePct ?? 0) * 100;
    milestones.push({
      day: dayOf(firstMove.ts, launch),
      ts: firstMove.ts,
      title: firstMove.side === "buy" ? "First allocation — moved into SUI" : "First allocation — moved to cash",
      detail: settled
        ? `${firstMove.regimeLabel ?? "Acted"} · ${favor >= 0 ? "+" : ""}${favor.toFixed(1)}% in its favour.`
        : `${firstMove.regimeLabel ?? "Acted"} · committed real capital under the policy.`,
      kind: "allocation",
    });
  }

  // First settled win (if any).
  const firstWin = ascLedger.find((e) => e.outcome === "win");
  if (firstWin && firstWin !== firstMove) {
    milestones.push({
      day: dayOf(firstWin.ts, launch),
      ts: firstWin.ts,
      title: "First profitable call settled",
      detail: `${firstWin.regimeLabel ?? "Trade"} settled +${((firstWin.outcomePct ?? 0) * 100).toFixed(1)}% in its favour.`,
      kind: "win",
    });
  }

  // Where it stands now.
  const total = stats?.decisions ?? decisions.length;
  if (total > 0) {
    milestones.push({
      day: stats ? dayOf(Date.now(), launch) : (asc.length ? dayOf(asc[asc.length - 1].ts, launch) : 1),
      ts: Date.now(),
      title: "Today",
      detail: `${total} decisions recorded · ${lessonsLearned} lesson${lessonsLearned === 1 ? "" : "s"} learned · ${regimesUnderstood} regime${regimesUnderstood === 1 ? "" : "s"} understood.`,
      kind: "now",
    });
  }

  milestones.sort((a, b) => a.ts - b.ts);
  return { lessonsLearned, regimesUnderstood, mostValuable, milestones, playbooks };
}
