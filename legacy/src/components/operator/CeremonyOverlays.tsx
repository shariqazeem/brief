"use client";

import { useEffect } from "react";

/**
 * Ceremonial overlays for the operator console's state transitions.
 *
 *   - BootSweep: a layered cinematic sequence when an OperatorPolicy
 *     transitions LIVE. A dark veil dims the page for 1.6s while a
 *     scanner line sweeps across; the OperatorCard underneath
 *     materializes element-by-element via its own staggered fade-ups.
 *     The result reads as a real system coming online — not a transition.
 *
 *   - RevokeDarken: a red wash fades in then out across the page when the
 *     user signs a Revoke. Draws the eye toward the next event landing
 *     (the on-chain Rejection node about to appear in the timeline).
 *
 *   - ChainIntervention: a full-screen "infrastructure halted authority"
 *     beat that lands when the on-chain Rejection arrives. Holds the
 *     entire app in a brief paused state — heartbeat freeze, scan lines
 *     stop, ambient red veil — to make finality feel inevitable.
 *
 * All overlays are CSS-only (no Framer Motion dependency) and respect
 * `prefers-reduced-motion` via the global rule in globals.css.
 */

const BOOT_SEQUENCE_MS = 1600;
const REVOKE_DARKEN_MS = 1000;
const CHAIN_INTERVENTION_MS = 2000;

export function BootSweep({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, BOOT_SEQUENCE_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      aria-hidden
    >
      {/* Dark veil — fades in to 50%, holds while the scanner crosses,
          fades out cleanly. Uses the ink color so the dashboard reads
          "dimmed" not "covered". */}
      <div className="absolute inset-0 bg-ink animate-boot-veil" />

      {/* Scanner line — single sweep across the veiled scene. Slower than
          the previous bootSweep (1100ms) to read as deliberate. */}
      <div
        className="absolute inset-y-0 h-full w-[26%]"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(21,128,61,0.16) 45%, rgba(250,248,244,0.10) 55%, transparent 100%)",
          animation:
            "bootSweep 1100ms cubic-bezier(0.4, 0, 0.2, 1) 250ms forwards",
        }}
      />
    </div>
  );
}

export function RevokeDarken({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, REVOKE_DARKEN_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-40 animate-revoke-darken"
      style={{
        background:
          "radial-gradient(circle at 50% 30%, rgba(220,38,38,0.14) 0%, rgba(26,44,78,0.18) 60%, rgba(26,44,78,0.32) 100%)",
      }}
      aria-hidden
    />
  );
}

/**
 * Chain Intervention — fires when the on-chain Rejection lands (the moment
 * Sui itself aborts the agent's next attempt). Holds the whole app in a
 * 2-second freeze: a low-opacity red veil, a settling halo at the top of
 * the viewport, and an aria-live caption that reads as infrastructural,
 * not theatrical.
 *
 * The freeze is purely visual — it does NOT block input. Live polls keep
 * running underneath; the overlay just communicates finality.
 */
export function ChainIntervention({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, CHAIN_INTERVENTION_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  // Broadcast the freeze flag so other components can opt into stillness
  // (heartbeat lines, scan lines, etc) for the duration.
  useEffect(() => {
    document.documentElement.setAttribute("data-chain-intervention", "1");
    return () => {
      document.documentElement.removeAttribute("data-chain-intervention");
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-40 animate-chain-intervention"
      aria-label="Chain intervention — authority revoked on Sui"
    >
      {/* Ambient red veil — low opacity, broad. Persists for ~2s. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 20%, rgba(220,38,38,0.10) 0%, rgba(220,38,38,0.04) 50%, transparent 80%)",
        }}
      />
      {/* Settling halo line at the top edge */}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(220,38,38,0.65), transparent)",
        }}
      />
    </div>
  );
}
