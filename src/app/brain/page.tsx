"use client";

// /brain — the Operator Brain. Every decision the operator made, fully
// inspectable: what it SAW, what it REMEMBERED, what it FEARED, the execution
// quality, the policy constraints, the decision, and how it turned out.
//
// Read-only and public (no wallet) — a judge opens /brain?policy=0x… and sees
// exactly why the operator did what it did, with the outcome attributed. The
// data is the same Walrus-anchored experience the operator recalls from.

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";

import { apiUrl } from "@/lib/api-base";
import { explorerUrl } from "@/lib/brief-client";
import { loadLatestTraderIdentity } from "@/lib/workforce-client";

const INK = "#111111";
const SUB = "#666666";
const EMERALD = "#10B981";
const RED = "#EF4444";
const AMBER = "#F59E0B";
const BLUE = "#4DA2FF";

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
  const [open, setOpen] = useState<number | null>(null);
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

  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.36em]" style={{ color: SUB }}>
            Operator Brain · decision replay
          </p>
          <h1 className="mt-3 font-sans text-[32px] font-medium leading-tight tracking-tight sm:text-[44px]">
            Every decision, inspectable.
          </h1>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed" style={{ color: SUB }}>
            What the operator saw, remembered, feared, and concluded — with the
            outcome attributed. Nothing hidden. The memory it reasons from is the
            same one anchored on Walrus.
          </p>
          {policyId && (
            <p className="mt-3 font-mono text-[11px]" style={{ color: SUB }}>
              policy <span style={{ color: INK }}>{short(policyId, 6)}</span>
              {" · "}
              <Link href={`/workforce?policy=${policyId}`} className="underline-offset-2 hover:underline">
                live dashboard →
              </Link>
            </p>
          )}
        </header>

        {decisions && decisions.length > 0 && <EvolveBar stats={stats} />}

        <div className="mt-8 space-y-3">
          {decisions === null ? (
            <p className="py-16 text-center font-mono text-[11px] uppercase tracking-[0.28em]" style={{ color: "#CCC" }}>
              {policyId ? "loading decisions…" : "no operator selected"}
            </p>
          ) : decisions.length === 0 ? (
            <Empty policyId={policyId} />
          ) : (
            decisions.map((d, i) => (
              <DecisionCard
                key={`${d.seq ?? i}-${d.ts}`}
                d={d}
                now={now}
                expanded={open === i}
                onToggle={() => setOpen(open === i ? null : i)}
              />
            ))
          )}
        </div>
      </div>
    </main>
  );
}

function EvolveBar({ stats }: { stats: ReturnType<typeof computeStats> }) {
  const evolving = stats.recentWinRate != null && stats.priorWinRate != null;
  const delta = evolving ? stats.recentWinRate! - stats.priorWinRate! : 0;
  return (
    <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Decisions" value={String(stats.total)} />
      <Stat label="Capital preserved" value={`${stats.preservedPct.toFixed(0)}%`} color={AMBER} />
      <Stat
        label="Settled win rate"
        value={stats.winRate == null ? "—" : `${stats.winRate.toFixed(0)}%`}
        color={stats.winRate != null && stats.winRate >= 50 ? EMERALD : INK}
      />
      <Stat
        label="Evolving"
        value={
          evolving
            ? `${stats.priorWinRate!.toFixed(0)}% → ${stats.recentWinRate!.toFixed(0)}%`
            : "building"
        }
        color={evolving ? (delta >= 0 ? EMERALD : RED) : SUB}
      />
    </div>
  );
}

function Stat({ label, value, color = INK }: { label: string; value: string; color?: string }) {
  return (
    <div className="border bg-bg-elev px-3 py-2.5" style={{ borderColor: "#E5E5E5" }}>
      <p className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: SUB }}>
        {label}
      </p>
      <p className="mt-1 font-mono text-[15px] tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function DecisionCard({
  d,
  now,
  expanded,
  onToggle,
}: {
  d: Decision;
  now: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const oc = outcomeView(d);
  const act = d.decided;
  const up = d.direction === "up";
  return (
    <div className="border bg-bg-elev" style={{ borderColor: expanded ? "#CCC" : "#E5E5E5" }}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="font-mono text-[11px] tabular-nums" style={{ color: SUB }}>
          #{d.seq ?? "—"}
        </span>
        <span className="font-mono text-[12px] tracking-tight" style={{ color: act ? (up ? EMERALD : RED) : SUB }}>
          {act ? `ACT ${up ? "▲" : "▼"}` : "NO TRADE"}
        </span>
        <span className="font-mono text-[10px]" style={{ color: SUB }}>
          {relTime(d.ts, now)}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: oc.color }} aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: oc.color }}>
            {oc.label}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t px-4 py-4" style={{ borderColor: "#F0F0F0" }}>
          <Row label="What I saw">
            <span className="font-mono text-[12px] tabular-nums" style={{ color: INK }}>
              ${d.mid.toFixed(3)} · ROC {(d.regime.roc30 * 100).toFixed(2)}% · RSI {d.regime.rsi.toFixed(0)} ·{" "}
              {d.regime.trend > 0 ? "trend up" : d.regime.trend < 0 ? "trend down" : "trend flat"} · vol{" "}
              {(d.regime.vol * 100).toFixed(2)}%
            </span>
          </Row>
          {d.detail?.recallNote && (
            <Row label="What I remembered">
              <span style={{ color: INK }}>{d.detail.recallNote}</span>
            </Row>
          )}
          {d.detail?.thesis && (
            <Row label="My thesis">
              <span style={{ color: INK }}>{d.detail.thesis}</span>
            </Row>
          )}
          {d.detail?.counterargument && (
            <Row label="What I feared">
              <span style={{ color: INK }}>{d.detail.counterargument}</span>
            </Row>
          )}
          {d.detail?.mandateReview && (
            <Row label="Mandate">
              <span className="font-mono text-[11.5px]" style={{ color: SUB }}>{d.detail.mandateReview}</span>
            </Row>
          )}
          {d.detail?.executionReview && (
            <Row label="Execution quality">
              <span className="font-mono text-[11.5px]" style={{ color: SUB }}>{d.detail.executionReview}</span>
            </Row>
          )}
          {d.detail?.policyReview && (
            <Row label="Policy constraints">
              <span className="font-mono text-[11.5px]" style={{ color: SUB }}>{d.detail.policyReview}</span>
            </Row>
          )}
          <Row label="Why I decided">
            <span style={{ color: INK }}>{d.detail?.verdict ?? "—"} · {(d.confidence * 100).toFixed(0)}% confidence</span>
          </Row>
          <Row label="What happened">
            <span className="font-mono text-[13px]" style={{ color: oc.color }}>
              {oc.detail}
            </span>
            {d.detail?.txDigest && (
              <a
                href={explorerUrl("txblock", d.detail.txDigest)}
                target="_blank"
                rel="noreferrer"
                className="ml-2 font-mono text-[10px] underline-offset-2 hover:underline"
                style={{ color: SUB }}
              >
                {short(d.detail.txDigest, 5)} ↗
              </a>
            )}
          </Row>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: SUB }}>
        {label}
      </p>
      <p className="text-[13px] leading-relaxed">{children}</p>
    </div>
  );
}

function Empty({ policyId }: { policyId: string | null }) {
  return (
    <div className="py-16 text-center">
      <p className="text-[14px]" style={{ color: SUB }}>
        {policyId
          ? "No decisions yet — the operator is building its record. Its first decision usually lands within a minute of going live."
          : "No operator selected. Adopt one, or open /brain?policy=0x…"}
      </p>
      <Link
        href="/workforce/adopt"
        className="mt-5 inline-block bg-ink px-6 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-bg transition-opacity hover:opacity-90"
      >
        Adopt an operator →
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------

function computeStats(ds: Decision[]) {
  const acts = ds.filter((d) => d.decided);
  const settled = acts.filter((d) => d.outcome === "win" || d.outcome === "loss");
  const wins = settled.filter((d) => d.outcome === "win").length;
  const winRate = settled.length ? (wins / settled.length) * 100 : null;
  const preservedPct = ds.length ? (ds.filter((d) => !d.decided).length / ds.length) * 100 : 0;
  // settled is newest-first (ds is newest-first); recent = first block.
  const rate = (rs: Decision[]) =>
    rs.length ? (rs.filter((d) => d.outcome === "win").length / rs.length) * 100 : null;
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

function outcomeView(d: Decision): { label: string; detail: string; color: string } {
  if (!d.decided) {
    return { label: "preserved", detail: "No trade — capital protected. Discipline, not inaction.", color: AMBER };
  }
  if (d.outcome === "pending") {
    return { label: "settling", detail: "Acted on chain. Outcome settling against later price.", color: BLUE };
  }
  if (d.outcome === "win") {
    return {
      label: "won",
      detail: `Directional call landed${d.outcomePct != null ? ` · +${(d.outcomePct * 100).toFixed(2)}%` : ""}.`,
      color: EMERALD,
    };
  }
  if (d.outcome === "loss") {
    return {
      label: "lost",
      detail: `Moved against the call${d.outcomePct != null ? ` · ${(d.outcomePct * 100).toFixed(2)}%` : ""}. Honest loss.`,
      color: RED,
    };
  }
  return { label: "acted", detail: "Acted on chain.", color: INK };
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
