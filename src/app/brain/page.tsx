"use client";

// /brain — the Operator Brain. The centerpiece surface: one decision at a
// time, read like a pilot's black box. What I Saw → What I Remembered → What
// Could Go Wrong → Execution Quality → Policy Check → Decision → Outcome.
//
// Read-only and public (no wallet) — a judge opens /brain?policy=0x… and reads
// the mind of a financial operator, with the outcome attributed. Same
// Walrus-anchored experience the operator recalls from. Huge whitespace, navy
// section headers, white institutional aesthetic.

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";

import { apiUrl } from "@/lib/api-base";
import { explorerUrl, momentumLabel } from "@/lib/brief-client";
import { loadLatestTraderIdentity } from "@/lib/workforce-client";

const INK = "#0A0A0A";
const SUB = "#525560";
const MUTED = "#8E8E93";
const NAVY = "#1a2c4e";
const EMERALD = "#10B981";
const RED = "#EF4444";
const AMBER = "#F59E0B";
const BLUE = "#4DA2FF";
const LINE = "#E5E5EA";

type Detail = {
  thesis?: string;
  counterargument?: string;
  riskReview?: string;
  executionReview?: string;
  mandateReview?: string;
  policyReview?: string;
  verdict?: string;
  recallNote?: string;
  recallFound?: number;
  recallWins?: number;
  recallLosses?: number;
  txDigest?: string | null;
};
type Regime = { roc30: number; rsi: number; trend: number; vol: number };
type Decision = {
  ts: number;
  seq?: number;
  regime: Regime;
  direction: "up" | "down";
  decided: boolean;
  confidence: number;
  mid: number;
  outcome: "win" | "loss" | "abstained" | "pending";
  outcomePct?: number;
  detail?: Detail;
};

export default function BrainPage() {
  return (
    <Suspense fallback={null}>
      <Brain />
    </Suspense>
  );
}

function Brain() {
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("policy");
    setPolicyId(p && p.startsWith("0x") ? p : loadLatestTraderIdentity()?.policyId ?? null);
  }, []);

  useEffect(() => {
    if (!policyId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(apiUrl(`/api/operators/decisions?policy_id=${encodeURIComponent(policyId)}`));
        const j = (await r.json()) as { decisions?: Decision[] };
        if (!cancelled) setDecisions(j.decisions ?? []);
      } catch {
        if (!cancelled) setDecisions([]);
      }
    };
    void load();
    const t = setInterval(load, 12_000);
    const c = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      cancelled = true;
      clearInterval(t);
      clearInterval(c);
    };
  }, [policyId]);

  const stats = useMemo(() => computeStats(decisions ?? []), [decisions]);
  const total = decisions?.length ?? 0;
  const safeIdx = total ? Math.min(idx, total - 1) : 0;
  const current = decisions?.[safeIdx];

  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
        {/* Eyebrow + judge-path nav */}
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em]" style={{ color: NAVY }}>
            Operator Brain
          </p>
          {policyId && (
            <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.18em]">
              <Link href={`/workforce?policy=${policyId}`} className="transition-opacity hover:opacity-60" style={{ color: MUTED }}>
                ← Dashboard
              </Link>
              <Link href={`/proof?policy=${policyId}`} className="transition-opacity hover:opacity-60" style={{ color: NAVY }}>
                Proof →
              </Link>
            </div>
          )}
        </div>

        <h1 className="mt-4 font-sans text-[30px] font-medium leading-tight tracking-tight sm:text-[40px]">
          Read the operator&apos;s mind.
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed" style={{ color: SUB }}>
          Every decision, as the operator reasoned it — and how it turned out.
          Nothing hidden.
        </p>

        {decisions && decisions.length > 0 && <EvolveBar stats={stats} />}

        <div className="mt-10">
          {decisions === null ? (
            <p className="py-20 text-center font-mono text-[11px] uppercase tracking-[0.28em]" style={{ color: MUTED }}>
              {policyId ? "reading the operator…" : "no operator selected"}
            </p>
          ) : decisions.length === 0 ? (
            <LearningState policyId={policyId} />
          ) : current ? (
            <FocusedDecision
              d={current}
              now={now}
              index={safeIdx}
              total={total}
              onPrev={() => setIdx(Math.min(total - 1, safeIdx + 1))}
              onNext={() => setIdx(Math.max(0, safeIdx - 1))}
              onJump={setIdx}
              decisions={decisions}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

// ── The focused, one-at-a-time decision — the black-box readout ──────────────

function FocusedDecision({
  d,
  now,
  index,
  total,
  onPrev,
  onNext,
  onJump,
  decisions,
}: {
  d: Decision;
  now: number;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
  decisions: Decision[];
}) {
  const oc = outcomeView(d);
  const act = d.decided;
  const up = d.direction === "up";
  const verdictColor = act ? (up ? EMERALD : RED) : EMERALD;
  const reg = d.regime;
  const detail = d.detail ?? {};

  return (
    <div>
      {/* prev/next header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onPrev}
          disabled={index >= total - 1}
          className="font-mono text-[11px] uppercase tracking-[0.18em] transition-opacity hover:opacity-60 disabled:opacity-25"
          style={{ color: MUTED }}
        >
          ← older
        </button>
        <span className="font-mono text-[11px] tabular-nums" style={{ color: MUTED }}>
          Decision #{d.seq ?? "—"} · {relTime(d.ts, now)}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={index <= 0}
          className="font-mono text-[11px] uppercase tracking-[0.18em] transition-opacity hover:opacity-60 disabled:opacity-25"
          style={{ color: MUTED }}
        >
          newer →
        </button>
      </div>

      {/* the card */}
      <div
        key={d.seq ?? d.ts}
        className="animate-fade-up mt-5 bg-bg-elev px-6 py-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-10 sm:py-10"
        style={{ borderTop: `3px solid ${verdictColor}` }}
      >
        <Section label="What I saw">
          <Big>
            {`$${d.mid.toFixed(3)}`} ·{" "}
            {reg.trend > 0 ? "trending higher" : reg.trend < 0 ? "trending lower" : "flat"}
          </Big>
          <Sub>
            momentum {momentumLabel(reg.rsi).toLowerCase()} ·{" "}
            {reg.vol < 0.008 ? "low" : reg.vol < 0.02 ? "moderate" : "high"} volatility
          </Sub>
        </Section>

        <Section label="What I remembered">
          {detail.recallFound && detail.recallFound > 0 ? (
            <>
              <Big>
                {detail.recallFound} similar situation{detail.recallFound === 1 ? "" : "s"}
              </Big>
              <Sub>
                <span style={{ color: EMERALD }}>{detail.recallWins ?? 0} profitable</span>
                {" · "}
                <span style={{ color: RED }}>{detail.recallLosses ?? 0} unprofitable</span>
                {detail.recallNote ? ` — ${tail(detail.recallNote)}` : ""}
              </Sub>
            </>
          ) : (
            <Big dim>First time in conditions like these — no memory to lean on yet.</Big>
          )}
        </Section>

        <Section label="What could go wrong">
          <Body>{detail.counterargument ?? "—"}</Body>
        </Section>

        <Section label="Execution quality">
          <Body mono>
            {act ? detail.executionReview ?? "—" : "No order intended — execution not evaluated."}
          </Body>
        </Section>

        <Section label="Policy check">
          <Body mono>{detail.policyReview ?? "—"}</Body>
          {detail.mandateReview && <Body mono>{detail.mandateReview}</Body>}
        </Section>

        <Section label="Decision">
          <p className="font-mono text-[26px] font-medium tracking-tight" style={{ color: verdictColor }}>
            {act ? `${up ? "BUY ▲" : "SELL ▼"}` : "NO TRADE"}
            <span className="ml-3 font-sans text-[14px] font-normal" style={{ color: SUB }}>
              {(d.confidence * 100).toFixed(0)}% confidence
            </span>
          </p>
          {detail.verdict && <Sub>{detail.verdict}</Sub>}
        </Section>

        <Section label="Outcome" last>
          <p className="font-mono text-[18px]" style={{ color: oc.color }}>
            {oc.headline}
          </p>
          <Sub>{oc.detail}</Sub>
          {detail.txDigest && (
            <a
              href={explorerUrl("txblock", detail.txDigest)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-mono text-[11px] underline-offset-2 hover:underline"
              style={{ color: NAVY }}
            >
              {short(detail.txDigest, 6)} on Suiscan ↗
            </a>
          )}
        </Section>
      </div>

      {/* slim jump rail — recent decisions as dots */}
      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {decisions.slice(0, 24).map((dd, i) => {
          const c = outcomeView(dd).color;
          return (
            <button
              key={dd.seq ?? `${dd.ts}-${i}`}
              type="button"
              onClick={() => onJump(i)}
              title={`Decision #${dd.seq ?? "—"}`}
              className="h-2 w-2 rounded-full transition-transform hover:scale-150"
              style={{ background: i === index ? NAVY : c, outline: i === index ? `2px solid ${NAVY}` : "none", outlineOffset: 2 }}
              aria-label={`decision ${dd.seq}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function Section({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={last ? "" : "mb-8"}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: NAVY }}>
        {label}
      </p>
      {children}
    </div>
  );
}
function Big({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <p className="font-sans text-[19px] font-medium leading-snug tracking-tight" style={{ color: dim ? SUB : INK }}>
      {children}
    </p>
  );
}
function Sub({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: SUB }}>{children}</p>;
}
function Body({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <p className={`${mono ? "font-mono text-[12.5px]" : "text-[14px]"} leading-relaxed`} style={{ color: mono ? SUB : INK }}>
      {children}
    </p>
  );
}

// ── Educational empty state — the operator is learning, not idle ─────────────

function LearningState({ policyId }: { policyId: string | null }) {
  const ramp = [
    { at: 1, label: "Observing the market", done: false },
    { at: 5, label: "Pattern recognition begins", done: false },
    { at: 20, label: "Confidence calibration begins", done: false },
  ];
  return (
    <div className="bg-bg-elev px-6 py-10 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-10" style={{ borderTop: `3px solid ${NAVY}` }}>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: EMERALD }} aria-hidden />
        <span className="font-mono text-[11px] uppercase tracking-[0.24em]" style={{ color: EMERALD }}>
          {policyId ? "Operator active · learning" : "No operator selected"}
        </span>
      </div>
      <p className="mt-4 font-sans text-[20px] font-medium tracking-tight" style={{ color: INK }}>
        {policyId
          ? "The operator is observing the market to build its memory."
          : "Open /brain?policy=0x… or adopt an operator."}
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: SUB }}>
        Every cycle it records what it saw and what it decided. As that memory
        grows, it starts recalling similar past situations — and their outcomes
        reshape its confidence. Here&apos;s how it ramps:
      </p>

      <div className="mt-6 space-y-3">
        {ramp.map((r) => (
          <div key={r.at} className="flex items-center gap-3">
            <span className="flex h-6 w-9 shrink-0 items-center justify-center font-mono text-[11px] tabular-nums" style={{ background: "#F5F5F7", color: NAVY }}>
              {r.at}
            </span>
            <span className="text-[13.5px]" style={{ color: INK }}>{r.label}</span>
          </div>
        ))}
      </div>

      <p className="mt-6 font-mono text-[10.5px] leading-relaxed" style={{ color: MUTED }}>
        Experience accumulates on Walrus — verifiable, and the same memory the
        operator reasons from. First decision usually lands within a minute.
      </p>
      {!policyId && (
        <Link
          href="/workforce/adopt"
          className="mt-6 inline-block px-6 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-bg transition-opacity hover:opacity-90"
          style={{ background: NAVY }}
        >
          Adopt an operator →
        </Link>
      )}
    </div>
  );
}

// ── stats + helpers ─────────────────────────────────────────────────────────

function EvolveBar({ stats }: { stats: ReturnType<typeof computeStats> }) {
  const evolving = stats.recentWinRate != null && stats.priorWinRate != null;
  const delta = evolving ? stats.recentWinRate! - stats.priorWinRate! : 0;
  return (
    <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-4" style={{ background: LINE }}>
      <Stat label="Decisions" value={String(stats.total)} />
      <Stat label="Capital preserved" value={`${stats.preservedPct.toFixed(0)}%`} color={AMBER} />
      <Stat label="Win rate" value={stats.winRate == null ? "—" : `${stats.winRate.toFixed(0)}%`} color={stats.winRate != null && stats.winRate >= 50 ? EMERALD : INK} />
      <Stat
        label="Evolving"
        value={evolving ? `${stats.priorWinRate!.toFixed(0)}→${stats.recentWinRate!.toFixed(0)}%` : "building"}
        color={evolving ? (delta >= 0 ? EMERALD : RED) : MUTED}
      />
    </div>
  );
}
function Stat({ label, value, color = INK }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-elev px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>{label}</p>
      <p className="mt-1 font-mono text-[15px] tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}

function computeStats(ds: Decision[]) {
  const acts = ds.filter((d) => d.decided);
  const settled = acts.filter((d) => d.outcome === "win" || d.outcome === "loss");
  const wins = settled.filter((d) => d.outcome === "win").length;
  const winRate = settled.length ? (wins / settled.length) * 100 : null;
  const preservedPct = ds.length ? (ds.filter((d) => !d.decided).length / ds.length) * 100 : 0;
  const rate = (rs: Decision[]) => (rs.length ? (rs.filter((d) => d.outcome === "win").length / rs.length) * 100 : null);
  const recent = settled.slice(0, 10);
  const prior = settled.slice(10, 20);
  return {
    total: ds.length,
    winRate,
    preservedPct,
    recentWinRate: recent.length >= 3 ? rate(recent) : null,
    priorWinRate: prior.length >= 3 ? rate(prior) : null,
  };
}

function outcomeView(d: Decision): { headline: string; detail: string; color: string } {
  if (!d.decided) return { headline: "Capital protected", detail: "No trade — discipline, not inaction.", color: AMBER };
  if (d.outcome === "pending") return { headline: "Settling", detail: "Acted on chain. Outcome settling against later price.", color: BLUE };
  if (d.outcome === "win")
    return { headline: d.outcomePct != null ? `+${(d.outcomePct * 100).toFixed(2)}%` : "Won", detail: "The directional call landed.", color: EMERALD };
  if (d.outcome === "loss")
    return { headline: d.outcomePct != null ? `${(d.outcomePct * 100).toFixed(2)}%` : "Lost", detail: "Moved against the call. An honest loss.", color: RED };
  return { headline: "Acted", detail: "Acted on chain.", color: INK };
}

function tail(note: string): string {
  const i = note.indexOf(":");
  return i >= 0 ? note.slice(i + 1).trim() : note;
}
function short(s: string, n = 5): string {
  return s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s;
}
function relTime(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
