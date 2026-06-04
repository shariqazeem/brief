"use client";

import { useRef } from "react";
import { ArrowUpRight, Github } from "lucide-react";
import { useReveal, useScrollProgress } from "@/lib/use-scroll-reveal";

/**
 * Landing — cinematic, scroll-driven, minimal text.
 *
 * Each "chapter" is a 200vh sticky section. As the viewer scrolls, the
 * chapter's content morphs through three beats:
 *
 *   I.   Grant      A charter materializes, slider fills, signature stamps.
 *   II.  Operate    A ledger fills row by row as the agent acts.
 *   III. Revoke     The owner signs revoke; a red row lands; the chain freezes.
 *
 * Then a brief "Why Sui" stagger reveal and a single CTA. Everything else
 * the marketing site used to say lives one click away on /app or in the
 * Move source.
 *
 * Motion is CSS-only — IntersectionObserver toggles `visible` classes;
 * a small scroll-progress hook drives the per-section interpolations.
 */

const PACKAGE_ID =
  "0xe550ace873c02768dbaca7de3a2d64a28acd3f7c51551c9c97b704703e95fb9d";
const PACKAGE_EXPLORER = `https://suiscan.xyz/testnet/object/${PACKAGE_ID}`;

export default function Home() {
  return (
    <main className="min-h-screen bg-bg text-ink">
      <Header />
      <Hero />
      <ChapterGrant />
      <ChapterOperate />
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
            href="https://github.com/shariqazeem"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-2 transition-colors hover:text-ink sm:inline-flex"
          >
            <Github className="h-3 w-3" strokeWidth={1.75} />
            GitHub
          </a>
          <a
            href="/app"
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
          paid on chain, governed by a Move policy you can revoke in one
          signature.
        </p>

        <div
          className="mt-10 flex flex-wrap items-center gap-3"
          style={{ animation: "fadeUp 900ms cubic-bezier(0.22, 1, 0.36, 1) 340ms both" }}
        >
          <a
            href="/app"
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
// Chapter shell — sticky 200vh sections with scroll-driven beat progression
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
  // 0 → 1 over the section. We display three beats: 0–0.45, 0.45–0.7, 0.7–1.
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
            <p className="max-w-[26ch] text-[14px] leading-[1.55] text-ink-2">
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
// Chapter I — Grant. A charter materializes; the slider fills; signed.
// --------------------------------------------------------------------------

function ChapterGrant() {
  return (
    <Chapter
      numeral="I"
      title="Grant."
      caption="One signature mints a Move shared object. The agent's authority is now on chain."
    >
      {(p) => <GrantStage progress={p} />}
    </Chapter>
  );
}

function GrantStage({ progress }: { progress: number }) {
  // Beat 1: 0.05 – 0.30 → charter materializes (opacity)
  // Beat 2: 0.30 – 0.60 → budget slider fills, venues populate
  // Beat 3: 0.60 – 0.85 → "signed on chain" stamp lands
  const cardOpacity = clamp(remap(progress, 0.05, 0.25, 0, 1));
  const cardLift =
    cardOpacity > 0 ? clamp(remap(progress, 0.05, 0.25, 16, 0)) : 16;
  const sliderPct = Math.round(
    clamp(remap(progress, 0.3, 0.55, 0, 100)),
  );
  const venuesPopulated = Math.floor(clamp(remap(progress, 0.4, 0.6, 0, 3)));
  const venues = ["DeepBook", "NAVI", "Suilend"].slice(0, venuesPopulated);
  const signed = progress >= 0.65;
  const stampOpacity = clamp(remap(progress, 0.65, 0.75, 0, 1));
  const stampScale = clamp(remap(progress, 0.65, 0.75, 1.4, 1));

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
          Sui Move · Operator Policy
        </p>
        <p className="mt-2 text-[14px] uppercase tracking-[0.16em] text-ink">
          Constitutional Charter
        </p>
        <div className="my-4 h-px bg-line-strong" />
        <div className="my-1 h-px bg-line-strong" />

        <Row label="Charter">
          <span className="text-ink">Conservative Yield</span>
        </Row>
        <Row label="Agent">0xd440…b435</Row>
        <Row label="Venues">
          {venues.length > 0 ? (
            venues.join(" · ")
          ) : (
            <span className="text-muted">[ awaiting ]</span>
          )}
        </Row>
        <Row label="Budget">
          <span className="text-ink tabular-nums">
            {Math.round(50 * (sliderPct / 100))} SUI
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

        <Row label="Concentration">30% of envelope</Row>
        <Row label="Expiry">24 hours</Row>

        <div className="my-4 h-px bg-line-strong" />
        <div className="my-1 h-px bg-line-strong" />

        <div className="flex items-center justify-between">
          <span className="text-[9.5px] uppercase tracking-[0.32em] text-muted">
            {signed ? "Signed · on chain" : "Draft · unsigned"}
          </span>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.28em]"
            style={{
              opacity: stampOpacity,
              transform: `scale(${stampScale})`,
              transformOrigin: "right center",
              transition: "opacity 100ms linear, transform 100ms linear",
              color: "var(--ink, #1a2c4e)",
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
// Chapter II — Operate. Ledger fills row by row.
// --------------------------------------------------------------------------

const LEDGER_BEATS: { time: string; venue: string; amt: string }[] = [
  { time: "16:24:08", venue: "DeepBook", amt: "1.000" },
  { time: "16:24:23", venue: "NAVI", amt: "0.800" },
  { time: "16:24:38", venue: "Suilend", amt: "1.000" },
  { time: "16:24:53", venue: "DeepBook", amt: "0.650" },
  { time: "16:25:08", venue: "NAVI", amt: "1.000" },
];

function ChapterOperate() {
  return (
    <Chapter
      numeral="II"
      title="Operate."
      caption="Every cycle is one atomic transaction. Real fills. Real receipts."
    >
      {(p) => <OperateStage progress={p} />}
    </Chapter>
  );
}

function OperateStage({ progress }: { progress: number }) {
  // 0.10 – 0.85 lights up the 5 ledger rows in order.
  const t0 = 0.1;
  const t1 = 0.85;
  const visibleRows = Math.floor(
    clamp(remap(progress, t0, t1, 0, LEDGER_BEATS.length + 0.0001)),
  );

  return (
    <div className="w-full max-w-[560px] border-2 border-ink bg-bg-elev font-mono">
      <div className="border-b border-ink-2 px-4 py-3 text-[9.5px] uppercase tracking-[0.36em] text-muted">
        Chronological Audit Ledger
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink/30">
            <Th>Time</Th>
            <Th>Event</Th>
            <Th>Venue</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">Status</Th>
          </tr>
        </thead>
        <tbody>
          {LEDGER_BEATS.map((r, i) => {
            const on = i < visibleRows;
            return (
              <tr
                key={i}
                className="border-b border-line/70"
                style={{
                  opacity: on ? 1 : 0,
                  transform: on ? "translateY(0)" : "translateY(8px)",
                  transition: "opacity 280ms ease, transform 280ms ease",
                }}
              >
                <Td className="text-[11px] tabular-nums text-ink-2">{r.time}</Td>
                <Td className="text-[10px] uppercase tracking-[0.18em] text-ink">
                  Deployed
                </Td>
                <Td className="text-[11.5px] text-ink-2">{r.venue}</Td>
                <Td className="text-right text-[11.5px] tabular-nums text-ink">
                  {r.amt}{" "}
                  <span className="text-muted">SUI</span>
                </Td>
                <Td className="text-right text-[10px] uppercase tracking-[0.18em] text-ink">
                  accepted
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-ink/30 px-4 py-2 text-[9.5px] uppercase tracking-[0.32em] text-muted">
        {visibleRows} of {LEDGER_BEATS.length} entries · real Sui testnet
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
// Chapter III — Revoke. One signature; the chain freezes the agent.
// --------------------------------------------------------------------------

function ChapterRevoke() {
  return (
    <Chapter
      numeral="III"
      title="Revoke."
      caption="One signature flips a single boolean. The agent's next attempt aborts on chain."
      tone="kill"
    >
      {(p) => <RevokeStage progress={p} />}
    </Chapter>
  );
}

function RevokeStage({ progress }: { progress: number }) {
  // Beat 1: 0.10 – 0.30 → revoke signature lands
  // Beat 2: 0.40 – 0.65 → rejection row drops into the ledger
  // Beat 3: 0.70 – 0.95 → operator stood down
  const revokeLanded = progress >= 0.18;
  const rejectionLanded = progress >= 0.45;
  const standDownLanded = progress >= 0.7;

  return (
    <div className="w-full max-w-[560px] border-2 border-ink bg-bg-elev font-mono">
      <div className="border-b border-ink-2 px-4 py-3 text-[9.5px] uppercase tracking-[0.36em] text-muted">
        Ledger · post-revocation
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink/30">
            <Th>Time</Th>
            <Th>Event</Th>
            <Th>Venue</Th>
            <Th className="text-right">Status</Th>
          </tr>
        </thead>
        <tbody>
          {/* Two prior deployments for context */}
          {LEDGER_BEATS.slice(0, 2).map((r) => (
            <tr key={r.time} className="border-b border-line/70">
              <Td className="text-[11px] tabular-nums text-muted">{r.time}</Td>
              <Td className="text-[10px] uppercase tracking-[0.18em] text-muted">
                Deployed
              </Td>
              <Td className="text-[11.5px] text-muted">{r.venue}</Td>
              <Td className="text-right text-[10px] uppercase tracking-[0.18em] text-muted">
                accepted
              </Td>
            </tr>
          ))}

          {/* The revoke signature */}
          <tr
            className="border-b border-line/70"
            style={{
              opacity: revokeLanded ? 1 : 0,
              transform: revokeLanded ? "translateY(0)" : "translateY(8px)",
              transition: "opacity 280ms ease, transform 280ms ease",
            }}
          >
            <Td className="text-[11px] tabular-nums text-ink-2">16:25:23</Td>
            <Td className="text-[10px] uppercase tracking-[0.18em] text-ink">
              Revoke signed
            </Td>
            <Td className="text-[11.5px] text-ink-2">policy.revoked ← true</Td>
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
            <Td className="text-[11px] tabular-nums text-red-800">16:25:38</Td>
            <Td className="text-[10px] uppercase tracking-[0.18em] text-red-700">
              Chain aborted
            </Td>
            <Td className="text-[11.5px] text-red-800">
              EPolicyRevoked [Code 3]
            </Td>
            <Td className="text-right text-[10px] uppercase tracking-[0.18em] text-red-700">
              rejected
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
        Operator stood down · authority revoked
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Pillars — four reveal-on-scroll cells, minimal copy
// --------------------------------------------------------------------------

const PILLARS: { glyph: string; title: string; body: string }[] = [
  { glyph: "01", title: "Capability object", body: "OperatorPolicy is a Move shared object. The chain holds it." },
  { glyph: "02", title: "Atomic PTB", body: "record_spend + the trade + the audit mint, one transaction." },
  { glyph: "03", title: "Programmable kill", body: "Revoke flips one boolean. The next attempt aborts mid-flight." },
  { glyph: "04", title: "Native CLOB", body: "DeepBook orders settle in the same PTB as the policy check." },
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
          Issue a charter
        </p>
        <h2 className="mt-6 max-w-[18ch] font-sans text-[36px] font-medium italic leading-[1.05] tracking-tight text-ink sm:text-[56px]">
          Grant a budget. Sign once. Watch the chain enforce it.
        </h2>
        <a
          href="/app"
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
// Math helpers
// --------------------------------------------------------------------------

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMin;
  return outMin + ((v - inMin) * (outMax - outMin)) / (inMax - inMin);
}
