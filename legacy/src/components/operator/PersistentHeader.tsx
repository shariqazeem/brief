"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldOff, X } from "lucide-react";
import {
  ConnectButton,
  useDisconnectWallet,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import {
  deriveOperatorState,
  OPERATOR_STATE_LABEL,
  operatorStateTone,
} from "@/lib/operator-state";
import {
  buildRevokeTx,
  type OperatorPolicyDecoded,
  formatCountdown,
  formatSui,
} from "@/lib/operator-policy-client";
import { BRIEF_PACKAGE_ID } from "@/lib/brief-client";
import type { DecodedWorkObject } from "@/lib/work-object";
import { PulseDot } from "./PulseDot";

/**
 * Sticky app chrome. Always shows the Brief mark + wallet menu. When a
 * LIVE operator is passed in, embeds its identity, remaining budget,
 * expiry countdown, and the kill switch — so operator context never
 * leaves the viewport while the user scrolls.
 *
 * Data is passed in (not fetched internally) so the AppPage owns a
 * single source of truth and no duplicate polling.
 */
export function PersistentHeader({
  liveOperator,
  latestAction,
}: {
  liveOperator?: OperatorPolicyDecoded;
  latestAction?: DecodedWorkObject;
}) {
  const [revokeOpen, setRevokeOpen] = useState(false);

  // Listen for global "brief:revoke" events fired from the Command Palette.
  // Lets ⌘K → "Revoke operator" open this header's existing modal without
  // duplicating revoke UI elsewhere.
  useEffect(() => {
    if (!liveOperator) return;
    const handler = () => setRevokeOpen(true);
    window.addEventListener("brief:revoke", handler);
    return () => window.removeEventListener("brief:revoke", handler);
  }, [liveOperator]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-page items-center gap-4 px-6 sm:px-10">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5 text-ink hover:text-ink-2"
          >
            <BriefMark />
            <span className="text-[14px] font-medium tracking-tight">Brief</span>
          </Link>

          {liveOperator ? (
            <>
              <Divider />
              <OperatorContext
                policy={liveOperator}
                latestAction={latestAction}
                onRevoke={() => setRevokeOpen(true)}
              />
            </>
          ) : (
            <div className="grow" aria-hidden />
          )}

          <ConnectButton
            connectText="Connect"
            className="!h-9 !rounded-full !px-3 !text-[12.5px]"
          />
        </div>
      </header>

      {liveOperator ? (
        <RevokeModal
          open={revokeOpen}
          onClose={() => setRevokeOpen(false)}
          policy={liveOperator}
        />
      ) : null}
    </>
  );
}

function OperatorContext({
  policy,
  latestAction,
  onRevoke,
}: {
  policy: OperatorPolicyDecoded;
  latestAction: DecodedWorkObject | undefined;
  onRevoke: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const state = deriveOperatorState(policy, latestAction, now);
  const stateLabel = OPERATOR_STATE_LABEL[state];
  const tone = operatorStateTone(state);
  const remaining = policy.budgetCap - policy.spent;
  const expiresInMs = Math.max(0, Number(policy.expiresAtMs) - now);

  // Brief green tick when the remaining budget drops (a new spend just
  // recorded on-chain). Subliminal — judges feel the live update even if
  // they don't notice. Skips the first mount.
  const prevRemainingRef = useRef<bigint>(remaining);
  const isFirstRef = useRef(true);
  const [tickKey, setTickKey] = useState(0);
  useEffect(() => {
    if (isFirstRef.current) {
      isFirstRef.current = false;
      prevRemainingRef.current = remaining;
      return;
    }
    if (prevRemainingRef.current !== remaining) {
      setTickKey((k) => k + 1);
      prevRemainingRef.current = remaining;
    }
  }, [remaining]);

  // Latest world-state regime — read from the most recent Operator payload.
  // Shown as a small badge on the right. Falls back to nothing if no payload.
  const worldRegime = readWorldRegime(latestAction);

  return (
    <div className="flex min-w-0 grow items-center gap-3">
      <div className="flex items-center gap-2">
        <PulseDot state={state} size="sm" />
        <span
          className={`font-mono text-[10.5px] uppercase tracking-[0.2em] ${
            tone === "kill"
              ? "text-red-700"
              : tone === "ended"
                ? "text-muted"
                : "text-green-700"
          }`}
        >
          {stateLabel}
        </span>
      </div>

      <span
        className="truncate text-[13.5px] font-medium text-ink"
        title={policy.name}
      >
        {policy.name}
      </span>

      {worldRegime && tone === "live" ? (
        <WorldRegimePill regime={worldRegime} />
      ) : null}

      <div className="ml-auto hidden items-center gap-3 font-mono text-[11px] tabular-nums text-ink-2 sm:flex">
        <span
          key={tickKey}
          className={tickKey > 0 ? "animate-value-tick" : undefined}
        >
          {formatSui(remaining)} SUI
        </span>
        <span className="text-muted">·</span>
        <span className="text-muted">
          {expiresInMs > 0 ? formatCountdown(policy.expiresAtMs) : "0s"}
        </span>
      </div>

      <button
        onClick={onRevoke}
        className="ml-2 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-red-200 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-red-700 transition-colors hover:border-red-300 hover:bg-red-50"
      >
        Revoke
      </button>
    </div>
  );
}

function readWorldRegime(action: DecodedWorkObject | undefined): string | null {
  if (!action || action.kind !== "Operator" || !action.payloadBytes) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(action.payloadBytes)) as {
      world_state?: { regime?: string };
    };
    return json.world_state?.regime ?? null;
  } catch {
    return null;
  }
}

function WorldRegimePill({ regime }: { regime: string }) {
  const palette: Record<string, { dot: string; text: string }> = {
    calm: { dot: "bg-green-600", text: "text-green-800" },
    elevated: { dot: "bg-amber-500", text: "text-amber-700" },
    defensive: { dot: "bg-amber-600", text: "text-amber-800" },
    fragmented: { dot: "bg-amber-500", text: "text-amber-700" },
    stressed: { dot: "bg-red-600", text: "text-red-700" },
    unknown: { dot: "bg-muted", text: "text-muted" },
  };
  const p = palette[regime] ?? palette.unknown!;
  return (
    <div
      className="hidden items-center gap-1.5 rounded-full border border-line px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.18em] sm:inline-flex"
      title={`world state · ${regime}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${p.dot}`} aria-hidden />
      <span className={p.text}>world · {regime}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revoke modal — focused confirmation
// ---------------------------------------------------------------------------

function RevokeModal({
  open,
  onClose,
  policy,
}: {
  open: boolean;
  onClose: () => void;
  policy: OperatorPolicyDecoded;
}) {
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isPending, onClose]);

  if (!open) return null;

  const revoke = () => {
    setError(null);
    const tx = buildRevokeTx({
      packageId: BRIEF_PACKAGE_ID,
      policyId: policy.id,
    });
    signAndExecute(
      { transaction: tx },
      {
        onError: (e) => setError(e.message),
        onSuccess: () => {
          setError(null);
          onClose();
        },
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-[18px] border border-red-200 bg-bg-elev shadow-xl">
        <div className="border-b border-red-100 bg-red-50 px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldOff
                className="mt-0.5 h-5 w-5 text-red-700"
                strokeWidth={1.75}
              />
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-red-700">
                  revoke mandate
                </p>
                <p className="mt-1 text-[15px] font-medium text-red-800">
                  {policy.name}
                </p>
              </div>
            </div>
            {!isPending ? (
              <button
                onClick={onClose}
                className="text-red-700 hover:text-red-900"
                aria-label="Close"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="px-6 py-5">
          <p className="text-[13.5px] leading-[1.6] text-ink-2">
            One signature flips{" "}
            <code className="font-mono text-ink">policy.revoked = true</code>{" "}
            on Sui. The operator&rsquo;s next attempted spend hits{" "}
            <code className="font-mono text-ink">assert_can_spend</code> and
            aborts on-chain with abort code 3 (<em>EPolicyRevoked</em>). The
            chain blocks it, not our server.
          </p>
          <p className="mt-3 text-[12.5px] leading-[1.55] text-muted">
            Irreversible for this policy. Past actions remain on-chain
            forever as an audit trail.
          </p>

          {error ? (
            <p className="mt-3 font-mono text-[11px] text-red-700">{error}</p>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={isPending}
              className="rounded-full border border-line-strong bg-bg px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={revoke}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-full bg-red-700 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-red-800 disabled:opacity-50"
            >
              {isPending ? (
                <>
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    strokeWidth={1.75}
                  />
                  Signing…
                </>
              ) : (
                <>Revoke mandate</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

function Divider() {
  return <span className="h-5 w-px shrink-0 bg-line" aria-hidden />;
}

function BriefMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="2" y="5" width="16" height="2" rx="0.5" fill="currentColor" />
      <rect x="2" y="13" width="11" height="2" rx="0.5" fill="currentColor" />
    </svg>
  );
}

/**
 * The Slush wallet bug recovery panel. Re-exported here for compatibility
 * with code that previously imported it from page.tsx — same component.
 */
export function WalletSessionFix({
  message,
  onCleared,
}: {
  message: string;
  onCleared?: () => void;
}) {
  const { mutate: disconnect, isPending } = useDisconnectWallet();
  return (
    <div className="rounded-[12px] border border-amber-200 bg-amber-50 p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-amber-800">
        wallet session needs a reset
      </p>
      <p className="mt-2 text-[13px] leading-[1.55] text-amber-900">
        Wallet returned <span className="font-mono">{message.slice(0, 100)}</span>.
        Known wallet race after a hot-reload — disconnecting and reconnecting clears it.
      </p>
      <button
        onClick={() =>
          disconnect(undefined, { onSuccess: () => onCleared?.() })
        }
        disabled={isPending}
        className="mt-3 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-bg disabled:opacity-50"
      >
        {isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            Resetting…
          </>
        ) : (
          <>Disconnect &amp; reconnect</>
        )}
      </button>
    </div>
  );
}

export function isWalletSessionError(msg: string | null): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes("incorrect password") ||
    m.includes("invalid password") ||
    m.includes("unlock") ||
    m.includes("wallet is locked") ||
    m.includes("session expired") ||
    m.includes("session invalid")
  );
}
