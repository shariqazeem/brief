"use client";

// /proof — the judge surface. Maps Brief to the Agentic Web
// "Autonomous Agent Wallet" must-haves, each with a LIVE, clickable
// on-chain artifact. Every digest/blob below was verified success on
// the fullnode / HTTP-200 on the Walrus aggregator before shipping
// (see SUBMISSION.md "Verifiable live artifacts"). No recharts; all
// dynamic data comes from the server-cached API routes.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { apiUrl } from "@/lib/api-base";

// ── Verified artifacts (authoritative: fullnode `success` / Walrus 200) ──
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
const short = (s: string, h = 8, t = 6) =>
  s.length <= h + t + 1 ? s : `${s.slice(0, h)}…${s.slice(-t)}`;

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
      {children}
    </span>
  );
}

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
      className={[
        "inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[10.5px] tracking-tight transition-colors",
        tone === "emerald"
          ? "border-emerald-600/50 bg-emerald-50/50 text-emerald-800 hover:bg-emerald-100/60"
          : "border-line text-ink hover:border-line-strong hover:bg-bg-elev-2/50",
      ].join(" ")}
    >
      {label}
      <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} aria-hidden />
    </a>
  );
}

// One must-have row.
function ProofRow({
  n,
  requirement,
  how,
  children,
}: {
  n: string;
  requirement: string;
  how: string;
  children: React.ReactNode;
}) {
  return (
    <article className="border-t border-line py-8 sm:py-10">
      <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[12px] tabular-nums text-muted-2">
              {n}
            </span>
            <h2 className="font-sans text-[20px] font-medium leading-tight tracking-tight text-ink sm:text-[24px]">
              {requirement}
            </h2>
          </div>
          <p className="mt-3 max-w-prose text-[14px] leading-relaxed text-ink-2">
            {how}
          </p>
        </div>
        <div className="lg:pt-1">{children}</div>
      </div>
    </article>
  );
}

type PolicyData = {
  ok?: boolean;
  revoked?: boolean;
  budget_cap_sui?: number;
  spent_sui?: number;
  remaining_sui?: number;
  allowed_venues?: string[];
};

function usePolicyRead(id: string): PolicyData | null {
  const [data, setData] = useState<PolicyData | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(apiUrl(`/api/policy?id=${id}`));
        if (r.ok && !cancelled) setData((await r.json()) as PolicyData);
      } catch {
        /* leave null — row shows static digests regardless */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);
  return data;
}

// Row 2 — live budget burn-down for the demo policy.
function BudgetCeiling() {
  const p = usePolicyRead(DEMO_POLICY);
  const cap = p?.budget_cap_sui ?? null;
  const spent = p?.spent_sui ?? null;
  const pct = cap && spent != null ? Math.max(0, Math.min(1, (cap - spent) / cap)) : 1;
  return (
    <div className="border-2 border-ink bg-bg-elev p-4 sm:p-5">
      <Mono>Brief Demo Fleet · live</Mono>
      <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
        <span className="text-[22px] text-ink">
          {spent != null ? spent.toFixed(2) : "—"}
        </span>
        <span className="text-[12px] text-muted">
          / {cap != null ? cap.toFixed(2) : "—"} SUI spent
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden bg-line">
        <div
          className="h-full bg-ink transition-[width] duration-700 ease-out"
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <p className="mt-2 font-mono text-[9.5px] leading-relaxed tracking-[0.04em] text-muted">
        {p?.allowed_venues?.length
          ? `venues [${p.allowed_venues.join(", ")}] · `
          : ""}
        every spend = one <span className="text-ink-2">record_spend</span>; the
        chain reverts the mint when the cap is hit.
      </p>
      <div className="mt-3">
        <TxLink label={`policy ${short(DEMO_POLICY)}`} href={objUrl(DEMO_POLICY)} />
      </div>
    </div>
  );
}

type Decision = {
  ts: number;
  strategy: string;
  direction: string | null;
  quantity: number;
  abstained: boolean;
  mode: string;
  mint_tx: string | null;
  strike_usd: number | null;
};

// Row 3 — on-chain activity log: the demo trader's last decisions.
function ActivityLog() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(apiUrl(`/api/trader/trades?policy_id=${DEMO_POLICY}`));
        if (r.ok && !cancelled) {
          const j = (await r.json()) as { decisions?: Decision[] };
          setDecisions((j.decisions ?? []).slice(0, 5));
        }
      } catch {
        /* fall back to the static journal link below */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="border border-line bg-bg-elev p-4 sm:p-5">
      <Mono>Last decisions · parsed from on-chain deliverables</Mono>
      <ul className="mt-3 space-y-1.5">
        {decisions.length === 0 ? (
          <li className="font-mono text-[11px] text-muted">
            warming up — open the cumulative journal on Walrus →
          </li>
        ) : (
          decisions.map((d) => (
            <li
              key={`${d.ts}-${d.mint_tx ?? "sim"}`}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/60 pb-1.5 font-mono text-[11px] tabular-nums last:border-0"
            >
              <span className="text-ink-2">
                {d.abstained ? (
                  <span className="text-muted">sat out</span>
                ) : (
                  <span
                    className={
                      d.direction === "down" ? "text-red-700" : "text-emerald-700"
                    }
                  >
                    {d.direction?.toUpperCase()} ×{d.quantity}
                  </span>
                )}{" "}
                <span className="text-muted">· {d.strategy} · {d.mode}</span>
              </span>
              {d.mint_tx ? (
                <a
                  href={txUrl(d.mint_tx)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-800 underline-offset-4 hover:underline"
                >
                  {short(d.mint_tx, 6, 4)} ↗
                </a>
              ) : (
                <span className="text-muted">no mint</span>
              )}
            </li>
          ))
        )}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <TxLink
          label="cumulative memory (Walrus)"
          href={blobUrl(ART.journalBlob)}
          tone="emerald"
        />
        <TxLink
          label="abstention reasoning (Walrus)"
          href={blobUrl(ART.abstentionBlob)}
          tone="emerald"
        />
      </div>
    </div>
  );
}

// Row 4 — owner revocation, proven on chain.
function Revocation() {
  const p = usePolicyRead(REVOKED_POLICY);
  return (
    <div className="border-2 border-red-400/70 bg-red-50/40 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <Mono>EPolicyRevoked · code 3</Mono>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-red-700">
          {p?.revoked ? "policy.revoked = true (live)" : "on chain"}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        Owner revokes → the next mint aborts in{" "}
        <span className="font-mono text-ink">operator_policy::assert_can_spend</span>{" "}
        and the whole PTB reverts. The sim-fallback deliverable&apos;s{" "}
        <span className="font-mono text-ink">reason_if_simulated</span> carries
        the abort message — the chain refused, not our server.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <TxLink label="revoke tx" href={txUrl(ART.revokeTx)} />
        <TxLink label="aborted attempt" href={txUrl(ART.simFallbackDeliver)} />
        <TxLink label={`revoked policy ${short(REVOKED_POLICY, 6, 4)}`} href={objUrl(REVOKED_POLICY)} />
      </div>
      <div className="mt-4">
        <Mono>Watch the kill switch · 60s</Mono>
        <video
          className="mt-2 aspect-video w-full border border-line bg-bg-elev-2/60"
          controls
          poster=""
        >
          <track kind="captions" />
        </video>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
          clip drops here for the demo recording
        </p>
      </div>
    </div>
  );
}

type WireEvent = { ts: number; type: string; asset?: string; data?: Record<string, unknown> };

// Row 5 — the wire, live and read-only.
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
        setEvents((prev) => [...prev.slice(-9), e]);
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [events]);
  return (
    <div className="border border-line bg-ink p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted-2">
          /api/agent-events · read-only
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-2">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              connected ? "animate-pulse bg-emerald-400" : "bg-muted"
            }`}
            aria-hidden
          />
          {connected ? "live" : "connecting"}
        </span>
      </div>
      <div className="mt-3 h-[180px] overflow-y-auto font-mono text-[10.5px] leading-relaxed">
        {events.length === 0 ? (
          <p className="text-muted-2">
            the wire is quiet — dispatch from{" "}
            <Link href="/workforce" className="text-bg underline underline-offset-4">
              /workforce
            </Link>{" "}
            and the agent&apos;s steps stream here in real time.
          </p>
        ) : (
          events.map((e, i) => (
            <p key={`${e.ts}-${i}`} className="tabular-nums text-bg-elev-2">
              <span className="text-muted">
                {new Date(e.ts).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>{" "}
              <span className="text-emerald-400">{e.type}</span>
              {e.asset ? <span className="text-muted-2"> · {e.asset}</span> : null}
            </p>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

export default function ProofPage() {
  return (
    <main className="min-h-screen bg-bg text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-page items-center justify-between gap-3 px-5 py-5 sm:px-8">
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted hover:text-ink"
          >
            ← Brief
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Proof · testnet · verifiable
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-page px-5 py-12 sm:px-8 sm:py-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Agentic Web · Autonomous Agent Wallet
        </p>
        <h1 className="mt-4 max-w-3xl font-sans text-[34px] font-medium leading-[1.05] tracking-tightest text-ink sm:text-[48px]">
          Every claim, one click from the chain.
        </h1>
        <p className="mt-5 max-w-prose text-[15px] leading-relaxed text-ink-2 sm:text-[16px]">
          The track&apos;s four must-haves — real DeepBook orders, a
          self-enforced budget ceiling, an on-chain activity log, and
          demonstrable owner revocation — each mapped to a live artifact you
          can open on Suiscan or Walrus right now. Plus the agent thinking in
          public over SSE. Nothing here is a screenshot.
        </p>

        <div className="mt-10">
          <ProofRow
            n="01"
            requirement="Real DeepBook orders"
            how="The trader places policy-gated atomic PTBs: record_spend → predict::mint on DeepBook Predict for BTC, and market orders on DeepBook v3 spot for SUI/WAL/DEEP. Real fills, honest P&L — including losses."
          >
            <div className="space-y-3">
              <div className="border border-line bg-bg-elev p-4">
                <Mono>BTC binary mints · DeepBook Predict</Mono>
                <div className="mt-2 flex flex-wrap gap-2">
                  <TxLink label="Momentum DOWN ×4" href={txUrl(ART.mintMomentumDown)} />
                  <TxLink label="live-wire mint" href={txUrl(ART.mintLiveWire)} />
                </div>
              </div>
              <div className="border border-line bg-bg-elev p-4">
                <Mono>SUI spot pair · DeepBook v3 · realized −$0.009</Mono>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <TxLink label="open" href={txUrl(ART.spotOpen)} />
                  <span aria-hidden className="font-mono text-[11px] text-muted">→</span>
                  <TxLink label="close" href={txUrl(ART.spotClose)} />
                  <span className="font-mono text-[10.5px] text-red-700">
                    bet DOWN, SUI rose — lost. Not rigged.
                  </span>
                </div>
              </div>
            </div>
          </ProofRow>

          <ProofRow
            n="02"
            requirement="Self-enforced budget ceiling"
            how="The leash is a Move OperatorPolicy. Every bet debits its spent field via record_spend; when the cap is reached the mint PTB reverts. Live burn-down, read straight off the object."
          >
            <BudgetCeiling />
          </ProofRow>

          <ProofRow
            n="03"
            requirement="On-chain activity log"
            how="Every decision is delivered on chain as a Deliverable with inline JSON, and the agent's cumulative reasoning + memory is content-addressed on Walrus — fetchable by anyone, not stuck in our database."
          >
            <ActivityLog />
          </ProofRow>

          <ProofRow
            n="04"
            requirement="Owner revocation demonstrable"
            how="One signature flips policy.revoked. The very next mint — any asset — aborts EPolicyRevoked and the whole transaction reverts. Past wins still pay out via permissionless redeem."
          >
            <Revocation />
          </ProofRow>

          <ProofRow
            n="05"
            requirement="And it thinks in public"
            how="The trader emits one event per lifecycle beat — observe, signals, SVI read, decision, mint, Walrus, deliver — over SSE. This is the same wire the dashboard animates, read-only here."
          >
            <LiveWire />
          </ProofRow>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-line pt-8">
          <Link
            href="/workforce"
            className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-5 py-3 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2"
          >
            Adopt a trader →
          </Link>
          <Link
            href="/leaderboard"
            className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
          >
            Leaderboard
          </Link>
          <a
            href="https://github.com/shariqazeem/brief/blob/main/SUBMISSION.md"
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
          >
            Full submission ↗
          </a>
        </div>
      </section>
    </main>
  );
}
