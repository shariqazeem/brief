"use client";

import { useEffect, useState } from "react";
import { Transaction } from "@mysten/sui/transactions";

import { apiUrl } from "@/lib/api-base";
import { explorerUrl } from "@/lib/brief-client";
import { INK, SUB, MUTED, NAVY, EMERALD, RED } from "@/lib/ui";
import { buildWithdrawAllTx } from "@/lib/deepbook-withdraw";
import type { DeepBookNetwork } from "@/lib/deepbook-adopt";
import { useAccountSigner } from "@/lib/zklogin/signer";

// Withdraw funds · the non-custodial guarantee made tangible. The owner pulls
// USDC + SUI + DEEP out of their BalanceManager, to their wallet, in one
// signature. Owner-gated on-chain (the operator literally cannot do this), so
// the button only ever appears for the connected owner.
type Custody = { bmId: string; owner: string; network: DeepBookNetwork };

export function WithdrawFunds({ policyId }: { policyId: string | null }) {
  const signer = useAccountSigner();
  const [custody, setCustody] = useState<Custody | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [phase, setPhase] = useState<"idle" | "withdrawing" | "done" | "error">("idle");
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!policyId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(apiUrl(`/api/operators/register?policy_id=${encodeURIComponent(policyId)}`));
        if (!r.ok) return;
        const j = (await r.json()) as { bm_id?: string; owner?: string; network?: string };
        if (!cancelled && j.bm_id && j.owner) {
          setCustody({
            bmId: j.bm_id,
            owner: j.owner,
            network: j.network === "mainnet" ? "mainnet" : "testnet",
          });
        }
      } catch {
        /* withdraw stays hidden if we can't resolve the BM */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [policyId]);

  // Need a connected wallet + resolved custody to offer withdrawal.
  if (!signer.address || !custody) return null;
  const isOwner = signer.address.toLowerCase() === custody.owner.toLowerCase();

  const doWithdraw = () => {
    setPhase("withdrawing");
    setErr(null);
    const t = new Transaction();
    buildWithdrawAllTx(t, { network: custody.network, bmId: custody.bmId, owner: custody.owner });
    signer.signAndExecute(t, {
      onSuccess: (res: { digest?: string }) => {
        setTx(res?.digest ?? null);
        setPhase("done");
      },
      onError: (e: Error) => {
        setErr(e instanceof Error ? e.message : String(e));
        setPhase("error");
      },
    });
  };

  return (
    <section className="bg-bg-elev px-6 py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-9">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: NAVY }}>
        Your funds
      </p>
      {phase === "done" ? (
        <div className="mt-2">
          <p className="font-sans text-[18px] font-medium tracking-tight" style={{ color: EMERALD }}>
            Withdrawn to your wallet.
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: SUB }}>
            All USDC, SUI, and DEEP swept out of your BalanceManager · proof that
            custody was always yours.
          </p>
          {tx && (
            <a
              href={explorerUrl("txblock", tx)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-mono text-[11px] underline-offset-2 hover:underline"
              style={{ color: NAVY }}
            >
              {tx.slice(0, 10)}… on Suiscan ↗
            </a>
          )}
        </div>
      ) : (
        <>
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: SUB }}>
            Your capital lives in <span style={{ color: INK }}>your own BalanceManager</span> -
            withdraw it to your wallet any time, in one signature. The operator can trade it
            but can never withdraw it.
          </p>
          {!isOwner ? (
            <p className="mt-3 font-mono text-[11px]" style={{ color: MUTED }}>
              Connected wallet isn&apos;t the owner · only the owner can withdraw.
            </p>
          ) : confirm ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={doWithdraw}
                  disabled={phase === "withdrawing"}
                  className="bg-[#1a2c4e] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {phase === "withdrawing" ? "Withdrawing…" : "Confirm · withdraw all"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirm(false);
                    setErr(null);
                  }}
                  disabled={phase === "withdrawing"}
                  className="font-mono text-[10px] uppercase tracking-[0.2em] transition-colors hover:text-ink disabled:opacity-60"
                  style={{ color: SUB }}
                >
                  Cancel
                </button>
              </div>
              {err && (
                <p className="mt-2 font-mono text-[10.5px] leading-relaxed" style={{ color: RED }}>
                  {err.slice(0, 160)}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="mt-3 border px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors hover:border-[#1a2c4e]"
              style={{ borderColor: "#E5E5EA", color: NAVY }}
            >
              Withdraw funds →
            </button>
          )}
        </>
      )}
    </section>
  );
}
