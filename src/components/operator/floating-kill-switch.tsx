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

// The "chain holds the leash" thesis as UI: a floating REVOKE button in the
// bottom-right of every operator surface, so the owner can yank the leash at
// any moment — not only from the dashboard. Reads the active operator from
// local storage; signs operator_policy::revoke; the agent's next gated trade
// then aborts EPolicyRevoked on chain.
export function FloatingKillSwitch() {
  const signer = useAccountSigner();
  const [op, setOp] = useState<TraderIdentity | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [phase, setPhase] = useState<"idle" | "revoking" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  // Local-storage is client-only; re-read on focus so adopting/revoking in
  // another tab keeps this in sync.
  useEffect(() => {
    const read = () => setOp(loadLatestTraderIdentity());
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);

  if (!op || !signer.address) return null;

  const doRevoke = () => {
    setPhase("revoking");
    setErr(null);
    const tx = buildRevokeTx({ packageId: BRIEF_PACKAGE_ID, policyId: op.policyId });
    signer.signAndExecute(tx, {
      onSuccess: () => {
        markIdentityRevoked(op.policyId);
        setOp(null); // retire — the button disappears
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
            Revoke{" "}
            <span className="font-sans font-medium">{op.name}</span>? The chain
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
          title={`Revoke ${op.name} — the chain holds the leash`}
          className="group flex items-center gap-2 border border-[#EF4444] bg-[#EF4444] px-4 py-3 text-[10px] uppercase tracking-[0.24em] text-white shadow-[0_8px_30px_rgba(239,68,68,0.28)] transition-transform hover:-translate-y-0.5"
        >
          <span aria-hidden className="text-[13px] leading-none">⦸</span>
          Revoke Operator
        </button>
      )}
    </div>
  );
}
