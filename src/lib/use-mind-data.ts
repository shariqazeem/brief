// Polling hooks for the Mind canvas's chart feeds. Both poll our own
// cached API routes (not the fullnode), so cost-per-dashboard is one
// HTTP GET against an in-memory cache — safe at 100 concurrent users.

"use client";

import { useEffect, useState } from "react";

import { apiUrl } from "@/lib/api-base";
import type { SmilePoint, SviSurface } from "@/lib/svi";

export type SeriesPoint = {
  ts: number;
  price: number;
  sma15: number | null;
  sma60: number | null;
  rsi60: number | null;
};

export type SignalsLatest = {
  ts: number;
  spot: number;
  roc5: number | null;
  roc30: number | null;
  roc60: number | null;
  rsi60: number | null;
  sma15: number | null;
  sma60: number | null;
};

export type PriceSeries = {
  points: SeriesPoint[];
  latest: SignalsLatest | null;
  loading: boolean;
};

const SERIES_POLL_MS = 12_000;

export function usePriceSeries(
  asset: string | null | undefined,
  minutes = 60,
): PriceSeries {
  const [state, setState] = useState<PriceSeries>({
    points: [],
    latest: null,
    loading: true,
  });

  useEffect(() => {
    if (!asset) {
      setState({ points: [], latest: null, loading: false });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await fetch(
          apiUrl(
            `/api/trader/signals?asset=${encodeURIComponent(asset as string)}&minutes=${minutes}`,
          ),
        );
        if (r.ok) {
          const body = (await r.json()) as {
            points?: SeriesPoint[];
            latest?: SignalsLatest | null;
          };
          if (!cancelled) {
            setState({
              points: body.points ?? [],
              latest: body.latest ?? null,
              loading: false,
            });
          }
        } else if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
      }
      if (!cancelled) timer = setTimeout(tick, SERIES_POLL_MS);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [asset, minutes]);

  return state;
}

export type VolSurfaceFeed = {
  surface: SviSurface | null;
  smile: SmilePoint[];
  marketProbUp: number | null;
  strikeKValue: number | null;
  loading: boolean;
};

const SURFACE_POLL_MS = 30_000;

export function useVolSurface(
  oracleId: string | null | undefined,
  strikeUsd: number | null | undefined,
): VolSurfaceFeed {
  const [state, setState] = useState<VolSurfaceFeed>({
    surface: null,
    smile: [],
    marketProbUp: null,
    strikeKValue: null,
    loading: true,
  });

  useEffect(() => {
    if (!oracleId || !oracleId.startsWith("0x")) {
      setState({
        surface: null,
        smile: [],
        marketProbUp: null,
        strikeKValue: null,
        loading: false,
      });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const strikeQ =
          strikeUsd && strikeUsd > 0 ? `&strike=${strikeUsd}` : "";
        const r = await fetch(
          apiUrl(
            `/api/vol-surface?oracle_id=${encodeURIComponent(oracleId as string)}${strikeQ}`,
          ),
        );
        if (r.ok) {
          const body = (await r.json()) as {
            surface?: SviSurface;
            smile?: SmilePoint[];
            strike?: { k: number | null; marketProbUp: number | null } | null;
          };
          if (!cancelled) {
            setState({
              surface: body.surface ?? null,
              smile: body.smile ?? [],
              marketProbUp: body.strike?.marketProbUp ?? null,
              strikeKValue: body.strike?.k ?? null,
              loading: false,
            });
          }
        } else if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
      }
      if (!cancelled) timer = setTimeout(tick, SURFACE_POLL_MS);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [oracleId, strikeUsd]);

  return state;
}

// Trade history for one adopted trader — the agent's actual decisions
// (direction, strike, mode, abstention) from /api/trader/trades. Feeds
// the chart's decision markers and the memory timeline. Polls every 20s.
export type TradeDecision = {
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
};

export type TraderTrades = {
  decisions: TradeDecision[];
  realizedPnlUsd: number;
  loaded: boolean;
};

const TRADES_POLL_MS = 20_000;

export function useTraderTrades(
  policyId: string | null | undefined,
): TraderTrades {
  const [state, setState] = useState<TraderTrades>({
    decisions: [],
    realizedPnlUsd: 0,
    loaded: false,
  });

  useEffect(() => {
    if (!policyId || !policyId.startsWith("0x")) {
      setState({ decisions: [], realizedPnlUsd: 0, loaded: false });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await fetch(
          apiUrl(`/api/trader/trades?policy_id=${encodeURIComponent(policyId as string)}`),
        );
        if (r.ok) {
          const body = (await r.json()) as {
            decisions?: TradeDecision[];
            realized_pnl_usd?: number;
          };
          if (!cancelled) {
            setState({
              decisions: body.decisions ?? [],
              realizedPnlUsd: body.realized_pnl_usd ?? 0,
              loaded: true,
            });
          }
        } else if (!cancelled) {
          setState((prev) => ({ ...prev, loaded: true }));
        }
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, loaded: true }));
      }
      if (!cancelled) timer = setTimeout(tick, TRADES_POLL_MS);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [policyId]);

  return state;
}
