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

import { explorerUrl, BRIEF_NETWORK, momentumLabel } from "@/lib/brief-client";
import { INK, SUB, MUTED, NAVY, EMERALD, RED, AMBER, IDLE } from "@/lib/ui";
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
import {
  useOperatorScorecard,
  matrixCell,
  matrixRowKey,
  MATRIX_MODES,
  MATRIX_ROWS,
  MODE_LABEL,
  REGIME_LABEL,
  type Scorecard,
  type PlaybookStat,
  type MatrixMode,
  type RegimeKind,
  type DecisionRecord,
} from "@/lib/operator-scorecard";
import { operatorCodename, objectiveLabel } from "@/lib/operator-identity";
import type { TraderPersonality } from "@/lib/workforce-client";
import { walrusBlobUrl } from "@/lib/work-object";


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

// A gated-spot operator (the wizard product) trades SUI/USDC, and its policy
// budget is denominated in the capital coin (DBUSDC testnet / USDC mainnet,
// 6dp) — NOT SUI (9dp). A Predict operator is BTC + SUI-denominated budget.
function isSpotPolicy(policy: OperatorPolicyDecoded | null): boolean {
  return (policy?.allowedVenues ?? []).some((v) => v.startsWith("spot"));
}
function budgetView(policy: OperatorPolicyDecoded | null): {
  cap: number;
  spent: number;
  unit: string;
  asset: string;
} {
  const spot = isSpotPolicy(policy);
  const div = spot ? 1e6 : 1e9;
  return {
    cap: Number(policy?.budgetCap ?? 0n) / div,
    spent: Number(policy?.spent ?? 0n) / div,
    unit: spot ? (BRIEF_NETWORK === "mainnet" ? "USDC" : "DBUSDC") : "SUI",
    asset: spot ? "SUI" : "BTC",
  };
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
    parts.push(`Momentum ${momentumLabel(s.rsi_60m).toLowerCase()}`);
  }
  if (s.sma_15m != null && s.sma_60m != null) {
    parts.push(s.sma_15m >= s.sma_60m ? "trend aligned up" : "trend aligned down");
  }
  return parts.length ? `${parts.join(". ")}.` : "Reading the tape…";
}

// The hero statement, in ALLOCATION terms — never "found an edge → selling"
// followed by "no order placed". A capital manager states where the money is
// and where it's going: "Bearish outlook. Holding cash." / "Adding to SUI."
function allocationHeadline(dec: NonNullable<AgentStreamState["decision"]>): string {
  const cur = dec.currentExposurePct ?? 0;
  const tgt = dec.targetExposurePct;
  if (dec.decided && dec.rebalance === "buy") {
    return `Adding to SUI — moving toward ${tgt ?? cur}% exposure.`;
  }
  if (dec.decided && dec.rebalance === "sell") {
    return `Reducing risk — trimming SUI toward ${tgt ?? 0}%.`;
  }
  // Holding — state the outlook and where capital sits, no contradiction.
  const outlook = tgt == null ? "No clear edge" : tgt === 0 ? "Bearish outlook" : "Bullish outlook";
  const where = cur < 5 ? "Holding cash." : `Holding ${cur}% in SUI.`;
  return `${outlook}. ${where}`;
}

// The operator's learned procedure for a regime — memory as an operating
// procedure, not "found 3 similar situations".
function playbookLine(pb: NonNullable<AgentStreamState["decision"]>["playbook"]): string {
  if (!pb || pb.occurrences === 0) return "First time in this regime — recording it.";
  const best =
    pb.bestAction === "act" ? "act" : pb.bestAction === "stand-aside" ? "stand aside" : "build the record";
  const wr = pb.winRate != null ? ` · ${Math.round(pb.winRate)}% win rate` : "";
  return `${pb.label} · seen ${pb.occurrences}× · best play: ${best}${wr}`;
}

// The allocation step in the timeline — target vs current → the action.
function allocationBeat(dec: NonNullable<AgentStreamState["decision"]>): string {
  const cur = dec.currentExposurePct ?? 0;
  const tgt = dec.targetExposurePct;
  if (tgt == null) return `Currently ${cur}% SUI · no confident target — hold.`;
  if (dec.rebalance === "buy") return `Target ${tgt}% SUI · currently ${cur}% → buy toward ${tgt}%.`;
  if (dec.rebalance === "sell") return `Target ${tgt}% SUI · currently ${cur}% → trim toward ${tgt}%.`;
  return `Target ${tgt}% SUI · currently ${cur}% — within band, hold.`;
}

// The result line when the operator holds — allocation terms, no "stood down".
function holdResult(dec: NonNullable<AgentStreamState["decision"]>): string {
  const cur = dec.currentExposurePct ?? 0;
  if (dec.targetExposurePct != null)
    return `Already aligned — ${cur}% SUI, within target. No rebalance needed.`;
  return "No confident edge — capital positioned, none at new risk.";
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
    goal,
    onReset,
    revoked,
    chainAbort,
    confirmRevoke,
    onRequestRevoke,
  } = props;

  const { state: stream } = useAgentStream(policyId);
  const spot = isSpotPolicy(policy);
  const bv = budgetView(policy);
  const journal = useOperatorJournal(policyId, bv.asset, spot);
  const { scorecard, decisions } = useOperatorScorecard(policyId);
  const codename = operatorCodename(policyId);
  const objective = objectiveLabel(goal ?? null);

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

  return (
    <div className="min-h-screen bg-bg">
      <TopBar
        glyph={personality?.glyph ?? "◇"}
        name={codename}
        subname={traderName}
        dot={dot}
        revoked={revoked}
        fuel={revoked ? null : stream.fuel}
        policyId={policyId}
        onYank={onRequestRevoke}
        onReset={onReset}
        readOnly={props.readOnly}
      />

      <main className="mx-auto max-w-3xl space-y-6 px-5 py-8 sm:px-8">
        {/* My operator → my capital → my goal → my progress → what it's doing → why */}
        <OperatorHero
          name={codename}
          objective={objective}
          glyph={personality?.glyph ?? "◇"}
          stream={stream}
          revoked={revoked}
          stale={stale}
          now={now}
          bv={bv}
        />

        <CapitalCard stream={stream} bv={bv} spanDays={scorecard?.spanDays ?? null} />

        {spot && (
          <GoalCard goal={goal ?? null} stream={stream} spanDays={scorecard?.spanDays ?? null} />
        )}

        {spot && <OperatorScorecard scorecard={scorecard} stream={stream} revoked={revoked} />}

        {spot && <ProtectedBySui policyId={policyId} />}

        <MarketState signals={stream.signals} dec={stream.decision} assetLabel={bv.asset} />

        {spot && <AllocationMatrix dec={stream.decision} />}

        {spot && scorecard && scorecard.playbooks.length > 0 && (
          <SectionCard title="What it's learned · playbooks">
            <PlaybookIntelligence playbooks={scorecard.playbooks} />
          </SectionCard>
        )}

        <SectionCard title="Right now">
          <NowTab
            stream={stream}
            journal={journal}
            stale={stale}
            now={now}
            policy={policy}
            traderName={traderName}
            revoked={revoked}
            assetLabel={bv.asset}
            isSpot={spot}
            dispatchError={props.dispatchError}
            onDispatchAgain={props.onDispatchAgain}
            dispatching={props.dispatching}
          />
        </SectionCard>

        <SectionCard
          title="Timeline · its experience"
          action={
            policyId ? (
              <Link
                href={`/brain?policy=${policyId}`}
                className="font-mono text-[10px] uppercase tracking-[0.2em] transition-opacity hover:opacity-60"
                style={{ color: NAVY }}
              >
                Full replay →
              </Link>
            ) : null
          }
        >
          {spot ? (
            <OperatorTimeline
              decisions={decisions}
              stream={stream}
              traderName={codename}
              now={now}
            />
          ) : (
            <JournalTab journal={journal} stream={stream} traderName={traderName} now={now} isSpot={spot} />
          )}
        </SectionCard>

        <details className="group bg-bg-elev shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <summary
            className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 sm:px-8"
            style={{ color: NAVY }}
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.24em]">Policy &amp; proof</span>
            <span className="font-mono text-[10px] transition-transform group-open:rotate-90" aria-hidden>
              ›
            </span>
          </summary>
          <div className="px-5 pb-7 sm:px-8" style={{ borderTop: "1px solid #E5E5EA" }}>
            <div className="pt-6">
              <PolicyTab {...props} manifestoBlobId={stream.walrusManifestoBlobId} />
            </div>
          </div>
        </details>

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
// Hero — the ONE glance. Current status (live) AND last completed decision
// COEXIST (they're different things — fixes the "watching↔protected" flicker),
// over the four numbers that matter.
// ---------------------------------------------------------------------------

function OperatorHero({
  name,
  objective,
  glyph,
  stream,
  revoked,
  stale,
  now,
  bv,
}: {
  name: string;
  objective: string;
  glyph: string;
  stream: AgentStreamState;
  revoked: boolean;
  stale: boolean;
  now: number;
  bv: { cap: number; spent: number; unit: string };
}) {
  const dec = stream.decision;
  const status = revoked
    ? { word: "Grounded", color: IDLE, live: false }
    : stream.mode === "live" && !stale
      ? { word: "Executing", color: EMERALD, live: true }
      : { word: "Observing", color: NAVY, live: true };
  const heroLine = revoked
    ? "Operator grounded — past wins still redeem, no new trades."
    : !dec
      ? "Reading the market — its first decision lands shortly."
      : dec.mandate?.breached
        ? "Mandate guard tripped — standing down to honour your limit."
        : allocationHeadline(dec);
  // The allocation sub-line — "what your money is doing" in one tabular glance.
  const curEx = dec?.currentExposurePct ?? null;
  const tgtEx = dec?.targetExposurePct ?? null;
  const allocSub =
    dec && !revoked && curEx != null
      ? `${curEx}% SUI · ${100 - curEx}% cash${tgtEx != null ? ` · target ${tgtEx}% SUI` : ""}`
      : null;
  const lastWhen = stream.lastEventTs ? relTime(stream.lastEventTs, now) : "—";
  const conf = dec ? `${Math.round(dec.conviction * 100)}%` : "—";
  const m = dec?.mandate ?? null;
  const mandateHealth = m ? (m.breached ? "Guard tripped" : "Healthy") : "—";
  const mandateColor = m ? (m.breached ? RED : EMERALD) : SUB;
  const budgetRem = bv.cap > 0 ? `${Math.max(0, Math.round(100 - (bv.spent / bv.cap) * 100))}%` : "—";
  return (
    <section
      className="bg-bg-elev px-6 py-7 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-9 sm:py-8"
      style={{ borderTop: `3px solid ${status.color}` }}
    >
      <div className="flex items-center gap-2.5">
        <span className="font-sans text-[22px] leading-none" style={{ color: INK }} aria-hidden>
          {glyph}
        </span>
        <span
          className="font-sans text-[18px] font-semibold tracking-tight"
          style={{ color: revoked ? IDLE : INK, textDecoration: revoked ? "line-through" : "none" }}
        >
          {name}
        </span>
        <span className="ml-1 inline-flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${status.live ? "animate-pulse" : ""}`}
            style={{ background: status.color }}
            aria-hidden
          />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.24em]" style={{ color: status.color }}>
            {status.word}
          </span>
        </span>
      </div>
      <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.18em]" style={{ color: SUB }}>
        {objective}
      </p>
      <p
        className="mt-4 font-sans text-[27px] font-medium leading-[1.15] tracking-tight sm:text-[34px]"
        style={{ color: INK }}
      >
        {heroLine}
      </p>
      {allocSub && (
        <p className="mt-2.5 font-mono text-[12px] tabular-nums" style={{ color: SUB }}>
          {allocSub}
        </p>
      )}
      <div
        className="mt-6 grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-4"
        style={{ background: "#E5E5EA" }}
      >
        <HeroStat label="Last decision" value={lastWhen} />
        <HeroStat label="Confidence" value={conf} />
        <HeroStat label="Mandate" value={mandateHealth} color={mandateColor} />
        <HeroStat label="Budget left" value={budgetRem} />
      </div>
    </section>
  );
}

function HeroStat({ label, value, color = INK }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-elev px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: SUB }}>
        {label}
      </p>
      <p className="mt-1 font-mono text-[14px] tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

// Operator Capital — the FIRST thing a user (and judge) wants: how much money
// is it managing right now, and is it up or down. Marked to market live.
function CapitalCard({
  stream,
  bv,
  spanDays,
}: {
  stream: AgentStreamState;
  bv: { cap: number; spent: number; unit: string };
  spanDays: number | null;
}) {
  const dec = stream.decision;
  const p = dec?.portfolio ?? null;
  const value = p?.value ?? bv.cap;
  const deposit = p?.deposit ?? bv.cap;
  const pnl = value - deposit;
  const pnlPct = p?.pnlPct ?? 0;
  const budgetRem = p?.budgetRemainingPct ?? (bv.cap > 0 ? Math.max(0, 100 - (bv.spent / bv.cap) * 100) : 100);
  const flat = Math.abs(pnl) < 0.005;
  const pnlColor = flat ? SUB : pnl > 0 ? EMERALD : RED;
  // Where the money LIVES right now — the allocation split (SUI vs cash).
  const suiPct = dec?.currentExposurePct ?? null;
  const tgtPct = dec?.targetExposurePct ?? null;
  return (
    <section
      className="bg-bg-elev px-6 py-7 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-9 sm:py-8"
      style={{ borderTop: `3px solid ${NAVY}` }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: SUB }}>
        Operator capital
      </p>
      <div className="mt-2 flex items-baseline gap-2.5">
        <span className="font-sans text-[42px] font-medium tabular-nums leading-none tracking-tight sm:text-[52px]" style={{ color: INK }}>
          {value.toFixed(2)}
        </span>
        <span className="font-mono text-[12px] uppercase tracking-[0.18em]" style={{ color: SUB }}>
          {bv.unit}
        </span>
      </div>
      <p className="mt-2 font-mono text-[14px] tabular-nums" style={{ color: pnlColor }}>
        {flat ? "±0.00" : `${pnl > 0 ? "+" : ""}${pnl.toFixed(2)}`} {bv.unit}
        {!flat && ` · ${pnlPct > 0 ? "+" : ""}${pnlPct.toFixed(1)}%`}
        <span className="ml-1" style={{ color: SUB }}>vs deposit</span>
      </p>
      <p className="mt-1 font-mono text-[11.5px] tabular-nums" style={{ color: MUTED }}>
        Deposited {deposit.toFixed(2)} {bv.unit}
        {spanDays != null && spanDays >= 1
          ? ` · lifetime ${Math.round(spanDays)} day${Math.round(spanDays) === 1 ? "" : "s"}`
          : ""}
      </p>
      {suiPct != null && (
        <div className="mt-5">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: SUB }}>
              Allocation
            </span>
            <span className="font-mono text-[11px] tabular-nums" style={{ color: SUB }}>
              {suiPct}% SUI · {100 - suiPct}% cash
              {tgtPct != null && tgtPct !== suiPct ? ` → ${tgtPct}%` : ""}
            </span>
          </div>
          <div className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#E5E5EA" }}>
            <div className="h-full transition-[width] duration-500" style={{ width: `${suiPct}%`, background: NAVY }} />
          </div>
        </div>
      )}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: SUB }}>
            Budget remaining
          </span>
          <span className="font-mono text-[11px] tabular-nums" style={{ color: SUB }}>
            {budgetRem.toFixed(0)}%
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "#E5E5EA" }}>
          <div className="h-full transition-[width] duration-500" style={{ width: `${budgetRem}%`, background: budgetRem < 10 ? RED : EMERALD }} />
        </div>
      </div>
    </section>
  );
}

// Operator Scorecard — the track record. The answer to "why should I trust
// this with money?" — measurable, not an agent count. PnL headline over the
// real counts: decisions, reallocations, abstentions, mandate compliance,
// policy violations (0 — chain-enforced), and the regime it reads best.
function OperatorScorecard({
  scorecard,
  stream,
  revoked,
}: {
  scorecard: Scorecard | null;
  stream: AgentStreamState;
  revoked: boolean;
}) {
  const sc = scorecard;
  if (!sc || sc.decisions === 0) return null;
  const p = stream.decision?.portfolio ?? null;
  const pnlPct = p?.pnlPct ?? 0;
  const flat = Math.abs(pnlPct) < 0.05;
  const pnlColor = revoked ? IDLE : flat ? SUB : pnlPct > 0 ? EMERALD : RED;
  const m = stream.decision?.mandate ?? null;
  const mandateHealthy = !m || !m.breached;
  const days = sc.spanDays != null ? Math.round(sc.spanDays) : null;
  const spanLabel = days != null && days >= 1 ? `over ${days} day${days === 1 ? "" : "s"}` : "since launch";
  return (
    <section
      className="bg-bg-elev px-6 py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-9"
      style={{ borderTop: `3px solid ${NAVY}` }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: SUB }}>
        Track record
      </p>
      <div className="mt-2 flex items-baseline gap-2.5">
        <span
          className="font-sans text-[34px] font-medium tabular-nums leading-none tracking-tight sm:text-[40px]"
          style={{ color: pnlColor }}
        >
          {flat ? "±0.0%" : `${pnlPct > 0 ? "+" : ""}${pnlPct.toFixed(1)}%`}
        </span>
        <span className="font-mono text-[12px]" style={{ color: SUB }}>
          {spanLabel}
        </span>
      </div>
      <div
        className="mt-5 grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3"
        style={{ background: "#E5E5EA" }}
      >
        <HeroStat label="Decisions" value={`${sc.decisions}`} />
        <HeroStat label="Reallocations" value={`${sc.reallocations}`} />
        <HeroStat label="Abstentions" value={`${sc.abstentions}`} />
        <HeroStat
          label="Mandate"
          value={mandateHealthy ? "100%" : "Breached"}
          color={mandateHealthy ? EMERALD : RED}
        />
        <HeroStat label="Policy violations" value="0" color={EMERALD} />
        <HeroStat
          label="Win rate"
          value={sc.winRate != null ? `${Math.round(sc.winRate)}%` : "—"}
        />
      </div>
      {sc.bestRegime && (
        <p className="mt-3 font-mono text-[11.5px] tabular-nums" style={{ color: SUB }}>
          <span style={{ color: NAVY }}>Best regime</span> · {sc.bestRegime.label} ·{" "}
          {Math.round(sc.bestRegime.winRate ?? 0)}% success over {sc.bestRegime.wins + sc.bestRegime.losses} settled
        </p>
      )}
    </section>
  );
}

// Regime → Allocation Matrix — the operator's visible brain. Its allocation
// POLICY: each mode's SUI ceiling × each regime's stance. Mirrors the engine
// (MODE_CFG.maxExposure), so it's a window into the real logic, not a claim.
// The current regime row + active mode column are lit; the live target/current
// reading makes "already aligned" obvious at a glance.
function AllocationMatrix({ dec }: { dec: AgentStreamState["decision"] }) {
  const mode = (dec?.mode as MatrixMode) ?? "grow";
  const curRowKey = matrixRowKey((dec?.regimeKind as RegimeKind) ?? null, dec?.direction ?? null);
  const cur = dec?.currentExposurePct ?? null;
  const tgt = dec?.targetExposurePct ?? null;
  const action =
    dec?.rebalance === "buy"
      ? "Buy toward target"
      : dec?.rebalance === "sell"
        ? "Trim toward target"
        : tgt != null
          ? "Already aligned"
          : "Hold — no edge";
  return (
    <section className="bg-bg-elev px-6 py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-9">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: NAVY }}>
        Allocation policy · its brain
      </p>
      <div className="mt-3 overflow-hidden" style={{ border: "1px solid #E5E5EA" }}>
        {/* header */}
        <div className="grid grid-cols-4" style={{ background: "#FAFAFA" }}>
          <div className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: SUB }}>
            Regime
          </div>
          {MATRIX_MODES.map((md) => (
            <div
              key={md}
              className="px-3 py-2 text-right font-mono text-[9px] uppercase tracking-[0.14em]"
              style={{ color: md === mode ? NAVY : SUB, background: md === mode ? "#EEF3FB" : "transparent" }}
            >
              {MODE_LABEL[md]}
            </div>
          ))}
        </div>
        {/* rows */}
        {MATRIX_ROWS.map((row) => {
          const isCur = row.key === curRowKey;
          return (
            <div
              key={row.key}
              className="grid grid-cols-4"
              style={{ borderTop: "1px solid #F0F0F0", background: isCur ? "#F5F8FE" : "transparent" }}
            >
              <div
                className="px-3 py-2 text-[12px]"
                style={{ color: isCur ? INK : SUB, fontWeight: isCur ? 600 : 400 }}
              >
                {isCur && <span style={{ color: NAVY }}>▸ </span>}
                {row.label}
              </div>
              {MATRIX_MODES.map((md) => (
                <div
                  key={md}
                  className="px-3 py-2 text-right font-mono text-[12px] tabular-nums"
                  style={{
                    color: row.stance === "follow-up" ? INK : SUB,
                    background: md === mode ? (isCur ? "#E7F0FC" : "#F6F9FE") : "transparent",
                    fontWeight: isCur && md === mode ? 600 : 400,
                  }}
                >
                  {matrixCell(row.stance, md)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {curRowKey && (
        <p className="mt-3 text-[13px] leading-relaxed" style={{ color: SUB }}>
          <span style={{ color: INK }}>
            {action}
          </span>{" "}
          — target {tgt != null ? `${tgt}% SUI` : "hold current"}, holding {cur ?? 0}% now.
        </p>
      )}
      <p className="mt-1.5 font-mono text-[10px]" style={{ color: MUTED }}>
        Targets scale with conviction within each ceiling.
      </p>
    </section>
  );
}

// Playbook Intelligence — per-regime learned behavior. Not "found 3 similar
// situations"; a procedure the operator has built from settled outcomes.
function PlaybookIntelligence({ playbooks }: { playbooks: PlaybookStat[] }) {
  if (!playbooks.length) return null;
  return (
    <div className="space-y-0">
      {playbooks.map((p, i) => (
        <div
          key={p.kind}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5"
          style={{ borderTop: i === 0 ? "none" : "1px solid #F0F0F0" }}
        >
          <span className="font-sans text-[14px] font-medium tracking-tight" style={{ color: INK, minWidth: 120 }}>
            {p.label}
          </span>
          <span className="font-mono text-[11px] tabular-nums" style={{ color: SUB }}>
            seen {p.occurrences}×
          </span>
          <span className="flex-1 text-[13px]" style={{ color: SUB }}>
            {p.learned}
          </span>
          {p.winRate != null && (
            <span
              className="font-mono text-[11px] tabular-nums"
              style={{ color: p.winRate >= 50 ? EMERALD : INK }}
            >
              {Math.round(p.winRate)}% win
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// Goal Progress — "my goal", felt. A grow target shows progress toward the %;
// a protect mandate shows the drawdown guard. People adopt goals, not strategies.
function GoalCard({
  goal,
  stream,
  spanDays,
}: {
  goal: OperatorGoal | null;
  stream: AgentStreamState;
  spanDays: number | null;
}) {
  const dec = stream.decision;
  const m = dec?.mandate ?? null;
  const pnlPct = dec?.portfolio?.pnlPct ?? 0;
  const days = spanDays != null ? Math.round(spanDays) : null;

  // GROW target → progress toward the %.
  if (goal?.type === "grow" && goal.targetPct) {
    const target = goal.targetPct;
    const pctOfTarget = target > 0 ? Math.max(0, Math.min(100, (pnlPct / target) * 100)) : 0;
    const remaining =
      goal.horizonDays != null && days != null ? Math.max(0, goal.horizonDays - days) : null;
    const pnlColor = Math.abs(pnlPct) < 0.05 ? SUB : pnlPct > 0 ? EMERALD : RED;
    return (
      <GoalShell eyebrow="My goal" title={`Grow ${target}% in ${goal.horizonDays ?? "?"} days`}>
        <div className="mt-3 flex items-baseline gap-2.5">
          <span className="font-sans text-[28px] font-medium tabular-nums leading-none tracking-tight" style={{ color: pnlColor }}>
            {pnlPct > 0 ? "+" : ""}{pnlPct.toFixed(1)}%
          </span>
          <span className="font-mono text-[12px]" style={{ color: SUB }}>
            {Math.round(pctOfTarget)}% of target
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#E5E5EA" }}>
          <div className="h-full transition-[width] duration-500" style={{ width: `${pctOfTarget}%`, background: NAVY }} />
        </div>
        <p className="mt-2 font-mono text-[11px] tabular-nums" style={{ color: MUTED }}>
          {remaining != null ? `${remaining} day${remaining === 1 ? "" : "s"} remaining` : "open-ended horizon"}
        </p>
      </GoalShell>
    );
  }

  // PROTECT (or any drawdown mandate) → the guard.
  if (goal?.type === "preserve" || (m && m.maxDrawdownPct > 0)) {
    const maxDD = m && m.maxDrawdownPct > 0 ? m.maxDrawdownPct : null;
    const curDD = m ? m.drawdownPct : Math.max(0, -pnlPct);
    const healthy = !m || !m.breached;
    const fill = maxDD ? Math.max(0, Math.min(100, (curDD / maxDD) * 100)) : 0;
    return (
      <GoalShell eyebrow="My goal" title="Protect capital">
        <p className="mt-3 font-mono text-[13px] tabular-nums" style={{ color: SUB }}>
          {maxDD != null ? (
            <>
              Max drawdown {maxDD}% · <span style={{ color: INK }}>current {curDD.toFixed(1)}%</span>
            </>
          ) : (
            <>Current drawdown {curDD.toFixed(1)}%</>
          )}
          {" · "}
          <span style={{ color: healthy ? EMERALD : RED }}>{healthy ? "Healthy" : "Breached"}</span>
        </p>
        {maxDD != null && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#E5E5EA" }}>
            <div className="h-full transition-[width] duration-500" style={{ width: `${fill}%`, background: healthy ? EMERALD : RED }} />
          </div>
        )}
      </GoalShell>
    );
  }

  // EDGE / generic.
  return (
    <GoalShell eyebrow="My goal" title={objectiveLabel(goal)}>
      <p className="mt-3 text-[13px]" style={{ color: SUB }}>
        Working under your mandate{days != null && days >= 1 ? ` · ${days} day${days === 1 ? "" : "s"} in` : ""}.
      </p>
    </GoalShell>
  );
}

function GoalShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section
      className="bg-bg-elev px-6 py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-9"
      style={{ borderTop: `3px solid ${NAVY}` }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: SUB }}>
        {eyebrow}
      </p>
      <p className="mt-1.5 font-sans text-[20px] font-medium tracking-tight" style={{ color: INK }}>
        {title}
      </p>
      {children}
    </section>
  );
}

// Protected by Sui — the "why Sui" answer, visible every day (not buried in
// Proof). These are not features; they are the guarantees the chain enforces.
function ProtectedBySui({ policyId }: { policyId: string | null }) {
  const items = [
    "Budget enforced on-chain — it cannot overspend its cap",
    "Funds never leave your account — non-custodial, delegated trade-only",
    "Mandate enforced by Move — your risk limit is law, not a setting",
    "Revoke anytime — one signature stops it immediately",
    "Every decision verifiable — reasoning on Walrus, trades on Sui",
  ];
  return (
    <section className="bg-bg-elev px-6 py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-9">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: NAVY }}>
          Protected by Sui
        </p>
        {policyId && (
          <Link
            href={`/proof?policy=${policyId}`}
            className="font-mono text-[10px] uppercase tracking-[0.2em] transition-opacity hover:opacity-60"
            style={{ color: NAVY }}
          >
            See the proof →
          </Link>
        )}
      </div>
      <ul className="mt-3 space-y-1.5">
        {items.map((it) => (
          <li key={it} className="flex items-start gap-2 text-[13px] leading-relaxed" style={{ color: SUB }}>
            <span className="mt-0.5 font-sans" style={{ color: EMERALD }} aria-hidden>
              ✓
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Operator Timeline — the most alive part. Driven by the SAME decision archive
// the scorecard reads (so it can NEVER say "no decisions yet" while the count
// shows hundreds). Each beat: when, what regime, what it did with the money.
function OperatorTimeline({
  decisions,
  stream,
  traderName,
  now,
}: {
  decisions: DecisionRecord[];
  stream: AgentStreamState;
  traderName: string;
  now: number;
}) {
  if (decisions.length === 0) {
    return (
      <p className="py-10 text-center text-[13px]" style={{ color: SUB }}>
        {traderName} is booting — its first decision lands shortly.
      </p>
    );
  }
  const recent = decisions.slice(0, 14);
  return (
    <div>
      <p className="font-mono text-[11px] tabular-nums" style={{ color: SUB }}>
        {decisions.length} decision{decisions.length === 1 ? "" : "s"} recorded ·{" "}
        <span style={{ color: INK }}>its experience, anchored on Walrus</span>
      </p>
      <div className="mt-5">
        {recent.map((d, i) => (
          <TimelineDecisionRow key={`${d.ts}-${i}`} d={d} now={now} isLast={i === recent.length - 1} />
        ))}
      </div>
      {stream.walrusExperienceBlobId && (
        <div className="mt-5" style={{ borderTop: "1px solid #E5E5E5", paddingTop: 14 }}>
          <a
            href={walrusBlobUrl(stream.walrusExperienceBlobId)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] uppercase tracking-[0.22em] underline-offset-2 hover:underline"
            style={{ color: "#047857" }}
          >
            Experience memory on Walrus ↗
          </a>
        </div>
      )}
    </div>
  );
}

function TimelineDecisionRow({ d, now, isLast }: { d: DecisionRecord; now: number; isLast: boolean }) {
  const label = d.regimeKind ? REGIME_LABEL[d.regimeKind] : "Market";
  const act = d.decided;
  const tgt = d.targetExposurePct;
  const action = act
    ? d.direction === "up"
      ? `Added toward ${tgt ?? "?"}% SUI`
      : tgt === 0
        ? "Moved to cash"
        : `Trimmed toward ${tgt ?? 0}% SUI`
    : tgt != null
      ? `Held — target ${tgt}% SUI`
      : "Held — no edge";
  const color = !act ? "#CCCCCC" : d.outcome === "win" ? EMERALD : d.outcome === "loss" ? RED : "#4DA2FF";
  const tag =
    act && (d.outcome === "win" || d.outcome === "loss")
      ? `${(d.outcomePct ?? 0) >= 0 ? "+" : ""}${((d.outcomePct ?? 0) * 100).toFixed(1)}%`
      : act
        ? "settling"
        : null;
  const tagColor = d.outcome === "win" ? EMERALD : d.outcome === "loss" ? RED : SUB;
  return (
    <div className="relative flex gap-3.5">
      <div className="flex flex-col items-center pt-1">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        {!isLast && <span className="my-1 w-px flex-1" style={{ background: "#E8E8E8", minHeight: 10 }} aria-hidden />}
      </div>
      <div className={`flex-1 ${isLast ? "pb-1" : "pb-4"}`}>
        <p className="font-mono text-[10px] tabular-nums" style={{ color: MUTED }}>
          {relTime(d.ts, now)}
        </p>
        <p className="mt-0.5 text-[13.5px] leading-snug" style={{ color: INK }}>
          <span style={{ color: SUB }}>{label}</span> — {action}
          {tag && (
            <span className="ml-2 font-mono text-[11px] tabular-nums" style={{ color: tagColor }}>
              {tag}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

// Market State — a story, not a metrics grid. Trend headline + price +
// confidence-to-act + a one-line reason. Humans read stories.
function MarketState({
  signals,
  dec,
  assetLabel,
}: {
  signals: StreamSignals | null;
  dec: AgentStreamState["decision"];
  assetLabel: string;
}) {
  if (!signals || signals.spot == null) return null;
  const roc = signals.roc_30m ?? 0;
  const aligned =
    signals.sma_15m != null && signals.sma_60m != null ? signals.sma_15m >= signals.sma_60m : roc >= 0;
  const a = Math.abs(roc);
  const flat = a < 0.0008;
  const mom = momentumLabel(signals.rsi_60m).toLowerCase();
  const conf = dec ? `${Math.round(dec.conviction * 100)}%` : "—";
  // Lead with the operator's REGIME classification (its read of the market);
  // fall back to a derived trend before the first decision lands.
  const kind = dec?.regimeKind ?? null;
  const headline =
    dec?.regimeLabel ??
    (flat ? "Flat tape" : `${a > 0.008 ? "Strongly " : a > 0.003 ? "" : "Weakly "}${aligned ? "bullish" : "bearish"}`);
  const headlineColor =
    kind === "trending-up" || kind === "breakout"
      ? EMERALD
      : kind === "trending-down"
        ? RED
        : kind === "mean-reversion"
          ? AMBER
          : kind === "range-bound"
            ? SUB
            : flat
              ? SUB
              : aligned
                ? EMERALD
                : RED;
  const reason =
    dec?.regimeReview ?? (flat ? `No trend to ride — momentum ${mom}.` : `Trend present, momentum ${mom}.`);
  return (
    <section className="bg-bg-elev px-6 py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-9">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: NAVY }}>
        Market regime
      </p>
      <p className="mt-2 font-sans text-[24px] font-medium tracking-tight" style={{ color: headlineColor }}>
        {headline}
      </p>
      <p className="mt-1 font-mono text-[13px] tabular-nums" style={{ color: SUB }}>
        {assetLabel} ${signals.spot.toFixed(3)} · momentum {mom}
      </p>
      <p className="mt-3 text-[13px] leading-relaxed" style={{ color: SUB }}>
        <span style={{ color: INK }}>Confidence to act {conf}</span> — {reason}
      </p>
      {dec?.playbook && dec.playbook.occurrences > 0 && (
        <p className="mt-2 font-mono text-[11.5px] tabular-nums" style={{ color: SUB }}>
          <span style={{ color: NAVY }}>Playbook</span> · seen {dec.playbook.occurrences}× here · best play:{" "}
          {dec.playbook.bestAction === "act" ? "act" : "stand aside"}
          {dec.playbook.winRate != null ? ` · ${Math.round(dec.playbook.winRate)}% win` : ""}
        </p>
      )}
    </section>
  );
}

function SectionCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-bg-elev shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between border-b px-5 py-3 sm:px-8" style={{ borderColor: "#E5E5EA" }}>
        <span className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: NAVY }}>
          {title}
        </span>
        {action}
      </div>
      <div className="px-5 py-6 sm:px-8 sm:py-7">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// top bar
// ---------------------------------------------------------------------------

function TopBar({
  glyph,
  name,
  subname,
  dot,
  revoked,
  fuel,
  policyId,
  onYank,
  onReset,
  readOnly,
}: {
  glyph: string;
  name: string;
  subname?: string;
  dot: "act" | "preserve" | "idle" | "grounded";
  revoked: boolean;
  fuel: { deepHuman: number; level: "ok" | "low" | "empty" } | null;
  policyId: string | null;
  onYank: () => void;
  onReset: () => void;
  readOnly?: boolean;
}) {
  const dotColor =
    dot === "act" ? EMERALD : dot === "preserve" ? AMBER : dot === "grounded" ? "#CCCCCC" : IDLE;
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
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              className="truncate font-sans text-[15px] font-semibold tracking-tight"
              style={{
                color: revoked ? "#CCCCCC" : INK,
                textDecoration: revoked ? "line-through" : "none",
              }}
            >
              {name}
            </span>
            {subname && (
              <span className="hidden truncate font-mono text-[10px] sm:inline" style={{ color: MUTED }}>
                {subname}
              </span>
            )}
          </span>
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot === "act" ? "animate-pulse" : ""}`}
            style={{ background: dotColor }}
            aria-hidden
          />
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

        {/* controls — judge path (Brain · Proof) + the leash */}
        <div className="ml-auto flex items-center gap-5">
          {policyId && (
            <>
              <Link
                href={`/brain?policy=${policyId}`}
                className="hidden font-mono text-[10px] uppercase tracking-[0.2em] transition-opacity hover:opacity-70 sm:inline"
                style={{ color: NAVY }}
              >
                Brain →
              </Link>
              <Link
                href={`/proof?policy=${policyId}`}
                className="hidden font-mono text-[10px] uppercase tracking-[0.2em] transition-opacity hover:opacity-70 sm:inline"
                style={{ color: NAVY }}
              >
                Proof →
              </Link>
            </>
          )}
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
                title="Revoke on-chain — the operator stops immediately. Past wins still redeem."
                className="font-mono text-[10px] uppercase tracking-[0.2em] transition-colors hover:text-[#EF4444]"
                style={{ color: SUB }}
              >
                Revoke
              </button>
            )
          )}
          <button
            type="button"
            onClick={onReset}
            className="font-mono text-[10px] uppercase tracking-[0.2em] transition-colors hover:text-ink"
            style={{ color: SUB }}
          >
            {readOnly ? "← Operators" : "← Adopt another"}
          </button>
        </div>
      </div>

    </header>
  );
}

// ---------------------------------------------------------------------------
// "Right now" — the live decision cascade (the operator thinking)
// ---------------------------------------------------------------------------

function NowTab({
  stream,
  journal,
  stale,
  now,
  policy,
  traderName,
  revoked,
  assetLabel,
  isSpot,
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
  assetLabel: string;
  isSpot: boolean;
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
        isSpot ? (
          <SpotPipeline
            dec={dec}
            stream={stream}
            decided={decided}
            chainReached={chainReached}
            livePrice={livePrice}
            sparkPts={sparkPts}
          />
        ) : (
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
            <ChainBlock stream={stream} isSpot={isSpot} />
          </CascadeRow>
        </div>
        )
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
          {assetLabel} · 24h{isSpot ? (BRIEF_NETWORK === "testnet" ? " · live testnet pool" : " · live") : " · strike dotted"}
        </p>
        <OperatorChart
          points={journal.pricePoints}
          strikeUsd={isSpot ? null : stream.strikeUsd ?? journal.entries[0]?.strike_usd ?? null}
          decisions={chartDecisions}
          height={150}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpotPipeline — the Brief Operator's visible decision engine (gated-spot).
//
// Seven steps the user can watch execute, on real market data:
//   Observe → Build thesis → Challenge thesis → Risk review → Policy review →
//   Decision → Execution.
// AI (Claude) may author the thesis/counterargument; the Move policy still
// gates execution. Abstention renders as a SUCCESS — capital protected.
// ---------------------------------------------------------------------------

function SpotPipeline({
  dec,
  stream,
  decided,
  chainReached,
  livePrice,
  sparkPts,
}: {
  dec: AgentStreamState["decision"];
  stream: AgentStreamState;
  decided: boolean;
  chainReached: boolean;
  livePrice: number | null;
  sparkPts: number[];
}) {
  const signals = stream.signals;
  const act = !!dec?.decided;
  const up = dec?.direction === "up";
  const decTone = !dec ? IDLE : act ? (up ? EMERALD : RED) : EMERALD;
  const execTone = !act
    ? EMERALD
    : stream.mode === "live"
      ? EMERALD
      : stream.steps.mint.status === "failed"
        ? RED
        : AMBER;

  type Step = {
    key: string;
    label: string;
    body: React.ReactNode;
    tone?: string;
    emphasis?: boolean;
    pulse?: boolean;
  };
  const steps: Step[] = [
    {
      key: "observe",
      label: "Observed",
      body: (
        <span className="flex items-center gap-3">
          <span className="font-mono tabular-nums" style={{ color: INK }}>
            {usd(livePrice, 3)}
          </span>
          <Sparkline values={sparkPts} />
        </span>
      ),
    },
  ];
  if (!dec) {
    steps.push({ key: "thinking", label: "Building thesis", body: deriveThesis(signals), pulse: true });
  } else {
    if (dec.regimeLabel)
      steps.push({
        key: "regime",
        label: "Regime",
        body: dec.regimeReview || dec.regimeLabel,
      });
    if (dec.playbook)
      steps.push({ key: "playbook", label: "Recalled playbook", body: playbookLine(dec.playbook) });
    else if (dec.recall)
      steps.push({ key: "recall", label: "Recalled", body: recallLine(dec.recall) });
    steps.push({ key: "thesis", label: "Thesis", body: dec.thesis ?? "—" });
    steps.push({ key: "counter", label: "Counterargument", body: dec.counterargument ?? "—" });
    steps.push({
      key: "risk",
      label: "Risk review",
      body: <span className="font-mono text-[12px]" style={{ color: SUB }}>{dec.riskReview}</span>,
    });
    steps.push({
      key: "allocation",
      label: "Target allocation",
      body: <span className="font-mono text-[12px]" style={{ color: SUB }}>{allocationBeat(dec)}</span>,
    });
    if (act)
      steps.push({
        key: "exec",
        label: "Execution · DeepBook",
        body: <span className="font-mono text-[12px]" style={{ color: SUB }}>{dec.executionReview}</span>,
      });
    steps.push({
      key: "policy",
      label: "Policy check",
      body: <span className="font-mono text-[12px]" style={{ color: SUB }}>{dec.policyReview}</span>,
    });
    steps.push({
      key: "decision",
      label: "Decision",
      tone: decTone,
      emphasis: true,
      body: (
        <span>
          <span style={{ color: decTone }}>{act ? (up ? "ADD TO SUI ▲" : "TRIM SUI ▼") : "HOLD"}</span>
          {dec.allocation && (
            <span className="ml-2 font-sans text-[13px] font-normal" style={{ color: SUB }}>
              {dec.allocation}
            </span>
          )}
        </span>
      ),
    });
    steps.push({
      key: "result",
      label: "Result",
      tone: execTone,
      emphasis: true,
      body: !act ? (
        <span className="font-sans text-[14px] font-medium" style={{ color: EMERALD }}>
          {holdResult(dec)}
        </span>
      ) : chainReached ? (
        <ChainBlock stream={stream} isSpot />
      ) : (
        <span className="op-breathe font-mono text-[12px] uppercase tracking-[0.18em]" style={{ color: AMBER }}>
          placing order…
        </span>
      ),
    });
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {dec?.mode && (
          <span
            className="border px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.18em]"
            style={{ borderColor: "#E5E5EA", color: INK }}
          >
            {dec.mode} mode
          </span>
        )}
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em]" style={{ color: SUB }}>
          {dec?.aiReasoned ? "Reasoned by Claude · enforced by Move" : "Reasoning engine · enforced by Move"}
        </span>
      </div>
      {steps.map((s, i) => (
        <TimelineStep
          key={s.key}
          label={s.label}
          tone={s.tone}
          emphasis={s.emphasis}
          pulse={s.pulse}
          isLast={i === steps.length - 1}
          delay={i * 70}
        >
          {s.body}
        </TimelineStep>
      ))}
    </div>
  );
}

// A single beat in the living timeline — ● dot + connector, fading in in turn.
function TimelineStep({
  label,
  children,
  tone,
  emphasis,
  pulse,
  isLast,
  delay,
}: {
  label: string;
  children: React.ReactNode;
  tone?: string;
  emphasis?: boolean;
  pulse?: boolean;
  isLast?: boolean;
  delay: number;
}) {
  const dot = tone ?? NAVY;
  return (
    <div
      className="relative flex animate-fade-up gap-3.5"
      style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}
    >
      <div className="flex flex-col items-center pt-1">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${pulse ? "animate-pulse" : ""}`}
          style={{ background: dot }}
          aria-hidden
        />
        {!isLast && (
          <span className="my-1 w-px flex-1" style={{ background: "#E8E8E8", minHeight: 12 }} aria-hidden />
        )}
      </div>
      <div className={`flex-1 ${isLast ? "pb-1" : "pb-4"}`}>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.2em]" style={{ color: emphasis ? dot : SUB }}>
          {label}
        </p>
        <div
          className={`mt-1 leading-snug ${emphasis ? "font-mono text-[16px] font-medium tracking-tight" : "text-[13px]"}`}
          style={{ color: INK }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function recallLine(recall: NonNullable<AgentStreamState["decision"]>["recall"]): string {
  if (!recall) return "—";
  if (recall.found === 0) return "First time in conditions like these — recording it.";
  const effect =
    recall.confidenceMult < 0.99
      ? "confidence reduced"
      : recall.confidenceMult > 1.01
        ? "confidence reinforced"
        : "confidence held";
  return `${recall.found} similar · ${recall.wins}W / ${recall.losses}L → ${effect}`;
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

function ChainBlock({ stream, isSpot }: { stream: AgentStreamState; isSpot: boolean }) {
  const tx = stream.deliveredTx ?? stream.mintTx;
  const refused = stream.steps.mint.status === "failed";
  const live = stream.mode === "live";
  // For a spot operator, "not live" means it abstained (no order placed) —
  // that's discipline, not a fake/off-chain sim. Word it honestly.
  const verdict = refused
    ? { text: "Chain refused", color: RED }
    : live
      ? { text: isSpot ? "Executed on DeepBook" : "Policy verified", color: EMERALD }
      : {
          text: isSpot ? "Stood down — no order placed" : "Simulated · off-chain",
          color: AMBER,
        };
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
  isSpot,
}: {
  journal: ReturnType<typeof useOperatorJournal>;
  stream: AgentStreamState;
  traderName: string;
  now: number;
  isSpot: boolean;
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
        {isSpot ? (
          <span style={{ color: EMERALD }}>
            {stats.liveOnChain} on-chain trade{stats.liveOnChain === 1 ? "" : "s"}
          </span>
        ) : stats.winRate != null ? (
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
          {traderName}&apos;s experience is permanently stored on Walrus — and it&apos;s
          not a log it forgets: the operator <span style={{ color: INK }}>recalls similar
          past situations from this memory before every decision</span>. Verifiable by anyone.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {stream.walrusExperienceBlobId && (
            <a
              href={walrusBlobUrl(stream.walrusExperienceBlobId)}
              target="_blank"
              rel="noreferrer"
              className="inline-block font-mono text-[10px] uppercase tracking-[0.22em] underline-offset-2 hover:underline"
              style={{ color: "#047857" }}
            >
              Experience memory on Walrus ↗
            </a>
          )}
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
        ? `Preserved capital. The market swung ${e.swingPct.toFixed(1)}% — volatility it sat out.`
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
  const bvp = budgetView(policy);
  const cap = bvp.cap;
  const spent = bvp.spent;
  const remaining = Math.max(0, cap - spent);
  const goalCal = goal && personality ? calibrateParams(personality.strategy, goal) : null;
  const goalBase = personality ? calibrateParams(personality.strategy, { type: "edge" }) : null;
  const rows: Array<[string, React.ReactNode]> = [
    ["Status", <span key="s" style={{ color: revoked ? RED : EMERALD }}>{(status ?? "active").toUpperCase()}</span>],
    ["Budget cap", `${cap.toFixed(2)} ${bvp.unit}`],
    ["Spent", `${spent.toFixed(2)} ${bvp.unit}`],
    ["Remaining", `${remaining.toFixed(2)} ${bvp.unit}`],
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
        after revocation; the kill switch blocks new trades, never your funds.
      </p>

      {/* Lifecycle — answer "how do I leave?" plainly. */}
      <div className="mt-6 border-t pt-5" style={{ borderColor: "#E5E5EA" }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: NAVY }}>
          Lifecycle
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]" style={{ color: SUB }}>
          <span style={{ color: revoked ? "#999999" : EMERALD }}>Active</span>
          <span style={{ color: "#C7C7CC" }}>→</span>
          <span style={{ color: revoked ? "#EF4444" : SUB }}>Revoke</span>
          <span style={{ color: "#C7C7CC" }}>→</span>
          <span style={{ color: SUB }}>Withdraw</span>
          <span style={{ color: "#C7C7CC" }}>→</span>
          <span style={{ color: SUB }}>Done</span>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed" style={{ color: SUB }}>
          Your capital never left your custody — it&apos;s in{" "}
          <span style={{ color: INK }}>your own DeepBook BalanceManager</span>. Revoke
          stops the operator on-chain. To take funds out, you withdraw from your
          BalanceManager — <span style={{ color: INK }}>only you hold the WithdrawCap</span>,
          so neither the operator nor we ever can.
        </p>
      </div>
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
            title={`${e.oracle_id ? "BTC" : "SUI"} · ${e.abstained ? "preserved" : (e.direction ?? "").toUpperCase()} · ${e.settlement}`}
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
