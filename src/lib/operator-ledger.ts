// Operator Ledger + Benchmark — proving the intelligence, not explaining it.
//
// The ledger is the permanent decision → action → outcome record (every buy/sell
// with its reason and realized result). The benchmark answers the only question
// a "+1.4%" can't on its own: compared to WHAT? — buy-and-hold SUI, and cash.
// All real: ledger from the trader's on-chain actions, benchmark from the launch
// price + live mark.

"use client";

import { useEffect, useState } from "react";

import { apiUrl } from "@/lib/api-base";

export type LedgerEvent = {
  ts: number;
  seq: number;
  regimeKind?: string;
  regimeLabel?: string;
  side: "buy" | "sell";
  fromExposurePct: number;
  targetPct: number;
  mid: number;
  qtySui: number;
  reason: string;
  txDigest: string | null;
  outcome: "pending" | "win" | "loss";
  outcomePct?: number;
};

export type OperatorStats = {
  launchTs: number;
  launchMid: number;
  deposit?: number;
  mode?: string;
  decisions: number;
  abstentions: number;
  buys: number;
  sells: number;
  peakValue: number;
  worstDrawdownPct: number;
  lastValue: number;
  lastMid?: number;
  updatedTs: number;
};

export type Benchmark = {
  /** Operator return vs deposit (%). */
  operatorPct: number;
  /** Buy-and-hold SUI from launch (%). */
  holdPct: number;
  /** Cash (always 0%). */
  cashPct: number;
  /** Operator − hold (positive = beat holding). */
  vsHold: number;
  /** Operator − cash. */
  vsCash: number;
};

/** Compute the counterfactual benchmark from launch price + live mark. */
export function computeBenchmark(
  stats: OperatorStats | null,
  operatorPct: number | null,
  currentMid: number | null,
): Benchmark | null {
  if (stats == null || operatorPct == null) return null;
  const holdPct =
    currentMid != null && stats.launchMid > 0
      ? (currentMid / stats.launchMid - 1) * 100
      : 0;
  return {
    operatorPct,
    holdPct,
    cashPct: 0,
    vsHold: operatorPct - holdPct,
    vsCash: operatorPct,
  };
}

/** Benchmark computed purely from persisted stats — for the public Results
 *  page (no live SSE). operator = value vs deposit; hold = lastMid vs launchMid. */
export function benchmarkFromStats(stats: OperatorStats | null): Benchmark | null {
  if (!stats) return null;
  const deposit = stats.deposit && stats.deposit > 0 ? stats.deposit : stats.lastValue;
  const operatorPct = deposit > 0 ? (stats.lastValue / deposit - 1) * 100 : 0;
  const holdPct =
    stats.lastMid != null && stats.launchMid > 0 ? (stats.lastMid / stats.launchMid - 1) * 100 : 0;
  return {
    operatorPct,
    holdPct,
    cashPct: 0,
    vsHold: operatorPct - holdPct,
    vsCash: operatorPct,
  };
}

export function useOperatorLedger(policyId: string | null | undefined): {
  ledger: LedgerEvent[];
  stats: OperatorStats | null;
  loaded: boolean;
} {
  const [ledger, setLedger] = useState<LedgerEvent[]>([]);
  const [stats, setStats] = useState<OperatorStats | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!policyId || !policyId.startsWith("0x")) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(apiUrl(`/api/operators/ledger?policy_id=${encodeURIComponent(policyId)}`));
        const j = (await r.json()) as { ledger?: LedgerEvent[]; stats?: OperatorStats | null };
        if (!cancelled) {
          setLedger(Array.isArray(j.ledger) ? j.ledger : []);
          setStats(j.stats ?? null);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [policyId]);

  return { ledger, stats, loaded };
}
