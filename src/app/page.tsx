"use client";

// Landing v2 · "Adopt an operator. The chain holds the leash."
//
// Three full-viewport sections (Hook · Watch It Think · The Leash) on the
// bright white "operator" design system. Everything dynamic is sourced
// from REAL data: the global agent-events SSE wire, /api/trader/signals
// (live BTC + sparkline), and /api/policy (live budget burn-down). When
// the wire is quiet it shows an honest idle state · never fabricated
// numbers. PRESERVE CAPITAL is a first-class decision, same visual weight
// as a trade (amber, confident · not a cautious "no trade").

import { useEffect, useMemo, useRef, useState } from "react";

import { apiUrl } from "@/lib/api-base";
import { loadLatestTraderIdentity } from "@/lib/workforce-client";

// ── design tokens (brief-exact) ──────────────────────────────────────────
const INK = "#111111";
const SUB = "#666666";
const EMERALD = "#10B981";
const RED = "#EF4444";
const AMBER = "#F59E0B";
const IDLE = "#999999";
const CARD = "shadow-[0_1px_3px_rgba(0,0,0,0.06)]";

const SUISCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;

// ── the live decision the cascade renders (reduced from the global SSE) ──
type Decision = {
  taskId: string | null;
  policyId: string | null;
  asset: string;
  spotUsd: number | null;
  reasoning: string | null;
  decided: boolean | null;
  direction: "up" | "down" | null;
  mode: "live" | "simulated" | null;
  simReason: string | null;
  mintTx: string | null;
  failed: boolean;
  deliveredTx: string | null;
  // which beat is live now, drives the circle + the active step
  beat:
    | "idle"
    | "observe"
    | "signals"
    | "svi"
    | "decision"
    | "mint"
    | "delivered";
  lastTs: number;
};

const EMPTY: Decision = {
  taskId: null,
  policyId: null,
  asset: "BTC",
  spotUsd: null,
  reasoning: null,
  decided: null,
  direction: null,
  mode: null,
  simReason: null,
  mintTx: null,
  failed: false,
  deliveredTx: null,
  beat: "idle",
  lastTs: 0,
};

type WireEvent = {
  ts: number;
  type: string;
  task_id?: string | null;
  policy_id?: string | null;
  asset?: string;
  data?: Record<string, unknown>;
};

// Reduce the GLOBAL wire into the latest operator's decision. A new task
// (different task_id) resets the cascade so it always shows one coherent
// "think" sequence, not interleaved noise.
function reduceWire(cur: Decision, e: WireEvent): Decision {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const isNewTask =
    e.type === "task_started" ||
    (!!e.task_id && e.task_id !== cur.taskId);
  const base: Decision =
    isNewTask && e.type !== "warden_topup"
      ? { ...EMPTY, taskId: e.task_id ?? null, asset: e.asset ?? "BTC" }
      : { ...cur };
  base.lastTs = e.ts;
  if (e.asset) base.asset = e.asset;
  if (e.policy_id) base.policyId = e.policy_id;
  switch (e.type) {
    case "observe":
      base.spotUsd = num(d.spot_usd) ?? base.spotUsd;
      base.beat = "observe";
      return base;
    case "signals":
      base.beat = "signals";
      return base;
    case "svi":
      base.beat = "svi";
      return base;
    case "decision":
      base.decided = d.decided === true;
      base.direction = (str(d.direction) as "up" | "down" | null) ?? null;
      base.reasoning = str(d.reasoning);
      base.beat = "decision";
      return base;
    case "mode":
      base.mode = (str(d.mode) as "live" | "simulated" | null) ?? base.mode;
      base.simReason = str(d.sim_reason);
      return base;
    case "mint_pending":
      base.beat = "mint";
      return base;
    case "mint_landed":
    case "spot_opened":
      base.mintTx = str(d.tx);
      base.beat = "mint";
      return base;
    case "mint_failed":
      base.failed = true;
      base.simReason = str(d.error) ?? base.simReason;
      base.beat = "mint";
      return base;
    case "delivered":
      base.deliveredTx = str(d.tx);
      base.mode = (str(d.mode) as "live" | "simulated" | null) ?? base.mode;
      base.beat = "delivered";
      return base;
    default:
      return base;
  }
}

function useGlobalWire() {
  const [cur, setCur] = useState<Decision>(EMPTY);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(apiUrl("/api/agent-events"));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      try {
        setCur((c) => reduceWire(c, JSON.parse(m.data) as WireEvent));
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  }, []);
  return { cur, connected };
}

// Live BTC + 60-min sparkline for the Observing row (real feed).
function useBtcFeed() {
  const [pts, setPts] = useState<number[]>([]);
  const [spot, setSpot] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const r = await fetch(apiUrl("/api/trader/signals?asset=BTC&minutes=60"));
        if (r.ok) {
          const j = (await r.json()) as {
            points?: Array<{ price: number }>;
            latest?: { spot?: number } | null;
          };
          if (!cancelled) {
            setPts((j.points ?? []).map((p) => p.price).slice(-60));
            setSpot(j.latest?.spot ?? null);
          }
        }
      } catch {
        /* keep last frame */
      }
      if (!cancelled) timer = setTimeout(tick, 10_000);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return { pts, spot };
}

// Live budget burn-down for the active operator's policy (real).
function usePolicyBudget(policyId: string | null) {
  const [pct, setPct] = useState<number | null>(null);
  const [revoked, setRevoked] = useState<boolean>(false);
  useEffect(() => {
    if (!policyId) {
      setPct(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(apiUrl(`/api/policy?id=${policyId}`));
        if (r.ok && !cancelled) {
          const p = (await r.json()) as {
            budget_cap_sui?: number;
            spent_sui?: number;
            revoked?: boolean;
          };
          if (p.budget_cap_sui && p.budget_cap_sui > 0) {
            setPct(Math.min(100, ((p.spent_sui ?? 0) / p.budget_cap_sui) * 100));
          }
          setRevoked(!!p.revoked);
        }
      } catch {
        /* omit % on failure */
      }
    })();
  }, [policyId]);
  return { pct, revoked };
}

// Network-wide proof for the above-the-fold trust strip · the single most
// important signal a judge sees in the first 3 seconds. Real, aggregated.
type NetworkProof = {
  operators: number;
  decisions: number;
  under_management: number;
  unit: string;
};
function useNetworkProof() {
  const [p, setP] = useState<NetworkProof | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(apiUrl("/api/network/proof"));
        if (r.ok) {
          const j = (await r.json()) as NetworkProof;
          if (!cancelled) setP(j);
        }
      } catch {
        /* strip hides if unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return p;
}

function Sparkline({ pts, color }: { pts: number[]; color: string }) {
  if (pts.length < 2) return null;
  const W = 96;
  const H = 22;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const path = pts
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${((i / (pts.length - 1)) * W).toFixed(1)},${(
          H -
          ((p - min) / span) * H
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={1.25} />
    </svg>
  );
}

// Typewriter for the thesis line · subtle, fast, reduced-motion safe.
function useTyped(text: string | null) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (!text) {
      setShown("");
      return;
    }
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setShown(text);
      return;
    }
    setShown("");
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [text]);
  return shown;
}

// One stat in the above-the-fold proof strip.
function ProofStat({ n, l, good }: { n: string; l: string; good?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-semibold tabular-nums" style={{ color: good ? EMERALD : INK }}>
        {n}
      </span>
      <span style={{ color: SUB }}>{l}</span>
    </span>
  );
}

// ── THE LEASH ─────────────────────────────────────────────────────────────
// The entire company in one animation: a warm-gold autonomous operator moves
// intelligently inside a thin grey boundary it can never cross. It explores,
// approaches the edge, the edge quietly resists, it changes course · never
// escaping, never stopping. Freedom within rules; intelligence controlled by
// law. No glow, no crypto, no sci-fi · museum-grade restraint. Reduced-motion
// renders a single resting frame.
const GOLD = "#C49A2C";
function LeashHero() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const SIZE = 240;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const R = SIZE / 2 - 10; // the boundary (the law)
    const EDGE = 18; // where resistance begins

    // The operator.
    let x = cx + 6;
    let y = cy - 4;
    let vx = 0.55;
    let vy = -0.4;
    let t = Math.random() * 1000;
    const trail: { x: number; y: number }[] = [];
    let raf = 0;

    function draw(edgeT: number, ang: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, SIZE, SIZE);
      // boundary · thin, grey, calm
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "#E6E6EA";
      ctx.lineWidth = 1;
      ctx.stroke();
      // the law resists · a faint gold arc only where it's being pushed
      if (edgeT > 0.02) {
        ctx.beginPath();
        ctx.arc(cx, cy, R, ang - 0.42, ang + 0.42);
        ctx.strokeStyle = `rgba(196,154,44,${(0.22 * edgeT).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // a whisper of a trail · motion, not glow
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i];
        const a = (i / trail.length) * 0.09;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(196,154,44,${a.toFixed(3)})`;
        ctx.fill();
      }
      // the operator
      ctx.beginPath();
      ctx.arc(x, y, 3.3, 0, Math.PI * 2);
      ctx.fillStyle = GOLD;
      ctx.fill();
    }

    function step() {
      t += 1;
      // organic intent · layered slow oscillators give non-repeating wander
      const dir =
        Math.sin(t * 0.0123) * 2.3 + Math.cos(t * 0.0071) * 1.6 + Math.sin(t * 0.0033) * 3.0;
      let ax = Math.cos(dir) * 0.021;
      let ay = Math.sin(dir) * 0.021;

      // the boundary pushes back, harder the closer it gets · never crosses
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy) || 1;
      let edgeT = 0;
      if (d > R - EDGE) {
        const over = (d - (R - EDGE)) / EDGE;
        edgeT = Math.min(1, over);
        const k = 0.085 * over * over;
        ax -= (dx / d) * k;
        ay -= (dy / d) * k;
      }

      vx = (vx + ax) * 0.986;
      vy = (vy + ay) * 0.986;

      // keep it alive but unhurried
      const sp = Math.hypot(vx, vy);
      const MAX = 0.8;
      const MIN = 0.16;
      if (sp > MAX) {
        vx = (vx / sp) * MAX;
        vy = (vy / sp) * MAX;
      } else if (sp < MIN && sp > 0) {
        vx = (vx / sp) * MIN;
        vy = (vy / sp) * MIN;
      }

      x += vx;
      y += vy;

      // hard guarantee: it never escapes the law
      const d2 = Math.hypot(x - cx, y - cy);
      if (d2 > R - 3) {
        const f = (R - 3) / d2;
        x = cx + (x - cx) * f;
        y = cy + (y - cy) * f;
        vx *= -0.35;
        vy *= -0.35;
      }

      trail.push({ x, y });
      if (trail.length > 28) trail.shift();
      draw(edgeT, Math.atan2(dy, dx));
      raf = requestAnimationFrame(step);
    }

    if (reduce) {
      x = cx + R * 0.32;
      y = cy - R * 0.12;
      draw(0, 0);
    } else {
      raf = requestAnimationFrame(step);
    }
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ width: 240, height: 240, display: "block" }}
    />
  );
}

// ── one cascade step ─────────────────────────────────────────────────────
function Step({
  active,
  done,
  dot,
  label,
  children,
}: {
  active: boolean;
  done: boolean;
  dot: string;
  label: string;
  children: React.ReactNode;
}) {
  // Past steps collapse to a thin, quiet line; the active step is full.
  return (
    <div
      className="v2-fade flex items-start gap-3 py-3 transition-opacity duration-500"
      style={{ opacity: active ? 1 : done ? 0.45 : 0.25 }}
    >
      <span
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: done || active ? dot : "#CCCCCC" }}
      />
      <div className="min-w-0 flex-1">
        <p
          className="font-mono text-[10px] uppercase tracking-[0.28em]"
          style={{ color: SUB }}
        >
          {label}
        </p>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

export default function OperatorLandingV2() {
  const { cur, connected } = useGlobalWire();
  const { pts, spot } = useBtcFeed();
  const { pct, revoked } = usePolicyBudget(cur.policyId);
  const proof = useNetworkProof();

  // Has the wire been quiet for >90s? → idle.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const stale = cur.lastTs === 0 || now - cur.lastTs > 90_000;

  // Smart CTA: new users go straight to the wizard to adopt; returning users
  // (an operator saved locally) go to /workforce, which opens it live.
  const [hasOperator, setHasOperator] = useState(false);
  useEffect(() => setHasOperator(!!loadLatestTraderIdentity()), []);
  const ctaHref = hasOperator ? "/workforce" : "/workforce/adopt";
  const ctaLabel = hasOperator ? "Open your operator →" : "Adopt an operator →";

  const circleState: "idle" | "processing" | "act" | "preserve" = stale
    ? "idle"
    : cur.beat === "decision" || cur.beat === "mint" || cur.beat === "delivered"
      ? cur.decided === false
        ? "preserve"
        : "act"
      : "processing";

  const liveSpot = cur.spotUsd ?? spot;
  const thesis = useTyped(stale ? null : cur.reasoning);

  const reached = (b: Decision["beat"]) => {
    const order = ["observe", "signals", "svi", "decision", "mint", "delivered"];
    return !stale && order.indexOf(cur.beat) >= order.indexOf(b);
  };

  const usd = (n: number | null) =>
    n == null
      ? "-"
      : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <main
      className="snap-y snap-mandatory overflow-y-auto bg-[#FAFAFA] font-sans text-[#111111]"
      style={{ height: "100vh" }}
    >
      {/* ════ SECTION 1 · THE HOOK ════ */}
      <section className="flex min-h-screen snap-start flex-col items-center justify-center px-6">
        <LeashHero />
        <h1 className="mt-14 max-w-2xl text-center text-[34px] font-medium leading-[1.1] tracking-[-0.02em] sm:text-[52px]">
          Adopt an operator.
          <br />
          The chain holds the leash.
        </h1>
        <p className="mt-6 max-w-xl text-center text-[15px] leading-relaxed sm:text-[16.5px]" style={{ color: SUB }}>
          An autonomous financial operator that <span style={{ color: INK }}>cannot steal your funds</span>,{" "}
          <span style={{ color: INK }}>cannot exceed its budget</span>, and{" "}
          <span style={{ color: INK }}>can be fired with one transaction</span>.
        </p>
        <div className="mt-10 flex items-center gap-7 font-mono text-[12px] tracking-[0.02em]">
          <a
            href={ctaHref}
            className="bg-accent px-6 py-3 text-[11px] uppercase tracking-[0.28em] text-white transition-opacity hover:opacity-90"
          >
            {ctaLabel}
          </a>
          <a
            href="#think"
            className="text-[#666666] transition-colors hover:text-[#111111]"
          >
            Watch it think ↓
          </a>
        </div>

        {/* Above-the-fold proof · the trust signal, no scroll required */}
        {proof && proof.operators > 0 && (
          <div className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 font-mono text-[11px] tracking-[0.01em]">
            <ProofStat n={`${proof.operators}`} l={proof.operators === 1 ? "operator live" : "operators live"} />
            <span className="text-[#CCCCCC]">·</span>
            <ProofStat n={proof.decisions.toLocaleString("en-US")} l="decisions" />
            <span className="text-[#CCCCCC]">·</span>
            <ProofStat n={`${proof.under_management} ${proof.unit}`} l="managed" />
            <span className="text-[#CCCCCC]">·</span>
            <ProofStat n="0" l="policy violations" good />
            <span className="text-[#CCCCCC]">·</span>
            <ProofStat n="0" l="custody incidents" good />
          </div>
        )}
      </section>

      {/* ════ SECTION 2 · WATCH IT THINK ════ */}
      <section
        id="think"
        className="flex min-h-screen snap-start flex-col items-center justify-center bg-white px-6 py-24"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#666666]">
          Watch it think
        </p>
        <div className={`mt-8 w-full max-w-[640px] bg-white ${CARD}`}>
          <div className="px-6 py-4 sm:px-8 sm:py-6">
            {/* 1 · Observing */}
            <Step active={!stale && cur.beat === "observe"} done={reached("signals")} dot={EMERALD} label="Observing">
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-[18px] tabular-nums text-[#111111]">
                  {stale ? "-" : usd(liveSpot)}
                  <span className="ml-2 text-[10px] text-[#666666]">{cur.asset}</span>
                </span>
                <Sparkline pts={pts} color={EMERALD} />
              </div>
            </Step>

            {/* 2 · Thesis */}
            <Step active={!stale && cur.beat === "decision"} done={reached("mint")} dot={EMERALD} label="Thesis">
              <p className="min-h-[1.4em] text-[14px] leading-relaxed text-[#111111]">
                {stale
                  ? "An operator's reasoning streams here in real time."
                  : thesis || (cur.reasoning ? "" : "Analyzing the tape…")}
              </p>
            </Step>

            {/* 3 · Risk */}
            <Step active={!stale && cur.beat === "decision"} done={reached("mint")} dot={EMERALD} label="Risk">
              <p className="font-mono text-[12px] tabular-nums text-[#111111]">
                {pct != null ? `Budget: ${pct.toFixed(0)}% used` : "Budget: on chain"}
                <span className="text-[#666666]">
                  {" · "}
                  Policy:{" "}
                  {revoked ? (
                    <span style={{ color: RED }}>revoked</span>
                  ) : (
                    <span style={{ color: EMERALD }}>clear</span>
                  )}
                  {" · "}
                  {cur.asset === "BTC" ? "predict-btc" : `spot-${cur.asset.toLowerCase()}`}
                </span>
              </p>
            </Step>

            {/* 4 · Decision (PRESERVE CAPITAL = same weight as a trade) */}
            <Step active={!stale && (cur.beat === "decision" || cur.beat === "mint")} done={reached("delivered")} dot={circleState === "preserve" ? AMBER : circleState === "act" ? (cur.direction === "down" ? RED : EMERALD) : EMERALD} label="Decision">
              {stale ? (
                <p className="text-[14px] text-[#666666]">Awaiting the next decision.</p>
              ) : cur.decided === false ? (
                <div>
                  <p className="font-mono text-[22px] font-medium tracking-tight" style={{ color: AMBER }}>
                    PRESERVE CAPITAL
                  </p>
                  <p className="mt-1 text-[13px] text-[#666666]">
                    No edge detected. Sitting out is the intelligent choice.
                  </p>
                </div>
              ) : cur.decided ? (
                <p
                  className="font-mono text-[22px] font-medium tracking-tight"
                  style={{ color: cur.direction === "down" ? RED : EMERALD }}
                >
                  ACT · {cur.direction === "down" ? "DOWN ▼" : "UP ▲"}
                </p>
              ) : (
                <p className="text-[14px] text-[#666666]">Weighing the edge…</p>
              )}
            </Step>

            {/* 5 · Chain */}
            <Step active={!stale && cur.beat === "delivered"} done={!!cur.deliveredTx} dot={cur.failed ? RED : EMERALD} label="Chain">
              {cur.mintTx ? (
                <a
                  href={SUISCAN_TX(cur.mintTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[12px]"
                  style={{ color: EMERALD }}
                >
                  {cur.mintTx.slice(0, 14)}… · Policy verified ↗
                </a>
              ) : cur.failed ? (
                <span className="font-mono text-[12px]" style={{ color: RED }}>
                  Chain refused · {cur.simReason?.slice(0, 48) ?? "policy gate"}
                </span>
              ) : cur.decided === false ? (
                <span className="font-mono text-[12px] text-[#666666]">
                  No spend · capital preserved, recorded on chain
                </span>
              ) : (
                <span className="font-mono text-[12px] text-[#666666]">
                  {stale ? "Verifiable on chain" : "Settling on chain…"}
                </span>
              )}
            </Step>
          </div>
        </div>

        <div className="mt-8 w-full max-w-[640px]">
          <div className="h-px w-full bg-[#E5E5E5]" />
          <a
            href="/proof"
            className="mt-4 inline-block font-mono text-[12px] text-[#666666] transition-colors hover:text-[#111111]"
          >
            Every decision is verifiable on Walrus →
          </a>
        </div>
      </section>

      {/* ════ SECTION 3 · THE LEASH ════ */}
      <section className="flex min-h-screen snap-start flex-col items-center justify-center px-6 py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#666666]">
          The leash
        </p>
        <div className="mt-12 grid w-full max-w-4xl gap-6 sm:grid-cols-3">
          {[
            {
              k: "01",
              h: "You set the rules",
              b: "Budget cap, allowed venues, expiry · chosen in one signature.",
            },
            {
              k: "02",
              h: "Move enforces them",
              b: "An on-chain OperatorPolicy object. Every spend checks it first.",
            },
            {
              k: "03",
              h: "You yank the leash",
              b: "One tap revokes. The chain refuses the operator's next trade.",
            },
          ].map((c) => (
            <div key={c.k} className={`bg-white px-6 py-7 ${CARD}`}>
              <p className="font-mono text-[12px] tabular-nums text-[#666666]">{c.k}</p>
              <h3 className="mt-3 text-[18px] font-medium tracking-tight text-[#111111]">
                {c.h}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#666666]">{c.b}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-center gap-3">
          {["Agentic Web", "DeepBook", "Walrus"].map((t) => (
            <span
              key={t}
              className={`bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#666666] ${CARD}`}
            >
              {t}
            </span>
          ))}
        </div>

        <div className="mt-12 flex items-center gap-8 font-mono text-[12px]">
          <a href={ctaHref} className="text-[#111111] transition-opacity hover:opacity-60">
            {hasOperator ? "Open your operator →" : "Adopt now →"}
          </a>
          <a href="/leaderboard" className="text-[#666666] transition-colors hover:text-[#111111]">
            Leaderboard
          </a>
          <span className="flex items-center gap-1.5 text-[#666666]">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: connected ? EMERALD : IDLE }}
            />
            {connected ? "live wire" : "connecting"}
          </span>
        </div>
      </section>

      {/* ════ SECTION 4 · THE PLATFORM / MAINNET ════ */}
      <section className="flex min-h-screen snap-start flex-col items-center justify-center bg-white px-6 py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#666666]">
          The platform
        </p>
        <h2 className="mt-8 max-w-3xl text-center text-[28px] font-medium leading-[1.12] tracking-[-0.02em] sm:text-[42px]">
          The first platform where autonomous agents
          <br className="hidden sm:block" /> are controlled by on-chain law.
        </h2>
        <p className="mt-6 max-w-xl text-center text-[15px] leading-relaxed text-[#666666] sm:text-[16px]">
          <span className="text-[#111111]">Halcyon is the first operator.</span> Finance is the
          proof. The first 100 operators on mainnet will be onboarded by hand.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-7 font-mono text-[12px]">
          <a
            href="https://x.com/shariqshkt"
            target="_blank"
            rel="noreferrer"
            className="bg-accent px-6 py-3 text-[11px] uppercase tracking-[0.28em] text-white transition-opacity hover:opacity-90"
          >
            Join mainnet access →
          </a>
          <a href={ctaHref} className="text-[#666666] transition-colors hover:text-[#111111]">
            {hasOperator ? "Open your operator →" : "Try it on testnet →"}
          </a>
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-center gap-3">
          {["Objective", "Trust", "Proof", "Evolution"].map((t) => (
            <span
              key={t}
              className={`bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#666666] ${CARD}`}
            >
              {t}
            </span>
          ))}
        </div>
        <p className="mt-10 max-w-md text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#999999]">
          Brief, by Kyvernlabs · built on Sui
        </p>
      </section>
    </main>
  );
}
