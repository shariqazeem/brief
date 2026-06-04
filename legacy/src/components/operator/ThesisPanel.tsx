"use client";

// ThesisPanel — surfaces the LLM-composed plan for an OperatorPolicy.
//
// Reads the most recent "Strategy" WorkObject parented to the head policy,
// renders the thesis + step list + "Rethink the plan" action. Everything
// the operator is actively pursuing is visible here, so the user can read
// the agent's mind in plain English.

import { useEffect, useMemo, useState } from "react";
import { decodePayload, type DecodedWorkObject } from "@/lib/work-object";
import type { OperatorPolicyDecoded } from "@/lib/operator-policy-client";

type PlanStepStatus = "pending" | "active" | "done" | "skipped" | "failed";
type PlanStepTrigger =
  | { kind: "immediate" }
  | { kind: "deepbook_spread_below_bps"; bps: number }
  | { kind: "deepbook_spread_above_bps"; bps: number }
  | { kind: "validator_apy_above_pct"; pct: number }
  | { kind: "validator_apy_below_pct"; pct: number }
  | { kind: "after_step"; step_id: string };

type PlanStep = {
  id: string;
  venue: "SuiSystem" | "DeepBook";
  intent: string;
  amount_sui: number;
  trigger: PlanStepTrigger;
  max_attempts: number;
  status: PlanStepStatus;
};

type RebalanceTrigger =
  | { kind: "drawdown_above_pct"; pct: number }
  | { kind: "validator_apy_drift_below_pct"; pct: number }
  | { kind: "deepbook_spread_widens_above_bps"; bps: number };

type PlanPayload = {
  operator_policy: string;
  schema_version: number;
  thesis: string;
  reasoning_summary?: string;
  goal_text?: string;
  steps: PlanStep[];
  rebalance_triggers: RebalanceTrigger[];
  model_tag: string;
  source: "llm" | "fallback";
  raw_reasoning?: string;
  created_at_ms: number;
  parent_strategy?: string | null;
};

export function ThesisPanel({
  policy,
  workObjects,
}: {
  policy: OperatorPolicyDecoded;
  workObjects: DecodedWorkObject[];
}) {
  // The freshest Strategy WO for this policy.
  const strategies = useMemo(
    () =>
      workObjects
        .filter((w) => w.kind === "Strategy" && w.parentIds.includes(policy.id))
        .sort((a, b) => Number(b.timestampMs - a.timestampMs)),
    [workObjects, policy.id],
  );
  const head = strategies[0];

  // Decode the active plan's payload (inline JSON for v1).
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  useEffect(() => {
    if (!head) {
      setPlan(null);
      return;
    }
    if (head.payloadBytes && head.payloadBytes.length > 0) {
      try {
        setPlan(decodePayload<PlanPayload>(head.payloadBytes));
      } catch {
        setPlan(null);
      }
    }
  }, [head]);

  // Pending / submitting / done state for the Rethink button.
  const [rethinkState, setRethinkState] = useState<
    "idle" | "pending" | "queued" | "error"
  >("idle");
  const [rethinkError, setRethinkError] = useState<string | null>(null);

  const onRethink = async () => {
    setRethinkState("pending");
    setRethinkError(null);
    try {
      const resp = await fetch("/api/operator/replan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy_id: policy.id,
          reason: "user_requested",
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 120)}`);
      }
      setRethinkState("queued");
      // The agent picks up the request on its next cycle and mints a new
      // Strategy WO; the polling at the page level surfaces it. Re-arm the
      // button after ~30s so the user can ask again if needed.
      setTimeout(() => setRethinkState("idle"), 30_000);
    } catch (e) {
      setRethinkState("error");
      setRethinkError((e as Error)?.message ?? String(e));
    }
  };

  // No Strategy WO yet — the agent's first cycle hasn't minted it. Show a
  // soft "composing" placeholder so the user understands what's happening.
  if (!head || !plan) {
    return (
      <section className="rounded-2xl border border-line bg-bg-elev p-5 sm:p-6">
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] font-medium text-muted">Thesis</p>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted">
            composing…
          </p>
        </div>
        <p className="mt-3 text-[14px] italic leading-[1.55] text-ink-2">
          Agent is reading the market and producing its first plan. This is
          one LLM call at grant time &mdash; it should land within ~15 s.
        </p>
      </section>
    );
  }

  const completedSteps = plan.steps.filter((s) => s.status === "done").length;
  const failedSteps = plan.steps.filter((s) => s.status === "failed").length;
  const totalSteps = plan.steps.length;
  const allDone = plan.steps.every(
    (s) => s.status === "done" || s.status === "skipped",
  );
  const headerState = allDone
    ? "executed"
    : failedSteps > 0
      ? "recovering"
      : "in progress";
  const mintedAt = new Date(Number(head.timestampMs));

  return (
    <section className="rounded-2xl border border-line bg-bg-elev p-5 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <p className="text-[12px] font-medium text-muted">Thesis</p>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted-2">
            {headerState}
          </span>
        </div>
        <p className="font-mono text-[10.5px] tabular-nums text-muted">
          {completedSteps}/{totalSteps} steps
          {failedSteps > 0 ? ` · ${failedSteps} failed` : ""}
        </p>
      </div>

      {/* Thesis paragraph */}
      <p className="mt-3 border-l-2 border-line pl-4 text-[15px] italic leading-[1.55] text-ink-2">
        {plan.thesis}
      </p>

      {/* Optional one-line reasoning summary */}
      {plan.reasoning_summary ? (
        <p className="mt-3 text-[12.5px] leading-[1.55] text-muted">
          {plan.reasoning_summary}
        </p>
      ) : null}

      {/* Step list */}
      <ol className="mt-5 flex flex-col gap-3 border-t border-line-subtle pt-5">
        {plan.steps.map((step, i) => (
          <StepRow key={step.id} step={step} index={i} />
        ))}
      </ol>

      {/* Rebalance triggers — only if the plan declared any */}
      {plan.rebalance_triggers.length > 0 ? (
        <div className="mt-5 border-t border-line-subtle pt-5">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted">
            Rebalance triggers
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {plan.rebalance_triggers.map((t, i) => (
              <li
                key={i}
                className="text-[12.5px] leading-[1.5] text-ink-2"
              >
                &middot; {describeRebalanceTrigger(t)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Footer — rethink action + provenance */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-5">
        <p className="font-mono text-[10.5px] tabular-nums text-muted">
          minted {mintedAt.toLocaleTimeString()} ·{" "}
          {plan.source === "llm" ? plan.model_tag : "rule-based fallback"}
        </p>
        <button
          type="button"
          onClick={onRethink}
          disabled={rethinkState === "pending" || rethinkState === "queued"}
          className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-bg-elev-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {rethinkState === "pending"
            ? "Asking agent…"
            : rethinkState === "queued"
              ? "Queued ✓"
              : "Rethink the plan"}
        </button>
      </div>
      {rethinkError ? (
        <p className="mt-2 text-[11.5px] text-red-700">{rethinkError}</p>
      ) : null}
    </section>
  );
}

function StepRow({ step, index }: { step: PlanStep; index: number }) {
  const pulse = stepPulse(step.status);
  return (
    <li className="flex items-baseline gap-3">
      <span
        aria-label={step.status}
        className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${pulse.color} ${
          step.status === "pending" || step.status === "active"
            ? "animate-pulse"
            : ""
        }`}
      />
      <div className="flex-1">
        <p className="text-[13.5px] leading-[1.45] text-ink">
          <span className="font-mono text-[11px] tracking-[0.16em] text-muted">
            {String(index + 1).padStart(2, "0")}.
          </span>{" "}
          {step.intent}
        </p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-muted">
          <span>{step.venue}</span>
          <span>{step.amount_sui.toFixed(2)} SUI</span>
          <span className={pulse.label}>{pulse.text}</span>
          {step.trigger.kind !== "immediate" ? (
            <span>· trigger: {describeStepTrigger(step.trigger)}</span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

function stepPulse(status: PlanStepStatus): {
  color: string;
  label: string;
  text: string;
} {
  switch (status) {
    case "done":
      return { color: "bg-emerald-600", label: "text-emerald-700", text: "done" };
    case "failed":
      return { color: "bg-red-500", label: "text-red-700", text: "failed" };
    case "skipped":
      return { color: "bg-muted-2", label: "text-muted-2", text: "skipped" };
    case "active":
      return { color: "bg-accent", label: "text-accent", text: "active" };
    case "pending":
    default:
      return { color: "bg-muted-2", label: "text-muted", text: "pending" };
  }
}

function describeStepTrigger(t: PlanStepTrigger): string {
  switch (t.kind) {
    case "immediate":
      return "immediate";
    case "deepbook_spread_below_bps":
      return `DeepBook spread < ${t.bps} bps`;
    case "deepbook_spread_above_bps":
      return `DeepBook spread > ${t.bps} bps`;
    case "validator_apy_above_pct":
      return `validator APY > ${t.pct}%`;
    case "validator_apy_below_pct":
      return `validator APY < ${t.pct}%`;
    case "after_step":
      return `after ${t.step_id}`;
  }
}

function describeRebalanceTrigger(t: RebalanceTrigger): string {
  switch (t.kind) {
    case "drawdown_above_pct":
      return `Re-plan if drawdown exceeds ${t.pct}%`;
    case "validator_apy_drift_below_pct":
      return `Re-plan if validator APY drifts below ${t.pct}%`;
    case "deepbook_spread_widens_above_bps":
      return `Re-plan if DeepBook spread widens above ${t.bps} bps`;
  }
}
