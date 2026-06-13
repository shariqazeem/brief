"use client";

// /proof — the judge surface for the Agentic Web "Autonomous Agent
// Wallet" track. Every must-have maps 1:1 to a LIVE, on-chain artifact:
// a requirements table up top, then five verification modules. The
// hero artifacts (tx digests + Walrus blobs) were each verified
// `success` on the fullnode / HTTP-200 on the Walrus aggregator before
// shipping; live data comes from the server-cached API routes. No
// decoration, no screenshots — every number traces to chain.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { apiUrl } from "@/lib/api-base";
import { SystemHealthDot } from "@/components/system-health";
import {
  useOperatorJournal,
  type SettlementKind,
} from "@/lib/operator-journal";

// ── design tokens ──────────────────────────────────────────────────────
const INK = "#111111";
const SUB = "#666666";
const EMERALD = "#10B981";
const RED = "#EF4444";
const AMBER = "#F59E0B";
const LINE = "#E5E5E5";
const CARD = "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)]";

// ── verified artifacts (authoritative: fullnode `success` / Walrus 200) ──
const DEMO_POLICY =
  "0x93b0c86507d586b87855035f3e031f1be2adee89b14320584a116fc86aef3487";
const REVOKED_POLICY =
  "0x60f7e0a4f26401f5911ba9ce8a9516ac1a19dd9748481f568b5d909967e910c8";
const ART = {
  mintMomentumDown: "7kJnuSVgP77FniFep3T8PkBcFtmm2w5qo9rSG2SpCTMP",
  mintLiveWire: "7zG5R4duNQbBoPUn7F4wJkQuTC5qsoCByxASUMUkv83i",
  spotOpen: "9fgEqR6NuWawDGvW6MbWkcLJ5wreyHhMGJhUFEVxTXUS",
  spotClose: "81a2xFkHSe4Lw1x4r8RQqRt7mG1NeuBQ4bHiexh1JLiq",
  revokeTx: "4yBvc6qVwoXugmZu1jNgNjHRC8ZtqMtoVefsuQZyB4YL",
  simFallbackDeliver: "BNbEUctbpVSF8Co39zQGpKXtcnKyFzZYUBqx3PxvD6dS",
  journalBlob: "7mx440fnqkvuVT-L5AkPj65J39_5Cjhm4o62LNVNL0c",
  abstentionBlob: "VSnTkKxV71AvcHFAqDs5an-W0kcsdmA1w_M9u3F3_RM",
} as const;

const txUrl = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const objUrl = (id: string) => `https://suiscan.xyz/testnet/object/${id}`;
const blobUrl = (b: string) =>
  `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${b}`;
const short = (s: string, h = 6, t = 4) =>
  s.length <= h + t + 1 ? s : `${s.slice(0, h)}…${s.slice(-t)}`;

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function settlement(k: SettlementKind): { label: string; color: string } {
  switch (k) {
    case "won":
      return { label: "settled · in-the-money", color: EMERALD };
    case "lost":
      return { label: "settled · honest loss", color: RED };
    case "preserved":
      return { label: "capital preserved", color: AMBER };
    case "pending":
      return { label: "awaiting settlement", color: "#4DA2FF" };
    case "executed":
      return { label: "executed live", color: EMERALD };
    default:
      return { label: "settled · beyond window", color: SUB };
  }
}

// ── small shared atoms ──────────────────────────────────────────────────
function TxLink({
  label,
  href,
  tone = "ink",
}: {
  label: string;
  href: string;
  tone?: "ink" | "emerald";
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 border px-2 py-1 font-mono text-[10.5px] tracking-tight transition-opacity hover:opacity-70"
      style={{
        borderColor: tone === "emerald" ? "rgba(16,185,129,0.4)" : LINE,
        color: tone === "emerald" ? "#047857" : INK,
        background: tone === "emerald" ? "rgba(16,185,129,0.06)" : "transparent",
      }}
    >
      {label} ↗
    </a>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[9.5px] uppercase tracking-[0.3em]" style={{ color: SUB }}>
      {children}
    </p>
  );
}

// ── module shell ────────────────────────────────────────────────────────
function Module({
  id,
  n,
  title,
  blurb,
  children,
}: {
  id: string;
  n: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-24 ${CARD} p-6 sm:p-8`}>
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[12px] tabular-nums" style={{ color: "#CCCCCC" }}>
          {n}
        </span>
        <h2 className="font-sans text-[20px] font-medium tracking-tight sm:text-[23px]" style={{ color: INK }}>
          {title}
        </h2>
      </div>
      <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed" style={{ color: SUB }}>
        {blurb}
      </p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

// ── policy read (live burn-down + revoked flag) ─────────────────────────
type PolicyData = {
  ok?: boolean;
  revoked?: boolean;
  budget_cap_sui?: number;
  spent_sui?: number;
  remaining_sui?: number;
  allowed_venues?: string[];
  agent?: string | null;
  owner?: string | null;
};

function usePolicyRead(id: string): PolicyData | null {
  const [data, setData] = useState<PolicyData | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const r = await fetch(apiUrl(`/api/policy?id=${id}`));
        if (r.ok && !cancelled) setData((await r.json()) as PolicyData);
      } catch {
        /* leave last — static artifacts below carry the proof regardless */
      }
      if (!cancelled) timer = setTimeout(tick, 30_000);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);
  return data;
}

// =========================================================================
// MODULE 1 — Real DeepBook orders
// =========================================================================
function RealOrders({ journal }: { journal: ReturnType<typeof useOperatorJournal> }) {
  const mints = journal.entries
    .filter((e) => e.mint_tx && !e.abstained)
    .slice(0, 5);
  return (
    <div className="space-y-5">
      <div>
        <Eyebrow>Last BTC Predict mints · live from /api/trader/trades</Eyebrow>
        <ul className="mt-2" style={{ borderTop: `1px solid ${LINE}` }}>
          {mints.length === 0 ? (
            <li className="py-3 font-mono text-[11px]" style={{ color: SUB }}>
              demo policy is between cycles — verified mints below ↓
            </li>
          ) : (
            mints.map((d, i) => {
              const up = d.direction === "up";
              return (
                <li
                  key={`${d.ts}-${i}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2.5"
                  style={{ borderBottom: `1px solid #F0F0F0` }}
                >
                  <span className="flex items-baseline gap-2 font-mono text-[12px] tabular-nums">
                    <span style={{ color: up ? EMERALD : RED }}>
                      {up ? "UP ▲" : "DOWN ▼"} ×{d.quantity}
                    </span>
                    <span style={{ color: SUB }}>· {d.strategy}</span>
                  </span>
                  <span className="flex items-baseline gap-3 font-mono text-[11px] tabular-nums" style={{ color: SUB }}>
                    <span>{fmtTime(d.ts)}</span>
                    <a
                      href={txUrl(d.mint_tx as string)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline-offset-2 hover:underline"
                      style={{ color: "#047857" }}
                    >
                      {short(d.mint_tx as string)} ↗
                    </a>
                  </span>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div>
        <Eyebrow>Verified anchors · success on fullnode</Eyebrow>
        <div className="mt-2 flex flex-wrap gap-2">
          <TxLink label="Momentum DOWN ×4 mint" href={txUrl(ART.mintMomentumDown)} tone="emerald" />
          <TxLink label="Quant UP live-wire mint" href={txUrl(ART.mintLiveWire)} tone="emerald" />
        </div>
      </div>

      <div className="p-4" style={{ border: `1px solid ${LINE}` }}>
        <Eyebrow>SUI spot pair · DeepBook v3 · realized −$0.009</Eyebrow>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TxLink label="open" href={txUrl(ART.spotOpen)} />
          <span aria-hidden className="font-mono text-[11px]" style={{ color: SUB }}>→</span>
          <TxLink label="close" href={txUrl(ART.spotClose)} />
          <span className="font-mono text-[10.5px]" style={{ color: RED }}>
            bet DOWN, SUI rose — lost. Not rigged.
          </span>
        </div>
      </div>

      <p className="text-[12px] leading-relaxed" style={{ color: SUB }}>
        Every order is a real on-chain transaction — a policy-gated atomic PTB
        (record_spend → DeepBook), with honest P&amp;L including losses.
      </p>
    </div>
  );
}

// =========================================================================
// MODULE 2 — Self-enforced budget ceiling
// =========================================================================
function BudgetCeiling({ journal }: { journal: ReturnType<typeof useOperatorJournal> }) {
  const p = usePolicyRead(DEMO_POLICY);
  const cap = p?.budget_cap_sui ?? null;
  const spent = p?.spent_sui ?? null;
  const pct = cap && spent != null ? Math.max(0, Math.min(100, (spent / cap) * 100)) : 0;
  const fill = pct >= 95 ? RED : pct >= 80 ? AMBER : EMERALD;
  // Each live mint debits the leash via record_spend(quantity SUI).
  const spends = journal.entries.filter((e) => e.mode === "live" && e.mint_tx).slice(0, 3);
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[26px] tabular-nums" style={{ color: INK }}>
            {spent != null ? spent.toFixed(2) : "—"}
            <span className="text-[13px]" style={{ color: SUB }}>
              {" "}/ {cap != null ? cap.toFixed(0) : "—"} SUI
            </span>
          </span>
          <span className="font-mono text-[11px] tabular-nums" style={{ color: SUB }}>
            {p ? `${pct.toFixed(0)}% used` : "reading chain…"}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden" style={{ background: LINE }}>
          <div className="h-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: fill }} />
        </div>
        <div className="mt-2">
          <TxLink label={`policy ${short(DEMO_POLICY)} · live`} href={objUrl(DEMO_POLICY)} />
        </div>
      </div>

      <div>
        <Eyebrow>Recent record_spend · amount · time</Eyebrow>
        <ul className="mt-2" style={{ borderTop: `1px solid ${LINE}` }}>
          {spends.length === 0 ? (
            <li className="py-2.5 font-mono text-[11px]" style={{ color: SUB }}>
              no live debit yet this cycle — burn-down above is read straight off the object
            </li>
          ) : (
            spends.map((d, i) => (
              <li
                key={`${d.ts}-${i}`}
                className="flex items-baseline justify-between gap-3 py-2.5 font-mono text-[11.5px] tabular-nums"
                style={{ borderBottom: `1px solid #F0F0F0` }}
              >
                <span style={{ color: INK }}>−{d.quantity.toFixed(2)} SUI</span>
                <span style={{ color: SUB }}>{fmtTime(d.ts)}</span>
                {d.mint_tx && (
                  <a href={txUrl(d.mint_tx)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline" style={{ color: "#047857" }}>
                    {short(d.mint_tx)} ↗
                  </a>
                )}
              </li>
            ))
          )}
        </ul>
      </div>

      <p className="text-[12px] leading-relaxed" style={{ color: SUB }}>
        The Move contract stops the operator at the limit. No exception — when
        spent reaches the cap, the next mint PTB reverts in{" "}
        <span className="font-mono" style={{ color: INK }}>assert_can_spend</span>.
      </p>
    </div>
  );
}

// =========================================================================
// MODULE 3 — On-chain activity log
// =========================================================================
function ActivityLog({ journal }: { journal: ReturnType<typeof useOperatorJournal> }) {
  const rows = journal.entries.slice(0, 10);
  return (
    <div>
      <div className="flex items-center justify-between">
        <Eyebrow>Last 10 decisions · auto-refresh</Eyebrow>
        <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: SUB }}>
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: EMERALD }} aria-hidden />
          live
        </span>
      </div>
      <ul className="mt-2" style={{ borderTop: `1px solid ${LINE}` }}>
        {rows.length === 0 ? (
          <li className="py-3 font-mono text-[11px]" style={{ color: SUB }}>
            warming up — open the cumulative journal on Walrus ↓
          </li>
        ) : (
          rows.map((e, i) => {
            const s = settlement(e.settlement);
            const dir = e.abstained ? "PRESERVE" : (e.direction ?? "").toUpperCase();
            return (
              <li
                key={`${e.task_id}-${i}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5"
                style={{ borderBottom: `1px solid #F0F0F0` }}
              >
                <span className="flex items-baseline gap-2 font-mono text-[11.5px] tabular-nums">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} aria-hidden />
                  <span style={{ color: SUB }}>{fmtTime(e.ts)}</span>
                  <span style={{ color: e.abstained ? AMBER : INK }}>BTC {dir}</span>
                </span>
                <span className="flex items-baseline gap-3 font-mono text-[11px] tabular-nums">
                  <span style={{ color: s.color }}>{s.label}</span>
                  {e.walrus_reasoning_blob_id && (
                    <a href={blobUrl(e.walrus_reasoning_blob_id)} target="_blank" rel="noreferrer" title="reasoning on Walrus" className="underline-offset-2 hover:underline" style={{ color: SUB }}>
                      Walrus ↗
                    </a>
                  )}
                </span>
              </li>
            );
          })
        )}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <TxLink label="cumulative memory (Walrus)" href={blobUrl(ART.journalBlob)} tone="emerald" />
        <TxLink label="abstention reasoning (Walrus)" href={blobUrl(ART.abstentionBlob)} tone="emerald" />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed" style={{ color: SUB }}>
        Capital-preserved entries (amber) are first-class — sitting out is a
        recorded, content-addressed decision, not a gap.
      </p>
    </div>
  );
}

// =========================================================================
// MODULE 4 — Owner revocation
// =========================================================================
function Revocation() {
  const p = usePolicyRead(REVOKED_POLICY);
  const isRevoked = p?.revoked === true;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4" style={{ border: `1px solid ${isRevoked ? "rgba(239,68,68,0.4)" : LINE}`, background: "rgba(239,68,68,0.04)" }}>
        <div>
          <Eyebrow>Demo policy · live read</Eyebrow>
          <p className="mt-1 font-mono text-[15px] tabular-nums" style={{ color: isRevoked ? RED : SUB }}>
            policy.revoked = {p ? String(isRevoked) : "…"}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: RED }}>
          {isRevoked ? "grounded" : "reading chain…"}
        </span>
      </div>

      <div className="p-4" style={{ border: `1px solid ${LINE}` }}>
        <Eyebrow>Abort fingerprint</Eyebrow>
        <p className="mt-1 break-words font-mono text-[11.5px]" style={{ color: INK }}>
          EPolicyRevoked · code 3 · operator_policy::assert_can_spend
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <TxLink label="revoke tx" href={txUrl(ART.revokeTx)} />
          <TxLink label="aborted attempt" href={txUrl(ART.simFallbackDeliver)} />
          <TxLink label={`revoked policy ${short(REVOKED_POLICY)}`} href={objUrl(REVOKED_POLICY)} />
        </div>
      </div>

      <p className="text-[13px] leading-relaxed" style={{ color: SUB }}>
        One signature flips <span className="font-mono" style={{ color: INK }}>policy.revoked</span>.
        The next mint — any asset — aborts and the whole PTB reverts. The chain
        refused, not our server. Past wins still pay out via permissionless
        redeem.{" "}
        <Link href="/workforce" className="underline underline-offset-2" style={{ color: RED }}>
          Adopt &amp; revoke your own →
        </Link>
      </p>

      <div>
        <Eyebrow>Watch the kill switch · 60s</Eyebrow>
        <video className="mt-2 aspect-video w-full" style={{ border: `1px solid ${LINE}`, background: "#F5F5F5" }} controls poster="">
          <track kind="captions" />
        </video>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: SUB }}>
          clip drops here for the demo recording
        </p>
      </div>
    </div>
  );
}

// =========================================================================
// MODULE 5 — It thinks in public (read-only SSE terminal)
// =========================================================================
type WireEvent = { ts: number; seq?: number; type: string; asset?: string; task_id?: string | null; data?: Record<string, unknown> };

function LiveWire() {
  const [events, setEvents] = useState<WireEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(apiUrl("/api/agent-events"));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as WireEvent;
        setEvents((prev) => [...prev.slice(-49), e]);
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [events]);

  const summarize = (e: WireEvent): string => {
    const d = e.data ?? {};
    if (e.type === "observe" && typeof d.spot_usd === "number") return `spot $${Math.round(d.spot_usd).toLocaleString()}`;
    if (e.type === "decision") return `${d.decided ? `ACT ${String(d.direction ?? "").toUpperCase()} x${d.quantity ?? ""}` : "PRESERVE"}`;
    if (e.type === "mint_landed" || e.type === "spot_opened") return `tx ${short(String(d.tx ?? ""))}`;
    if (e.type === "mode") return `${d.mode ?? ""}`;
    if (e.type === "walrus_uploaded") return `${d.kind ?? "blob"} ${short(String(d.blob_id ?? ""))}`;
    if (e.type === "warden_topup") return `+${d.amount_sui ?? ""} SUI gas`;
    return "";
  };

  return (
    <div className="p-4 sm:p-5" style={{ background: INK }}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: "#888888" }}>
          /api/agent-events · read-only
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: "#888888" }}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? "animate-pulse" : ""}`} style={{ background: connected ? EMERALD : "#666666" }} aria-hidden />
          {connected ? "live" : "connecting"}
        </span>
      </div>
      <div className="mt-3 h-[220px] overflow-y-auto font-mono text-[10.5px] leading-relaxed">
        {events.length === 0 ? (
          <p style={{ color: "#888888" }}>
            the wire is quiet — dispatch from{" "}
            <Link href="/workforce" className="underline underline-offset-4" style={{ color: "#FFFFFF" }}>/workforce</Link>{" "}
            and the operator&apos;s steps stream here in real time.
          </p>
        ) : (
          events.map((e, i) => (
            <p key={`${e.ts}-${e.seq ?? i}`} className="tabular-nums" style={{ color: "#E5E5E5" }}>
              <span style={{ color: "#666666" }}>
                {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>{" "}
              <span style={{ color: EMERALD }}>{e.type}</span>
              {e.asset ? <span style={{ color: "#888888" }}> · {e.asset}</span> : null}
              {summarize(e) ? <span style={{ color: "#AAAAAA" }}> · {summarize(e)}</span> : null}
            </p>
          ))
        )}
        <div ref={endRef} />
      </div>
      <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: "#888888" }}>
        This is what autonomous execution looks like.
      </p>
    </div>
  );
}

// =========================================================================
// requirements table
// =========================================================================
const REQUIREMENTS: Array<{ must: string; how: string; proofHref: string; proofLabel: string }> = [
  {
    must: "Real DeepBook orders",
    how: "Policy-gated PTBs: record_spend → DeepBook Predict (BTC) + DeepBook v3 spot.",
    proofHref: "#m1",
    proofLabel: "5 live mints + spot pair",
  },
  {
    must: "Self-enforced budget ceiling",
    how: "Move OperatorPolicy debits spent per bet; reverts at the cap.",
    proofHref: "#m2",
    proofLabel: "live burn-down",
  },
  {
    must: "On-chain activity log",
    how: "Every decision is an on-chain Deliverable; reasoning on Walrus.",
    proofHref: "#m3",
    proofLabel: "last 10 + Walrus",
  },
  {
    must: "Owner revocation",
    how: "One signature flips revoked; the next mint aborts EPolicyRevoked.",
    proofHref: "#m4",
    proofLabel: "revoke tx + abort",
  },
  {
    must: "Thinks in public",
    how: "One SSE event per lifecycle beat — observe → decision → chain.",
    proofHref: "#m5",
    proofLabel: "live wire",
  },
];

function RequirementsTable() {
  return (
    <div className={`${CARD} overflow-x-auto`}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr style={{ borderBottom: `1px solid ${LINE}` }}>
            {["Must-Have", "How Brief Meets It", "On-Chain Proof"].map((h) => (
              <th key={h} className="px-4 py-3 font-mono text-[9.5px] uppercase tracking-[0.22em]" style={{ color: SUB }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {REQUIREMENTS.map((r) => (
            <tr key={r.must} style={{ borderBottom: `1px solid #F0F0F0` }}>
              <td className="px-4 py-3 align-top font-sans text-[13.5px] font-medium" style={{ color: INK }}>
                {r.must}
              </td>
              <td className="px-4 py-3 align-top text-[12.5px] leading-snug" style={{ color: SUB }}>
                {r.how}
              </td>
              <td className="px-4 py-3 align-top">
                <a href={r.proofHref} className="inline-flex items-center gap-1 font-mono text-[11px] underline-offset-2 hover:underline" style={{ color: "#047857" }}>
                  {r.proofLabel} ↓
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =========================================================================
// page
// =========================================================================
export default function ProofPage() {
  const j = useOperatorJournal(DEMO_POLICY);

  return (
    <main className="min-h-screen" style={{ background: "#FAFAFA", color: INK }}>
      <header style={{ borderBottom: `1px solid ${LINE}`, background: "#FFFFFF" }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/" className="font-mono text-[10px] uppercase tracking-[0.32em] transition-colors hover:opacity-70" style={{ color: SUB }}>
            ← Brief
          </Link>
          <SystemHealthDot />
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <Eyebrow>Agentic Web · Autonomous Agent Wallet</Eyebrow>
        <h1 className="mt-3 font-sans text-[40px] font-medium leading-[1.02] tracking-tight sm:text-[56px]" style={{ color: INK }}>
          Proof
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed sm:text-[16px]" style={{ color: SUB }}>
          Every claim, verified on chain. The track&apos;s must-haves mapped 1:1
          to live artifacts you can open on Suiscan or Walrus right now — nothing
          here is a screenshot.
        </p>

        <div className="mt-8">
          <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.28em]" style={{ color: SUB }}>
            How Brief maps to Agentic Web requirements
          </p>
          <RequirementsTable />
        </div>

        <div className="mt-8 space-y-6">
          <Module id="m1" n="01" title="Real DeepBook orders" blurb="The operator places policy-gated atomic PTBs on DeepBook Predict (BTC up/down) and DeepBook v3 spot (SUI/WAL/DEEP). Real fills, honest P&L — including losses.">
            <RealOrders journal={j} />
          </Module>

          <Module id="m2" n="02" title="Self-enforced budget ceiling" blurb="The leash is a Move OperatorPolicy. Every bet debits spent via record_spend; when the cap is reached the mint PTB reverts. Live burn-down, read straight off the object.">
            <BudgetCeiling journal={j} />
          </Module>

          <Module id="m3" n="03" title="On-chain activity log" blurb="Every decision is delivered on chain as a Deliverable with inline JSON; the cumulative reasoning + memory is content-addressed on Walrus — fetchable by anyone, not stuck in a database.">
            <ActivityLog journal={j} />
          </Module>

          <Module id="m4" n="04" title="Owner revocation" blurb="One signature flips policy.revoked. The very next mint — any asset — aborts EPolicyRevoked and the whole transaction reverts. Past wins still pay out via permissionless redeem.">
            <Revocation />
          </Module>

          <Module id="m5" n="05" title="It thinks in public" blurb="The operator emits one event per lifecycle beat — observe, signals, SVI read, decision, mint, Walrus, deliver — over SSE. The same wire the dashboard animates, raw and read-only here.">
            <LiveWire />
          </Module>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-4" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 24 }}>
          <Link href="/workforce" className="inline-flex items-center gap-2 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-white transition-opacity hover:opacity-90" style={{ background: INK }}>
            Adopt an operator →
          </Link>
          <Link href="/leaderboard" className="font-mono text-[10px] uppercase tracking-[0.24em] transition-colors hover:opacity-70" style={{ color: SUB }}>
            Leaderboard
          </Link>
          <a href="https://github.com/shariqazeem/brief/blob/main/SUBMISSION.md" target="_blank" rel="noreferrer" className="font-mono text-[10px] uppercase tracking-[0.24em] transition-colors hover:opacity-70" style={{ color: SUB }}>
            Full submission ↗
          </a>
        </div>
      </section>
    </main>
  );
}
