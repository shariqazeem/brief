"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Github } from "lucide-react";
import { useReveal, useScrollProgress } from "@/lib/use-scroll-reveal";

/**
 * Landing — cinematic, scroll-driven, minimal text.
 *
 * The judge's first five seconds: AI agents that hire other AI agents,
 * pay each other in real SUI on chain, governed by a Move policy whose
 * kill switch the chain itself enforces. Three scroll-driven articles
 * mirror the real product arc:
 *
 *   I.   The brief       The charter — a Move OperatorPolicy minted by you
 *   II.  The workforce   Planner hires Research + Treasury; specialists
 *                        deliver and get paid in one atomic PTB
 *   III. The kill switch You revoke; the chain refuses the next payment
 *
 * Motion is CSS-only — IntersectionObserver toggles `visible` classes;
 * a small scroll-progress hook drives the per-section interpolations.
 */

const PACKAGE_ID =
  "0xe550ace873c02768dbaca7de3a2d64a28acd3f7c51551c9c97b704703e95fb9d";
const PACKAGE_EXPLORER = `https://suiscan.xyz/testnet/object/${PACKAGE_ID}`;
const REPO_URL = "https://github.com/shariqazeem/brief";

export default function Home() {
  return (
    <main className="min-h-screen bg-bg text-ink">
      <Header />
      <Hero />
      <LiveProofStrip />
      <ChapterBrief />
      <ChapterWorkforce />
      <ChapterRevoke />
      <Pillars />
      <Cta />
      <Footer />
    </main>
  );
}

// --------------------------------------------------------------------------
// Header — slim, sticky, monospace nav
// --------------------------------------------------------------------------

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-6 py-4 sm:px-10">
        <a href="/" className="flex items-center gap-2.5 text-ink">
          <Mark />
          <span className="text-[15px] font-medium tracking-tight">Brief</span>
        </a>
        <div className="flex items-center gap-5">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-2 transition-colors hover:text-ink sm:inline-flex"
          >
            <Github className="h-3 w-3" strokeWidth={1.75} />
            GitHub
          </a>
          <a
            href="/workforce"
            className="inline-flex items-center gap-2 border border-ink bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-bg transition-colors hover:bg-ink-2 sm:px-4 sm:py-2"
          >
            Console
            <span aria-hidden>→</span>
          </a>
        </div>
      </div>
    </header>
  );
}

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="2" y="5" width="16" height="2" rx="0.5" fill="currentColor" />
      <rect x="2" y="13" width="11" height="2" rx="0.5" fill="currentColor" />
    </svg>
  );
}

// --------------------------------------------------------------------------
// Hero — one sentence, all the air.
// --------------------------------------------------------------------------

function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-center overflow-hidden border-b border-line">
      {/* Soft typographic backdrop — large outlined glyph anchoring the page */}
      <div
        className="pointer-events-none absolute -bottom-32 -right-20 select-none font-sans text-[260px] font-medium italic leading-none text-ink/[0.05] sm:text-[420px]"
        aria-hidden
      >
        Brief
      </div>

      <div className="relative mx-auto w-full max-w-page px-6 sm:px-10">
        <p
          className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted"
          style={{ animation: "fadeUp 700ms cubic-bezier(0.22, 1, 0.36, 1) both" }}
        >
          Sui Overflow 2026 · Agentic Web
        </p>

        <h1
          className="mt-8 font-sans text-[44px] font-medium leading-[1.04] tracking-tightest text-ink sm:text-[88px] sm:leading-[1.02]"
          style={{ animation: "fadeUp 900ms cubic-bezier(0.22, 1, 0.36, 1) 100ms both" }}
        >
          The AI is not trusted.
          <br />
          <span className="italic">The policy is.</span>
        </h1>

        <p
          className="mt-8 max-w-[44ch] text-[16px] leading-[1.55] text-ink-2 sm:text-[17.5px]"
          style={{ animation: "fadeUp 900ms cubic-bezier(0.22, 1, 0.36, 1) 220ms both" }}
        >
          An autonomous workforce on Sui. AI agents that hire AI agents,
          paid on chain in real SUI, governed by a Move policy you can
          revoke in one signature.
        </p>

        <div
          className="mt-10 flex flex-wrap items-center gap-3"
          style={{ animation: "fadeUp 900ms cubic-bezier(0.22, 1, 0.36, 1) 340ms both" }}
        >
          <a
            href="/workforce"
            className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-5 py-3 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2"
          >
            Open console
            <span aria-hidden>→</span>
          </a>
          <a
            href={PACKAGE_EXPLORER}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.28em] text-ink-2 transition-colors hover:text-ink"
          >
            Live on testnet
            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
          </a>
        </div>

        {/* Scroll cue */}
        <p
          className="absolute bottom-10 left-6 font-mono text-[10px] uppercase tracking-[0.36em] text-muted sm:left-10"
          style={{ animation: "fadeUp 900ms cubic-bezier(0.22, 1, 0.36, 1) 600ms both" }}
        >
          <span className="inline-block animate-bounce-slow">↓</span>{" "}
          Three articles
        </p>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
// Live proof strip — real workforce data, on chain. Uses raw fetch() so
// the landing doesn't pull in dApp Kit / @mysten/sui (the console does;
// this is just marketing surface). Degrades silently on any failure —
// no fake rows, no placeholder zeros.
// --------------------------------------------------------------------------

const TESTNET_RPC = "https://fullnode.testnet.sui.io:443";
const PLANNER_ADDRESS =
  "0xd440b0b59ed5474b32ceb71d819c474e1512747179b7088ff324012767f5b435";

type Specialist = {
  address: string;
  registrationId: string;
  displayName: string;
  capabilities: string[];
  reputation: bigint;
  totalPaidMist: bigint;
};

type LastApproved = {
  capability: string;
  bountyMist: bigint;
  atMs: number;
  txDigest: string;
};

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { error?: { message: string }; result?: T };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

function unwrapOption(
  v: string | null | undefined | { vec?: string[] },
): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v?.vec) && v.vec.length > 0) return v.vec[0];
  return null;
}

async function loadLiveProof(): Promise<{
  specialists: Specialist[];
  lastApproved: LastApproved | null;
}> {
  // Pull recent AgentRegistered + TaskApproved events in parallel. Both
  // are MoveEventType queries against the v3 package id.
  const [registered, approved] = await Promise.all([
    rpc<{
      data: Array<{
        id: { txDigest: string };
        parsedJson: { agent_address?: string };
      }>;
    }>("suix_queryEvents", [
      { MoveEventType: `${PACKAGE_ID}::agent_registry::AgentRegistered` },
      null,
      50,
      true,
    ]),
    rpc<{
      data: Array<{
        id: { txDigest: string };
        parsedJson: {
          primary_capability?: string;
          bounty_amount?: string;
          approved_at_ms?: string;
        };
      }>;
    }>("suix_queryEvents", [
      { MoveEventType: `${PACKAGE_ID}::task::TaskApproved` },
      null,
      10,
      true,
    ]),
  ]);

  // For each distinct non-planner address, resolve the registration
  // object by fetching the tx and picking the created AgentRegistration.
  const seen = new Set<string>();
  const order: Array<{ address: string; txDigest: string }> = [];
  for (const ev of registered.data) {
    const addr = ev.parsedJson?.agent_address;
    if (!addr) continue;
    if (addr.toLowerCase() === PLANNER_ADDRESS.toLowerCase()) continue;
    if (seen.has(addr)) continue;
    seen.add(addr);
    order.push({ address: addr, txDigest: ev.id.txDigest });
    if (order.length >= 4) break;
  }
  const specialists: Specialist[] = [];
  for (const o of order) {
    try {
      const tx = await rpc<{
        objectChanges?: Array<{
          type?: string;
          objectType?: string;
          objectId?: string;
        }>;
      }>("sui_getTransactionBlock", [
        o.txDigest,
        { showObjectChanges: true },
      ]);
      const created = (tx.objectChanges ?? []).find(
        (c) =>
          c.type === "created" &&
          typeof c.objectType === "string" &&
          c.objectType.includes("::agent_registry::AgentRegistration"),
      );
      if (!created?.objectId) continue;
      const obj = await rpc<{
        data?: { content?: { dataType: string; fields?: Record<string, unknown> } };
      }>("sui_getObject", [created.objectId, { showContent: true }]);
      const content = obj.data?.content;
      if (!content || content.dataType !== "moveObject") continue;
      const f = content.fields ?? {};
      const totalPaid = BigInt((f.total_paid as string | number) ?? "0");
      const rep = BigInt((f.reputation_score as string | number) ?? "0");
      if (rep === 0n && totalPaid === 0n) continue;
      specialists.push({
        address: o.address,
        registrationId: created.objectId,
        displayName: String(f.display_name ?? "Specialist"),
        capabilities: Array.isArray(f.capabilities)
          ? (f.capabilities as string[])
          : [],
        reputation: rep,
        totalPaidMist: totalPaid,
      });
    } catch {
      /* skip this entry */
    }
  }
  specialists.sort((a, b) => {
    const dr = Number(b.reputation - a.reputation);
    if (dr !== 0) return dr;
    return Number(b.totalPaidMist - a.totalPaidMist);
  });

  let lastApproved: LastApproved | null = null;
  const ev = approved.data[0];
  if (ev) {
    lastApproved = {
      capability: ev.parsedJson?.primary_capability ?? "",
      bountyMist: BigInt(ev.parsedJson?.bounty_amount ?? "0"),
      atMs: Number(ev.parsedJson?.approved_at_ms ?? "0"),
      txDigest: ev.id.txDigest,
    };
  }
  return { specialists, lastApproved };
}

function LiveProofStrip() {
  const [data, setData] = useState<{
    specialists: Specialist[];
    lastApproved: LastApproved | null;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadLiveProof()
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;
  if (!data) return null;
  const { specialists, lastApproved } = data;
  if (specialists.length === 0 && !lastApproved) return null;

  return (
    <section className="border-b border-line bg-bg-elev/40">
      <div className="mx-auto max-w-page px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
            Live on chain · workforce roster
          </p>
          <a
            href="/workforce"
            className="hidden font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink sm:inline"
          >
            Open the console →
          </a>
        </div>
        {specialists.length > 0 && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {specialists.slice(0, 2).map((s) => {
              const earned = Number(s.totalPaidMist) / 1e9;
              return (
                <div
                  key={s.registrationId}
                  className="flex items-center justify-between gap-4 border border-line bg-bg-elev px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium tracking-tight text-ink">
                      {s.displayName || "Specialist"}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
                      {short(s.address, 8, 6)} · [{s.capabilities.join(", ")}]
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-right">
                    <Stat label="rep" value={String(s.reputation)} />
                    <Stat
                      label="earned"
                      value={`${earned >= 1 ? earned.toFixed(2) : earned.toFixed(3)} SUI`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {lastApproved && (
          <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted">
            Last payment ·{" "}
            <span className="text-ink-2 normal-case tracking-normal">
              {lastApproved.capability
                ? `${capitalize(lastApproved.capability)} agent`
                : "Specialist"}{" "}
              · {(Number(lastApproved.bountyMist) / 1e9).toFixed(3)} SUI · settled{" "}
              {formatRelative(lastApproved.atMs)}
            </span>
            {"  "}
            <a
              href={`https://suiscan.xyz/testnet/tx/${lastApproved.txDigest}`}
              target="_blank"
              rel="noreferrer"
              className="ml-2 inline-flex items-center gap-0.5 text-muted transition-colors hover:text-ink"
            >
              ↗ tx
            </a>
          </p>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
        {label}
      </p>
      <p className="font-mono text-[13px] tabular-nums text-ink">{value}</p>
    </div>
  );
}

// --------------------------------------------------------------------------
// Chapter shell — sticky 220vh sections with scroll-driven beat progression
// --------------------------------------------------------------------------

function Chapter({
  numeral,
  title,
  caption,
  tone = "ink",
  children,
}: {
  numeral: string;
  title: string;
  caption: string;
  tone?: "ink" | "kill";
  children: (progress: number) => React.ReactNode;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const progress = useScrollProgress(sectionRef);
  const titleTone = tone === "kill" ? "text-red-700" : "text-ink";
  return (
    <section
      ref={sectionRef}
      className="relative border-b border-line"
      style={{ height: "220vh" }}
    >
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-page grid-cols-1 gap-10 px-6 sm:px-10 lg:grid-cols-[260px_1fr] lg:gap-16">
          {/* Left: chapter heading */}
          <div className="flex flex-col gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
              Article {numeral}
            </p>
            <h2 className={`font-sans text-[34px] font-medium italic leading-[1.05] tracking-tight sm:text-[44px] ${titleTone}`}>
              {title}
            </h2>
            <p className="max-w-[28ch] text-[14px] leading-[1.55] text-ink-2">
              {caption}
            </p>
            <ChapterProgressBar progress={progress} tone={tone} />
          </div>

          {/* Right: scroll-driven stage */}
          <div className="relative flex items-center justify-center">
            {children(progress)}
          </div>
        </div>
      </div>
    </section>
  );
}

function ChapterProgressBar({
  progress,
  tone,
}: {
  progress: number;
  tone: "ink" | "kill";
}) {
  return (
    <div className="mt-4 hidden h-px w-40 bg-line lg:block" aria-hidden>
      <div
        className={`h-full ${tone === "kill" ? "bg-red-700" : "bg-ink"}`}
        style={{
          width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
          transition: "width 80ms linear",
        }}
      />
    </div>
  );
}

// --------------------------------------------------------------------------
// Chapter I — The brief. The charter materializes; budget fills; capabilities
// chip in; you sign.
// --------------------------------------------------------------------------

function ChapterBrief() {
  return (
    <Chapter
      numeral="I"
      title="The brief."
      caption="One sentence. One signature. The workforce's charter — a Move OperatorPolicy — lives on chain."
    >
      {(p) => <BriefStage progress={p} />}
    </Chapter>
  );
}

function BriefStage({ progress }: { progress: number }) {
  // Beat 1: 0.05 – 0.22 → card materializes
  // Beat 2: 0.22 – 0.45 → capability chips populate one by one
  // Beat 2: 0.22 – 0.55 → budget slider fills 0 → 0.50 SUI
  // Beat 3: 0.55 – 0.75 → owner signature lands
  const cardOpacity = clamp(remap(progress, 0.05, 0.22, 0, 1));
  const cardLift =
    cardOpacity > 0 ? clamp(remap(progress, 0.05, 0.22, 16, 0)) : 16;

  const ALL_CAPS = ["research", "audit", "treasury"] as const;
  const capCount = Math.floor(clamp(remap(progress, 0.22, 0.45, 0, 3.0001)));
  const caps = ALL_CAPS.slice(0, capCount);
  const sliderPct = Math.round(clamp(remap(progress, 0.22, 0.55, 0, 100)));
  const budgetSui = (0.5 * sliderPct) / 100;
  const signed = progress >= 0.6;
  const stampOpacity = clamp(remap(progress, 0.55, 0.72, 0, 1));
  const stampScale = clamp(remap(progress, 0.55, 0.72, 1.4, 1));

  return (
    <div
      className="relative w-full max-w-[480px]"
      style={{
        opacity: cardOpacity,
        transform: `translateY(${cardLift}px)`,
        transition: "opacity 80ms linear, transform 80ms linear",
      }}
    >
      <div className="border-2 border-ink bg-bg-elev p-6 font-mono text-[11.5px]">
        <p className="text-[9.5px] uppercase tracking-[0.36em] text-muted">
          Sui Move · OperatorPolicy
        </p>
        <p className="mt-2 text-[14px] uppercase tracking-[0.16em] text-ink">
          Workforce charter
        </p>
        <div className="my-4 h-px bg-line-strong" />
        <div className="my-1 h-px bg-line-strong" />

        <Row label="Brief">
          <span className="italic text-ink-2">
            “Evaluate this Move package for a DAO grant and probe DeepBook
            depth to size the disbursement.”
          </span>
        </Row>
        <Row label="Owner">0xyou…</Row>
        <Row label="Agent">Planner · 0xd440…b435</Row>
        <Row label="Capabilities">
          {caps.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {caps.map((c) => (
                <span
                  key={c}
                  className="border border-ink px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.18em] text-ink"
                  style={{
                    animation:
                      "fadeUp 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
                  }}
                >
                  {c}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-muted">[ awaiting ]</span>
          )}
        </Row>
        <Row label="Budget">
          <span className="tabular-nums text-ink">
            {budgetSui.toFixed(2)} SUI
          </span>
        </Row>

        {/* Budget slider track filling with scroll */}
        <div className="mt-2 h-1 w-full bg-line">
          <div
            className="h-full bg-ink"
            style={{
              width: `${sliderPct}%`,
              transition: "width 80ms linear",
            }}
          />
        </div>

        <Row label="Expiry">2 hours</Row>
        <Row label="Kill switch">owner-signed · chain-enforced</Row>

        <div className="my-4 h-px bg-line-strong" />
        <div className="my-1 h-px bg-line-strong" />

        <div className="flex items-center justify-between">
          <span className="text-[9.5px] uppercase tracking-[0.32em] text-muted">
            {signed ? "Signed · on chain" : "Draft · unsigned"}
          </span>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink"
            style={{
              opacity: stampOpacity,
              transform: `scale(${stampScale})`,
              transformOrigin: "right center",
              transition: "opacity 100ms linear, transform 100ms linear",
            }}
          >
            ✓ minted
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2.5 grid grid-cols-[100px_1fr] items-baseline gap-3 text-[11px]">
      <span className="text-[9.5px] uppercase tracking-[0.24em] text-muted">
        {label}
      </span>
      <span className="text-ink-2">{children}</span>
    </div>
  );
}

// --------------------------------------------------------------------------
// Chapter II — The workforce. The Planner hires Research + Treasury; both
// settle atomically in approve_with_policy. Money + reputation move on chain.
// --------------------------------------------------------------------------

function ChapterWorkforce() {
  return (
    <Chapter
      numeral="II"
      title="The workforce."
      caption="The Planner hires specialists. Each settlement is one atomic transaction — policy check, bounty transfer, reputation bump."
    >
      {(p) => <WorkforceStage progress={p} />}
    </Chapter>
  );
}

function WorkforceStage({ progress }: { progress: number }) {
  // Beat 1: 0.05 – 0.18 → card frame fades in
  // Beat 2: 0.18 – 0.42 → Research settlement fills row by row
  // Beat 3: 0.42 – 0.66 → Treasury settlement fills row by row
  // Beat 4: 0.66 – 0.82 → atomic footer caption lands
  const cardOpacity = clamp(remap(progress, 0.05, 0.18, 0, 1));
  const cardLift =
    cardOpacity > 0 ? clamp(remap(progress, 0.05, 0.18, 16, 0)) : 16;

  // Per-settlement: 3 sub-rows (record_spend / bounty / reputation), each
  // lights up in sequence. We map progress into row counts.
  const researchRowsLit = Math.floor(
    clamp(remap(progress, 0.18, 0.42, 0, 3.0001)),
  );
  const treasuryRowsLit = Math.floor(
    clamp(remap(progress, 0.42, 0.66, 0, 3.0001)),
  );
  const atomicCaption = progress >= 0.7;
  const captionOpacity = clamp(remap(progress, 0.66, 0.78, 0, 1));

  return (
    <div
      className="w-full max-w-[560px] border-2 border-ink bg-bg-elev font-mono"
      style={{
        opacity: cardOpacity,
        transform: `translateY(${cardLift}px)`,
        transition: "opacity 80ms linear, transform 80ms linear",
      }}
    >
      <div className="border-b border-ink-2 px-4 py-3 text-[9.5px] uppercase tracking-[0.36em] text-muted">
        Sui Move · approve_with_policy · two atomic PTBs
      </div>

      <SettlementBlock
        from="Planner"
        fromAddr="0xd440…b435"
        to="Research Agent"
        toAddr="0x5b8d…bcb9"
        bounty="0.025 SUI"
        rowsLit={researchRowsLit}
      />

      <div className="border-t border-line-subtle" />

      <SettlementBlock
        from="Planner"
        fromAddr="0xd440…b435"
        to="Treasury Agent"
        toAddr="0xa9f24…ddbf"
        bounty="0.025 SUI"
        rowsLit={treasuryRowsLit}
      />

      <div
        className="border-t border-ink/30 px-4 py-3 text-[10.5px] leading-relaxed text-ink-2"
        style={{
          opacity: captionOpacity,
          transform: atomicCaption ? "translateY(0)" : "translateY(6px)",
          transition: "opacity 240ms ease, transform 240ms ease",
        }}
      >
        Both run <span className="text-ink">record_spend</span> against the
        same{" "}
        <span className="text-ink">OperatorPolicy</span>. Revoke aborts the
        whole PTB.
      </div>
    </div>
  );
}

function SettlementBlock({
  from,
  fromAddr,
  to,
  toAddr,
  bounty,
  rowsLit,
}: {
  from: string;
  fromAddr: string;
  to: string;
  toAddr: string;
  bounty: string;
  rowsLit: number;
}) {
  // Three sub-rows in canonical PTB order. Each lights up in sequence so
  // the eye reads "policy check → bounty transfer → reputation bump" as a
  // unit, not a list.
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "record_spend", value: <span className="text-emerald-700">policy check passed</span> },
    {
      label: "bounty transfer",
      value: (
        <span className="tabular-nums text-ink">
          {bounty}{" "}
          <span className="text-muted">→ {to.toLowerCase()}</span>
        </span>
      ),
    },
    {
      label: "reputation",
      value: (
        <span className="tabular-nums text-ink">
          rep <span className="text-muted">0 →</span> 1
        </span>
      ),
    },
  ];
  return (
    <div className="px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <AgentDot active={rowsLit > 0} />
          <span className="text-[10.5px] uppercase tracking-[0.22em] text-muted">
            from
          </span>
          <span className="text-[12px] font-medium text-ink">{from}</span>
          <span className="text-[10.5px] text-muted">{fromAddr}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[10.5px] uppercase tracking-[0.22em] text-muted">
            → to
          </span>
          <span className="text-[12px] font-medium text-ink">{to}</span>
          <span className="text-[10.5px] text-muted">{toAddr}</span>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {rows.map((r, i) => {
          const on = i < rowsLit;
          return (
            <div
              key={r.label}
              className="grid grid-cols-[14px_140px_1fr] items-baseline gap-3 text-[11px]"
              style={{
                opacity: on ? 1 : 0.18,
                transform: on ? "translateY(0)" : "translateY(3px)",
                transition: "opacity 220ms ease, transform 220ms ease",
              }}
            >
              <span
                className={
                  on
                    ? "text-emerald-700"
                    : "text-muted"
                }
                aria-hidden
              >
                ✓
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted">
                {r.label}
              </span>
              <span>{r.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentDot({ active }: { active: boolean }) {
  return (
    <span
      className={
        "inline-block h-1.5 w-1.5 rounded-full transition-colors " +
        (active ? "bg-emerald-500" : "bg-muted/60")
      }
      aria-hidden
    />
  );
}

// --------------------------------------------------------------------------
// Chapter III — The kill switch. You revoke; the chain refuses settlement.
// --------------------------------------------------------------------------

function ChapterRevoke() {
  return (
    <Chapter
      numeral="III"
      title="The kill switch."
      caption="You revoke. The chain refuses the workforce's next payment. Funds stay locked in escrow; the AI never gets paid."
      tone="kill"
    >
      {(p) => <RevokeStage progress={p} />}
    </Chapter>
  );
}

function RevokeStage({ progress }: { progress: number }) {
  // Beat 1: 0.05 – 0.25 → card fades in with two settled rows
  // Beat 2: 0.25 – 0.45 → revoke signed row drops
  // Beat 3: 0.45 – 0.70 → aborted row lands in red
  // Beat 4: 0.70 – 0.90 → footer reddens
  const cardOpacity = clamp(remap(progress, 0.05, 0.18, 0, 1));
  const cardLift =
    cardOpacity > 0 ? clamp(remap(progress, 0.05, 0.18, 16, 0)) : 16;
  const revokeLanded = progress >= 0.3;
  const rejectionLanded = progress >= 0.5;
  const standDownLanded = progress >= 0.72;

  return (
    <div
      className="w-full max-w-[600px] border-2 border-ink bg-bg-elev font-mono"
      style={{
        opacity: cardOpacity,
        transform: `translateY(${cardLift}px)`,
        transition: "opacity 80ms linear, transform 80ms linear",
      }}
    >
      <div className="border-b border-ink-2 px-4 py-3 text-[9.5px] uppercase tracking-[0.36em] text-muted">
        Ledger · post-revocation
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink/30">
            <Th>Time</Th>
            <Th>Event</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">Status</Th>
          </tr>
        </thead>
        <tbody>
          {/* Two prior settlements for context */}
          <tr className="border-b border-line/70">
            <Td className="text-[11px] tabular-nums text-muted">15:58</Td>
            <Td className="text-[10.5px] text-muted">
              <span className="font-medium text-ink-2">Planner → Research</span>{" "}
              · approve_with_policy
            </Td>
            <Td className="text-right text-[11.5px] tabular-nums text-muted">
              0.025 SUI
            </Td>
            <Td className="text-right text-[10px] uppercase tracking-[0.18em] text-muted">
              paid
            </Td>
          </tr>
          <tr className="border-b border-line/70">
            <Td className="text-[11px] tabular-nums text-muted">15:59</Td>
            <Td className="text-[10.5px] text-muted">
              <span className="font-medium text-ink-2">Planner → Treasury</span>{" "}
              · approve_with_policy
            </Td>
            <Td className="text-right text-[11.5px] tabular-nums text-muted">
              0.025 SUI
            </Td>
            <Td className="text-right text-[10px] uppercase tracking-[0.18em] text-muted">
              paid
            </Td>
          </tr>

          {/* The revoke signature */}
          <tr
            className="border-b border-line/70"
            style={{
              opacity: revokeLanded ? 1 : 0,
              transform: revokeLanded ? "translateY(0)" : "translateY(8px)",
              transition: "opacity 280ms ease, transform 280ms ease",
            }}
          >
            <Td className="text-[11px] tabular-nums text-ink-2">16:00</Td>
            <Td className="text-[10.5px] text-ink-2">
              <span className="font-medium text-ink">Owner</span> ·
              operator_policy::revoke · policy.revoked ← true
            </Td>
            <Td className="text-right text-[11.5px] text-muted">—</Td>
            <Td className="text-right text-[10px] uppercase tracking-[0.18em] text-ink">
              committed
            </Td>
          </tr>

          {/* The rejection — visible payoff */}
          <tr
            className="border-b border-red-200 bg-red-50/40"
            style={{
              opacity: rejectionLanded ? 1 : 0,
              transform: rejectionLanded ? "translateY(0)" : "translateY(12px)",
              transition: "opacity 320ms ease, transform 320ms ease",
            }}
          >
            <Td className="text-[11px] tabular-nums text-red-800">16:00</Td>
            <Td className="text-[10.5px] text-red-800">
              <span className="font-medium text-red-700">Planner</span> ·
              approve_with_policy · refused on Research bounty
              <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-red-700">
                operator_policy::assert_can_spend
              </div>
            </Td>
            <Td className="text-right text-[11.5px] tabular-nums text-red-800">
              escrowed
            </Td>
            <Td className="text-right text-[10px] uppercase tracking-[0.18em] text-red-800">
              code 3
              <div className="text-[9.5px] tracking-[0.16em] text-red-700">
                EPolicyRevoked
              </div>
            </Td>
          </tr>
        </tbody>
      </table>

      <div
        className="border-t border-ink/30 px-4 py-2 text-[9.5px] uppercase tracking-[0.32em]"
        style={{
          opacity: standDownLanded ? 1 : 0.45,
          color: standDownLanded ? "#b91c1c" : "var(--muted, #6b7888)",
          transition: "opacity 280ms ease, color 280ms ease",
        }}
      >
        Workforce stood down · authority revoked
      </div>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2.5 text-left text-[9.5px] uppercase tracking-[0.32em] text-muted ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2.5 align-baseline ${className}`}>{children}</td>;
}

// --------------------------------------------------------------------------
// Pillars — four reveal-on-scroll cells, every claim literally true of the
// current system.
// --------------------------------------------------------------------------

const PILLARS: { glyph: string; title: string; body: string }[] = [
  {
    glyph: "01",
    title: "Capability object",
    body:
      "OperatorPolicy is a Move shared object. One signature mints it; only the chain can revoke.",
  },
  {
    glyph: "02",
    title: "Atomic settlement",
    body:
      "approve_with_policy runs the policy check, transfers the bounty, and bumps reputation in one PTB. Revoke aborts the whole thing.",
  },
  {
    glyph: "03",
    title: "Reputation that travels",
    body:
      "Every paid delivery bumps reputation_score on the worker's AgentRegistration. It belongs to the worker, not the company.",
  },
  {
    glyph: "04",
    title: "DeepBook-native CLOB",
    body:
      "The Treasury agent composes POST_ONLY place_limit_order in the same PTB as settlement. Real depth, real order ids, no oracle.",
  },
];

function Pillars() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-page px-6 py-28 sm:px-10 sm:py-40">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Why Sui
        </p>
        <h2 className="mt-6 max-w-[20ch] font-sans text-[32px] font-medium italic leading-[1.06] tracking-tight text-ink sm:text-[48px]">
          The capability object is the product.
        </h2>

        <div className="mt-16 grid grid-cols-1 gap-px bg-line-strong sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p, i) => (
            <PillarCell key={p.glyph} pillar={p} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PillarCell({
  pillar,
  index,
}: {
  pillar: (typeof PILLARS)[number];
  index: number;
}) {
  const { ref, visible } = useReveal(0.25);
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className="flex flex-col gap-4 bg-bg p-6 sm:p-8"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: `opacity 700ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 90}ms, transform 700ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 90}ms`,
      }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
        {pillar.glyph}
      </p>
      <p className="font-sans text-[19px] font-medium tracking-tight text-ink">
        {pillar.title}
      </p>
      <p className="text-[13.5px] leading-[1.6] text-ink-2">{pillar.body}</p>
    </div>
  );
}

// --------------------------------------------------------------------------
// CTA — minimal, single sentence + one button
// --------------------------------------------------------------------------

function Cta() {
  const { ref, visible } = useReveal(0.3);
  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className="border-b border-line"
    >
      <div
        className="mx-auto flex min-h-[60svh] max-w-page flex-col items-center justify-center px-6 py-24 text-center sm:px-10 sm:py-32"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(24px)",
          transition: "opacity 800ms cubic-bezier(0.22, 1, 0.36, 1), transform 800ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Hire your workforce
        </p>
        <h2 className="mt-6 max-w-[20ch] font-sans text-[36px] font-medium italic leading-[1.05] tracking-tight text-ink sm:text-[56px]">
          Write a brief. Sign once. Watch the chain enforce it.
        </h2>
        <a
          href="/workforce"
          className="mt-10 inline-flex items-center gap-2 border-2 border-ink bg-ink px-6 py-3.5 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2"
        >
          Open console
          <span aria-hidden>→</span>
        </a>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
// Footer
// --------------------------------------------------------------------------

function Footer() {
  return (
    <footer className="mx-auto max-w-page px-6 py-10 sm:px-10">
      <div className="flex flex-col items-baseline justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span className="text-[14px] font-medium tracking-tight">Brief</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-5 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          <span>Sui Overflow 2026</span>
          <a
            href="https://x.com/shariqshkt"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-ink-2 hover:text-ink"
          >
            @shariqshkt
            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-ink-2 hover:text-ink"
          >
            GitHub
            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
          </a>
          <a
            href={PACKAGE_EXPLORER}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-ink-2 hover:text-ink"
          >
            Move package
            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
          </a>
        </div>
      </div>
    </footer>
  );
}

// --------------------------------------------------------------------------
// Math + format helpers
// --------------------------------------------------------------------------

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMin;
  return outMin + ((v - inMin) * (outMax - outMin)) / (inMax - inMin);
}

function short(s: string, head = 6, tail = 4): string {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatRelative(atMs: number): string {
  if (!atMs) return "—";
  const diff = Date.now() - atMs;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
