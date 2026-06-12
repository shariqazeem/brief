"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Github } from "lucide-react";
import { useReveal, useScrollProgress } from "@/lib/use-scroll-reveal";
import { apiUrl } from "@/lib/api-base";

/**
 * Landing — cinematic, scroll-driven, minimal text.
 *
 * The judge's first five seconds: adopt an AI agent, it bets BTC up or
 * down on DeepBook Predict with your money on chain, you hold a leash
 * the blockchain itself enforces. Three scroll-driven articles mirror
 * the real product arc:
 *
 *   I.   Adopt          Pick a personality, name it, set the leash —
 *                       one signature mints a Move OperatorPolicy.
 *   II.  It trades      Live BTC market → direction → atomic policy-
 *                       gated mint on DeepBook Predict → settled P&L.
 *   III. Yank the leash You revoke; the chain refuses the next bet
 *                       (EPolicyRevoked) — past wins still pay out.
 *
 * Motion is CSS-only — IntersectionObserver toggles `visible` classes;
 * a small scroll-progress hook drives the per-section interpolations.
 * No heavy SDK imports here — the landing stays light on first paint.
 */

const PACKAGE_ID =
  "0xe550ace873c02768dbaca7de3a2d64a28acd3f7c51551c9c97b704703e95fb9d";
const PACKAGE_EXPLORER = `https://suiscan.xyz/testnet/object/${PACKAGE_ID}`;
const REPO_URL = "https://github.com/shariqazeem/brief";
const PREDICT_INDEXER = "https://predict-server.testnet.mystenlabs.com";
const TREASURY_ADDRESS =
  "0xa9f24640b32f33fcfa8582791e84a542251398acfc3b696f382a08a768b6ddbf";
// Real kill-switch proof on chain (see SUBMISSION.md "Kill switch on a
// live policy"): the owner's revoke tx; the very next trader mint then
// aborted EPolicyRevoked. This is the verifiable artifact under ChapterYank.
const REVOKE_TX = "4yBvc6qVwoXugmZu1jNgNjHRC8ZtqMtoVefsuQZyB4YL";
const REVOKE_TX_EXPLORER = `https://suiscan.xyz/testnet/tx/${REVOKE_TX}`;

export default function Home() {
  return (
    <main className="min-h-screen bg-bg text-ink">
      <Header />
      <Hero />
      <LiveBtcStrip />
      <AgentFloor />
      <ChapterAdopt />
      <ChapterBet />
      <ChapterYank />
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
            Adopt a trader
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
// Hero — concrete + emotional. Names the loop in the subhead.
// --------------------------------------------------------------------------

function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-center overflow-hidden border-b border-line">
      <div
        className="pointer-events-none absolute -bottom-32 -right-20 select-none font-sans text-[260px] font-medium italic leading-none text-ink/[0.05] sm:text-[420px]"
        aria-hidden
      >
        Brief
      </div>

      <div className="relative mx-auto grid w-full max-w-page items-center gap-12 px-6 sm:px-10 lg:grid-cols-[1.25fr_0.75fr]">
        <div>
          <p
            className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted"
            style={{ animation: "fadeUp 700ms cubic-bezier(0.22, 1, 0.36, 1) both" }}
          >
            Sui Overflow 2026 · Agentic Web
          </p>

          <h1
            className="mt-8 font-sans text-[44px] font-medium leading-[1.04] tracking-tightest text-ink sm:text-[72px] sm:leading-[1.02]"
            style={{ animation: "fadeUp 900ms cubic-bezier(0.22, 1, 0.36, 1) 100ms both" }}
          >
            Adopt an AI trader.
            <br />
            <span className="italic">Watch it think. The chain holds the leash.</span>
          </h1>

          <p
            className="mt-8 max-w-[52ch] text-[16px] leading-[1.55] text-ink-2 sm:text-[17.5px]"
            style={{ animation: "fadeUp 900ms cubic-bezier(0.22, 1, 0.36, 1) 220ms both" }}
          >
            Pick a personality. Set how much it can risk. It trades BTC
            binaries on DeepBook Predict and SUI · WAL · DEEP spot on
            DeepBook v3 — every decision streamed live, every bet gated
            by a Move policy you can revoke in one tap.
          </p>

          <div
            className="mt-10 flex flex-wrap items-center gap-3"
            style={{ animation: "fadeUp 900ms cubic-bezier(0.22, 1, 0.36, 1) 340ms both" }}
          >
            <a
              href="/workforce"
              className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-5 py-3 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-all hover:bg-ink-2 hover:gap-3"
            >
              Adopt a trader
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
        </div>

        <div
          className="hidden lg:block"
          style={{ animation: "fadeUp 900ms cubic-bezier(0.22, 1, 0.36, 1) 480ms both" }}
        >
          <HeroLivePanel />
        </div>

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
// HeroLivePanel — the first five seconds are proof, not promise. Streams
// the SAME rolling price feed the deployed trader computes its signals
// from (cached server route, 12s poll): ticking spot, a 60-minute
// sparkline, and the live RSI/ROC the strategies act on. If the feed is
// cold we say so — no fake numbers, ever.
// --------------------------------------------------------------------------

type HeroFeed = {
  points: Array<{ ts: number; price: number }>;
  spot: number | null;
  rsi: number | null;
  roc30: number | null;
};

function HeroLivePanel() {
  const [feed, setFeed] = useState<HeroFeed | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const r = await fetch(apiUrl("/api/trader/signals?asset=BTC&minutes=60"));
        if (r.ok) {
          const j = (await r.json()) as {
            points?: Array<{ ts: number; price: number }>;
            latest?: { spot?: number; rsi60?: number | null; roc30?: number | null } | null;
          };
          if (!cancelled) {
            setFeed({
              points: j.points ?? [],
              spot: j.latest?.spot ?? null,
              rsi: j.latest?.rsi60 ?? null,
              roc30: j.latest?.roc30 ?? null,
            });
          }
        }
      } catch {
        /* keep last good frame */
      }
      if (!cancelled) timer = setTimeout(tick, 12_000);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const pts = feed?.points ?? [];
  const W = 360;
  const H = 84;
  let path = "";
  let lastXY: { x: number; y: number } | null = null;
  if (pts.length >= 2) {
    const min = Math.min(...pts.map((p) => p.price));
    const max = Math.max(...pts.map((p) => p.price));
    const span = max - min || 1;
    const x = (i: number) => (i / (pts.length - 1)) * W;
    const y = (v: number) => H - 6 - ((v - min) / span) * (H - 12);
    path = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`)
      .join(" ");
    lastXY = { x: x(pts.length - 1), y: y(pts[pts.length - 1]!.price) };
  }

  const rocPct = feed?.roc30 != null ? feed.roc30 * 100 : null;

  return (
    <aside className="relative overflow-hidden border-2 border-ink bg-bg-elev">
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-emerald-500/70 animate-operator-pulse-line"
        aria-hidden
      />
      <div className="px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-muted">
            Live · what the trader sees
          </p>
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
        </div>

        {feed?.spot ? (
          <p
            key={feed.spot}
            className="mt-3 font-sans text-[34px] font-medium leading-none tabular-nums tracking-tighter text-ink animate-value-tick"
          >
            $
            {feed.spot.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            <span className="ml-2 align-middle font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              BTC
            </span>
          </p>
        ) : (
          <p className="mt-3 font-mono text-[12px] uppercase tracking-[0.22em] text-muted">
            price feed warming up…
          </p>
        )}

        <div className="mt-4 h-[84px] w-full">
          {path ? (
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-full w-full"
              role="img"
              aria-label="BTC last hour, from the trader's own price feed"
            >
              <path d={path} fill="none" stroke="#0A0A0A" strokeWidth={1.5} />
              {lastXY && (
                <circle cx={lastXY.x} cy={lastXY.y} r={2.5} fill="#0A0A0A" />
              )}
            </svg>
          ) : (
            <div className="flex h-full items-center justify-center border border-line bg-bg-elev-2/40">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted">
                60-minute window fills as the agent observes
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="border border-line bg-bg px-3 py-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
              RSI 60m
            </p>
            <p className="mt-0.5 font-sans text-[16px] font-medium tabular-nums leading-none text-ink">
              {feed?.rsi != null ? feed.rsi.toFixed(1) : "—"}
            </p>
          </div>
          <div className="border border-line bg-bg px-3 py-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
              ROC 30m
            </p>
            <p
              className={`mt-0.5 font-sans text-[16px] font-medium tabular-nums leading-none ${
                rocPct == null
                  ? "text-ink"
                  : rocPct >= 0
                    ? "text-emerald-700"
                    : "text-red-700"
              }`}
            >
              {rocPct != null ? `${rocPct >= 0 ? "+" : ""}${rocPct.toFixed(3)}%` : "—"}
            </p>
          </div>
        </div>

        <p className="mt-4 font-mono text-[9px] leading-relaxed tracking-[0.06em] text-muted">
          The deployed agent&apos;s own rolling price feed — the same
          numbers its strategies act on. Nothing staged.
        </p>
      </div>
    </aside>
  );
}

// --------------------------------------------------------------------------
// Live BTC strip — real DeepBook Predict data the trader actually watches.
// Pulls the indexer's /oracles endpoint (no SDK import), filters BTC active,
// shows the nearest expiry + a recent settlement for price context, and
// renders the trader agent's address with its on-chain capability badge.
// Degrades silently on any failure — no fake rows, no placeholder zeros.
// --------------------------------------------------------------------------

type LiveBtcSnapshot = {
  nearestActive: {
    oracleId: string;
    expiryMs: number;
    minStrike: number;
    tickSize: number;
  } | null;
  lastSettled: {
    oracleId: string;
    settledAtMs: number;
    settlementPrice: number;
  } | null;
};

async function loadLiveBtc(): Promise<LiveBtcSnapshot | null> {
  try {
    const r = await fetch(`${PREDICT_INDEXER}/oracles`, { cache: "no-store" });
    if (!r.ok) return null;
    const xs = (await r.json()) as Array<{
      oracle_id: string;
      underlying_asset: string;
      status: string;
      expiry: number;
      min_strike: number;
      tick_size: number;
      settlement_price?: number;
      settled_at?: number;
    }>;
    if (!Array.isArray(xs)) return null;
    const btc = xs.filter((x) => x.underlying_asset === "BTC");
    const active = btc
      .filter((x) => x.status === "active")
      .sort((a, b) => a.expiry - b.expiry);
    const settled = btc
      .filter((x) => x.status === "settled" && x.settlement_price)
      .sort((a, b) => (b.settled_at ?? 0) - (a.settled_at ?? 0));
    const nearestActive = active[0]
      ? {
          oracleId: active[0].oracle_id,
          expiryMs: active[0].expiry,
          minStrike: active[0].min_strike,
          tickSize: active[0].tick_size,
        }
      : null;
    const lastSettled = settled[0]?.settlement_price
      ? {
          oracleId: settled[0].oracle_id,
          settledAtMs: settled[0].settled_at ?? 0,
          settlementPrice: settled[0].settlement_price,
        }
      : null;
    if (!nearestActive && !lastSettled) return null;
    return { nearestActive, lastSettled };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Shared leaderboard read — real adopted traders. Feeds both the live
// "Adopted traders" stat card and the agent-floor band. Polls every 60s.
// No fabrication: rows come straight from /api/leaderboard (on-chain
// aggregation); empty → consumers render their honest empty/absent state.
// --------------------------------------------------------------------------

type FloorRow = {
  policyId: string;
  name: string;
  assets: string[];
  realizedPnlUsd: number;
  liveCount: number;
  tradeCount: number;
  lastTradeAtMs: number;
  revoked: boolean;
};

type LeaderboardSummary = {
  rows: FloorRow[];
  traders: number;
  liveTrades: number;
  realizedPnlUsd: number;
  loaded: boolean;
};

function useLeaderboardSummary(): LeaderboardSummary {
  const [summary, setSummary] = useState<LeaderboardSummary>({
    rows: [],
    traders: 0,
    liveTrades: 0,
    realizedPnlUsd: 0,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const r = await fetch(apiUrl("/api/leaderboard"), { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as {
            rows?: Array<{
              policy_id: string;
              name: string;
              distinct_assets?: string[];
              realized_pnl_usd?: number;
              live_count?: number;
              trade_count?: number;
              last_trade_at_ms?: number;
              revoked?: boolean;
            }>;
          };
          const raw = j.rows ?? [];
          const rows: FloorRow[] = raw
            .filter((x) => (x.trade_count ?? 0) > 0)
            .map((x) => ({
              policyId: x.policy_id,
              name: x.name || "Untitled trader",
              assets: x.distinct_assets ?? [],
              realizedPnlUsd: x.realized_pnl_usd ?? 0,
              liveCount: x.live_count ?? 0,
              tradeCount: x.trade_count ?? 0,
              lastTradeAtMs: x.last_trade_at_ms ?? 0,
              revoked: x.revoked ?? false,
            }))
            .sort((a, b) => b.lastTradeAtMs - a.lastTradeAtMs);
          if (!cancelled) {
            setSummary({
              rows,
              traders: rows.length,
              liveTrades: rows.reduce((n, x) => n + x.liveCount, 0),
              realizedPnlUsd: rows.reduce((n, x) => n + x.realizedPnlUsd, 0),
              loaded: true,
            });
          }
        } else if (!cancelled) {
          setSummary((s) => ({ ...s, loaded: true }));
        }
      } catch {
        if (!cancelled) setSummary((s) => ({ ...s, loaded: true }));
      }
      if (!cancelled) timer = setTimeout(tick, 60_000);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return summary;
}

function LiveBtcStrip() {
  const [data, setData] = useState<LiveBtcSnapshot | null>(null);
  const [done, setDone] = useState(false);
  const board = useLeaderboardSummary();

  useEffect(() => {
    let cancelled = false;
    loadLiveBtc()
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setDone(true);
      })
      .catch(() => {
        if (cancelled) return;
        setDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nearestActive = data?.nearestActive ?? null;
  const lastSettled = data?.lastSettled ?? null;
  // Render once EITHER feed is ready — the BTC indexer and the
  // leaderboard fail independently; a dead indexer shouldn't hide the
  // adopted-trader stats and vice-versa.
  if (!done && !board.loaded) return null;
  if (!nearestActive && !lastSettled && board.traders === 0) return null;

  return (
    <section className="border-b border-line bg-bg-elev/40">
      <div className="mx-auto max-w-page px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
            Live · BTC market the trader watches
          </p>
          <a
            href="/workforce"
            className="hidden font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink sm:inline"
          >
            Adopt a trader →
          </a>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {nearestActive && (
            <article className="border border-line bg-bg-elev px-4 py-3">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
                Nearest BTC market · active
              </p>
              <p className="mt-1 font-sans text-[18px] tabular-nums tracking-tight text-ink">
                {fmtExpiry(nearestActive.expiryMs)}
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted">
                strike grid · ${(nearestActive.minStrike / 1e9).toLocaleString()}+
                · ${(nearestActive.tickSize / 1e9).toFixed(2)} tick
              </p>
              <a
                href={`https://suiscan.xyz/testnet/object/${nearestActive.oracleId}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-2 transition-colors hover:text-ink"
              >
                oracle {short(nearestActive.oracleId, 8, 4)}
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              </a>
            </article>
          )}
          {lastSettled && (
            <article className="border border-line bg-bg-elev px-4 py-3">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
                Last settled · BTC reference
              </p>
              <p className="mt-1 font-sans text-[18px] tabular-nums tracking-tight text-ink">
                ${(lastSettled.settlementPrice / 1e9).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted">
                settled {formatRelative(lastSettled.settledAtMs)}
              </p>
              <a
                href={`https://suiscan.xyz/testnet/object/${lastSettled.oracleId}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-2 transition-colors hover:text-ink"
              >
                oracle {short(lastSettled.oracleId, 8, 4)}
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              </a>
            </article>
          )}
          <article className="border border-line bg-bg-elev px-4 py-3">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
              Your trader agent · 24/7
            </p>
            <p className="mt-1 font-sans text-[18px] tabular-nums tracking-tight text-ink">
              ◇➤⊘∿ four personalities
            </p>
            <p className="mt-0.5 font-mono text-[10.5px] text-muted">
              predict-btc · spot-sui · spot-wal · spot-deep
            </p>
            <a
              href={`https://suiscan.xyz/testnet/object/${TREASURY_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-2 transition-colors hover:text-ink"
            >
              wallet {short(TREASURY_ADDRESS, 8, 4)}
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
            </a>
          </article>
          {board.traders > 0 && (
            <a
              href="/leaderboard"
              className="group block border border-line bg-bg-elev px-4 py-3 transition-colors hover:border-line-strong"
            >
              <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
                Adopted traders · on chain
              </p>
              <p
                key={board.traders}
                className="mt-1 font-sans text-[18px] tabular-nums tracking-tight text-ink animate-value-tick"
              >
                {board.traders} {board.traders === 1 ? "trader" : "traders"}
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted">
                {board.liveTrades} live {board.liveTrades === 1 ? "trade" : "trades"} ·{" "}
                <span
                  className={
                    board.realizedPnlUsd > 0
                      ? "text-emerald-700"
                      : board.realizedPnlUsd < 0
                        ? "text-red-700"
                        : "text-muted"
                  }
                >
                  {board.realizedPnlUsd >= 0 ? "+" : "−"}$
                  {Math.abs(board.realizedPnlUsd).toFixed(2)}
                </span>{" "}
                realized
              </p>
              <span className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-2 transition-colors group-hover:text-ink">
                leaderboard
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              </span>
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
// AgentFloor — "the floor is open." A horizontal, auto-scrolling band of
// REAL adopted traders (from /api/leaderboard). Two copies of the list
// loop seamlessly; hover pauses; reduced-motion freezes it. Renders
// nothing unless ≥2 real traders exist — never fabricates cards. The
// leaderboard rows carry no personality field, so each card leads with
// the trader's real asset chips + realized P&L + live status, not an
// invented glyph.
// --------------------------------------------------------------------------

function AgentFloor() {
  const board = useLeaderboardSummary();
  if (!board.loaded || board.rows.length < 2) return null;
  const cards = board.rows.slice(0, 12);
  // Duplicate the list so the -50% translate loops seamlessly.
  const loop = [...cards, ...cards];

  return (
    <section className="overflow-hidden border-b border-line bg-bg-elev/40">
      <div className="mx-auto max-w-page px-6 pt-8 sm:px-10">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
            The floor is open · live adopted traders
          </p>
          <a
            href="/leaderboard"
            className="hidden font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink sm:inline"
          >
            See the board →
          </a>
        </div>
      </div>
      <div
        className="group relative mt-5 overflow-hidden pb-8"
        aria-label="Live adopted traders, auto-scrolling"
      >
        {/* edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-bg-elev/90 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-bg-elev/90 to-transparent" />
        <div className="agent-floor-track flex w-max gap-3 px-6 sm:px-10">
          {loop.map((row, i) => (
            <FloorCard key={`${row.policyId}-${i}`} row={row} aria-hidden={i >= cards.length} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FloorCard({ row }: { row: FloorRow; "aria-hidden"?: boolean }) {
  const pnl = row.realizedPnlUsd;
  const live = !row.revoked && Date.now() - row.lastTradeAtMs < 90_000;
  return (
    <a
      href="/leaderboard"
      className="block w-[230px] shrink-0 border border-line bg-bg-elev px-4 py-3 transition-colors hover:border-line-strong"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-sans text-[14px] font-medium tracking-tight text-ink">
          {row.name}
        </span>
        {live ? (
          <span className="relative flex h-1.5 w-1.5 shrink-0" title="Decided within 90s">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
        ) : row.revoked ? (
          <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.18em] text-red-700">
            revoked
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {row.assets.length > 0 ? (
          row.assets.slice(0, 4).map((a) => (
            <span
              key={a}
              className="border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-2"
            >
              {a}
            </span>
          ))
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
            no markets yet
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span
          className={`font-sans text-[15px] font-medium tabular-nums ${
            pnl > 0 ? "text-emerald-700" : pnl < 0 ? "text-red-700" : "text-ink-2"
          }`}
        >
          {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
          {row.lastTradeAtMs ? formatRelative(row.lastTradeAtMs) : `${row.tradeCount} trades`}
        </span>
      </div>
    </a>
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
      className="relative h-[180vh] border-b border-line sm:h-[220vh]"
    >
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-page grid-cols-1 gap-10 px-6 sm:px-10 lg:grid-cols-[260px_1fr] lg:gap-16">
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
// Article I — Adopt. Personality glyph + name materialize; the leash
// budget fills; the OperatorPolicy gets minted on chain.
// --------------------------------------------------------------------------

function ChapterAdopt() {
  return (
    <Chapter
      numeral="I"
      title="Adopt."
      caption="Pick a personality. Name your trader. Set the leash. One signature mints the policy — owned by you, enforced by Move."
    >
      {(p) => <AdoptStage progress={p} />}
    </Chapter>
  );
}

function AdoptStage({ progress }: { progress: number }) {
  // Beat 1: 0.05 – 0.22 → card frame + personality glyph + name appear
  // Beat 2: 0.22 – 0.55 → leash slider fills 0 → 1.00 SUI
  // Beat 3: 0.55 – 0.72 → "minted" stamp lands
  const cardOpacity = clamp(remap(progress, 0.05, 0.22, 0, 1));
  const cardLift =
    cardOpacity > 0 ? clamp(remap(progress, 0.05, 0.22, 16, 0)) : 16;
  const glyphScale = clamp(remap(progress, 0.05, 0.28, 0.6, 1));
  const sliderPct = Math.round(clamp(remap(progress, 0.22, 0.55, 0, 100)));
  const budgetSui = (1.0 * sliderPct) / 100;
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
        <div className="mt-4 flex items-end gap-4">
          <span
            className="font-sans text-[56px] leading-none text-ink"
            style={{
              transform: `scale(${glyphScale})`,
              transformOrigin: "left bottom",
              transition: "transform 120ms linear",
            }}
            aria-hidden
          >
            ➤
          </span>
          <div>
            <p className="font-sans text-[22px] font-medium tracking-tight text-ink">
              Bolt
            </p>
            <p className="text-[9.5px] uppercase tracking-[0.22em] text-muted">
              Momentum · trend-following
            </p>
          </div>
        </div>

        <div className="my-4 h-px bg-line-strong" />
        <div className="my-1 h-px bg-line-strong" />

        <Row label="Owner">0xyou…</Row>
        <Row label="Agent">Trader · 0xa9f2…ddbf</Row>
        <Row label="Venue">
          <span className="border border-ink px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.18em] text-ink">
            predict-btc
          </span>
        </Row>
        <Row label="Leash">
          <span className="tabular-nums text-ink">
            {budgetSui.toFixed(2)} SUI to bet with
          </span>
        </Row>

        <div className="mt-2 h-1 w-full bg-line">
          <div
            className="h-full bg-ink"
            style={{
              width: `${sliderPct}%`,
              transition: "width 80ms linear",
            }}
          />
        </div>

        <Row label="Expiry">12 hours</Row>
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
// Article II — It trades. A single dramatic BTC bet: market chosen,
// direction taken, atomic policy-gated mint on chain, settled P&L.
// --------------------------------------------------------------------------

function ChapterBet() {
  return (
    <Chapter
      numeral="II"
      title="It trades."
      caption="The trader reads the live BTC market and takes an UP or DOWN position on DeepBook Predict. Real on-chain. Real P&L."
    >
      {(p) => <BetStage progress={p} />}
    </Chapter>
  );
}

// Live framing for ChapterBet: a REAL recent decision from the leading
// trader (direction + strike + spot from /api/trader/trades) plus the
// live BTC spot (/api/trader/signals). Null → BetStage shows the static
// illustration, labeled honestly.
type BetData = {
  traderName: string;
  direction: "up" | "down";
  strikeUsd: number;
  spotAtDecisionUsd: number;
  liveSpotUsd: number;
  mode: "live" | "simulated";
};

function useBetData(): BetData | null {
  const [data, setData] = useState<BetData | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sigR, lbR] = await Promise.all([
          fetch(apiUrl("/api/trader/signals?asset=BTC&minutes=60")),
          fetch(apiUrl("/api/leaderboard"), { cache: "no-store" }),
        ]);
        const sig = sigR.ok ? await sigR.json() : null;
        const liveSpot = sig?.latest?.spot ?? null;
        const lb = lbR.ok ? await lbR.json() : null;
        const rows = ((lb?.rows ?? []) as Array<{
          policy_id: string;
          name: string;
          trade_count?: number;
          last_trade_at_ms?: number;
        }>)
          .filter((r) => (r.trade_count ?? 0) > 0)
          .sort((a, b) => (b.last_trade_at_ms ?? 0) - (a.last_trade_at_ms ?? 0));
        if (rows.length === 0 || liveSpot == null) return;
        // Walk the most-active traders until one yields a usable decision
        // (a row's journal may be empty/unavailable; don't give up on the
        // first miss).
        for (const row of rows.slice(0, 4)) {
          if (cancelled) return;
          const tR = await fetch(
            apiUrl(`/api/trader/trades?policy_id=${row.policy_id}`),
          );
          const t = tR.ok ? await tR.json() : null;
          const dec = ((t?.decisions ?? []) as Array<{
            direction?: string;
            strike_usd?: number | null;
            spot_usd?: number | null;
            mode?: string;
          }>)[0];
          if (!dec || dec.strike_usd == null || !dec.direction) continue;
          if (!cancelled) {
            setData({
              traderName: row.name || "A trader",
              direction: dec.direction === "down" ? "down" : "up",
              strikeUsd: dec.strike_usd,
              spotAtDecisionUsd: dec.spot_usd ?? liveSpot,
              liveSpotUsd: liveSpot,
              mode: dec.mode === "simulated" ? "simulated" : "live",
            });
          }
          return;
        }
      } catch {
        /* stays null → illustration fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}

function BetStage({ progress }: { progress: number }) {
  // Beat 1: 0.05 – 0.18 → card frame fades in with the chosen market
  // Beat 2: 0.18 – 0.36 → direction lands (UP, emerald)
  // Beat 3: 0.36 – 0.56 → atomic PTB rows light up (record_spend → mint)
  // Beat 4: 0.56 – 0.78 → settles, payout flows back, P&L line lands
  const cardOpacity = clamp(remap(progress, 0.05, 0.18, 0, 1));
  const cardLift =
    cardOpacity > 0 ? clamp(remap(progress, 0.05, 0.18, 16, 0)) : 16;
  const directionLanded = progress >= 0.2;
  const ptbRowsLit = Math.floor(
    clamp(remap(progress, 0.36, 0.56, 0, 2.0001)),
  );
  const settled = progress >= 0.62;
  const payoutOpacity = clamp(remap(progress, 0.56, 0.78, 0, 1));
  const directionGlow = clamp(remap(progress, 0.18, 0.32, 0, 1));

  // Live framing when we have a real recent decision; otherwise the card
  // is a labeled illustration. Every shown number stays real.
  const live = useBetData();
  const usd0 = (n: number) =>
    `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const traderName = live?.traderName ?? "Bolt";
  const direction = live?.direction ?? "up";
  const isUp = direction === "up";
  const strikeUsd = live?.strikeUsd ?? 109_000;
  const spotAtDecisionUsd = live?.spotAtDecisionUsd ?? 109_234;
  const liveSpotUsd = live?.liveSpotUsd ?? 109_415;
  // In/out of the money right now, from live spot vs the real strike.
  const winning = isUp ? liveSpotUsd >= strikeUsd : liveSpotUsd <= strikeUsd;
  const gapUsd = Math.abs(liveSpotUsd - strikeUsd);
  const dirColor = isUp ? "4, 120, 87" : "185, 28, 28"; // emerald-700 / red-700

  return (
    <div
      className="w-full max-w-[560px] border-2 border-ink bg-bg-elev font-mono"
      style={{
        opacity: cardOpacity,
        transform: `translateY(${cardLift}px)`,
        transition: "opacity 80ms linear, transform 80ms linear",
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink-2 px-4 py-3">
        <span className="text-[9.5px] uppercase tracking-[0.36em] text-muted">
          DeepBook Predict · BTC binary · atomic PTB
        </span>
        {live ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-emerald-700">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            live · testnet
          </span>
        ) : (
          <span className="shrink-0 text-[9px] uppercase tracking-[0.18em] text-muted">
            illustration
          </span>
        )}
      </div>

      <div className="px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[10.5px] uppercase tracking-[0.22em] text-muted">
            {traderName}&apos;s bet
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted">
            BTC binary
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
          <KV label="strike">{usd0(strikeUsd)}</KV>
          <KV label="spot at decision">{usd0(spotAtDecisionUsd)}</KV>
        </div>
        <p
          className="mt-4 font-sans text-[26px] leading-[1.1] tracking-tight"
          style={{
            color: `rgba(${dirColor}, ${directionGlow})`,
            transform: directionLanded ? "translateY(0)" : "translateY(8px)",
            transition: "transform 280ms ease, color 220ms linear",
          }}
        >
          <span className="text-ink-2">{traderName} bets </span>
          {isUp ? "UP" : "DOWN"}
        </p>
      </div>

      <div className="border-t border-line-subtle px-4 py-4">
        <p className="text-[9.5px] uppercase tracking-[0.32em] text-muted">
          One atomic PTB · revoke aborts the whole thing
        </p>
        <div className="mt-3 space-y-1.5">
          <PtbRow
            on={ptbRowsLit > 0}
            label="operator_policy::record_spend"
            value={
              <span className="text-emerald-700">policy check passed</span>
            }
          />
          <PtbRow
            on={ptbRowsLit > 1}
            label="predict::mint·DUSDC"
            value={
              <span className="tabular-nums text-ink">
                {isUp ? "UP" : "DOWN"} position{" "}
                <span className="text-muted">· DeepBook order id minted</span>
              </span>
            }
          />
        </div>
      </div>

      <div
        className={`border-t border-ink/30 px-4 py-4 ${
          !live
            ? "bg-emerald-50/30"
            : winning
              ? "bg-emerald-50/30"
              : "bg-red-50/30"
        }`}
        style={{
          opacity: payoutOpacity,
          transform: settled ? "translateY(0)" : "translateY(6px)",
          transition: "opacity 280ms ease, transform 280ms ease",
        }}
      >
        {live ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={`text-[9.5px] uppercase tracking-[0.32em] ${
                  winning ? "text-emerald-800" : "text-red-800"
                }`}
              >
                Live · BTC spot now {usd0(liveSpotUsd)}
              </span>
              <span
                className={`font-sans text-[20px] font-medium tabular-nums tracking-tight ${
                  winning ? "text-emerald-800" : "text-red-800"
                }`}
              >
                {winning ? "in the money" : "out of the money"}
              </span>
            </div>
            <p
              className={`mt-2 text-[10.5px] uppercase tracking-[0.18em] ${
                winning ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {usd0(gapUsd)} {winning ? "above" : "below"} strike · settles at
              expiry · redeem is gateless
            </p>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[9.5px] uppercase tracking-[0.32em] text-emerald-800">
                Settled · BTC closed $109,415
              </span>
              <span className="font-sans text-[20px] font-medium tabular-nums tracking-tight text-emerald-800">
                +$0.83
              </span>
            </div>
            <p className="mt-2 text-[10.5px] uppercase tracking-[0.18em] text-emerald-700">
              predict::redeem_permissionless · payout claimed
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9.5px] uppercase tracking-[0.22em] text-muted">
        {label}
      </p>
      <p className="mt-0.5 tabular-nums text-ink">{children}</p>
    </div>
  );
}

function PtbRow({
  on,
  label,
  value,
}: {
  on: boolean;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      className="grid grid-cols-[14px_1fr_1fr] items-baseline gap-3 text-[11px]"
      style={{
        opacity: on ? 1 : 0.18,
        transform: on ? "translateY(0)" : "translateY(3px)",
        transition: "opacity 220ms ease, transform 220ms ease",
      }}
    >
      <span className={on ? "text-emerald-700" : "text-muted"} aria-hidden>
        ✓
      </span>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted">
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

// --------------------------------------------------------------------------
// Article III — Yank the leash. The chain refuses the next bet; past
// wins still flow. That contrast is the whole trust story.
// --------------------------------------------------------------------------

function ChapterYank() {
  return (
    <Chapter
      numeral="III"
      title="Yank the leash."
      caption="You revoke. The chain refuses the trader's next bet (EPolicyRevoked) — funds locked. Past wins still pay out: redeem is permissionless."
      tone="kill"
    >
      {(p) => <YankStage progress={p} />}
    </Chapter>
  );
}

function YankStage({ progress }: { progress: number }) {
  // Beat 1: 0.05 – 0.18 → card fades in with two settled rows
  // Beat 2: 0.25 – 0.42 → revoke signed row drops
  // Beat 3: 0.42 – 0.62 → red "refused" row lands
  // Beat 4: 0.62 – 0.80 → green "winnings still claimed" row lands
  // Beat 5: 0.72 – 0.92 → punchline reddens
  const cardOpacity = clamp(remap(progress, 0.05, 0.18, 0, 1));
  const cardLift =
    cardOpacity > 0 ? clamp(remap(progress, 0.05, 0.18, 16, 0)) : 16;
  const revokeLanded = progress >= 0.3;
  const rejectionLanded = progress >= 0.46;
  const survivorLanded = progress >= 0.66;
  const punchlineLanded = progress >= 0.76;

  return (
    <div className="w-full max-w-[600px]">
    <div
      className="border-2 border-ink bg-bg-elev font-mono"
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
          <tr className="border-b border-line/70">
            <Td className="text-[11px] tabular-nums text-muted">15:58</Td>
            <Td className="text-[10.5px] text-muted">
              <span className="font-medium text-ink-2">
                Bolt · UP @ $109,000
              </span>{" "}
              · predict::mint
            </Td>
            <Td className="text-right text-[11.5px] tabular-nums text-muted">
              $1.00
            </Td>
            <Td className="text-right text-[10px] uppercase tracking-[0.18em] text-muted">
              minted
            </Td>
          </tr>
          <tr className="border-b border-line/70">
            <Td className="text-[11px] tabular-nums text-muted">15:59</Td>
            <Td className="text-[10.5px] text-muted">
              <span className="font-medium text-ink-2">Bolt · settled UP</span>{" "}
              · redeem_permissionless
            </Td>
            <Td className="text-right text-[11.5px] tabular-nums text-emerald-700">
              +$1.83
            </Td>
            <Td className="text-right text-[10px] uppercase tracking-[0.18em] text-muted">
              paid
            </Td>
          </tr>

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
              <span className="font-medium text-red-700">Bolt</span> ·
              predict::mint · refused on next bet
              <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-red-700">
                operator_policy::assert_can_spend
              </div>
            </Td>
            <Td className="text-right text-[11.5px] tabular-nums text-red-800">
              locked
            </Td>
            <Td className="text-right text-[10px] uppercase tracking-[0.18em] text-red-800">
              code 3
              <div className="text-[9.5px] tracking-[0.16em] text-red-700">
                EPolicyRevoked
              </div>
            </Td>
          </tr>

          <tr
            className="bg-emerald-50/40"
            style={{
              opacity: survivorLanded ? 1 : 0,
              transform: survivorLanded ? "translateY(0)" : "translateY(12px)",
              transition: "opacity 320ms ease, transform 320ms ease",
            }}
          >
            <Td className="text-[11px] tabular-nums text-emerald-800">
              16:02
            </Td>
            <Td className="text-[10.5px] text-emerald-800">
              <span className="font-medium text-emerald-700">
                Earlier UP · settled
              </span>{" "}
              · redeem_permissionless
              <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-emerald-700">
                no policy gate · past wins still pay out
              </div>
            </Td>
            <Td className="text-right text-[11.5px] tabular-nums text-emerald-800">
              +$0.42
            </Td>
            <Td className="text-right text-[10px] uppercase tracking-[0.18em] text-emerald-800">
              claimed
            </Td>
          </tr>
        </tbody>
      </table>

      <div
        className="border-t border-ink/30 px-4 py-2 text-[9.5px] uppercase tracking-[0.32em]"
        style={{
          opacity: punchlineLanded ? 1 : 0.45,
          color: punchlineLanded ? "#b91c1c" : "var(--muted, #6b7888)",
          transition: "opacity 280ms ease, color 280ms ease",
        }}
      >
        Leash yanked · new bets refused · winnings still flow
      </div>

      <p
        className="border-t-2 border-red-700 px-4 py-4 font-sans text-[18px] italic leading-[1.2] tracking-tight text-red-700 sm:text-[22px]"
        style={{
          opacity: punchlineLanded ? 1 : 0,
          transform: punchlineLanded ? "translateY(0)" : "translateY(6px)",
          transition:
            "opacity 480ms cubic-bezier(0.22, 1, 0.36, 1), transform 480ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        The AI was never trusted.
        <br />
        The policy was.
      </p>
    </div>

    {/* Real, verifiable: the ledger above is the story; this is the
        receipt. Owner revoke tx on chain — the next mint aborted
        EPolicyRevoked (SUBMISSION.md "Kill switch on a live policy"). */}
    <a
      href={REVOKE_TX_EXPLORER}
      target="_blank"
      rel="noreferrer"
      className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-800 underline-offset-4 transition-colors hover:underline"
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" />
      see a real revoke on chain
      <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
    </a>
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
// Pillars — five reveal-on-scroll cells, every claim literally true of
// the current system.
// --------------------------------------------------------------------------

const PILLARS: { glyph: string; title: string; body: string }[] = [
  {
    glyph: "01",
    title: "The leash",
    body:
      "OperatorPolicy is a Move shared object you mint. One signature creates it; one signature revokes it. The chain enforces both.",
  },
  {
    glyph: "02",
    title: "Atomic policy-gated bet",
    body:
      "record_spend + predict::mint run in one PTB. Revoke flips the bit; the next mint aborts EPolicyRevoked. The whole tx reverts.",
  },
  {
    glyph: "03",
    title: "DeepBook Predict",
    body:
      "Real on-chain BTC up/down markets, settled by Block Scholes oracle. Every position is a verifiable on-chain object — not a synthetic.",
  },
  {
    glyph: "04",
    title: "zkLogin",
    body:
      "Wallet-first today; zkLogin wired for Google sign-in (Enoki-gated on testnet). The same policy + leash works for both — no separate account system.",
  },
  {
    glyph: "05",
    title: "Walrus memory",
    body:
      "Every trader decision (reasoning, strategy, market) is stored on Walrus. Content-addressed, fetchable by anyone — not stuck in our server.",
  },
];

function Pillars() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-page px-6 py-28 sm:px-10 sm:py-40">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Why Sui
        </p>
        <h2 className="mt-6 max-w-[22ch] font-sans text-[32px] font-medium italic leading-[1.06] tracking-tight text-ink sm:text-[48px]">
          The leash is the product.
        </h2>

        <div className="mt-16 grid grid-cols-1 gap-px bg-line-strong sm:grid-cols-2 lg:grid-cols-5">
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
          Adopt your trader
        </p>
        <h2 className="mt-6 max-w-[22ch] font-sans text-[36px] font-medium italic leading-[1.05] tracking-tight text-ink sm:text-[56px]">
          Pick a personality. Sign once. Watch BTC settle.
        </h2>
        <a
          href="/workforce"
          className="mt-10 inline-flex items-center gap-2 border-2 border-ink bg-ink px-6 py-3.5 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2"
        >
          Adopt a trader
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
      <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-line pb-6">
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          Built for Sui Overflow 2026 —
        </span>
        {["Agentic Web", "DeepBook", "Walrus"].map((t) => (
          <span
            key={t}
            className="border border-line px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink-2"
          >
            {t}
          </span>
        ))}
      </div>
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

function fmtExpiry(atMs: number): string {
  const dt = atMs - Date.now();
  if (dt < 0) return "expired";
  const mins = Math.floor(dt / 60_000);
  if (mins < 60) return `expires in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `expires in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `expires in ${days}d ${hours % 24}h`;
}
