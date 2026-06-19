"use client";

// /evolution · the fourth pillar: the operator getting *better* over time.
// Lessons learned, the single most valuable lesson, and a real timeline of how
// it grew · all derived from the live decision archive + ledger. This is what
// turns "smart" into "alive". Public, no wallet.

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";

import { apiUrl } from "@/lib/api-base";
import EvidenceBadge from "@/components/shared/EvidenceBadge";
import { INK, SUB, MUTED, NAVY, INFO, EMERALD, LINE } from "@/lib/ui";
import { loadLatestTraderIdentity } from "@/lib/workforce-client";
import { operatorCodename } from "@/lib/operator-identity";
import { useOperatorScorecard } from "@/lib/operator-scorecard";
import { useOperatorLedger } from "@/lib/operator-ledger";
import { computeEvolution, type Milestone } from "@/lib/operator-evolution";

/** The EXACT on-disk schema served by /api/operators/reflections. */
type Reflection = {
  date: string;
  worked: string;
  failed: string;
  lesson: string;
  blobId: string | null;
  walrusUrl: string | null;
  createdMs: number;
};

/** The EXACT shape served by /api/operators/memory (newest-first). */
type MemoryBlob = {
  blobId: string;
  walrusUrl: string;
  regime: string;
  lesson: string;
  kind: "reflection" | "reasoning";
  ts: number;
};

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

  // Daily Reflections · the operator's once-a-day self-critique, read from the
  // same `.cursors/daily-reflections-<slug>.json` the trader anchors to Walrus.
  const [reflections, setReflections] = useState<Reflection[] | null>(null);
  useEffect(() => {
    if (!policyId) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(apiUrl(`/api/operators/reflections?policy_id=${encodeURIComponent(policyId)}`));
        const j = (await r.json()) as { reflections?: Reflection[] };
        if (!cancelled) setReflections(j.reflections ?? []);
      } catch {
        if (!cancelled) setReflections([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [policyId]);

  // Decentralized Memory · the operator's regime lessons + reasoning anchored on
  // Walrus, read from a sibling API. The exact same memories a fresh agent could
  // pull from decentralized storage to continue with the same intelligence.
  const [memory, setMemory] = useState<MemoryBlob[] | null>(null);
  useEffect(() => {
    if (!policyId) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(apiUrl(`/api/operators/memory?policy_id=${encodeURIComponent(policyId)}`));
        const j = (await r.json()) as { ok?: boolean; count?: number; blobs?: MemoryBlob[] };
        if (!cancelled) setMemory(j.ok && Array.isArray(j.blobs) ? j.blobs : []);
      } catch {
        if (!cancelled) setMemory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [policyId]);

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

            {/* Decentralized Memory · regime lessons + reasoning anchored on
                Walrus. Real blobs only · quiet honest empty state otherwise.
                Distinguished from the timeline by an INFO accent. */}
            <DecentralizedMemory memory={memory} />

            {/* the growth timeline */}
            <h2 className="mt-12 font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: NAVY }}>
              The path
            </h2>
            <div className="mt-5">
              {evo.milestones.map((m, i) => (
                <MilestoneRow key={`${m.ts}-${i}`} m={m} isLast={i === evo.milestones.length - 1} />
              ))}
            </div>

            {/* Daily Reflections · the operator's once-a-day self-critique */}
            {reflections && reflections.length > 0 ? (
              <>
                <h2 className="mt-12 font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: NAVY }}>
                  Daily reflections
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed" style={{ color: SUB }}>
                  Once a day, the operator critiques itself · what worked, what failed, the
                  lesson. Anchored to Walrus, verifiable like everything else.
                </p>
                <div className="mt-5">
                  {reflections.map((r, i) => (
                    <ReflectionRow key={`${r.date}-${r.createdMs}`} r={r} isLast={i === reflections.length - 1} />
                  ))}
                </div>
              </>
            ) : reflections && reflections.length === 0 ? (
              <p className="mt-12 text-[13px] leading-relaxed" style={{ color: MUTED }}>
                Reflections begin after the operator&apos;s first full day.
              </p>
            ) : null}

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

// Decentralized Memory · the operator's regime lessons + reasoning, anchored on
// Walrus. This is the strongest decentralization proof: if this server vanished,
// a fresh agent could read these exact blobs and continue with the same memory.
// Real blobs only — never a placeholder ID. Quiet honest empty state otherwise.
function DecentralizedMemory({ memory }: { memory: MemoryBlob[] | null }) {
  return (
    <>
      <h2 className="mt-12 font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: NAVY }}>
        Decentralized Memory · Walrus
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: SUB }}>
        This operator&apos;s regime lessons and reasoning are anchored on Walrus. If this
        server disappeared, a new agent could read these exact memories from decentralized
        storage and continue with the same intelligence.
      </p>
      {memory === null ? (
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.24em]" style={{ color: MUTED }}>
          reading memory anchors…
        </p>
      ) : memory.length === 0 ? (
        <p className="mt-4 text-[13px] leading-relaxed" style={{ color: MUTED }}>
          Memory anchors appear here once the operator settles its first lessons.
        </p>
      ) : (
        <div className="mt-5">
          {memory.map((m, i) => (
            <MemoryRow key={`${m.blobId}-${i}`} m={m} isLast={i === memory.length - 1} />
          ))}
        </div>
      )}
    </>
  );
}

// A single Walrus memory anchor · timeline-styled like the path/reflections, but
// with an INFO dot + the on-Walrus evidence pill carrying the short blobId.
function MemoryRow({ m, isLast }: { m: MemoryBlob; isLast: boolean }) {
  const kindLabel = m.kind === "reasoning" ? "Reasoning" : "Reflection";
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center pt-1">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: INFO }} aria-hidden />
        {!isLast && <span className="my-1 w-px flex-1" style={{ background: "#E5E5EA", minHeight: 18 }} aria-hidden />}
      </div>
      <div className={`flex-1 ${isLast ? "pb-1" : "pb-6"}`}>
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: INFO }}>
          {m.regime || "Regime"}
          <span aria-hidden style={{ color: MUTED }}>·</span>
          <span style={{ color: MUTED }}>{kindLabel}</span>
        </p>
        <p className="mt-0.5 font-sans text-[16px] font-medium leading-snug tracking-tight" style={{ color: INK }}>
          {truncate(m.lesson, 160)}
        </p>
        <div className="mt-2.5">
          <EvidenceBadge type="walrus" href={m.walrusUrl} label={`On Walrus · ${shortBlobId(m.blobId)}`} />
        </div>
      </div>
    </div>
  );
}

// A short, recognizable blobId for the evidence pill (head…tail).
function shortBlobId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function truncate(s: string, n: number): string {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t || "Lesson recorded.";
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
        {!isLast && <span className="my-1 w-px flex-1" style={{ background: "#E5E5EA", minHeight: 18 }} aria-hidden />}
      </div>
      <div className={`flex-1 ${isLast ? "pb-1" : "pb-6"}`}>
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

// A single daily reflection · timeline-styled like the path, but with a NAVY
// dot to distinguish self-critique from the growth milestones. Click to expand
// worked / failed / lesson in full.
function ReflectionRow({ r, isLast }: { r: Reflection; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  // Prefer the lesson as the excerpt; fall back to what worked / failed.
  const excerpt = r.lesson?.trim() || r.worked?.trim() || r.failed?.trim() || "Reflection recorded.";
  const dateLabel = fmtReflectionDate(r.date);
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center pt-1">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: NAVY }} aria-hidden />
        {!isLast && <span className="my-1 w-px flex-1" style={{ background: "#E5E5EA", minHeight: 18 }} aria-hidden />}
      </div>
      <div className={`flex-1 ${isLast ? "pb-1" : "pb-6"}`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="block w-full text-left transition-opacity hover:opacity-70"
          aria-expanded={open}
        >
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: INFO }}>
            {dateLabel}
            <span aria-hidden style={{ color: MUTED }}>{open ? "−" : "+"}</span>
          </span>
          <span className="mt-0.5 block font-sans text-[16px] font-medium leading-snug tracking-tight" style={{ color: INK }}>
            {excerpt}
          </span>
        </button>

        {open && (
          <div className="mt-3 space-y-3" style={{ borderLeft: `1px solid ${LINE}`, paddingLeft: 14 }}>
            {r.worked?.trim() && (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: EMERALD }}>
                  Worked
                </p>
                <p className="mt-1 text-[13.5px] leading-relaxed" style={{ color: SUB }}>{r.worked}</p>
              </div>
            )}
            {r.failed?.trim() && (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: MUTED }}>
                  Failed
                </p>
                <p className="mt-1 text-[13.5px] leading-relaxed" style={{ color: SUB }}>{r.failed}</p>
              </div>
            )}
            {r.lesson?.trim() && (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: NAVY }}>
                  Lesson
                </p>
                <p className="mt-1 text-[13.5px] leading-relaxed" style={{ color: INK }}>{r.lesson}</p>
              </div>
            )}
          </div>
        )}

        {r.walrusUrl && (
          <div className="mt-2.5">
            <EvidenceBadge type="walrus" href={r.walrusUrl} label="On Walrus" />
          </div>
        )}
      </div>
    </div>
  );
}

function fmtReflectionDate(date: string): string {
  // date is "YYYY-MM-DD" · render as e.g. "Jun 18" without timezone drift.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
