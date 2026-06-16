// useAgentStream — live feed of the trader's lifecycle events over SSE.
//
// Connects to /api/agent-events?policy_id=… and reduces the event
// stream into one renderable state object: the latest signals bundle,
// SVI surface, decision, mint/delivery progress, and a step map that
// drives the decision waterfall. EventSource reconnects automatically;
// `connected` lets consumers show a quiet "reconnecting" affordance
// and fall back to polling data.

"use client";

import { useEffect, useReducer, useState } from "react";

import { apiUrl } from "@/lib/api-base";

export type AgentStreamEvent = {
  ts: number;
  seq: number;
  type: string;
  policy_id?: string | null;
  task_id?: string | null;
  asset?: string;
  data?: Record<string, unknown>;
};

export type StreamSignals = {
  spot: number | null;
  roc_5m: number | null;
  roc_30m: number | null;
  roc_60m: number | null;
  sma_15m: number | null;
  sma_60m: number | null;
  rsi_60m: number | null;
  realized_vol_60m: number | null;
};

export type StreamSurface = {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
  spotUsd: number;
  forwardUsd: number;
  expiryMs: number;
};

export type StreamDecision = {
  strategy: string;
  decided: boolean;
  direction: "up" | "down" | null;
  quantity: number;
  conviction: number;
  reasoning: string | null;
  strikeUsd: number | null;
  spotUsd: number | null;
  marketP: number | null;
  // Brief Operator decision-engine pipeline (gated-spot operators).
  mode: string | null;
  thesis: string | null;
  counterargument: string | null;
  riskReview: string | null;
  policyReview: string | null;
  executionReview: string | null;
  verdict: string | null;
  aiReasoned: boolean;
  // User mandate — objective + live drawdown guard (null when none set).
  mandateReview: string | null;
  mandate: {
    summary: string;
    progressPct: number;
    drawdownPct: number;
    maxDrawdownPct: number;
    breached: boolean;
  } | null;
  // Experience Engine — similar past situations recalled before deciding.
  recall: {
    note: string;
    found: number;
    wins: number;
    losses: number;
    abstained: number;
    confidenceMult: number;
  } | null;
};

export type StepStatus = "pending" | "active" | "done" | "failed" | "skipped";

export type WaterfallStep =
  | "observe"
  | "signals"
  | "svi"
  | "decision"
  | "mint"
  | "walrus"
  | "delivered";

export type AgentStreamState = {
  /** Wall-clock of the last event seen (0 = none yet). */
  lastEventTs: number;
  taskId: string | null;
  asset: string | null;
  startedAtMs: number | null;
  spotUsd: number | null;
  oracleId: string | null;
  strikeUsd: number | null;
  expiryMs: number | null;
  signals: StreamSignals | null;
  surface: StreamSurface | null;
  decision: StreamDecision | null;
  mode: "live" | "simulated" | null;
  simReason: string | null;
  mintTx: string | null;
  walrusReasoningBlobId: string | null;
  walrusJournalBlobId: string | null;
  /** The operator's manifesto blob — published once per policy, out of
   *  band from the per-decision lifecycle. */
  walrusManifestoBlobId: string | null;
  /** The operator's Experience snapshot blob — its memory, anchored on
   *  Walrus and refreshed as it learns. */
  walrusExperienceBlobId: string | null;
  journalEntries: number | null;
  deliveredTx: string | null;
  steps: Record<WaterfallStep, { status: StepStatus; ts: number | null }>;
  events: AgentStreamEvent[];
  /** Last self-healing gas top-up (global event) — drives the quiet
   *  "Brief auto-funded the trader" toast. */
  wardenTopup: { ts: number; from: string; to: string; amountSui: number } | null;
  /** Set when the trader rotated off an unreadable pool, e.g.
   *  "WAL pool unavailable → SUI". Cleared on the next task. */
  fallbackNote: string | null;
  /** Set when a task closed on an infra failure — drives the honest
   *  "infra hiccup, dispatch again" state. */
  failure: { error: string } | null;
  /** The operator's DEEP fuel tank (covers DeepBook fees) — drives the
   *  fuel gauge. level: ok (green) / low (amber) / empty (awaiting fuel). */
  fuel: { deepHuman: number; level: "ok" | "low" | "empty"; ts: number } | null;
};

const FRESH_STEPS = (): AgentStreamState["steps"] => ({
  observe: { status: "pending", ts: null },
  signals: { status: "pending", ts: null },
  svi: { status: "pending", ts: null },
  decision: { status: "pending", ts: null },
  mint: { status: "pending", ts: null },
  walrus: { status: "pending", ts: null },
  delivered: { status: "pending", ts: null },
});

const INITIAL: AgentStreamState = {
  lastEventTs: 0,
  taskId: null,
  asset: null,
  startedAtMs: null,
  spotUsd: null,
  oracleId: null,
  strikeUsd: null,
  expiryMs: null,
  signals: null,
  surface: null,
  decision: null,
  mode: null,
  simReason: null,
  mintTx: null,
  walrusReasoningBlobId: null,
  walrusJournalBlobId: null,
  walrusManifestoBlobId: null,
  walrusExperienceBlobId: null,
  journalEntries: null,
  deliveredTx: null,
  steps: FRESH_STEPS(),
  events: [],
  wardenTopup: null,
  fallbackNote: null,
  failure: null,
  fuel: null,
};

function reduce(state: AgentStreamState, e: AgentStreamEvent): AgentStreamState {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

  const next: AgentStreamState = {
    ...state,
    lastEventTs: e.ts,
    steps: { ...state.steps },
    events: [...state.events.slice(-39), e],
  };

  switch (e.type) {
    case "task_started":
      return {
        ...INITIAL,
        lastEventTs: e.ts,
        taskId: e.task_id ?? null,
        asset: e.asset ?? null,
        startedAtMs: e.ts,
        steps: FRESH_STEPS(),
        events: [...state.events.slice(-39), e],
        wardenTopup: state.wardenTopup,
      };
    case "asset_fallback": {
      const from = str(d.from) ?? state.asset ?? "?";
      const to = str(d.to) ?? "?";
      next.asset = to;
      next.fallbackNote = `${from} pool unavailable → ${to}`;
      // The observe step is what just failed-over; keep it active.
      next.steps.observe = { status: "active", ts: e.ts };
      return next;
    }
    case "task_failed": {
      next.failure = { error: str(d.error) ?? "infra failure" };
      // Any step not already done flips to failed so the wire never
      // looks like it's still working.
      (Object.keys(next.steps) as WaterfallStep[]).forEach((k) => {
        if (next.steps[k].status !== "done") {
          next.steps[k] = { status: "failed", ts: e.ts };
        }
      });
      return next;
    }
    case "warden_topup":
      next.wardenTopup = {
        ts: e.ts,
        from: str(d.from) ?? "fleet",
        to: str(d.to) ?? "trader",
        amountSui: num(d.amount_sui) ?? 0,
      };
      return next;
    case "fuel":
      next.fuel = {
        deepHuman: num(d.deep_human) ?? 0,
        level: (str(d.level) as "ok" | "low" | "empty") ?? "ok",
        ts: e.ts,
      };
      return next;
    case "observe":
      next.spotUsd = num(d.spot_usd);
      next.oracleId = str(d.oracle_id);
      next.strikeUsd = num(d.strike_usd);
      next.expiryMs = num(d.expiry_ms);
      next.asset = e.asset ?? next.asset;
      next.steps.observe = { status: "done", ts: e.ts };
      next.steps.signals = { status: "active", ts: null };
      return next;
    case "signals":
      next.signals = (d.signals as StreamSignals) ?? null;
      next.steps.signals = { status: "done", ts: e.ts };
      next.steps.svi = { status: "active", ts: null };
      return next;
    case "svi":
      if (d.ok === false) {
        next.steps.svi = { status: "skipped", ts: e.ts };
      } else {
        next.surface = (d.surface as StreamSurface) ?? null;
        next.steps.svi = { status: "done", ts: e.ts };
      }
      next.steps.decision = { status: "active", ts: null };
      return next;
    case "decision": {
      const decided = d.decided === true;
      next.decision = {
        strategy: str(d.strategy) ?? "agent",
        decided,
        direction: (str(d.direction) as "up" | "down" | null) ?? null,
        quantity: num(d.quantity) ?? 0,
        conviction: num(d.conviction) ?? 0,
        reasoning: str(d.reasoning),
        strikeUsd: num(d.strike_usd),
        spotUsd: num(d.spot_usd),
        marketP: num(d.market_p),
        mode: str(d.mode),
        thesis: str(d.thesis),
        counterargument: str(d.counterargument),
        riskReview: str(d.risk_review),
        policyReview: str(d.policy_review),
        executionReview: str(d.execution_review),
        verdict: str(d.verdict),
        aiReasoned: d.ai_reasoned === true,
        mandateReview: str(d.mandate_review),
        mandate: (() => {
          const m = d.mandate as Record<string, unknown> | undefined;
          if (!m || typeof m !== "object") return null;
          return {
            summary: str(m.summary) ?? "",
            progressPct: num(m.progress_pct) ?? 0,
            drawdownPct: num(m.drawdown_pct) ?? 0,
            maxDrawdownPct: num(m.max_drawdown_pct) ?? 0,
            breached: m.breached === true,
          };
        })(),
        recall: (() => {
          const r = d.recall as Record<string, unknown> | undefined;
          if (!r || typeof r !== "object") return null;
          return {
            note: str(r.note) ?? "",
            found: num(r.found) ?? 0,
            wins: num(r.wins) ?? 0,
            losses: num(r.losses) ?? 0,
            abstained: num(r.abstained) ?? 0,
            confidenceMult: num(r.confidence_mult) ?? 1,
          };
        })(),
      };
      next.steps.decision = { status: "done", ts: e.ts };
      next.steps.mint = decided
        ? { status: "active", ts: null }
        : { status: "skipped", ts: e.ts };
      if (!decided) next.steps.walrus = { status: "active", ts: null };
      return next;
    }
    case "mode":
      next.mode = (str(d.mode) as "live" | "simulated" | null) ?? null;
      next.simReason = str(d.sim_reason);
      if (next.mode === "simulated" && next.steps.mint.status === "active") {
        next.steps.mint = { status: "skipped", ts: e.ts };
        next.steps.walrus = { status: "active", ts: null };
      }
      return next;
    case "mint_pending":
      next.steps.mint = { status: "active", ts: e.ts };
      return next;
    case "mint_landed":
    case "spot_opened":
      next.mintTx = str(d.tx);
      next.steps.mint = { status: "done", ts: e.ts };
      next.steps.walrus = { status: "active", ts: null };
      return next;
    case "mint_failed":
      next.steps.mint = { status: "failed", ts: e.ts };
      next.simReason = str(d.error) ?? next.simReason;
      next.steps.walrus = { status: "active", ts: null };
      return next;
    case "walrus_uploaded":
      // The manifesto is published out-of-band (once per policy) — record
      // the blob but DON'T advance the per-decision waterfall.
      if (d.kind === "manifesto") {
        next.walrusManifestoBlobId = str(d.blob_id);
        return next;
      }
      if (d.kind === "experience") {
        // Memory snapshot — record the blob; don't touch the per-decision
        // waterfall (it's published out of band).
        next.walrusExperienceBlobId = str(d.blob_id);
        return next;
      }
      if (d.kind === "journal") {
        next.walrusJournalBlobId = str(d.blob_id);
        next.journalEntries = num(d.entries);
      } else {
        next.walrusReasoningBlobId = str(d.blob_id);
      }
      next.steps.walrus = { status: "done", ts: e.ts };
      next.steps.delivered = { status: "active", ts: null };
      return next;
    case "delivered":
      next.deliveredTx = str(d.tx);
      next.mode = (str(d.mode) as "live" | "simulated" | null) ?? next.mode;
      next.steps.delivered = { status: "done", ts: e.ts };
      // Walrus may have been unfunded — close out the step honestly.
      if (next.steps.walrus.status === "active") {
        next.steps.walrus = { status: "skipped", ts: e.ts };
      }
      if (next.steps.mint.status === "active") {
        next.steps.mint = { status: "skipped", ts: e.ts };
      }
      return next;
    default:
      return next;
  }
}

export function useAgentStream(policyId: string | null | undefined): {
  state: AgentStreamState;
  connected: boolean;
} {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!policyId || !policyId.startsWith("0x")) return;
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(
      apiUrl(`/api/agent-events?policy_id=${encodeURIComponent(policyId)}`),
    );
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        dispatch(JSON.parse(msg.data) as AgentStreamEvent);
      } catch {
        /* malformed line — ignore */
      }
    };
    return () => {
      es.close();
      setConnected(false);
    };
  }, [policyId]);

  return { state, connected };
}
