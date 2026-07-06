// OperatorPresence · the living-operator primitive (prompt 01).
//
// The operator is a living thing: an identity mark sitting on its aura. It
// BREATHES only while the SSE stream is healthy (an honest heartbeat — kill the
// stream and it stills), brightens with a perimeter sweep while thinking, pops
// on an act, and shifts amber/red (desaturating) when guarded or intervened by
// the chain. Same organism at three sizes — landing hero (lg), operator cards
// (sm), detail header (md). The glyph is a placeholder for the identity art.

"use client";

import { INFO, NAVY } from "@/lib/ui";

export type PresenceState = "idle" | "thinking" | "acting" | "guarded" | "intervened";
export type PresenceSize = "sm" | "md" | "lg";

const AURA: Record<PresenceState, string> = {
  idle: "var(--aura-idle)",
  thinking: "var(--aura-thinking)",
  acting: "var(--aura-acting)",
  guarded: "var(--aura-guarded)",
  intervened: "var(--aura-intervened)",
};
const PX: Record<PresenceSize, number> = { sm: 44, md: 72, lg: 128 };

export function OperatorPresence({
  glyph = "◇",
  state = "idle",
  live = true,
  size = "md",
  accent = NAVY,
  className,
}: {
  glyph?: string;
  state?: PresenceState;
  live?: boolean;
  size?: PresenceSize;
  accent?: string;
  className?: string;
}) {
  const px = PX[size];
  const cls = [
    "op-presence",
    live ? "is-live" : "",
    state === "thinking" ? "is-thinking" : "",
    state === "acting" ? "is-acting" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const desat = state === "intervened" || state === "guarded";

  return (
    <div
      className={cls}
      style={{ position: "relative", width: px, height: px, display: "grid", placeItems: "center" }}
    >
      {/* aura · a large blurred radial behind the mark, cross-fading by state */}
      <div
        className="op-aura"
        aria-hidden
        style={{
          position: "absolute",
          inset: `-${Math.round(px * 0.6)}px`,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${AURA[state]} 0%, transparent 68%)`,
          filter: "blur(6px)",
          pointerEvents: "none",
        }}
      />
      {/* thinking sweep · a thin conic arc tracing the perimeter, once per beat */}
      <div
        className="op-presence-sweep"
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background:
            state === "thinking"
              ? `conic-gradient(from 0deg, transparent 0deg, ${INFO}66 42deg, transparent 84deg)`
              : "transparent",
          WebkitMask: "radial-gradient(circle, transparent 61%, #000 63%)",
          mask: "radial-gradient(circle, transparent 61%, #000 63%)",
        }}
      />
      {/* ring */}
      <div
        aria-hidden
        style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1px solid ${accent}22` }}
      />
      {/* mark · identity glyph (the art asset swaps in here later) */}
      <span
        className="op-presence-mark"
        style={{
          fontSize: Math.round(px * 0.42),
          lineHeight: 1,
          color: accent,
          filter: desat ? "grayscale(0.7) opacity(0.75)" : "none",
          transition: "filter 400ms var(--ease-base)",
        }}
      >
        {glyph}
      </span>
    </div>
  );
}
