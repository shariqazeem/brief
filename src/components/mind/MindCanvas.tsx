// MindCanvas — the live trading floor above the reasoning panel.
// Orchestrates the six visuals off three feeds:
//   · usePriceSeries  — the same .cursors history the agent computes from
//   · useVolSurface   — live SVI smile + market-implied Pr(UP) at strike
//   · useAgentStream  — SSE lifecycle events driving the waterfall + edge
// Every number is sourced from chain state or the agent's own files;
// nothing is fabricated for the demo. Lazy-loaded (next/dynamic) so
// recharts stays out of the first-load bundle.

"use client";

import { useMemo } from "react";

import { useAgentStream } from "@/lib/use-agent-stream";
import { usePriceSeries, useVolSurface, useTraderTrades } from "@/lib/use-mind-data";
import { MindPriceChart } from "./MindPriceChart";
import { MindRSIGauge } from "./MindRSIGauge";
import { MindROCTicker } from "./MindROCTicker";
import { MindVolSmile } from "./MindVolSmile";
import { MindEdgeMeter } from "./MindEdgeMeter";
import { MindDecisionWaterfall } from "./MindDecisionWaterfall";

export default function MindCanvas({
  policyId,
  oracleId,
  asset,
  strikeUsd,
  direction,
  liveSpotUsd,
  traderName,
  fallbackReasoning,
}: {
  policyId: string | null;
  oracleId: string | null;
  asset: string;
  strikeUsd: number | null;
  direction: "up" | "down" | null;
  liveSpotUsd: number | null;
  traderName: string;
  /** Reasoning text of the last delivered decision — edge numbers are
   *  parsed out of it when the SSE stream hasn't replayed one yet. */
  fallbackReasoning?: string | null;
}) {
  const { state, connected } = useAgentStream(policyId);
  const series = usePriceSeries(asset === "BTC" ? "BTC" : asset);
  const trades = useTraderTrades(policyId);

  // Prefer live-stream context (freshest oracle/strike) over the
  // deliverable-derived props, which lag one decision behind.
  const effOracleId = state.oracleId ?? oracleId;
  const effStrikeUsd = state.strikeUsd ?? strikeUsd;
  const effDirection = state.decision?.direction ?? direction;
  const isBtc = (state.asset ?? asset) === "BTC";

  const vol = useVolSurface(isBtc ? effOracleId : null, effStrikeUsd);

  // Edge inputs: live SSE decision first; fall back to numbers parsed
  // from the last delivered decision's reasoning text.
  const reasoningText = state.decision?.reasoning ?? fallbackReasoning ?? null;

  const agentP = useMemo(() => {
    const m = reasoningText?.match(/Agent's signal estimate ([-\d.]+)%/);
    return m ? parseFloat(m[1]!) / 100 : null;
  }, [reasoningText]);

  const threshold = useMemo(() => {
    const m = reasoningText?.match(/threshold ±([-\d.]+)%/);
    return m ? parseFloat(m[1]!) / 100 : 0.05;
  }, [reasoningText]);

  const fallbackMarketP = useMemo(() => {
    const m = reasoningText?.match(/Market-implied Pr\(UP @ \$[\d.]+\) = ([-\d.]+)%/);
    return m ? parseFloat(m[1]!) / 100 : null;
  }, [reasoningText]);

  const marketP =
    vol.marketProbUp ?? state.decision?.marketP ?? fallbackMarketP ?? null;
  const decided = state.decision
    ? state.decision.decided
    : direction !== null;

  // Signal headline values: SSE-fresh when available, else the series poll.
  const rsi = state.signals?.rsi_60m ?? series.latest?.rsi60 ?? null;
  const roc30 = state.signals?.roc_30m ?? series.latest?.roc30 ?? null;
  const roc5 = state.signals?.roc_5m ?? series.latest?.roc5 ?? null;
  const roc = roc30 ?? roc5;
  const rocWindow = roc30 !== null ? "30m" : "5m";

  // Quiet self-healing toast: visible for 12s after the warden moves
  // gas. Real digest behind it (the event carries the transfer tx).
  const topup = state.wardenTopup;
  const topupFresh = topup !== null && Date.now() - topup.ts < 12_000;

  return (
    <section className="mt-6">
      {topupFresh && topup && (
        <div className="mb-3 flex items-center gap-2 border border-emerald-600/40 bg-emerald-50/70 px-3 py-2 animate-land-in">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden />
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-800">
            Brief auto-funded the {topup.to} wallet · {topup.amountSui.toFixed(3)} SUI — self-healing gas
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          {traderName}&apos;s trading floor · live
        </p>
        <p
          className={`flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.22em] ${
            connected ? "text-muted" : "text-amber-700"
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              connected ? "animate-pulse bg-emerald-500" : "animate-pulse bg-amber-500"
            }`}
            aria-hidden
          />
          {connected ? "streaming · live wire" : "reconnecting to the wire…"}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MindPriceChart
            points={series.points}
            liveSpotUsd={liveSpotUsd}
            strikeUsd={effStrikeUsd}
            direction={effDirection}
            asset={state.asset ?? asset}
            decisions={trades.decisions}
          />
        </div>
        <MindRSIGauge rsi={rsi} />

        {isBtc ? (
          <>
            <div className="lg:col-span-2">
              <MindVolSmile
                smile={vol.smile}
                surface={vol.surface}
                strikeKValue={vol.strikeKValue}
                strikeUsd={effStrikeUsd}
              />
            </div>
            <MindROCTicker points={series.points} roc={roc} rocWindow={rocWindow} />
            <div className="lg:col-span-3">
              <MindEdgeMeter
                marketP={marketP}
                agentP={agentP}
                threshold={threshold}
                decided={decided}
                direction={effDirection}
              />
            </div>
          </>
        ) : (
          <div className="lg:col-span-3">
            <MindROCTicker points={series.points} roc={roc} rocWindow={rocWindow} />
          </div>
        )}

        <div className="lg:col-span-3">
          <MindDecisionWaterfall state={state} connected={connected} />
        </div>
      </div>
    </section>
  );
}
