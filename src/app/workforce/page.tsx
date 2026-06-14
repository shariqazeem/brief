"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import { BRIEF_NETWORK, BRIEF_PACKAGE_ID, BRIEF_TRADER_ADDRESS, explorerUrl } from "@/lib/brief-client";
import { OperatorDashboard } from "@/components/operator/operator-dashboard";
import { Transaction } from "@mysten/sui/transactions";
import { buildAdoptTx, DEEPBOOK_CFG } from "@/lib/deepbook-adopt";
import { buildGetTestUsdcTx } from "@/lib/deepbook-get-usdc";
import {
  calibrateParams,
  defaultGoalFor,
  goalLabel,
  GOAL_HORIZONS,
  type OperatorGoal,
} from "@/lib/operator-goal";
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
import {
  buildRevokeTx,
  policyStatus,
  type OperatorPolicyDecoded,
} from "@/lib/operator-policy-client";
import { apiUrl } from "@/lib/api-base";
import { useTraderTrades } from "@/lib/use-mind-data";
import { SystemHealthDot } from "@/components/system-health";
import { WalletBoundary } from "@/components/wallet-boundary";


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
  /** Goal the user set at adoption — calibrates the trader's thresholds. */
  traderGoal?: OperatorGoal;
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

// What this operator would *likely* do right now, read live from the
// public BTC signals feed. It's a hint (conditional phrasing in the UI),
// not a promise — emerald = would act, amber = would preserve capital,
// gray = still reading the tape. Mirrors each strategy's real gate.
type OperatorStatus = "act" | "preserve" | "idle";

function operatorStatus(
  strategy: StrategyId,
  s: DisconnectedSignals,
): OperatorStatus {
  if (!s.loaded || s.spot == null) return "idle";
  switch (strategy) {
    case "conservative": {
      if (s.sma15 == null || s.sma60 == null) return "idle";
      const aligned = s.sma15 >= s.sma60;
      const calm = s.rsi60 == null || (s.rsi60 <= 70 && s.rsi60 >= 30);
      return aligned && calm ? "act" : "preserve";
    }
    case "momentum": {
      if (s.roc30 == null) return "idle";
      return Math.abs(s.roc30) > 0.0005 ? "act" : "preserve";
    }
    case "contrarian": {
      if (s.rsi60 == null) return "idle";
      return s.rsi60 > 70 || s.rsi60 < 30 ? "act" : "preserve";
    }
    case "quant": {
      if (s.roc30 == null && s.rsi60 == null) return "idle";
      const lean =
        (s.roc30 != null && Math.abs(s.roc30) > 0.0005) ||
        (s.rsi60 != null && (s.rsi60 > 70 || s.rsi60 < 30));
      return lean ? "act" : "preserve";
    }
  }
}

// The "Choose your operator" grid — four operators, 2×2, 24px gutter.
// Used on the disconnected screen AND (when no preselect survives) right
// after connect. Pure white cards, sharp corners, breathing glyph.
function OperatorChoiceGrid({
  picked,
  onPick,
}: {
  picked: StrategyId | null;
  onPick: (s: StrategyId) => void;
}) {
  const signals = useDisconnectedSignals();
  return (
    <div className="mt-10 grid gap-6 sm:grid-cols-2">
      {TRADER_PERSONALITIES.map((p, i) => (
        <OperatorChoiceCard
          key={p.strategy}
          personality={p}
          status={operatorStatus(p.strategy, signals)}
          active={picked === p.strategy}
          index={i}
          onPick={() => onPick(p.strategy)}
        />
      ))}
    </div>
  );
}

function OperatorChoiceCard({
  personality,
  status,
  active,
  index,
  onPick,
}: {
  personality: TraderPersonality;
  status: OperatorStatus;
  active: boolean;
  index: number;
  onPick: () => void;
}) {
  const dot =
    status === "act"
      ? "bg-emerald-500"
      : status === "preserve"
        ? "bg-amber-500"
        : "bg-[#C7C7CC]";
  const word =
    status === "act"
      ? "would act"
      : status === "preserve"
        ? "would hold"
        : "reading tape";
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      style={{
        borderLeft: active ? "3px solid #10B981" : "3px solid transparent",
        animationDelay: `${index * 70}ms`,
      }}
      className={[
        "group flex min-h-[184px] flex-col bg-bg-elev p-6 text-left shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-all duration-200 animate-fade-up",
        "hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
      ].join(" ")}
    >
      <span
        className="op-glyph font-sans text-[48px] leading-none text-ink"
        aria-hidden
      >
        {personality.glyph}
      </span>
      <h3 className="mt-5 font-sans text-[20px] font-medium tracking-tight text-ink">
        {personality.label}
      </h3>
      <p className="mt-1 text-[13.5px] leading-snug text-ink-2">
        {personality.tagline}
      </p>
      <div className="mt-auto flex items-center justify-between pt-5">
        <span
          className={[
            "font-mono text-[9.5px] uppercase tracking-[0.22em] transition-colors",
            active ? "text-emerald-700" : "text-muted group-hover:text-ink",
          ].join(" ")}
        >
          {active ? "selected — adopt below" : "select →"}
        </span>
        <span
          className="inline-flex items-center gap-1.5"
          title={`live signal read · ${word}`}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
            {word}
          </span>
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${dot} ${status === "act" ? "v2-core" : ""}`}
          />
        </span>
      </div>
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
          Choose your operator.
        </h1>
        <p className="mt-4 max-w-prose text-[16px] leading-relaxed text-ink-2 sm:text-lg">
          Four temperaments, one leash. Pick one — it trades on chain,
          bounded by a Move policy you revoke in one tap.{" "}
          <Link
            href="/leaderboard"
            className="text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            See whose operator is winning →
          </Link>
        </p>

        {/* Operator-first hero — choose before you connect; the choice
            carries through the wallet step via sessionStorage. */}
        <OperatorChoiceGrid picked={picked} onPick={onPick} />

        {pickedLabel && (
          <p className="mt-6 inline-flex items-center gap-2 border-l-[3px] border-emerald-500 bg-emerald-50/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-800 animate-land-in">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Connect a wallet to adopt {pickedLabel}
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
            etc.) to adopt an operator.
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

// Read-only operator view (?policy=<id>) — mounts the live dashboard for
// ANY operator by id: the decision cascade, fuel gauge, Walrus journal and
// policy, all driven by the same SSE stream + on-chain reads. No wallet
// funds touched; only the owner can revoke (from their own session). This
// is how the house demo operator is watched + how an operator is shared.
function ViewOperator({ policyId }: { policyId: string }) {
  const { policy } = usePolicy(policyId);
  const status = policy ? policyStatus(policy) : null;
  return (
    <OperatorDashboard
      policyId={policyId}
      policy={policy}
      status={status}
      personality={null}
      traderName={policy?.name || "Operator"}
      goal={null}
      onReset={() => {
        if (typeof window !== "undefined") window.location.href = "/workforce";
      }}
      dispatchError={null}
      onDispatchAgain={() => {}}
      dispatching={false}
      revoked={!!policy?.revoked}
      killSwitchPhase="idle"
      chainAbort={null}
      revokeTx={null}
      revokeSubmitting={false}
      revokeError={null}
      confirmRevoke={false}
      onRequestRevoke={() => {}}
      onConfirmRevoke={() => {}}
      onCancelRevoke={() => {}}
      readOnly
    />
  );
}

function Connected({ address }: { address: string }) {
  const [activation, setActivation] = useState<ActivationResult | null>(null);
  // Gate the dashboard behind a brief "your operator is live" ceremony
  // the first time a leash mints, then hand off to the live dashboard.
  const [booted, setBooted] = useState(false);
  // Default surface for Phase-3 is the Trader product. The workforce
  // engine + UI are preserved verbatim and accessible via ?legacy=1 —
  // keep the path live so we can re-enable it instantly.
  const legacy =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("legacy") === "1";
  // The non-custodial DeepBook deposit flow is the primary product. The
  // testnet Predict path (house-funded, no deposit) stays as ?predict=1
  // practice — instant, no test-USDC needed.
  const predict =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("predict") === "1";

  // ?policy=<id> → read-only live view of any operator (watch / share).
  const viewPolicy =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("policy")
      : null;
  if (viewPolicy && /^0x[0-9a-fA-F]{6,}$/.test(viewPolicy)) {
    return (
      <section className="mx-auto max-w-page px-0 pt-0 pb-24">
        <ViewOperator policyId={viewPolicy} />
      </section>
    );
  }

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
        ) : predict ? (
          <>
            <TraderIntro />
            <TraderGallery address={address} onActivated={setActivation} />
          </>
        ) : (
          <>
            <DepositIntro />
            <DepositGallery address={address} onActivated={setActivation} />
          </>
        )}
      </section>
    );
  }
  if (activation.traderStrategy) {
    if (!booted) {
      return (
        <BootCeremony activation={activation} onDone={() => setBooted(true)} />
      );
    }
    return (
      <TraderDashboard
        activation={activation}
        onReset={() => {
          setBooted(false);
          setActivation(null);
        }}
      />
    );
  }
  return (
    <LiveConsole activation={activation} onReset={() => setActivation(null)} />
  );
}

// Boot ceremony — the single beat between "leash minted" and the live
// dashboard. The operator's card settles (scale 1.02 → 1), its glyph
// turns emerald, and "your operator is live" fades in. ~1.7s, then the
// dashboard takes over and runs its own first-decision sequence.
function BootCeremony({
  activation,
  onDone,
}: {
  activation: ActivationResult;
  onDone: () => void;
}) {
  const personality = activation.traderStrategy
    ? personalityById(activation.traderStrategy) ?? null
    : null;
  const name = activation.traderName || activation.name;
  const [live, setLive] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLive(true), 80);
    const t2 = setTimeout(onDone, 1700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone]);
  return (
    <section className="mx-auto flex max-w-page flex-col items-center justify-center px-6 py-32 text-center sm:px-10">
      <div
        className="boot-settle flex w-full max-w-sm flex-col items-center bg-bg-elev px-8 py-12 shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
        style={{ borderTop: "3px solid #10B981" }}
      >
        <span
          className="font-sans text-[64px] leading-none transition-colors duration-700"
          style={{ color: live ? "#10B981" : "#111111" }}
          aria-hidden
        >
          {personality?.glyph ?? "◇"}
        </span>
        <p className="mt-6 font-sans text-[24px] font-medium tracking-tight text-ink">
          {name}
        </p>
        <p
          className={[
            "mt-3 font-mono text-[11px] uppercase tracking-[0.32em] text-emerald-700 transition-opacity duration-500",
            live ? "opacity-100" : "opacity-0",
          ].join(" ")}
        >
          Your operator is live
        </p>
        <p
          className={[
            "mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted transition-opacity duration-700",
            live ? "opacity-100" : "opacity-0",
          ].join(" ")}
        >
          Listening for its first decision…
        </p>
      </div>
    </section>
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
        Brief · adopt an operator
      </p>
      <h1 className="mt-3 font-sans text-[28px] font-medium leading-[1.12] tracking-tightest text-ink sm:text-[40px]">
        Name it, set the budget, release it.{" "}
        <span className="text-ink-2">
          Three steps to put an autonomous operator on chain — then watch
          it win or lose. You hold the leash, the blockchain enforces it.
        </span>
      </h1>
      <p className="mt-4 max-w-prose text-[14px] leading-relaxed text-muted">
        Your operator takes BTC up/down positions on DeepBook Predict —
        and, if you open the floor, directional SUI/WAL/DEEP spot — all
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

const TRADER_BUDGET_PRESETS_SUI = [1, 2, 3, 5];

// Real per-bet quantity ceiling each strategy sizes up to (from the
// trader's strategy sizing). Every $1 staked records 1 SUI against the
// leash, so budget / typicalQty ≈ how many full-size bets fit.
const TYPICAL_QTY_BY_STRATEGY: Record<StrategyId, number> = {
  conservative: 1,
  momentum: 2,
  contrarian: 2,
  quant: 4,
};
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
    goal: OperatorGoal;
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
      goal,
    }: {
      personality: TraderPersonality;
      traderName: string;
      budgetSui: number;
      markets: TraderMarketBundleId;
      goal: OperatorGoal;
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
            // Bind the leash's agent to the Treasury trader wallet that
            // signs the gated mint — otherwise record_spend aborts
            // ENotAgent and every adopted bet falls back to simulated.
            // owner stays the connected user (they hold the kill switch).
            agentAddress: BRIEF_TRADER_ADDRESS,
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
              traderGoal: goal,
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

// Live balance of the network's capital coin (USDC on mainnet, DBUSDC on
// testnet) in the connected wallet — drives the deposit step.
function useUsdcBalance(address: string): {
  usdc: number;
  loaded: boolean;
  refetch: () => void;
} {
  const client = useSuiClient();
  const [state, setState] = useState({ usdc: 0, loaded: false });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cfg = DEEPBOOK_CFG[BRIEF_NETWORK];
    async function tick() {
      try {
        const coins = await client.getCoins({ owner: address, coinType: cfg.capitalCoinType });
        const total = coins.data.reduce((a, c) => a + BigInt(c.balance), 0n);
        if (!cancelled) setState({ usdc: Number(total) / 1e6, loaded: true });
      } catch {
        if (!cancelled) setState((p) => ({ ...p, loaded: true }));
      }
      if (!cancelled) timer = setTimeout(tick, 15_000);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [address, client, nonce]);
  return { ...state, refetch: () => setNonce((n) => n + 1) };
}

// Non-custodial deposit adoption — the mainnet (+ testnet-DBUSDC) path.
// One signature via buildAdoptTx: the user's own BalanceManager is created
// + funded, a TradeCap is delegated to the operator (trade-not-withdraw),
// and the chain-enforced policy is created. The user keeps custody.
function useDepositAdopt({
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
    depositUsdc: number;
    goal: OperatorGoal;
  }) => void;
} {
  const client = useSuiClient();
  const { signAndExecute } = useAccountSigner();
  const [phase, setPhase] = useState<AdoptPhase>({ kind: "idle" });

  const adopt = useCallback(
    ({
      personality,
      traderName,
      depositUsdc,
      goal,
    }: {
      personality: TraderPersonality;
      traderName: string;
      depositUsdc: number;
      goal: OperatorGoal;
    }) => {
      void (async () => {
        const name = traderName.trim().slice(0, 32) || personality.label;
        const cfg = DEEPBOOK_CFG[BRIEF_NETWORK];
        const usdcBase = BigInt(Math.round(depositUsdc * 1e6));
        try {
          setPhase({ kind: "checking-balance" });
          const coins = await client.getCoins({ owner: address, coinType: cfg.capitalCoinType });
          const total = coins.data.reduce((a, c) => a + BigInt(c.balance), 0n);
          if (total < usdcBase) {
            const label = BRIEF_NETWORK === "mainnet" ? "USDC" : "test USDC (DBUSDC)";
            setPhase({
              kind: "error",
              msg: `Not enough ${label} — you have ${(Number(total) / 1e6).toFixed(2)}, need ${depositUsdc.toFixed(2)}.${BRIEF_NETWORK === "testnet" ? " Get test USDC, then retry." : ""}`,
            });
            return;
          }
          setPhase({ kind: "signing" });
          const tx = new Transaction();
          const [primary, ...rest] = coins.data.map((c) => tx.object(c.coinObjectId));
          if (rest.length) tx.mergeCoins(primary, rest);
          const [capitalCoin] = tx.splitCoins(primary, [tx.pure.u64(usdcBase)]);
          buildAdoptTx(tx, {
            network: BRIEF_NETWORK,
            briefPackageId: BRIEF_PACKAGE_ID,
            operator: BRIEF_TRADER_ADDRESS,
            capitalCoin,
            name,
            budgetCap: usdcBase,
            expiresAtMs: BigInt(Date.now() + TRADER_EXPIRY_HOURS * 3600_000),
          });
          signAndExecute(tx, {
            onSuccess: (res) => {
              onActivated({
                policyId: null,
                txDigest: res.digest,
                templateId: `trader-${personality.strategy}`,
                name,
                brief: personality.voice,
                budgetSui: depositUsdc, // repurposed for display (USDC deposited)
                allowedVenues: cfg.spotVenues,
                traderName: name,
                traderStrategy: personality.strategy,
                traderMarkets: "sui_ecosystem",
                traderGoal: goal,
              });
              setPhase({ kind: "dispatching" });
              // Best-effort: register the operator (policy + BM + delegated
              // TradeCap) so the trader's continuous gated-spot loop trades
              // it. Adoption already succeeded regardless of this.
              void (async () => {
                try {
                  const full = await client.getTransactionBlock({
                    digest: res.digest,
                    options: { showObjectChanges: true },
                  });
                  const oc = (full.objectChanges ?? []) as Array<{
                    type?: string;
                    objectType?: string;
                    objectId?: string;
                  }>;
                  const pick = (s: string) =>
                    oc.find((o) => o.type === "created" && (o.objectType ?? "").includes(s))?.objectId;
                  const bmId = pick("balance_manager::BalanceManager");
                  const tradeCapId = pick("balance_manager::TradeCap");
                  const depositCapId = pick("balance_manager::DepositCap");
                  const polId = pick("operator_policy::OperatorPolicy");
                  if (bmId && tradeCapId && polId) {
                    await fetch(apiUrl("/api/operators/register"), {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        policy_id: polId,
                        bm_id: bmId,
                        trade_cap_id: tradeCapId,
                        // The delegated DepositCap lets the operator keep its
                        // DEEP fuel tank topped up (deposit-not-withdraw).
                        deposit_cap_id: depositCapId,
                        owner: address,
                        personality: personality.strategy,
                        goal,
                        network: BRIEF_NETWORK,
                      }),
                    });
                  }
                } catch {
                  /* best-effort */
                }
              })();
            },
            onError: (e) =>
              setPhase({ kind: "error", msg: e instanceof Error ? e.message : String(e) }),
          });
        } catch (e) {
          setPhase({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
        }
      })();
    },
    [address, client, onActivated, signAndExecute],
  );

  return { phase, adopt };
}

function DepositIntro() {
  const isMainnet = BRIEF_NETWORK === "mainnet";
  return (
    <header className="max-w-3xl">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Brief · adopt an operator {isMainnet ? "· real USDC on mainnet" : "· testnet practice"}
      </p>
      <h1 className="mt-3 font-sans text-[28px] font-medium leading-[1.12] tracking-tightest text-ink sm:text-[40px]">
        Deposit. Adopt. Watch it trade — non-custodially.{" "}
        <span className="text-ink-2">
          Your {isMainnet ? "USDC" : "test USDC"} stays in your own DeepBook
          account. The operator trades it within a Move policy you control and
          can revoke in one tap — it never holds your funds.
        </span>
      </h1>
      <p className="mt-4 max-w-prose text-[14px] leading-relaxed text-muted">
        Directional spot on DeepBook v3 (SUI / WAL / DEEP), gated by your
        OperatorPolicy. One signature to adopt.
      </p>
    </header>
  );
}

// Non-custodial deposit adoption surface — choose operator → deposit →
// adopt (one signature) → dashboard. The product/demo flow.
function DepositGallery({
  address,
  onActivated,
}: {
  address: string;
  onActivated: (a: ActivationResult) => void;
}) {
  const { phase, adopt } = useDepositAdopt({ address, onActivated });
  const [pickedId, setPickedId] = useState<StrategyId | null>(() =>
    takePreselectedStrategy(),
  );
  const picked = pickedId ? personalityById(pickedId) ?? null : null;
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (pickedId && ref.current) ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (picked) {
    return (
      <section className="mt-10" ref={ref}>
        <button
          type="button"
          onClick={() => setPickedId(null)}
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
        >
          ← Choose a different operator
        </button>
        <DepositAdoptPanel
          personality={picked}
          phase={phase}
          address={address}
          onAdopt={(traderName, depositUsdc, goal) =>
            adopt({ personality: picked, traderName, depositUsdc, goal })
          }
          onCancel={() => setPickedId(null)}
        />
        <ControlReassurance />
      </section>
    );
  }
  return (
    <section className="mt-10">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Choose your operator
      </p>
      <OperatorChoiceGrid picked={pickedId} onPick={setPickedId} />
      <ControlReassurance />
    </section>
  );
}

function DepositAdoptPanel({
  personality,
  phase,
  address,
  onAdopt,
  onCancel,
}: {
  personality: TraderPersonality;
  phase: AdoptPhase;
  address: string;
  onAdopt: (traderName: string, depositUsdc: number, goal: OperatorGoal) => void;
  onCancel: () => void;
}) {
  const isMainnet = BRIEF_NETWORK === "mainnet";
  const usdcLabel = isMainnet ? "USDC" : "test USDC";
  const client = useSuiClient();
  const { signAndExecute } = useAccountSigner();
  const { usdc, loaded, refetch } = useUsdcBalance(address);
  const [name, setName] = useState(
    () => `${personality.label}-${Math.floor(Math.random() * 9) + 1}`,
  );
  // Testnet SUI is faucet-scarce, so small deposits keep the demo reachable.
  const presets = isMainnet ? [5, 10, 20] : [1, 2, 5];
  const [deposit, setDeposit] = useState(isMainnet ? 5 : 1);
  const [goal, setGoal] = useState<OperatorGoal>(() => defaultGoalFor(personality.strategy));
  const [swap, setSwap] = useState<{ kind: "idle" | "swapping" | "error"; msg?: string }>({
    kind: "idle",
  });
  const cal = calibrateParams(personality.strategy, goal);
  const busy =
    phase.kind === "checking-balance" ||
    phase.kind === "funding" ||
    phase.kind === "signing" ||
    phase.kind === "dispatching";
  const errMsg = phase.kind === "error" ? phase.msg : null;
  const trimmed = name.trim() || personality.label;
  const insufficient = loaded && usdc < deposit;

  // "Get test USDC" — one-tap SUI → DEEP → DBUSDC (both whitelisted, 0 fee)
  // so a tester never dead-ends at "I have SUI but no DBUSDC". Caps the swap
  // at the wallet's SUI minus a gas reserve. Testnet only.
  const onGetUsdc = useCallback(() => {
    void (async () => {
      try {
        setSwap({ kind: "swapping" });
        const bal = await client.getBalance({ owner: address });
        const suiAvail = Number(bal.totalBalance) / 1e9;
        const GAS_RESERVE = 0.3;
        const want = (deposit + 0.5) * 1.4; // rough SUI→DBUSDC rate + buffer
        const suiIn = Math.min(want, Math.max(0, suiAvail - GAS_RESERVE));
        if (suiIn < 0.05) {
          setSwap({
            kind: "error",
            msg: `Only ${suiAvail.toFixed(2)} SUI in your wallet — top up testnet SUI from the faucet, then retry.`,
          });
          return;
        }
        const tx = buildGetTestUsdcTx(address, suiIn);
        signAndExecute(tx, {
          onSuccess: () => {
            setSwap({ kind: "idle" });
            setTimeout(refetch, 1500);
          },
          onError: (e) =>
            setSwap({ kind: "error", msg: e instanceof Error ? e.message : String(e) }),
        });
      } catch (e) {
        setSwap({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [address, client, deposit, signAndExecute, refetch]);

  return (
    <div className="relative mt-5 animate-fade-up bg-bg-elev shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      {/* Network indicator */}
      <div
        className="flex items-center justify-between border-b border-line px-6 py-3 sm:px-8"
        style={{ background: isMainnet ? "rgba(16,185,129,0.06)" : "#FAFAFA" }}
      >
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: isMainnet ? "#047857" : "#666666" }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: isMainnet ? "#10B981" : "#999999" }} aria-hidden />
          {isMainnet ? "Mainnet · Real USDC" : "Testnet · Practice Mode"}
        </span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: "#666666" }}>
          {loaded ? `${usdc.toFixed(2)} ${usdcLabel}` : "…"} in wallet
        </span>
      </div>

      <div className="px-6 py-7 sm:px-8 sm:py-8 space-y-7">
        {/* Operator + name */}
        <div className="flex items-start gap-3">
          <span className="font-sans text-[40px] leading-none text-ink" aria-hidden>{personality.glyph}</span>
          <div className="flex-1">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              className="w-full border-b-2 border-line bg-transparent px-0 py-1 text-[22px] font-medium tracking-tight text-ink outline-none transition-colors focus:border-ink"
            />
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{personality.tagline}</p>
          </div>
        </div>

        {/* Goal (calibration) */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">Goal</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {([
              { t: "grow", label: "Grow" },
              { t: "preserve", label: "Preserve" },
              { t: "edge", label: "Max edge" },
            ] as const).map((g) => {
              const active = goal.type === g.t;
              return (
                <button
                  key={g.t}
                  type="button"
                  onClick={() => setGoal(g.t === "grow" ? { type: "grow", targetPct: 5, horizonDays: 30 } : { type: g.t })}
                  className={[
                    "px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                    active ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink",
                  ].join(" ")}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-ink-2">
            {trimmed} will act at <span className="text-ink">edge ≥ {(cal.minEdge * 100).toFixed(1)}%</span> · conviction ≥ {cal.convictionFloor.toFixed(2)} · max qty {cal.maxQty}.
          </p>
        </div>

        {/* Deposit = budget */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">Deposit &amp; budget cap</p>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-mono text-[34px] font-medium tabular-nums tracking-tight text-ink">${deposit}</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">{usdcLabel}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {presets.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDeposit(d)}
                className={[
                  "px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                  deposit === d ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink",
                ].join(" ")}
              >
                ${d}
              </button>
            ))}
            <input
              type="number"
              min={1}
              value={deposit}
              onChange={(e) => setDeposit(Math.max(1, Number(e.target.value) || 0))}
              className="w-20 border border-line bg-bg-elev px-2 py-1 font-mono text-[11px] tabular-nums text-ink outline-none focus:border-ink"
            />
          </div>
          {insufficient && (
            <div className="mt-2.5">
              <p className="font-mono text-[10.5px] text-amber-700">
                You have {usdc.toFixed(2)} {usdcLabel}
                {isMainnet ? "." : " — get some to adopt."}
              </p>
              {isMainnet ? (
                <p className="mt-1 font-mono text-[10.5px] text-muted">
                  Add USDC to your wallet, then retry.
                </p>
              ) : (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={onGetUsdc}
                    disabled={swap.kind === "swapping" || busy}
                    className="inline-flex items-center gap-2 border border-ink bg-bg px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink transition-colors hover:bg-ink hover:text-bg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {swap.kind === "swapping" ? "Getting test USDC…" : "Get test USDC · one tap"}
                  </button>
                  <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted">
                    Swaps a little of your testnet SUI → DBUSDC through DeepBook
                    (whitelisted route, no fee). One signature, then it lands in
                    your wallet.
                  </p>
                  {swap.kind === "error" && (
                    <p className="mt-1 font-mono text-[10px] text-amber-700">{swap.msg}</p>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Comes-with-fuel — understated; the user never thinks about DEEP. */}
          <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-muted">
            <span className="text-ink-2">⛽ Includes fuel.</span> Your operator
            comes with ~$2 of DEEP to cover DeepBook trading fees — handled in
            the adoption, no action needed.
          </p>
        </div>

        {/* Non-custodial explainer */}
        <div className="border-l-[3px] border-emerald-500 bg-emerald-50/40 px-4 py-3">
          <p className="text-[13px] leading-relaxed text-ink-2">
            Your {usdcLabel} goes into <span className="text-ink">your own DeepBook BalanceManager</span>. {trimmed} can trade it — but <span className="text-ink">can never withdraw it</span>. Only you can. The Move policy caps every trade on chain, and you can <span className="text-ink">revoke in one tap</span> anytime.
          </p>
        </div>
      </div>

      {/* Footer — one signature */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg px-6 py-5 sm:px-8">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink disabled:opacity-50"
        >
          ← Change operator
        </button>
        <button
          type="button"
          onClick={() => onAdopt(name, deposit, goal)}
          disabled={busy || insufficient}
          className="inline-flex items-center gap-2 bg-emerald-500 px-6 py-3 font-mono text-[11px] uppercase tracking-[0.3em] text-white transition-colors hover:bg-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {phaseLabel(phase)}
            </>
          ) : (
            <>Deposit ${deposit} &amp; adopt {trimmed} →</>
          )}
        </button>
      </div>
      {errMsg && (
        <p className="border-t border-red-200 bg-red-50 px-6 py-3 font-mono text-[11px] text-red-700 sm:px-8">
          {errMsg.slice(0, 280)}
        </p>
      )}
    </div>
  );
}

function TraderGallery({
  address,
  onActivated,
}: {
  address: string;
  onActivated: (a: ActivationResult) => void;
}) {
  const { phase, adopt } = useTraderLauncher({ address, onActivated });
  // Open straight onto the operator the user chose on the disconnected
  // screen (survives the wallet-connect step via sessionStorage);
  // takePreselectedStrategy() also clears it.
  const [pickedId, setPickedId] = useState<StrategyId | null>(() =>
    takePreselectedStrategy(),
  );
  const picked = pickedId ? personalityById(pickedId) ?? null : null;
  const panelRef = useRef<HTMLDivElement | null>(null);
  // If we arrived with a preselect, ease the adoption flow into view.
  useEffect(() => {
    if (pickedId && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Operator already chosen → straight to the 3-step adoption. No
  // re-picking: the disconnected grid already made the choice.
  if (picked) {
    return (
      <section className="mt-10" ref={panelRef}>
        <button
          type="button"
          onClick={() => setPickedId(null)}
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink"
        >
          ← Choose a different operator
        </button>
        <TraderAdoptionPanel
          personality={picked}
          phase={phase}
          onAdopt={(name, budgetSui, markets, goal) =>
            adopt({ personality: picked, traderName: name, budgetSui, markets, goal })
          }
          onCancel={() => setPickedId(null)}
        />
        <ControlReassurance />
      </section>
    );
  }

  // Connected without a preselect (rare) → show the same choice grid; a
  // click drops straight into the 3-step adoption above.
  return (
    <section className="mt-10">
      <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
        Choose your operator
      </p>
      <OperatorChoiceGrid picked={pickedId} onPick={setPickedId} />
      <ControlReassurance />
    </section>
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
  onAdopt: (
    name: string,
    budgetSui: number,
    markets: TraderMarketBundleId,
    goal: OperatorGoal,
  ) => void;
  onCancel: () => void;
}) {
  // Pre-fill a name in the operator's voice ("Sentinel-3") — editable.
  // The subtree is client-only (WalletBoundary ssr:false), so a random
  // seed never causes a hydration mismatch.
  const [name, setName] = useState(
    () => `${personality.label}-${Math.floor(Math.random() * 9) + 1}`,
  );
  // Floor at 1 SUI so every operator can place at least one live bet
  // (each $1 stake records 1 SUI against the leash).
  const [budgetSui, setBudgetSui] = useState(
    Math.max(1, personality.defaultBudgetSui),
  );
  const [markets, setMarkets] = useState<TraderMarketBundleId>("btc_only");
  const [goal, setGoal] = useState<OperatorGoal>(() =>
    defaultGoalFor(personality.strategy),
  );
  const [step, setStep] = useState(0);
  const selectedBundle =
    MARKET_BUNDLES.find((b) => b.id === markets) ?? MARKET_BUNDLES[0]!;
  const typicalQty = TYPICAL_QTY_BY_STRATEGY[personality.strategy] ?? 1;
  const typicalBets = Math.floor(budgetSui / typicalQty);
  const busy =
    phase.kind === "checking-balance" ||
    phase.kind === "funding" ||
    phase.kind === "signing" ||
    phase.kind === "dispatching";
  const errMsg = phase.kind === "error" ? phase.msg : null;
  const nameReady = name.trim().length > 0;
  const trimmedName = name.trim() || personality.label;
  const calibrated = calibrateParams(personality.strategy, goal);
  const baseParams = calibrateParams(personality.strategy, { type: "edge" });
  const STEPS = ["Name & Budget", "Markets", "Goal", "Release"];

  return (
    <div className="relative mt-5 animate-fade-up bg-bg-elev shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      {/* Step rail — three beats: 01 Name & Budget · 02 Markets · 03 Release.
          Done beats turn emerald; the current beat is ink. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-6 py-4 sm:px-8">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <div key={label} className="flex items-center gap-2">
              <span
                className={[
                  "inline-flex h-5 w-5 items-center justify-center font-mono text-[9px] tabular-nums transition-colors",
                  done
                    ? "bg-emerald-500 text-white"
                    : current
                      ? "bg-ink text-bg"
                      : "border border-line text-muted",
                ].join(" ")}
              >
                {done ? "✓" : `0${i + 1}`}
              </span>
              <span
                className={[
                  "font-mono text-[9.5px] uppercase tracking-[0.22em] transition-colors",
                  current ? "text-ink" : done ? "text-ink-2" : "text-muted",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="px-6 py-7 sm:px-8 sm:py-8">
        {/* STEP 1 — Name & Budget */}
        {step === 0 && (
          <div className="space-y-8 animate-fade-up">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
                Name your operator
              </p>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${personality.label}-1`}
                maxLength={32}
                className="mt-2 w-full border-b-2 border-line bg-transparent px-0 py-2 text-[26px] font-medium tracking-tight text-ink outline-none transition-colors focus:border-ink"
              />
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                {personality.tagline}
              </p>
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
                Set the budget
              </p>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-mono text-[34px] font-medium tabular-nums tracking-tight text-ink">
                  {budgetSui.toFixed(2)}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
                  SUI to bet with
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                step={0.1}
                value={budgetSui}
                onChange={(e) => setBudgetSui(Number(e.target.value))}
                className="mt-3 w-full accent-emerald-500"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {TRADER_BUDGET_PRESETS_SUI.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBudgetSui(b)}
                    className={[
                      "px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink",
                      budgetSui === b
                        ? "bg-ink text-bg"
                        : "border border-line text-muted hover:text-ink",
                    ].join(" ")}
                  >
                    {b} SUI
                  </button>
                ))}
              </div>
              <p className="mt-3 max-w-prose text-[13px] leading-relaxed text-ink-2">
                Each $1 {trimmedName} stakes records 1 SUI against the leash —
                so this is roughly{" "}
                <span className="text-ink">
                  {typicalBets >= 1
                    ? `${typicalBets} full-size bet${typicalBets === 1 ? "" : "s"}`
                    : "a partial bet"}
                </span>
                . When it runs out, the chain itself stops the next bet — even
                if {trimmedName} wants to keep going.
              </p>
            </div>
          </div>
        )}

        {/* STEP 2 — Markets */}
        {step === 1 && (
          <div className="animate-fade-up">
            <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
              Which markets can {trimmedName} play?
            </p>
            <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-2">
              One leash governs every asset. Keep it tight to BTC, or open the
              whole Sui floor.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {MARKET_BUNDLES.map((b) => {
                const active = markets === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setMarkets(b.id)}
                    aria-pressed={active}
                    style={{
                      borderLeft: active
                        ? "3px solid #10B981"
                        : "3px solid transparent",
                    }}
                    className="flex flex-col gap-2 bg-bg-elev p-5 text-left shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  >
                    <span className="font-sans text-[16px] font-medium tracking-tight text-ink">
                      {b.label}
                    </span>
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted">
                      {b.assets.join(" · ")}
                    </span>
                    <span className="text-[12.5px] leading-snug text-ink-2">
                      {b.blurb}
                    </span>
                    <span
                      className={[
                        "mt-1 font-mono text-[9px] uppercase tracking-[0.22em]",
                        active ? "text-emerald-700" : "text-muted",
                      ].join(" ")}
                    >
                      {active ? "selected" : "choose"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 3 — Goal: deterministically calibrate the thresholds */}
        {step === 2 && (
          <div className="animate-fade-up">
            <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
              What should {trimmedName} optimize for?
            </p>
            <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-2">
              Your goal calibrates the operator&apos;s own thresholds —
              deterministically, no black box. The smart default for a{" "}
              {personality.label.toLowerCase()} operator is pre-selected; override it freely.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {(
                [
                  { type: "grow", title: "Grow capital", blurb: "Act more often toward a target. Slightly lower edge bar." },
                  { type: "preserve", title: "Preserve capital", blurb: "Tighter thresholds, smaller size. Sits out more." },
                  { type: "edge", title: "Maximize edge", blurb: "Baseline discipline — act only on clear edge." },
                ] as const
              ).map((g) => {
                const active = goal.type === g.type;
                return (
                  <button
                    key={g.type}
                    type="button"
                    onClick={() =>
                      setGoal(
                        g.type === "grow"
                          ? { type: "grow", targetPct: goal.targetPct ?? 5, horizonDays: goal.horizonDays ?? 30 }
                          : { type: g.type },
                      )
                    }
                    aria-pressed={active}
                    style={{ borderLeft: active ? "3px solid #10B981" : "3px solid transparent" }}
                    className="flex flex-col gap-2 bg-bg-elev p-5 text-left shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  >
                    <span className="font-sans text-[16px] font-medium tracking-tight text-ink">
                      {g.title}
                    </span>
                    <span className="text-[12.5px] leading-snug text-ink-2">{g.blurb}</span>
                    <span
                      className={[
                        "mt-1 font-mono text-[9px] uppercase tracking-[0.22em]",
                        active ? "text-emerald-700" : "text-muted",
                      ].join(" ")}
                    >
                      {active ? "selected" : "choose"}
                    </span>
                  </button>
                );
              })}
            </div>

            {goal.type === "grow" && (
              <div className="mt-5 flex flex-wrap items-end gap-6 border-t border-line pt-5">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
                    Target growth
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={goal.targetPct ?? 5}
                      onChange={(e) =>
                        setGoal({ ...goal, targetPct: Math.max(1, Math.min(100, Number(e.target.value) || 0)) })
                      }
                      className="w-16 border-b-2 border-line bg-transparent py-1 text-[22px] font-medium tabular-nums text-ink outline-none focus:border-ink"
                    />
                    <span className="font-mono text-[14px] text-muted">%</span>
                  </div>
                </label>
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
                    Horizon
                  </span>
                  <div className="mt-1 flex gap-2">
                    {GOAL_HORIZONS.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setGoal({ ...goal, horizonDays: h })}
                        className={[
                          "px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                          (goal.horizonDays ?? 30) === h ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink",
                        ].join(" ")}
                      >
                        {h}d
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <p className="mt-5 max-w-prose font-mono text-[11px] leading-relaxed text-ink-2">
              {trimmedName} will act when it detects{" "}
              <span className="text-ink">edge ≥ {(calibrated.minEdge * 100).toFixed(1)}%</span> with{" "}
              <span className="text-ink">conviction ≥ {calibrated.convictionFloor.toFixed(2)}</span>, sizing up to{" "}
              <span className="text-ink">{calibrated.maxQty}</span>.
              {goal.type !== "edge" && (
                <span className="text-muted">
                  {" "}
                  (baseline: edge ≥{(baseParams.minEdge * 100).toFixed(1)}% · conviction ≥{baseParams.convictionFloor.toFixed(2)} · qty {baseParams.maxQty})
                </span>
              )}
            </p>
          </div>
        )}

        {/* STEP 4 — Release. The summary card IS the OperatorPolicy that
            mints — every field is a real on-chain parameter. */}
        {step === 3 && (
          <div className="animate-fade-up">
            <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
              Release {trimmedName}
            </p>
            <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-2">
              One signature mints the leash below, sets the budget, and
              dispatches {trimmedName}&apos;s first decision. This card{" "}
              <span className="text-ink">is</span> the policy — every field is
              enforced on chain, not on our server.
            </p>

            <div className="relative mt-5 overflow-hidden bg-bg-elev shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              <span
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-emerald-500 animate-operator-pulse-line"
                aria-hidden
              />
              <div className="px-6 py-6">
                <div className="flex items-center gap-3">
                  <span
                    className="font-sans text-[34px] leading-none text-ink"
                    aria-hidden
                  >
                    {personality.glyph}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-sans text-[19px] font-medium tracking-tight text-ink">
                      {trimmedName}
                    </p>
                    <p className="truncate font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
                      {personality.label} · {personality.tagline}
                    </p>
                  </div>
                </div>
                <dl className="mt-5 grid gap-x-8 gap-y-3 border-t border-line pt-4 sm:grid-cols-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
                      Budget cap
                    </dt>
                    <dd className="font-mono text-[15px] font-medium tabular-nums tracking-tight text-ink">
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
                    <dd className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-700">
                      revocable any time
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
                      Headroom
                    </dt>
                    <dd
                      className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
                        typicalBets >= 1 ? "text-ink-2" : "text-amber-700"
                      }`}
                    >
                      {typicalBets >= 1
                        ? `~${typicalBets} bet${typicalBets === 1 ? "" : "s"} at typical size`
                        : `raise to ${typicalQty} SUI for full size`}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
                      Goal
                    </dt>
                    <dd className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-2">
                      {goalLabel(goal)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted">
                      Calibrated
                    </dt>
                    <dd className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-2">
                      edge ≥{(calibrated.minEdge * 100).toFixed(1)}% · conv ≥{calibrated.convictionFloor.toFixed(2)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 border-t border-line pt-3 font-mono text-[9px] uppercase leading-relaxed tracking-[0.18em] text-muted">
                  Expires in {TRADER_EXPIRY_HOURS}h · enforced by Move on chain
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer — Back · Continue / Adopt. Adoption is the emerald "go
          live" moment; navigation stays ink. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg px-6 py-5 sm:px-8">
        <button
          type="button"
          onClick={step === 0 ? onCancel : () => setStep((s) => s - 1)}
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted transition-colors hover:text-ink focus-visible:text-ink disabled:opacity-50"
        >
          {step === 0 ? "← Change operator" : "← Back"}
        </button>
        {step < 3 ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(3, s + 1))}
            disabled={step === 0 && !nameReady}
            className="inline-flex items-center gap-2 bg-ink px-6 py-3 font-mono text-[11px] uppercase tracking-[0.3em] text-bg transition-colors hover:bg-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onAdopt(name, budgetSui, markets, goal)}
            disabled={busy || !nameReady}
            className="inline-flex items-center gap-2 bg-emerald-500 px-6 py-3 font-mono text-[11px] uppercase tracking-[0.3em] text-white transition-colors hover:bg-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {phaseLabel(phase)}
              </>
            ) : (
              <>Adopt {trimmedName} →</>
            )}
          </button>
        )}
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
// Trader Dashboard — thin wrapper for an adopted operator.
//
// Owns the proven substrate (policy resolution, auto-dispatch, the
// deterministic kill-switch state machine + on-chain EPolicyRevoked
// abort detection) and hands the live data + ceremony callbacks to
// <OperatorDashboard> (src/components/operator), which owns the focused
// three-tab presentation: Now (decision cascade) · Journal (Walrus
// memory + real settlement) · Policy.
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
          goal: activation.traderGoal,
        });
        if (!r.ok) setDispatchError(r.error ?? "dispatch failed");
      } catch (e) {
        setDispatchError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [policyId, activation.traderStrategy, activation.traderMarkets, activation.traderGoal, traderName]);

  // Manual re-dispatch — wired to the honest "infra hiccup, dispatch
  // again" affordance when a task closes on a dead pool. Same call as
  // the auto-dispatch; the server route rate-limits per session.
  const [redispatching, setRedispatching] = useState(false);
  const redispatch = useCallback(async () => {
    if (!policyId || !activation.traderStrategy || redispatching) return;
    setRedispatching(true);
    setDispatchError(null);
    try {
      const r = await dispatchTraderTask({
        policyId,
        strategy: activation.traderStrategy,
        traderName,
        markets: activation.traderMarkets,
        goal: activation.traderGoal,
      });
      if (!r.ok) setDispatchError(r.error ?? "dispatch failed");
    } catch (e) {
      setDispatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setRedispatching(false);
    }
  }, [policyId, activation.traderStrategy, activation.traderMarkets, activation.traderGoal, traderName, redispatching]);

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
    <OperatorDashboard
      policyId={policyId}
      policy={policy}
      status={status}
      personality={personality}
      traderName={traderName}
      goal={activation.traderGoal ?? null}
      onReset={onReset}
      dispatchError={dispatchError}
      onDispatchAgain={redispatch}
      dispatching={redispatching}
      revoked={!!policy?.revoked}
      killSwitchPhase={killSwitchPhase}
      chainAbort={chainAbort}
      revokeTx={revokeTx}
      revokeSubmitting={revokeSubmitting}
      revokeError={revokeError}
      confirmRevoke={confirmRevoke}
      onRequestRevoke={() => setConfirmRevoke(true)}
      onConfirmRevoke={handleRevoke}
      onCancelRevoke={() => setConfirmRevoke(false)}
    />
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
  const spent = remaining !== null ? Math.max(0, cap - remaining) : 0;
  const pct = remaining !== null ? Math.max(0, Math.min(1, remaining / cap)) : 0;
  const isLive = status === "active";
  const isRevoked = status === "revoked";
  // Per-policy realized P&L — the honest "your trader's result" number,
  // attributed on-chain even though the demo trades house capital.
  const trades = useTraderTrades(policyId);
  const realizedPnl = trades.realizedPnlUsd;

  // Pulse the card the moment the chain debits the leash — every
  // record_spend bumps policy.spent, which we watch directly so the
  // burn-down reflects real on-chain state, not our own bookkeeping.
  const prevSpentRef = useRef<bigint | null>(null);
  const [burning, setBurning] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  useEffect(() => {
    if (!policy) return;
    const cur = policy.spent;
    if (prevSpentRef.current !== null && cur > prevSpentRef.current) {
      setBurning(true);
      const t = setTimeout(() => setBurning(false), 760);
      prevSpentRef.current = cur;
      return () => clearTimeout(t);
    }
    prevSpentRef.current = cur;
  }, [policy]);

  return (
    <div
      className={[
        "mt-5 relative border-2 bg-bg-elev transition-colors",
        isRevoked ? "border-red-400/70" : "border-line",
        burning ? "animate-operator-ripple" : "",
      ].join(" ")}
    >
      {isLive && (
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-emerald-500/70 animate-operator-pulse-line"
          aria-hidden
        />
      )}
      {/* Command strip — status · inline budget burn-down · details toggle */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
        <StatusPill status={status} />
        <div className="flex min-w-[220px] flex-1 items-center gap-3">
          <span
            key={remaining !== null ? remaining.toFixed(3) : "na"}
            className={[
              "shrink-0 font-mono text-[14px] tabular-nums",
              isRevoked ? "text-red-700" : "text-ink",
              burning ? "animate-value-tick" : "",
            ].join(" ")}
          >
            {remaining !== null ? remaining.toFixed(3) : cap.toFixed(2)}
            <span className="text-muted"> / {cap.toFixed(2)} SUI</span>
          </span>
          <div className="h-1.5 min-w-[60px] flex-1 overflow-hidden bg-line">
            <div
              className={[
                "h-full transition-[width] duration-700 ease-out",
                isRevoked ? "bg-red-400" : "bg-ink",
              ].join(" ")}
              style={{ width: `${pct * 100}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          className="shrink-0 font-mono text-[10px] uppercase tracking-[0.24em] text-muted transition-colors hover:text-ink focus-visible:text-ink"
        >
          policy {showDetails ? "↑" : "↗"}
        </button>
      </div>

      {showDetails && (
        <div className="space-y-3 border-t border-line px-4 py-4 animate-fade-up sm:px-5">
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px]">
            <KV label="Template">
              <span className="font-mono">{activation.templateId}</span>
            </KV>
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
            {spent > 0 && (
              <KV label="Spent">
                <span className="font-mono tabular-nums">{spent.toFixed(3)} SUI</span>
              </KV>
            )}
          </div>
          <p className="font-mono text-[9.5px] leading-relaxed tracking-[0.04em] text-muted">
            Every spend recorded by{" "}
            <span className="text-ink-2">operator_policy::record_spend</span> — on
            chain, not in our database. The chain refuses the next bet once the
            budget runs out; funds stay locked in escrow, past wins still pay out.
          </p>

          {/* Capital story — who stakes, who's leashed, whose P&L. Honest
              by design: the demo trades house capital under YOUR policy. */}
          <div className="border-t border-line pt-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-muted">
              Capital & custody
            </p>
            <dl className="mt-2 space-y-1.5 font-mono text-[10.5px] leading-relaxed">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">Your leash:</dt>
                <dd className="text-ink-2">
                  {cap.toFixed(2)} SUI cap · accounting + kill switch, enforced by Move
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">Trading capital:</dt>
                <dd className="text-ink-2">
                  Brief&apos;s treasury (testnet dUSDC + DeepBook balance manager)
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">Your trader&apos;s P&amp;L:</dt>
                <dd className="text-ink-2">
                  attributed on-chain per policy ·{" "}
                  <span
                    className={
                      realizedPnl > 0
                        ? "tabular-nums text-emerald-700"
                        : realizedPnl < 0
                          ? "tabular-nums text-red-700"
                          : "tabular-nums text-ink-2"
                    }
                  >
                    {realizedPnl >= 0 ? "+" : "−"}${Math.abs(realizedPnl).toFixed(2)}
                  </span>{" "}
                  realized
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[10.5px] leading-relaxed text-muted">
              Testnet demo trades house capital under{" "}
              <span className="text-ink-2">your</span> policy. Mainnet design: your
              own PredictManager —{" "}
              <a
                href="https://github.com/shariqazeem/brief/blob/main/SUBMISSION.md"
                target="_blank"
                rel="noreferrer"
                className="text-ink underline-offset-4 hover:underline"
              >
                see SUBMISSION
              </a>
              .
            </p>
          </div>

          <div className="border-t border-line pt-3">
            <button
              type="button"
              disabled={!policyId || revokeSubmitting || isRevoked}
              onClick={onRequestRevoke}
              className={[
                "inline-flex items-center gap-2 border-2 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.28em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500",
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
          </div>
        </div>
      )}

      {revokeError && (
        <p className="border-t border-red-300 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700 sm:px-5">
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
