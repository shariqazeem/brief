"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Copy } from "lucide-react";
import { explorerUrl } from "@/lib/brief-client";
import {
  BRIEF_OPERATOR_ADDRESS,
  formatSui,
  type OperatorPolicyDecoded,
} from "@/lib/operator-policy-client";
import type { DecodedWorkObject } from "@/lib/work-object";
import {
  OPERATOR_STATE_COPY,
  REJECTION_REASON,
} from "@/lib/operator-language";
import {
  deriveOperatorState,
  secondsUntilNextScan,
  type OperatorState,
} from "@/lib/operator-state";
import {
  signalProvenanceLine,
  type MarketSnapshotPayload,
  type VenueSignalPayload,
} from "@/lib/market-state";

/**
 * ActivityStream — Chronological Audit Ledger.
 *
 * Recast from a card-list into a strict tabular register. Reads as an
 * institutional settlement ledger: monospace columns, hairline rules,
 * absolute alignment.
 *
 * Columns: § · TIMESTAMP · EVENT TYPE · VENUE · AMOUNT · TX DIGEST · STATUS.
 * Each row expands into a "DeFi Execution Manifest" — a structured table
 * of Real Balance Changes derived from the action's payload (stake:
 * SUI→StakedSUI 1:1; deepbook: SUI→DBUSDC at the cached fill price;
 * rejection: blocked + Move abort code cited).
 *
 * Special states are surfaced ABOVE the table:
 *   - SECURITY NOTICE banner when the latest cycle was held for gas
 *   - Live-cycle strip when the operator is scanning between cycles
 *   - Stood-down marker when the operator has been revoked / expired
 */

const OPERATOR_CYCLE_MS = 15_000;
const STALE_OVERDUE_SEC = 6;
/** Default visible rows in the ledger — keeps the page tight when a
 *  long-running operator accrues dozens of entries. The footer shows a
 *  "Show all" affordance when there's more. */
const DEFAULT_VISIBLE_ROWS = 12;

type OperatorActionPayload = {
  venue?: string;
  amount_mist?: string;
  rationale?: string;
  expected_yield_bps?: number;
  mode?: string;
  fill?: {
    pool?: string;
    side_in?: string;
    side_out?: string;
    amount_in?: string;
    amount_out?: string;
    price?: number;
  };
  reason?: string;
  error?: string;
  score?: number;
  confidence?: number;
  evaluated?: { venue: string; score: number }[];
  concentration_pct_after?: number;
  status?: "deployed" | "awaiting_gas_funding";
  execution_mode?: "deepbook" | "stake";
  execution_meta?: {
    kind?: "deepbook" | "stake";
    pool_key?: string;
    balance_manager_id?: string;
    client_order_id?: string;
    validator_address?: string;
    validator_apy?: number;
    validator_source?: "rpc" | "env" | "cache";
  };
  gas_check?: {
    free_mist?: string;
    required_mist?: string;
    deficit_mist?: string;
    headroom_mist?: string;
    checked_at_ms?: number;
  };
  gas_shortage_mist?: string;
  paused_at_ms?: number;
  components?: {
    liquidity?: number;
    yield?: number;
    execution?: number;
    policy?: number;
  };
  market_snapshot?: MarketSnapshotPayload;
  world_state?: { regime?: string; caption?: string };
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
  objective?: string | null;
  posture?: string;
  mission_alignment?: string;
  confidence_regime?: string;
};

const REJECTION_REASON_COPY: Record<string, string> = Object.fromEntries(
  Object.entries(REJECTION_REASON).map(([k, v]) => [k, v.long]),
);

const ABORT_CODE_BY_REASON: Record<string, { code: number; name: string }> = {
  not_agent: { code: 2, name: "ENotAgent" },
  revoked: { code: 3, name: "EPolicyRevoked" },
  expired: { code: 4, name: "EPolicyExpired" },
  budget_exceeded: { code: 5, name: "EBudgetExceeded" },
  venue_not_allowed: { code: 6, name: "EVenueNotAllowed" },
  unknown_policy_abort: { code: 0, name: "UnknownPolicyAbort" },
};

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export function ActivityStream({
  actions,
  policy,
  payloads,
}: {
  actions: DecodedWorkObject[];
  policy: OperatorPolicyDecoded;
  payloads: Map<string, OperatorActionPayload>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => [...actions].sort((a, b) => Number(b.timestampMs - a.timestampMs)),
    [actions],
  );
  const visible = expanded ? sorted : sorted.slice(0, DEFAULT_VISIBLE_ROWS);
  const hiddenCount = Math.max(0, sorted.length - visible.length);
  const latestAction = sorted[0];
  const latestPayload = latestAction
    ? payloads.get(latestAction.id) ?? null
    : null;
  const state = deriveOperatorState(policy, latestAction, now);
  const isLive =
    state === "online" || state === "scanning" || state === "deploying";
  const isTerminal =
    state === "revoked" ||
    state === "expired" ||
    state === "exhausted" ||
    state === "blocked";

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const heldForGas = latestPayload?.status === "awaiting_gas_funding";

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-medium text-ink">Activity</h2>
        <p className="text-[12px] text-muted tabular-nums">
          <span className="text-ink-2">{sorted.length}</span> entries
        </p>
      </header>

      {/* The held-for-gas banner is rendered above by the OperatorConsole
          (page.tsx) — no duplicate inside the activity stream. */}

      {/* Live cycle strip — shows scanning state + countdown while the
          operator is between cycles. Stays out of the ledger so the
          row count stays honest. */}
      {isLive && !heldForGas ? (
        <LiveCycleStrip
          policy={policy}
          state={state}
          latestAction={latestAction}
          latestPayload={latestPayload}
          now={now}
        />
      ) : null}

      {/* Stood-down marker — terminal-state banner shown above the
          historical ledger. */}
      {isTerminal ? <StoodDownNotice state={state} /> : null}

      {/* THE LEDGER TABLE */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-bg-elev">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line">
              <LedgerHeading width="w-[14px]" />
              <LedgerHeading>Time</LedgerHeading>
              <LedgerHeading>Event</LedgerHeading>
              <LedgerHeading>Venue</LedgerHeading>
              <LedgerHeading className="text-right">Amount</LedgerHeading>
              <LedgerHeading>Tx</LedgerHeading>
              <LedgerHeading className="text-right">Status</LedgerHeading>
              <LedgerHeading width="w-[24px]" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <EmptyLedgerRow />
            ) : (
              visible.map((a) => (
                <LedgerRow
                  key={a.id}
                  action={a}
                  payload={payloads.get(a.id) ?? null}
                />
              ))
            )}
            {hiddenCount > 0 ? (
              <tr className="border-t border-line/60 bg-bg/40">
                <td className="px-3 py-3" />
                <td colSpan={7} className="px-3 py-3 text-center">
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-ink-2 transition-colors hover:text-ink"
                  >
                    Show all <span className="tabular-nums">{sorted.length}</span> entries
                    <span aria-hidden>▾</span>
                  </button>
                </td>
              </tr>
            ) : expanded && sorted.length > DEFAULT_VISIBLE_ROWS ? (
              <tr className="border-t border-line/60 bg-bg/40">
                <td className="px-3 py-3" />
                <td colSpan={7} className="px-3 py-3 text-center">
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-ink-2 transition-colors hover:text-ink"
                  >
                    Collapse to {DEFAULT_VISIBLE_ROWS} most recent
                    <span aria-hidden>▴</span>
                  </button>
                </td>
              </tr>
            ) : null}
            <GrantLedgerRow policy={policy} />
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-muted">
        Click any row to inspect its execution manifest.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Header cell
// ---------------------------------------------------------------------------

function LedgerHeading({
  children,
  className = "",
  width,
}: {
  children?: React.ReactNode;
  className?: string;
  width?: string;
}) {
  return (
    <th
      className={`${width ?? ""} px-3 py-3 text-left text-[11px] font-medium text-muted ${className}`}
      scope="col"
    >
      {children}
    </th>
  );
}

// ---------------------------------------------------------------------------
// Ledger row dispatcher
// ---------------------------------------------------------------------------

function LedgerRow({
  action,
  payload,
}: {
  action: DecodedWorkObject;
  payload: OperatorActionPayload | null;
}) {
  const [open, setOpen] = useState(false);
  const isRejection = action.kind === "Rejection";
  const isHeld = payload?.status === "awaiting_gas_funding";

  const eventLabel = isRejection
    ? "CHAIN ABORTED"
    : isHeld
      ? "HELD FOR GAS"
      : payload?.execution_mode === "stake"
        ? "VALIDATOR STAKE"
        : payload?.execution_mode === "deepbook"
          ? "DEEPBOOK ORDER"
          : "OPERATOR ACTION";

  const venue = payload?.venue ?? "—";
  const amountMist = BigInt(payload?.amount_mist ?? "0");
  const statusLabel = isRejection
    ? "rejected"
    : isHeld
      ? "paused"
      : "accepted";
  const rowTextColor = isRejection
    ? "text-red-700"
    : isHeld
      ? "text-amber-700"
      : "text-ink";

  return (
    <>
      <tr
        className={`border-b border-line/60 transition-colors hover:bg-bg/40 ${
          isRejection ? "bg-red-50/20" : isHeld ? "bg-amber-50/20" : ""
        }`}
      >
        <td className="px-3 py-3 align-baseline">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isRejection
                ? "bg-red-600"
                : isHeld
                  ? "bg-amber-600"
                  : "bg-ink"
            }`}
            aria-hidden
          />
        </td>
        <td className="px-3 py-3 align-baseline text-[12px] tabular-nums text-ink-2">
          {formatLedgerTime(action.timestampMs)}
        </td>
        <td className={`px-3 py-3 align-baseline text-[10.5px] uppercase tracking-[0.24em] ${rowTextColor}`}>
          {eventLabel}
        </td>
        <td className="px-3 py-3 align-baseline text-[12px] text-ink-2">
          {venue}
        </td>
        <td className="px-3 py-3 align-baseline text-right text-[12px] tabular-nums text-ink">
          {amountMist > 0n ? (
            <>
              <span className={isRejection ? "text-red-700" : isHeld ? "text-amber-700" : ""}>
                {isHeld ? "—" : isRejection ? "—" : formatSui(amountMist)}
              </span>{" "}
              <span className="text-muted">SUI</span>
            </>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        <td className="px-3 py-3 align-baseline text-[11px] text-ink-2">
          <a
            href={explorerUrl("object", action.id)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-ink-2 hover:text-ink hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {action.id.slice(0, 8)}…{action.id.slice(-4)}
            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
          </a>
        </td>
        <td className="px-3 py-3 align-baseline text-right text-[10.5px] uppercase tracking-[0.18em]">
          <span className={rowTextColor}>{statusLabel}</span>
        </td>
        <td className="px-3 py-3 align-baseline text-right">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-muted hover:text-ink"
            aria-expanded={open}
            aria-label={open ? "Collapse manifest" : "Expand manifest"}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              strokeWidth={1.75}
            />
          </button>
        </td>
      </tr>
      {open ? (
        <tr className={isRejection ? "bg-red-50/15" : isHeld ? "bg-amber-50/15" : "bg-bg/40"}>
          <td colSpan={8} className="px-0">
            <DefiExecutionManifest
              action={action}
              payload={payload}
              isRejection={isRejection}
              isHeld={isHeld}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty + Grant ledger rows
// ---------------------------------------------------------------------------

function EmptyLedgerRow() {
  return (
    <tr className="border-b border-line/60">
      <td className="px-3 py-6" />
      <td
        colSpan={7}
        className="px-3 py-6 text-center font-mono text-[10.5px] uppercase tracking-[0.32em] text-muted"
      >
        Ledger awaiting first entry — operator&rsquo;s first cycle pending.
      </td>
    </tr>
  );
}

function GrantLedgerRow({ policy }: { policy: OperatorPolicyDecoded }) {
  return (
    <tr className="border-t border-ink/30 bg-bg-elev/60">
      <td className="px-3 py-3 align-baseline">
        <span className="inline-block h-2 w-2 rounded-full bg-ink" aria-hidden />
      </td>
      <td className="px-3 py-3 align-baseline text-[12px] tabular-nums text-ink-2">
        {formatLedgerTime(policy.createdAtMs)}
      </td>
      <td className="px-3 py-3 align-baseline text-[10.5px] uppercase tracking-[0.24em] text-ink">
        Mandate granted
      </td>
      <td className="px-3 py-3 align-baseline text-[12px] text-ink-2">
        {policy.allowedVenues.length} venues
      </td>
      <td className="px-3 py-3 align-baseline text-right text-[12px] tabular-nums text-ink">
        <span>{formatSui(policy.budgetCap)}</span>{" "}
        <span className="text-muted">SUI envelope</span>
      </td>
      <td className="px-3 py-3 align-baseline text-[11px] text-ink-2">
        <a
          href={explorerUrl("object", policy.id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-ink-2 hover:text-ink hover:underline"
        >
          {policy.id.slice(0, 8)}…{policy.id.slice(-4)}
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
        </a>
      </td>
      <td className="px-3 py-3 align-baseline text-right text-[10.5px] uppercase tracking-[0.18em] text-ink">
        granted
      </td>
      <td className="px-3 py-3 align-baseline" />
    </tr>
  );
}

// ---------------------------------------------------------------------------
// DeFi Execution Manifest — the expanded panel
// ---------------------------------------------------------------------------

function DefiExecutionManifest({
  action,
  payload,
  isRejection,
  isHeld,
}: {
  action: DecodedWorkObject;
  payload: OperatorActionPayload | null;
  isRejection: boolean;
  isHeld: boolean;
}) {
  return (
    <div className="border-t border-line/70 px-3 py-5 sm:px-5 sm:py-6">
      <p className="font-mono text-[9.5px] uppercase tracking-[0.36em] text-muted">
        DeFi Execution Manifest
      </p>
      <div className="mt-3 h-px bg-line-strong" />
      <div className="mt-1 h-px bg-line-strong" />

      <div className="mt-5 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <BalanceChangesPanel
          payload={payload}
          isRejection={isRejection}
          isHeld={isHeld}
        />
        <ProvenancePanel
          action={action}
          payload={payload}
          isRejection={isRejection}
          isHeld={isHeld}
        />
      </div>

      {payload?.rationale && !isHeld ? (
        <div className="mt-6 border-l-2 border-line pl-4">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.32em] text-muted">
            Rationale of record
          </p>
          <p className={`mt-1 font-sans text-[13px] italic leading-[1.55] ${isRejection ? "text-red-800" : "text-ink-2"}`}>
            &ldquo;{payload.rationale}&rdquo;
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Balance Changes — real numbers, real labels.
// ---------------------------------------------------------------------------

function BalanceChangesPanel({
  payload,
  isRejection,
  isHeld,
}: {
  payload: OperatorActionPayload | null;
  isRejection: boolean;
  isHeld: boolean;
}) {
  type Row = { label: string; value: string; tone?: "neg" | "pos" | "muted" };
  const rows: Row[] = [];

  if (isHeld) {
    rows.push({ label: "Capital moved", value: "0.000 SUI", tone: "muted" });
    const deficitMist = BigInt(payload?.gas_check?.deficit_mist ?? payload?.gas_shortage_mist ?? "0");
    rows.push({
      label: "Gas deficit",
      value: `${(Number(deficitMist) / 1e9).toFixed(4)} SUI`,
      tone: "neg",
    });
    rows.push({
      label: "Wallet balance",
      value: `${(Number(BigInt(payload?.gas_check?.free_mist ?? "0")) / 1e9).toFixed(4)} SUI`,
    });
  } else if (isRejection) {
    rows.push({ label: "Capital moved", value: "0.000 SUI", tone: "muted" });
    rows.push({ label: "Position acquired", value: "—", tone: "muted" });
    const reason = payload?.reason ?? "unknown_policy_abort";
    const code = ABORT_CODE_BY_REASON[reason] ?? ABORT_CODE_BY_REASON.unknown_policy_abort;
    rows.push({
      label: "Move abort",
      value: `${code!.name} [Code ${code!.code}]`,
      tone: "neg",
    });
  } else if (payload?.execution_mode === "stake") {
    const amountSui = Number(BigInt(payload.amount_mist ?? "0")) / 1e9;
    rows.push({ label: "SUI spent", value: `-${amountSui.toFixed(4)} SUI`, tone: "neg" });
    rows.push({
      label: "StakedSUI received",
      value: `+${amountSui.toFixed(4)} StakedSUI`,
      tone: "pos",
    });
    if (typeof payload.execution_meta?.validator_apy === "number") {
      rows.push({
        label: "Validator APY (projected)",
        value: `${payload.execution_meta.validator_apy.toFixed(2)}%`,
      });
    }
  } else if (payload?.execution_mode === "deepbook" || payload?.mode === "deepbook") {
    const amountIn = Number(BigInt(payload?.fill?.amount_in ?? payload?.amount_mist ?? "0")) / 1e9;
    const amountOut = Number(BigInt(payload?.fill?.amount_out ?? "0")) / 1e9;
    rows.push({
      label: `${payload?.fill?.side_in ?? "SUI"} spent`,
      value: `-${amountIn.toFixed(4)} ${payload?.fill?.side_in ?? "SUI"}`,
      tone: "neg",
    });
    rows.push({
      label: `${payload?.fill?.side_out ?? "DBUSDC"} received`,
      value: `+${amountOut.toFixed(4)} ${payload?.fill?.side_out ?? "DBUSDC"}`,
      tone: "pos",
    });
    if (typeof payload?.fill?.price === "number") {
      rows.push({
        label: "Fill price",
        value: payload.fill.price.toFixed(5),
      });
    }
  } else {
    // Legacy / unknown — best effort
    const amountSui = Number(BigInt(payload?.amount_mist ?? "0")) / 1e9;
    rows.push({
      label: "Capital deployed",
      value: `${amountSui.toFixed(4)} SUI`,
    });
  }

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
        Real Balance Changes
      </p>
      <div className="mt-3 border border-line bg-bg/40">
        {rows.map((r, i) => (
          <div
            key={i}
            className={`grid grid-cols-[1fr_auto] items-baseline gap-3 px-3 py-2 ${
              i < rows.length - 1 ? "border-b border-line/70" : ""
            }`}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted">
              {r.label}
            </p>
            <p
              className={`font-mono text-[12.5px] tabular-nums ${
                r.tone === "neg"
                  ? "text-red-700"
                  : r.tone === "pos"
                    ? "text-green-700"
                    : r.tone === "muted"
                      ? "text-muted"
                      : "text-ink"
              }`}
            >
              {r.value}
            </p>
          </div>
        ))}
      </div>

      {/* Move abort inset terminal box — rejection rows only */}
      {isRejection ? (
        <MoveAbortBox payload={payload} />
      ) : null}
    </div>
  );
}

function MoveAbortBox({ payload }: { payload: OperatorActionPayload | null }) {
  const reason = payload?.reason ?? "unknown_policy_abort";
  const code = ABORT_CODE_BY_REASON[reason] ?? ABORT_CODE_BY_REASON.unknown_policy_abort;
  const long = REJECTION_REASON_COPY[reason] ?? REJECTION_REASON_COPY.unknown_policy_abort;

  return (
    <div className="mt-4 border border-red-200 bg-red-50/30 p-3 font-mono">
      <p className="text-[9.5px] uppercase tracking-[0.32em] text-red-700">
        operator_policy::assert_can_spend
      </p>
      <pre className="mt-2 whitespace-pre-wrap text-[11.5px] leading-[1.55] text-red-800">
{`assert(${reasonAssertionFor(reason)});
// → ABORT  ${code!.name} [Code ${code!.code}]`}
      </pre>
      {long ? (
        <p className="mt-2 font-sans text-[11.5px] leading-[1.55] text-red-900">
          {long}
        </p>
      ) : null}
      {payload?.error ? (
        <p className="mt-2 break-words border-t border-red-200 pt-2 text-[10px] leading-[1.55] text-red-900/80">
          chain message · {payload.error.slice(0, 220)}
          {payload.error.length > 220 ? "…" : ""}
        </p>
      ) : null}
    </div>
  );
}

function reasonAssertionFor(reason: string): string {
  switch (reason) {
    case "revoked":
      return "!policy.revoked";
    case "expired":
      return "now < policy.expires_at_ms";
    case "budget_exceeded":
      return "policy.spent + amount <= policy.budget_cap";
    case "venue_not_allowed":
      return "vector::contains(&policy.allowed_venues, &venue)";
    case "not_agent":
      return "tx_context::sender == policy.agent";
    default:
      return "/* policy invariant */";
  }
}

// ---------------------------------------------------------------------------
// Provenance panel — APY, TVL, decision scoring
// ---------------------------------------------------------------------------

function ProvenancePanel({
  action,
  payload,
  isRejection,
  isHeld,
}: {
  action: DecodedWorkObject;
  payload: OperatorActionPayload | null;
  isRejection: boolean;
  isHeld: boolean;
}) {
  const venue = payload?.venue;
  const signal: VenueSignalPayload | undefined =
    payload?.market_snapshot?.signals && venue
      ? payload.market_snapshot.signals[venue]
      : undefined;
  const evaluated = payload?.evaluated ?? [];

  type Row = { label: string; value: React.ReactNode };
  const rows: Row[] = [];

  if (signal) {
    if (typeof signal.raw?.apy_pct === "number") {
      rows.push({ label: "Live APY", value: `${signal.raw.apy_pct.toFixed(2)}%` });
    }
    if (typeof signal.raw?.tvl_usd === "number") {
      rows.push({ label: "Pool TVL", value: formatUsd(signal.raw.tvl_usd) });
    }
    if (typeof signal.raw?.audits === "number") {
      rows.push({
        label: "Audit posture",
        value:
          signal.raw.audits >= 2
            ? "Audited (≥ 2 firms)"
            : signal.raw.audits === 1
              ? "Single audit on record"
              : "Unaudited",
      });
    }
    rows.push({
      label: "Signal source",
      value:
        signal.source === "defillama"
          ? "DeFiLlama · live"
          : signal.source === "deepbook"
            ? "DeepBook RPC · live"
            : signal.source === "cached"
              ? "Cached snapshot"
              : "Baseline (degraded)",
    });
  }

  if (typeof payload?.confidence === "number") {
    rows.push({
      label: "Confidence",
      value: `${(payload.confidence * 100).toFixed(0)}% · ${payload.confidence_regime ?? "—"}`,
    });
  }
  if (typeof payload?.score === "number") {
    rows.push({
      label: "Evaluator score",
      value: payload.score.toFixed(3),
    });
  }
  if (typeof payload?.concentration_pct_after === "number") {
    rows.push({
      label: "Concentration · after",
      value: `${payload.concentration_pct_after.toFixed(1)}%`,
    });
  }
  if (payload?.world_state?.regime) {
    rows.push({
      label: "World state",
      value: payload.world_state.regime,
    });
  }
  if (payload?.execution_meta?.validator_address) {
    rows.push({
      label: "Validator",
      value: (
        <a
          href={`https://suiscan.xyz/testnet/account/${payload.execution_meta.validator_address}`}
          target="_blank"
          rel="noreferrer"
          className="text-ink-2 hover:underline"
        >
          {payload.execution_meta.validator_address.slice(0, 10)}…
          {payload.execution_meta.validator_address.slice(-4)}
        </a>
      ),
    });
  }
  if (payload?.execution_meta?.pool_key) {
    rows.push({
      label: "DeepBook pool",
      value: payload.execution_meta.pool_key,
    });
  }
  if (payload?.execution_meta?.client_order_id) {
    rows.push({
      label: "Client order id",
      value: payload.execution_meta.client_order_id,
    });
  }

  // Always include the WO id for verifiability
  rows.push({
    label: "WorkObject",
    value: (
      <a
        href={explorerUrl("object", action.id)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-ink-2 hover:underline"
      >
        {action.id.slice(0, 10)}…{action.id.slice(-6)}
        <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
      </a>
    ),
  });

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
        Provenance · Decision Trace
      </p>
      <div className="mt-3 border border-line bg-bg/40">
        {rows.length === 0 ? (
          <p className="px-3 py-3 font-mono text-[11px] text-muted">
            No decision trace recorded.
          </p>
        ) : (
          rows.map((r, i) => (
            <div
              key={i}
              className={`grid grid-cols-[1fr_auto] items-baseline gap-3 px-3 py-2 ${
                i < rows.length - 1 ? "border-b border-line/70" : ""
              }`}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted">
                {r.label}
              </p>
              <p className="font-mono text-[12px] tabular-nums text-ink-2">
                {r.value}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Evaluator scoring margins */}
      {!isRejection && !isHeld && evaluated.length > 0 ? (
        <div className="mt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            Scoring margins
          </p>
          <div className="mt-2 space-y-1.5 font-mono text-[11px]">
            {evaluated.map((e) => {
              const isChosen = e.venue === payload?.venue;
              const widthPct = Math.max(2, e.score * 100);
              return (
                <div
                  key={e.venue}
                  className="grid grid-cols-[80px_minmax(0,1fr)_44px] items-center gap-2"
                >
                  <span
                    className={
                      isChosen ? "text-ink" : "text-muted"
                    }
                  >
                    {e.venue}
                  </span>
                  <div className="relative h-1.5 bg-line/70">
                    <div
                      className={`absolute inset-y-0 left-0 ${
                        isChosen ? "bg-ink" : "bg-ink/30"
                      }`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span
                    className={`text-right tabular-nums ${
                      isChosen ? "text-ink" : "text-muted"
                    }`}
                  >
                    {e.score.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Signal provenance one-liner — auditable footer */}
      {signal ? (
        <p className="mt-4 font-mono text-[10px] leading-[1.55] text-muted">
          {signalProvenanceLine(signal)}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live cycle strip (between cycles)
// ---------------------------------------------------------------------------

function LiveCycleStrip({
  policy,
  state,
  latestAction,
  latestPayload,
  now,
}: {
  policy: OperatorPolicyDecoded;
  state: OperatorState;
  latestAction: DecodedWorkObject | undefined;
  latestPayload: OperatorActionPayload | null;
  now: number;
}) {
  const latestActionMs = latestAction ? Number(latestAction.timestampMs) : null;
  const untilNext = secondsUntilNextScan(
    policy,
    latestActionMs,
    OPERATOR_CYCLE_MS,
    now,
  );
  const expectedNextMs =
    (latestActionMs ?? Number(policy.createdAtMs)) + OPERATOR_CYCLE_MS;
  const overdueSec = Math.max(0, Math.floor((now - expectedNextMs) / 1000));
  const stale = state !== "deploying" && overdueSec > STALE_OVERDUE_SEC;

  const subline = stale
    ? "Verifying chain state — RPC throttled or next cycle hasn't ticked yet."
    : state === "deploying"
      ? "Submitting atomic transaction to Sui…"
      : state === "online"
        ? `Engaging — first scan of ${policy.allowedVenues.join(" · ")}`
        : `Evaluating ${policy.allowedVenues.join(" · ")} against the envelope.`;

  return (
    <div className="rounded-2xl border border-line bg-bg-elev px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[12px] font-medium text-ink-2">
          Cycle in session
        </p>
        <p className="text-[11.5px] tabular-nums text-muted">
          {stale
            ? `+${overdueSec}s overdue`
            : state === "deploying"
              ? "deploying"
              : `next in ${untilNext}s`}
        </p>
      </div>
      <p className="mt-1 text-[12.5px] leading-[1.55] text-ink-2">
        {subline}
      </p>
      {typeof latestPayload?.score === "number" && !stale ? (
        <p className="mt-1 text-[11.5px] text-muted">
          last decision · score{" "}
          <span className="font-mono tabular-nums text-ink-2">
            {latestPayload.score.toFixed(2)}
          </span>{" "}
          on {latestPayload.venue}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stood-down notice (terminal states)
// ---------------------------------------------------------------------------

function StoodDownNotice({ state }: { state: OperatorState }) {
  const isKill = state === "blocked" || state === "revoked";
  return (
    <div
      className={`rounded-2xl border px-5 py-4 ${
        isKill ? "border-red-200 bg-red-50" : "border-line bg-bg-elev"
      }`}
    >
      <p
        className={`text-[11px] font-medium uppercase tracking-[0.14em] ${
          isKill ? "text-red-600" : "text-muted"
        }`}
      >
        Operator stood down
      </p>
      <p
        className={`mt-1.5 text-[13.5px] leading-[1.55] ${isKill ? "text-red-900" : "text-ink-2"}`}
      >
        {OPERATOR_STATE_COPY[state].oneLine}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gas-funding notice — the prominent legal-style banner.
// ---------------------------------------------------------------------------

function GasFundingNotice({
  payload,
}: {
  payload: OperatorActionPayload;
}) {
  const [copied, setCopied] = useState(false);
  const deficitMist = BigInt(
    payload.gas_check?.deficit_mist ?? payload.gas_shortage_mist ?? "0",
  );
  const freeMist = BigInt(payload.gas_check?.free_mist ?? "0");
  const requiredMist = BigInt(payload.gas_check?.required_mist ?? "0");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(BRIEF_OPERATOR_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <aside
      role="alert"
      aria-live="polite"
      className="border-t-4 border-b-4 border-double border-amber-600 bg-amber-50/40 px-5 py-4 sm:px-7 sm:py-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-amber-800">
          [ Security Notice · Operator Held for Gas ]
        </p>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.28em] text-amber-800 tabular-nums">
          Outstanding deficit{" "}
          <span className="text-amber-900">
            {(Number(deficitMist) / 1e9).toFixed(4)} SUI
          </span>
        </p>
      </div>
      <p className="mt-2 max-w-prose text-[13px] leading-[1.6] text-amber-900">
        The operator has run low on SUI to execute its native staking or
        DeepBook duties. The autonomous cycle is paused until the agent
        wallet is replenished. Once funds land, the next scan resumes
        within {OPERATOR_CYCLE_MS / 1000}s and the held cycle is closed
        on the ledger.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.28em] text-amber-800">
            Agent wallet · top up to resume
          </p>
          <div className="mt-1.5 flex items-center gap-2 border border-amber-300 bg-bg-elev px-3 py-2">
            <code className="grow truncate font-mono text-[11.5px] text-amber-900">
              {BRIEF_OPERATOR_ADDRESS}
            </code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 border border-amber-700 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-amber-900 transition-colors hover:bg-amber-100"
            >
              {copied ? "copied" : "copy"}
              <Copy className="h-3 w-3" strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-800 tabular-nums sm:text-right">
          free{" "}
          <span className="text-amber-900">
            {(Number(freeMist) / 1e9).toFixed(4)} SUI
          </span>
          {" · "}required{" "}
          <span className="text-amber-900">
            {(Number(requiredMist) / 1e9).toFixed(4)} SUI
          </span>
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatLedgerTime(ms: bigint | number): string {
  const t = typeof ms === "bigint" ? Number(ms) : ms;
  if (!Number.isFinite(t) || t <= 0) return "—";
  return new Date(t).toISOString().slice(11, 19) + " UTC";
}

function formatUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
