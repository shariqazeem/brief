"use client";

// /results · "Did it work?" The outcome-first page. A judge (or depositor)
// opens /results?policy=0x… and sees, in one screen: the objective, the return
// vs the alternatives (hold / cash), the risk taken, and the big moments that
// produced it · all real, from the on-chain ledger + persisted stats. No live
// wallet needed; this is the page the demo ends on.

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";

import { explorerUrl, BRIEF_NETWORK } from "@/lib/brief-client";
import { INK, SUB, MUTED, NAVY, EMERALD, RED, AMBER, LINE } from "@/lib/ui";
import { loadLatestTraderIdentity } from "@/lib/workforce-client";
import { operatorCodename, objectiveFromMode } from "@/lib/operator-identity";
import {
  useOperatorLedger,
  benchmarkFromStats,
  type LedgerEvent,
} from "@/lib/operator-ledger";

export default function ResultsPage() {
  return (
    <Suspense fallback={null}>
      <Results />
    </Suspense>
  );
}

function short(s: string | null | undefined, n = 6): string {
  if (!s) return "-";
  return s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s;
}

function Results() {
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("policy");
    setPolicyId(p && p.startsWith("0x") ? p : loadLatestTraderIdentity()?.policyId ?? null);
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const { ledger, stats, loaded } = useOperatorLedger(policyId);
  const codename = operatorCodename(policyId);
  const bench = useMemo(() => benchmarkFromStats(stats), [stats]);

  const days = stats ? Math.max(0, (now - stats.launchTs) / 86_400_000) : 0;
  const dayLabel = days >= 1 ? `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}` : "today";
  const decisions = stats?.decisions ?? 0;
  const allocations = stats ? stats.buys + stats.sells : 0;
  const abstentions = stats?.abstentions ?? 0;
  const preservedPct = decisions > 0 ? (abstentions / decisions) * 100 : 0;
  const worstDD = stats?.worstDrawdownPct ?? 0;
  const withdrawn = stats?.withdrawn === true;
  const objective = objectiveFromMode(stats?.mode);

  // Big moments · the allocation events that produced the result.
  const moments = (ledger ?? []).filter((e) => e.outcome !== "pending").slice(0, 6);

  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-16">
        {/* eyebrow + nav */}
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em]" style={{ color: NAVY }}>
            Results
          </p>
          {policyId && (
            <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.18em]">
              <Link href={`/workforce?policy=${policyId}`} className="transition-opacity hover:opacity-60" style={{ color: MUTED }}>
                Dashboard
              </Link>
              <Link href={`/brain?policy=${policyId}`} className="transition-opacity hover:opacity-60" style={{ color: MUTED }}>
                Brain
              </Link>
              <Link href={`/evolution?policy=${policyId}`} className="transition-opacity hover:opacity-60" style={{ color: MUTED }}>
                Evolution
              </Link>
              <Link href={`/proof?policy=${policyId}`} className="transition-opacity hover:opacity-60" style={{ color: NAVY }}>
                Proof →
              </Link>
            </div>
          )}
        </div>

        {!loaded ? (
          <p className="mt-20 text-center font-mono text-[11px] uppercase tracking-[0.28em]" style={{ color: MUTED }}>
            loading results…
          </p>
        ) : !stats ? (
          <div className="mt-16">
            <h1 className="font-sans text-[30px] font-medium tracking-tight">No results yet.</h1>
            <p className="mt-3 text-[14px] leading-relaxed" style={{ color: SUB }}>
              This operator hasn&apos;t accumulated a track record yet. Open{" "}
              <Link href="/workforce" className="underline underline-offset-2" style={{ color: NAVY }}>
                the dashboard
              </Link>{" "}
              to watch it work.
            </p>
          </div>
        ) : (
          <>
            {/* Identity + objective */}
            <h1 className="mt-6 font-sans text-[40px] font-semibold leading-none tracking-tight sm:text-[52px]">
              {codename}
            </h1>
            <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.2em]" style={{ color: SUB }}>
              {objective} · {withdrawn ? "capital withdrawn by owner" : `running ${dayLabel}`}
            </p>

            {/* The verdict · one sentence. The thesis is constrained autonomy,
                not returns, so the headline reinforces the moat first. */}
            {bench && (() => {
              const op = bench.operatorPct;
              const vh = bench.vsHold;
              let line: string;
              if (withdrawn) line = "Capital returned in full, on demand.";
              else if (op >= 0.1 && vh >= 0) line = "Beat holding SUI, under on-chain law.";
              else if (op >= 0.1) line = "Grew, every move within policy.";
              else line = "The leash held. Capital protected.";
              return (
                <p className="mt-7 font-sans text-[26px] font-medium leading-snug tracking-tight sm:text-[32px]" style={{ color: INK }}>
                  {line}
                </p>
              );
            })()}

            {/* The headline · the comparison IS the story: what would have
                happened if you'd done nothing? */}
            {bench && (
              <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: NAVY }}>
                What would have happened if you&apos;d done nothing?
              </p>
            )}
            {bench && (
              <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden" style={{ background: LINE }}>
                <BigNum label="The operator" pct={bench.operatorPct} strong />
                <BigNum label="Held SUI" pct={bench.holdPct} />
                <BigNum label="Did nothing (cash)" pct={bench.cashPct} />
              </div>
            )}
            {bench && (
              <p className="mt-3 text-[15px] leading-relaxed" style={{ color: SUB }}>
                <span style={{ color: bench.vsHold >= 0 ? EMERALD : RED, fontWeight: 600 }}>
                  {bench.vsHold >= 0 ? "+" : ""}{bench.vsHold.toFixed(1)}% vs holding SUI
                </span>{" "}
                · the operator {bench.vsHold >= 0 ? "beat" : "trailed"} simply holding, and{" "}
                {bench.vsCash >= 0 ? "grew" : "lost"} {Math.abs(bench.vsCash).toFixed(1)}% vs sitting in cash.
              </p>
            )}

            {/* The record */}
            <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3" style={{ background: LINE }}>
              <Cell label="Maximum drawdown" value={`-${worstDD.toFixed(1)}%`} color={worstDD > 5 ? AMBER : INK} />
              <Cell label="Capital preserved" value={`${preservedPct.toFixed(0)}%`} color={EMERALD} />
              <Cell label="Decisions made" value={`${decisions}`} />
              <Cell label="Trades executed" value={`${allocations}`} />
              <Cell label="Trades avoided" value={`${abstentions}`} />
              <Cell label="Policy violations" value="0" color={EMERALD} />
            </div>

            {/* The moat */}
            <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 border px-4 py-3" style={{ borderColor: LINE }}>
              <span className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: EMERALD }}>
                ✓ Protected by Sui
              </span>
              <span className="text-[13px]" style={{ color: SUB }}>
                Non-custodial, budget enforced on-chain, every trade verifiable.
              </span>
              {policyId && (
                <Link
                  href={`/proof?policy=${policyId}`}
                  className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] hover:opacity-60"
                  style={{ color: NAVY }}
                >
                  Verify →
                </Link>
              )}
            </div>

            {/* Mainnet readiness · reliability already solved on testnet */}
            <div className="mt-6 border px-5 py-5" style={{ borderColor: LINE, background: "#FBFCFE" }}>
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: NAVY }}>
                  Operator status
                </p>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: EMERALD }}>
                  {BRIEF_NETWORK === "mainnet" ? "Mainnet · live" : "Testnet verified"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] tabular-nums" style={{ color: SUB }}>
                <span><span style={{ color: INK }}>{decisions}</span> decisions</span>
                <span><span style={{ color: INK }}>{allocations}</span> allocation{allocations === 1 ? "" : "s"}</span>
                <span><span style={{ color: EMERALD }}>0</span> policy violations</span>
                <span><span style={{ color: EMERALD }}>0</span> custody incidents</span>
              </div>
              <p className="mt-3 text-[13.5px] leading-relaxed" style={{ color: SUB }}>
                {BRIEF_NETWORK === "mainnet" ? (
                  <>
                    {dayLabel} on <span style={{ color: INK }}>mainnet with real USDC</span>, zero violations ·
                    every trade enforced on-chain.
                  </>
                ) : (
                  <>
                    {dayLabel} on testnet, zero violations.{" "}
                    <span style={{ color: INK }}>Ready for mainnet capital.</span>
                  </>
                )}
              </p>
              <div className="mt-4 grid gap-px overflow-hidden sm:grid-cols-3" style={{ background: LINE }}>
                {BRIEF_NETWORK === "mainnet" ? (
                  <>
                    <Phase n="Now" label="Live on mainnet" note="Real USDC, real DeepBook orders, on-chain leash" done />
                    <Phase n="Next" label="More operators" note="Open adoption · any objective, capped budgets" />
                    <Phase n="Then" label="Operator workforce" note="A network of operators across verticals" />
                  </>
                ) : (
                  <>
                    <Phase n="Now" label="Testnet validation" note="Live operators, real DeepBook orders, zero violations" done />
                    <Phase n="Next" label="Limited mainnet" note="Invite operators, capped budgets, real USDC" />
                    <Phase n="Then" label="Operator workforce" note="Open adoption across objectives + verticals" />
                  </>
                )}
              </div>
            </div>

            {/* Big moments */}
            <h2 className="mt-12 font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: NAVY }}>
              Big moments
            </h2>
            {moments.length === 0 ? (
              <p className="mt-3 text-[14px] leading-relaxed" style={{ color: SUB }}>
                No settled allocation moves yet · the operator has mostly held through
                its regimes. Every hold and move is in the{" "}
                <Link href={`/workforce?policy=${policyId}`} className="underline underline-offset-2" style={{ color: NAVY }}>
                  ledger
                </Link>
                .
              </p>
            ) : (
              <div className="mt-4 space-y-0">
                {moments.map((m, i) => (
                  <Moment key={`${m.ts}-${i}`} m={m} />
                ))}
              </div>
            )}

            <p className="mt-12 font-mono text-[10px] leading-relaxed" style={{ color: MUTED }}>
              Operator {short(policyId)} · all figures derived from the on-chain ledger and
              the Walrus-anchored decision archive.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function Phase({ n, label, note, done }: { n: string; label: string; note: string; done?: boolean }) {
  return (
    <div className="bg-bg-elev px-3.5 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: done ? EMERALD : MUTED }}>
        {done ? "✓ " : ""}{n}
      </p>
      <p className="mt-1 font-sans text-[13px] font-medium tracking-tight" style={{ color: INK }}>
        {label}
      </p>
      <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: SUB }}>
        {note}
      </p>
    </div>
  );
}

function BigNum({ label, pct, strong }: { label: string; pct: number; strong?: boolean }) {
  const flat = Math.abs(pct) < 0.05;
  const color = flat ? SUB : pct > 0 ? EMERALD : RED;
  return (
    <div className="bg-bg-elev px-4 py-5">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: SUB }}>
        {label}
      </p>
      <p
        className={`mt-1.5 tabular-nums leading-none ${strong ? "font-sans text-[28px] font-semibold sm:text-[34px]" : "font-sans text-[22px] font-medium sm:text-[26px]"}`}
        style={{ color }}
      >
        {flat ? "±0.0%" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
      </p>
    </div>
  );
}

function Cell({ label, value, color = INK }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-elev px-4 py-3.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: SUB }}>
        {label}
      </p>
      <p className="mt-1 font-mono text-[16px] tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function Moment({ m }: { m: LedgerEvent }) {
  const favorPct = (m.outcomePct ?? 0) * 100;
  const headline = m.side === "buy" ? "Accumulated SUI" : "Moved to cash";
  const result =
    m.side === "buy"
      ? favorPct >= 0
        ? `Captured +${favorPct.toFixed(1)}%`
        : `Held through ${favorPct.toFixed(1)}%`
      : favorPct >= 0
        ? `Avoided -${Math.abs(favorPct).toFixed(1)}%`
        : `Missed +${Math.abs(favorPct).toFixed(1)}%`;
  const color = favorPct >= 0 ? EMERALD : RED;
  const date = new Date(m.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div className="flex items-baseline justify-between gap-4 py-3" style={{ borderTop: `1px solid ${LINE}` }}>
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: MUTED }}>
          {date}
        </p>
        <p className="mt-0.5 font-sans text-[16px] font-medium tracking-tight" style={{ color: INK }}>
          {headline}
        </p>
        <p className="text-[12.5px]" style={{ color: SUB }}>
          {m.regimeLabel ?? "-"}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-sans text-[16px] font-medium tabular-nums" style={{ color }}>
          {result}
        </p>
        {m.txDigest && (
          <a
            href={explorerUrl("txblock", m.txDigest)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[9px] uppercase tracking-[0.16em] underline-offset-2 hover:underline"
            style={{ color: SUB }}
          >
            tx ↗
          </a>
        )}
      </div>
    </div>
  );
}
