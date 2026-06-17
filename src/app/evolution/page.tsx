"use client";

// /evolution · the fourth pillar: the operator getting *better* over time.
// Lessons learned, the single most valuable lesson, and a real timeline of how
// it grew · all derived from the live decision archive + ledger. This is what
// turns "smart" into "alive". Public, no wallet.

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";

import { INK, SUB, MUTED, NAVY, EMERALD, LINE } from "@/lib/ui";
import { loadLatestTraderIdentity } from "@/lib/workforce-client";
import { operatorCodename } from "@/lib/operator-identity";
import { useOperatorScorecard } from "@/lib/operator-scorecard";
import { useOperatorLedger } from "@/lib/operator-ledger";
import { computeEvolution, type Milestone } from "@/lib/operator-evolution";

export default function EvolutionPage() {
  return (
    <Suspense fallback={null}>
      <Evolution />
    </Suspense>
  );
}

function Evolution() {
  const [policyId, setPolicyId] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("policy");
    setPolicyId(p && p.startsWith("0x") ? p : loadLatestTraderIdentity()?.policyId ?? null);
  }, []);

  const { decisions, loaded } = useOperatorScorecard(policyId);
  const { ledger, stats } = useOperatorLedger(policyId);
  const codename = operatorCodename(policyId);
  const evo = useMemo(() => computeEvolution(decisions, ledger, stats), [decisions, ledger, stats]);

  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-16">
        {/* eyebrow + nav */}
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em]" style={{ color: NAVY }}>
            Operator evolution
          </p>
          {policyId && (
            <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.18em]">
              <Link href={`/workforce?policy=${policyId}`} className="transition-opacity hover:opacity-60" style={{ color: MUTED }}>
                Dashboard
              </Link>
              <Link href={`/brain?policy=${policyId}`} className="transition-opacity hover:opacity-60" style={{ color: MUTED }}>
                Brain
              </Link>
              <Link href={`/results?policy=${policyId}`} className="transition-opacity hover:opacity-60" style={{ color: NAVY }}>
                Results →
              </Link>
            </div>
          )}
        </div>

        <h1 className="mt-6 font-sans text-[34px] font-semibold leading-tight tracking-tight sm:text-[44px]">
          How {codename} evolved.
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed" style={{ color: SUB }}>
          Operating procedures built from what actually happened. All from its real record.
        </p>

        {!loaded ? (
          <p className="mt-16 text-center font-mono text-[11px] uppercase tracking-[0.28em]" style={{ color: MUTED }}>
            loading evolution…
          </p>
        ) : evo.milestones.length === 0 ? (
          <p className="mt-10 text-[14px] leading-relaxed" style={{ color: SUB }}>
            {codename} is still in its first cycles · its evolution will appear here as
            it accumulates experience.
          </p>
        ) : (
          <>
            {/* the two headline numbers */}
            <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden" style={{ background: LINE }}>
              <Stat label="Lessons learned" value={`${evo.lessonsLearned}`} />
              <Stat label="Regimes understood" value={`${evo.regimesUnderstood}`} />
            </div>

            {/* most valuable lesson */}
            {evo.mostValuable && (
              <div className="mt-6 px-5 py-5" style={{ border: `1px solid ${LINE}`, background: "#FBFCFE" }}>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: NAVY }}>
                  Most valuable lesson
                </p>
                <p className="mt-2 font-sans text-[19px] font-medium leading-snug tracking-tight" style={{ color: INK }}>
                  {evo.mostValuable.statement}
                </p>
                <p className="mt-1.5 font-mono text-[11.5px] tabular-nums" style={{ color: SUB }}>
                  Applied {evo.mostValuable.applied}×.
                </p>
              </div>
            )}

            {/* the growth timeline */}
            <h2 className="mt-12 font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: NAVY }}>
              The path
            </h2>
            <div className="mt-5">
              {evo.milestones.map((m, i) => (
                <MilestoneRow key={`${m.ts}-${i}`} m={m} isLast={i === evo.milestones.length - 1} />
              ))}
            </div>

            {policyId && (
              <p className="mt-12 font-mono text-[10px] leading-relaxed" style={{ color: MUTED }}>
                Every lesson is derived from the operator&apos;s settled outcomes · see the
                full per-regime playbooks on the{" "}
                <Link href={`/workforce?policy=${policyId}`} className="underline underline-offset-2" style={{ color: NAVY }}>
                  dashboard
                </Link>
                , and replay any single decision in the{" "}
                <Link href={`/brain?policy=${policyId}`} className="underline underline-offset-2" style={{ color: NAVY }}>
                  Brain
                </Link>
                .
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-elev px-5 py-5">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: SUB }}>
        {label}
      </p>
      <p className="mt-1.5 font-sans text-[34px] font-semibold tabular-nums leading-none tracking-tight" style={{ color: INK }}>
        {value}
      </p>
    </div>
  );
}

const KIND_COLOR: Record<Milestone["kind"], string> = {
  start: MUTED,
  regime: NAVY,
  allocation: EMERALD,
  win: EMERALD,
  now: INK,
};

function MilestoneRow({ m, isLast }: { m: Milestone; isLast: boolean }) {
  const color = KIND_COLOR[m.kind];
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center pt-1">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        {!isLast && <span className="my-1 w-px flex-1" style={{ background: "#E5E5EA", minHeight: 22 }} aria-hidden />}
      </div>
      <div className={`flex-1 ${isLast ? "pb-1" : "pb-7"}`}>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: MUTED }}>
          Day {m.day}
        </p>
        <p className="mt-0.5 font-sans text-[17px] font-medium tracking-tight" style={{ color: INK }}>
          {m.title}
        </p>
        <p className="mt-1 text-[13.5px] leading-relaxed" style={{ color: SUB }}>
          {m.detail}
        </p>
      </div>
    </div>
  );
}
