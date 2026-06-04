"use client";

import { useEffect, useState } from "react";
import { ShieldOff } from "lucide-react";
import {
  type OperatorPolicyDecoded,
} from "@/lib/operator-policy-client";
import { secondsUntilNextScan } from "@/lib/operator-state";
import type { DecodedWorkObject } from "@/lib/work-object";

// Demo cadence — matches BRIEF_OPERATOR_CYCLE_MS in .env.local.
const OPERATOR_CYCLE_MS = 15_000;
const OPERATOR_CYCLE_SEC = OPERATOR_CYCLE_MS / 1000;
/** Below this many seconds, switch to the "imminent" treatment. */
const IMMINENT_THRESHOLD_SEC = 5;

/**
 * Liminal-state banner — shown only between the moment the revoke tx
 * confirms on-chain and the moment the chain actually aborts the
 * agent's next attempt (the on-chain Rejection mint).
 *
 * This is the *tension* beat of the kill switch. The user has signed,
 * the policy says revoked, but the agent's next cycle hasn't yet hit
 * the assertion. The banner narrates that interval honestly.
 *
 * Tension escalates as the countdown approaches zero:
 *   - background fades deeper red
 *   - border deepens
 *   - the scanner line accelerates
 *   - under 5s the eyebrow flips to "imminent" with a larger countdown
 *
 * It auto-disappears the moment any Rejection lands.
 */
export function RevokePendingBanner({
  policy,
  actions,
}: {
  policy: OperatorPolicyDecoded;
  actions: DecodedWorkObject[];
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Tick every 200ms so the countdown + scanner-duration interpolation
    // updates smoothly under the user's eye. Cheap — small computation.
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  // Only render when:
  //   - the policy is revoked on-chain
  //   - we have not yet seen a Rejection WorkObject parented to this policy
  const hasRejection = actions.some((a) => a.kind === "Rejection");
  if (!policy.revoked || hasRejection) return null;

  const latestActionMs = actions[0] ? Number(actions[0].timestampMs) : null;
  const untilSec = secondsUntilNextScan(
    policy,
    latestActionMs,
    OPERATOR_CYCLE_MS,
    now,
  );

  // 0 at the start of the tension window, 1 at zero. Determines how loud
  // the visual + motion treatment runs. Always monotonically rises while
  // the banner is visible.
  const intensity = Math.max(
    0,
    Math.min(1, (OPERATOR_CYCLE_SEC - untilSec) / OPERATOR_CYCLE_SEC),
  );
  const imminent = untilSec <= IMMINENT_THRESHOLD_SEC;

  // Visual interpolations
  //   - bg alpha:        0.55 → 0.92
  //   - border alpha:    0.45 → 0.95
  //   - shadow spread:   0px → 22px (a soft red halo on imminent)
  //   - scanner cycle:   1700ms → 520ms
  //   - scanner alpha:   0.45 → 0.85
  const bgAlpha = 0.55 + intensity * 0.37;
  const borderAlpha = 0.45 + intensity * 0.5;
  const shadowBlur = Math.round(intensity * 22);
  const shadowAlpha = (0.05 + intensity * 0.25).toFixed(2);
  const scannerMs = Math.max(520, Math.round(1700 - intensity * 1180));
  const scannerAlpha = 0.45 + intensity * 0.4;

  return (
    <div
      role="status"
      className="overflow-hidden rounded-[14px] animate-fade-up transition-shadow duration-500"
      style={{
        backgroundColor: `rgba(254, 226, 226, ${bgAlpha})`,
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: `rgba(220, 38, 38, ${borderAlpha})`,
        boxShadow:
          shadowBlur > 0
            ? `0 0 ${shadowBlur}px -4px rgba(220, 38, 38, ${shadowAlpha})`
            : "none",
      }}
    >
      {/* Accelerating scanner — the heartbeat of the chain about to act. */}
      <div className="relative h-px overflow-hidden">
        <div
          className="absolute inset-y-0 h-px w-1/3 animate-boot-sweep"
          style={{
            background: `linear-gradient(90deg, transparent, rgba(220,38,38,${scannerAlpha.toFixed(2)}), transparent)`,
            animationDuration: `${scannerMs}ms`,
            animationIterationCount: "infinite",
            animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <ShieldOff
          className={`h-5 w-5 shrink-0 text-red-700 ${imminent ? "animate-pulse" : ""}`}
          strokeWidth={1.75}
        />
        <div className="grow">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-red-700">
            mandate revoked on-chain
          </p>
          <p className="mt-1 text-[13.5px] leading-[1.55] text-red-900">
            {imminent ? (
              <>
                <strong className="font-semibold">Imminent.</strong>{" "}
                Sui&rsquo;s{" "}
                <code className="font-mono text-red-800">
                  assert_can_spend
                </code>{" "}
                is about to abort the agent&rsquo;s next attempt.
              </>
            ) : (
              <>
                Waiting for the agent&rsquo;s next attempt — Sui&rsquo;s{" "}
                <code className="font-mono text-red-800">
                  assert_can_spend
                </code>{" "}
                will abort the transaction the moment it lands. No
                off-chain kill needed.
              </>
            )}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p
            className={`font-mono text-[10.5px] uppercase tracking-[0.22em] text-red-700 ${imminent ? "animate-pulse" : ""}`}
          >
            {imminent ? "imminent" : "chain intervention"}
          </p>
          <p
            className={`mt-0.5 tabular-nums font-semibold text-red-800 tracking-tight transition-all duration-300 ${imminent ? "text-[20px]" : "text-[14px]"}`}
          >
            {untilSec > 0 ? `~${untilSec}s` : "now"}
          </p>
        </div>
      </div>
    </div>
  );
}
