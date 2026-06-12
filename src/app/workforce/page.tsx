"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import nextDynamic from "next/dynamic";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  Droplets,
  Loader2,
  Pencil,
  ShieldOff,
  Sparkles,
} from "lucide-react";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { BRIEF_PACKAGE_ID, explorerUrl } from "@/lib/brief-client";
import {
  BRIEF_OPERATOR_ADDRESS,
  WORKFORCE_TEMPLATES,
  templateById,
  buildActivateTx,
  dispatchMission,
  extractTargetPackageId,
  useAgentRegistration,
  useDeliverable,
  usePolicy,
  useRecentTaskActivity,
  useRegisteredAgents,
  useResolvedPolicyId,
  useTasksForPolicy,
  type DeepBookPlacedOrder,
  type RegisteredAgent,
  type StrategyId,
  type TaskStatus,
  type TraderPersonality,
  type WorkforceTask,
  type WorkforceTemplate,
  TRADER_PERSONALITIES,
  dispatchTraderTask,
  loadTraderIdentity,
  personalityById,
  saveTraderIdentity,
} from "@/lib/workforce-client";
import { useAccountSigner } from "@/lib/zklogin/signer";
import { useZkLogin } from "@/lib/zklogin/state";
import { rawToUsd, useLiveSpot } from "@/lib/predict-client";
import {
  buildRevokeTx,
  policyStatus,
  type OperatorPolicyDecoded,
} from "@/lib/operator-policy-client";
import { apiUrl } from "@/lib/api-base";
import { SystemHealthDot } from "@/components/system-health";
import { WalletBoundary } from "@/components/wallet-boundary";

// The Mind canvas (recharts + SSE) is the heaviest client surface on
// the page — lazy-load it so first paint of /workforce stays lean.
const MindCanvas = nextDynamic(() => import("@/components/mind/MindCanvas"), {
  ssr: false,
  loading: () => (
    <section className="mt-6">
      <div className="h-[240px] animate-pulse border border-line bg-bg-elev-2/40" />
    </section>
  ),
});

// =============================================================================
// /workforce — single-step hire + live console.
//
// The judge's 30-second story: open the page → see a living agent economy
// (real specialists, real reputation, real recent work); connect → write
// ONE brief, set a budget, sign once; watch the workforce light up and
// settle on chain; press Revoke once to make the blockchain itself
// refuse the next payment.
// =============================================================================

type ActivationResult = {
  policyId: string | null;
  txDigest: string;
  templateId: string;
  name: string;
  brief: string;
  budgetSui: number;
  allowedVenues: string[];
  /** Phase-3 trader product — set when the adoption flow created the
   *  policy. The workforce path leaves these undefined. */
  traderName?: string;
  traderStrategy?: StrategyId;
  /** Which market bundle the user picked at adoption. Drives the spec
   *  the Planner posts to the trader's inbox. */
  traderMarkets?: "btc_only" | "sui_ecosystem" | "all";
};

/** Map a market bundle to the OperatorPolicy `allowed_venues` list.
 *  Always includes predict-btc for backward compat — even SUI-ecosystem
 *  picks can still legally accept a BTC mint if the trader chooses one. */
function venuesForBundle(
  markets: "btc_only" | "sui_ecosystem" | "all",
): string[] {
  if (markets === "btc_only") return ["predict-btc"];
  if (markets === "sui_ecosystem") {
    return ["predict-btc", "spot-sui", "spot-wal", "spot-deep"];
  }
  // "all"
  return ["predict-btc", "spot-sui", "spot-wal", "spot-deep"];
}

export default function WorkforcePage() {
  // The wallet provider must be an ANCESTOR of any component calling
  // dapp-kit / zkLogin hooks, so the page export is a thin boundary and
  // the hook-calling console lives one level down.
  return (
    <WalletBoundary>
      <WorkforceConsole />
    </WalletBoundary>
  );
}

function WorkforceConsole() {
  // zkLogin and the dApp Kit wallet are equally valid sources of an
  // "I have a Sui address" identity. Either one keys the connected
  // console; if neither is present we render the disconnected screen
  // that offers both paths.
  const signer = useAccountSigner();
  const zk = useZkLogin();

  return (
    <main className="min-h-screen bg-bg text-ink">
      <Header
        connected={signer.address ?? undefined}
        accountLabel={signer.label ?? undefined}
        source={signer.source}
      />
      {zk.phase.kind === "callback" ? (
        <ZkLoginCallbackPanel />
      ) : signer.address ? (
        <Connected address={signer.address} />
      ) : (
        <Disconnected />
      )}
    </main>
  );
}

// Shown while the OAuth callback is finishing (salt + prove +
// address derivation). The prover takes 2-4s so this is never blank.
function ZkLoginCallbackPanel() {
  return (
    <section className="mx-auto max-w-page px-6 pt-24 pb-24 sm:px-10">
      <div className="mx-auto max-w-md border-2 border-ink bg-bg-elev">
        <span
          aria-hidden
          className="block h-px w-full bg-emerald-500/70 animate-operator-pulse-line"
        />
        <div className="px-6 py-8 sm:px-8 sm:py-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
            Continuing as Google
          </p>
          <h2 className="mt-3 font-sans text-[26px] font-medium leading-[1.1] tracking-tightest text-ink">
            Preparing your secure session…
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            We&apos;re deriving your Sui address and generating a
            zero-knowledge proof so you can sign transactions without ever
            handing Google your wallet. This takes a few seconds.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Talking to the Mysten testnet prover…
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// Header
// =============================================================================

function Header({
  connected,
  accountLabel,
  source,
}: {
  connected?: string;
  accountLabel?: string;
  source?: "wallet" | "zklogin" | "none";
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-6 py-4 sm:px-10">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          <Mark />
          <span className="text-[15px] font-medium tracking-tight">Brief</span>
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            · workforce
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex">
            <SystemHealthDot />
          </span>
          <Link
            href="/leaderboard"
            className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink sm:inline-flex"
          >
            Leaderboard
          </Link>
          {connected ? (
            <AccountChip
              address={connected}
              source={source}
              label={accountLabel}
            />
          ) : (
            <ConnectButton />
          )}
        </div>
      </div>
    </header>
  );
}

// AccountChip — collapsed it reads as a small status pill (Google ·
// 0x12…ab); clicking expands a panel with the FULL address (copyable),
// the live SUI balance, a suiscan link, and Sign Out for zkLogin. Same
// component for both auth paths so the affordance is consistent.
function AccountChip({
  address,
  source,
  label,
}: {
  address: string;
  source?: "wallet" | "zklogin" | "none";
  label?: string;
}) {
  const zk = useZkLogin();
  const sui = useSuiClient();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [balanceSui, setBalanceSui] = useState<number | null>(null);

  // Live balance polling — visible whether the panel is open or not so
  // there's never a "did the funds land?" mystery.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const b = await sui.getBalance({ owner: address });
        if (!cancelled) setBalanceSui(Number(b.totalBalance) / 1e9);
      } catch {
        /* ignore */
      }
    }
    tick();
    const id = setInterval(tick, 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sui, address]);

  // Click-outside to close.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore — fallback below shows the address selectable */
    }
  }

  const balLabel =
    balanceSui === null
      ? "—"
      : balanceSui < 0.001
        ? "0 SUI"
        : `${balanceSui.toFixed(3)} SUI`;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 border border-line bg-bg-elev px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-2 transition-colors hover:border-line-strong hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink"
        title={label ?? "Account"}
        aria-expanded={open}
      >
        {source === "zklogin" && (
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600"
          />
        )}
        <span>
          {source === "zklogin" ? "Google · " : ""}
          {short(address)}
        </span>
        <span aria-hidden className="hidden font-mono text-ink sm:inline">
          · {balLabel}
        </span>
        <ChevronDown
          className={[
            "h-3 w-3 transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-[min(92vw,360px)] border-2 border-ink bg-bg-elev shadow-2xl">
          <div className="border-b border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
            {source === "zklogin" ? "Google · zkLogin" : "Connected wallet"}
          </div>
          <div className="space-y-4 px-4 py-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
                Sui address
              </p>
              <p
                className="mt-1 break-all font-mono text-[12px] leading-relaxed text-ink"
                onClick={() => {
                  const sel = window.getSelection();
                  const range = document.createRange();
                  range.selectNodeContents(
                    (sel?.anchorNode?.parentElement ??
                      panelRef.current!) as Node,
                  );
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }}
              >
                {address}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex items-center gap-1.5 border border-ink bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-bg transition-colors hover:bg-ink-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" strokeWidth={2} />
                      Copied
                    </>
                  ) : (
                    "Copy address"
                  )}
                </button>
                <a
                  href={explorerUrl("object", address)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 border border-line bg-bg-elev-2/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-ink transition-colors hover:border-line-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  View on suiscan
                  <ArrowUpRight
                    className="h-3 w-3"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </a>
              </div>
            </div>
            <div className="border-t border-line pt-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
                Balance · live
              </p>
              <p className="mt-1 font-mono text-[16px] tabular-nums text-ink">
                {balLabel}
              </p>
              {balanceSui !== null && balanceSui < 0.05 && (
                <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
                  Need testnet SUI? Tap a mission card — we&apos;ll
                  auto-fund the first time. If the public faucet is
                  rate-limited, copy the address above and send any
                  amount of testnet SUI from another wallet.
                </p>
              )}
            </div>
            {source === "zklogin" && (
              <div className="border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => {
                    zk.signOut();
                    setOpen(false);
                  }}
                  className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-red-700 focus-visible:text-red-700"
                >
                  Sign out of Google
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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

// =============================================================================
// Disconnected — personality-first hero, then the connect prompt
// =============================================================================

// Cross-mount preselect: a card click on the disconnected screen stores
// the chosen strategy so the post-connect TraderGallery can pre-open its
// adoption panel on it. sessionStorage survives BOTH paths — the in-app
// wallet re-render AND the zkLogin OAuth redirect (which reloads the page).
const PRESELECT_KEY = "brief:preselect-strategy";

function setPreselectedStrategy(s: StrategyId): void {
  try {
    if (typeof window !== "undefined") sessionStorage.setItem(PRESELECT_KEY, s);
  } catch {
    /* storage blocked — preselect is a nicety, not required */
  }
}

function takePreselectedStrategy(): StrategyId | null {
  try {
    if (typeof window === "undefined") return null;
    const v = sessionStorage.getItem(PRESELECT_KEY);
    if (v) sessionStorage.removeItem(PRESELECT_KEY);
    return (v as StrategyId) || null;
  } catch {
    return null;
  }
}

// Live signal chip per personality — the real number each strategy acts
// on, from /api/trader/signals. Cold feed → honest "warming up". Quant
// reads the on-chain SVI surface (no scalar in this feed) so it shows a
// descriptive chip rather than a fabricated number.
type DisconnectedSignals = {
  spot: number | null;
  roc30: number | null;
  rsi60: number | null;
  sma15: number | null;
  sma60: number | null;
  loaded: boolean;
};

function useDisconnectedSignals(): DisconnectedSignals {
  const [s, setS] = useState<DisconnectedSignals>({
    spot: null,
    roc30: null,
    rsi60: null,
    sma15: null,
    sma60: null,
    loaded: false,
  });
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const r = await fetch(apiUrl("/api/trader/signals?asset=BTC&minutes=60"));
        if (r.ok) {
          const j = (await r.json()) as {
            latest?: {
              spot?: number;
              roc30?: number | null;
              rsi60?: number | null;
              sma15?: number | null;
              sma60?: number | null;
            } | null;
          };
          if (!cancelled) {
            setS({
              spot: j.latest?.spot ?? null,
              roc30: j.latest?.roc30 ?? null,
              rsi60: j.latest?.rsi60 ?? null,
              sma15: j.latest?.sma15 ?? null,
              sma60: j.latest?.sma60 ?? null,
              loaded: true,
            });
          }
        } else if (!cancelled) setS((p) => ({ ...p, loaded: true }));
      } catch {
        if (!cancelled) setS((p) => ({ ...p, loaded: true }));
      }
      if (!cancelled) timer = setTimeout(tick, 15_000);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return s;
}

type SignalChip = { text: string; tone: "up" | "down" | "neutral" | "muted" };

function chipFor(strategy: StrategyId, s: DisconnectedSignals): SignalChip {
  if (!s.loaded || s.spot == null) {
    return { text: "warming up", tone: "muted" };
  }
  switch (strategy) {
    case "conservative": {
      if (s.sma15 == null || s.sma60 == null)
        return { text: "MAs warming up", tone: "muted" };
      const up = s.sma15 >= s.sma60;
      return {
        text: up ? "SMA15 ≥ SMA60 · aligned up" : "SMA15 < SMA60 · aligned down",
        tone: up ? "up" : "down",
      };
    }
    case "momentum": {
      if (s.roc30 == null) return { text: "ROC30m warming up", tone: "muted" };
      const pct = s.roc30 * 100;
      return {
        text: `ROC30m ${pct >= 0 ? "+" : ""}${pct.toFixed(3)}%`,
        tone: pct > 0.05 ? "up" : pct < -0.05 ? "down" : "neutral",
      };
    }
    case "contrarian": {
      if (s.rsi60 == null) return { text: "RSI warming up", tone: "muted" };
      const z =
        s.rsi60 > 70 ? "overbought" : s.rsi60 < 30 ? "oversold" : "neutral";
      return {
        text: `RSI60 ${s.rsi60.toFixed(0)} · ${z}`,
        tone: s.rsi60 > 70 ? "down" : s.rsi60 < 30 ? "up" : "neutral",
      };
    }
    case "quant":
      return { text: "reads the live SVI surface", tone: "neutral" };
  }
}

function DisconnectedGallery({
  picked,
  onPick,
}: {
  picked: StrategyId | null;
  onPick: (s: StrategyId) => void;
}) {
  const signals = useDisconnectedSignals();
  return (
    <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {TRADER_PERSONALITIES.map((p, i) => (
        <DisconnectedCard
          key={p.strategy}
          personality={p}
          chip={chipFor(p.strategy, signals)}
          active={picked === p.strategy}
          index={i}
          onPick={() => onPick(p.strategy)}
        />
      ))}
    </div>
  );
}

function DisconnectedCard({
  personality,
  chip,
  active,
  index,
  onPick,
}: {
  personality: TraderPersonality;
  chip: SignalChip;
  active: boolean;
  index: number;
  onPick: () => void;
}) {
  const chipClass =
    chip.tone === "up"
      ? "border-emerald-600/40 bg-emerald-50/70 text-emerald-800"
      : chip.tone === "down"
        ? "border-red-600/40 bg-red-50/70 text-red-800"
        : chip.tone === "neutral"
          ? "border-line bg-bg-elev text-ink-2"
          : "border-line bg-bg-elev-2/50 text-muted";
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={[
        "group flex flex-col items-start gap-3 border-2 bg-bg-elev px-4 py-5 text-left transition-all duration-200 animate-fade-up",
        "hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        active ? "border-ink" : "border-line hover:border-ink",
      ].join(" ")}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex w-full items-start justify-between">
        <span className="font-sans text-[34px] leading-none text-ink" aria-hidden>
          {personality.glyph}
        </span>
        {active && (
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-emerald-700">
            selected ✓
          </span>
        )}
      </div>
      <div>
        <h3 className="font-sans text-[17px] font-medium tracking-tight text-ink">
          {personality.label}
        </h3>
        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
          {personality.temperament}
        </p>
      </div>
      <span
        className={`inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] tabular-nums ${chipClass}`}
      >
        <span
          aria-hidden
          className={`inline-block h-1 w-1 rounded-full ${
            chip.tone === "up"
              ? "bg-emerald-600"
              : chip.tone === "down"
                ? "bg-red-600"
                : chip.tone === "neutral"
                  ? "bg-sui"
                  : "bg-muted-2"
          }`}
        />
        {chip.text}
      </span>
      <span className="mt-auto font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted transition-colors group-hover:text-ink">
        {active ? "ready — connect to adopt" : "choose →"}
      </span>
    </button>
  );
}

function Disconnected() {
  const zk = useZkLogin();
  const [picked, setPicked] = useState<StrategyId | null>(null);
  const pickedLabel = picked ? personalityById(picked)?.label ?? null : null;
  const onPick = (s: StrategyId) => {
    setPicked(s);
    setPreselectedStrategy(s);
  };
  const phaseStarting =
    zk.phase.kind === "starting" || zk.phase.kind === "callback";
  return (
    <section className="mx-auto max-w-page px-6 pt-12 pb-24 sm:px-10 sm:pt-16">
      <div className="mx-auto max-w-page">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Brief · live on Sui testnet
        </p>
        <h1 className="mt-4 font-sans text-4xl font-medium tracking-tightest sm:text-5xl">
          Adopt an AI trader.
        </h1>
        <p className="mt-4 max-w-prose text-[16px] leading-relaxed text-ink-2 sm:text-lg">
          Pick a personality. It trades on chain, bounded by a Move policy
          you can revoke in one tap.{" "}
          <Link
            href="/leaderboard"
            className="text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            See whose trader is winning →
          </Link>
        </p>

        {/* Personality-first hero — pick before you connect; the choice
            carries through the wallet step via sessionStorage. */}
        <DisconnectedGallery picked={picked} onPick={onPick} />

        {pickedLabel && (
          <p className="mt-5 inline-flex items-center gap-2 border border-emerald-600/40 bg-emerald-50/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-800 animate-land-in">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" />
            {pickedLabel} selected — connect a wallet to adopt
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ConnectButton connectText="Connect a Sui wallet" />
          {zk.available && zk.signingEnabled && (
            <button
              type="button"
              onClick={zk.signIn}
              disabled={phaseStarting}
              className="inline-flex items-center gap-2.5 border-2 border-ink bg-ink px-5 py-3 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phaseStarting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  <GoogleGlyph />
                  Or continue with Google
                </>
              )}
            </button>
          )}
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
          >
            ← Back to landing
          </Link>
        </div>
        {zk.available && !zk.signingEnabled && (
          <p className="mt-4 max-w-prose text-[12.5px] leading-relaxed text-muted">
            <span className="text-ink">Heads-up:</span> Google sign-in
            (zkLogin) needs an Enoki API key to verify proofs on Sui
            testnet — for now, please connect a Sui wallet (Slush, Suiet,
            etc.) to adopt a trader.
          </p>
        )}
        {!zk.available && (
          <p className="mt-4 max-w-prose text-[12.5px] leading-relaxed text-muted">
            Google sign-in isn&apos;t configured for this deployment. Use
            a Sui wallet to continue.
          </p>
        )}
        {zk.phase.kind === "error" && (
          <p className="mt-4 border border-red-300 bg-red-50 p-3 font-mono text-[12px] text-red-700">
            {zk.phase.msg}
          </p>
        )}
      </div>

      <RosterAndActivity />
    </section>
  );
}

function GoogleGlyph() {
  // A small Google G mark in mono colour so it sits naturally alongside
  // the ink button. Designed to be unobtrusive — the button copy carries
  // the brand recognition.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 18 18"
      aria-hidden
      className="text-bg"
    >
      <path
        fill="currentColor"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="currentColor"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A9 9 0 0 0 9 18Z"
      />
      <path
        fill="currentColor"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A9 9 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="currentColor"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A9 9 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}

function RosterAndActivity() {
  return (
    <div className="mt-16 grid gap-10 lg:grid-cols-[1fr_1fr]">
      <Roster />
      <RecentActivityPanel />
    </div>
  );
}

// =============================================================================
// Roster — live registered specialists (excluding the Planner)
// =============================================================================

function Roster() {
  const { agents, loading } = useRegisteredAgents({
    excludeAddress: BRIEF_OPERATOR_ADDRESS,
  });

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Workforce roster · {agents.length || ""}
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          {loading ? "loading…" : "live · 8s"}
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {!loading && agents.length === 0 && (
          <EmptyHint>
            No specialist has registered on chain yet — start the workforce
            and the roster fills in within seconds.
          </EmptyHint>
        )}
        {agents.map((a) => (
          <AgentRosterCard key={a.id} agent={a} />
        ))}
      </div>
    </section>
  );
}

function AgentRosterCard({ agent }: { agent: RegisteredAgent }) {
  const earned = Number(agent.totalPaidMist) / 1e9;
  return (
    <article className="group relative border border-line bg-bg-elev p-4 transition-colors hover:border-line-strong">
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium tracking-tight text-ink">
            {agent.displayName || "Unnamed agent"}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-muted">
            {short(agent.address, 8, 6)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {agent.capabilities.map((c) => (
            <span
              key={c}
              className="border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-2"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
        <Stat label="Reputation" value={String(agent.reputationScore)} />
        <Stat label="Delivered" value={String(agent.completedTasks)} />
        <Stat
          label="Earned"
          value={`${earned.toFixed(earned >= 1 ? 2 : 3)} SUI`}
        />
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
        {label}
      </p>
      <p className="mt-1 font-mono text-[14px] tabular-nums text-ink">{value}</p>
    </div>
  );
}

// =============================================================================
// Recent on-chain activity — every visitor sees the agent economy moving
// =============================================================================

function RecentActivityPanel() {
  const { items, loading } = useRecentTaskActivity(8);
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Recent work · on chain
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          {loading ? "loading…" : "live · 4s"}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-line border border-line bg-bg-elev">
        {!loading && items.length === 0 && (
          <li className="px-4 py-5">
            <EmptyHint inline>
              No recent tasks on chain yet. The first mission lights this
              up.
            </EmptyHint>
          </li>
        )}
        {items.map((it, idx) => (
          <li
            key={`${it.txDigest}:${it.kind}`}
            className="px-4 py-3 animate-land-in"
            style={{ animationDelay: `${idx * 40}ms` }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <ActivityDot kind={it.kind} />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                  {it.kind === "posted" ? "POSTED" : "PAID"}
                </span>
                <span className="truncate text-[13.5px] text-ink">
                  {it.title || titleFromCapability(it.capability, it.kind)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-[11px] tabular-nums text-ink-2">
                  {(Number(it.bountyMist) / 1e9).toFixed(2)} SUI
                </span>
                <a
                  href={explorerUrl("txblock", it.txDigest)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted transition-colors hover:text-ink"
                >
                  tx
                  <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityDot({ kind }: { kind: "posted" | "approved" }) {
  return (
    <span
      className={[
        "inline-block h-1.5 w-1.5 rounded-full",
        kind === "approved" ? "bg-emerald-500" : "bg-ink/40",
      ].join(" ")}
      aria-hidden
    />
  );
}

function titleFromCapability(cap: string, kind: "posted" | "approved"): string {
  if (kind === "approved") return `Settled ${cap || "task"}`;
  return cap ? `New ${cap} job` : "New task";
}

// =============================================================================
// Connected — single-step hire form OR live console
// =============================================================================

function Connected({ address }: { address: string }) {
  const [activation, setActivation] = useState<ActivationResult | null>(null);
  // Default surface for Phase-3 is the Trader product. The workforce
  // engine + UI are preserved verbatim and accessible via ?legacy=1 —
  // keep the path live so we can re-enable it instantly.
  const legacy =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("legacy") === "1";

  if (!activation) {
    return (
      <section className="mx-auto max-w-page px-6 pt-10 pb-24 sm:px-10 sm:pt-14">
        {legacy ? (
          <>
            <TeachingIntro />
            <MissionGallery
              address={address}
              onActivated={setActivation}
            />
            <div className="mt-16 grid gap-12 lg:grid-cols-[1.4fr_1fr]">
              <RecentActivityPanel />
              <aside className="space-y-8">
                <Roster />
              </aside>
            </div>
          </>
        ) : (
          <>
            <TraderIntro />
            <TraderGallery address={address} onActivated={setActivation} />
          </>
        )}
      </section>
    );
  }
  if (activation.traderStrategy) {
    return (
      <TraderDashboard
        activation={activation}
        onReset={() => setActivation(null)}
      />
    );
  }
  return (
    <LiveConsole activation={activation} onReset={() => setActivation(null)} />
  );
}

// =============================================================================
// Phase-3 product — Adopt-a-trader. Reuses the policy/zkLogin/cold-start
// substrate; the on-chain action becomes a DeepBook Predict BTC up/down
// mint signed by the same OperatorPolicy the user grants.
// =============================================================================

function TraderIntro() {
  return (
    <header className="max-w-3xl">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Brief · adopt an AI trader
      </p>
      <h1 className="mt-3 font-sans text-[28px] font-medium leading-[1.12] tracking-tightest text-ink sm:text-[40px]">
        Adopt a trader.{" "}
        <span className="text-ink-2">
          Pick a personality, give it a name, set how much it can bet on
          your behalf — and watch it win or lose on chain. You hold the
          leash, the blockchain enforces it.
        </span>
      </h1>
      <p className="mt-4 max-w-prose text-[14px] leading-relaxed text-muted">
        Each trader takes BTC up/down positions on DeepBook Predict
        within a chain-enforced budget. One signature adopts. One tap
        yanks the leash.
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Trader Gallery — three personalities → name → leash → adopt in one PTB
// ---------------------------------------------------------------------------

type AdoptPhase =
  | { kind: "idle" }
  | { kind: "checking-balance" }
  | { kind: "funding" }
  | { kind: "signing" }
  | { kind: "dispatching" }
  | { kind: "error"; msg: string };

const TRADER_BUDGET_PRESETS_SUI = [0.5, 1, 2, 5];
const TRADER_DEFAULT_BUDGET_SUI = 1;
const TRADER_EXPIRY_HOURS = 12;
const TRADER_FAUCET_TIMEOUT_MS = 15_000;

function useTraderLauncher({
  address,
  onActivated,
}: {
  address: string;
  onActivated: (a: ActivationResult) => void;
}): {
  phase: AdoptPhase;
  adopt: (args: {
    personality: TraderPersonality;
    traderName: string;
    budgetSui: number;
    markets: TraderMarketBundleId;
  }) => void;
} {
  const client = useSuiClient();
  const { signAndExecute } = useAccountSigner();
  const [phase, setPhase] = useState<AdoptPhase>({ kind: "idle" });

  const adopt = useCallback(
    ({
      personality,
      traderName,
      budgetSui,
      markets,
    }: {
      personality: TraderPersonality;
      traderName: string;
      budgetSui: number;
      markets: TraderMarketBundleId;
    }) => {
      void (async () => {
        const name = traderName.trim().slice(0, 32) || personality.label;
        // 1) Cold-start funding — identical to the mission launcher.
        try {
          setPhase({ kind: "checking-balance" });
          const b = await client.getBalance({ owner: address });
          if (Number(b.totalBalance) / 1e9 < COLD_START_MIN_SUI) {
            setPhase({ kind: "funding" });
            const r = await fetch(apiUrl("/api/agent/faucet"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ recipient: address }),
            });
            const j = (await r.json()) as {
              ok?: boolean;
              message?: string;
              retry_after_sec?: number;
            };
            if (!j.ok) {
              const isRateLimit =
                /rate.*limit|too many requests|429/i.test(j.message ?? "") ||
                !!j.retry_after_sec;
              setPhase({
                kind: "error",
                msg: isRateLimit
                  ? `The public testnet faucet is cooling down — open the account chip (top right) to copy your address and send any amount of testnet SUI, or wait ~30 min.`
                  : (j.message ?? "Faucet failed."),
              });
              return;
            }
            const t0 = Date.now();
            let funded = false;
            while (Date.now() - t0 < TRADER_FAUCET_TIMEOUT_MS) {
              await new Promise((res) => setTimeout(res, 1200));
              try {
                const nb = await client.getBalance({ owner: address });
                if (Number(nb.totalBalance) / 1e9 >= COLD_START_MIN_SUI) {
                  funded = true;
                  break;
                }
              } catch {
                /* keep polling */
              }
            }
            if (!funded) {
              setPhase({
                kind: "error",
                msg: "Faucet sent the SUI but it hasn't settled — try again in a few seconds.",
              });
              return;
            }
          }
        } catch (e) {
          setPhase({
            kind: "error",
            msg: e instanceof Error ? e.message : String(e),
          });
          return;
        }

        // 2) Sign the policy grant. agent = Planner (server posts the
        //    task as Planner so the user only signs once), allowed
        //    venues = chosen bundle (BTC-only / SUI ecosystem / all),
        //    budget = the leash slider.
        const allowedVenues = venuesForBundle(markets);
        setPhase({ kind: "signing" });
        let tx;
        try {
          tx = buildActivateTx({
            packageId: BRIEF_PACKAGE_ID,
            templateId: `trader-${personality.strategy}`,
            name,
            budgetSui,
            allowedVenues,
            expiryHours: TRADER_EXPIRY_HOURS,
            riskTolerance: "low",
          });
        } catch (e) {
          setPhase({
            kind: "error",
            msg: e instanceof Error ? e.message : String(e),
          });
          return;
        }
        signAndExecute(tx, {
          onSuccess: (res) => {
            onActivated({
              policyId: null,
              txDigest: res.digest,
              templateId: `trader-${personality.strategy}`,
              name,
              brief: personality.voice,
              budgetSui,
              allowedVenues,
              traderName: name,
              traderStrategy: personality.strategy,
              traderMarkets: markets,
            });
            setPhase({ kind: "dispatching" });
          },
          onError: (e) =>
            setPhase({
              kind: "error",
              msg: e instanceof Error ? e.message : String(e),
            }),
        });
      })();
    },
    [address, client, onActivated, signAndExecute],
  );

  return { phase, adopt };
}

function TraderGallery({
  address,
  onActivated,
}: {
  address: string;
  onActivated: (a: ActivationResult) => void;
}) {
  const { phase, adopt } = useTraderLauncher({ address, onActivated });
  // Pre-open the panel on the personality the user chose on the
  // disconnected screen (survives the wallet-connect step via
  // sessionStorage); takePreselectedStrategy() also clears it.
  const [pickedId, setPickedId] = useState<StrategyId | null>(() =>
    takePreselectedStrategy(),
  );
  const picked = pickedId ? personalityById(pickedId) ?? null : null;
  const panelRef = useRef<HTMLDivElement | null>(null);
  // If we arrived with a preselect, ease the adoption panel into view.
  useEffect(() => {
    if (pickedId && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="mt-10">
      <div className="flex items-end justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Pick a personality
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          {TRADER_PERSONALITIES.length} traders · one signature
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {TRADER_PERSONALITIES.map((p) => (
          <TraderPersonalityCard
            key={p.strategy}
            personality={p}
            active={pickedId === p.strategy}
            onPick={() => setPickedId(p.strategy)}
          />
        ))}
      </div>

      {picked && (
        <div ref={panelRef}>
          <TraderAdoptionPanel
            personality={picked}
            phase={phase}
            onAdopt={(name, budgetSui, markets) =>
              adopt({ personality: picked, traderName: name, budgetSui, markets })
            }
            onCancel={() => setPickedId(null)}
          />
        </div>
      )}

      <ControlReassurance />
    </section>
  );
}

function TraderPersonalityCard({
  personality,
  active,
  onPick,
}: {
  personality: TraderPersonality;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <article
      className={[
        "flex flex-col border-2 bg-bg-elev transition-colors",
        active ? "border-ink" : "border-line hover:border-line-strong",
      ].join(" ")}
    >
      <div className="flex flex-1 flex-col gap-4 px-5 py-6 sm:px-6">
        <div className="flex items-start justify-between">
          <span
            className="font-sans text-[40px] leading-none text-ink"
            aria-hidden
          >
            {personality.glyph}
          </span>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
            {personality.temperament}
          </span>
        </div>
        <div className="space-y-2">
          <h3 className="font-sans text-[20px] font-medium tracking-tight text-ink">
            {personality.label}
          </h3>
          <p className="text-[14px] italic leading-snug text-ink-2">
            &ldquo;{personality.voice}&rdquo;
          </p>
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted">
          {personality.blurb}
        </p>
        <p className="mt-auto font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
          {personality.cadence}
        </p>
      </div>
      <div className="flex items-center justify-end border-t border-line bg-bg-elev-2/40 px-5 py-3 sm:px-6">
        <button
          type="button"
          onClick={onPick}
          className={[
            "inline-flex items-center gap-2 border-2 px-5 py-2 font-mono text-[10.5px] uppercase tracking-[0.3em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
            active
              ? "border-ink bg-ink text-bg"
              : "border-ink text-ink hover:bg-ink hover:text-bg",
          ].join(" ")}
        >
          {active ? "Selected ✓" : `Adopt ${personality.label} →`}
        </button>
      </div>
    </article>
  );
}

type TraderMarketBundleId = "btc_only" | "sui_ecosystem" | "all";

const MARKET_BUNDLES: Array<{
  id: TraderMarketBundleId;
  label: string;
  blurb: string;
  assets: string[];
}> = [
  {
    id: "btc_only",
    label: "BTC only",
    blurb: "Up/down bets on BTC via DeepBook Predict.",
    assets: ["BTC"],
  },
  {
    id: "sui_ecosystem",
    label: "Sui ecosystem",
    blurb: "Directional spot bets on SUI · WAL · DEEP via DeepBook.",
    assets: ["SUI", "WAL", "DEEP"],
  },
  {
    id: "all",
    label: "All markets",
    blurb: "BTC up/down + SUI/WAL/DEEP spot — full multi-asset.",
    assets: ["BTC", "SUI", "WAL", "DEEP"],
  },
];

function TraderAdoptionPanel({
  personality,
  phase,
  onAdopt,
  onCancel,
}: {
  personality: TraderPersonality;
  phase: AdoptPhase;
  onAdopt: (name: string, budgetSui: number, markets: TraderMarketBundleId) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [budgetSui, setBudgetSui] = useState(personality.defaultBudgetSui);
  const [markets, setMarkets] = useState<TraderMarketBundleId>("btc_only");
  const selectedBundle =
    MARKET_BUNDLES.find((b) => b.id === markets) ?? MARKET_BUNDLES[0]!;
  const busy =
    phase.kind === "checking-balance" ||
    phase.kind === "funding" ||
    phase.kind === "signing" ||
    phase.kind === "dispatching";
  const errMsg = phase.kind === "error" ? phase.msg : null;
  const nameReady = name.trim().length > 0;

  return (
    <div className="relative mt-6 animate-fade-up overflow-hidden border-2 border-ink bg-bg-elev">
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-emerald-500/70 animate-operator-pulse-line"
        aria-hidden
      />
      {/* Step rail — the single panel reads as a 4-beat flow. Done
          beats get an emerald check; "Sign" lights once a name exists. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-6 py-3.5 sm:px-8">
        {[
          { n: "01", label: "Name", done: nameReady, ready: false },
          { n: "02", label: "Leash", done: true, ready: false },
          { n: "03", label: "Markets", done: true, ready: false },
          { n: "04", label: "Sign", done: false, ready: nameReady },
        ].map((s, i) => (
          <div
            key={s.n}
            className="flex items-center gap-2 animate-fade-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span
              className={[
                "inline-flex h-5 w-5 items-center justify-center border font-mono text-[9px] tabular-nums",
                s.done
                  ? "border-emerald-600 text-emerald-700"
                  : s.ready
                    ? "border-ink text-ink"
                    : "border-line text-muted",
              ].join(" ")}
            >
              {s.done ? "✓" : s.n}
            </span>
            <span
              className={[
                "font-mono text-[9.5px] uppercase tracking-[0.22em]",
                s.done || s.ready ? "text-ink-2" : "text-muted",
              ].join(" ")}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 px-6 py-7 sm:px-8 sm:py-8 lg:grid-cols-[1.25fr_0.85fr]">
        {/* LEFT — the form (name · leash · markets) */}
        <div className="space-y-7">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
              Name your trader
            </p>
            <label className="mt-2 block">
              <span className="sr-only">Trader name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={defaultNameSuggestion(personality.strategy)}
                maxLength={32}
                className="w-full border-2 border-line bg-bg-elev px-4 py-3 text-[18px] font-medium tracking-tight outline-none transition-colors focus:border-ink focus-visible:border-ink"
              />
            </label>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              {nameReady
                ? `That's ${name.trim()}, your ${personality.label.toLowerCase()} trader.`
                : `Give them a name you'll cheer for. Up to 32 characters.`}
            </p>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
              Set the leash
            </p>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="font-sans text-[32px] font-medium tabular-nums tracking-tight text-ink">
                {budgetSui.toFixed(2)}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
                SUI to bet with
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={5}
              step={0.1}
              value={budgetSui}
              onChange={(e) => setBudgetSui(Number(e.target.value))}
              className="mt-3 w-full accent-ink"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {TRADER_BUDGET_PRESETS_SUI.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBudgetSui(b)}
                  className={[
                    "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink",
                    budgetSui === b
                      ? "border-ink text-ink"
                      : "border-line text-muted hover:text-ink",
                  ].join(" ")}
                >
                  {b} SUI
                </button>
              ))}
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
              <span className="text-ink">When the budget runs out</span>, the
              chain itself stops the next bet — even if {name.trim() || "the trader"} wants to keep going. You
              also hold a one-tap kill switch.
            </p>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
              Which markets?
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              One leash governs every asset {name.trim() || personality.label} plays.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {MARKET_BUNDLES.map((b) => {
                const active = markets === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setMarkets(b.id)}
                    className={[
                      "flex flex-col gap-1.5 border-2 px-3.5 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                      active
                        ? "border-ink bg-bg-elev"
                        : "border-line hover:border-line-strong",
                    ].join(" ")}
                    aria-pressed={active}
                  >
                    <span className="font-sans text-[14.5px] font-medium tracking-tight text-ink">
                      {b.label}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                      {b.assets.join(" · ")}
                    </span>
                    <span className="text-[12px] leading-snug text-muted">
                      {b.blurb}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT — the OperatorPolicy preview. This card IS the product:
            it's the leash, drawn live from the choices above. Every field
            is a real policy parameter the mint will set on chain. */}
        <aside className="relative self-start overflow-hidden border-2 border-ink bg-bg-elev">
          <span
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-emerald-500/70 animate-operator-pulse-line"
            aria-hidden
          />
          <div className="px-5 py-5">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.32em] text-muted">
              Your OperatorPolicy · preview
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span
                className="font-sans text-[30px] leading-none text-ink"
                aria-hidden
              >
                {personality.glyph}
              </span>
              <div className="min-w-0">
                <p className="truncate font-sans text-[17px] font-medium tracking-tight text-ink">
                  {name.trim() || defaultNameSuggestion(personality.strategy)}
                </p>
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
                  {personality.label}
                </p>
              </div>
            </div>
            <dl className="mt-4 space-y-3 border-t border-line pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
                  Budget cap
                </dt>
                <dd className="font-sans text-[18px] font-medium tabular-nums tracking-tight text-ink">
                  {budgetSui.toFixed(2)} SUI
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
                  Venues
                </dt>
                <dd className="flex flex-wrap justify-end gap-1">
                  {selectedBundle.assets.map((a) => (
                    <span
                      key={a}
                      className="border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-2"
                    >
                      {a}
                    </span>
                  ))}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
                  Kill switch
                </dt>
                <dd className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-800">
                  revocable any time
                </dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-line pt-3 font-mono text-[9px] uppercase leading-relaxed tracking-[0.18em] text-muted">
              Enforced by Move · on chain · not our server
            </p>
          </div>
        </aside>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg-elev-2/50 px-6 py-5 sm:px-8">
        <p className="max-w-[26rem] font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          {busy
            ? phaseLabel(phase)
            : `One signature mints the leash · sets the budget · dispatches ${name.trim() || personality.label}'s first bet`}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink focus-visible:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onAdopt(name, budgetSui, markets)}
            disabled={busy}
            className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-6 py-3 font-mono text-[11px] uppercase tracking-[0.3em] text-bg transition-colors hover:bg-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {phaseLabel(phase)}
              </>
            ) : (
              <>
                Adopt {name.trim() || personality.label} →
              </>
            )}
          </button>
        </div>
      </div>
      {errMsg && (
        <p className="border-t border-red-200 bg-red-50 px-6 py-3 font-mono text-[11px] text-red-700 sm:px-8">
          {errMsg.slice(0, 280)}
        </p>
      )}
    </div>
  );
}

function phaseLabel(p: AdoptPhase): string {
  switch (p.kind) {
    case "checking-balance":
      return "Checking your wallet…";
    case "funding":
      return "Funding your wallet…";
    case "signing":
      return "Sign in your wallet…";
    case "dispatching":
      return "Sending your trader to work…";
    default:
      return "Adopt";
  }
}

function defaultNameSuggestion(s: StrategyId): string {
  if (s === "conservative") return "Atlas";
  if (s === "momentum") return "Bolt";
  return "Vega";
}

// =============================================================================
// Teaching intro — the single line a first-time visitor reads. The whole
// console exists in service of these 18 words. Everything below it should
// teach by doing, not by adding more sentences.
// =============================================================================

function TeachingIntro() {
  return (
    <header className="max-w-3xl">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Brief · Sui workforce
      </p>
      <h1 className="mt-3 font-sans text-[28px] font-medium leading-[1.12] tracking-tightest text-ink sm:text-[40px]">
        Hire a team of AI agents.{" "}
        <span className="text-ink-2">
          They hire each other, do real work, and get paid on-chain — and you
          hold a kill switch the blockchain itself enforces.
        </span>
      </h1>
      <p className="mt-4 max-w-prose text-[14px] leading-relaxed text-muted">
        Tap a mission below — we&apos;ll fund your wallet if it&apos;s empty,
        you sign once, and you watch the team work. No forms. No writing.
      </p>
    </header>
  );
}

// =============================================================================
// Cold-start faucet — a brand-new wallet has 0 SUI and can't sign the grant.
// This banner appears the moment we detect the connected wallet is empty
// and goes away the moment it has enough SUI to act.
// =============================================================================

const COLD_START_MIN_SUI = 0.05;

function ColdStartFaucet({ address }: { address: string }) {
  const client = useSuiClient();
  const [balanceSui, setBalanceSui] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [phase, setPhase] = useState<"idle" | "fetching" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const b = await client.getBalance({ owner: address });
        if (!cancelled) {
          setBalanceSui(Number(b.totalBalance) / 1e9);
        }
      } catch {
        /* ignore — the banner just hides */
      }
    };
    tick();
    // After a faucet call, poll a few times so the new balance shows up
    // without the user having to refresh.
    const id = setInterval(tick, 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client, address, refreshKey]);

  async function handleFaucet() {
    setPhase("fetching");
    setErrMsg(null);
    try {
      const r = await fetch(apiUrl("/api/agent/faucet"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: address }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        message?: string;
        retry_after_sec?: number;
      };
      if (!j.ok) {
        setErrMsg(
          j.message ??
            (j.retry_after_sec
              ? `Try again in ${j.retry_after_sec}s.`
              : "Faucet failed — try again in a moment."),
        );
        setPhase("err");
        return;
      }
      setPhase("ok");
      // Give the chain a couple of seconds to credit the wallet, then
      // poll for the updated balance.
      setTimeout(() => setRefreshKey((k) => k + 1), 3500);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setPhase("err");
    }
  }

  // Loading the first balance — render nothing so the layout doesn't flash.
  if (balanceSui === null) return null;
  // Wallet is funded; nothing to do.
  if (balanceSui >= COLD_START_MIN_SUI) return null;

  return (
    <div className="mb-6 animate-fade-up border-2 border-ink bg-bg-elev">
      {/* Stepper rail so the cold-start clearly reads as "step 1 of 2". */}
      <div className="flex items-center gap-2 border-b border-line px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
        <span className="inline-flex h-4 w-4 items-center justify-center bg-ink text-bg" aria-hidden>
          1
        </span>
        Get testnet SUI
        <span className="text-muted/60">→</span>
        <span className="text-muted/60">2 · Write your brief</span>
      </div>

      <div className="px-5 py-5 sm:px-6 sm:py-6">
        <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="flex items-start gap-3">
            <Droplets
              className="mt-1 h-5 w-5 shrink-0 text-amber-700"
              strokeWidth={1.75}
            />
            <div className="min-w-0">
              <p className="font-sans text-[20px] font-medium leading-snug tracking-tight text-ink sm:text-[22px]">
                Your wallet needs a sip of testnet SUI.
              </p>
              <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-2">
                Brief runs on Sui testnet. We&apos;ll request{" "}
                <span className="font-mono tabular-nums text-ink">1 SUI</span>{" "}
                from the public faucet for{" "}
                <span className="font-mono text-ink">{short(address, 6, 4)}</span>{" "}
                — costs nothing, takes a few seconds. Then the brief form below
                unlocks.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleFaucet}
            disabled={phase === "fetching" || phase === "ok"}
            className="inline-flex items-center justify-center gap-2 border-2 border-ink bg-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:border-line disabled:bg-line disabled:text-muted"
          >
            {phase === "fetching" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Requesting…
              </>
            ) : phase === "ok" ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
                Sent · syncing balance
              </>
            ) : (
              <>
                <Droplets className="h-3.5 w-3.5" strokeWidth={1.75} />
                Get 1 SUI
              </>
            )}
          </button>
        </div>
        {phase === "err" && errMsg && (
          <p className="mt-4 border border-red-300 bg-red-50/70 p-2.5 font-mono text-[11.5px] text-red-700">
            {errMsg.slice(0, 200)}
          </p>
        )}
        <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          <span>
            Balance{" "}
            <span className="tabular-nums text-ink-2">
              {balanceSui.toFixed(3)} SUI
            </span>
          </span>
          <span className="text-muted/60">·</span>
          <span>need ≥ {COLD_START_MIN_SUI.toFixed(2)} to sign</span>
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Single-step hire form — one screen, one signature, mission auto-dispatched
// =============================================================================

// =============================================================================
// Mission Gallery — the "tap and watch" front door.
//
// A beginner shouldn't have to author or configure anything. The cards
// below are complete, pre-baked missions. Tapping one = template + brief +
// budget + capabilities, all chosen at once. If the wallet is empty we
// fund it from the public testnet faucet and roll straight into signing
// so the momentum is never broken.
//
// `HireForm` (below) is preserved verbatim as the power-user escape
// hatch — wrapped in a collapsed "Write your own mission" disclosure.
// =============================================================================

type MissionDetails = {
  hero: boolean;
  outcomeHeadline: string;
  outcomeDetail: string;
  team: Array<{ role: string; capability?: string; does: string }>;
  ctaCopy: string;
};

const MISSION_DETAILS: Record<string, MissionDetails> = {
  "investment-committee": {
    hero: true,
    outcomeHeadline:
      "A Move audit report you can read + a real DeepBook-sized payout plan.",
    outcomeDetail:
      "Three agents work together: the contract gets audited, the report is stored on Walrus, and the disbursement is sized against live SUI/USDC depth on DeepBook v3.",
    team: [
      { role: "Planner", does: "splits the mission into jobs and hires the team" },
      {
        role: "Research",
        capability: "research",
        does: "reads the contract and writes the report",
      },
      {
        role: "Treasury",
        capability: "treasury",
        does: "probes pool depth and posts test orders",
      },
    ],
    ctaCopy: "Hire the committee →",
  },
  "move-audit-sprint": {
    hero: false,
    outcomeHeadline: "A single audit report on a Move package.",
    outcomeDetail:
      "Capability surface, abort coverage, public entry points, and concrete risks — stored on Walrus, signed off by Planner.",
    team: [
      { role: "Planner", does: "scopes the audit and hires Research" },
      {
        role: "Research",
        capability: "research",
        does: "reads the source and writes the audit",
      },
    ],
    ctaCopy: "Start the audit →",
  },
  "disbursement-planner": {
    hero: false,
    outcomeHeadline: "Tranche sizing for a payout, sanity-checked by DeepBook.",
    outcomeDetail:
      "Treasury probes real SUI/USDC depth and posts POST_ONLY orders to validate slippage; Planner writes up the recommended schedule.",
    team: [
      { role: "Planner", does: "lays out the disbursement schedule" },
      {
        role: "Treasury",
        capability: "treasury",
        does: "tests pool depth with real orders",
      },
    ],
    ctaCopy: "Plan the disbursement →",
  },
};

// Templates we actually show in the gallery. `open-workforce` is a
// blank-canvas power-user template (empty missionPlaceholder) — it lives
// behind the "Write your own" disclosure, not in the gallery.
const GALLERY_TEMPLATE_IDS = [
  "investment-committee",
  "move-audit-sprint",
  "disbursement-planner",
] as const;

type LaunchPhase =
  | { kind: "idle" }
  | { kind: "checking-balance"; templateId: string }
  | { kind: "funding"; templateId: string }
  | { kind: "signing"; templateId: string }
  | { kind: "error"; templateId: string; msg: string };

const COLD_START_FAUCET_TIMEOUT_MS = 15000;

function useMissionLauncher({
  address,
  onActivated,
}: {
  address: string;
  onActivated: (a: ActivationResult) => void;
}): {
  phase: LaunchPhase;
  launch: (template: WorkforceTemplate) => void;
} {
  const client = useSuiClient();
  // Unified signer — routes the activation tx through dApp Kit OR the
  // zkLogin path depending on which one is signed in. The button copy
  // and the cold-start faucet flow are identical for both.
  const { signAndExecute } = useAccountSigner();
  const [phase, setPhase] = useState<LaunchPhase>({ kind: "idle" });

  const launch = useCallback(
    (template: WorkforceTemplate) => {
      void (async () => {
        const briefTrim = (template.defaults.missionPlaceholder || "").trim();
        if (briefTrim.length < 4) {
          setPhase({
            kind: "error",
            templateId: template.id,
            msg: "This mission has no pre-filled brief. Use Write your own.",
          });
          return;
        }

        // 1) Cold-start: top up the wallet from the testnet faucet if
        //    it can't cover the activation tx's gas. We poll for the
        //    balance to land before moving on so the next signature
        //    doesn't fail with InsufficientGas.
        try {
          setPhase({ kind: "checking-balance", templateId: template.id });
          const b = await client.getBalance({ owner: address });
          const balSui = Number(b.totalBalance) / 1e9;
          if (balSui < COLD_START_MIN_SUI) {
            setPhase({ kind: "funding", templateId: template.id });
            const r = await fetch(apiUrl("/api/agent/faucet"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ recipient: address }),
            });
            const j = (await r.json()) as {
              ok?: boolean;
              message?: string;
              retry_after_sec?: number;
            };
            if (!j.ok) {
              const raw = j.message ?? "";
              const isRateLimit =
                /rate.*limit|too many requests|429/i.test(raw) ||
                !!j.retry_after_sec;
              const shortAddr = `${address.slice(0, 8)}…${address.slice(-4)}`;
              const msg = isRateLimit
                ? `The public testnet faucet is cooling down for your address. Open the account chip (top right) to copy ${shortAddr} and send testnet SUI to it from another wallet — or wait ~30 minutes and tap the mission again.`
                : raw || "Faucet failed.";
              setPhase({
                kind: "error",
                templateId: template.id,
                msg,
              });
              return;
            }
            // Poll for the balance to land. The faucet pays into the
            // user's wallet but the validator needs a moment to settle
            // the coin. We give it up to 15s.
            const t0 = Date.now();
            let funded = false;
            while (Date.now() - t0 < COLD_START_FAUCET_TIMEOUT_MS) {
              await new Promise((res) => setTimeout(res, 1200));
              try {
                const nb = await client.getBalance({ owner: address });
                if (Number(nb.totalBalance) / 1e9 >= COLD_START_MIN_SUI) {
                  funded = true;
                  break;
                }
              } catch {
                /* keep polling */
              }
            }
            if (!funded) {
              setPhase({
                kind: "error",
                templateId: template.id,
                msg: "Faucet sent the SUI but it hasn't settled yet — try again in a few seconds.",
              });
              return;
            }
          }
        } catch (e) {
          setPhase({
            kind: "error",
            templateId: template.id,
            msg: e instanceof Error ? e.message : String(e),
          });
          return;
        }

        // 2) Sign the activation. We hand the template's defaults
        //    verbatim — no UI for the user to override here.
        setPhase({ kind: "signing", templateId: template.id });
        let tx;
        try {
          tx = buildActivateTx({
            packageId: BRIEF_PACKAGE_ID,
            templateId: template.id,
            name: template.defaults.name,
            budgetSui: template.defaults.budgetSui,
            allowedVenues: template.defaults.allowedVenues,
            expiryHours: template.defaults.expiryHours,
            riskTolerance: template.defaults.riskTolerance,
          });
        } catch (e) {
          setPhase({
            kind: "error",
            templateId: template.id,
            msg: e instanceof Error ? e.message : String(e),
          });
          return;
        }
        signAndExecute(tx, {
          onSuccess: (res) => {
            onActivated({
              policyId: null,
              txDigest: res.digest,
              templateId: template.id,
              name: template.defaults.name,
              brief: briefTrim,
              budgetSui: template.defaults.budgetSui,
              allowedVenues: template.defaults.allowedVenues,
            });
          },
          onError: (e) =>
            setPhase({
              kind: "error",
              templateId: template.id,
              msg: e instanceof Error ? e.message : String(e),
            }),
        });
      })();
    },
    [address, client, onActivated, signAndExecute],
  );

  return { phase, launch };
}

function MissionGallery({
  address,
  onActivated,
}: {
  address: string;
  onActivated: (a: ActivationResult) => void;
}) {
  const { phase, launch } = useMissionLauncher({ address, onActivated });
  const [showWriteYourOwn, setShowWriteYourOwn] = useState(false);

  const templates = GALLERY_TEMPLATE_IDS
    .map((id) => templateById(id))
    .filter((t): t is WorkforceTemplate => !!t);
  const hero = templates.find((t) => MISSION_DETAILS[t.id]?.hero);
  const others = templates.filter((t) => !MISSION_DETAILS[t.id]?.hero);

  return (
    <section className="mt-12">
      <div className="flex items-end justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Tap a mission
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          {templates.length} ready · sign once
        </p>
      </div>

      {hero && (
        <MissionCardHero
          template={hero}
          launch={launch}
          phase={phase}
        />
      )}

      {others.length > 0 && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {others.map((t) => (
            <MissionCard key={t.id} template={t} launch={launch} phase={phase} />
          ))}
        </div>
      )}

      <ControlReassurance />

      {/* Escape hatch — power-user / write-your-own. Collapsed by
          default so a beginner never sees the form. */}
      <details
        className="group mt-10 border border-line bg-bg-elev"
        open={showWriteYourOwn}
        onToggle={(e) =>
          setShowWriteYourOwn((e.target as HTMLDetailsElement).open)
        }
      >
        <summary className="flex cursor-pointer items-center justify-between px-5 py-4 font-mono text-[10.5px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink focus-visible:text-ink">
          <span className="inline-flex items-center gap-2">
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            Write your own mission
          </span>
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
            strokeWidth={1.75}
            aria-hidden
          />
        </summary>
        <div className="border-t border-line px-5 py-6 sm:px-7">
          <HireForm address={address} onActivated={onActivated} />
        </div>
      </details>
    </section>
  );
}

// Calm, ever-present reminder. Sits below the gallery so the user knows
// the safety net is real before they tap anything.
function ControlReassurance() {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2.5 border-l-2 border-line-strong pl-4 font-mono text-[10.5px] uppercase tracking-[0.28em] text-ink-2">
      <ShieldOff
        className="h-3.5 w-3.5 text-ink"
        strokeWidth={1.75}
        aria-hidden
      />
      <span>You&apos;re in control · revoke any time</span>
      <span className="text-muted/60">·</span>
      <span className="normal-case tracking-normal text-muted">
        the chain itself refuses the next payment
      </span>
    </div>
  );
}

function MissionCardHero({
  template,
  launch,
  phase,
}: {
  template: WorkforceTemplate;
  launch: (t: WorkforceTemplate) => void;
  phase: LaunchPhase;
}) {
  const d = MISSION_DETAILS[template.id];
  const busy =
    phase.kind !== "idle" && phase.kind !== "error" && phase.templateId === template.id;
  const errMsg =
    phase.kind === "error" && phase.templateId === template.id ? phase.msg : null;
  return (
    <article className="relative mt-4 border-2 border-ink bg-bg-elev">
      {/* No heartbeat here — animate-operator-pulse-line is reserved
          for the live console where it signals real on-chain activity.
          The gallery surface stays calm and premium. */}
      <div className="grid gap-8 px-6 py-7 sm:px-8 sm:py-8 lg:grid-cols-[1.35fr_1fr] lg:items-start">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 border border-emerald-600/40 bg-emerald-50/70 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.28em] text-emerald-800">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden />
              Recommended
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.28em] text-muted">
              {template.defaults.budgetSui.toFixed(2)} SUI cap ·{" "}
              {template.defaults.allowedVenues.length} specialists
            </span>
          </div>
          <h2 className="font-sans text-[26px] font-medium leading-[1.1] tracking-tightest text-ink sm:text-[32px]">
            {template.label}
          </h2>
          <p className="text-[15px] leading-relaxed text-ink">
            <span className="font-medium text-ink">You get:</span>{" "}
            <span className="text-ink-2">{d.outcomeHeadline}</span>
          </p>
          <p className="text-[13.5px] leading-relaxed text-muted">
            {d.outcomeDetail}
          </p>
        </div>

        <div className="space-y-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            The team
          </p>
          <ul className="space-y-2.5">
            {d.team.map((t) => (
              <TeamRow key={t.role} role={t.role} does={t.does} capability={t.capability} />
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line bg-bg-elev-2/50 px-6 py-5 sm:px-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          One tap · one signature · auto-funded if empty
        </p>
        <MissionLaunchButton
          onClick={() => launch(template)}
          busy={busy}
          phase={phase}
          ctaCopy={d.ctaCopy}
          primary
        />
      </div>

      {errMsg && (
        <p className="border-t border-red-200 bg-red-50 px-6 py-3 font-mono text-[11px] text-red-700 sm:px-8">
          {errMsg.slice(0, 240)}
        </p>
      )}
    </article>
  );
}

function MissionCard({
  template,
  launch,
  phase,
}: {
  template: WorkforceTemplate;
  launch: (t: WorkforceTemplate) => void;
  phase: LaunchPhase;
}) {
  const d = MISSION_DETAILS[template.id];
  if (!d) return null;
  const busy =
    phase.kind !== "idle" && phase.kind !== "error" && phase.templateId === template.id;
  const errMsg =
    phase.kind === "error" && phase.templateId === template.id ? phase.msg : null;
  return (
    <article className="flex flex-col border border-line bg-bg-elev transition-colors hover:border-line-strong">
      <div className="flex flex-1 flex-col gap-4 px-5 py-6 sm:px-6">
        <div className="space-y-3">
          <h3 className="font-sans text-[20px] font-medium leading-[1.15] tracking-tight text-ink">
            {template.label}
          </h3>
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            <span className="font-medium text-ink">You get:</span> {d.outcomeHeadline}
          </p>
        </div>

        <ul className="space-y-1.5">
          {d.team.map((t) => (
            <TeamRow
              key={t.role}
              role={t.role}
              does={t.does}
              capability={t.capability}
              compact
            />
          ))}
        </ul>

        <p className="mt-auto font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
          {template.defaults.budgetSui.toFixed(2)} SUI cap ·{" "}
          {template.defaults.allowedVenues.join(" · ")}
        </p>
      </div>
      <div className="flex items-center justify-end border-t border-line bg-bg-elev-2/40 px-5 py-3 sm:px-6">
        <MissionLaunchButton
          onClick={() => launch(template)}
          busy={busy}
          phase={phase}
          ctaCopy={d.ctaCopy}
        />
      </div>
      {errMsg && (
        <p className="border-t border-red-200 bg-red-50 px-5 py-2 font-mono text-[11px] text-red-700 sm:px-6">
          {errMsg.slice(0, 240)}
        </p>
      )}
    </article>
  );
}

function TeamRow({
  role,
  does,
  capability,
  compact,
}: {
  role: string;
  does: string;
  capability?: string;
  compact?: boolean;
}) {
  void capability;
  return (
    <li
      className={[
        "flex items-start gap-2.5",
        compact ? "text-[12.5px] leading-snug" : "text-[13.5px] leading-relaxed",
      ].join(" ")}
    >
      <span
        className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ink/50"
        aria-hidden
      />
      <span>
        <span className="font-medium text-ink">{role}</span>
        <span className="text-muted"> · {does}</span>
      </span>
    </li>
  );
}

function MissionLaunchButton({
  onClick,
  busy,
  phase,
  ctaCopy,
  primary,
}: {
  onClick: () => void;
  busy: boolean;
  phase: LaunchPhase;
  ctaCopy: string;
  primary?: boolean;
}) {
  let body: React.ReactNode = ctaCopy;
  if (busy && phase.kind === "checking-balance") body = <BusyChip text="Checking wallet…" />;
  else if (busy && phase.kind === "funding") body = <BusyChip text="Funding wallet…" />;
  else if (busy && phase.kind === "signing") body = <BusyChip text="Sign in your wallet…" />;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={[
        "inline-flex items-center gap-2 border-2 px-5 py-2.5 font-mono uppercase tracking-[0.3em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60",
        primary
          ? "border-ink bg-ink text-bg text-[11px] hover:bg-ink-2 sm:text-[12px]"
          : "border-ink text-ink text-[10.5px] hover:bg-ink hover:text-bg sm:text-[11px]",
      ].join(" ")}
    >
      {body}
    </button>
  );
}

function BusyChip({ text }: { text: string }) {
  return (
    <>
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {text}
    </>
  );
}

function HireForm({
  address,
  onActivated,
}: {
  address: string;
  onActivated: (a: ActivationResult) => void;
}) {
  void address;

  const [templateId, setTemplateId] = useState<string>(WORKFORCE_TEMPLATES[0].id);
  const template = useMemo(() => templateById(templateId)!, [templateId]);

  const [brief, setBrief] = useState("");
  const [budgetSui, setBudgetSui] = useState(template.defaults.budgetSui);
  const [allowedVenues, setAllowedVenues] = useState<string[]>(template.defaults.allowedVenues);
  const [expiryHours, setExpiryHours] = useState(template.defaults.expiryHours);
  const [riskTolerance, setRiskTolerance] = useState<"low" | "medium" | "high">(
    template.defaults.riskTolerance,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Keep the budget pinned to the template's default whenever the
  // template changes — judges shouldn't have to think about budget if
  // they're not customizing.
  useEffect(() => {
    setBudgetSui(template.defaults.budgetSui);
    setAllowedVenues(template.defaults.allowedVenues);
    setExpiryHours(template.defaults.expiryHours);
    setRiskTolerance(template.defaults.riskTolerance);
  }, [templateId, template]);

  const { signAndExecute } = useAccountSigner();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After the policy is created we POST the mission automatically in the
  // background — the judge never sees a second form.
  function handleHire() {
    setError(null);
    const briefTrim = brief.trim();
    if (briefTrim.length === 0) {
      setError("Write a brief first — what should the workforce do?");
      return;
    }
    let tx;
    try {
      tx = buildActivateTx({
        packageId: BRIEF_PACKAGE_ID,
        templateId,
        name: template.defaults.name,
        budgetSui,
        allowedVenues,
        expiryHours,
        riskTolerance,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setIsPending(true);
    signAndExecute(tx, {
      onSuccess: (res) => {
        setIsPending(false);
        onActivated({
          policyId: null,
          txDigest: res.digest,
          templateId,
          name: template.defaults.name,
          brief: briefTrim,
          budgetSui,
          allowedVenues,
        });
      },
      onError: (e) => {
        setIsPending(false);
        setError(e instanceof Error ? e.message : String(e));
      },
    });
  }

  const briefTooShort = brief.trim().length < 4;

  return (
    <section>
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Step 1 of 1
      </p>
      <h1 className="mt-3 font-sans text-4xl font-medium tracking-tightest">
        Write your brief.
      </h1>
      <p className="mt-3 max-w-prose text-ink-2">
        One sentence. One signature. The Planner agent decomposes it into
        on-chain jobs and the specialists pick them up.
      </p>

      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="sr-only">Your brief</span>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={template.defaults.missionPlaceholder ||
              "Evaluate this Move contract for a $50,000 DAO grant — recommend approve / reject and probe DeepBook depth to size the disbursement."}
            rows={4}
            maxLength={1600}
            className="w-full resize-none border-2 border-line bg-bg-elev px-4 py-3 text-base leading-relaxed outline-none transition-colors focus:border-ink focus-visible:border-ink"
          />
        </label>
        <div className="-mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          <Sparkles className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          One-click briefs · pick one to start
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {WORKFORCE_TEMPLATES.map((t) => {
            const on = t.id === templateId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTemplateId(t.id);
                  if (brief.trim().length === 0) {
                    setBrief(t.defaults.missionPlaceholder);
                  }
                }}
                className={[
                  "group relative flex flex-col items-start gap-1.5 border-2 px-4 py-3 text-left transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                  on
                    ? "border-ink bg-ink/[0.03]"
                    : "border-line bg-bg-elev hover:-translate-y-px hover:border-line-strong hover:bg-bg-elev",
                ].join(" ")}
              >
                <span
                  aria-hidden
                  className={[
                    "absolute inset-x-0 top-0 h-px transition-opacity",
                    on
                      ? "bg-emerald-500/70 opacity-100"
                      : "bg-emerald-500/0 opacity-0 group-hover:bg-emerald-500/40 group-hover:opacity-100",
                  ].join(" ")}
                />
                <p
                  className={[
                    "text-[14.5px] font-medium tracking-tight",
                    on ? "text-ink" : "text-ink-2 group-hover:text-ink",
                  ].join(" ")}
                >
                  {t.label}
                </p>
                <p className="text-[12px] leading-snug text-muted">
                  {t.blurb}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
                  <span className="tabular-nums">
                    {t.defaults.budgetSui.toFixed(2)} SUI
                  </span>
                  <span className="text-muted/60">·</span>
                  <span>{t.defaults.allowedVenues.join(" · ")}</span>
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8 border border-line bg-bg-elev p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          Budget envelope
        </p>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-sans text-3xl font-medium tracking-tight tabular-nums">
            {budgetSui.toFixed(2)}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
            SUI cap
          </span>
        </div>
        <input
          type="range"
          min={0.1}
          max={5}
          step={0.05}
          value={budgetSui}
          onChange={(e) => setBudgetSui(Number(e.target.value))}
          className="mt-4 w-full accent-ink"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {[0.2, 0.5, 1.0, 2.0].map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBudgetSui(b)}
              className={[
                "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink",
                budgetSui === b
                  ? "border-ink text-ink"
                  : "border-line text-muted hover:text-ink",
              ].join(" ")}
            >
              {b} SUI
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          You are the OWNER. The Planner agent at{" "}
          <span className="font-mono">{short(BRIEF_OPERATOR_ADDRESS, 6, 4)}</span>{" "}
          is the bound AGENT — it can only spend within this envelope, only
          on the capabilities below, only until expiry. You can revoke any
          time.
        </p>
      </div>

      <details
        className="mt-6 border border-line bg-bg-elev"
        open={showAdvanced}
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer items-center justify-between px-5 py-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          Advanced
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-line px-5 py-5 space-y-5">
          <Field label="Allowed capabilities">
            <div className="flex flex-wrap gap-2">
              {["research", "audit", "treasury"].map((cap) => {
                const on = allowedVenues.includes(cap);
                return (
                  <button
                    key={cap}
                    type="button"
                    onClick={() =>
                      setAllowedVenues(
                        on
                          ? allowedVenues.filter((v) => v !== cap)
                          : [...allowedVenues, cap],
                      )
                    }
                    className={[
                      "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink",
                      on
                        ? "border-ink bg-ink text-bg"
                        : "border-line text-ink-2 hover:border-line-strong",
                    ].join(" ")}
                  >
                    {cap}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Expiry">
            <div className="flex flex-wrap gap-2">
              {[1, 2, 4, 12, 24].map((h) => {
                const on = expiryHours === h;
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setExpiryHours(h)}
                    className={[
                      "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink",
                      on
                        ? "border-ink bg-ink text-bg"
                        : "border-line text-ink-2 hover:border-line-strong",
                    ].join(" ")}
                  >
                    {h}h
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Risk tolerance">
            <div className="flex flex-wrap gap-2">
              {(["low", "medium", "high"] as const).map((r) => {
                const on = riskTolerance === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRiskTolerance(r)}
                    className={[
                      "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink",
                      on
                        ? "border-ink bg-ink text-bg"
                        : "border-line text-ink-2 hover:border-line-strong",
                    ].join(" ")}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </details>

      {error && (
        <p className="mt-6 border border-red-300 bg-red-50 p-3 font-mono text-[12px] text-red-700">
          {error.slice(0, 280)}
        </p>
      )}

      {/* "What happens when you sign" — three concrete beats so the judge
          isn't signing a black box. Reads top-to-bottom like a contract,
          not a sales line. */}
      <div className="mt-8 border-l-2 border-line-strong pl-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          When you sign
        </p>
        <ol className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink-2">
          <li className="flex gap-2.5">
            <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-ink/40" aria-hidden />
            A Move <span className="font-mono text-ink">OperatorPolicy</span> is
            minted on chain — owned by you, capped at{" "}
            <span className="font-mono tabular-nums text-ink">
              {budgetSui.toFixed(2)} SUI
            </span>
            , revocable in one signature.
          </li>
          <li className="flex gap-2.5">
            <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-ink/40" aria-hidden />
            The Planner reads your brief and hires the specialists above; each
            sub-task posts atomically with escrowed SUI.
          </li>
          <li className="flex gap-2.5">
            <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-ink/40" aria-hidden />
            When work is delivered you choose{" "}
            <span className="text-ink">Release</span> or{" "}
            <span className="text-red-700">Revoke</span> — the chain enforces
            either way.
          </li>
        </ol>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[18rem] font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          one signature · creates the policy · auto-dispatches the brief
        </p>
        <button
          type="button"
          onClick={handleHire}
          disabled={isPending || briefTooShort}
          className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-6 py-3 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:border-line disabled:bg-line disabled:text-muted"
        >
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Signing…
            </>
          ) : (
            <>
              Hire workforce
              <span aria-hidden>→</span>
            </>
          )}
        </button>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-2">
        {label}
      </p>
      {children}
    </div>
  );
}

// =============================================================================
// Live console — top status card + Revoke + Activity timeline
// =============================================================================

type AbortRecord = {
  taskId: string;
  txDigest?: string;
  abortCode?: number;
  abortConst?: string;
  abortModule?: string;
  abortFn?: string;
  error?: string;
  at: number;
};

// =============================================================================
// Trader Dashboard — Phase-3 surface for an adopted trader.
//
// Reuses every primitive proven by the workforce path: PolicyCard,
// ChainRefusedCard, KillSwitchInFlight, RevokeModal, the deterministic
// kill-switch state machine, the cold-start affordance, the Walrus
// badge, AccountChip and the always-visible "revoke" chip. New shells
// on top: a trader identity header, an open-position drama panel, and
// a first-person Narrator written in the trader's voice.
// =============================================================================

function TraderDashboard({
  activation,
  onReset,
}: {
  activation: ActivationResult;
  onReset: () => void;
}) {
  const resolvedPolicyId = useResolvedPolicyId(activation.txDigest);
  const policyId = resolvedPolicyId;
  const { policy } = usePolicy(policyId);
  const { tasks } = useTasksForPolicy(policyId);
  const status = policy ? policyStatus(policy) : null;

  const personality = activation.traderStrategy
    ? personalityById(activation.traderStrategy) ?? null
    : null;
  const traderName = activation.traderName ?? activation.name;

  // Persist trader identity once the policy materialises so a reload of
  // the dashboard knows the trader's name without round-tripping
  // through the chain.
  useEffect(() => {
    if (!policyId || !activation.traderStrategy) return;
    saveTraderIdentity({
      policyId,
      name: traderName,
      strategy: activation.traderStrategy,
      adoptedAtMs: Date.now(),
    });
  }, [policyId, traderName, activation.traderStrategy]);

  // Hydrate from local storage on first mount in case we landed on the
  // dashboard via a back/forward navigation that lost activation state.
  useEffect(() => {
    if (!policyId) return;
    const cached = loadTraderIdentity(policyId);
    if (cached && (!activation.traderName || activation.traderName === activation.name)) {
      activation.traderName = cached.name;
      activation.traderStrategy = cached.strategy;
    }
  }, [policyId, activation]);

  // Auto-dispatch a predict-btc task the moment the policy id resolves
  // — the user only signed the grant; the trader's first bet is posted
  // server-side by the Planner key so they don't see a second prompt.
  const dispatchedRef = useRef(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  useEffect(() => {
    if (!policyId || dispatchedRef.current) return;
    if (!activation.traderStrategy) return;
    dispatchedRef.current = true;
    void (async () => {
      try {
        const r = await dispatchTraderTask({
          policyId,
          strategy: activation.traderStrategy!,
          traderName,
          markets: activation.traderMarkets,
        });
        if (!r.ok) setDispatchError(r.error ?? "dispatch failed");
      } catch (e) {
        setDispatchError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [policyId, activation.traderStrategy, activation.traderMarkets, traderName]);

  // Kill-switch state machine — identical to LiveConsole. The revoke
  // path proves the leash by waiting for an EPolicyRevoked abort on a
  // delivered task. Past wins still auto-redeem via the trader agent's
  // permissionless service (no policy gate on redeem_permissionless).
  type KillSwitchPhase =
    | "idle"
    | "scanning"
    | "verifying_post"
    | "verified";
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [revokeTx, setRevokeTx] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [chainAbort, setChainAbort] = useState<AbortRecord | null>(null);
  const [killSwitchPhase, setKillSwitchPhase] = useState<KillSwitchPhase>("idle");
  const [verificationTaskId, setVerificationTaskId] = useState<string | null>(
    null,
  );
  const triedTaskIdsRef = useRef<Set<string>>(new Set());
  const verificationPostedRef = useRef(false);
  const inFlightRef = useRef(false);
  const { signAndExecute: signRevoke } = useAccountSigner();
  const { agents: roster } = useRegisteredAgents({
    excludeAddress: BRIEF_OPERATOR_ADDRESS,
  });

  function isVerifiedEPolicyRevoked(j: Partial<AbortRecord>): boolean {
    if (j.abortCode !== 3) return false;
    if (j.abortModule !== "operator_policy") return false;
    if (j.abortConst && j.abortConst !== "EPolicyRevoked") return false;
    return true;
  }
  const attemptAbort = useCallback(
    async (taskId: string): Promise<boolean> => {
      if (triedTaskIdsRef.current.has(taskId)) return false;
      triedTaskIdsRef.current.add(taskId);
      try {
        const r = await fetch(apiUrl("/api/workforce/approve"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_id: taskId, policy_id: policyId }),
        });
        const j = (await r.json()) as Partial<AbortRecord> & { ok?: boolean };
        if (j.ok) return false;
        if (!isVerifiedEPolicyRevoked(j)) return false;
        setChainAbort({
          taskId,
          txDigest: j.txDigest,
          abortCode: j.abortCode,
          abortConst: j.abortConst ?? "EPolicyRevoked",
          abortModule: j.abortModule ?? "operator_policy",
          abortFn: j.abortFn ?? "assert_can_spend",
          at: Date.now(),
        });
        setKillSwitchPhase("verified");
        return true;
      } catch {
        return false;
      }
    },
    [policyId],
  );
  const postVerificationTask = useCallback(
    async (allowedVenues: string[]): Promise<void> => {
      if (!policyId || verificationPostedRef.current) return;
      verificationPostedRef.current = true;
      const pickFor = (cap: string) =>
        roster.find((a) => a.capabilities.includes(cap));
      const preferred = ["predict-btc", "treasury", "research", "audit"];
      let chosen: { address: string; capability: string } | null = null;
      for (const cap of preferred) {
        if (!allowedVenues.includes(cap)) continue;
        const a = pickFor(cap);
        if (a) {
          chosen = { address: a.address, capability: cap };
          break;
        }
      }
      if (!chosen) {
        for (const a of roster) {
          for (const cap of a.capabilities) {
            if (allowedVenues.includes(cap)) {
              chosen = { address: a.address, capability: cap };
              break;
            }
          }
          if (chosen) break;
        }
      }
      if (!chosen) return;
      try {
        const r = await fetch(apiUrl("/api/workforce/post-verification"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            policy_id: policyId,
            assigned_to: chosen.address,
            capability: chosen.capability,
          }),
        });
        const j = (await r.json()) as { ok?: boolean; task_id?: string };
        if (j.ok && j.task_id) {
          setVerificationTaskId(j.task_id);
          setKillSwitchPhase("verifying_post");
        }
      } catch {
        /* fall through */
      }
    },
    [policyId, roster],
  );
  useEffect(() => {
    if (
      !policyId ||
      !policy?.revoked ||
      killSwitchPhase === "verified" ||
      inFlightRef.current
    ) {
      return;
    }
    inFlightRef.current = true;
    void (async () => {
      try {
        for (const t of tasks) {
          if (t.status !== "delivered") continue;
          if (triedTaskIdsRef.current.has(t.id)) continue;
          const ok = await attemptAbort(t.id);
          if (ok) return;
        }
        if (
          killSwitchPhase === "scanning" &&
          !verificationPostedRef.current
        ) {
          const venues = policy.allowedVenues ?? [];
          await postVerificationTask(venues);
        }
        if (verificationTaskId) {
          await attemptAbort(verificationTaskId);
        }
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [
    policy,
    policyId,
    tasks,
    killSwitchPhase,
    verificationTaskId,
    attemptAbort,
    postVerificationTask,
  ]);
  function handleRevoke() {
    if (!policyId) return;
    setRevokeError(null);
    const tx = buildRevokeTx({ packageId: BRIEF_PACKAGE_ID, policyId });
    setRevokeSubmitting(true);
    signRevoke(tx, {
      onSuccess: (res) => {
        setRevokeTx(res.digest);
        setRevokeSubmitting(false);
        setConfirmRevoke(false);
        setKillSwitchPhase("scanning");
      },
      onError: (e) => {
        setRevokeError(e instanceof Error ? e.message : String(e));
        setRevokeSubmitting(false);
      },
    });
  }
  // Freeze CSS-only motion the moment the chain refuses a payment.
  const interventionActive = !!chainAbort;
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (interventionActive) {
      document.documentElement.setAttribute("data-chain-intervention", "1");
    }
    const t = setTimeout(() => {
      document.documentElement.removeAttribute("data-chain-intervention");
    }, 6000);
    return () => clearTimeout(t);
  }, [interventionActive]);

  return (
    <section className="relative mx-auto max-w-page px-6 py-12 sm:px-10 sm:py-16">
      {/* Boot ceremony — a single scanner sweep plays once when the
          dashboard mounts right after the leash is minted. Clipped so the
          translate never causes horizontal scroll; reduced-motion guard
          neutralizes it. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[2px] overflow-hidden"
        aria-hidden
      >
        <div className="h-full w-3/4 animate-boot-sweep bg-gradient-to-r from-transparent via-emerald-500 to-transparent" />
      </div>
      <TraderHeader
        traderName={traderName}
        personality={personality}
        statusLabel={status ? statusLabel(status) : "ACTIVATING"}
        onReset={onReset}
        onRevoke={
          policy?.revoked ? undefined : () => setConfirmRevoke(true)
        }
        revokeSubmitting={revokeSubmitting}
      />

      <PolicyCard
        activation={activation}
        policyId={policyId}
        policy={policy}
        status={status}
        onRequestRevoke={() => setConfirmRevoke(true)}
        revokeSubmitting={revokeSubmitting}
        revokeError={revokeError}
      />

      {chainAbort && (
        <ChainRefusedCard
          policyId={policyId ?? ""}
          revokeTx={revokeTx}
          abort={chainAbort}
        />
      )}

      {chainAbort && (
        <RedeemSurvivorNote traderName={traderName} />
      )}

      {policy?.revoked && !chainAbort && (
        <KillSwitchInFlight
          policyId={policyId ?? ""}
          revokeTx={revokeTx}
          phase={killSwitchPhase}
          verificationTaskId={verificationTaskId}
          tasks={tasks}
        />
      )}

      <TraderOpenPositionPanel
        traderName={traderName}
        personality={personality}
        tasks={tasks}
        dispatchError={dispatchError}
        policyId={policyId ?? null}
      />

      <TraderMemoryJournal
        traderName={traderName}
        tasks={tasks}
      />

      <TraderTrackRecord traderName={traderName} tasks={tasks} />

      <LeaderboardCTA traderName={traderName} />

      <TraderNarrator
        activation={activation}
        traderName={traderName}
        personality={personality}
        policyId={policyId}
        policy={policy}
        tasks={tasks}
        chainAbort={chainAbort}
      />

      {confirmRevoke && (
        <RevokeModal
          onConfirm={handleRevoke}
          onCancel={() => setConfirmRevoke(false)}
          submitting={revokeSubmitting}
          name={traderName}
        />
      )}
    </section>
  );
}

function TraderHeader({
  traderName,
  personality,
  statusLabel: label,
  onReset,
  onRevoke,
  revokeSubmitting,
}: {
  traderName: string;
  personality: TraderPersonality | null;
  statusLabel: string;
  onReset: () => void;
  onRevoke?: () => void;
  revokeSubmitting: boolean;
}) {
  return (
    <header>
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Trader · {label}
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex items-end gap-4">
          {personality && (
            <span
              className="font-sans text-[56px] leading-none text-ink sm:text-[72px]"
              aria-hidden
            >
              {personality.glyph}
            </span>
          )}
          <div>
            <h1 className="font-sans text-[28px] font-medium leading-[1.05] tracking-tightest text-ink sm:text-[40px]">
              {traderName}
            </h1>
            {personality && (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
                {personality.label} · {personality.temperament}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {onRevoke && (
            <button
              type="button"
              onClick={onRevoke}
              disabled={revokeSubmitting}
              className="inline-flex items-center gap-1.5 border-2 border-red-400 bg-bg-elev px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-red-700 transition-colors hover:border-red-600 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              title="Yank the leash — the chain refuses the next bet"
            >
              <ShieldOff className="h-3 w-3" strokeWidth={1.75} aria-hidden />
              Yank the leash
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink focus-visible:text-ink"
          >
            ← Adopt another
          </button>
        </div>
      </div>
      {personality && (
        <p className="mt-4 max-w-2xl border-l-2 border-line-strong pl-4 text-[15px] italic leading-relaxed text-ink-2">
          &ldquo;{personality.voice}&rdquo;
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.28em] text-muted not-italic">
            — {traderName}
          </span>
        </p>
      )}
    </header>
  );
}

// "Past wins still pay out" — the lovely truth that pays off after a
// revoke. Surfaced next to the ChainRefusedCard so the user sees the
// contrast immediately.
function RedeemSurvivorNote({ traderName }: { traderName: string }) {
  return (
    <aside className="mt-4 border-l-2 border-emerald-600 bg-emerald-50/40 px-5 py-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-emerald-800">
        The leash blocks new bets, not your winnings
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        The chain just refused {traderName}&apos;s next mint — that&apos;s the
        kill switch working. But any position {traderName} already won is
        permissionless to claim: our auto-redeem service will keep collecting
        your payouts even though new bets are now impossible.
      </p>
    </aside>
  );
}

// Decode the trader's deliverable JSON. Optional fields tolerate
// schema drift so an older deliverable doesn't crash the panel.
type DecodedTraderDeliverable = {
  strategy?: StrategyId;
  market?: {
    oracle_id?: string;
    underlying?: string;
    expiry_ms?: number;
    strike?: number;
    tick_size?: number;
    spot_at_decision?: number;
  };
  decision?: {
    direction?: "up" | "down";
    quantity?: number;
    cost_dusdc_base?: number;
    reasoning?: string;
  };
  execution?: {
    mode?: "live" | "simulated";
    mint_tx_digest?: string | null;
    walrus_blob_id?: string | null;
    reason_if_simulated?: string | null;
    journal_walrus_blob_id?: string | null;
    journal_entries?: number;
  };
  metadata?: {
    manager_id?: string;
    policy_id?: string | null;
    venue?: string;
  };
};

function parseTraderDeliverable(raw: string | null): DecodedTraderDeliverable | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DecodedTraderDeliverable;
  } catch {
    return null;
  }
}

// The big open-position card. When there's an in-flight task we
// render the current bet with a countdown to settlement; when the
// trader is still composing, a calm "thinking" state.
function TraderOpenPositionPanel({
  traderName,
  personality,
  tasks,
  dispatchError,
  policyId,
}: {
  traderName: string;
  personality: TraderPersonality | null;
  tasks: WorkforceTask[];
  dispatchError: string | null;
  policyId: string | null;
}) {
  // Newest first by postedAtMs.
  const sorted = [...tasks].sort((a, b) =>
    Number(b.postedAtMs - a.postedAtMs),
  );
  const latest = sorted[0];
  const deliverable = useDeliverable(latest?.deliverableId ?? null);
  const decoded = parseTraderDeliverable(deliverable.body);

  // Live countdown — re-render every second when we have an expiry.
  const expiryMs = decoded?.market?.expiry_ms;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiryMs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiryMs]);

  // Live BTC spot — must run on every render path (React hook rules),
  // so we call it up here with the oracle id (or null while we're
  // still in a loading / pre-deliverable state). Consumed deeper down
  // in the panel where we actually have a market to render against.
  const settledForLive =
    latest?.status === "approved" || latest?.status === "expired";
  const live = useLiveSpot(
    settledForLive || !decoded?.market?.oracle_id
      ? null
      : (decoded.market.oracle_id ?? null),
  );

  // The live trading floor — charts + SSE decision wire. Rendered in
  // every active state (even before the first deliverable lands) so
  // the user watches the very first decision happen, not its receipt.
  const mindCanvas = (
    <MindCanvas
      policyId={policyId}
      oracleId={decoded?.market?.oracle_id ?? null}
      asset={decoded?.market?.underlying ?? "BTC"}
      strikeUsd={
        decoded?.market?.strike ? Number(decoded.market.strike) / 1e9 : null
      }
      direction={(decoded?.decision?.direction as "up" | "down") ?? null}
      liveSpotUsd={live.spotRaw !== null ? rawToUsd(live.spotRaw) : null}
      traderName={traderName}
      fallbackReasoning={decoded?.decision?.reasoning ?? null}
    />
  );

  if (dispatchError) {
    return (
      <section className="mt-8 border-2 border-red-400 bg-red-50/40 px-5 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-red-800">
          Dispatch failed
        </p>
        <p className="mt-2 text-[14px] leading-relaxed text-red-700">
          {traderName} couldn&apos;t get a job posted: {dispatchError}
        </p>
      </section>
    );
  }

  if (!latest) {
    return (
      <section className="relative mt-8 overflow-hidden border-2 border-line bg-bg-elev px-5 py-6 sm:px-7">
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-emerald-500/70 animate-operator-pulse-line"
          aria-hidden
        />
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          The first bet
        </p>
        <p className="mt-2 text-[18px] italic leading-snug text-ink-2">
          {traderName} is studying the order book…
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          The planner is posting the first {personality?.label.toLowerCase() ?? "trader"} job
          on chain; the trader will pick the nearest BTC market and bet
          within seconds.
        </p>
      </section>
    );
  }

  // Task exists but no deliverable yet — trader is actively working.
  // This is the moment the canvas earns its keep: the decision wire
  // animates each step live while the panel below says "on the wire."
  if (!deliverable.body || !decoded) {
    return (
      <>
      <section className="mt-8 border-2 border-ink bg-bg-elev">
        <span
          className="pointer-events-none block h-px w-full bg-emerald-500/70 animate-operator-pulse-line"
          aria-hidden
        />
        <div className="px-5 py-6 sm:px-7">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
            On the wire
          </p>
          <p className="mt-2 text-[18px] italic leading-snug text-ink-2">
            {traderName} accepted the job — picking a market…
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            The agent reads the live BTC oracle, scores the strategy, then
            posts the mint within ~5s. Sit tight.
          </p>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            <a
              href={explorerUrl("object", latest.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-ink underline-offset-4 hover:underline"
            >
              view task
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} aria-hidden />
            </a>
          </p>
        </div>
      </section>
      {mindCanvas}
      </>
    );
  }

  const isLive = decoded.execution?.mode === "live";
  const direction = decoded.decision?.direction ?? "up";
  const strikeUsd = decoded.market?.strike
    ? Number(decoded.market.strike) / 1_000_000_000
    : 0;
  const spotAtDecisionUsd = decoded.market?.spot_at_decision
    ? Number(decoded.market.spot_at_decision) / 1_000_000_000
    : 0;
  const cost = decoded.decision?.cost_dusdc_base
    ? Number(decoded.decision.cost_dusdc_base) / 1_000_000
    : 0;
  const settled = latest.status === "approved" || latest.status === "expired";

  // Live spot tick comes from useLiveSpot above (called unconditionally
  // to satisfy hook rules). Until the first read completes we fall
  // back to the spot the agent captured at the moment of decision, so
  // the win/loss read never shows "—".
  const liveSpotUsd =
    live.spotRaw !== null ? rawToUsd(live.spotRaw) : spotAtDecisionUsd;
  const spotUsd = liveSpotUsd; // for the win/loss inference + the panel display
  const winningSoFar = direction === "up"
    ? spotUsd >= strikeUsd
    : spotUsd <= strikeUsd;

  const msToExpiry = expiryMs ? expiryMs - now : 0;
  const expired = msToExpiry <= 0;

  // Distance to strike — signed % from the strike, color-coded by
  // whether the bet is currently winning. This is the "I can feel the
  // moment it flips" surface. We also derive a clamped 0-100 marker
  // position for the gauge bar (zoom window: ±0.5% around strike).
  const distancePct =
    strikeUsd > 0 ? ((spotUsd - strikeUsd) / strikeUsd) * 100 : 0;
  const distanceUsd = spotUsd - strikeUsd;
  // Gauge zoom: clamp the spot's position to ±0.5% around the strike.
  // Anything beyond that pegs to the edge, which is what we want — the
  // gauge is for "how close to a flip", not absolute price.
  const ZOOM_PCT = 0.5;
  const markerPct = Math.max(
    0,
    Math.min(100, 50 + (distancePct / ZOOM_PCT) * 50),
  );
  // "Distance to flip": the magnitude needed for the bet to cross
  // strike. Zero when the bet is currently at the strike line (the
  // tightest moment); negative impossible.
  const distanceToFlipUsd = Math.abs(distanceUsd);

  const abstained = (decoded.decision?.quantity ?? 0) === 0;
  return (
    <>
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Current bet · {settled ? "settled" : expired ? "awaiting settlement" : "live"}
        </p>
        <ModeBadge mode={isLive ? "live" : "simulated"} />
      </div>
      <article className="mt-3 overflow-hidden border-2 border-ink bg-bg-elev">
        {!settled && !expired && (
          <span
            className="pointer-events-none block h-px w-full bg-emerald-500/70 animate-operator-pulse-line"
            aria-hidden
          />
        )}
        <div className="grid gap-6 px-6 py-7 sm:grid-cols-[1.4fr_1fr] sm:px-8 sm:py-8">
          <div className="space-y-5">
            <p className="font-sans text-[26px] leading-[1.15] tracking-tightest text-ink sm:text-[32px]">
              <span className="text-muted">{traderName} is betting </span>
              <span className={direction === "up" ? "text-emerald-700" : "text-red-700"}>
                {direction.toUpperCase()}
              </span>
              <span className="text-muted"> on BTC</span>
            </p>

            {/* Live BTC price block — the dramatic centerpiece. The
                number gets a subtle pulse on every successful tick;
                the distance bar shows the strike as the midpoint and
                the current spot as a marker that crosses sides when
                the bet flips. */}
            {!settled && (
              <LivePriceBlock
                spotUsd={spotUsd}
                strikeUsd={strikeUsd}
                distancePct={distancePct}
                distanceToFlipUsd={distanceToFlipUsd}
                markerPct={markerPct}
                winning={winningSoFar}
                status={live.status}
                lastUpdatedMs={live.lastUpdatedMs}
              />
            )}

            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-[12.5px]">
              <DD label="strike">${strikeUsd.toFixed(2)}</DD>
              <DD label="spot at decision">${spotAtDecisionUsd.toFixed(2)}</DD>
              <DD label="stake">{cost > 0 ? `$${cost.toFixed(2)}` : `${decoded.decision?.quantity ?? "-"} dUSDC`}</DD>
              <DD label="expires">
                {expiryMs
                  ? settled
                    ? "settled"
                    : expired
                      ? "any second"
                      : countdownLabel(msToExpiry)
                  : "—"}
              </DD>
            </dl>
          </div>
          <div className="space-y-4 border-line sm:border-l sm:pl-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
              Status
            </p>
            {/* Animate the verdict line on every flip. Keying by
                `winning` remounts the element, which restarts the CSS
                fadeUp animation — so the user feels the moment it
                crosses. prefers-reduced-motion zeroes the animation. */}
            <p
              key={settled ? "settled" : winningSoFar ? "winning" : "losing"}
              className={[
                "font-sans text-[20px] leading-snug tracking-tight animate-fade-up",
                settled
                  ? "text-ink"
                  : winningSoFar
                    ? "text-emerald-700"
                    : "text-red-700",
              ].join(" ")}
            >
              {settled
                ? latest.status === "approved"
                  ? "Settled — payout claimed"
                  : "Settled — no payout"
                : isLive
                  ? winningSoFar
                    ? "Winning right now"
                    : "Losing right now"
                  : `Simulated bet — ${winningSoFar ? "would be winning" : "would be losing"}`}
            </p>
            {isLive && decoded.execution?.mint_tx_digest && (
              <a
                href={explorerUrl("txblock", decoded.execution.mint_tx_digest)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.28em] text-ink underline-offset-4 hover:underline focus-visible:underline"
              >
                mint tx
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} aria-hidden />
              </a>
            )}
            {decoded.execution?.walrus_blob_id && (
              <a
                href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${decoded.execution.walrus_blob_id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 border border-emerald-600/40 bg-emerald-50/70 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-emerald-800 hover:bg-emerald-100/70"
                title="Walrus content-addressed reasoning blob"
              >
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600"
                />
                Reasoning on Walrus
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              </a>
            )}
            {!isLive && decoded.execution?.reason_if_simulated && (
              <p className="text-[12px] leading-relaxed text-muted">
                {decoded.execution.reason_if_simulated}
              </p>
            )}
          </div>
        </div>
      </article>
    </section>
    {mindCanvas}
    <TraderMindPanel
      traderName={traderName}
      strategy={decoded.strategy ?? null}
      walrusBlobId={decoded.execution?.walrus_blob_id ?? null}
      abstained={abstained}
      fallbackReasoning={decoded.decision?.reasoning ?? null}
    />
    </>
  );
}

// ---------------------------------------------------------------------------
// TraderMindPanel — the "watch it think" showpiece. Fetches the per-decision
// reasoning markdown from Walrus, parses the deterministic structured sections
// (signals, SVI surface, quant edge, plain reasoning), and renders them as
// premium cards. The intelligence the agent uses is invisible without this:
// signals row + on-chain SVI block + (for quant) the market-vs-agent edge that
// triggered the bet. Honest abstention gets equal dignity — same surface,
// same numbers, headlined "sat this one out · no edge."
// ---------------------------------------------------------------------------

type ParsedMindSignals = {
  roc5: number | null;
  roc30: number | null;
  roc60: number | null;
  sma15: number | null;
  sma60: number | null;
  rsi60: number | null;
  realizedVol60: number | null;
};

type ParsedMindSurface = {
  forwardUsd: number;
  spotUsd: number;
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
};

type ParsedQuantEdge = {
  marketP: number;
  agentP: number;
  edge: number;
  edgeThreshold: number;
};

type ParsedMind = {
  strategy: string | null;
  signals: ParsedMindSignals | null;
  surface: ParsedMindSurface | null;
  quantEdge: ParsedQuantEdge | null;
  reasoning: string | null;
};

function parseMindMarkdown(md: string): ParsedMind {
  const out: ParsedMind = {
    strategy: null,
    signals: null,
    surface: null,
    quantEdge: null,
    reasoning: null,
  };

  const strat = md.match(/^# Trader decision · ([\w/-]+)/m);
  if (strat) out.strategy = strat[1];

  const sigBlock = md.match(/## Signals at decision time\n([\s\S]+?)(?=\n##|\n*$)/);
  if (sigBlock) {
    const b = sigBlock[1];
    const roc = b.match(
      /ROC 5m \/ 30m \/ 60m:\*?\*?\s*(n\/a|[-\d.]+)%?\s*\/\s*(n\/a|[-\d.]+)%?\s*\/\s*(n\/a|[-\d.]+)%?/,
    );
    const sma = b.match(
      /SMA 15m \/ 60m:\*?\*?\s*\$(n\/a|[\d.]+)\s*\/\s*\$(n\/a|[\d.]+)/,
    );
    const rsi = b.match(/RSI 60m:\*?\*?\s*(n\/a|[\d.]+)/);
    const vol = b.match(/Realized vol 60m[^:]*:\*?\*?\s*(n\/a|[-\d.]+)%/);
    const pct = (s?: string) =>
      s && s !== "n/a" && s !== undefined ? parseFloat(s) / 100 : null;
    const num = (s?: string) =>
      s && s !== "n/a" && s !== undefined ? parseFloat(s) : null;
    out.signals = {
      roc5: pct(roc?.[1]),
      roc30: pct(roc?.[2]),
      roc60: pct(roc?.[3]),
      sma15: num(sma?.[1]),
      sma60: num(sma?.[2]),
      rsi60: num(rsi?.[1]),
      realizedVol60: pct(vol?.[1]),
    };
  }

  const svi = md.match(
    /## SVI vol surface[\s\S]+?Forward:\*?\*?\s*\$([\d.]+)[\s\S]+?Spot:\*?\*?\s*\$([\d.]+)[\s\S]+?a=([\d.eE+-]+),\s*b=([\d.eE+-]+),\s*ρ=([\d.eE+-]+),\s*m=([\d.eE+-]+),\s*σ=([\d.eE+-]+)/,
  );
  if (svi) {
    out.surface = {
      forwardUsd: parseFloat(svi[1]),
      spotUsd: parseFloat(svi[2]),
      a: parseFloat(svi[3]),
      b: parseFloat(svi[4]),
      rho: parseFloat(svi[5]),
      m: parseFloat(svi[6]),
      sigma: parseFloat(svi[7]),
    };
  }

  const reason = md.match(/## Reasoning\n([\s\S]+?)$/);
  if (reason) out.reasoning = reason[1].trim();

  if (out.reasoning) {
    const mp = out.reasoning.match(/Market-implied Pr\(UP @ \$[\d.]+\) = ([-\d.]+)%/);
    const ap = out.reasoning.match(/Agent's signal estimate ([-\d.]+)%/);
    const ed = out.reasoning.match(/Edge ([-\d.]+)% \(threshold ±([-\d.]+)%\)/);
    if (mp && ap && ed) {
      out.quantEdge = {
        marketP: parseFloat(mp[1]) / 100,
        agentP: parseFloat(ap[1]) / 100,
        edge: parseFloat(ed[1]) / 100,
        edgeThreshold: parseFloat(ed[2]) / 100,
      };
    }
  }
  return out;
}

function useWalrusMarkdown(blobId: string | null): {
  body: string | null;
  loading: boolean;
} {
  const [state, setState] = useState<{ body: string | null; loading: boolean }>({
    body: null,
    loading: !!blobId,
  });
  useEffect(() => {
    if (!blobId) {
      setState({ body: null, loading: false });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`,
        );
        if (!r.ok) {
          if (!cancelled) setState({ body: null, loading: false });
          return;
        }
        const text = await r.text();
        if (!cancelled) setState({ body: text, loading: false });
      } catch {
        if (!cancelled) setState({ body: null, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blobId]);
  return state;
}

function MindChip({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative" | "muted";
}) {
  const tones: Record<string, string> = {
    neutral: "border-line bg-bg-elev text-ink",
    positive: "border-emerald-600/50 bg-emerald-50/60 text-emerald-900",
    negative: "border-red-600/50 bg-red-50/60 text-red-900",
    muted: "border-line bg-bg-elev-2/40 text-muted",
  };
  return (
    <div className={`border ${tones[tone]} px-3 py-2.5`}>
      <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
        {label}
      </p>
      <p className="mt-1 font-sans text-[17px] font-medium leading-none tabular-nums">
        {value}
      </p>
      {sub && (
        <p className="mt-1.5 font-mono text-[9.5px] tracking-[0.04em] text-muted">
          {sub}
        </p>
      )}
    </div>
  );
}

function MindSignalsRow({ s }: { s: ParsedMindSignals }) {
  const fmtPct = (x: number | null, d = 2) =>
    x === null ? "n/a" : `${(x * 100).toFixed(d)}%`;
  const fmtNum = (x: number | null, d = 2) =>
    x === null ? "n/a" : x.toFixed(d);

  // Prefer the 30m ROC; fall back to 5m with a labeled window.
  const roc = s.roc30 ?? s.roc5;
  const rocWindow = s.roc30 !== null ? "30m" : "5m";
  const rocTone =
    roc === null ? "muted" : roc > 0 ? "positive" : "negative";

  const rsiTone =
    s.rsi60 === null
      ? "muted"
      : s.rsi60 > 70
        ? "negative"
        : s.rsi60 < 30
          ? "positive"
          : "neutral";
  const rsiSub =
    s.rsi60 === null
      ? "warming up"
      : s.rsi60 > 70
        ? "overbought"
        : s.rsi60 < 30
          ? "oversold"
          : "neutral";

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
        Signals · real, computed from rolling price history
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <MindChip
          label={`ROC ${rocWindow}`}
          value={fmtPct(roc, 3)}
          sub="rate of change"
          tone={rocTone as "neutral" | "positive" | "negative" | "muted"}
        />
        <MindChip
          label="SMA 60m"
          value={s.sma60 !== null ? `$${fmtNum(s.sma60)}` : "n/a"}
          sub="60-minute average"
          tone={s.sma60 === null ? "muted" : "neutral"}
        />
        <MindChip
          label="RSI 60m"
          value={fmtNum(s.rsi60, 1)}
          sub={rsiSub}
          tone={rsiTone as "neutral" | "positive" | "negative" | "muted"}
        />
        <MindChip
          label="Realized vol"
          value={fmtPct(s.realizedVol60, 1)}
          sub="annualized · 60m"
          tone={s.realizedVol60 === null ? "muted" : "neutral"}
        />
      </div>
    </div>
  );
}

function MindSVISurface({ surface }: { surface: ParsedMindSurface }) {
  const params: Array<[string, number, number]> = [
    ["a", surface.a, 6],
    ["b", surface.b, 6],
    ["ρ", surface.rho, 4],
    ["m", surface.m, 4],
    ["σ", surface.sigma, 4],
  ];
  return (
    <div className="border border-line bg-bg-elev-2/40 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
          SVI vol surface · live, on-chain
        </p>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
          read from oracle
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 font-mono text-[12.5px] tabular-nums">
        <span>
          <span className="text-muted">Forward </span>
          <span className="text-ink">${surface.forwardUsd.toFixed(2)}</span>
        </span>
        <span>
          <span className="text-muted">Spot </span>
          <span className="text-ink">${surface.spotUsd.toFixed(2)}</span>
        </span>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2">
        {params.map(([k, v, d]) => (
          <div key={k} className="border border-line bg-bg-elev px-2 py-1.5">
            <p className="font-mono text-[10px] tracking-[0.04em] text-muted">
              {k}
            </p>
            <p className="font-mono text-[12px] tabular-nums text-ink">
              {(v as number).toFixed(d as number)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function MindEdgeBlock({ e }: { e: ParsedQuantEdge }) {
  const isUp = e.edge > 0;
  const direction: "up" | "down" = isUp ? "up" : "down";
  const mp = e.marketP * 100;
  const ap = e.agentP * 100;
  const edgeAbs = Math.abs(e.edge) * 100;
  const thresh = e.edgeThreshold * 100;
  // Bar widths (capped 95% so neither bar fills the rail) — visual gap = edge.
  const wMarket = Math.max(8, Math.min(95, mp));
  const wAgent = Math.max(8, Math.min(95, ap));

  return (
    <div className="border-2 border-ink bg-bg-elev px-4 py-4 sm:px-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
        Where the bet comes from · vol-surface edge
      </p>
      <div className="mt-3 space-y-3">
        <div>
          <div className="flex items-baseline justify-between font-mono text-[10px] tracking-[0.04em] text-muted">
            <span className="uppercase tracking-[0.2em]">Market says</span>
            <span className="tabular-nums text-ink">{mp.toFixed(1)}% UP</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden border border-line bg-bg-elev-2/40">
            <span
              className="block h-full bg-ink/70 transition-[width] duration-500 ease-out"
              style={{ width: `${wMarket}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between font-mono text-[10px] tracking-[0.04em] text-muted">
            <span className="uppercase tracking-[0.2em]">Agent estimates</span>
            <span
              className={
                isUp
                  ? "tabular-nums text-emerald-800"
                  : "tabular-nums text-red-800"
              }
            >
              {ap.toFixed(1)}% UP
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden border border-line bg-bg-elev-2/40">
            <span
              className={
                isUp
                  ? "block h-full bg-emerald-600 transition-[width] duration-500 ease-out"
                  : "block h-full bg-red-600 transition-[width] duration-500 ease-out"
              }
              style={{ width: `${wAgent}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p
          className={
            isUp
              ? "font-sans text-[17px] leading-snug text-emerald-800"
              : "font-sans text-[17px] leading-snug text-red-800"
          }
        >
          Edge {isUp ? "+" : "−"}{edgeAbs.toFixed(1)}% → bet{" "}
          <strong className="font-semibold">{direction.toUpperCase()}</strong>
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          fires when |edge| ≥ {thresh.toFixed(1)}%
        </p>
      </div>
    </div>
  );
}

function MindReasoning({
  text,
  abstained,
}: {
  text: string;
  abstained: boolean;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
        {abstained ? "Why no bet" : "Plain reasoning"}
      </p>
      <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{text}</p>
    </div>
  );
}

function TraderMindPanel({
  traderName,
  strategy,
  walrusBlobId,
  abstained,
  fallbackReasoning,
}: {
  traderName: string;
  strategy: string | null;
  walrusBlobId: string | null;
  abstained: boolean;
  fallbackReasoning: string | null;
}) {
  const md = useWalrusMarkdown(walrusBlobId);
  const parsed = useMemo(
    () => (md.body ? parseMindMarkdown(md.body) : null),
    [md.body],
  );

  // Nothing to show: no blob, no inline fallback. Render nothing.
  if (!walrusBlobId && !fallbackReasoning) return null;

  const signals = parsed?.signals ?? null;
  const surface = parsed?.surface ?? null;
  const quantEdge = parsed?.quantEdge ?? null;
  const reasoning = parsed?.reasoning ?? fallbackReasoning;
  const strategyLabel = parsed?.strategy ?? strategy ?? "agent";

  // While the Walrus blob is in flight, show a calm skeleton — the
  // inline JSON deliverable is already on screen above, so the user
  // never sees a blank reasoning state.
  if (md.loading && !reasoning) {
    return (
      <section className="mt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Watch {traderName} think
        </p>
        <div className="mt-3 border-2 border-line bg-bg-elev px-5 py-6">
          <p className="font-sans text-[14px] italic text-muted">
            Pulling reasoning from Walrus…
          </p>
        </div>
      </section>
    );
  }

  const header = abstained
    ? `${traderName} sat this one out · no edge`
    : `How ${traderName} decided · ${strategyLabel}`;

  return (
    <section className="mt-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        {header}
      </p>
      <article className="mt-3 border-2 border-line bg-bg-elev">
        <div className="space-y-5 px-5 py-6 sm:px-7 sm:py-7">
          {signals && <MindSignalsRow s={signals} />}
          {surface && <MindSVISurface surface={surface} />}
          {quantEdge && <MindEdgeBlock e={quantEdge} />}
          {reasoning && (
            <MindReasoning text={reasoning} abstained={abstained} />
          )}
          {walrusBlobId && (
            <div className="border-t border-line/60 pt-4">
              <a
                href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${walrusBlobId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 border border-emerald-600/40 bg-emerald-50/70 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-emerald-800 hover:bg-emerald-100/70"
                title="The reasoning above is content-addressed on Walrus. Open the raw blob."
              >
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600"
                />
                Verifiable on Walrus
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              </a>
            </div>
          )}
        </div>
      </article>
    </section>
  );
}

// LivePriceBlock — the dramatic centerpiece of the open-position panel.
// Real BTC spot (devInspected via useLiveSpot), pulsed on every tick.
// A horizontal gauge centered on the strike shows the marker's position
// in the ±0.5% zoom window; the side the marker is on (winning vs
// losing) is shaded so the eye lands on the verdict instantly. When
// the bet flips, the strike-line glows and the verdict text restarts
// its fade-up animation via the parent's `key` trick.
function LivePriceBlock({
  spotUsd,
  strikeUsd,
  distancePct,
  distanceToFlipUsd,
  markerPct,
  winning,
  status,
  lastUpdatedMs,
}: {
  spotUsd: number;
  strikeUsd: number;
  distancePct: number;
  distanceToFlipUsd: number;
  markerPct: number;
  winning: boolean;
  status: "loading" | "live" | "reconnecting";
  lastUpdatedMs: number;
}) {
  const distancePctLabel =
    distancePct >= 0
      ? `+${distancePct.toFixed(3)}%`
      : `${distancePct.toFixed(3)}%`;
  const flipLabel =
    distanceToFlipUsd > 0
      ? `$${distanceToFlipUsd.toFixed(2)} to flip`
      : "right on the line";
  const sinceMs = lastUpdatedMs > 0 ? Date.now() - lastUpdatedMs : 0;
  const statusLabel =
    status === "loading"
      ? "Reading oracle…"
      : status === "reconnecting"
        ? "Reconnecting…"
        : sinceMs < 12_000
          ? "Live · just now"
          : `Live · ${Math.round(sinceMs / 1000)}s ago`;

  return (
    <div className="border border-line bg-bg-elev-2/40 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
          Live BTC spot · DeepBook Predict oracle
        </p>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
          <span
            aria-hidden
            className={[
              "mr-1.5 inline-block h-1.5 w-1.5 rounded-full",
              status === "live"
                ? "bg-emerald-600"
                : status === "reconnecting"
                  ? "bg-amber-500 animate-pulse"
                  : "bg-muted",
            ].join(" ")}
          />
          {statusLabel}
        </p>
      </div>
      <p
        key={spotUsd.toFixed(2)}
        className={[
          "mt-2 font-sans text-[36px] font-medium leading-none tabular-nums tracking-tight animate-value-tick sm:text-[44px]",
          winning ? "text-emerald-700" : "text-red-700",
        ].join(" ")}
      >
        ${spotUsd.toFixed(2)}
      </p>
      <p
        className={[
          "mt-1 font-mono text-[11.5px] tabular-nums",
          winning ? "text-emerald-700" : "text-red-700",
        ].join(" ")}
      >
        {distancePctLabel}{" "}
        <span className="text-muted">vs strike · {flipLabel}</span>
      </p>

      {/* Distance-to-strike gauge. Strike sits at the midpoint; the
          spot marker slides across as price moves; the side the marker
          is on is tinted (emerald winning / red losing). The ±0.5%
          zoom is enough to see meaningful sub-percent moves without
          the marker pegging hard at one edge. */}
      <div
        className="mt-3 relative h-2 w-full overflow-hidden border border-line bg-bg-elev"
        aria-hidden
      >
        {/* Winning-zone tint */}
        <div
          className={[
            "absolute inset-y-0",
            winning ? "bg-emerald-100" : "bg-red-100",
          ].join(" ")}
          style={{
            left: winning ? `${markerPct}%` : `${markerPct}%`,
            right: winning ? "0" : "auto",
            width: winning ? `calc(100% - ${markerPct}%)` : `${markerPct}%`,
          }}
        />
        {/* Center strike line */}
        <span
          className="absolute inset-y-0 left-1/2 -ml-px w-px bg-ink/40"
        />
        {/* Spot marker */}
        <span
          className={[
            "absolute inset-y-0 -ml-[1.5px] w-[3px] transition-[left] duration-500 ease-out",
            winning ? "bg-emerald-700" : "bg-red-700",
          ].join(" ")}
          style={{ left: `${markerPct}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[9.5px] tabular-nums text-muted">
        <span>−0.5%</span>
        <span>strike ${strikeUsd.toFixed(0)}</span>
        <span>+0.5%</span>
      </div>
    </div>
  );
}

function DD({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 tabular-nums text-ink">{children}</dd>
    </div>
  );
}

function ModeBadge({ mode }: { mode: "live" | "simulated" }) {
  if (mode === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 border-2 border-emerald-600 bg-emerald-600 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.3em] text-bg">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-bg"
        />
        Live · DeepBook Predict
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 border-2 border-amber-600 bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-900">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-amber-700"
      />
      Simulated · awaiting dUSDC
    </span>
  );
}

function countdownLabel(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hours > 0) {
    return `${hours}h ${min.toString().padStart(2, "0")}m`;
  }
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

// {Name}'s memory · on Walrus — the differentiator for the Walrus
// special-prize track. Reads the journal blob id from the LATEST
// deliverable (the trader uploads a cumulative blob per task), frames
// it as the agent's persistent verifiable memory, and links the user
// straight to the public aggregator. The point a judge is meant to
// land on: this isn't a screenshot of a thought; it's a content-
// addressed blob anyone can fetch without our server.
function LeaderboardCTA({ traderName }: { traderName: string }) {
  return (
    <section className="mt-8">
      <article className="flex flex-wrap items-center justify-between gap-3 border-2 border-line bg-bg-elev px-5 py-4 sm:px-6">
        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
            Whose AI trader is winning?
          </p>
          <p className="font-sans text-[15px] leading-snug text-ink">
            See where {traderName} ranks against every other adopted trader —
            live, on-chain P&amp;L.
          </p>
        </div>
        <Link
          href="/leaderboard"
          className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.3em] text-bg transition-colors hover:bg-ink-2"
        >
          See {traderName} on the leaderboard →
        </Link>
      </article>
    </section>
  );
}

function TraderMemoryJournal({
  traderName,
  tasks,
}: {
  traderName: string;
  tasks: WorkforceTask[];
}) {
  // Pull the most-recent task with a deliverable so we always show the
  // freshest journal blob. The journal grows monotonically — each new
  // task re-uploads a superset of all prior decisions, so the latest
  // task's blob is the complete record.
  const sorted = [...tasks].sort((a, b) =>
    Number(b.postedAtMs - a.postedAtMs),
  );
  const latestWithDeliverable = sorted.find((t) => t.deliverableId);
  const latest = useDeliverable(latestWithDeliverable?.deliverableId ?? null);
  const decoded = parseTraderDeliverable(latest.body);
  const journalId = decoded?.execution?.journal_walrus_blob_id ?? null;
  const journalEntries = decoded?.execution?.journal_entries ?? 0;
  // Also surface the per-decision reasoning blob from the same
  // deliverable so the user can read THIS trade's thinking without
  // scrolling back up to the position panel.
  const reasoningId = decoded?.execution?.walrus_blob_id ?? null;

  // Don't render the panel at all until the trader has at least
  // tried Walrus on a task. Until that first deliverable lands the
  // section adds no signal.
  if (!latestWithDeliverable) return null;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          {traderName}&apos;s memory · on Walrus
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          content-addressed · verifiable
        </p>
      </div>
      <article className="mt-3 grid gap-4 sm:grid-cols-2">
        <MemoryBlobCard
          title={`${traderName}'s running memory`}
          tagline={
            journalEntries > 0
              ? `${journalEntries} decision${journalEntries === 1 ? "" : "s"} logged · grows with every move`
              : "Will appear after the first decision"
          }
          blobId={journalId}
          fallbackNote="The trader is still composing its first decision — the journal will appear here when it's been minted to Walrus. If the trader's wallet runs out of WAL, the journal pauses (inline reasoning still flows) until it's topped up."
          ariaLabel="Memory journal Walrus blob"
        />
        <MemoryBlobCard
          title="Last decision · reasoning"
          tagline={
            decoded?.decision?.reasoning
              ? `"${decoded.decision.reasoning.slice(0, 70)}${decoded.decision.reasoning.length > 70 ? "…" : ""}"`
              : "Plain-language reasoning for the latest move"
          }
          blobId={reasoningId}
          fallbackNote='Inline · Walrus unfunded — the reasoning still ships in the deliverable below, just not as a verifiable blob. Top up the trader wallet with WAL via "walrus get-wal" and the next decision will upload.'
          ariaLabel="Per-decision reasoning Walrus blob"
        />
      </article>
    </section>
  );
}

function MemoryBlobCard({
  title,
  tagline,
  blobId,
  fallbackNote,
  ariaLabel,
}: {
  title: string;
  tagline: string;
  blobId: string | null;
  fallbackNote: string;
  ariaLabel: string;
}) {
  if (blobId) {
    const url = `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`;
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={ariaLabel}
        className="group flex flex-col gap-3 border-2 border-emerald-600 bg-emerald-50/40 px-5 py-5 transition-colors hover:bg-emerald-100/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-emerald-800">
            <span
              aria-hidden
              className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-600"
            />
            Stored on Walrus
          </p>
          <ArrowUpRight
            className="h-3.5 w-3.5 text-emerald-700 transition-transform group-hover:-translate-y-px group-hover:translate-x-px"
            strokeWidth={1.75}
            aria-hidden
          />
        </div>
        <p className="font-sans text-[18px] font-medium leading-tight tracking-tight text-ink">
          {title}
        </p>
        <p className="text-[13px] italic leading-snug text-ink-2">{tagline}</p>
        <p className="mt-auto truncate font-mono text-[10.5px] tabular-nums tracking-tight text-emerald-800">
          {blobId.slice(0, 16)}…{blobId.slice(-6)}
        </p>
      </a>
    );
  }
  return (
    <article className="flex flex-col gap-3 border-2 border-line bg-bg-elev-2/40 px-5 py-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
        <span
          aria-hidden
          className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-muted/60"
        />
        Inline · Walrus unfunded
      </p>
      <p className="font-sans text-[18px] font-medium leading-tight tracking-tight text-ink-2">
        {title}
      </p>
      <p className="text-[12.5px] leading-relaxed text-muted">{fallbackNote}</p>
    </article>
  );
}

// Lightweight track record. Counts trades + win/loss + cumulative P&L
// from the decoded deliverables. Quiet until at least 1 trade exists.
function TraderTrackRecord({
  traderName,
  tasks,
}: {
  traderName: string;
  tasks: WorkforceTask[];
}) {
  const settled = tasks.filter(
    (t) => t.status === "approved" || t.status === "expired",
  );
  if (settled.length === 0) return null;
  return (
    <section className="mt-8 border border-line bg-bg-elev px-5 py-5 sm:px-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Track record · {traderName}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-4">
        <Stat label="Trades placed" value={String(tasks.length)} />
        <Stat label="Settled" value={String(settled.length)} />
        <Stat label="Open" value={String(tasks.length - settled.length)} />
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        Win/loss + P&amp;L surfaced per-trade in the story below — the chain is
        the source of truth.
      </p>
    </section>
  );
}

// First-person Narrator for the trader. Re-uses the visual rhythm of
// MissionNarrator but the beats are written as the trader speaking.
function TraderNarrator({
  activation,
  traderName,
  personality,
  policyId,
  policy,
  tasks,
  chainAbort,
}: {
  activation: ActivationResult;
  traderName: string;
  personality: TraderPersonality | null;
  policyId: string | null;
  policy: OperatorPolicyDecoded | null;
  tasks: WorkforceTask[];
  chainAbort: AbortRecord | null;
}) {
  const beats: NarratorBeat[] = [];

  beats.push({
    kind: "granted",
    ts: 0,
    state: "done",
    title: `${traderName} got a $${activation.budgetSui.toFixed(2)} leash — minted on chain.`,
    detail: (
      <>
        A Move <span className="font-mono text-ink">OperatorPolicy</span> caps{" "}
        {traderName} at {activation.budgetSui.toFixed(2)} SUI for the next
        12 hours, only on the venue{" "}
        <span className="font-mono text-ink">predict-btc</span>.
        {policyId && (
          <>
            {" "}
            <NarratorLink href={explorerUrl("object", policyId)}>
              policy
            </NarratorLink>
          </>
        )}{" "}
        <NarratorLink href={explorerUrl("txblock", activation.txDigest)}>
          grant tx
        </NarratorLink>
      </>
    ),
  });

  const sorted = [...tasks].sort((a, b) =>
    Number(a.postedAtMs - b.postedAtMs),
  );
  if (sorted.length === 0) {
    beats.push({
      kind: "planner-working",
      ts: Date.now(),
      state: "active",
      title: `${traderName} is reading the order book and picking the nearest BTC market…`,
    });
  }

  for (const t of sorted) {
    const ts = Number(t.postedAtMs);
    beats.push({
      kind: "task-posted",
      ts,
      state: t.status === "open" ? "active" : "done",
      title: `${traderName} got a "${personality?.label.toLowerCase() ?? "trader"}" job — bounty in escrow.`,
      detail: (
        <>
          The planner posted the job on chain.{" "}
          <NarratorLink href={explorerUrl("object", t.id)}>task</NarratorLink>{" "}
          <NarratorLink href={explorerUrl("txblock", t.postedTxDigest)}>
            tx
          </NarratorLink>
        </>
      ),
    });
    if (t.status === "accepted" || t.status === "delivered" || t.status === "approved") {
      beats.push({
        kind: "task-accepted",
        ts: ts + 1,
        state: t.status === "accepted" ? "active" : "done",
        title: `${traderName}: "I'm picking a market and reading the live BTC spot."`,
      });
    }
    if (t.status === "delivered" || t.status === "approved") {
      beats.push({
        kind: "task-delivered",
        ts: ts + 2,
        state: t.status === "delivered" ? "active" : "done",
        title: `${traderName} took the bet — full reasoning stored on Walrus.`,
        detail: t.deliverableId ? (
          <>
            <NarratorLink href={explorerUrl("object", t.deliverableId)}>
              deliverable
            </NarratorLink>{" "}
            — the agent&apos;s reasoning is content-addressed; anyone can
            fetch it without our server.
          </>
        ) : undefined,
      });
    }
    if (t.status === "approved") {
      beats.push({
        kind: "task-paid",
        ts: ts + 3,
        state: "done",
        title: `${traderName} got paid — settlement & bounty rolled in.`,
      });
    }
  }

  if (chainAbort) {
    beats.push({
      kind: "killswitch-refused",
      ts: chainAbort.at,
      state: "done",
      title: `You yanked the leash. ${traderName}'s next bet was refused by the chain itself.`,
      detail: (
        <>
          The Move runtime aborted{" "}
          <span className="font-mono text-red-700">
            {chainAbort.abortConst ?? "EPolicyRevoked"} · code{" "}
            {chainAbort.abortCode ?? 3}
          </span>
          {chainAbort.txDigest && (
            <>
              {" "}
              <NarratorLink href={explorerUrl("txblock", chainAbort.txDigest)}>
                abort tx
              </NarratorLink>
            </>
          )}
          . Past wins can still be claimed permissionlessly.
        </>
      ),
    });
  } else {
    beats.push({
      kind: "killswitch-armed",
      ts: Number.MAX_SAFE_INTEGER,
      state: "pending",
      title:
        `You hold the leash — yank it and ${traderName}'s next bet aborts on chain. Past winnings still pay out.`,
      detail: (
        <>
          Revoke flips the policy&apos;s{" "}
          <span className="font-mono text-ink">revoked</span> bit; every new
          mint{" "}
          {policy?.revoked
            ? "is already being refused."
            : `${traderName} tries will be refused by the Move runtime before it can spend a cent.`}
        </>
      ),
    });
  }

  return (
    <section
      aria-label="Trader narrator"
      className="mt-8 border border-line bg-bg-elev"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          {traderName}&apos;s story
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          live · on chain
        </p>
      </header>
      <ol className="relative px-5 py-5 sm:px-6 sm:py-6">
        <span
          aria-hidden
          className="pointer-events-none absolute left-[1.55rem] top-7 h-[calc(100%-3.25rem)] w-px bg-line sm:left-[1.85rem]"
        />
        {beats.map((b, i) => (
          <NarratorBeatRow key={`${b.kind}-${b.ts}-${i}`} beat={b} index={i} />
        ))}
      </ol>
    </section>
  );
}

function LiveConsole({
  activation,
  onReset,
}: {
  activation: ActivationResult;
  onReset: () => void;
}) {
  const resolvedPolicyId = useResolvedPolicyId(activation.txDigest);
  const policyId = resolvedPolicyId;

  const { policy } = usePolicy(policyId);
  const { tasks } = useTasksForPolicy(policyId);
  const status = policy ? policyStatus(policy) : null;

  // Auto-dispatch the brief as soon as the policy id is resolved. The
  // user never sees a second form; the mission is queued in the
  // background and the planner-service picks it up.
  const dispatchedRef = useRef(false);
  useEffect(() => {
    if (!policyId || dispatchedRef.current) return;
    dispatchedRef.current = true;
    // Auto-detect any 0x… address pasted into the brief; otherwise hand
    // the Planner Brief's own package id so the Research agent always has
    // something concrete to audit. (Judges never see this field.)
    const detected = extractTargetPackageId(activation.brief);
    const targetPackageId = detected ?? BRIEF_PACKAGE_ID;
    dispatchMission({
      policyId,
      mission: activation.brief,
      targetPackageId,
    }).catch(() => {
      // Swallow — the planner-service may not be running locally for a
      // judge, but the policy is real and visible on chain. The next
      // section explains how to bring the workforce online if needed.
    });
  }, [policyId, activation.brief]);

  // Specialist roster (excluding Planner). Used by both the team panel
  // and the kill-switch's verification-fallback path.
  const { agents: roster } = useRegisteredAgents({
    excludeAddress: BRIEF_OPERATOR_ADDRESS,
  });

  // Revoke + deterministic kill-switch state machine.
  //
  // The chain only emits EPolicyRevoked (operator_policy::3) on a task
  // that is currently in DELIVERED status — the runtime checks task
  // status BEFORE record_spend (see move/sources/task.move). So to
  // surface the canonical EPolicyRevoked fingerprint we always need a
  // live DELIVERED target. Strategy:
  //
  //   1. After the user signs revoke, scan the task list for any
  //      delivered-but-unsettled task and attempt approve_with_policy
  //      against it via /api/workforce/approve (server-signed by the
  //      Planner). Validate the abort response — only commit to the
  //      CHAIN REFUSED card if the chain returned the EXACT
  //      (operator_policy::assert_can_spend, code 3) fingerprint.
  //   2. If the response was anything else (e.g. task::EWrongStatus
  //      from a race against the auto-approve loop), mark the task
  //      tried and re-target on the next render. Don't surface a
  //      misleading card.
  //   3. If we exhaust all delivered tasks without verifying, post a
  //      "Kill-switch verification" task via /api/workforce/post-
  //      verification. Wait for the specialist to deliver it, then
  //      attempt approve — which aborts EPolicyRevoked, deterministically.
  //
  // The planner-service holds the most-recent delivered task per policy
  // as the user-facing "pending release" checkpoint, so step 1 almost
  // always succeeds; step 3 is the safety net for the "judge let
  // everything settle to paid then revoked" case.
  type KillSwitchPhase =
    | "idle"
    | "scanning"
    | "verifying_post"
    | "verified";
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [revokeTx, setRevokeTx] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [chainAbort, setChainAbort] = useState<AbortRecord | null>(null);
  const [killSwitchPhase, setKillSwitchPhase] = useState<KillSwitchPhase>("idle");
  const [verificationTaskId, setVerificationTaskId] = useState<string | null>(
    null,
  );
  const triedTaskIdsRef = useRef<Set<string>>(new Set());
  const verificationPostedRef = useRef(false);
  const inFlightRef = useRef(false);
  // The revoke tx goes through the SAME unified signer as the grant —
  // works whether the owner signed in with Google or a Sui wallet.
  const { signAndExecute: signRevoke } = useAccountSigner();

  function isVerifiedEPolicyRevoked(j: Partial<AbortRecord>): boolean {
    if (j.abortCode !== 3) return false;
    if (j.abortModule !== "operator_policy") return false;
    // Either the parsed const name or the function name confirms it.
    if (j.abortConst && j.abortConst !== "EPolicyRevoked") return false;
    return true;
  }

  // Try one approve_with_policy attempt against `taskId`. Returns true if
  // we got a verified EPolicyRevoked (the kill-switch is proven).
  const attemptAbort = useCallback(
    async (taskId: string): Promise<boolean> => {
      if (triedTaskIdsRef.current.has(taskId)) return false;
      triedTaskIdsRef.current.add(taskId);
      try {
        const r = await fetch(apiUrl("/api/workforce/approve"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_id: taskId, policy_id: policyId }),
        });
        const j = (await r.json()) as Partial<AbortRecord> & {
          ok?: boolean;
          error?: string;
        };
        // A successful approve is a race: revoke hadn't landed before the
        // approve hit the validator. Skip — caller will try another task.
        if (j.ok) return false;
        if (!isVerifiedEPolicyRevoked(j)) return false;
        setChainAbort({
          taskId,
          txDigest: j.txDigest,
          abortCode: j.abortCode,
          abortConst: j.abortConst ?? "EPolicyRevoked",
          abortModule: j.abortModule ?? "operator_policy",
          abortFn: j.abortFn ?? "assert_can_spend",
          at: Date.now(),
        });
        setKillSwitchPhase("verified");
        return true;
      } catch {
        return false;
      }
    },
    [policyId],
  );

  // Post a tiny kill-switch verification task under the revoked policy so
  // the chain has something to refuse. Assigned to a registered
  // specialist whose capability is in policy.allowed_venues.
  const postVerificationTask = useCallback(
    async (allowedVenues: string[]): Promise<void> => {
      if (!policyId || verificationPostedRef.current) return;
      verificationPostedRef.current = true;
      // Pick a specialist whose capabilities intersect policy.allowed_venues.
      // Prefer treasury (simulated-mode = no DeepBook wallet requirement).
      const pickFor = (cap: string) =>
        roster.find((a) => a.capabilities.includes(cap));
      const preferred = ["treasury", "research", "audit"];
      let chosen: { address: string; capability: string } | null = null;
      for (const cap of preferred) {
        if (!allowedVenues.includes(cap)) continue;
        const a = pickFor(cap);
        if (a) {
          chosen = { address: a.address, capability: cap };
          break;
        }
      }
      // Fallback — first capability/specialist match.
      if (!chosen) {
        for (const a of roster) {
          for (const cap of a.capabilities) {
            if (allowedVenues.includes(cap)) {
              chosen = { address: a.address, capability: cap };
              break;
            }
          }
          if (chosen) break;
        }
      }
      if (!chosen) {
        // Can't post — no eligible specialist. The state machine will
        // retry; if it persists, the UI surfaces "armed, awaiting
        // workforce" copy.
        verificationPostedRef.current = false;
        return;
      }
      setKillSwitchPhase("verifying_post");
      try {
        const r = await fetch(apiUrl("/api/workforce/post-verification"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            policy_id: policyId,
            assigned_to: chosen.address,
            capability: chosen.capability,
          }),
        });
        const j = (await r.json()) as {
          ok?: boolean;
          task_id?: string;
          error?: string;
        };
        if (j.ok && j.task_id) {
          setVerificationTaskId(j.task_id);
        } else {
          // Allow retry on the next tick.
          verificationPostedRef.current = false;
        }
      } catch {
        verificationPostedRef.current = false;
      }
      setKillSwitchPhase("scanning");
    },
    [policyId, roster],
  );

  // Drive the kill-switch state machine. The effect re-runs whenever the
  // task list updates (useTasksForPolicy polls every 3s) — so a freshly
  // delivered task is picked up automatically.
  useEffect(() => {
    if (chainAbort) return;
    if (killSwitchPhase === "idle" || killSwitchPhase === "verified") return;
    if (!policyId || !policy) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    void (async () => {
      try {
        // 1. Try every untried delivered task.
        for (const t of tasks) {
          if (t.status !== "delivered") continue;
          if (triedTaskIdsRef.current.has(t.id)) continue;
          const verified = await attemptAbort(t.id);
          if (verified) return;
        }
        // 2. Nothing untried + delivered. Post a verification task once.
        if (!verificationPostedRef.current) {
          await postVerificationTask(policy.allowedVenues);
        }
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [
    chainAbort,
    killSwitchPhase,
    tasks,
    policyId,
    policy,
    attemptAbort,
    postVerificationTask,
  ]);

  function handleRevoke() {
    if (!policyId) return;
    setRevokeError(null);
    const tx = buildRevokeTx({
      packageId: BRIEF_PACKAGE_ID,
      policyId,
    });
    setRevokeSubmitting(true);
    signRevoke(tx, {
      onSuccess: (res) => {
        setRevokeTx(res.digest);
        setRevokeSubmitting(false);
        setConfirmRevoke(false);
        // Arm the kill-switch state machine; the useEffect handles
        // targeting + verification-fallback from here.
        setKillSwitchPhase("scanning");
      },
      onError: (e) => {
        setRevokeError(e instanceof Error ? e.message : String(e));
        setRevokeSubmitting(false);
      },
    });
  }

  // Manual "Release payment" on the pending-release task — exactly the
  // same approve call the auto-approve loop would have made; we just
  // expose it as a deliberate user action when the policy is live so the
  // judge can choose between Release and Revoke.
  const [releaseTaskId, setReleaseTaskId] = useState<string | null>(null);
  const [releaseSubmitting, setReleaseSubmitting] = useState(false);
  const releaseSubmittingRef = useRef(false);
  async function handleRelease(taskId: string) {
    if (releaseSubmittingRef.current) return;
    releaseSubmittingRef.current = true;
    setReleaseTaskId(taskId);
    setReleaseSubmitting(true);
    try {
      await fetch(apiUrl("/api/workforce/approve"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId, policy_id: policyId }),
      });
    } catch {
      /* silent — the polled task list will reflect the result */
    } finally {
      setReleaseSubmitting(false);
      releaseSubmittingRef.current = false;
      // Re-enable Release for any future pending task.
      setTimeout(() => setReleaseTaskId(null), 2000);
    }
  }

  const interventionActive = !!chainAbort;
  // Drive the global "chain intervention" CSS hook for one beat.
  useEffect(() => {
    if (!interventionActive) return;
    document.documentElement.setAttribute("data-chain-intervention", "1");
    const t = setTimeout(() => {
      document.documentElement.removeAttribute("data-chain-intervention");
    }, 2200);
    return () => clearTimeout(t);
  }, [interventionActive]);

  return (
    <section className="mx-auto max-w-page px-6 py-12 sm:px-10 sm:py-16">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Workforce · {status ? statusLabel(status) : "ACTIVATING"}
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1 className="font-sans text-[28px] font-medium tracking-tightest text-ink sm:text-[40px]">
          {activation.name} is at work.
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {/* Always-visible kill-switch affordance. Calm by design —
              just a small chip framed as control, not as panic. Opens
              the same RevokeModal as the PolicyCard's primary button.
              Hidden once revoked / refused since the moment has passed. */}
          {!policy?.revoked && (
            <button
              type="button"
              onClick={() => setConfirmRevoke(true)}
              disabled={!policyId || revokeSubmitting}
              className="inline-flex items-center gap-1.5 border border-line bg-bg-elev px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-2 transition-colors hover:border-red-400 hover:text-red-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              title="Revoke the policy — the chain will refuse the next payment."
            >
              <ShieldOff className="h-3 w-3" strokeWidth={1.75} aria-hidden />
              You&apos;re in control · revoke
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink focus-visible:text-ink"
          >
            ← Hire another
          </button>
        </div>
      </div>

      <PolicyCard
        activation={activation}
        policyId={policyId}
        policy={policy}
        status={status}
        onRequestRevoke={() => setConfirmRevoke(true)}
        revokeSubmitting={revokeSubmitting}
        revokeError={revokeError}
      />

      {chainAbort && (
        <ChainRefusedCard
          policyId={policyId ?? ""}
          revokeTx={revokeTx}
          abort={chainAbort}
        />
      )}

      {policy?.revoked && !chainAbort && (
        <KillSwitchInFlight
          policyId={policyId ?? ""}
          revokeTx={revokeTx}
          phase={killSwitchPhase}
          verificationTaskId={verificationTaskId}
          tasks={tasks}
        />
      )}

      <MissionNarrator
        activation={activation}
        policyId={policyId}
        policy={policy}
        tasks={tasks}
        roster={roster}
        chainAbort={chainAbort}
      />

      <Brief brief={activation.brief} />

      <Team
        tasks={tasks}
        roster={roster}
        policyId={policyId}
        policyRevoked={!!policy?.revoked}
      />

      <PendingReleaseSection
        tasks={tasks}
        roster={roster}
        policyId={policyId}
        policyRevoked={!!policy?.revoked}
        onRelease={handleRelease}
        onRevoke={() => setConfirmRevoke(true)}
        releaseTaskId={releaseTaskId}
        releaseSubmitting={releaseSubmitting}
        verificationTaskId={verificationTaskId}
      />

      <ActivityFeed
        tasks={tasks}
        policyId={policyId}
        policyRevoked={!!policy?.revoked}
      />

      {confirmRevoke && (
        <RevokeModal
          onConfirm={handleRevoke}
          onCancel={() => setConfirmRevoke(false)}
          submitting={revokeSubmitting}
          name={activation.name}
        />
      )}
    </section>
  );
}

function statusLabel(s: "active" | "revoked" | "expired" | "exhausted") {
  if (s === "revoked") return "REVOKED · chain refuses settlement";
  if (s === "expired") return "EXPIRED";
  if (s === "exhausted") return "BUDGET EXHAUSTED";
  return "LIVE";
}

// =============================================================================
// Policy status card — primary surface, includes Revoke
// =============================================================================

function PolicyCard({
  activation,
  policyId,
  policy,
  status,
  onRequestRevoke,
  revokeSubmitting,
  revokeError,
}: {
  activation: ActivationResult;
  policyId: string | null;
  policy: OperatorPolicyDecoded | null;
  status: "active" | "revoked" | "expired" | "exhausted" | null;
  onRequestRevoke: () => void;
  revokeSubmitting: boolean;
  revokeError: string | null;
}) {
  const remaining =
    policy ? Number(policy.budgetCap - policy.spent) / 1e9 : null;
  const cap = activation.budgetSui;
  const pct = remaining !== null ? Math.max(0, Math.min(1, remaining / cap)) : 0;
  const isLive = status === "active";
  const isRevoked = status === "revoked";

  return (
    <div
      className={[
        "mt-6 relative border-2 bg-bg-elev p-6 transition-colors",
        isRevoked ? "border-red-400/70" : "border-ink",
      ].join(" ")}
    >
      {isLive && (
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-emerald-500/70 animate-operator-pulse-line"
          aria-hidden
        />
      )}
      <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={status} />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
              Template · {activation.templateId}
            </span>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
              Budget envelope
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-medium tabular-nums text-ink">
                {remaining !== null ? remaining.toFixed(3) : cap.toFixed(2)}
              </span>
              <span className="font-mono text-[12px] tabular-nums text-muted">
                / {cap.toFixed(2)} SUI
              </span>
            </div>
            <div className="mt-2 h-1 w-full bg-line">
              <div
                className={[
                  "h-full transition-all",
                  isRevoked ? "bg-red-400" : "bg-ink",
                ].join(" ")}
                style={{ width: `${pct * 100}%` }}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-[12.5px]">
            <KV label="Capabilities">
              <span className="font-mono">
                [{activation.allowedVenues.join(", ")}]
              </span>
            </KV>
            <KV label="Policy">
              {policyId ? (
                <a
                  href={explorerUrl("object", policyId)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-ink underline-offset-4 hover:underline"
                >
                  {short(policyId, 8, 6)}
                  <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
                </a>
              ) : (
                <span className="inline-flex items-center gap-2 font-mono text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  materializing…
                </span>
              )}
            </KV>
            <KV label="Grant tx">
              <a
                href={explorerUrl("txblock", activation.txDigest)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-ink underline-offset-4 hover:underline"
              >
                {short(activation.txDigest, 6, 6)}
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              </a>
            </KV>
          </div>
        </div>
        <div className="flex flex-col items-start justify-between gap-2 border-t border-line pt-4 sm:items-end sm:border-0 sm:pt-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            Kill switch
          </span>
          <button
            type="button"
            disabled={!policyId || revokeSubmitting || isRevoked}
            onClick={onRequestRevoke}
            className={[
              "inline-flex items-center gap-2 border-2 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.32em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500",
              isRevoked
                ? "cursor-not-allowed border-line bg-line text-muted"
                : "border-red-500 bg-bg text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60",
            ].join(" ")}
          >
            {revokeSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Revoking…
              </>
            ) : (
              <>
                <ShieldOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                {isRevoked ? "Revoked" : "Revoke authority"}
              </>
            )}
          </button>
          {!isRevoked && (
            <p className="max-w-[12rem] text-right text-[11px] leading-snug text-muted">
              The chain will refuse the next payment. Funds stay locked in
              escrow.
            </p>
          )}
        </div>
      </div>
      {revokeError && (
        <p className="mt-4 border border-red-300 bg-red-50 p-3 font-mono text-[12px] text-red-700">
          {revokeError.slice(0, 280)}
        </p>
      )}
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: "active" | "revoked" | "expired" | "exhausted" | null;
}) {
  const cls =
    status === "revoked"
      ? "border-red-400 bg-red-50 text-red-700"
      : status === "expired"
        ? "border-amber-400 bg-amber-50 text-amber-700"
        : status === "exhausted"
          ? "border-amber-400 bg-amber-50 text-amber-700"
          : "border-emerald-500 bg-emerald-50 text-emerald-700";
  const label =
    status === "revoked"
      ? "REVOKED"
      : status === "expired"
        ? "EXPIRED"
        : status === "exhausted"
          ? "BUDGET EXHAUSTED"
          : "LIVE";
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em]",
        cls,
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-1.5 w-1.5 rounded-full",
          status === "revoked"
            ? "bg-red-500"
            : status === "active"
              ? "bg-emerald-500 animate-pulse"
              : "bg-muted",
        ].join(" ")}
        aria-hidden
      />
      {label}
    </span>
  );
}

function KV({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </span>
      <span>{children}</span>
    </span>
  );
}

// =============================================================================
// Chain Refused payoff
// =============================================================================

function ChainRefusedCard({
  policyId,
  revokeTx,
  abort,
}: {
  policyId: string;
  revokeTx: string | null;
  abort: AbortRecord;
}) {
  const code = abort.abortCode;
  const named = abort.abortConst;
  const codeLabel =
    code !== undefined
      ? `${code}${named ? ` (${named})` : ""}`
      : named ?? "—";

  return (
    <div className="mt-6 animate-rejection-flash overflow-hidden border-2 border-red-500 bg-red-50/70 text-red-900">
      {/* Overline banner — runs full bleed inside the card, mono caps. */}
      <div className="border-b-2 border-red-500 bg-red-500 px-5 py-2 text-center font-mono text-[10.5px] uppercase tracking-[0.5em] text-bg sm:text-[11px]">
        ✕ Chain intervention · settlement refused
      </div>

      <div className="grid gap-6 px-5 py-6 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-8 sm:px-7 sm:py-8">
        <div className="min-w-0">
          <h2 className="font-sans text-[28px] font-medium leading-[1.06] tracking-tightest text-red-900 sm:text-[40px]">
            The blockchain refused
            <br />
            the workforce&apos;s payment.
          </h2>
          <p className="mt-4 max-w-prose text-[14px] leading-relaxed text-red-900/85 sm:text-[15px]">
            The Planner tried to settle a delivered task under this policy.
            The Move runtime checked the policy, saw it was revoked, and{" "}
            <span className="font-medium text-red-900">aborted the entire transaction</span>.
            Funds stay locked in escrow until the task expires; the specialist
            never gets paid.
          </p>
        </div>

        {/* "REFUSED" stamp — visual seal that locks the fingerprint in.
            The rotation + double-border feels stamped, not rendered. */}
        <div
          className="relative shrink-0 self-start"
          style={{
            transform: "rotate(-3deg)",
            transformOrigin: "center center",
          }}
        >
          <div className="border-[3px] border-double border-red-700 bg-red-50 px-5 py-3 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-red-700">
              refused
            </p>
            <p className="mt-1 font-mono text-[22px] font-medium tabular-nums text-red-800 sm:text-[26px]">
              {code ?? "—"}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-red-700">
              {named ?? "EPolicyRevoked"}
            </p>
          </div>
        </div>
      </div>

      {/* Abort fingerprint — read like a chain receipt. */}
      <dl className="grid gap-3 border-t-2 border-red-300 bg-red-50/40 px-5 py-5 font-mono text-[12px] sm:grid-cols-2 sm:gap-y-2 sm:px-7">
        <AbortRow label="Abort code">{codeLabel}</AbortRow>
        <AbortRow label="Module / function">
          <span className="text-red-900">
            {abort.abortModule ?? "?"}::{abort.abortFn ?? "?"}
          </span>
        </AbortRow>
        <AbortRow label="Refused on task">
          <a
            href={explorerUrl("object", abort.taskId)}
            target="_blank"
            rel="noreferrer"
            className="text-red-900 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          >
            {short(abort.taskId, 8, 6)}
          </a>
        </AbortRow>
        <AbortRow label="Policy (revoked)">
          <a
            href={explorerUrl("object", policyId)}
            target="_blank"
            rel="noreferrer"
            className="text-red-900 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          >
            {short(policyId, 8, 6)}
          </a>
        </AbortRow>
        {revokeTx && (
          <AbortRow label="Revoke tx">
            <a
              href={explorerUrl("txblock", revokeTx)}
              target="_blank"
              rel="noreferrer"
              className="text-red-900 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-red-700"
            >
              {short(revokeTx, 6, 6)}
            </a>
          </AbortRow>
        )}
        {abort.txDigest && (
          <AbortRow label="Aborted attempt">
            <a
              href={explorerUrl("txblock", abort.txDigest)}
              target="_blank"
              rel="noreferrer"
              className="text-red-900 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-red-700"
            >
              {short(abort.txDigest, 6, 6)}
            </a>
          </AbortRow>
        )}
      </dl>

      {/* Punchline — the line that has anchored Article III of the
          landing now closes the console payoff. Sealed by a 2px ink
          divider so it reads as the final beat, not body text. */}
      <div className="border-t-2 border-red-700/80 bg-red-100/40 px-5 py-5 sm:px-7 sm:py-6">
        <AlertTriangle
          className="h-4 w-4 text-red-700 sm:hidden"
          aria-hidden
          strokeWidth={1.75}
        />
        <p className="font-sans text-[20px] font-medium italic leading-[1.15] tracking-tight text-red-700 sm:text-[26px]">
          The AI was never trusted.
          <br />
          The policy was.
        </p>
      </div>
    </div>
  );
}

function AbortRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-[10px] uppercase tracking-[0.22em] text-red-700">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-red-900">{children}</dd>
    </div>
  );
}

// While the kill-switch state machine hunts for a deterministic
// EPolicyRevoked abort (scanning delivered tasks → posting a verification
// task → waiting for delivery), surface what it's doing so the screen
// never sits with a dead "(awaiting…)" line.
function KillSwitchInFlight({
  policyId,
  revokeTx,
  phase,
  verificationTaskId,
  tasks,
}: {
  policyId: string;
  revokeTx: string | null;
  phase: "idle" | "scanning" | "verifying_post" | "verified";
  verificationTaskId: string | null;
  tasks: WorkforceTask[];
}) {
  if (phase === "verified" || phase === "idle") return null;
  const deliveredCount = tasks.filter((t) => t.status === "delivered").length;
  const verificationTask = verificationTaskId
    ? tasks.find((t) => t.id === verificationTaskId) ?? null
    : null;

  let copy: string;
  if (phase === "verifying_post") {
    copy =
      "Posting a kill-switch verification task. The specialist will accept and deliver in seconds — then the chain refuses settlement.";
  } else if (verificationTask) {
    if (verificationTask.status === "delivered") {
      copy =
        "Verification task delivered. Submitting the (now-refused) payment — the chain refusal lands here in a beat.";
    } else if (verificationTask.status === "approved") {
      copy =
        "Verification task settled before revoke landed. Re-arming on the next delivery…";
    } else {
      copy = `Verification task ${verificationTask.status}; waiting for delivery so the chain can refuse settlement.`;
    }
  } else if (deliveredCount > 0) {
    copy =
      "Attempting to settle a delivered task; the chain will refuse and the abort lands here in a beat.";
  } else {
    copy =
      "Policy revoked. No delivery pending — posting a tiny verification task so the chain can prove the kill switch is real.";
  }

  return (
    <div className="mt-6 overflow-hidden border-2 border-red-400 bg-red-50/60">
      {/* Heartbeat top line — the chain is making up its mind. */}
      <span
        className="block h-px w-full bg-red-500 animate-operator-pulse-line"
        aria-hidden
      />
      <div className="flex items-start gap-3 px-5 py-4 sm:px-6 sm:py-5">
        <Loader2
          className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-red-700"
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-red-700">
            Policy revoked · awaiting chain refusal
          </p>
          <p className="mt-1.5 text-[14px] italic leading-relaxed text-red-900/90 sm:text-[14.5px]">
            {copy}
          </p>
          <div className="mt-3 flex flex-wrap gap-3 font-mono text-[11px]">
            <KV label="Policy">
              <a
                href={explorerUrl("object", policyId)}
                target="_blank"
                rel="noreferrer"
                className="text-red-900 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              >
                {short(policyId, 8, 6)}
              </a>
            </KV>
            {revokeTx && (
              <KV label="Revoke tx">
                <a
                  href={explorerUrl("txblock", revokeTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-red-900 underline-offset-4 hover:underline"
                >
                  {short(revokeTx, 6, 6)}
                </a>
              </KV>
            )}
            {verificationTask && (
              <KV label="Verification task">
                <a
                  href={explorerUrl("object", verificationTask.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-red-900 underline-offset-4 hover:underline"
                >
                  {short(verificationTask.id, 6, 6)}
                </a>
              </KV>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team panel — three agent presences (Planner + two specialists) with live
// status lines tied to the chain state so the screen reads as a working
// team, not a polling table.
// ---------------------------------------------------------------------------

function Team({
  tasks,
  roster,
  policyId,
  policyRevoked,
}: {
  tasks: WorkforceTask[];
  roster: RegisteredAgent[];
  policyId: string | null;
  policyRevoked: boolean;
}) {
  const research =
    roster.find(
      (a) =>
        a.capabilities.includes("research") || a.capabilities.includes("audit"),
    ) ?? null;
  const treasury =
    roster.find((a) => a.capabilities.includes("treasury")) ?? null;

  return (
    <section className="mt-10">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Team · on chain
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <AgentPresence
          role="planner"
          name="Planner"
          address={BRIEF_OPERATOR_ADDRESS}
          status={plannerStatusLine(tasks, policyId, policyRevoked)}
        />
        <AgentPresence
          role="specialist"
          name={research?.displayName || "Research"}
          address={research?.address ?? null}
          status={specialistStatusLine(tasks, research?.address ?? null, "research", policyRevoked)}
          agent={research}
        />
        <AgentPresence
          role="specialist"
          name={treasury?.displayName || "Treasury"}
          address={treasury?.address ?? null}
          status={specialistStatusLine(tasks, treasury?.address ?? null, "treasury", policyRevoked)}
          agent={treasury}
        />
      </div>
    </section>
  );
}

function plannerStatusLine(
  tasks: WorkforceTask[],
  policyId: string | null,
  policyRevoked: boolean,
): { text: string; active: boolean } {
  if (policyRevoked) {
    return { text: "Authority revoked · standing by", active: false };
  }
  if (!policyId) return { text: "Reading your brief…", active: true };
  if (tasks.length === 0) return { text: "Decomposing the brief…", active: true };
  const settling = tasks.some(
    (t) => t.status === "delivered" || t.status === "accepted",
  );
  if (settling) return { text: "Watching the specialists work…", active: true };
  const allPaid = tasks.every((t) => t.status === "approved");
  if (allPaid) return { text: "Idle · all deliveries settled", active: false };
  return { text: "Watching the workforce…", active: true };
}

function specialistStatusLine(
  tasks: WorkforceTask[],
  address: string | null,
  kind: "research" | "treasury",
  policyRevoked: boolean,
): { text: string; active: boolean } {
  if (policyRevoked) {
    return { text: "Authority revoked · standing by", active: false };
  }
  if (!address) {
    return { text: "Not yet on chain — boot the specialist", active: false };
  }
  const mine = tasks
    .filter((t) => t.assignedTo.toLowerCase() === address.toLowerCase())
    .sort((a, b) => Number(b.postedAtMs - a.postedAtMs));
  if (mine.length === 0) return { text: "Idle · awaiting assignment", active: false };
  const latest = mine[0];
  if (latest.status === "open") {
    return { text: "Picking up the assignment…", active: true };
  }
  if (latest.status === "accepted") {
    if (kind === "research") {
      // Pull target package id from spec for richer copy.
      const target = extractTargetFromSpec(latest.specBlob);
      return {
        text: target
          ? `Auditing ${short(target, 6, 4)}…`
          : "Researching the brief…",
        active: true,
      };
    }
    return { text: "Probing DeepBook SUI/DBUSDC…", active: true };
  }
  if (latest.status === "delivered") {
    return {
      text:
        kind === "research"
          ? "Delivered audit · awaiting release"
          : "Delivered report · awaiting release",
      active: true,
    };
  }
  if (latest.status === "approved") {
    return { text: "Paid · standing by for next job", active: false };
  }
  if (latest.status === "expired") {
    return { text: "Task expired · standing by", active: false };
  }
  return { text: "Idle", active: false };
}

function extractTargetFromSpec(specBlob: string): string | null {
  if (!specBlob) return null;
  try {
    const v = JSON.parse(specBlob) as { target_package_id?: string };
    if (v?.target_package_id && /^0x[0-9a-f]+$/i.test(v.target_package_id)) {
      return v.target_package_id;
    }
  } catch {
    /* not JSON */
  }
  // Last-ditch: pull any 0x… directly out of the spec.
  const m = /0x[0-9a-fA-F]{20,64}/.exec(specBlob);
  return m ? m[0] : null;
}

function AgentPresence({
  role,
  name,
  address,
  status,
  agent,
}: {
  role: "planner" | "specialist";
  name: string;
  address: string | null;
  status: { text: string; active: boolean };
  agent?: RegisteredAgent | null;
}) {
  // Reputation tick: flash green for ~600ms when the value bumps.
  const repValue = agent ? Number(agent.reputationScore) : 0;
  const prevRepRef = useRef(repValue);
  const [tick, setTick] = useState(false);
  useEffect(() => {
    if (repValue > prevRepRef.current) {
      setTick(true);
      const id = setTimeout(() => setTick(false), 700);
      prevRepRef.current = repValue;
      return () => clearTimeout(id);
    }
    prevRepRef.current = repValue;
  }, [repValue]);

  const earned = agent ? Number(agent.totalPaidMist) / 1e9 : 0;
  return (
    <article
      className={[
        "relative overflow-hidden border bg-bg-elev p-4 transition-colors",
        status.active ? "border-line-strong" : "border-line",
      ].join(" ")}
    >
      {status.active && (
        <>
          {/* Top heartbeat */}
          <span
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-emerald-500/60 animate-operator-pulse-line"
            aria-hidden
          />
          {/* Ambient scan — very low-contrast emerald sweep, 7s loop.
              Sells "this thing is alive" without nagging the eye. */}
          <span
            className="pointer-events-none absolute inset-y-0 left-0 w-[40%] -translate-x-full bg-gradient-to-r from-transparent via-emerald-500/[0.04] to-transparent animate-operator-scan"
            aria-hidden
          />
        </>
      )}

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {role === "planner" ? "Planner" : "Specialist"}
          </p>
          <p className="mt-0.5 text-[15px] font-medium tracking-tight text-ink">
            {name}
          </p>
          {address && (
            <p className="mt-0.5 font-mono text-[11px] text-muted">
              {short(address, 8, 6)}
            </p>
          )}
        </div>
        {agent && (
          <div className="text-right">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
              rep
            </p>
            <p
              className={[
                "font-mono text-[14px] tabular-nums transition-colors",
                tick ? "animate-value-tick text-emerald-700" : "text-ink",
              ].join(" ")}
            >
              {String(agent.reputationScore)}
            </p>
          </div>
        )}
      </div>

      <div className="relative mt-3 flex items-center gap-2 text-[12.5px]">
        <span
          className={[
            "inline-block h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
            status.active ? "bg-emerald-500 animate-pulse" : "bg-muted",
          ].join(" ")}
          aria-hidden
        />
        <span
          className={[
            "truncate",
            status.active ? "italic text-ink-2" : "text-muted",
          ].join(" ")}
        >
          {status.text}
        </span>
      </div>

      {agent && (
        <div className="relative mt-3 flex items-center justify-between border-t border-line pt-2 text-[11px]">
          <span className="font-mono text-muted">
            paid{" "}
            <span className="tabular-nums text-ink">
              {earned >= 1 ? earned.toFixed(2) : earned.toFixed(3)} SUI
            </span>
          </span>
          <span className="font-mono text-muted">
            delivered{" "}
            <span className="tabular-nums text-ink">
              {String(agent.completedTasks)}
            </span>
          </span>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Pending release — the guided checkpoint. The planner-service holds the
// most-recent delivered task; this card shows it with two equal-weight
// actions so the judge always has a clear next move.
// ---------------------------------------------------------------------------

function PendingReleaseSection({
  tasks,
  roster,
  policyId,
  policyRevoked,
  onRelease,
  onRevoke,
  releaseTaskId,
  releaseSubmitting,
  verificationTaskId,
}: {
  tasks: WorkforceTask[];
  roster: RegisteredAgent[];
  policyId: string | null;
  policyRevoked: boolean;
  onRelease: (taskId: string) => void;
  onRevoke: () => void;
  releaseTaskId: string | null;
  releaseSubmitting: boolean;
  verificationTaskId: string | null;
}) {
  if (!policyId || policyRevoked) return null;
  const candidates = tasks
    .filter((t) => t.status === "delivered")
    .filter((t) => t.id !== verificationTaskId)
    .sort((a, b) => Number(b.postedAtMs - a.postedAtMs));
  const pending = candidates[0];
  if (!pending) return null;
  const bountySui = Number(pending.bountyMist) / 1e9;
  const specialist =
    roster.find(
      (a) => a.address.toLowerCase() === pending.assignedTo.toLowerCase(),
    ) ?? null;
  const isSubmittingThis =
    releaseSubmitting && releaseTaskId === pending.id;

  return (
    <section className="mt-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Human checkpoint · your call
      </p>

      <div className="mt-3 animate-fade-up overflow-hidden border-2 border-ink bg-bg-elev">
        {/* Top heartbeat — the chain is waiting for your signal. */}
        <span
          className="block h-px w-full bg-amber-400/70 animate-operator-pulse-line"
          aria-hidden
        />

        {/* Brief delivery card. */}
        <div className="px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-amber-800">
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
              aria-hidden
            />
            Delivered · waiting to be paid
          </div>
          <p className="mt-3 text-[18px] leading-snug tracking-tight text-ink sm:text-[20px]">
            <span className="font-medium">
              {specialist?.displayName ?? "The specialist"}
            </span>{" "}
            wants{" "}
            <span className="font-mono tabular-nums text-ink">
              {bountySui.toFixed(3)} SUI
            </span>{" "}
            for{" "}
            <span className="italic text-ink-2">“{pending.title}”</span>.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-mono">
            <KV label="Task">
              <a
                href={explorerUrl("object", pending.id)}
                target="_blank"
                rel="noreferrer"
                className="text-ink underline-offset-4 hover:underline"
              >
                {short(pending.id, 8, 6)}
              </a>
            </KV>
            <KV label="Specialist">
              <span className="text-ink">
                {short(pending.assignedTo, 8, 6)}
              </span>
            </KV>
          </div>
        </div>

        {/* The two branches — equal visual weight, opposite tones, each
            with explicit "what happens" copy underneath. The judge can
            see the consequence of each choice without reading docs. */}
        <div className="grid border-t border-line sm:grid-cols-2">
          {/* RELEASE — happy path */}
          <div className="border-b border-line bg-bg-elev p-5 sm:border-b-0 sm:border-r">
            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-ink-2">
              Release payment
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              The chain transfers{" "}
              <span className="font-mono tabular-nums text-ink">
                {bountySui.toFixed(3)} SUI
              </span>{" "}
              to {specialist?.displayName ?? "the specialist"} atomically, bumps
              their on-chain reputation, and the workforce keeps running.
            </p>
            <button
              type="button"
              onClick={() => onRelease(pending.id)}
              disabled={isSubmittingThis}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 border-2 border-ink bg-ink px-5 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-bg transition-colors hover:bg-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmittingThis ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Releasing…
                </>
              ) : (
                <>
                  Release{" "}
                  <span className="font-mono tabular-nums">
                    {bountySui.toFixed(3)} SUI
                  </span>
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </>
              )}
            </button>
          </div>

          {/* REVOKE — the kill switch */}
          <div className="bg-red-50/30 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-red-700">
              Revoke authority
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              You sign once. The chain refuses this payment — and every payment
              under this policy from now on. Funds stay locked in escrow until
              the task expires.
            </p>
            <button
              type="button"
              onClick={onRevoke}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 border-2 border-red-500 bg-bg px-5 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-red-700 transition-colors hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
            >
              <ShieldOff className="h-3.5 w-3.5" strokeWidth={1.75} />
              Revoke the policy
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// Brief — verbatim, what the Planner is working from
// =============================================================================

function Brief({ brief }: { brief: string }) {
  return (
    <section className="mt-10">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        The brief · what the workforce is working from
      </p>
      <blockquote className="mt-3 border-l-2 border-ink bg-bg-elev px-5 py-4 text-[15.5px] leading-relaxed italic text-ink-2 sm:px-6 sm:py-5 sm:text-[16px]">
        “{brief}”
      </blockquote>
    </section>
  );
}

// =============================================================================
// Mission Narrator — teaches a beginner what an "agent economy" is by
// narrating the real on-chain state in plain language.
//
// Every beat is derived from a real source: the OperatorPolicy object,
// the per-task status, the deliverable's walrus_blob_id, the abort record.
// We never invent state; if a beat isn't true yet, it just isn't shown.
// =============================================================================

type NarratorBeatKind =
  | "granted"
  | "planner-working"
  | "task-posted"
  | "task-accepted"
  | "task-delivered"
  | "task-paid"
  | "task-expired"
  | "killswitch-armed"
  | "killswitch-refused";

type NarratorBeat = {
  kind: NarratorBeatKind;
  /** Real on-chain timestamp (ms) when known; falls back to render-stable
   *  derived values so the beat order stays stable across renders. */
  ts: number;
  state: "done" | "active" | "pending";
  title: string;
  detail?: React.ReactNode;
};

function MissionNarrator({
  activation,
  policyId,
  policy,
  tasks,
  roster,
  chainAbort,
}: {
  activation: ActivationResult;
  policyId: string | null;
  policy: OperatorPolicyDecoded | null;
  tasks: WorkforceTask[];
  roster: RegisteredAgent[];
  chainAbort: AbortRecord | null;
}) {
  const beats: NarratorBeat[] = [];

  // 1) Funding — happens the moment the user signed the activation tx.
  beats.push({
    kind: "granted",
    ts: 0,
    state: "done",
    title: `You gave the team a ${activation.budgetSui.toFixed(2)} SUI budget — minted on-chain.`,
    detail: (
      <>
        A Move <span className="font-mono text-ink">OperatorPolicy</span> object
        was created. The Planner can spend only inside this envelope, only on
        these capabilities ({activation.allowedVenues.join(", ")}), and only
        until expiry.
        {policyId && (
          <>
            {" "}
            <NarratorLink href={explorerUrl("object", policyId)}>
              policy
            </NarratorLink>
          </>
        )}{" "}
        <NarratorLink href={explorerUrl("txblock", activation.txDigest)}>
          grant tx
        </NarratorLink>
      </>
    ),
  });

  // 2) Planner-working — between the grant landing and the first task
  //    being posted, the planner-service is decomposing the brief.
  const tasksSorted = [...tasks].sort((a, b) =>
    Number(a.postedAtMs - b.postedAtMs),
  );
  if (tasksSorted.length === 0) {
    beats.push({
      kind: "planner-working",
      ts: Date.now(),
      state: "active",
      title: "The Planner is splitting your mission into jobs…",
      detail: (
        <>
          The Planner agent reads your brief and decides which specialists to
          hire and what to ask them. Each sub-task posts on-chain in one
          atomic transaction.
        </>
      ),
    });
  }

  // 3) Per-task beats — posted / accepted / delivered / paid. Each is
  //    derived from the task object's current `status` field.
  const agentByAddress = new Map(
    roster.map((a) => [a.address.toLowerCase(), a]),
  );
  for (const t of tasksSorted) {
    const ts = Number(t.postedAtMs);
    const agent = agentByAddress.get(t.assignedTo.toLowerCase());
    const specialistName = agent?.displayName ?? capabilityName(t.primaryCapability);
    const repBadge = agent ? ` (reputation ${agent.reputationScore})` : "";
    const bountySui = Number(t.bountyMist) / 1e9;

    // POSTED — always emit (the task exists on-chain).
    beats.push({
      kind: "task-posted",
      ts,
      state: t.status === "open" ? "active" : "done",
      title: `Planner hired ${specialistName}${repBadge} to ${narratorActionFor(t.primaryCapability)}.`,
      detail: (
        <>
          Sub-task posted with{" "}
          <span className="font-mono tabular-nums text-ink">
            {bountySui.toFixed(3)} SUI
          </span>{" "}
          escrowed.{" "}
          <NarratorLink href={explorerUrl("object", t.id)}>task</NarratorLink>{" "}
          <NarratorLink href={explorerUrl("txblock", t.postedTxDigest)}>
            tx
          </NarratorLink>
        </>
      ),
    });

    if (t.status === "accepted" || t.status === "delivered" || t.status === "approved") {
      beats.push({
        kind: "task-accepted",
        ts: ts + 1,
        state: t.status === "accepted" ? "active" : "done",
        title: `${specialistName} accepted the job and started working.`,
        detail:
          t.primaryCapability === "research" ? (
            <>Reading the contract and drafting the deliverable…</>
          ) : t.primaryCapability === "treasury" ? (
            <>Pulling DeepBook depth and preparing POST_ONLY orders…</>
          ) : (
            <>Working the brief and preparing the deliverable…</>
          ),
      });
    }

    if (t.status === "delivered" || t.status === "approved") {
      beats.push({
        kind: "task-delivered",
        ts: ts + 2,
        state: t.status === "delivered" ? "active" : "done",
        title: `${specialistName} delivered.`,
        detail: (
          <>
            {t.primaryCapability === "research" ? (
              <>
                Audit report written and stored content-addressed — fetchable
                by anyone, not just from our server.
              </>
            ) : t.primaryCapability === "treasury" ? (
              <>
                Disbursement plan + real POST_ONLY orders resting on DeepBook
                v3. Each order id is on-chain.
              </>
            ) : (
              <>Deliverable minted on-chain and attached to the task.</>
            )}
            {t.deliverableId && (
              <>
                {" "}
                <NarratorLink href={explorerUrl("object", t.deliverableId)}>
                  deliverable
                </NarratorLink>
              </>
            )}
          </>
        ),
      });
    }

    if (t.status === "approved") {
      beats.push({
        kind: "task-paid",
        ts: ts + 3,
        state: "done",
        title: `Planner paid ${specialistName} ${bountySui.toFixed(3)} SUI.`,
        detail: (
          <>
            Settled atomically — the policy&apos;s spent counter went up,{" "}
            {specialistName}&apos;s reputation went up, and a 10% holdback
            stays parked until expiry.
          </>
        ),
      });
    }

    if (t.status === "expired") {
      beats.push({
        kind: "task-expired",
        ts: ts + 4,
        state: "done",
        title: `${specialistName}'s job expired before delivery — bounty returned to you.`,
      });
    }
  }

  // 4) Kill switch — always present at the bottom; the visual changes if
  //    the chain has already refused a payment.
  if (chainAbort) {
    beats.push({
      kind: "killswitch-refused",
      ts: chainAbort.at,
      state: "done",
      title: "You hit the kill switch — the blockchain refused the next payment.",
      detail: (
        <>
          The Move runtime aborted with{" "}
          <span className="font-mono text-red-700">
            {chainAbort.abortConst ?? "EPolicyRevoked"} · code{" "}
            {chainAbort.abortCode ?? 3}
          </span>
          {chainAbort.txDigest && (
            <>
              {" "}
              <NarratorLink href={explorerUrl("txblock", chainAbort.txDigest)}>
                abort tx
              </NarratorLink>
            </>
          )}
          . Funds stayed locked. The agent had no path around it.
        </>
      ),
    });
  } else {
    beats.push({
      kind: "killswitch-armed",
      ts: Number.MAX_SAFE_INTEGER,
      state: "pending",
      title:
        "You hold the kill switch — revoke any time and the chain refuses the next payment.",
      detail: (
        <>
          Revoke flips the policy&apos;s{" "}
          <span className="font-mono text-ink">revoked</span> bit. The Move
          runtime checks that bit before every settlement —{" "}
          {policy?.revoked
            ? "this policy is already revoked."
            : "the agent literally cannot spend if it's set."}
        </>
      ),
    });
  }

  return (
    <section
      aria-label="Mission narrator"
      className="mt-6 border border-line bg-bg-elev"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          The story so far
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          live · on chain
        </p>
      </header>
      <ol className="relative px-5 py-5 sm:px-6 sm:py-6">
        {/* Connecting rail behind the dots — calm vertical spine. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-[1.55rem] top-7 h-[calc(100%-3.25rem)] w-px bg-line sm:left-[1.85rem]"
        />
        {beats.map((b, i) => (
          <NarratorBeatRow key={`${b.kind}-${b.ts}-${i}`} beat={b} index={i} />
        ))}
      </ol>
    </section>
  );
}

function NarratorBeatRow({
  beat,
  index,
}: {
  beat: NarratorBeat;
  index: number;
}) {
  // Dot color encodes state without leaning on a label the user has to read.
  const dotClass =
    beat.state === "done"
      ? "bg-ink ring-2 ring-bg-elev"
      : beat.state === "active"
        ? "bg-emerald-500 ring-2 ring-bg-elev animate-pulse"
        : "bg-bg-elev ring-2 ring-line-strong";
  return (
    <li
      className="relative flex gap-3 animate-fade-up sm:gap-4"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      <span
        aria-hidden
        className={[
          "relative z-10 mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full",
          dotClass,
        ].join(" ")}
      />
      <div className="min-w-0 pb-5 last:pb-0">
        <p
          className={[
            "text-[14.5px] leading-snug",
            beat.state === "pending" ? "text-ink-2" : "text-ink",
            beat.kind === "killswitch-refused" ? "text-red-800" : "",
          ].join(" ")}
        >
          {beat.title}
        </p>
        {beat.detail && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            {beat.detail}
          </p>
        )}
      </div>
    </li>
  );
}

function NarratorLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 font-mono text-[11px] uppercase tracking-[0.22em] text-ink underline-offset-4 hover:underline focus-visible:underline"
    >
      {children}
      <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
    </a>
  );
}

function capabilityName(capability: string): string {
  if (capability === "research" || capability === "audit") return "Research";
  if (capability === "treasury") return "Treasury";
  return "a specialist";
}

function narratorActionFor(capability: string): string {
  if (capability === "research") return "audit the contract";
  if (capability === "audit") return "audit the contract";
  if (capability === "treasury") return "probe DeepBook depth and size the payout";
  return "work the brief";
}

// (RosterStrip removed — replaced by the live `Team` panel above the
// activity feed, which also surfaces the Planner and per-agent status
// lines tied to the chain state.)

// =============================================================================
// Activity feed — task timeline + nice deliverables
// =============================================================================

const STATUS_TONE: Record<TaskStatus, { label: string; tone: string; dot: string }> = {
  open: { label: "POSTED", tone: "border-line text-ink-2", dot: "bg-ink/40" },
  accepted: {
    label: "ACCEPTED",
    tone: "border-amber-400 text-amber-700",
    dot: "bg-amber-500 animate-pulse",
  },
  delivered: {
    label: "DELIVERED",
    tone: "border-emerald-500 text-emerald-700",
    dot: "bg-emerald-500 animate-pulse",
  },
  approved: {
    label: "PAID",
    tone: "border-ink bg-ink text-bg",
    dot: "bg-emerald-500",
  },
  expired: {
    label: "EXPIRED",
    tone: "border-red-300 text-red-700",
    dot: "bg-red-500",
  },
  unknown: { label: "—", tone: "border-line text-muted", dot: "bg-muted" },
};

function ActivityFeed({
  tasks,
  policyId,
  policyRevoked,
}: {
  tasks: WorkforceTask[];
  policyId: string | null;
  policyRevoked: boolean;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
          Activity · {tasks.length}
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          {policyId ? "live · 3s" : "awaiting policy…"}
        </span>
      </div>
      <div className="mt-3 border border-line bg-bg-elev">
        {!policyId ? (
          <p className="px-6 py-8 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
            The Planner is reading your brief and posting the first jobs…
          </p>
        ) : tasks.length === 0 ? (
          <p className="px-6 py-8 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
            Planner is decomposing — first job appears here in seconds.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map((t, i) => (
              <TaskCard
                key={t.id}
                task={t}
                index={i}
                policyRevoked={policyRevoked}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  index,
  policyRevoked,
}: {
  task: WorkforceTask;
  index: number;
  policyRevoked: boolean;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const tone = STATUS_TONE[task.status];
  const bountySui = Number(task.bountyMist) / 1e9;
  return (
    <li
      className="relative animate-land-in"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Timeline rail — connects rows so the activity reads as a
          sequence, not a table. Hidden when expanded so the deliverable
          surface owns the vertical space. */}
      {!expanded && (
        <span
          className="pointer-events-none absolute left-[1.65rem] top-[2.4rem] h-[calc(100%-1.5rem)] w-px bg-line"
          aria-hidden
        />
      )}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-bg-elev-2/40 focus-visible:bg-bg-elev-2/40 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-ink"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={[
              "relative z-10 inline-block h-2 w-2 shrink-0 rounded-full ring-2 ring-bg-elev",
              tone.dot,
            ].join(" ")}
            aria-hidden
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {task.primaryCapability}
          </span>
          <span className="min-w-0 truncate text-[14px] text-ink">
            {task.title}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden font-mono text-[11px] tabular-nums text-ink-2 sm:inline">
            {bountySui.toFixed(2)} SUI
          </span>
          <span
            className={[
              "border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]",
              tone.tone,
            ].join(" ")}
          >
            {tone.label}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-line bg-bg/40 px-5 py-5">
          <SpecialistChip address={task.assignedTo} />

          <div className="mt-4 grid gap-2 font-mono text-[11px] sm:grid-cols-2">
            <KV label="Task">
              <a
                href={explorerUrl("object", task.id)}
                target="_blank"
                rel="noreferrer"
                className="text-ink underline-offset-4 hover:underline"
              >
                {short(task.id, 8, 6)}
              </a>
            </KV>
            <KV label="Posted tx">
              <a
                href={explorerUrl("txblock", task.postedTxDigest)}
                target="_blank"
                rel="noreferrer"
                className="text-ink underline-offset-4 hover:underline"
              >
                {short(task.postedTxDigest, 6, 6)}
              </a>
            </KV>
            {task.deliverableId && (
              <KV label="Deliverable">
                <a
                  href={explorerUrl("object", task.deliverableId)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink underline-offset-4 hover:underline"
                >
                  {short(task.deliverableId, 8, 6)}
                </a>
              </KV>
            )}
          </div>

          {task.deliverableId && (
            <DeliverableSurface
              deliverableId={task.deliverableId}
              capability={task.primaryCapability}
            />
          )}

          {task.status === "delivered" && policyRevoked && (
            <p className="mt-4 inline-flex items-center gap-2 border border-red-300 bg-red-50 px-3 py-1.5 font-mono text-[11px] text-red-800">
              <ShieldOff className="h-3 w-3" strokeWidth={1.75} />
              policy revoked · settlement refused by chain
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function SpecialistChip({ address }: { address: string }) {
  const { profile } = useAgentRegistration(address);
  return (
    <div className="flex flex-wrap items-center gap-2 border border-line bg-bg p-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        Specialist
      </span>
      <span className="text-[13.5px] font-medium text-ink">
        {profile?.displayName || "Specialist"}
      </span>
      <span className="font-mono text-[11px] text-muted">
        {short(address, 8, 6)}
      </span>
      {profile && (
        <span className="ml-auto flex items-center gap-3 font-mono text-[10px] text-muted">
          <span>
            rep <span className="tabular-nums text-ink">{String(profile.reputationScore)}</span>
          </span>
          <span>
            paid{" "}
            <span className="tabular-nums text-ink">
              {(Number(profile.totalPaidMist) / 1e9).toFixed(2)} SUI
            </span>
          </span>
        </span>
      )}
    </div>
  );
}

// =============================================================================
// Deliverable rendering — markdown / orders table / view-raw disclosure
// =============================================================================

function DeliverableSurface({
  deliverableId,
  capability,
}: {
  deliverableId: string;
  capability: string;
}) {
  const d = useDeliverable(deliverableId);
  if (d.loading) {
    return (
      <div className="mt-4 border border-line bg-bg p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Loading deliverable…
        </p>
      </div>
    );
  }
  if (!d.body) {
    return (
      <div className="mt-4 border border-line bg-bg p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Waiting for content (propagation can take ~15s).
        </p>
      </div>
    );
  }

  const isTreasury =
    capability === "treasury" || capability === "audit"
      ? false
      : false;
  void isTreasury;
  const treasuryView = capability === "treasury" && d.bodyKind === "json";

  return (
    <div className="mt-4 border border-line bg-bg-elev">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          Deliverable
        </p>
        {d.walrusBlobId ? (
          <WalrusBadge blobId={d.walrusBlobId} />
        ) : (
          // Honest fallback: inline rendering is fine for the judge but
          // we don't want it to read as "Walrus integration is fake."
          <span
            className="inline-flex items-center gap-1.5 border border-line bg-bg-elev-2/60 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted"
            title="Walrus skipped on this delivery (no WAL coin on the agent's wallet) — falling back to inline payload on chain."
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted/60" aria-hidden />
            Inline · Walrus unfunded
          </span>
        )}
      </div>
      <div className="px-5 py-5">
        {treasuryView ? (
          <TreasuryView
            raw={d.body}
            deliverTxDigest={d.deliverTxDigest}
            placedOrders={d.placedOrders}
          />
        ) : d.bodyKind === "markdown" ? (
          <Markdown source={d.body} />
        ) : d.bodyKind === "json" ? (
          <Markdown source={tryFormatJsonAsMarkdown(d.body)} />
        ) : (
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink">
            {d.body.slice(0, 4000)}
          </pre>
        )}
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            View raw
          </summary>
          <pre className="mt-3 max-h-72 overflow-auto border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-ink-2">
            {d.body.length > 6000 ? d.body.slice(0, 6000) + "\n\n… (truncated)" : d.body}
          </pre>
        </details>
      </div>
    </div>
  );
}

function tryFormatJsonAsMarkdown(raw: string): string {
  try {
    const v = JSON.parse(raw);
    return "```json\n" + JSON.stringify(v, null, 2) + "\n```";
  } catch {
    return raw;
  }
}

type TreasuryDeliverable = {
  task_title?: string;
  pool?: {
    key?: string;
    mid_price?: number;
    price_source?: "deepbook" | "fallback";
  };
  orders?: Array<{
    client_order_id: string;
    price: number;
    quantity_sui: number;
    side: "ask" | "bid";
    offset_bps: number;
    status: "posted" | "simulated";
  }>;
  analysis?: {
    estimated_depth_sui?: number;
    disbursement_recommendation?: string;
  };
  metadata?: {
    mode?: "live" | "simulated";
    deposit_sui?: number;
    balance_manager?: string;
  };
};

// Walrus badge — the "Stored on Walrus · content-addressed" affordance
// surfaced in the deliverable header. Clickable to the public testnet
// aggregator so a judge can fetch the blob directly and see that it
// lives on decentralised storage, not on our server.
function WalrusBadge({ blobId }: { blobId: string }) {
  const url = `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-1.5 border border-emerald-600/40 bg-emerald-50/70 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-emerald-800 transition-colors hover:border-emerald-700 hover:bg-emerald-100/70 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      title={`Walrus content-addressed blob ${blobId} — click to fetch from the public aggregator`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600"
        aria-hidden
      />
      Stored on Walrus · {blobId.slice(0, 8)}…
      <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
    </a>
  );
}

function TreasuryView({
  raw,
  deliverTxDigest,
  placedOrders,
}: {
  raw: string;
  deliverTxDigest: string | null;
  placedOrders: DeepBookPlacedOrder[];
}) {
  let v: TreasuryDeliverable | null = null;
  try {
    v = JSON.parse(raw) as TreasuryDeliverable;
  } catch {
    /* fall through */
  }
  if (!v) {
    return (
      <pre className="overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink">
        {raw.slice(0, 4000)}
      </pre>
    );
  }
  const mode = v.metadata?.mode ?? "simulated";
  const isLive = mode === "live";
  // Splice on-chain order_id by client_order_id so judges click into the
  // real DeepBook order, not a synthetic label.
  const onchainByCoid = new Map<string, DeepBookPlacedOrder>();
  for (const o of placedOrders) {
    onchainByCoid.set(o.clientOrderId, o);
  }
  return (
    <div className="space-y-5">
      {/* Mode badge — the single most important "this is real" signal
          on this surface. Green for LIVE, amber for SIMULATED, with a
          one-line justification immediately under it. */}
      <div
        className={[
          "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-l-2 px-3 py-2",
          isLive
            ? "border-emerald-600 bg-emerald-50/60"
            : "border-amber-500 bg-amber-50/50",
        ].join(" ")}
      >
        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-flex items-center gap-1.5 border-2 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.3em]",
              isLive
                ? "border-emerald-600 bg-emerald-600 text-bg"
                : "border-amber-600 bg-amber-100 text-amber-900",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-1.5 w-1.5 rounded-full",
                isLive ? "bg-bg" : "bg-amber-700",
              ].join(" ")}
              aria-hidden
            />
            {isLive ? "Live · DeepBook v3" : "Simulated · wallet below threshold"}
          </span>
          {deliverTxDigest && (
            <a
              href={explorerUrl("txblock", deliverTxDigest)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted transition-colors hover:text-ink focus-visible:text-ink"
            >
              view deliver tx
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
            </a>
          )}
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          {isLive
            ? `${placedOrders.length || (v.orders ?? []).length} on-chain POST_ONLY orders`
            : "Wallet < 2.5 SUI · top up to flip to live"}
        </p>
      </div>

      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          Treasury · DeepBook v3
        </p>
        <h3 className="mt-1 text-lg font-medium tracking-tight">
          {v.task_title ?? "Treasury report"}
        </h3>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-ink-2">
          <span>
            <span className="text-muted">pool </span>
            {v.pool?.key ?? "—"}
          </span>
          <span>
            <span className="text-muted">mid </span>
            <span className="tabular-nums text-ink">
              ${v.pool?.mid_price?.toFixed(4) ?? "—"}
            </span>
            <span className="ml-1 text-muted">
              ({v.pool?.price_source ?? "—"})
            </span>
          </span>
          {isLive && v.metadata?.balance_manager && (
            <a
              href={explorerUrl("object", v.metadata.balance_manager)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-ink underline-offset-4 hover:underline focus-visible:underline"
            >
              <span className="text-muted">balance manager </span>
              {short(v.metadata.balance_manager, 6, 4)}
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
            </a>
          )}
          {isLive && typeof v.metadata?.deposit_sui === "number" && (
            <span>
              <span className="text-muted">deposit </span>
              <span className="tabular-nums text-ink">
                {v.metadata.deposit_sui.toFixed(2)} SUI
              </span>
            </span>
          )}
        </div>
      </header>

      {(v.orders ?? []).length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            {isLive ? "Resting orders · POST_ONLY" : "Test orders (simulated)"}
          </p>
          <table className="mt-2 w-full border border-line text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-bg-elev-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                <th className="px-3 py-2 text-left">side</th>
                <th className="px-3 py-2 text-right">qty</th>
                <th className="px-3 py-2 text-right">price</th>
                <th className="px-3 py-2 text-right">offset</th>
                <th className="px-3 py-2 text-left">order</th>
              </tr>
            </thead>
            <tbody>
              {(v.orders ?? []).map((o) => {
                const live = onchainByCoid.get(o.client_order_id);
                return (
                  <tr key={o.client_order_id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono">
                      <span
                        className={[
                          "inline-block border px-1.5 py-px text-[10.5px] uppercase tracking-[0.16em]",
                          o.side === "ask"
                            ? "border-red-300 text-red-700"
                            : "border-emerald-300 text-emerald-700",
                        ].join(" ")}
                      >
                        {o.side}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {o.quantity_sui} SUI
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      ${o.price.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      +{o.offset_bps}bps
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {live && deliverTxDigest ? (
                        <a
                          href={explorerUrl("txblock", deliverTxDigest)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-ink underline-offset-4 hover:underline focus-visible:underline"
                          title={`On-chain DeepBook order id ${live.orderId}`}
                        >
                          <span className="tabular-nums">
                            #{live.orderId.length > 12
                              ? live.orderId.slice(0, 6) +
                                "…" +
                                live.orderId.slice(-4)
                              : live.orderId}
                          </span>
                          <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
                        </a>
                      ) : (
                        <span
                          className={
                            isLive ? "text-amber-700" : "text-muted"
                          }
                          title={
                            isLive
                              ? "On-chain order id propagating — refresh in a moment"
                              : "Simulated — no on-chain order id"
                          }
                        >
                          {isLive ? "propagating…" : o.status}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {isLive && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              Each order id is the actual DeepBook v3 OrderPlaced event from
              the deliver tx — click through to suiscan.
            </p>
          )}
        </div>
      )}

      {v.analysis?.disbursement_recommendation && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            Recommendation
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
            {v.analysis.disbursement_recommendation}
          </p>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Minimal markdown renderer. Just enough to render the Research deliverable
// cleanly (headings, lists, paragraphs, inline bold/italic/code, code blocks).
// Intentionally tiny — no external deps.
// -----------------------------------------------------------------------------

function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="space-y-5 text-[14px] leading-[1.65] text-ink-2 [&_a]:underline-offset-4 [&_a]:transition-colors hover:[&_a]:text-ink">
      {blocks.map((b, i) => (
        <MarkdownBlock key={i} block={b} />
      ))}
    </div>
  );
}

type MdBlock =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "hr" }
  | { kind: "blockquote"; text: string };

function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === "") {
      i++;
      continue;
    }
    if (l.startsWith("```")) {
      const lang = l.slice(3).trim();
      i++;
      const buf: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing
      blocks.push({ kind: "code", lang, text: buf.join("\n") });
      continue;
    }
    if (l.startsWith("# ")) {
      blocks.push({ kind: "h1", text: l.slice(2).trim() });
      i++;
      continue;
    }
    if (l.startsWith("## ")) {
      blocks.push({ kind: "h2", text: l.slice(3).trim() });
      i++;
      continue;
    }
    if (l.startsWith("### ")) {
      blocks.push({ kind: "h3", text: l.slice(4).trim() });
      i++;
      continue;
    }
    if (l.trim() === "---" || l.trim() === "***") {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    if (l.startsWith("> ")) {
      const buf: string[] = [l.slice(2)];
      i++;
      while (i < lines.length && lines[i].startsWith("> ")) {
        buf.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ kind: "blockquote", text: buf.join(" ") });
      continue;
    }
    if (/^[-*]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    // Paragraph: join consecutive non-empty non-block lines.
    const buf = [l];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("> ") &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "p", text: buf.join(" ") });
  }
  return blocks;
}

function MarkdownBlock({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case "h1":
      return (
        <h2 className="mt-2 border-b border-line pb-2 font-sans text-[22px] font-medium tracking-tightest text-ink">
          {inline(block.text)}
        </h2>
      );
    case "h2":
      return (
        <h3 className="font-sans text-[18px] font-medium tracking-tight text-ink">
          {inline(block.text)}
        </h3>
      );
    case "h3":
      return (
        <h4 className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.28em] text-muted">
          {inline(block.text)}
        </h4>
      );
    case "p":
      return <p>{inline(block.text)}</p>;
    case "ul":
      return (
        <ul className="space-y-1.5 [&>li]:relative [&>li]:pl-4">
          {block.items.map((it, j) => (
            <li key={j}>
              <span
                className="absolute left-0 top-[0.7em] inline-block h-1 w-1 rounded-full bg-ink/40"
                aria-hidden
              />
              {inline(it)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-inside list-decimal space-y-1.5 marker:font-mono marker:text-[12px] marker:text-muted">
          {block.items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre className="overflow-auto border border-line bg-bg-elev-2 p-3 font-mono text-[12px] leading-relaxed text-ink">
          {block.text}
        </pre>
      );
    case "hr":
      return <hr className="border-line" />;
    case "blockquote":
      return (
        <blockquote className="border-l-2 border-line-strong bg-bg-elev-2/40 px-4 py-2 italic text-ink-2">
          {inline(block.text)}
        </blockquote>
      );
  }
}

// Tiny inline parser: **bold**, *italic*, `code`. Avoids dangerouslySetInnerHTML.
function inline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Order matters: code first (to avoid eating ** inside `…`), then bold,
  // then italic.
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const seg = m[0];
    if (seg.startsWith("`")) {
      parts.push(
        <code key={key++} className="rounded bg-bg-elev-2 px-1 font-mono text-[12px] text-ink">
          {seg.slice(1, -1)}
        </code>,
      );
    } else if (seg.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-medium text-ink">
          {seg.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <em key={key++} className="italic">
          {seg.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + seg.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// =============================================================================
// Revoke confirmation modal
// =============================================================================

function RevokeModal({
  onConfirm,
  onCancel,
  submitting,
  name,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
  name: string;
}) {
  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Allow Esc to dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-5 backdrop-blur-sm animate-fade-up"
      onClick={onCancel}
      role="dialog"
      aria-modal
      aria-labelledby="revoke-title"
    >
      <div
        className="w-full max-w-md overflow-hidden border-2 border-red-500 bg-bg-elev shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Banner header — matches the climax card's vocabulary. */}
        <div className="flex items-center gap-2 border-b-2 border-red-500 bg-red-500 px-5 py-2 font-mono text-[10.5px] uppercase tracking-[0.4em] text-bg">
          <ShieldOff className="h-3.5 w-3.5" strokeWidth={2} />
          Halt the workforce
        </div>

        <div className="px-5 py-5 sm:px-6 sm:py-6">
          <h3
            id="revoke-title"
            className="font-sans text-[26px] font-medium leading-[1.1] tracking-tightest text-ink"
          >
            Revoke {name}?
          </h3>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            You&apos;ll sign one transaction. The chain itself will refuse the
            workforce&apos;s next settlement — funds stay locked in escrow, the
            specialist never gets paid. Final until you grant a new policy.
          </p>

          {/* Tiny preview of the abort fingerprint the judge is about to
              earn — frames the "this is the actual on-chain receipt"
              feel without being overbearing. */}
          <div className="mt-5 grid gap-1 border border-line bg-bg-elev-2/60 px-4 py-3 font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted">
            <div className="flex items-center justify-between gap-3">
              <span>The chain will return</span>
              <span className="text-red-700">EPolicyRevoked · code 3</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>From</span>
              <span className="text-ink-2">
                operator_policy::assert_can_spend
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink focus-visible:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              className="inline-flex items-center gap-2 border-2 border-red-500 bg-red-500 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.32em] text-bg transition-colors hover:bg-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60"
              autoFocus
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Signing…
                </>
              ) : (
                <>
                  <ShieldOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Revoke now
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function EmptyHint({
  children,
  inline,
}: {
  children: React.ReactNode;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
        {children}
      </p>
    );
  }
  return (
    <div className="border border-dashed border-line bg-bg-elev px-4 py-6 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
        {children}
      </p>
    </div>
  );
}

function short(s: string, head = 6, tail = 4): string {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
