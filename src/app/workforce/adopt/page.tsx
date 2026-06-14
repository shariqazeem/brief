"use client";

// The front door. One scrollable page that progressively reveals as the
// judge completes each action — connect → choose → budget → deposit → adopt.
// No steps, no next/back. Adoption is ONE signature that creates the user's
// BalanceManager, deposits USDC, delegates a trade-not-withdraw TradeCap +
// a deposit-not-withdraw DepositCap (the fuel access), and creates the
// chain-enforced OperatorPolicy. Then it redirects to the live operator.

import { ConnectButton, useSuiClient } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useCallback, useEffect, useState } from "react";

import { FloatingKillSwitch } from "@/components/operator/floating-kill-switch";
import { WalletBoundary } from "@/components/wallet-boundary";
import { apiUrl } from "@/lib/api-base";
import {
  BRIEF_NETWORK,
  BRIEF_PACKAGE_ID,
  BRIEF_TRADER_ADDRESS,
} from "@/lib/brief-client";
import { buildAdoptTx, DEEPBOOK_CFG } from "@/lib/deepbook-adopt";
import { buildGetTestUsdcTx } from "@/lib/deepbook-get-usdc";
import { defaultGoalFor } from "@/lib/operator-goal";
import {
  personalityById,
  saveTraderIdentity,
  TRADER_PERSONALITIES,
  type StrategyId,
  type TraderPersonality,
} from "@/lib/workforce-client";
import { useAccountSigner } from "@/lib/zklogin/signer";

const TRADER_EXPIRY_HOURS = 24;
const PRESETS = [5, 10, 20];

// Risk read per personality (conservative → aggressive). Cosmetic — the real
// limit is the on-chain budget cap the user sets below.
const RISK: Record<StrategyId, { level: number; label: string }> = {
  conservative: { level: 1, label: "Conservative" },
  momentum: { level: 3, label: "Aggressive" },
  contrarian: { level: 3, label: "Aggressive" },
  quant: { level: 4, label: "Quant edge" },
};

const ADOPT_STEPS = [
  "Creating your BalanceManager",
  "Depositing your USDC",
  "Delegating trade access (TradeCap)",
  "Delegating fuel access (DepositCap)",
  "Creating your OperatorPolicy",
];

type AdoptState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "signing" }
  | { kind: "progress"; step: number; policyId: string }
  | { kind: "live"; policyId: string }
  | { kind: "error"; msg: string };

export default function AdoptPage() {
  return (
    <WalletBoundary>
      <AdoptWizard />
      <FloatingKillSwitch />
    </WalletBoundary>
  );
}

function AdoptWizard() {
  const signer = useAccountSigner();
  const client = useSuiClient();
  const address = signer.address;
  const isMainnet = BRIEF_NETWORK === "mainnet";
  const usdcLabel = isMainnet ? "USDC" : "test USDC";

  const [picked, setPicked] = useState<StrategyId | null>(null);
  const [amount, setAmount] = useState<number>(5);
  const [sui, setSui] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number>(0);
  const [usdcLoaded, setUsdcLoaded] = useState(false);
  const [swap, setSwap] = useState<{ kind: "idle" | "swapping" | "error"; msg?: string }>({
    kind: "idle",
  });
  const [adopt, setAdopt] = useState<AdoptState>({ kind: "idle" });

  const personality = picked ? personalityById(picked) ?? null : null;
  const cfg = DEEPBOOK_CFG[BRIEF_NETWORK];

  // Live balances (SUI for the hero, capital coin for the deposit step).
  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const [s, coins] = await Promise.all([
        client.getBalance({ owner: address }),
        client.getCoins({ owner: address, coinType: cfg.capitalCoinType }),
      ]);
      setSui(Number(s.totalBalance) / 1e9);
      const total = coins.data.reduce((a, c) => a + BigInt(c.balance), 0n);
      setUsdc(Number(total) / 1e6);
      setUsdcLoaded(true);
    } catch {
      setUsdcLoaded(true);
    }
  }, [address, client, cfg.capitalCoinType]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Progressive-reveal gates.
  const showChoose = !!address;
  const showBudget = showChoose && !!picked;
  const showDeposit = showBudget && amount > 0;
  const showAdopt = showDeposit && amount > 0 && adopt.kind !== "live";
  const insufficient = usdcLoaded && usdc < amount;

  // "Get test USDC" — one tap SUI→DBUSDC (testnet), capped at wallet SUI.
  const onGetUsdc = useCallback(() => {
    if (!address) return;
    void (async () => {
      try {
        setSwap({ kind: "swapping" });
        const bal = await client.getBalance({ owner: address });
        const avail = Number(bal.totalBalance) / 1e9;
        const suiIn = Math.min((amount + 0.5) * 1.4, Math.max(0, avail - 0.3));
        if (suiIn < 0.05) {
          setSwap({
            kind: "error",
            msg: `Only ${avail.toFixed(2)} SUI — top up testnet SUI from the faucet, then retry.`,
          });
          return;
        }
        signer.signAndExecute(buildGetTestUsdcTx(address, suiIn), {
          onSuccess: () => {
            setSwap({ kind: "idle" });
            setTimeout(() => void refresh(), 1500);
          },
          onError: (e) =>
            setSwap({ kind: "error", msg: e instanceof Error ? e.message : String(e) }),
        });
      } catch (e) {
        setSwap({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [address, client, amount, signer, refresh]);

  // The one signature.
  const onAdopt = useCallback(() => {
    if (!address || !personality) return;
    void (async () => {
      setAdopt({ kind: "checking" });
      const base = BigInt(Math.round(amount * 1e6));
      try {
        const coins = await client.getCoins({ owner: address, coinType: cfg.capitalCoinType });
        const total = coins.data.reduce((a, c) => a + BigInt(c.balance), 0n);
        if (total < base) {
          setAdopt({
            kind: "error",
            msg: `Not enough ${usdcLabel} — you have ${(Number(total) / 1e6).toFixed(2)}, need ${amount.toFixed(2)}.`,
          });
          return;
        }
        setAdopt({ kind: "signing" });
        const tx = new Transaction();
        const [primary, ...rest] = coins.data.map((c) => tx.object(c.coinObjectId));
        if (rest.length) tx.mergeCoins(primary, rest);
        const [capitalCoin] = tx.splitCoins(primary, [tx.pure.u64(base)]);
        const goal = defaultGoalFor(personality.strategy);
        const name = `${personality.label}-${Math.floor(Math.random() * 90) + 10}`;
        buildAdoptTx(tx, {
          network: BRIEF_NETWORK,
          briefPackageId: BRIEF_PACKAGE_ID,
          operator: BRIEF_TRADER_ADDRESS,
          capitalCoin,
          name,
          budgetCap: base,
          expiresAtMs: BigInt(Date.now() + TRADER_EXPIRY_HOURS * 3600_000),
        });
        signer.signAndExecute(tx, {
          onSuccess: (res) => {
            void (async () => {
              let policyId = "";
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
                policyId = pick("operator_policy::OperatorPolicy") ?? "";
                const bmId = pick("balance_manager::BalanceManager");
                const tradeCapId = pick("balance_manager::TradeCap");
                const depositCapId = pick("balance_manager::DepositCap");
                if (policyId && bmId && tradeCapId) {
                  saveTraderIdentity({
                    policyId,
                    name,
                    strategy: personality.strategy,
                    adoptedAtMs: Date.now(),
                  });
                  void fetch(apiUrl("/api/operators/register"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      policy_id: policyId,
                      bm_id: bmId,
                      trade_cap_id: tradeCapId,
                      deposit_cap_id: depositCapId,
                      owner: address,
                      personality: personality.strategy,
                      goal,
                      network: BRIEF_NETWORK,
                    }),
                  }).catch(() => {});
                }
              } catch {
                /* ids best-effort */
              }
              // Narrate the one tx's five steps, then go live + redirect.
              setAdopt({ kind: "progress", step: 0, policyId });
              ADOPT_STEPS.forEach((_, i) => {
                setTimeout(() => setAdopt({ kind: "progress", step: i + 1, policyId }), 260 * (i + 1));
              });
              setTimeout(() => setAdopt({ kind: "live", policyId }), 260 * (ADOPT_STEPS.length + 1) + 200);
              if (policyId) {
                setTimeout(() => {
                  window.location.href = `/workforce?policy=${policyId}`;
                }, 260 * (ADOPT_STEPS.length + 1) + 2600);
              }
            })();
          },
          onError: (e) =>
            setAdopt({ kind: "error", msg: e instanceof Error ? e.message : String(e) }),
        });
      } catch (e) {
        setAdopt({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [address, personality, amount, client, cfg.capitalCoinType, signer, usdcLabel]);

  const busy = adopt.kind === "checking" || adopt.kind === "signing";

  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:px-10 sm:py-24">
        {/* ─── Section 1 · Hero ─────────────────────────────────────── */}
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">
            Brief · {isMainnet ? "real USDC on mainnet" : "testnet"}
          </p>
          <h1 className="mt-4 font-sans text-[34px] font-medium leading-[1.08] tracking-tight text-ink sm:text-[52px]">
            Adopt an Autonomous
            <br />
            Financial Operator.
          </h1>
          <p className="mt-4 font-mono text-[13px] uppercase tracking-[0.28em] text-emerald-600">
            The chain holds the leash.
          </p>

          <div className="mt-8">
            {!address ? (
              <ConnectButton
                connectText="Connect Wallet"
                className="!rounded-none !bg-ink !px-6 !py-3 !font-mono !text-[11px] !uppercase !tracking-[0.28em] !text-bg"
              />
            ) : (
              <div className="inline-flex items-center gap-4 border border-line bg-bg-elev px-5 py-3">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                <span className="font-mono text-[11px] text-ink-2">
                  {address.slice(0, 6)}…{address.slice(-4)}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {sui == null ? "…" : `${sui.toFixed(2)} SUI`}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* ─── Section 2 · Choose your operator ─────────────────────── */}
        {showChoose && (
          <section className="mt-16 animate-fade-up">
            <SectionLabel n="01" title="Choose your operator" />
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {TRADER_PERSONALITIES.map((p) => (
                <OperatorCard
                  key={p.strategy}
                  p={p}
                  selected={picked === p.strategy}
                  onPick={() => setPicked(p.strategy)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ─── Section 3 · Set the budget (the leash) ───────────────── */}
        {showBudget && personality && (
          <section className="mt-16 animate-fade-up">
            <SectionLabel n="02" title="Set the leash" />
            <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-2">
              The most {personality.label} can ever spend. The chain enforces it —
              the operator physically cannot exceed this.
            </p>
            <div className="mt-5 flex items-baseline gap-3">
              <span className="font-mono text-[40px] font-medium tabular-nums tracking-tight text-ink">
                ${amount}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
                {usdcLabel}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setAmount(d)}
                  className={`px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    amount === d ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink"
                  }`}
                >
                  ${d}
                </button>
              ))}
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 0))}
                className="w-20 border border-line bg-bg-elev px-3 py-1.5 font-mono text-[12px] tabular-nums text-ink outline-none focus:border-ink"
              />
            </div>
            <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-ink-2">
              {personality.label} will never spend more than{" "}
              <span className="text-ink">${amount} {usdcLabel}</span>. Enforced on-chain.
            </p>
          </section>
        )}

        {/* ─── Section 4 · Deposit ──────────────────────────────────── */}
        {showDeposit && personality && (
          <section className="mt-16 animate-fade-up">
            <SectionLabel n="03" title="Deposit your capital" />
            <div className="mt-4 border-l-[3px] border-emerald-500 bg-emerald-50/40 px-4 py-3">
              <p className="text-[13px] leading-relaxed text-ink-2">
                Your {usdcLabel} goes into{" "}
                <span className="text-ink">your own DeepBook BalanceManager</span>.
                The operator can trade it — but{" "}
                <span className="text-ink">can never withdraw it</span>. Only you can.
              </p>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                Depositing
              </span>
              <span className="font-mono text-[15px] tabular-nums text-ink">
                ${amount} {usdcLabel}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-muted">
                In wallet
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink-2">
                {usdcLoaded ? `${usdc.toFixed(2)} ${usdcLabel}` : "…"}
              </span>
            </div>

            {insufficient && !isMainnet && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onGetUsdc}
                  disabled={swap.kind === "swapping"}
                  className="inline-flex items-center gap-2 border border-ink bg-bg px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink transition-colors hover:bg-ink hover:text-bg disabled:opacity-50"
                >
                  {swap.kind === "swapping" ? "Getting test USDC…" : "Get test USDC · one tap"}
                </button>
                <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted">
                  Swaps a little of your testnet SUI → DBUSDC through DeepBook
                  (whitelisted route, no fee). One signature.
                </p>
                {swap.kind === "error" && (
                  <p className="mt-1 font-mono text-[10px] text-amber-700">{swap.msg}</p>
                )}
              </div>
            )}
            {insufficient && isMainnet && (
              <p className="mt-3 font-mono text-[10.5px] text-amber-700">
                You have {usdc.toFixed(2)} USDC. Add USDC to your wallet, then retry.
              </p>
            )}

            <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-muted">
              <span className="text-ink-2">⛽ Includes fuel.</span> Trading fees on
              DeepBook are paid in DEEP — your operator is fueled automatically, so
              you never touch it.
            </p>
          </section>
        )}

        {/* ─── Section 5 · Adopt (one signature) ────────────────────── */}
        {showAdopt && personality && (
          <section className="mt-16 animate-fade-up">
            <SectionLabel n="04" title="Adopt" />
            {adopt.kind === "progress" ? (
              <AdoptProgress step={adopt.step} />
            ) : (
              <>
                <button
                  type="button"
                  onClick={onAdopt}
                  disabled={busy || insufficient}
                  className="w-full bg-emerald-500 px-6 py-4 font-mono text-[12px] uppercase tracking-[0.3em] text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-10"
                >
                  {busy ? "Awaiting signature…" : `Adopt ${personality.label} — One Signature`}
                </button>
                <p className="mt-3 max-w-prose font-mono text-[10.5px] leading-relaxed text-muted">
                  This single transaction creates your BalanceManager, deposits your
                  USDC, delegates a trade-not-withdraw TradeCap and a DepositCap for
                  fuel, and creates your on-chain OperatorPolicy.
                </p>
                {adopt.kind === "error" && (
                  <p className="mt-2 max-w-prose font-mono text-[10.5px] leading-relaxed text-[#EF4444]">
                    {adopt.msg}
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {/* ─── Live · redirecting ───────────────────────────────────── */}
        {adopt.kind === "live" && (
          <section className="mt-16 animate-fade-up">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
              <h2 className="font-sans text-[22px] font-medium tracking-tight text-ink">
                Your operator is live.
              </h2>
            </div>
            <p className="mt-2 font-mono text-[11px] text-ink-2">
              policy{" "}
              <span className="text-ink">
                {adopt.policyId ? `${adopt.policyId.slice(0, 10)}…${adopt.policyId.slice(-4)}` : "—"}
              </span>
            </p>
            {adopt.policyId && (
              <a
                href={`/workforce?policy=${adopt.policyId}`}
                className="mt-4 inline-block bg-ink px-6 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-bg transition-opacity hover:opacity-90"
              >
                Open operator →
              </a>
            )}
            <p className="mt-3 font-mono text-[10px] text-muted">Taking you there…</p>
          </section>
        )}
      </div>
    </main>
  );
}

function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] tabular-nums text-muted">{n}</span>
      <span className="h-px flex-1 bg-line" />
      <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted">{title}</span>
    </div>
  );
}

function OperatorCard({
  p,
  selected,
  onPick,
}: {
  p: TraderPersonality;
  selected: boolean;
  onPick: () => void;
}) {
  const risk = RISK[p.strategy];
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex min-h-[180px] flex-col border bg-bg-elev p-4 text-left transition-colors ${
        selected ? "border-emerald-500" : "border-line hover:border-line-strong"
      }`}
      style={{ borderWidth: selected ? 2 : 1 }}
    >
      <span className="font-sans text-[28px] leading-none text-ink" aria-hidden>
        {p.glyph}
      </span>
      <span className="mt-3 font-sans text-[16px] font-medium tracking-tight text-ink">
        {p.label}
      </span>
      <span className="mt-1 flex-1 text-[12px] leading-snug text-ink-2">{p.tagline}</span>
      <div className="mt-3">
        <div className="flex items-center gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="h-1 flex-1"
              style={{ background: i < risk.level ? "#F59E0B" : "#E5E5EA" }}
            />
          ))}
        </div>
        <span className="mt-1.5 block font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
          {risk.label}
        </span>
      </div>
    </button>
  );
}

function AdoptProgress({ step }: { step: number }) {
  return (
    <ul className="space-y-2.5">
      {ADOPT_STEPS.map((label, i) => {
        const done = step > i;
        const active = step === i;
        return (
          <li key={label} className="flex items-center gap-3">
            <span
              className="flex h-4 w-4 items-center justify-center text-[11px]"
              style={{ color: done ? "#10B981" : active ? "#F59E0B" : "#C7C7CC" }}
              aria-hidden
            >
              {done ? "✓" : active ? "•" : "○"}
            </span>
            <span
              className="font-mono text-[12px]"
              style={{ color: done ? "#0A0A0A" : active ? "#525560" : "#8E8E93" }}
            >
              {label}
              {done ? "" : active ? "…" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
