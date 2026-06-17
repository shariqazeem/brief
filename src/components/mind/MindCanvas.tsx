// MindCanvas · the live trading floor. Owns all three mind feeds
// (usePriceSeries, useVolSurface, useAgentStream) plus the trade
// history, and lays them out as two calm zones:
//   Zone 2 "The Bet"  · the verdict slot (passed in by the position
//                        panel) beside the price chart with decision
//                        markers.
//   Zone 3 "The Mind" · one tabbed card: Signals · Vol smile · Edge ·
//                        Wire. Reasoning renders ONLY in the Edge tab.
// Every number is sourced from chain state or the agent's own files;
// nothing is fabricated. Lazy-loaded so recharts stays out of first load.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useAgentStream } from "@/lib/use-agent-stream";
import { usePriceSeries, useVolSurface, useTraderTrades } from "@/lib/use-mind-data";
import { MindPriceChart } from "./MindPriceChart";
import { MindRSIGauge } from "./MindRSIGauge";
import { MindROCTicker } from "./MindROCTicker";
import { MindVolSmile } from "./MindVolSmile";
import { MindEdgeMeter } from "./MindEdgeMeter";
import { MindDecisionWaterfall } from "./MindDecisionWaterfall";

type TabId = "signals" | "smile" | "edge" | "wire";

export default function MindCanvas({
  policyId,
  oracleId,
  asset,
  strikeUsd,
  direction,
  liveSpotUsd,
  traderName,
  fallbackReasoning,
  verdictSlot = null,
  walrusBlobId = null,
  abstained = false,
  traderVoice = null,
  onDispatchAgain,
  dispatching = false,
}: {
  policyId: string | null;
  oracleId: string | null;
  asset: string;
  strikeUsd: number | null;
  direction: "up" | "down" | null;
  liveSpotUsd: number | null;
  traderName: string;
  /** Reasoning text of the last delivered decision · shown in the Edge
   *  tab and mined for edge numbers when SSE hasn't replayed one yet. */
  fallbackReasoning?: string | null;
  /** Zone 2 left column: the bet verdict (live spot, gauge, mode badge),
   *  composed by the position panel from the deliverable. */
  verdictSlot?: React.ReactNode;
  /** Per-decision reasoning blob for the Edge tab's "verifiable" link. */
  walrusBlobId?: string | null;
  abstained?: boolean;
  /** Personality voice line, shown in the pre-decision waiting state. */
  traderVoice?: string | null;
  /** Re-dispatch a task after an honest infra failure. */
  onDispatchAgain?: () => void;
  dispatching?: boolean;
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
  const decided = state.decision ? state.decision.decided : direction !== null;

  // Signal headline values: SSE-fresh when available, else the series poll.
  const rsi = state.signals?.rsi_60m ?? series.latest?.rsi60 ?? null;
  const roc30 = state.signals?.roc_30m ?? series.latest?.roc30 ?? null;
  const roc5 = state.signals?.roc_5m ?? series.latest?.roc5 ?? null;
  const roc = roc30 ?? roc5;
  const rocWindow = roc30 !== null ? "30m" : "5m";

  // A task is "in flight" once events start arriving but delivery hasn't
  // landed · that's when the Wire tab is the most useful default.
  const inFlight =
    state.lastEventTs > 0 && state.steps.delivered.status !== "done";

  const [tab, setTab] = useState<TabId>("signals");
  const userPickedRef = useRef(false);
  useEffect(() => {
    // Auto-focus the Wire while a decision streams · unless the user has
    // already chosen a tab themselves.
    if (!userPickedRef.current && inFlight) setTab("wire");
  }, [inFlight]);
  const pick = (t: TabId) => {
    userPickedRef.current = true;
    setTab(t);
  };

  const tabs: Array<{ id: TabId; label: string }> = isBtc
    ? [
        { id: "signals", label: "Signals" },
        { id: "smile", label: "Vol smile" },
        { id: "edge", label: "Edge" },
        { id: "wire", label: "Wire" },
      ]
    : [
        { id: "signals", label: "Signals" },
        { id: "wire", label: "Wire" },
      ];
  // Guard: if the active tab isn't available for this asset, fall back.
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "signals";

  // "What it's doing now" · the live step label for the waiting state.
  const doingNow = useMemo(() => {
    if (state.lastEventTs === 0)
      return "waiting for the planner to post the job…";
    const labels: Record<string, string> = {
      observe: `reading the ${state.asset ?? asset} pool mid…`,
      signals: "computing signals (ROC · SMA · RSI)…",
      svi: "reading the live SVI surface…",
      decision: "weighing the edge…",
      mint: "placing the bet on chain…",
      walrus: "writing memory to Walrus…",
      delivered: "finalizing the deliverable…",
    };
    const order: Array<keyof typeof state.steps> = [
      "observe",
      "signals",
      "svi",
      "decision",
      "mint",
      "walrus",
      "delivered",
    ];
    const active = order.find((k) => state.steps[k].status === "active");
    if (active) return labels[active]!;
    const lastDone = [...order].reverse().find((k) => state.steps[k].status === "done");
    return lastDone ? labels[lastDone]! : "studying the order book…";
  }, [state, asset]);

  // Quiet self-healing toast: visible for 12s after the warden moves gas.
  const topup = state.wardenTopup;
  const topupFresh = topup !== null && Date.now() - topup.ts < 12_000;

  return (
    <section className="mt-6 space-y-2.5">
      {topupFresh && topup && (
        <div className="flex items-center gap-2 border border-emerald-600/40 bg-emerald-50/70 px-3 py-2 animate-land-in">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden />
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-800">
            Brief auto-funded the {topup.to} wallet · {topup.amountSui.toFixed(3)} SUI · self-healing gas
          </p>
        </div>
      )}

      {/* ZONE 2 · The Bet: verdict beside the live chart, one card. */}
      <div className="border-2 border-ink bg-bg-elev">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5 sm:px-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
            The bet · {traderName}
          </p>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
            {state.asset ?? asset} · live
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[1fr_1.5fr]">
          <div className="min-w-0">
            {verdictSlot ?? (
              state.failure ? (
                <div className="border-2 border-red-400/70 bg-red-50/50 px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-red-800">
                    Infra hiccup · task closed honestly
                  </p>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                    Every DeepBook spot pool was unreadable this cycle, so the
                    task closed as <span className="text-ink">simulated</span> -
                    no bet placed, no funds touched. This is testnet pool
                    flakiness, not your leash.
                  </p>
                  {onDispatchAgain && (
                    <button
                      type="button"
                      onClick={onDispatchAgain}
                      disabled={dispatching}
                      className="mt-3 inline-flex items-center gap-2 border-2 border-ink bg-ink px-4 py-2 font-mono text-[10px] uppercase tracking-[0.28em] text-bg transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {dispatching ? "Dispatching…" : "Dispatch again →"}
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {traderVoice && (
                    <p className="text-[15px] italic leading-snug text-ink-2">
                      &ldquo;{traderVoice}&rdquo;
                    </p>
                  )}
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink">
                    {traderName} · {doingNow}
                  </p>
                  <div className="flex gap-1" aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="inline-block h-1.5 w-1.5 rounded-full bg-muted animate-pulse"
                        style={{ animationDelay: `${i * 200}ms` }}
                      />
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
          <div className="min-w-0">
            <MindPriceChart
              points={series.points}
              liveSpotUsd={liveSpotUsd}
              strikeUsd={effStrikeUsd}
              direction={effDirection}
              asset={state.asset ?? asset}
              decisions={trades.decisions}
            />
          </div>
        </div>
      </div>

      {/* ZONE 3 · The Mind: one tabbed card. */}
      <div className="border-2 border-line bg-bg-elev">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5 sm:px-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
            How {traderName} thinks
          </p>
          <span
            className={`flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] ${
              connected ? "text-muted" : "text-amber-700"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                connected ? "animate-pulse bg-emerald-500" : "animate-pulse bg-amber-500"
              }`}
              aria-hidden
            />
            {connected ? "live wire" : "reconnecting…"}
          </span>
        </div>

        {/* tab row */}
        <div role="tablist" className="flex gap-1 border-b border-line px-3 sm:px-4">
          {tabs.map((t) => {
            const on = t.id === activeTab;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={on}
                type="button"
                onClick={() => pick(t.id)}
                className={[
                  "-mb-px border-b-2 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                  on
                    ? "border-ink text-ink"
                    : "border-transparent text-muted hover:text-ink",
                ].join(" ")}
              >
                {t.label}
                {t.id === "wire" && inFlight && (
                  <span
                    className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle animate-pulse"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>

        <div key={activeTab} className="px-4 py-4 animate-fade-up sm:px-5">
          {activeTab === "signals" && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <MindRSIGauge rsi={rsi} />
              <MindROCTicker points={series.points} roc={roc} rocWindow={rocWindow} />
            </div>
          )}

          {activeTab === "smile" && (
            <MindVolSmile
              smile={vol.smile}
              surface={vol.surface}
              strikeKValue={vol.strikeKValue}
              strikeUsd={effStrikeUsd}
            />
          )}

          {activeTab === "edge" && (
            <div className="space-y-4">
              <MindEdgeMeter
                marketP={marketP}
                agentP={agentP}
                threshold={threshold}
                decided={decided}
                direction={effDirection}
              />
              {reasoningText && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
                    {abstained || !decided ? "Why no bet" : "Why this bet"}
                  </p>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                    {reasoningText}
                  </p>
                  {walrusBlobId && (
                    <a
                      href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${walrusBlobId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 border border-emerald-600/40 bg-emerald-50/70 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-emerald-800 hover:bg-emerald-100/70"
                    >
                      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" />
                      Verifiable on Walrus
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "wire" && (
            <MindDecisionWaterfall state={state} connected={connected} />
          )}
        </div>
      </div>
    </section>
  );
}
