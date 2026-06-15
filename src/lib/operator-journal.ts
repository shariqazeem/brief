// useOperatorJournal — the operator's cumulative experience, enriched
// with REAL settlement.
//
// /api/trader/trades gives the agent's decision history (direction,
// strike, expiry, mode, reasoning, Walrus blob). It does NOT record a
// win/loss per BTC bet — DeepBook Predict settles on whether spot is
// above/below the strike at expiry. So we compute that ourselves from
// the BTC price history (/api/trader/signals): for each past bet whose
// expiry falls inside the price window, did spot cross the strike in the
// called direction? That is the actual settlement condition, not a proxy.
// Bets whose expiry is still in the future are "pending"; bets older than
// our window are "unknown" (settled, but beyond the data we hold).
//
// For a PRESERVE (abstain) decision there is no position — instead we
// surface the real volatility the operator sat out: how far BTC swung
// between the decision and the would-be expiry. Honest, not a claim of
// avoided loss.

"use client";

import { useEffect, useState } from "react";

import { apiUrl } from "@/lib/api-base";

export type RawDecision = {
  ts: number;
  task_id: string;
  strategy: string;
  direction: "up" | "down" | null;
  quantity: number;
  abstained: boolean;
  mode: string;
  mint_tx: string | null;
  strike_usd: number | null;
  spot_usd: number | null;
  expiry_ms: number | null;
  oracle_id: string | null;
  reasoning: string | null;
  walrus_reasoning_blob_id: string | null;
};

export type SettlementKind =
  | "won" // acted, and spot settled the called side at expiry
  | "lost" // acted, and spot settled against the call
  | "pending" // acted, expiry still in the future
  | "unknown" // acted, expiry beyond our price window
  | "preserved" // abstained — capital preserved on purpose
  | "executed"; // acted on a venue we can't settle here (e.g. spot)

export type JournalDecision = RawDecision & {
  settlement: SettlementKind;
  /** For won/lost: spot at expiry (USD). */
  settledSpotUsd: number | null;
  /** For a preserve: the peak-to-trough BTC swing (%) over the window
   *  the operator sat out. Honest "volatility avoided", not a loss. */
  swingPct: number | null;
};

export type JournalStats = {
  total: number;
  preserved: number;
  preservedPct: number; // preserved / total
  liveOnChain: number; // mode === "live"
  won: number;
  lost: number;
  pending: number;
  /** Settlement-based win rate over decided+settled bets, or null if
   *  nothing has settled yet. */
  winRate: number | null;
};

export type PricePoint = { ts: number; price: number; sma15: number | null; sma60: number | null };

export type OperatorJournal = {
  entries: JournalDecision[]; // newest-first (as returned by the API)
  stats: JournalStats;
  pricePoints: PricePoint[]; // BTC, oldest-first, for the chart
  loaded: boolean;
};

const POLL_MS = 20_000;
const PRICE_WINDOW_MIN = 1440; // 24h of BTC history for settlement
const NEAR_EXPIRY_TOL_MS = 12 * 60_000; // a reading within 12m of expiry counts

function priceNear(points: PricePoint[], targetMs: number): PricePoint | null {
  if (points.length === 0) return null;
  let best: PricePoint | null = null;
  let bestGap = Infinity;
  for (const p of points) {
    const gap = Math.abs(p.ts - targetMs);
    if (gap < bestGap) {
      bestGap = gap;
      best = p;
    }
  }
  return best && bestGap <= NEAR_EXPIRY_TOL_MS ? best : null;
}

function settle(
  d: RawDecision,
  points: PricePoint[],
  nowMs: number,
  isSpot: boolean,
): { settlement: SettlementKind; settledSpotUsd: number | null; swingPct: number | null } {
  // Abstention → capital preserved. Surface the swing it sat out.
  if (d.abstained || d.quantity === 0 || !d.direction) {
    const start = d.ts;
    const end = d.expiry_ms ?? d.ts + 60 * 60_000;
    const window = points.filter((p) => p.ts >= start && p.ts <= end);
    let swingPct: number | null = null;
    if (window.length >= 2 && d.spot_usd) {
      const lo = Math.min(...window.map((p) => p.price));
      const hi = Math.max(...window.map((p) => p.price));
      swingPct = ((hi - lo) / d.spot_usd) * 100;
    }
    return { settlement: "preserved", settledSpotUsd: null, swingPct };
  }

  // Spot venue (DeepBook buy/sell) — there is no strike/expiry to settle
  // against; the trade simply executed. (Spot entries carry a nominal
  // strike+expiry for the chart, so gate on isSpot, not just their absence.)
  if (isSpot || d.strike_usd == null || d.expiry_ms == null) {
    return { settlement: "executed", settledSpotUsd: null, swingPct: null };
  }

  if (d.expiry_ms > nowMs) {
    return { settlement: "pending", settledSpotUsd: null, swingPct: null };
  }

  const at = priceNear(points, d.expiry_ms);
  if (!at) {
    return { settlement: "unknown", settledSpotUsd: null, swingPct: null };
  }
  const calledUp = d.direction === "up";
  const won = calledUp ? at.price >= d.strike_usd : at.price < d.strike_usd;
  return { settlement: won ? "won" : "lost", settledSpotUsd: at.price, swingPct: null };
}

function computeStats(entries: JournalDecision[]): JournalStats {
  const total = entries.length;
  const preserved = entries.filter((e) => e.settlement === "preserved").length;
  const liveOnChain = entries.filter((e) => e.mode === "live").length;
  const won = entries.filter((e) => e.settlement === "won").length;
  const lost = entries.filter((e) => e.settlement === "lost").length;
  const pending = entries.filter((e) => e.settlement === "pending").length;
  const settled = won + lost;
  return {
    total,
    preserved,
    preservedPct: total > 0 ? (preserved / total) * 100 : 0,
    liveOnChain,
    won,
    lost,
    pending,
    winRate: settled > 0 ? (won / settled) * 100 : null,
  };
}

const EMPTY: OperatorJournal = {
  entries: [],
  stats: {
    total: 0,
    preserved: 0,
    preservedPct: 0,
    liveOnChain: 0,
    won: 0,
    lost: 0,
    pending: 0,
    winRate: null,
  },
  pricePoints: [],
  loaded: false,
};

export function useOperatorJournal(
  policyId: string | null | undefined,
  asset: string = "BTC",
  isSpot: boolean = false,
): OperatorJournal {
  const [state, setState] = useState<OperatorJournal>(EMPTY);

  useEffect(() => {
    if (!policyId || !policyId.startsWith("0x")) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const [tradesRes, priceRes] = await Promise.all([
          fetch(
            apiUrl(
              `/api/trader/trades?policy_id=${encodeURIComponent(policyId as string)}&limit=100`,
            ),
          ),
          fetch(apiUrl(`/api/trader/signals?asset=${encodeURIComponent(asset)}&minutes=${PRICE_WINDOW_MIN}`)),
        ]);

        const trades = tradesRes.ok
          ? ((await tradesRes.json()) as { decisions?: RawDecision[] })
          : { decisions: [] };
        const price = priceRes.ok
          ? ((await priceRes.json()) as {
              points?: Array<{ ts: number; price: number; sma15: number | null; sma60: number | null }>;
            })
          : { points: [] };

        const points: PricePoint[] = (price.points ?? []).map((p) => ({
          ts: p.ts,
          price: p.price,
          sma15: p.sma15 ?? null,
          sma60: p.sma60 ?? null,
        }));

        const nowMs = points.length ? points[points.length - 1]!.ts : 0;
        const raw = trades.decisions ?? [];
        const entries: JournalDecision[] = raw.map((d) => ({
          ...d,
          ...settle(d, points, nowMs || d.ts, isSpot),
        }));

        if (!cancelled) {
          setState({
            entries,
            stats: computeStats(entries),
            pricePoints: points,
            loaded: true,
          });
        }
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, loaded: true }));
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [policyId, asset, isSpot]);

  return state;
}
