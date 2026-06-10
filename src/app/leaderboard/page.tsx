"use client";

// /leaderboard — the live AI-trader competition board.
//
// Pulls /api/leaderboard, sorts rows, renders a ranked table with the
// current user's trader highlighted. The data is real on-chain: every
// row is one policy granted via the adopt wizard, every P&L number is
// derived from the trader's spot-close digests + redeem events.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw, Trophy } from "lucide-react";
import { useCurrentAccount } from "@mysten/dapp-kit";

import { apiUrl } from "@/lib/api-base";

type LeaderboardRow = {
  policy_id: string;
  name: string;
  owner: string;
  agent: string;
  budget_cap_sui: number;
  spent_sui: number;
  revoked: boolean;
  trade_count: number;
  distinct_assets: string[];
  live_count: number;
  simulated_count: number;
  journal_entries: number;
  journal_walrus_blob_id: string | null;
  reasoning_walrus_blob_id: string | null;
  realized_pnl_usd: number;
  win_count: number;
  loss_count: number;
  open_position_count: number;
  created_at_ms: number;
  last_trade_at_ms: number;
};

type LeaderboardResponse = {
  ok: boolean;
  generated_at_ms: number;
  cache_ttl_ms: number;
  rows: LeaderboardRow[];
  network: string;
  package_id: string;
};

const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space/v1/blobs";

function shortAddr(addr: string): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtUsd(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}$${Math.abs(amount).toFixed(amount < 0.01 ? 4 : 2)}`;
}

function timeAgo(ms: number): string {
  if (!ms) return "—";
  const dt = Date.now() - ms;
  if (dt < 60_000) return "just now";
  if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)}h ago`;
  return `${Math.floor(dt / 86_400_000)}d ago`;
}

// Treasury address — the live trader agent's wallet. Used to detect
// rows whose `agent` is "the live demo trader."
const TRADER_AGENT =
  "0xa9f24640b32f33fcfa8582791e84a542251398acfc3b696f382a08a768b6ddbf";

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshAt, setRefreshAt] = useState(0);
  const account = useCurrentAccount();

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch(apiUrl("/api/leaderboard"));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as LeaderboardResponse;
        if (!cancelled) {
          setData(j);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void tick();
    return () => {
      cancelled = true;
    };
  }, [refreshAt]);

  // A row is considered "the live demo trader" when its agent is the
  // canonical Treasury address. The user's *own* row (when they adopt
  // via zkLogin + their own freshly-derived address) will match
  // `account.address` instead.
  const myAddress = account?.address ?? null;
  const ranked = useMemo(() => data?.rows ?? [], [data]);

  // Filter out empty rows — policies with zero trades aren't very
  // exciting and clutter the board. Keep them if they're the live
  // trader's, or the user's, so newcomers can see themselves.
  const visible = useMemo(() => {
    return ranked.filter(
      (r) =>
        r.trade_count > 0 ||
        r.agent.toLowerCase() === TRADER_AGENT ||
        (myAddress && r.owner.toLowerCase() === myAddress.toLowerCase()),
    );
  }, [ranked, myAddress]);

  const yourRowIndex = useMemo(() => {
    if (!myAddress) return -1;
    return visible.findIndex(
      (r) => r.owner.toLowerCase() === myAddress.toLowerCase(),
    );
  }, [visible, myAddress]);

  return (
    <main className="min-h-screen bg-bg text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-5 sm:px-8">
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted hover:text-ink"
          >
            ← Brief
          </Link>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            <Trophy className="h-3 w-3" strokeWidth={1.75} aria-hidden />
            Leaderboard · testnet
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="space-y-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
            Live · Sui testnet · {data?.rows.length ?? "—"} traders adopted
          </p>
          <h1 className="font-sans text-[34px] font-medium leading-[1.05] tracking-tightest text-ink sm:text-[44px]">
            Whose AI trader is winning?
          </h1>
          <p className="max-w-2xl text-[14.5px] leading-relaxed text-ink-2 sm:text-[15.5px]">
            Every row is a real adopted trader on chain. Every trade, every
            policy spend, every realized P&amp;L digest is verifiable on
            Suiscan. Rank by activity, P&amp;L, and multi-asset breadth —
            the trader that uses its leash most carefully climbs.
          </p>
          {yourRowIndex >= 0 && (
            <p className="inline-flex items-center gap-2 border-2 border-emerald-600 bg-emerald-600 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-bg">
              You&apos;re #{yourRowIndex + 1} ·{" "}
              {visible[yourRowIndex]!.name}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/workforce"
              className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.3em] text-bg transition-colors hover:bg-ink-2"
            >
              Adopt a trader →
            </Link>
            <button
              type="button"
              onClick={() => setRefreshAt(Date.now())}
              className="inline-flex items-center gap-1.5 border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted transition-colors hover:border-line-strong hover:text-ink"
              aria-label="Refresh leaderboard"
            >
              <RefreshCw className="h-3 w-3" strokeWidth={1.75} aria-hidden />
              Refresh
            </button>
            {data && (
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                generated {timeAgo(data.generated_at_ms)}
              </span>
            )}
          </div>
        </div>

        <article className="mt-10 border-2 border-ink bg-bg-elev">
          <header className="hidden grid-cols-[40px_minmax(0,1.4fr)_minmax(0,0.8fr)_120px_120px_120px] items-center gap-3 border-b border-line bg-bg-elev-2/40 px-5 py-3 font-mono text-[9.5px] uppercase tracking-[0.28em] text-muted sm:grid">
            <span>#</span>
            <span>Trader</span>
            <span>Markets</span>
            <span className="text-right">Trades</span>
            <span className="text-right">P&amp;L</span>
            <span className="text-right">Owner</span>
          </header>

          {error && (
            <div className="px-5 py-6 font-mono text-[11px] uppercase tracking-[0.22em] text-amber-700">
              Couldn&apos;t reach the chain: {error}
            </div>
          )}
          {!error && data && visible.length === 0 && (
            <div className="px-5 py-10 text-center text-[13px] leading-relaxed text-muted">
              No active traders yet — be the first to adopt one.
            </div>
          )}
          {visible.map((row, i) => {
            const isMine =
              myAddress &&
              row.owner.toLowerCase() === myAddress.toLowerCase();
            const isLiveDemo = row.agent.toLowerCase() === TRADER_AGENT;
            const rank = i + 1;
            const pnlClass =
              row.realized_pnl_usd > 0
                ? "text-emerald-700"
                : row.realized_pnl_usd < 0
                  ? "text-red-700"
                  : "text-ink-2";
            return (
              <Row
                key={row.policy_id}
                rank={rank}
                row={row}
                isMine={!!isMine}
                isLiveDemo={isLiveDemo}
                pnlClass={pnlClass}
              />
            );
          })}
        </article>

        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Sort: live trades → realized P&amp;L → asset breadth. Cached 30 s
          server-side · refresh to re-aggregate.
        </p>
      </section>
    </main>
  );
}

function Row({
  rank,
  row,
  isMine,
  isLiveDemo,
  pnlClass,
}: {
  rank: number;
  row: LeaderboardRow;
  isMine: boolean;
  isLiveDemo: boolean;
  pnlClass: string;
}) {
  const hi =
    rank === 1
      ? "border-emerald-600"
      : isMine
        ? "border-ink"
        : "border-transparent";
  return (
    <div
      className={[
        "grid grid-cols-[40px_minmax(0,1fr)] grid-rows-[auto_auto_auto] gap-x-3 gap-y-1 border-l-2 px-5 py-4 transition-colors hover:bg-bg-elev-2/40 sm:grid-cols-[40px_minmax(0,1.4fr)_minmax(0,0.8fr)_120px_120px_120px] sm:grid-rows-1 sm:items-center sm:py-3",
        hi,
        rank > 1 ? "border-t border-line" : "",
      ].join(" ")}
    >
      <div className="row-span-3 flex items-start justify-center pt-0.5 font-sans text-[20px] font-semibold tabular-nums text-ink sm:row-span-1 sm:pt-0">
        {rank}
      </div>

      <div className="min-w-0 sm:row-span-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-sans text-[15.5px] font-medium tracking-tight text-ink">
            {row.name || "Untitled trader"}
          </p>
          {row.revoked && (
            <span className="inline-flex items-center border border-red-600 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.22em] text-red-700">
              Revoked
            </span>
          )}
          {isMine && (
            <span className="inline-flex items-center bg-ink px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.22em] text-bg">
              You
            </span>
          )}
          {isLiveDemo && !isMine && (
            <span className="inline-flex items-center border border-line px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.22em] text-muted">
              Demo
            </span>
          )}
        </div>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          {row.live_count > 0
            ? `${row.live_count} live · ${row.simulated_count} sim`
            : `${row.simulated_count} simulated`}{" "}
          · {row.journal_entries} memory{" "}
          {row.journal_entries === 1 ? "entry" : "entries"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {row.distinct_assets.length === 0 ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            —
          </span>
        ) : (
          row.distinct_assets.map((a) => (
            <span
              key={a}
              className="inline-flex items-center border border-line px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-ink"
            >
              {a}
            </span>
          ))
        )}
      </div>

      <div className="text-left font-sans text-[15px] font-medium tabular-nums text-ink sm:text-right">
        {row.trade_count}
      </div>

      <div
        className={`text-left font-sans text-[15px] font-medium tabular-nums sm:text-right ${pnlClass}`}
      >
        {fmtUsd(row.realized_pnl_usd)}
      </div>

      <div className="row-start-3 col-start-2 flex flex-wrap items-center gap-2 sm:row-start-1 sm:col-start-6 sm:justify-end">
        <span className="font-mono text-[10.5px] tabular-nums text-muted">
          {shortAddr(row.owner)}
        </span>
        {row.journal_walrus_blob_id && (
          <a
            href={`${WALRUS_AGGREGATOR}/${row.journal_walrus_blob_id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 border border-emerald-600/60 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-emerald-700 transition-colors hover:bg-emerald-600 hover:text-bg"
            aria-label={`Open ${row.name}'s memory journal on Walrus`}
          >
            Memory
            <ArrowUpRight className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}
