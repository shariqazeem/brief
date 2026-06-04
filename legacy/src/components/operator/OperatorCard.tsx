"use client";

import { useEffect, useState } from "react";
import {
  deriveOperatorState,
  OPERATOR_STATE_LABEL,
  operatorStateTone,
  secondsUntilNextScan,
} from "@/lib/operator-state";
import {
  BRIEF_OPERATOR_ADDRESS,
  formatRelative,
  formatSui,
  type OperatorPolicyDecoded,
} from "@/lib/operator-policy-client";
import { BRIEF_PACKAGE_ID, explorerUrl } from "@/lib/brief-client";
import type { DecodedWorkObject } from "@/lib/work-object";
import { useObjective } from "@/lib/objectives-client";

/**
 * OperatorCard — the operator's "now" panel.
 *
 * Recast yet again: the prior "Certificate of Mandate" double-rule legal
 * register was high in identity but low in readability. This rewrite
 * keeps the same content but in a modern Kyvern-sibling aesthetic —
 * single soft border, rounded corners, dark Inter type on near-white,
 * monospace only for numbers and addresses.
 *
 * Sections (top → bottom):
 *   ▸ Header strip: state pulse + operator name + grant timestamp
 *   ▸ Mandate quote (italic, soft border on the left)
 *   ▸ Metadata register (Apple-style key/value pairs, rounded)
 *   ▸ Status footer (status + cycle countdown + acceptance counts)
 */

const OPERATOR_CYCLE_MS = 15_000;
const SPINNER_FRAMES = ["\\", "|", "/", "—"] as const;

export function OperatorCard({
  policy,
  actions,
}: {
  policy: OperatorPolicyDecoded;
  actions: DecodedWorkObject[];
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const latestAction = actions[0];
  const state = deriveOperatorState(policy, latestAction, now);
  const tone = operatorStateTone(state);
  const counts = countOperatorActions(actions);
  const rejections = actions.filter((a) => a.kind === "Rejection").length;
  const latestPayload = decodeOperatorPayload(latestAction);
  const posture = latestPayload?.memory_context?.posture ?? "neutral";
  const lastActionMs = latestAction ? Number(latestAction.timestampMs) : null;
  const untilNextScan = secondsUntilNextScan(
    policy,
    lastActionMs,
    OPERATOR_CYCLE_MS,
    now,
  );
  const remaining = policy.budgetCap - policy.spent;
  const spentPct =
    policy.budgetCap > 0n
      ? Math.min(
          100,
          Math.round((Number(policy.spent) / Number(policy.budgetCap)) * 100),
        )
      : 0;

  return (
    <section
      className={`relative rounded-2xl border bg-bg-elev p-6 sm:p-8 ${
        tone === "kill" ? "border-red-200" : "border-line"
      }`}
    >
      {/* Status strip — small pulse + state label + time-since-grant */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusPulse tone={tone} />
          <span
            className={`text-[11px] font-medium uppercase tracking-[0.14em] ${
              tone === "kill"
                ? "text-red-600"
                : tone === "ended"
                  ? "text-muted"
                  : "text-emerald-600"
            }`}
          >
            {OPERATOR_STATE_LABEL[state]}
          </span>
          {(state === "scanning" || state === "online") && untilNextScan > 0 ? (
            <span className="text-[11.5px] tabular-nums text-muted">
              next cycle in {untilNextScan}s
            </span>
          ) : null}
        </div>
        <p className="text-[11.5px] text-muted">
          granted {formatRelative(policy.createdAtMs)}
        </p>
      </div>

      {/* Operator name — primary identity */}
      <h1 className="mt-5 text-[28px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[32px]">
        {policy.name}
      </h1>

      {/* Mandate quote with soft left border */}
      <MissionLine policyId={policy.id} />

      {/* Metadata register — Kyvern-style key/value grid */}
      <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Row
          label="Policy"
          value={
            <a
              href={explorerUrl("object", policy.id)}
              target="_blank"
              rel="noreferrer"
              className="text-ink hover:underline"
            >
              {short(policy.id)} ↗
            </a>
          }
        />
        <Row
          label="Bound agent"
          value={
            <a
              href={`https://suiscan.xyz/testnet/account/${policy.agent}`}
              target="_blank"
              rel="noreferrer"
              className="text-ink hover:underline"
            >
              {short(policy.agent)} ↗
            </a>
          }
        />
        <Row
          label="Budget"
          value={
            <>
              <span className="text-ink">{formatSui(policy.budgetCap)}</span>{" "}
              <span className="text-muted">SUI</span>
            </>
          }
        />
        <Row
          label="Spent"
          value={
            <>
              <span className="text-ink">{formatSui(policy.spent)}</span>{" "}
              <span className="text-muted">SUI · {spentPct}%</span>
            </>
          }
        />
        <Row
          label="Remaining"
          value={
            <>
              <span className="text-ink">{formatSui(remaining)}</span>{" "}
              <span className="text-muted">SUI</span>
            </>
          }
        />
        <Row
          label="Max per venue"
          value={
            <span className="text-ink">
              {(policy.maxConcentrationBps / 100).toFixed(0)}%{" "}
              <span className="text-muted">of budget</span>
            </span>
          }
        />
        <Row
          label="Risk"
          value={
            <span className="text-ink capitalize">{policy.riskTolerance}</span>
          }
        />
        <Row
          label="Posture"
          value={<span className="text-ink capitalize">{posture}</span>}
        />
      </div>

      {/* Footer — typewriter spinner + enforcement evidence */}
      <div className="mt-7 flex flex-wrap items-baseline justify-between gap-3 border-t border-line pt-4">
        <TypewriterStatus tone={tone} />
        <p className="text-[12px] tabular-nums text-ink-2">
          <span className="text-ink">{counts.deployed}</span>{" "}
          <span className="text-muted">accepted</span>
          {rejections > 0 ? (
            <>
              <span className="mx-2 text-muted-2">·</span>
              <span className="text-red-600">{rejections}</span>{" "}
              <span className="text-red-600">rejected</span>
            </>
          ) : null}
          {counts.paused > 0 ? (
            <>
              <span className="mx-2 text-muted-2">·</span>
              <span className="text-amber-600">{counts.paused}</span>{" "}
              <span className="text-amber-600">held</span>
            </>
          ) : null}
        </p>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        Filed under{" "}
        <code className="font-mono text-[10.5px] text-ink-2">
          brief::operator_policy
        </code>{" "}
        @ {short(BRIEF_PACKAGE_ID)} · cycles each 15 s
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function MissionLine({ policyId }: { policyId: string }) {
  const { objective, loading } = useObjective(policyId);
  if (loading || !objective) return null;
  return (
    <div className="mt-3 max-w-prose border-l-2 border-line pl-4">
      <p className="text-[15px] italic leading-[1.55] text-ink-2">
        &ldquo;{objective}&rdquo;
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-subtle pb-2">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="text-right text-[13px] tabular-nums">{value}</dd>
    </div>
  );
}

function StatusPulse({ tone }: { tone: "live" | "ended" | "kill" }) {
  const color =
    tone === "kill"
      ? "bg-red-500"
      : tone === "ended"
        ? "bg-muted-2"
        : "bg-emerald-500";
  const animate = tone === "live";
  return (
    <span className="relative inline-flex h-2 w-2" aria-hidden>
      {animate ? (
        <span
          className={`absolute inset-0 inline-flex h-full w-full animate-ping rounded-full ${color} opacity-50`}
        />
      ) : null}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

function TypewriterStatus({ tone }: { tone: "live" | "ended" | "kill" }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (tone !== "live") return;
    const id = setInterval(
      () => setTick((t) => (t + 1) % SPINNER_FRAMES.length),
      220,
    );
    return () => clearInterval(id);
  }, [tone]);
  const glyph = tone === "live" ? SPINNER_FRAMES[tick] : tone === "kill" ? "✕" : "·";
  return (
    <p className="font-mono text-[11.5px] tabular-nums text-muted">
      <span className="inline-block w-3 text-center">{glyph}</span>{" "}
      <span className="ml-1 text-ink-2">running</span>
    </p>
  );
}

// ---------------------------------------------------------------------------

type OperatorPayloadLite = {
  status?: "deployed" | "awaiting_gas_funding";
  memory_context?: { posture?: string };
};

function decodeOperatorPayload(
  action: DecodedWorkObject | undefined,
): OperatorPayloadLite | null {
  if (!action || !action.payloadBytes) return null;
  try {
    return JSON.parse(
      new TextDecoder().decode(action.payloadBytes),
    ) as OperatorPayloadLite;
  } catch {
    return null;
  }
}

function countOperatorActions(actions: DecodedWorkObject[]): {
  deployed: number;
  paused: number;
} {
  let deployed = 0;
  let paused = 0;
  for (const a of actions) {
    if (a.kind !== "Operator") continue;
    const p = decodeOperatorPayload(a);
    if (p?.status === "awaiting_gas_funding") paused++;
    else deployed++;
  }
  return { deployed, paused };
}

function short(addr: string): string {
  if (!addr || addr === "0x0") return "—";
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

export { BRIEF_OPERATOR_ADDRESS };
