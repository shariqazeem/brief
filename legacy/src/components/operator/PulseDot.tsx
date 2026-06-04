"use client";

import type { OperatorState } from "@/lib/operator-state";
import { operatorStateTone } from "@/lib/operator-state";

/**
 * Status pulse atom. Color encodes whether the operator is live (green
 * — life), ended naturally (muted), or killed (red — kill). The ping ring
 * only animates when the operator is actively scanning or deploying.
 *
 * Sizes: "sm" for inline use in headers/rows, "md" for the operator card.
 */
export function PulseDot({
  state,
  size = "sm",
}: {
  state: OperatorState;
  size?: "sm" | "md";
}) {
  const tone = operatorStateTone(state);
  const colorClass =
    tone === "kill"
      ? "bg-red-600"
      : tone === "ended"
        ? "bg-muted"
        : "bg-green-500";
  const isAnimated =
    state === "online" || state === "scanning" || state === "deploying";
  const dim = size === "md" ? "h-3 w-3" : "h-2 w-2";
  return (
    <span className={`relative inline-flex ${dim}`} aria-hidden>
      {isAnimated ? (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colorClass} opacity-50`}
        />
      ) : null}
      <span
        className={`relative inline-flex rounded-full ${dim} ${colorClass}`}
      />
    </span>
  );
}
