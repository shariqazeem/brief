"use client";

// /brain · the Operator Brain. The centerpiece surface: one decision at a
// time, read like a pilot's black box. What I Saw → What I Remembered → What
// Could Go Wrong → Execution Quality → Policy Check → Decision → Outcome.
//
// Read-only and public (no wallet) · a judge opens /brain?policy=0x… and reads
// the mind of a financial operator, with the outcome attributed. Same
// Walrus-anchored experience the operator recalls from. Huge whitespace, navy
// section headers, white institutional aesthetic.

import { Shield, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";

import EvidenceBadge from "@/components/shared/EvidenceBadge";
import { apiUrl } from "@/lib/api-base";
import { explorerUrl, momentumLabel } from "@/lib/brief-client";
import { INK, SUB, MUTED, NAVY, EMERALD, RED, AMBER, BLUE, LINE } from "@/lib/ui";
import { loadLatestTraderIdentity } from "@/lib/workforce-client";

type Detail = {
  regimeLabel?: string;
  regimeReview?: string;
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
  aiReasoned?: boolean;
  aiSource?: string | null;
  aiBlobId?: string | null;
  /** The full AI verdict · deterministic → modifier → final + direction/veto. */
  aiConfidenceMod?: number | null;
  aiDirection?: "up" | "down" | "abstain" | null;
  aiVeto?: boolean | null;
  aiRationale?: string | null;
  baseConfidence?: number | null;
  /** Per-decision Risk-Guardian checkpoint state. Optional · old records omit it. */
  guardianPaused?: boolean;
  guardianReason?: string | null;
};
type Regime = { roc30: number; rsi: number; trend: number; vol: number };
type Decision = {
  ts: number;
  seq?: number;
  regime: Regime;
  direction: "up" | "down";
  /** Which token this decision was about (SUI | WAL | DEEP). Older records omit it. */
  asset?: string;
  decided: boolean;
  confidence: number;
  mid: number;
  outcome: "win" | "loss" | "abstained" | "pending";
  outcomePct?: number;
  /** Target allocation for `asset` at decision time (0–100), if it set one. */
  targetExposurePct?: number | null;
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
              <Link href={`/evolution?policy=${policyId}`} className="transition-opacity hover:opacity-60" style={{ color: MUTED }}>
                Evolution
              </Link>
              <Link href={`/results?policy=${policyId}`} className="transition-opacity hover:opacity-60" style={{ color: NAVY }}>
                Results →
              </Link>
            </div>
          )}
        </div>

        <h1 className="mt-4 font-sans text-[30px] font-medium leading-tight tracking-tight sm:text-[40px]">
          Read the operator&apos;s mind.
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed" style={{ color: SUB }}>
          Every decision, as the operator reasoned it · and how it turned out.
          Nothing hidden.
        </p>

        {decisions && decisions.length > 0 && <EvolveBar stats={stats} />}

        <div className="mt-10">
          {decisions === null ? (
            <p className="py-20 text-center font-mono text-[11px] uppercase tracking-[0.28em]" style={{ color: MUTED }}>
              {policyId ? "reading the operator…" : "no operator selected"}
            </p>
          ) : decisions.length === 0 ? (
            <>
              <p className="mb-8 text-center font-sans text-[16px] leading-relaxed" style={{ color: SUB }}>
                The operator is still observing — its first reasoning will appear here.
              </p>
              <LearningState policyId={policyId} />
            </>
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

// ── The focused, one-at-a-time decision · the black-box readout ──────────────

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
  const asset = d.asset ?? "SUI";
  const verdictColor = act ? (up ? EMERALD : RED) : EMERALD;
  const reg = d.regime;
  const detail = d.detail ?? {};

  // On-demand narration (budget-safe: one call per click, never in the loop).
  const [narration, setNarration] = useState<string | null>(null);
  const [narrating, setNarrating] = useState(false);
  useEffect(() => {
    setNarration(null);
  }, [d.seq, d.ts]);
  const narrate = async () => {
    setNarrating(true);
    try {
      const r = await fetch(apiUrl("/api/operators/narrate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regime: detail.regimeLabel,
          thesis: detail.thesis,
          counter: detail.counterargument,
          action: act ? (up ? `added to ${asset}` : `trimmed ${asset}`) : "held its position",
          target: d.targetExposurePct != null ? `${d.targetExposurePct}% ${asset}` : undefined,
          outcome: oc.headline,
        }),
      });
      const j = (await r.json()) as { narration?: string };
      setNarration(j.narration ?? "Narration unavailable.");
    } catch {
      setNarration("Narration unavailable.");
    }
    setNarrating(false);
  };

  return (
    <div>
      {/* prev/next header · browse decisions like stories */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onPrev}
          disabled={index >= total - 1}
          aria-label="Older decision"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors hover:border-ink disabled:opacity-25"
          style={{ borderColor: LINE, color: INK }}
        >
          ← older
        </button>
        <span className="inline-flex items-center gap-2 font-mono text-[11px] tabular-nums" style={{ color: MUTED }}>
          Decision #{d.seq ?? "-"} · {relTime(d.ts, now)}
          {detail.aiReasoned && (
            <span
              className="inline-flex items-center bg-[#1a2c4e] px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-white"
              title={detail.aiSource ? `Reasoned by ${detail.aiSource}` : "LLM-reasoned"}
            >
              {modelLabel(detail.aiSource)}
            </span>
          )}
          <GuardianBeat detail={detail} />
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={index <= 0}
          aria-label="Newer decision"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors hover:border-ink disabled:opacity-25"
          style={{ borderColor: LINE, color: INK }}
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
        {/* Five cinematic blocks · watch the intelligence, don't read logs. */}
        <BigBlock
          label="What it saw"
          headline={detail.regimeLabel ?? (reg.trend > 0 ? "Trending higher" : reg.trend < 0 ? "Trending lower" : "Flat tape")}
          color={regimeColor(detail.regimeLabel, reg.trend)}
          sub={`${asset} $${d.mid < 1 ? d.mid.toFixed(4) : d.mid.toFixed(2)} · momentum ${momentumLabel(reg.rsi).toLowerCase()} · ${reg.vol < 0.008 ? "low" : reg.vol < 0.02 ? "moderate" : "high"} volatility`}
        />

        <BigBlock
          label="What it remembered"
          headline={
            detail.recallFound && detail.recallFound > 0
              ? `${detail.recallFound} similar situation${detail.recallFound === 1 ? "" : "s"} · ${detail.recallWins ?? 0}W / ${detail.recallLosses ?? 0}L`
              : "First time in conditions like these"
          }
          color={INK}
          dim={!detail.recallFound}
          sub={detail.recallFound && detail.recallFound > 0 ? (detail.recallNote ? tail(detail.recallNote) : undefined) : "Recording it so future cycles can recall how it played out."}
        />

        <BigBlock
          label="What it feared"
          headline={detail.counterargument ?? "No strong counter-signal."}
          color={INK}
          sub={act ? detail.executionReview ?? undefined : undefined}
        />

        {/* What the AI advised · the load-bearing LLM layer, shown as a chain:
            deterministic conviction → AI modifier → final, plus the verdict.
            Renders only when the LLM actually shaped this decision. */}
        {detail.aiReasoned && detail.baseConfidence != null && (
          <AiReviewBlock d={d} detail={detail} />
        )}

        {/* Guardian Review · the per-decision circuit-breaker checkpoint.
            Renders only when the record carries guardian state (back-compat). */}
        {detail.guardianPaused !== undefined && (
          <div className="mb-9 -mt-3 flex items-center gap-2">
            {detail.guardianPaused ? (
              <ShieldAlert size={15} strokeWidth={1.9} aria-hidden style={{ color: RED }} />
            ) : (
              <Shield size={15} strokeWidth={1.9} aria-hidden style={{ color: EMERALD }} />
            )}
            <span
              className="font-mono text-[10px] uppercase tracking-[0.2em]"
              style={{ color: detail.guardianPaused ? RED : EMERALD }}
            >
              {detail.guardianPaused
                ? `Guardian · paused${detail.guardianReason ? ` — ${detail.guardianReason}` : ""}`
                : "Guardian · monitoring"}
            </span>
          </div>
        )}

        <BigBlock
          label="What it did"
          emphasis
          headline={act ? (up ? `Added to ${asset} ▲` : `Trimmed ${asset} ▼`) : "Held position"}
          color={verdictColor}
          sub={
            d.targetExposurePct != null
              ? `Target ${d.targetExposurePct}% ${asset} · ${100 - d.targetExposurePct}% cash · ${(d.confidence * 100).toFixed(0)}% confidence`
              : `${(d.confidence * 100).toFixed(0)}% confidence`
          }
        />

        <BigBlock
          label="What happened"
          headline={oc.headline}
          color={oc.color}
          sub={oc.detail}
          last
        />
        {detail.txDigest && (
          <a
            href={explorerUrl("txblock", detail.txDigest)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block font-mono text-[11px] underline-offset-2 hover:underline"
            style={{ color: NAVY }}
          >
            {short(detail.txDigest, 6)} on Suiscan ↗
          </a>
        )}
        {detail.aiBlobId && (
          <div className="mt-3">
            <EvidenceBadge
              type="walrus"
              href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${detail.aiBlobId}`}
              label="AI reasoning on Walrus"
            />
          </div>
        )}

        {/* On-demand narration · plain English, in a click */}
        <div className="mt-8" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 16 }}>
          {narration ? (
            <p className="text-[15px] leading-relaxed" style={{ color: INK }}>
              {narration}
            </p>
          ) : (
            <button
              type="button"
              onClick={narrate}
              disabled={narrating}
              className="font-mono text-[10px] uppercase tracking-[0.2em] transition-opacity hover:opacity-60 disabled:opacity-40"
              style={{ color: NAVY }}
            >
              {narrating ? "Narrating…" : "Narrate this decision →"}
            </button>
          )}
        </div>
      </div>

      {/* slim jump rail · recent decisions as dots */}
      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {decisions.slice(0, 24).map((dd, i) => {
          const c = outcomeView(dd).color;
          return (
            <button
              key={dd.seq ?? `${dd.ts}-${i}`}
              type="button"
              onClick={() => onJump(i)}
              title={`Decision #${dd.seq ?? "-"}`}
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

// A cinematic block · huge headline, one supporting line. Read in a glance.
function BigBlock({
  label,
  headline,
  color,
  sub,
  dim,
  last,
  emphasis,
}: {
  label: string;
  headline: string;
  color?: string;
  sub?: string;
  dim?: boolean;
  last?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className={last ? "" : "mb-9"}>
      <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: NAVY }}>
        {label}
      </p>
      <p
        className={
          emphasis
            ? "font-sans text-[32px] font-semibold leading-[1.1] tracking-tight sm:text-[42px]"
            : "font-sans text-[24px] font-medium leading-[1.14] tracking-tight sm:text-[30px]"
        }
        style={{ color: dim ? SUB : color ?? INK }}
      >
        {headline}
      </p>
      {sub && (
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: SUB }}>
          {sub}
        </p>
      )}
    </div>
  );
}

// What the AI advised · the load-bearing LLM layer made legible. Shows the full
// chain — deterministic conviction → AI modifier → final conviction — plus the
// AI's verdict (sharpen / dampen / veto). This is the Intelligence pillar: a
// judge can see the AI actually moved the number, not just "AI was involved".
function AiReviewBlock({ d, detail }: { d: Decision; detail: Detail }) {
  const base = detail.baseConfidence ?? d.confidence;
  const mod = detail.aiConfidenceMod ?? 0;
  const final = d.confidence;
  const veto = detail.aiVeto === true;
  const modPct = `${mod >= 0 ? "+" : ""}${Math.round(mod * 100)}%`;
  const modColor = veto ? RED : mod > 0 ? EMERALD : mod < 0 ? AMBER : MUTED;
  const verdict = veto
    ? "Vetoed the trade"
    : detail.aiDirection === "abstain"
      ? "Advised standing aside"
      : mod > 0
        ? "Sharpened conviction"
        : mod < 0
          ? "Dampened conviction"
          : "Confirmed the read";
  const Stat = ({ label, value, color, big }: { label: string; value: string; color: string; big?: boolean }) => (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: MUTED }}>{label}</span>
      <span className={`font-mono tabular-nums ${big ? "text-2xl" : "text-lg"}`} style={{ color }}>{value}</span>
    </div>
  );
  return (
    <div className="mb-9 -mt-2 px-5 py-4" style={{ border: `1px solid ${LINE}`, borderLeft: `3px solid ${NAVY}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: NAVY }}>
          What the AI advised · {modelLabel(detail.aiSource)}
        </span>
        <span
          className="inline-flex items-center px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
          style={{ color: veto ? RED : NAVY, border: `1px solid ${veto ? RED : LINE}` }}
        >
          {verdict}
        </span>
      </div>
      <div className="mt-4 flex items-end gap-4 sm:gap-6">
        <Stat label="Deterministic" value={`${Math.round(base * 100)}%`} color={MUTED} />
        <span className="pb-1 font-mono text-sm" style={{ color: MUTED }}>→</span>
        <Stat label="AI shift" value={veto ? "VETO" : modPct} color={modColor} />
        <span className="pb-1 font-mono text-sm" style={{ color: MUTED }}>→</span>
        <Stat label="Final conviction" value={`${Math.round(final * 100)}%`} color={INK} big />
      </div>
      {detail.aiRationale && (
        <p className="mt-3 text-[13px] leading-relaxed" style={{ color: SUB }}>{detail.aiRationale}</p>
      )}
    </div>
  );
}

// At-a-glance Guardian state for the decision header · a small Shield icon with
// an accessible label/tooltip. Renders nothing for older records (back-compat).
function GuardianBeat({ detail }: { detail: Detail }) {
  if (detail.guardianPaused === undefined) return null;
  const paused = detail.guardianPaused;
  const label = paused
    ? `Guardian: paused${detail.guardianReason ? ` — ${detail.guardianReason}` : ""}`
    : "Guardian: monitoring";
  return (
    <span className="inline-flex" title={label} aria-label={label} role="img">
      {paused ? (
        <ShieldAlert size={14} strokeWidth={1.9} aria-hidden style={{ color: RED }} />
      ) : (
        <Shield size={14} strokeWidth={1.9} aria-hidden style={{ color: EMERALD }} />
      )}
    </span>
  );
}

// Clean, human model label from a raw aiSource (e.g. "claude-3-5-haiku-latest"
// → "Claude Haiku", "deepseek/deepseek-v4-flash" → "DeepSeek v4-flash"). Falls
// back to a generic "AI" badge when the source is unknown.
function modelLabel(source: string | null | undefined): string {
  if (!source) return "AI";
  const s = source.toLowerCase();
  if (s.includes("claude")) {
    if (s.includes("haiku")) return "Claude Haiku";
    if (s.includes("sonnet")) return "Claude Sonnet";
    if (s.includes("opus")) return "Claude Opus";
    return "Claude";
  }
  if (s.includes("deepseek")) {
    const m = /v\d[\w.-]*/.exec(s);
    return m ? `DeepSeek ${m[0]}` : "DeepSeek";
  }
  if (s.includes("gpt")) return "GPT";
  // Unknown model · show its last path segment, tidied, capped for the pill.
  const tail = source.split("/").pop() ?? source;
  return tail.length > 18 ? `${tail.slice(0, 17)}…` : tail;
}

function regimeColor(label: string | undefined, trend: number): string {
  const l = (label ?? "").toLowerCase();
  if (l.includes("down")) return RED;
  if (l.includes("up") || l.includes("breakout")) return EMERALD;
  if (l.includes("mean")) return AMBER;
  if (l.includes("range")) return SUB;
  return trend > 0 ? EMERALD : trend < 0 ? RED : INK;
}


// ── Educational empty state · the operator is learning, not idle ─────────────

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
        grows, it starts recalling similar past situations · and their outcomes
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
        Experience accumulates on Walrus · verifiable, and the same memory the
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
  // Two numbers only · the rest is noise here (full stats live on Results).
  return (
    <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden" style={{ background: LINE }}>
      <Stat label="Decisions" value={String(stats.total)} />
      <Stat label="Capital preserved" value={`${stats.preservedPct.toFixed(0)}%`} color={AMBER} />
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
  if (!d.decided) return { headline: "Capital protected", detail: "No trade · discipline, not inaction.", color: AMBER };
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
