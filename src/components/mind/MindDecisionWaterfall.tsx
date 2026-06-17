// MindDecisionWaterfall · the agent's thought process, step by step,
// lighting up live as SSE events land. Each row maps to one real
// lifecycle event the trader emitted (no theater: a step only lights
// when the corresponding thing actually happened on the wire).

"use client";

import type { AgentStreamState, StepStatus, WaterfallStep } from "@/lib/use-agent-stream";

const STEP_ORDER: WaterfallStep[] = [
  "observe",
  "signals",
  "svi",
  "decision",
  "mint",
  "walrus",
  "delivered",
];

function stepCopy(
  step: WaterfallStep,
  s: AgentStreamState,
): { title: string; detail: string | null } {
  switch (step) {
    case "observe":
      return {
        title: "Observed the market",
        detail:
          s.spotUsd !== null
            ? `${s.asset ?? "BTC"} spot $${s.spotUsd.toFixed(2)}${
                s.strikeUsd ? ` · strike $${s.strikeUsd.toFixed(2)}` : ""
              }`
            : null,
      };
    case "signals":
      return {
        title: "Computed signals",
        detail: s.signals
          ? `ROC30m ${
              s.signals.roc_30m === null ? "n/a" : `${(s.signals.roc_30m * 100).toFixed(3)}%`
            } · RSI ${s.signals.rsi_60m === null ? "n/a" : s.signals.rsi_60m.toFixed(1)} · vol ${
              s.signals.realized_vol_60m === null
                ? "n/a"
                : `${(s.signals.realized_vol_60m * 100).toFixed(1)}%`
            }`
          : null,
      };
    case "svi":
      return {
        title: "Read the SVI surface",
        detail: s.surface
          ? `on-chain · F $${s.surface.forwardUsd.toFixed(0)} · ρ ${s.surface.rho.toFixed(3)}`
          : s.steps.svi.status === "skipped"
            ? "no surface this cycle (spot asset or cold RPC)"
            : null,
      };
    case "decision": {
      if (!s.decision) return { title: "Decision", detail: null };
      return s.decision.decided
        ? {
            title: `Decision: bet ${s.decision.direction?.toUpperCase() ?? ""}`,
            detail: `${s.decision.strategy} · qty ${s.decision.quantity} · conviction ${(s.decision.conviction * 100).toFixed(0)}%`,
          }
        : {
            title: "Decision: sat out",
            detail: `${s.decision.strategy} saw no edge · honest abstention`,
          };
    }
    case "mint":
      return {
        title: "Policy-gated mint",
        detail: s.mintTx
          ? `landed · ${s.mintTx.slice(0, 10)}… (one atomic PTB: record_spend → mint)`
          : s.steps.mint.status === "failed"
            ? (s.simReason ?? "chain refused the spend")
            : s.steps.mint.status === "skipped"
              ? (s.simReason ?? "simulated this cycle")
              : "signing…",
      };
    case "walrus":
      return {
        title: "Wrote memory to Walrus",
        detail: s.walrusJournalBlobId
          ? `journal ${s.walrusJournalBlobId.slice(0, 10)}…${
              s.journalEntries ? ` · ${s.journalEntries} entries` : ""
            }`
          : s.walrusReasoningBlobId
            ? `reasoning ${s.walrusReasoningBlobId.slice(0, 10)}…`
            : s.steps.walrus.status === "skipped"
              ? "skipped (WAL unfunded)"
              : "uploading…",
      };
    case "delivered":
      return {
        title: "Delivered on-chain",
        detail: s.deliveredTx
          ? `${s.deliveredTx.slice(0, 10)}… · ${s.mode ?? ""}`
          : null,
      };
  }
}

function Dot({ status }: { status: StepStatus }) {
  if (status === "done")
    return <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden />;
  if (status === "active")
    return (
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sui opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-sui" />
      </span>
    );
  if (status === "failed")
    return <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden />;
  if (status === "skipped")
    return <span className="h-2 w-2 rounded-full border border-muted-2 bg-bg-elev" aria-hidden />;
  return <span className="h-2 w-2 rounded-full bg-line-strong" aria-hidden />;
}

export function MindDecisionWaterfall({
  state,
  connected,
}: {
  state: AgentStreamState;
  connected: boolean;
}) {
  const idle = state.lastEventTs === 0;

  return (
    <div className="border border-line bg-bg-elev px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
          Decision wire · every step is a real event
        </p>
        <p className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              connected ? "bg-emerald-500" : "bg-muted-2"
            }`}
            aria-hidden
          />
          {connected ? "live wire" : "reconnecting"}
        </p>
      </div>

      {state.fallbackNote && !state.failure && (
        <p className="mt-3 inline-flex items-center gap-1.5 border border-amber-600/40 bg-amber-50/60 px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-amber-800 animate-land-in">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-amber-600" />
          {state.fallbackNote}
        </p>
      )}
      {state.failure && (
        <p className="mt-3 inline-flex items-center gap-1.5 border border-red-500/50 bg-red-50/70 px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-red-700 animate-land-in">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-red-600" />
          infra hiccup · closed honestly as simulated
        </p>
      )}

      {idle ? (
        <p className="mt-4 font-sans text-[14px] italic leading-relaxed text-muted">
          The wire is quiet. Dispatch a task and watch the agent think
          here · observe, compute, price, decide · as it happens.
        </p>
      ) : (
        <ol className="relative mt-4 space-y-0">
          {STEP_ORDER.map((step, i) => {
            const st = state.steps[step];
            const copy = stepCopy(step, state);
            const deltaMs =
              st.ts !== null && state.startedAtMs !== null
                ? st.ts - state.startedAtMs
                : null;
            return (
              <li
                key={`${state.taskId ?? "t"}-${step}`}
                className="relative flex gap-3 pb-3.5 last:pb-0"
              >
                {/* connector */}
                {i < STEP_ORDER.length - 1 && (
                  <span
                    className="absolute left-[3.5px] top-4 h-full w-px bg-line"
                    aria-hidden
                  />
                )}
                <span className="relative z-10 mt-[5px] shrink-0">
                  <Dot status={st.status} />
                </span>
                <div
                  className={`min-w-0 flex-1 transition-opacity duration-300 ${
                    st.status === "pending" ? "opacity-40" : "opacity-100"
                  } ${st.status === "done" || st.status === "active" ? "animate-land-in" : ""}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p
                      className={`font-sans text-[14px] leading-snug ${
                        st.status === "failed"
                          ? "text-red-700"
                          : st.status === "skipped"
                            ? "text-muted"
                            : "text-ink"
                      }`}
                    >
                      {copy.title}
                    </p>
                    {deltaMs !== null && (
                      <p className="font-mono text-[9.5px] tabular-nums tracking-[0.08em] text-muted">
                        +{(deltaMs / 1000).toFixed(1)}s
                      </p>
                    )}
                  </div>
                  {copy.detail && (
                    <p className="mt-0.5 break-all font-mono text-[10.5px] leading-relaxed tracking-[0.02em] text-ink-2">
                      {copy.detail}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
