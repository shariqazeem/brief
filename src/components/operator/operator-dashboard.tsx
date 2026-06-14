// OperatorDashboard — the one focused surface for an adopted operator.
//
// A thin top bar (identity · budget leash · kill switch) over a single
// white card with three tabs:
//   Now      — the decision cascade (the operator thinking, live) + tape
//   Journal  — its cumulative experience on Walrus, with real settlement
//   Policy   — the OperatorPolicy the chain enforces, + revoke
// and a bottom strip of the last ten decisions.
//
// This component is presentational + reads the live wire/journal itself.
// The revoke CEREMONY logic (sign + on-chain abort detection) is owned by
// the page wrapper and passed in as props, so the proven kill-switch
// machinery is reused verbatim while this file owns the new design.

"use client";

import nextDynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { explorerUrl } from "@/lib/brief-client";
import {
  useOperatorJournal,
  type JournalDecision,
  type SettlementKind,
} from "@/lib/operator-journal";
import type { OperatorPolicyDecoded, PolicyStatus } from "@/lib/operator-policy-client";
import {
  calibrateParams,
  goalLabel,
  type OperatorGoal,
} from "@/lib/operator-goal";
import {
  useAgentStream,
  type AgentStreamState,
  type StreamSignals,
} from "@/lib/use-agent-stream";
import type { TraderPersonality } from "@/lib/workforce-client";
import { walrusBlobUrl } from "@/lib/work-object";

const INK = "#111111";
const SUB = "#666666";
const EMERALD = "#10B981";
const RED = "#EF4444";
const AMBER = "#F59E0B";
const IDLE = "#999999";

const OperatorChart = nextDynamic(() => import("./operator-chart"), {
  ssr: false,
  loading: () => (
    <div
      style={{ height: 160 }}
      className="flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.28em] text-muted"
    >
      price tape…
    </div>
  ),
});

type KillSwitchPhase = "idle" | "scanning" | "verifying_post" | "verified";

type AbortRecordLike = {
  taskId: string;
  txDigest?: string;
  abortCode?: number;
  abortConst?: string;
  abortModule?: string;
  abortFn?: string;
  error?: string;
  at: number;
};

export type OperatorDashboardProps = {
  policyId: string | null;
  policy: OperatorPolicyDecoded | null;
  status: PolicyStatus | null;
  personality: TraderPersonality | null;
  traderName: string;
  goal?: OperatorGoal | null;
  onReset: () => void;
  dispatchError: string | null;
  onDispatchAgain: () => void;
  dispatching: boolean;
  revoked: boolean;
  killSwitchPhase: KillSwitchPhase;
  chainAbort: AbortRecordLike | null;
  revokeTx: string | null;
  revokeSubmitting: boolean;
  revokeError: string | null;
  confirmRevoke: boolean;
  onRequestRevoke: () => void;
  onConfirmRevoke: () => void;
  onCancelRevoke: () => void;
  /** Read-only shared view (e.g. ?policy=…): hide the revoke + adopt
   *  controls — only the owner drives the leash, from their own session. */
  readOnly?: boolean;
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function short(s: string | null | undefined, n = 4): string {
  if (!s) return "—";
  return s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s;
}

const VENUE_LABEL: Record<string, string> = {
  "predict-btc": "BTC",
  "spot-sui": "SUI",
  "spot-wal": "WAL",
  "spot-deep": "DEEP",
};
function venueLabel(v: string): string {
  return VENUE_LABEL[v] ?? v.replace(/^spot-/, "").toUpperCase();
}

function usd(n: number | null | undefined, dp = 0): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: dp })}`;
}

function sui(mist: bigint | null | undefined): number {
  if (mist == null) return 0;
  return Number(mist) / 1e9;
}

// A short thesis derived from live signals, used before the agent's own
// reasoning text lands. Honest restatement of the numbers, no spin.
function deriveThesis(s: StreamSignals | null): string {
  if (!s) return "Reading the tape…";
  const parts: string[] = [];
  if (s.roc_30m != null) {
    const pct = s.roc_30m * 100;
    parts.push(`Momentum ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% (30m)`);
  }
  if (s.rsi_60m != null) {
    const z = s.rsi_60m > 70 ? "overbought" : s.rsi_60m < 30 ? "oversold" : "neutral";
    parts.push(`RSI ${s.rsi_60m.toFixed(0)} ${z}`);
  }
  if (s.sma_15m != null && s.sma_60m != null) {
    parts.push(s.sma_15m >= s.sma_60m ? "trend aligned up" : "trend aligned down");
  }
  return parts.length ? `${parts.join(". ")}.` : "Reading the tape…";
}

function relTime(ms: number, now: number): string {
  const d = Math.max(0, now - ms);
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function dateLabel(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// root
// ---------------------------------------------------------------------------

export function OperatorDashboard(props: OperatorDashboardProps) {
  const {
    policyId,
    policy,
    personality,
    traderName,
    onReset,
    revoked,
    chainAbort,
    confirmRevoke,
    onRequestRevoke,
  } = props;

  const { state: stream } = useAgentStream(policyId);
  const journal = useOperatorJournal(policyId);
  const [tab, setTab] = useState<"now" | "journal" | "policy">("now");

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 4000);
    return () => clearInterval(i);
  }, []);

  const stale = stream.lastEventTs === 0 || now - stream.lastEventTs > 90_000;

  // Identity status dot.
  const dot: "act" | "preserve" | "idle" | "grounded" = revoked
    ? "grounded"
    : !stale && stream.decision
      ? stream.decision.decided
        ? "act"
        : "preserve"
      : "idle";

  const cap = sui(policy?.budgetCap);
  const spent = sui(policy?.spent);
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;

  return (
    <div className="min-h-screen bg-bg">
      <TopBar
        glyph={personality?.glyph ?? "◇"}
        name={traderName}
        dot={dot}
        revoked={revoked}
        spent={spent}
        cap={cap}
        pct={pct}
        fuel={revoked ? null : stream.fuel}
        onYank={onRequestRevoke}
        onReset={onReset}
        readOnly={props.readOnly}
      />

      <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <div className="bg-bg-elev shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <TabBar tab={tab} setTab={setTab} />
          <div className="px-5 py-6 sm:px-8 sm:py-8">
            {tab === "now" && (
              <NowTab
                stream={stream}
                journal={journal}
                stale={stale}
                now={now}
                policy={policy}
                traderName={traderName}
                revoked={revoked}
                dispatchError={props.dispatchError}
                onDispatchAgain={props.onDispatchAgain}
                dispatching={props.dispatching}
              />
            )}
            {tab === "journal" && (
              <JournalTab journal={journal} stream={stream} traderName={traderName} now={now} />
            )}
            {tab === "policy" && (
              <PolicyTab {...props} manifestoBlobId={stream.walrusManifestoBlobId} />
            )}
          </div>
        </div>

        <BottomStrip entries={journal.entries} />
      </main>

      {confirmRevoke && (
        <RevokeConfirm
          name={traderName}
          submitting={props.revokeSubmitting}
          error={props.revokeError}
          onConfirm={props.onConfirmRevoke}
          onCancel={props.onCancelRevoke}
        />
      )}

      {chainAbort && (
        <ChainRefusedOverlay
          abort={chainAbort}
          revokeTx={props.revokeTx}
          name={traderName}
          policyId={policyId}
          onReset={onReset}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// top bar
// ---------------------------------------------------------------------------

function TopBar({
  glyph,
  name,
  dot,
  revoked,
  spent,
  cap,
  pct,
  fuel,
  onYank,
  onReset,
  readOnly,
}: {
  glyph: string;
  name: string;
  dot: "act" | "preserve" | "idle" | "grounded";
  revoked: boolean;
  spent: number;
  cap: number;
  pct: number;
  fuel: { deepHuman: number; level: "ok" | "low" | "empty" } | null;
  onYank: () => void;
  onReset: () => void;
  readOnly?: boolean;
}) {
  const dotColor =
    dot === "act" ? EMERALD : dot === "preserve" ? AMBER : dot === "grounded" ? "#CCCCCC" : IDLE;
  const fill = pct >= 95 ? RED : pct >= 80 ? AMBER : EMERALD;
  return (
    <header
      className="sticky top-0 z-30 bg-bg-elev"
      style={{ borderBottom: `1px solid ${revoked ? RED : "#E5E5E5"}` }}
    >
      <div className="mx-auto flex max-w-4xl items-center gap-4 px-5 py-3 sm:px-8">
        {/* identity */}
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="font-sans text-[22px] leading-none" style={{ color: INK }} aria-hidden>
            {glyph}
          </span>
          <span
            className="truncate font-sans text-[15px] font-medium tracking-tight"
            style={{
              color: revoked ? "#CCCCCC" : INK,
              textDecoration: revoked ? "line-through" : "none",
            }}
          >
            {name}
          </span>
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot === "act" ? "animate-pulse" : ""}`}
            style={{ background: dotColor }}
            aria-hidden
          />
        </div>

        {/* budget leash */}
        <div className="hidden flex-1 items-center gap-3 sm:flex">
          <div className="h-1 flex-1 overflow-hidden" style={{ background: "#E5E5E5" }}>
            <div
              className="h-full transition-[width] duration-500"
              style={{ width: `${pct}%`, background: fill }}
            />
          </div>
          <span className="shrink-0 font-mono text-[11px] tabular-nums" style={{ color: SUB }}>
            {spent.toFixed(2)} / {cap.toFixed(0)} SUI
          </span>
        </div>

        {/* fuel gauge — DEEP tank for DeepBook fees. Understated; the user
            doesn't think about DEEP unless it runs low (amber). */}
        {fuel && (
          <div
            className="hidden shrink-0 items-center gap-1.5 sm:flex"
            title={`Fuel — DEEP covers DeepBook trading fees. Tank: ${fuel.deepHuman.toFixed(2)} DEEP.`}
          >
            <span
              className="font-sans text-[12px] leading-none"
              aria-hidden
              style={{ color: fuel.level === "ok" ? SUB : AMBER }}
            >
              ⛽
            </span>
            {fuel.level === "empty" ? (
              <span
                className="font-mono text-[9.5px] uppercase tracking-[0.16em]"
                style={{ color: AMBER }}
              >
                awaiting fuel
              </span>
            ) : (
              <span
                className="font-mono text-[10.5px] tabular-nums"
                style={{ color: fuel.level === "low" ? AMBER : SUB }}
              >
                {fuel.deepHuman.toFixed(2)} DEEP
              </span>
            )}
          </div>
        )}

        {/* controls */}
        <div className="ml-auto flex items-center gap-4 sm:ml-0">
          {readOnly ? (
            <span
              className="font-mono text-[9.5px] uppercase tracking-[0.2em]"
              style={{ color: SUB }}
              title="Shared view — only the owner can revoke, from their own session."
            >
              watching · owner holds the leash
            </span>
          ) : (
            !revoked && (
              <button
                type="button"
                onClick={onYank}
                className="font-mono text-[10px] uppercase tracking-[0.2em] transition-opacity hover:opacity-70"
                style={{ color: RED }}
              >
                Yank the leash
              </button>
            )
          )}
          <button
            type="button"
            onClick={onReset}
            className="font-mono text-[10px] uppercase tracking-[0.2em] transition-colors hover:text-ink"
            style={{ color: SUB }}
          >
            {readOnly ? "Adopt your own →" : "← Adopt another"}
          </button>
        </div>
      </div>

      {/* mobile budget row */}
      <div className="flex items-center gap-3 px-5 pb-2.5 sm:hidden">
        <div className="h-1 flex-1 overflow-hidden" style={{ background: "#E5E5E5" }}>
          <div className="h-full" style={{ width: `${pct}%`, background: fill }} />
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums" style={{ color: SUB }}>
          {spent.toFixed(2)} / {cap.toFixed(0)} SUI
        </span>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// tab bar
// ---------------------------------------------------------------------------

function TabBar({
  tab,
  setTab,
}: {
  tab: "now" | "journal" | "policy";
  setTab: (t: "now" | "journal" | "policy") => void;
}) {
  const tabs: Array<{ id: "now" | "journal" | "policy"; label: string }> = [
    { id: "now", label: "Now" },
    { id: "journal", label: "Journal" },
    { id: "policy", label: "Policy" },
  ];
  return (
    <div className="flex gap-6 px-5 sm:px-8" style={{ borderBottom: "1px solid #E5E5E5" }}>
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="relative -mb-px py-3.5 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors"
            style={{ color: active ? INK : SUB }}
          >
            {t.label}
            {active && (
              <span
                className="absolute inset-x-0 bottom-0 h-[2px]"
                style={{ background: EMERALD }}
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NOW tab — the decision cascade
// ---------------------------------------------------------------------------

function NowTab({
  stream,
  journal,
  stale,
  now,
  policy,
  traderName,
  revoked,
  dispatchError,
  onDispatchAgain,
  dispatching,
}: {
  stream: AgentStreamState;
  journal: ReturnType<typeof useOperatorJournal>;
  stale: boolean;
  now: number;
  policy: OperatorPolicyDecoded | null;
  traderName: string;
  revoked: boolean;
} & Pick<OperatorDashboardProps, "dispatchError" | "onDispatchAgain" | "dispatching">) {
  const hasObserve = stream.spotUsd != null || stream.steps.observe.status !== "pending";
  const hasSignals = stream.signals != null;
  const dec = stream.decision;
  const decided = !!dec && stream.steps.decision.status === "done";
  const chainReached =
    decided &&
    (stream.mintTx != null ||
      stream.deliveredTx != null ||
      stream.mode != null ||
      stream.steps.mint.status === "failed" ||
      stream.steps.mint.status === "skipped");

  const showCascade = !stale && (hasObserve || hasSignals || decided);

  const livePrice = stream.spotUsd ?? journal.pricePoints.at(-1)?.price ?? null;
  const sparkPts = journal.pricePoints.slice(-32).map((p) => p.price);

  // chart inputs
  const tMin = journal.pricePoints[0]?.ts ?? 0;
  const chartDecisions = journal.entries
    .filter((e) => e.spot_usd != null && e.ts >= tMin)
    .map((e) => ({
      ts: e.ts,
      price: e.spot_usd as number,
      dir: e.direction,
      abstained: e.abstained,
    }));

  return (
    <div>
      {showCascade ? (
        <div className="mx-auto max-w-xl space-y-px">
          {/* 1 — Observing */}
          <CascadeRow
            reached={hasObserve}
            expanded={hasObserve && !decided}
            active={!hasSignals && !decided}
            tone={INK}
            label="Observing"
          >
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-[22px] tabular-nums" style={{ color: INK }}>
                {usd(livePrice)}
              </span>
              <Sparkline values={sparkPts} />
            </div>
          </CascadeRow>

          {/* 2 — Thesis */}
          <CascadeRow
            reached={hasSignals || decided}
            expanded={hasSignals && !decided}
            active={hasSignals && !decided}
            tone={INK}
            label="Thesis"
          >
            <p className="text-[14px] leading-relaxed" style={{ color: INK }}>
              {dec?.reasoning ?? deriveThesis(stream.signals)}
            </p>
          </CascadeRow>

          {/* 3 — Risk */}
          <CascadeRow
            reached={hasSignals || decided}
            expanded={hasSignals && !decided}
            active={false}
            tone={INK}
            label="Risk"
          >
            <p className="font-mono text-[12px] tabular-nums" style={{ color: SUB }}>
              Budget {policy ? `${Math.round((sui(policy.spent) / Math.max(1e-9, sui(policy.budgetCap))) * 100)}% used` : "—"}
              {" · "}
              Policy {policy?.revoked ? "revoked" : "clear"}
              {dec ? ` · Conviction ${(dec.conviction * 100).toFixed(0)}%` : ""}
            </p>
          </CascadeRow>

          {/* 4 — Decision */}
          <CascadeRow
            reached={decided}
            expanded={decided}
            active={decided && !chainReached}
            tone={dec?.decided ? (dec.direction === "up" ? EMERALD : RED) : AMBER}
            label="Decision"
          >
            <DecisionBlock dec={dec} />
          </CascadeRow>

          {/* 5 — Chain */}
          <CascadeRow
            reached={chainReached}
            expanded={chainReached}
            active={false}
            tone={
              stream.mode === "live"
                ? EMERALD
                : stream.steps.mint.status === "failed"
                  ? RED
                  : AMBER
            }
            label="Chain"
          >
            <ChainBlock stream={stream} />
          </CascadeRow>
        </div>
      ) : (
        <IdleBlock
          stream={stream}
          journal={journal}
          now={now}
          traderName={traderName}
          revoked={revoked}
          dispatchError={dispatchError}
          onDispatchAgain={onDispatchAgain}
          dispatching={dispatching}
        />
      )}

      {/* price tape — ~30% of the card */}
      <div className="mt-8" style={{ borderTop: "1px solid #E5E5E5", paddingTop: 16 }}>
        <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.28em]" style={{ color: SUB }}>
          BTC · 24h · strike dotted
        </p>
        <OperatorChart
          points={journal.pricePoints}
          strikeUsd={stream.strikeUsd ?? journal.entries[0]?.strike_usd ?? null}
          decisions={chartDecisions}
          height={150}
        />
      </div>
    </div>
  );
}

function CascadeRow({
  reached,
  expanded,
  active,
  tone,
  label,
  children,
}: {
  reached: boolean;
  expanded: boolean;
  active: boolean;
  tone: string;
  label: string;
  children: React.ReactNode;
}) {
  if (!reached) return null;
  if (!expanded) {
    // collapsed thin row — dot + label only, faded
    return (
      <div className="flex items-center gap-2.5 py-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#CCCCCC" }} aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: "#CCCCCC" }}>
          {label}
        </span>
      </div>
    );
  }
  return (
    <div className="animate-fade-up py-4" style={{ borderTop: "1px solid #F0F0F0" }}>
      <div className="mb-2 flex items-center gap-2.5">
        <span
          className={`inline-block h-2 w-2 rounded-full ${active ? "animate-pulse" : ""}`}
          style={{ background: tone }}
          aria-hidden
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: SUB }}>
          {label}
        </span>
      </div>
      <div className="pl-[18px]">{children}</div>
    </div>
  );
}

function DecisionBlock({ dec }: { dec: AgentStreamState["decision"] }) {
  if (!dec) return null;
  if (!dec.decided) {
    return (
      <div>
        <p className="font-mono text-[26px] font-medium tracking-tight" style={{ color: AMBER }}>
          PRESERVE CAPITAL
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: SUB }}>
          {dec.reasoning ?? "No edge detected. Sitting this cycle out."}
        </p>
      </div>
    );
  }
  const up = dec.direction === "up";
  return (
    <div>
      <p className="font-mono text-[26px] font-medium tracking-tight" style={{ color: up ? EMERALD : RED }}>
        ACT — {up ? "UP ▲" : "DOWN ▼"}
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: SUB }}>
        {dec.reasoning ?? `Conviction ${(dec.conviction * 100).toFixed(0)}% · ${dec.quantity} contract${dec.quantity === 1 ? "" : "s"}.`}
      </p>
    </div>
  );
}

function ChainBlock({ stream }: { stream: AgentStreamState }) {
  const tx = stream.deliveredTx ?? stream.mintTx;
  const refused = stream.steps.mint.status === "failed";
  const live = stream.mode === "live";
  const verdict = refused
    ? { text: "Chain refused", color: RED }
    : live
      ? { text: "Policy verified", color: EMERALD }
      : { text: "Simulated · off-chain", color: AMBER };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="font-mono text-[12px] uppercase tracking-[0.12em]" style={{ color: verdict.color }}>
        {verdict.text}
      </span>
      {tx && (
        <a
          href={explorerUrl("txblock", tx)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] underline-offset-2 hover:underline"
          style={{ color: SUB }}
        >
          {short(tx, 6)} ↗
        </a>
      )}
    </div>
  );
}

function IdleBlock({
  stream,
  journal,
  now,
  traderName,
  revoked,
  dispatchError,
  onDispatchAgain,
  dispatching,
}: {
  stream: AgentStreamState;
  journal: ReturnType<typeof useOperatorJournal>;
  now: number;
  traderName: string;
  revoked: boolean;
  dispatchError: string | null;
  onDispatchAgain: () => void;
  dispatching: boolean;
}) {
  const last = journal.entries[0];
  // Brand-new operator (no decisions yet) → the "watching" first run. This is
  // the first thing a judge sees after adopting: it's alive + thinking.
  const firstRun = journal.loaded && journal.entries.length === 0 && !revoked && !stream.failure;
  return (
    <div className="flex flex-col items-center py-12 text-center">
      {revoked ? (
        <p className="font-mono text-[12px] uppercase tracking-[0.3em]" style={{ color: "#CCCCCC" }}>
          Operator grounded
        </p>
      ) : firstRun ? (
        <>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: EMERALD }} aria-hidden />
            <span className="font-mono text-[12px] uppercase tracking-[0.3em]" style={{ color: EMERALD }}>
              Operator active
            </span>
          </div>
          <p className="mt-4 font-sans text-[18px] font-medium tracking-tight" style={{ color: INK }}>
            {traderName} is watching the market.
          </p>
          <p className="mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: SUB }}>
            It reads the tape every cycle and acts only on a real edge — first
            decision usually within a minute. An abstention is a decision too:
            capital preserved is discipline, not inaction.
          </p>
        </>
      ) : (
        <p className="op-breathe font-mono text-[12px] uppercase tracking-[0.3em]" style={{ color: IDLE }}>
          Awaiting next cycle
        </p>
      )}
      {last && (
        <div className="mt-5">
          <OutcomeBadge entry={last} />
          <p className="mt-2 font-mono text-[10px]" style={{ color: SUB }}>
            last decision {relTime(last.ts, now)}
          </p>
        </div>
      )}
      {stream.failure && (
        <div className="mt-6">
          <p className="text-[12px]" style={{ color: SUB }}>
            Last task closed on an infra hiccup.
          </p>
          <button
            type="button"
            onClick={onDispatchAgain}
            disabled={dispatching}
            className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
            style={{ color: EMERALD }}
          >
            {dispatching ? "Dispatching…" : "Dispatch again →"}
          </button>
        </div>
      )}
      {dispatchError && !stream.failure && (
        <p className="mt-4 max-w-sm font-mono text-[10px]" style={{ color: SUB }}>
          {dispatchError.slice(0, 160)}
        </p>
      )}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 28;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - lo) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = values[values.length - 1]! >= values[0]!;
  return (
    <svg width={w} height={h} aria-hidden className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke={up ? EMERALD : RED}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// JOURNAL tab
// ---------------------------------------------------------------------------

function JournalTab({
  journal,
  stream,
  traderName,
  now,
}: {
  journal: ReturnType<typeof useOperatorJournal>;
  stream: AgentStreamState;
  traderName: string;
  now: number;
}) {
  const { entries, stats } = journal;
  const journalBlob = stream.walrusJournalBlobId ?? entries.find((e) => e.walrus_reasoning_blob_id)?.walrus_reasoning_blob_id ?? null;

  if (!journal.loaded) {
    return <p className="py-12 text-center font-mono text-[11px] uppercase tracking-[0.28em]" style={{ color: IDLE }}>loading journal…</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="py-12 text-center text-[13px]" style={{ color: SUB }}>
        {traderName} hasn&apos;t made its first decision yet. Its experience will be written here — and to Walrus — as it works.
      </p>
    );
  }

  return (
    <div>
      {/* running stats */}
      <p className="font-mono text-[11px] tabular-nums" style={{ color: SUB }}>
        {stats.total} decision{stats.total === 1 ? "" : "s"}
        {" · "}
        <span style={{ color: AMBER }}>{stats.preservedPct.toFixed(0)}% capital preserved</span>
        {" · "}
        {stats.winRate != null ? (
          <span style={{ color: stats.winRate >= 50 ? EMERALD : INK }}>
            {stats.winRate.toFixed(0)}% settled win rate
          </span>
        ) : (
          <span>win rate — (awaiting settlement)</span>
        )}
      </p>

      {/* timeline */}
      <div className="mt-6 space-y-0">
        {entries.map((e, i) => (
          <JournalRow key={`${e.task_id}-${i}`} entry={e} now={now} />
        ))}
      </div>

      {/* walrus provenance */}
      <div className="mt-8 space-y-2" style={{ borderTop: "1px solid #E5E5E5", paddingTop: 16 }}>
        <p className="text-[12px] leading-relaxed" style={{ color: SUB }}>
          {traderName}&apos;s experience is permanently stored on Walrus. Verifiable by anyone.
        </p>
        {journalBlob && (
          <a
            href={walrusBlobUrl(journalBlob)}
            target="_blank"
            rel="noreferrer"
            className="inline-block font-mono text-[10px] uppercase tracking-[0.22em] underline-offset-2 hover:underline"
            style={{ color: SUB }}
          >
            View raw Walrus blob ↗
          </a>
        )}
      </div>

      {/* technical signals — hidden by default */}
      <details className="group mt-4">
        <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: SUB }}>
          <span className="transition-opacity hover:opacity-70">View technical signals ▾</span>
        </summary>
        <div className="mt-3">
          <SignalReadout signals={stream.signals} />
        </div>
      </details>
    </div>
  );
}

function JournalRow({ entry, now }: { entry: JournalDecision; now: number }) {
  return (
    <div className="flex gap-3 py-3" style={{ borderTop: "1px solid #F0F0F0" }}>
      <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: settlementColor(entry.settlement) }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] tabular-nums" style={{ color: SUB }}>
          {dateLabel(entry.ts)} · {relTime(entry.ts, now)}
        </p>
        <p className="mt-0.5 text-[13.5px] leading-snug" style={{ color: INK }}>
          {entry.reasoning ?? settlementHeadline(entry)}
        </p>
        <p className="mt-0.5 text-[12px]" style={{ color: settlementColor(entry.settlement) }}>
          {settlementHeadline(entry)}
        </p>
      </div>
      {entry.walrus_reasoning_blob_id && (
        <a
          href={walrusBlobUrl(entry.walrus_reasoning_blob_id)}
          target="_blank"
          rel="noreferrer"
          title="reasoning on Walrus"
          className="mt-1 shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] underline-offset-2 hover:underline"
          style={{ color: SUB }}
        >
          ↗
        </a>
      )}
    </div>
  );
}

function settlementColor(k: SettlementKind): string {
  switch (k) {
    case "won":
      return EMERALD;
    case "lost":
      return RED;
    case "preserved":
      return AMBER;
    case "pending":
      return "#4DA2FF";
    default:
      return IDLE;
  }
}

function settlementHeadline(e: JournalDecision): string {
  const dir = e.direction ? e.direction.toUpperCase() : "";
  switch (e.settlement) {
    case "won":
      return `Acted ${dir}. Settled in-the-money. ✓`;
    case "lost":
      return `Acted ${dir}. Settled against. Honest loss.`;
    case "pending":
      return `Acted ${dir}. Awaiting settlement.`;
    case "preserved":
      return e.swingPct != null
        ? `Preserved capital. BTC swung ${e.swingPct.toFixed(1)}% — volatility it sat out.`
        : "Preserved capital. No edge worth the risk.";
    case "executed":
      return `Acted ${dir}${e.mode === "live" ? " · live on chain" : ""}.`;
    default:
      return `Acted ${dir}. Settled beyond the data window.`;
  }
}

function OutcomeBadge({ entry }: { entry: JournalDecision }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]"
      style={{ borderColor: "#E5E5E5", color: settlementColor(entry.settlement) }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: settlementColor(entry.settlement) }} aria-hidden />
      {entry.settlement === "preserved"
        ? "preserved capital"
        : entry.settlement === "won"
          ? "settled · won"
          : entry.settlement === "lost"
            ? "settled · lost"
            : entry.settlement === "pending"
              ? "awaiting settlement"
              : "acted"}
    </span>
  );
}

function SignalReadout({ signals }: { signals: StreamSignals | null }) {
  if (!signals) {
    return <p className="font-mono text-[11px]" style={{ color: SUB }}>No live signals right now.</p>;
  }
  const rsi = signals.rsi_60m;
  const rows: Array<[string, string]> = [
    ["RSI 60m", rsi != null ? rsi.toFixed(0) : "—"],
    ["ROC 30m", signals.roc_30m != null ? `${(signals.roc_30m * 100).toFixed(2)}%` : "—"],
    ["SMA 15m", signals.sma_15m != null ? usd(signals.sma_15m) : "—"],
    ["SMA 60m", signals.sma_60m != null ? usd(signals.sma_60m) : "—"],
    ["Realized vol 60m", signals.realized_vol_60m != null ? `${(signals.realized_vol_60m * 100).toFixed(1)}%` : "—"],
  ];
  return (
    <div className="space-y-2">
      {rsi != null && (
        <div>
          <div className="h-1 w-full overflow-hidden" style={{ background: "#E5E5E5" }}>
            <div className="h-full" style={{ width: `${Math.min(100, rsi)}%`, background: rsi > 70 ? RED : rsi < 30 ? EMERALD : "#CCCCCC" }} />
          </div>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2">
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: SUB }}>{k}</dt>
            <dd className="font-mono text-[11px] tabular-nums" style={{ color: INK }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// POLICY tab
// ---------------------------------------------------------------------------

function PolicyTab({
  policy,
  policyId,
  status,
  revoked,
  personality,
  goal,
  onRequestRevoke,
  manifestoBlobId,
}: OperatorDashboardProps & { manifestoBlobId?: string | null }) {
  if (!policy) {
    return <p className="py-12 text-center font-mono text-[11px] uppercase tracking-[0.28em]" style={{ color: IDLE }}>resolving policy…</p>;
  }
  const cap = sui(policy.budgetCap);
  const spent = sui(policy.spent);
  const remaining = Math.max(0, cap - spent);
  const goalCal = goal && personality ? calibrateParams(personality.strategy, goal) : null;
  const goalBase = personality ? calibrateParams(personality.strategy, { type: "edge" }) : null;
  const rows: Array<[string, React.ReactNode]> = [
    ["Status", <span key="s" style={{ color: revoked ? RED : EMERALD }}>{(status ?? "active").toUpperCase()}</span>],
    ["Budget cap", `${cap.toFixed(2)} SUI`],
    ["Spent", `${spent.toFixed(2)} SUI`],
    ["Remaining", `${remaining.toFixed(2)} SUI`],
    ["Venues", (policy.allowedVenues ?? []).map(venueLabel).join(" · ") || "—"],
    ["Agent", short(policy.agent, 6)],
    ["Owner (you)", short(policy.owner, 6)],
    ["Expires", policy.expiresAtMs ? new Date(Number(policy.expiresAtMs)).toLocaleString() : "—"],
  ];
  return (
    <div>
      {goal && goalCal && goalBase && (
        <div className="mb-5 pb-5" style={{ borderBottom: "1px solid #E5E5E5" }}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: SUB }}>
              Goal
            </span>
            <span className="font-mono text-[12px]" style={{ color: INK }}>
              {goalLabel(goal)}
            </span>
          </div>
          <p className="mt-2 font-mono text-[10.5px] leading-relaxed" style={{ color: SUB }}>
            Calibrated thresholds:{" "}
            <span style={{ color: INK }}>
              edge ≥{(goalCal.minEdge * 100).toFixed(1)}% · conviction ≥{goalCal.convictionFloor.toFixed(2)} · max qty {goalCal.maxQty}
            </span>
            {goal.type !== "edge" && (
              <>
                <br />
                Baseline: edge ≥{(goalBase.minEdge * 100).toFixed(1)}% · conviction ≥{goalBase.convictionFloor.toFixed(2)} · max qty {goalBase.maxQty}
              </>
            )}
          </p>
        </div>
      )}
      <dl className="divide-y" style={{ borderColor: "#F0F0F0" }}>
        {rows.map(([k, v]) => (
          <div key={String(k)} className="flex items-baseline justify-between gap-4 py-3" style={{ borderTop: "1px solid #F0F0F0" }}>
            <dt className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: SUB }}>{k}</dt>
            <dd className="text-right font-mono text-[12px] tabular-nums" style={{ color: INK }}>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {!revoked && (
          <button
            type="button"
            onClick={onRequestRevoke}
            className="font-mono text-[10px] uppercase tracking-[0.2em] transition-opacity hover:opacity-70"
            style={{ color: RED }}
          >
            Revoke policy
          </button>
        )}
        {policyId && (
          <a
            href={explorerUrl("object", policyId)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] uppercase tracking-[0.2em] underline-offset-2 hover:underline"
            style={{ color: SUB }}
          >
            View on Suiscan ↗
          </a>
        )}
        {manifestoBlobId && (
          <a
            href={walrusBlobUrl(manifestoBlobId)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] uppercase tracking-[0.2em] underline-offset-2 hover:underline"
            style={{ color: "#047857" }}
          >
            Operator manifesto ↗
          </a>
        )}
      </div>
      <p className="mt-4 text-[12px] leading-relaxed" style={{ color: SUB }}>
        This operator published a manifesto to Walrus at adoption — its declared
        parameters + a pledge, verifiable by anyone. Past wins still auto-redeem
        after revocation; the kill switch blocks new bets, never your winnings.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// bottom strip
// ---------------------------------------------------------------------------

function BottomStrip({ entries }: { entries: JournalDecision[] }) {
  if (entries.length === 0) return null;
  const last = entries.slice(0, 10);
  return (
    <div className="mt-4 flex items-center gap-2 px-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.24em]" style={{ color: SUB }}>
        last {last.length}
      </span>
      <div className="flex gap-1.5">
        {last.map((e, i) => (
          <span
            key={`${e.task_id}-${i}`}
            title={`${(e.oracle_id ? "BTC" : e.direction ? "BTC" : "BTC")} · ${e.abstained ? "preserved" : (e.direction ?? "").toUpperCase()} · ${e.settlement}`}
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: settlementColor(e.settlement) }}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// revoke confirm + chain-refused ceremony
// ---------------------------------------------------------------------------

function RevokeConfirm({
  name,
  submitting,
  error,
  onConfirm,
  onCancel,
}: {
  name: string;
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 px-5" onClick={onCancel}>
      <div
        className="w-full max-w-md bg-bg-elev p-7 shadow-[0_8px_40px_rgba(0,0,0,0.12)]"
        style={{ borderTop: `3px solid ${RED}` }}
        onClick={(ev) => ev.stopPropagation()}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.28em]" style={{ color: RED }}>
          Yank the leash
        </p>
        <p className="mt-3 text-[14px] leading-relaxed" style={{ color: INK }}>
          Pull the leash on <span className="font-medium">{name}</span>? The Move policy will block its next bet on chain. Past wins still auto-redeem — this stops new risk, not your winnings.
        </p>
        {error && (
          <p className="mt-3 font-mono text-[11px]" style={{ color: RED }}>{error.slice(0, 200)}</p>
        )}
        <div className="mt-6 flex items-center justify-end gap-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
            style={{ color: SUB }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.24em] text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: RED }}
          >
            {submitting ? "Signing…" : "Yank the leash"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChainRefusedOverlay({
  abort,
  revokeTx,
  name,
  policyId,
  onReset,
}: {
  abort: AbortRecordLike;
  revokeTx: string | null;
  name: string;
  policyId: string | null;
  onReset: () => void;
}) {
  const fingerprint = `${abort.abortConst ?? "EPolicyRevoked"} · code ${abort.abortCode ?? 3} · ${abort.abortModule ?? "operator_policy"}::${abort.abortFn ?? "assert_can_spend"}`;
  const txLink = abort.txDigest ?? revokeTx;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg px-5">
      <div className="w-full max-w-lg text-center">
        <p className="font-mono text-[34px] font-medium tracking-tight sm:text-[44px]" style={{ color: RED }}>
          CHAIN REFUSED
        </p>
        <p className="mt-4 text-[15px] leading-relaxed" style={{ color: INK }}>
          The operator attempted to act. The Move policy blocked execution.
        </p>

        <div className="mx-auto mt-6 max-w-sm border px-4 py-3 text-left" style={{ borderColor: "#E5E5E5" }}>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: SUB }}>
            abort fingerprint
          </p>
          <p className="mt-1 break-words font-mono text-[11px]" style={{ color: INK }}>
            {fingerprint}
          </p>
          {txLink && (
            <a
              href={explorerUrl("txblock", txLink)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-mono text-[10px] underline-offset-2 hover:underline"
              style={{ color: SUB }}
            >
              {short(txLink, 8)} ↗
            </a>
          )}
        </div>

        <p className="mt-6 font-sans text-[20px] font-medium" style={{ color: "#CCCCCC", textDecoration: "line-through" }}>
          {name}
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: SUB }}>
          Leash pulled · Operator grounded
        </p>
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: EMERALD }}>
          Past wins · auto-redeeming
        </p>

        <div className="mt-8 flex items-center justify-center gap-5">
          {policyId && (
            <a
              href={explorerUrl("object", policyId)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] uppercase tracking-[0.2em] underline-offset-2 hover:underline"
              style={{ color: SUB }}
            >
              Policy on Suiscan ↗
            </a>
          )}
          <button
            type="button"
            onClick={onReset}
            className="font-mono text-[10px] uppercase tracking-[0.2em] transition-colors hover:text-ink"
            style={{ color: SUB }}
          >
            Adopt another operator →
          </button>
        </div>
      </div>
    </div>
  );
}
