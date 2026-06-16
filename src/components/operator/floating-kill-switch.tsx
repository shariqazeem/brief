"use client";

import { useEffect, useState } from "react";

import { BRIEF_PACKAGE_ID } from "@/lib/brief-client";
import { buildRevokeTx } from "@/lib/operator-policy-client";
import {
  loadLatestTraderIdentity,
  markIdentityRevoked,
  type TraderIdentity,
} from "@/lib/workforce-client";
import { useAccountSigner } from "@/lib/zklogin/signer";

const txUrl = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;

// The "chain holds the leash" thesis as UI: a floating REVOKE button in the
// bottom-right of every operator surface, so the owner can yank the leash at
// any moment — not only from the dashboard. Signs operator_policy::revoke;
// the agent's next gated trade then aborts EPolicyRevoked on chain. No
// backend call, no API-key rotation — a transaction.
export function FloatingKillSwitch() {
  const signer = useAccountSigner();
  const [op, setOp] = useState<TraderIdentity | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [phase, setPhase] = useState<"idle" | "revoking" | "revoked" | "error">("idle");
  const [revokedTx, setRevokedTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Local-storage is client-only; re-read on focus so adopting/revoking in
  // another tab keeps this in sync.
  useEffect(() => {
    const read = () => setOp(loadLatestTraderIdentity());
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);

  if (!signer.address) return null;

  // Post-revoke receipt — proves the kill happened on-chain.
  if (phase === "revoked") {
    return (
      <div className="fixed bottom-5 right-5 z-[60] w-[300px] animate-fade-up border border-[#EF4444] bg-bg-elev p-4 font-mono shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        <p className="text-[12px] font-medium text-ink">Operator revoked.</p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
          The chain enforced the kill — no backend call. Your funds stay in your
          BalanceManager; withdraw anytime.
        </p>
        {revokedTx && (
          <a
            href={txUrl(revokedTx)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-[10.5px] text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
          >
            tx {revokedTx.slice(0, 10)}… →
          </a>
        )}
        <button
          type="button"
          onClick={() => {
            setOp(null);
            setPhase("idle");
          }}
          className="mt-3 text-[10px] uppercase tracking-[0.22em] text-muted transition-colors hover:text-ink"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (!op) return null;

  const doRevoke = () => {
    setPhase("revoking");
    setErr(null);
    const tx = buildRevokeTx({ packageId: BRIEF_PACKAGE_ID, policyId: op.policyId });
    signer.signAndExecute(tx, {
      onSuccess: (res) => {
        markIdentityRevoked(op.policyId);
        setRevokedTx((res as { digest?: string })?.digest ?? null);
        setPhase("revoked");
      },
      onError: (e) => {
        setErr(e instanceof Error ? e.message : String(e));
        setPhase("error");
      },
    });
  };

  return (
    <div className="fixed bottom-5 right-5 z-[60] font-mono">
      {confirm ? (
        <div className="w-[280px] animate-fade-up border border-[#EF4444] bg-bg-elev p-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          <p className="text-[12px] leading-relaxed text-ink">
            Revoke <span className="font-sans font-medium">{op.name}</span>? The chain
            stops it on its very next trade — instantly, no matter where it is.
          </p>
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            Your funds stay in your BalanceManager. Only new trades are blocked.
          </p>
          {err && (
            <p className="mt-2 text-[10px] leading-relaxed text-[#EF4444]">{err}</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={doRevoke}
              disabled={phase === "revoking"}
              className="flex-1 bg-[#EF4444] px-3 py-2.5 text-[10px] uppercase tracking-[0.22em] text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {phase === "revoking" ? "Revoking…" : "Confirm revoke"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirm(false);
                setPhase("idle");
                setErr(null);
              }}
              disabled={phase === "revoking"}
              className="px-3 py-2.5 text-[10px] uppercase tracking-[0.22em] text-muted transition-colors hover:text-ink disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          title="Revoke on-chain. The operator stops immediately. No backend call needed."
          className="group flex items-center gap-2 border bg-bg-elev px-3.5 py-2.5 text-[10px] uppercase tracking-[0.22em] shadow-[0_2px_10px_rgba(0,0,0,0.08)] transition-colors hover:border-[#EF4444]"
          style={{ borderColor: "#E5E5EA", color: "#525560" }}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Operator active
          <span className="transition-colors group-hover:text-[#EF4444]" style={{ color: "#8E8E93" }}>· Revoke →</span>
        </button>
      )}
    </div>
  );
}
