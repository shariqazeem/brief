// The Operator Ledger — a permanent record of capital ALLOCATION events.
//
// The experience archive (experience.ts) records every DECISION but is capped
// (recent window). Allocation events — actual buys/sells that move capital
// between cash and SUI — are rare and must NEVER be trimmed: they are the
// operator's track record. Each event carries its reason and, once its horizon
// elapses, its realized outcome. This is the "decision → action → outcome"
// chain judges (and depositors) actually trust.
//
// Alongside it we persist lifetime STATS (launch price for benchmarking,
// cumulative counts, peak value + worst drawdown) so the dashboard reflects the
// operator's whole life, not just the recent decision window.

import { promises as fs } from "node:fs";
import * as path from "node:path";

export type LedgerSide = "buy" | "sell";
export type LedgerOutcome = "pending" | "win" | "loss";

export type LedgerEvent = {
  ts: number;
  seq: number;
  regimeKind?: string;
  regimeLabel?: string;
  side: LedgerSide;
  /** SUI exposure before the move (0–100). */
  fromExposurePct: number;
  /** Target SUI exposure the move was reaching for (0–100). */
  targetPct: number;
  /** Execution mid at the move. */
  mid: number;
  /** Base SUI quantity moved. */
  qtySui: number;
  /** Human reason (regime + thesis). */
  reason: string;
  txDigest: string | null;
  outcome: LedgerOutcome;
  /** Realized move in the operator's favour since the event (signed fraction). */
  outcomePct?: number;
};

export type OperatorStats = {
  /** When the operator first decided (for "since launch"). */
  launchTs: number;
  /** SUI mid at launch — the buy-and-hold benchmark baseline. */
  launchMid: number;
  /** Deposited capital (quote units) — the return baseline. */
  deposit: number;
  /** Operator mode (protect | grow | aggressive) — drives the objective label. */
  mode?: string;
  /** Cumulative decision count (survives the experience-archive cap). */
  decisions: number;
  abstentions: number;
  buys: number;
  sells: number;
  /** Peak marked-to-market value seen, for drawdown. */
  peakValue: number;
  /** Worst drawdown from peak ever seen (positive %). */
  worstDrawdownPct: number;
  /** Last marked value. */
  lastValue: number;
  /** Last SUI mid seen — for the live buy-and-hold benchmark. */
  lastMid: number;
  updatedTs: number;
};

const DIR = ".cursors";
const ledgerFile = (policyId: string) =>
  path.join(DIR, `operator-ledger-${policyId.slice(2, 14)}.json`);
const statsFile = (policyId: string) =>
  path.join(DIR, `operator-stats-${policyId.slice(2, 14)}.json`);

export async function loadLedger(policyId: string): Promise<LedgerEvent[]> {
  try {
    const raw = await fs.readFile(ledgerFile(policyId), "utf8");
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as LedgerEvent[]) : [];
  } catch {
    return [];
  }
}

export async function saveLedger(policyId: string, events: LedgerEvent[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  // Never trim — allocation events are rare and are the track record.
  await fs.writeFile(ledgerFile(policyId), JSON.stringify(events, null, 2));
}

export async function loadStats(policyId: string): Promise<OperatorStats | null> {
  try {
    const raw = await fs.readFile(statsFile(policyId), "utf8");
    return JSON.parse(raw) as OperatorStats;
  } catch {
    return null;
  }
}

export async function saveStats(policyId: string, stats: OperatorStats): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(statsFile(policyId), JSON.stringify(stats, null, 2));
}

/** Get-or-create the lifetime stats, seeding launch from the current cycle. */
export function ensureStats(
  prev: OperatorStats | null,
  now: number,
  mid: number,
  value: number,
  deposit: number,
): OperatorStats {
  if (prev) {
    // Backfill fields added after this operator's stats were first written.
    if (prev.deposit == null) prev.deposit = deposit > 0 ? deposit : value;
    if (prev.lastMid == null) prev.lastMid = mid;
    return prev;
  }
  return {
    launchTs: now,
    launchMid: mid,
    deposit: deposit > 0 ? deposit : value,
    decisions: 0,
    abstentions: 0,
    buys: 0,
    sells: 0,
    peakValue: value,
    worstDrawdownPct: 0,
    lastValue: value,
    lastMid: mid,
    updatedTs: now,
  };
}

/** Fold one cycle into the lifetime stats (counts + drawdown + live mid). */
export function recordCycle(
  stats: OperatorStats,
  opts: { acted: boolean; side: LedgerSide | null; value: number; mid: number; now: number },
): OperatorStats {
  const next = { ...stats };
  next.decisions += 1;
  if (!opts.acted) next.abstentions += 1;
  else if (opts.side === "buy") next.buys += 1;
  else if (opts.side === "sell") next.sells += 1;
  if (opts.value > 0) {
    next.peakValue = Math.max(next.peakValue, opts.value);
    const dd = next.peakValue > 0 ? ((next.peakValue - opts.value) / next.peakValue) * 100 : 0;
    next.worstDrawdownPct = Math.max(next.worstDrawdownPct, dd);
    next.lastValue = opts.value;
  }
  if (opts.mid > 0) next.lastMid = opts.mid;
  next.updatedTs = opts.now;
  return next;
}

/** Settle pending ledger events whose horizon elapsed, by comparing the event
 *  mid to the current mid (a buy wins if SUI rose, a sell — to cash — "wins"
 *  by avoiding a drop). */
export function settleLedger(
  ledger: LedgerEvent[],
  currentMid: number,
  now: number,
  horizonMs: number,
): { ledger: LedgerEvent[]; settled: number } {
  let settled = 0;
  const out = ledger.map((ev) => {
    if (ev.outcome !== "pending" || now - ev.ts < horizonMs) return ev;
    const moved = (currentMid - ev.mid) / (ev.mid || 1);
    const favor = ev.side === "buy" ? moved : -moved; // sell-to-cash favours a drop
    settled++;
    return {
      ...ev,
      outcome: (favor >= 0 ? "win" : "loss") as LedgerOutcome,
      outcomePct: favor,
    };
  });
  return { ledger: out, settled };
}
