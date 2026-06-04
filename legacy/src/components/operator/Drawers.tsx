"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  formatCountdown,
  formatRelative,
  formatSui,
  mistToSui,
  policyStatus,
  type OperatorPolicyDecoded,
} from "@/lib/operator-policy-client";
import type { DecodedWorkObject } from "@/lib/work-object";
import { EMPTY, SECTION } from "@/lib/operator-language";

/**
 * Drawers — Level-2 analytics, collapsed by default.
 *
 * Constraints / Deployment / Performance / History each get a card with
 * a one-line summary visible at all times, and a detailed panel that
 * expands inline on click. This replaces the always-visible analytics
 * row that made the dashboard read as a portfolio-analytics app.
 */

type OperatorActionPayload = {
  venue?: string;
  amount_mist?: string;
  expected_yield_bps?: number;
  status?: "deployed" | "awaiting_gas_funding";
  execution_mode?: "deepbook" | "stake";
  mode?: string;
  memory_context?: {
    posture?: string;
    average_confidence?: number;
    total_actions?: number;
    rejected_attempts?: number;
    consecutive_holds?: number;
    consecutive_rejections?: number;
    recent_venues?: string[];
    hydrated?: boolean;
  };
  world_state?: { regime?: string; caption?: string };
};

type DrawerProps = {
  policy: OperatorPolicyDecoded;
  actions: DecodedWorkObject[];
  payloads: Map<string, OperatorActionPayload>;
  pastPolicies: OperatorPolicyDecoded[];
};

export function Drawers(props: DrawerProps) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
      <ConstraintsDrawer policy={props.policy} />
      <DeploymentDrawer
        policy={props.policy}
        actions={props.actions}
        payloads={props.payloads}
      />
      <MemoryDrawer actions={props.actions} payloads={props.payloads} />
      <HistoryDrawer
        pastPolicies={props.pastPolicies}
        workObjects={props.actions}
        payloads={props.payloads}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer shell
// ---------------------------------------------------------------------------

function Drawer({
  label,
  summary,
  children,
  defaultOpen = false,
}: {
  label: string;
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-[14px] border border-line bg-bg-elev">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-bg"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {label}
          </p>
          <p className="mt-1.5 truncate text-[13px] text-ink">{summary}</p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={1.5}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-line px-4 py-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Constraints drawer
// ---------------------------------------------------------------------------

function ConstraintsDrawer({ policy }: { policy: OperatorPolicyDecoded }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const expiresInMs = Math.max(0, Number(policy.expiresAtMs) - now);
  const summary = `${policy.allowedVenues.length} venues · max ${(policy.maxConcentrationBps / 100).toFixed(0)}% · auto ${policy.autoApprovePct}%`;

  return (
    <Drawer label={SECTION.envelope} summary={summary}>
      <div className="space-y-3">
        <Row
          label="Venues"
          value={policy.allowedVenues.join(" · ")}
        />
        <Row
          label="Max single position"
          value={`${(policy.maxConcentrationBps / 100).toFixed(0)}%`}
        />
        <Row
          label="Auto-approve threshold"
          value={`under ${policy.autoApprovePct}% of remaining`}
        />
        <Row
          label="Expiry"
          value={expiresInMs > 0 ? formatCountdown(policy.expiresAtMs) : "passed"}
        />
        <Row label="Risk tolerance" value={policy.riskTolerance} />
        <p className="mt-2 text-[12px] leading-[1.55] text-muted">
          Every constraint is checked by{" "}
          <code className="font-mono">assert_can_spend</code> in the same
          PTB as the trade. Violations abort the whole transaction
          on-chain — no off-chain trust required.
        </p>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Deployment drawer — the allocation donut, demoted
// ---------------------------------------------------------------------------

function DeploymentDrawer({
  policy,
  actions,
  payloads,
}: {
  policy: OperatorPolicyDecoded;
  actions: DecodedWorkObject[];
  payloads: Map<string, OperatorActionPayload>;
}) {
  const alloc = useMemo(
    () => computeAllocation(actions, payloads),
    [actions, payloads],
  );
  const totalSpent = alloc.reduce((s, a) => s + a.amountMist, 0n);
  const summary =
    alloc.length === 0
      ? "no capital deployed yet"
      : alloc
          .slice(0, 3)
          .map(
            (a) =>
              `${Math.round(
                (Number(a.amountMist) / Number(totalSpent || 1n)) * 100,
              )}% ${a.name}`,
          )
          .join(" · ");

  return (
    <Drawer label={SECTION.deployment} summary={summary}>
      {alloc.length === 0 ? (
        <p className="text-[12.5px] text-muted">{EMPTY.noDeployedCapital}</p>
      ) : (
        <div className="flex items-center gap-5">
          <Donut allocations={alloc} total={totalSpent} />
          <div className="grow space-y-2">
            {alloc.map((a, i) => {
              const pct =
                Number(a.amountMist) / Number(totalSpent || 1n);
              return (
                <div
                  key={a.name}
                  className="flex items-center justify-between gap-3 font-mono text-[11px]"
                >
                  <div className="flex items-center gap-2 text-ink">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                    />
                    <span>{a.name}</span>
                  </div>
                  <span className="tabular-nums text-ink-2">
                    {(pct * 100).toFixed(0)}% &middot;{" "}
                    {mistToSui(a.amountMist).toFixed(2)} SUI
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="mt-4 text-[12px] leading-[1.55] text-muted">
        Single-position cap ·{" "}
        {(policy.maxConcentrationBps / 100).toFixed(0)}% enforced by{" "}
        <code className="font-mono">assert_can_spend</code>.
      </p>
    </Drawer>
  );
}

const DONUT_COLORS = ["#1a2c4e", "#2c3e5f", "#15803D", "#6b7888", "#9333ea"];

function Donut({
  allocations,
  total,
}: {
  allocations: { name: string; amountMist: bigint }[];
  total: bigint;
}) {
  if (total === 0n) return null;
  const r = 32;
  const stroke = 12;
  const circumference = 2 * Math.PI * r;
  let cumulative = 0;
  return (
    <svg width={88} height={88} viewBox="0 0 88 88" className="shrink-0">
      <g transform="translate(44,44) rotate(-90)">
        {allocations.map((a, i) => {
          const frac = Number(a.amountMist) / Number(total);
          const dash = `${frac * circumference} ${circumference}`;
          const dashoffset = -cumulative * circumference;
          cumulative += frac;
          return (
            <circle
              key={a.name}
              r={r}
              fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth={stroke}
              strokeDasharray={dash}
              strokeDashoffset={dashoffset}
            />
          );
        })}
      </g>
      <text
        x="44"
        y="42"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="JetBrains Mono, monospace"
        fontSize="12"
        fontWeight="600"
        fill="#1a2c4e"
      >
        {mistToSui(total).toFixed(2)}
      </text>
      <text
        x="44"
        y="56"
        textAnchor="middle"
        fontFamily="JetBrains Mono, monospace"
        fontSize="7"
        fill="#6b7888"
      >
        SUI
      </text>
    </svg>
  );
}

function computeAllocation(
  actions: DecodedWorkObject[],
  payloads: Map<string, OperatorActionPayload>,
): { name: string; amountMist: bigint }[] {
  const map = new Map<string, bigint>();
  for (const a of actions) {
    if (a.kind !== "Operator") continue;
    const p = payloads.get(a.id);
    if (!p) continue;
    // Paused WOs do not represent deployed capital.
    if (p.status === "awaiting_gas_funding") continue;
    const amount = BigInt(p.amount_mist ?? "0");
    const venue = p.venue ?? "Unknown";
    map.set(venue, (map.get(venue) ?? 0n) + amount);
  }
  return Array.from(map.entries())
    .map(([name, amountMist]) => ({ name, amountMist }))
    .sort((a, b) => Number(b.amountMist - a.amountMist));
}

// ---------------------------------------------------------------------------
// Memory drawer — operator profile, hydration status, posture, recent venues
// ---------------------------------------------------------------------------

function MemoryDrawer({
  actions,
  payloads,
}: {
  actions: DecodedWorkObject[];
  payloads: Map<string, OperatorActionPayload>;
}) {
  // Read the most recent Operator action's memory_context — it's the
  // freshest snapshot of the agent's running profile.
  const latest = useMemo(() => {
    for (const a of actions) {
      if (a.kind !== "Operator") continue;
      const p = payloads.get(a.id);
      if (p?.memory_context) return p.memory_context;
    }
    return undefined;
  }, [actions, payloads]);

  if (!latest) {
    return (
      <Drawer
        label="OPERATOR MEMORY"
        summary="no profile yet — awaiting first cycle"
      >
        <p className="text-[12.5px] text-muted">
          The operator&rsquo;s running profile appears here after the first
          decision lands on-chain. Hydration replays past actions on restart
          so the profile persists.
        </p>
      </Drawer>
    );
  }

  const postureLabel = (latest.posture ?? "neutral").toUpperCase();
  const confPct = Math.round((latest.average_confidence ?? 0.5) * 100);
  const recent = latest.recent_venues ?? [];
  const summary = `${postureLabel} · avg confidence ${confPct}%`;

  return (
    <Drawer label="OPERATOR MEMORY" summary={summary}>
      <div className="space-y-3">
        <Row label="Posture" value={postureLabel.toLowerCase()} />
        <Row
          label="Average confidence"
          value={`${confPct}% (rolling)`}
        />
        <Row
          label="Cycles completed"
          value={`${latest.total_actions ?? 0} actions · ${latest.consecutive_holds ?? 0} consecutive holds`}
        />
        <Row
          label="Chain rejections"
          value={`${latest.rejected_attempts ?? 0}${
            (latest.consecutive_rejections ?? 0) > 0
              ? ` · ${latest.consecutive_rejections} in a row`
              : ""
          }`}
        />
        {recent.length > 0 ? (
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted">
              Recent venues
            </p>
            <p className="text-right text-[12.5px] text-ink-2">
              {recent.join(" · ")}
            </p>
          </div>
        ) : null}
        <p className="mt-2 text-[12px] leading-[1.55] text-muted">
          {latest.hydrated
            ? "Profile reconstructed from chain history on attach — the operator picks up where the prior process left off."
            : "Profile reflects in-process state. On restart the agent rehydrates from past WorkObjects."}
        </p>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Performance drawer — kept available for callers that still want PnL.
// Currently unused in the default lineup (replaced by MemoryDrawer) but
// retained so we can A/B back later without rewriting the component.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function PerformanceDrawer({
  policy,
  actions,
  payloads,
}: {
  policy: OperatorPolicyDecoded;
  actions: DecodedWorkObject[];
  payloads: Map<string, OperatorActionPayload>;
}) {
  const stats = useMemo(
    () => computeStats(actions, payloads),
    [actions, payloads],
  );
  const gainSui = mistToSui(stats.expectedGainMist);
  const deployedSui = mistToSui(stats.totalDeployedMist);
  const returnPct = deployedSui > 0 ? (gainSui / deployedSui) * 100 : 0;
  const summary =
    stats.actionCount === 0
      ? "no positions yet"
      : `${gainSui >= 0 ? "+" : ""}${gainSui.toFixed(4)} SUI · ${returnPct.toFixed(2)}% projected`;

  return (
    <Drawer label={SECTION.performance} summary={summary}>
      {stats.actionCount === 0 ? (
        <p className="text-[12.5px] text-muted">
          Return profile appears here once positions are open.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline gap-3">
            <p className="text-[26px] font-semibold tabular-nums tracking-tight text-ink">
              {gainSui >= 0 ? "+" : ""}
              {gainSui.toFixed(4)}
            </p>
            <p className="text-[13px] text-ink-2">SUI projected</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="return" value={`${returnPct.toFixed(2)}%`} />
            <Stat label="deployed" value={`${deployedSui.toFixed(2)} SUI`} />
            <Stat
              label="enforced"
              value={`${stats.actionCount}/${stats.actionCount}`}
            />
          </div>
          <p className="text-[12px] leading-[1.55] text-muted">
            {stats.deepbookCount} of {stats.actionCount} action
            {stats.actionCount === 1 ? "" : "s"} settled via live DeepBook;
            the remainder via real Sui System validator stakes. The
            operator never falls back to a simulated trade — when the
            wallet runs short of gas, a paused cycle is recorded instead.
          </p>
        </div>
      )}
    </Drawer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-bg px-3 py-2">
      <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted">
        {label}
      </p>
      <p className="mt-1 text-[13px] font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted">
        {label}
      </p>
      <p className="text-[13px] text-ink-2">{value}</p>
    </div>
  );
}

function computeStats(
  actions: DecodedWorkObject[],
  payloads: Map<string, OperatorActionPayload>,
) {
  let totalDeployedMist = 0n;
  let expectedGainMist = 0n;
  let deepbookCount = 0;
  let count = 0;
  for (const a of actions) {
    if (a.kind !== "Operator") continue;
    const p = payloads.get(a.id);
    // Skip audit-only paused WOs — they don't move capital.
    if (p?.status === "awaiting_gas_funding") continue;
    count++;
    if (!p) continue;
    const amount = BigInt(p.amount_mist ?? "0");
    totalDeployedMist += amount;
    const bps = BigInt(Math.floor(p.expected_yield_bps ?? 0));
    expectedGainMist += (amount * bps) / 10000n;
    const mode = p.execution_mode ?? p.mode;
    if (mode === "deepbook") deepbookCount++;
  }
  return {
    totalDeployedMist,
    expectedGainMist,
    deepbookCount,
    actionCount: count,
  };
}

// ---------------------------------------------------------------------------
// History drawer
// ---------------------------------------------------------------------------

function HistoryDrawer({
  pastPolicies,
  workObjects,
  payloads,
}: {
  pastPolicies: OperatorPolicyDecoded[];
  workObjects: DecodedWorkObject[];
  payloads: Map<string, OperatorActionPayload>;
}) {
  const summary =
    pastPolicies.length === 0
      ? EMPTY.noPriorOperators.toLowerCase().replace(".", "")
      : `${pastPolicies.length} prior operator${pastPolicies.length === 1 ? "" : "s"}`;

  // Most recent terminated policy — used to surface the "last termination"
  // scar at the top of the drawer. Each operator in history is mortal.
  const lastTerminated = useMemo(() => {
    const candidates = pastPolicies.filter(
      (p) => p.revoked || Date.now() >= Number(p.expiresAtMs) || p.spent >= p.budgetCap,
    );
    if (candidates.length === 0) return null;
    const sorted = [...candidates].sort(
      (a, b) => Number(b.createdAtMs) - Number(a.createdAtMs),
    );
    return sorted[0]!;
  }, [pastPolicies]);

  return (
    <Drawer label={SECTION.history} summary={summary}>
      {lastTerminated ? (
        <LastTermination
          policy={lastTerminated}
          workObjects={workObjects}
          payloads={payloads}
        />
      ) : null}

      {pastPolicies.length === 0 ? (
        <p className="text-[12.5px] text-muted">
          {EMPTY.noPriorOperators} When you revoke or let an operator
          expire, it appears here for audit.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {pastPolicies.map((p) => {
            const status = policyStatus(p);
            const actionCount = workObjects.filter(
              (w) =>
                (w.kind === "Operator" || w.kind === "Rejection") &&
                w.parentIds.includes(p.id),
            ).length;
            return (
              <li key={p.id} className="flex items-baseline gap-3 py-2.5">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.18em] ${
                    status === "revoked"
                      ? "bg-red-50 text-red-700"
                      : "bg-bg text-muted"
                  }`}
                >
                  {status === "revoked" ? "decommissioned" : status}
                </span>
                <span className="grow truncate text-[13px] text-ink">
                  {p.name}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted">
                  {actionCount} actions
                </span>
                <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted">
                  {formatRelative(p.createdAtMs)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}

function LastTermination({
  policy,
  workObjects,
  payloads,
}: {
  policy: OperatorPolicyDecoded;
  workObjects: DecodedWorkObject[];
  payloads: Map<string, OperatorActionPayload>;
}) {
  // Reconstruct minimal scar metadata from the past policy's actions.
  const actions = useMemo(
    () =>
      workObjects.filter(
        (w) =>
          (w.kind === "Operator" || w.kind === "Rejection") &&
          w.parentIds.includes(policy.id),
      ),
    [workObjects, policy.id],
  );
  const lastOp = actions
    .filter((a) => a.kind === "Operator")
    .sort((a, b) => Number(b.timestampMs - a.timestampMs))[0];
  const lastOpPayload = lastOp ? payloads.get(lastOp.id) : null;
  const lastVenue = lastOpPayload?.venue ?? "—";
  const cycles = lastOpPayload?.memory_context?.total_actions ?? actions.length;

  const status = policyStatus(policy);
  const label =
    status === "revoked"
      ? "mandate terminated"
      : status === "expired"
        ? "expiry reached"
        : status === "exhausted"
          ? "budget exhausted"
          : "stood down";

  return (
    <div className="mb-4 rounded-[10px] border border-red-100 bg-red-50/40 p-3">
      <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-red-700">
        last termination
      </p>
      <p className="mt-1.5 text-[13px] font-medium text-ink">{policy.name}</p>
      <p className="mt-1 font-mono text-[10.5px] tabular-nums text-muted">
        {label} · {cycles} cycles · last venue {lastVenue} ·{" "}
        {formatSui(policy.spent)} SUI deployed
      </p>
    </div>
  );
}
