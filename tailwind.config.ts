import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Light premium foundation — Kyvern-sibling palette. Modernized
        // from the prior cream-navy "vintage paper" register: Apple-style
        // off-white, near-black primary text, cool greys for hierarchy.
        bg: "#FAFAFA",
        "bg-elev": "#FFFFFF",
        "bg-elev-2": "#F5F5F7",

        // Text hierarchy — 4-tier like Linear / Kyvern. Reads at every
        // size without straining; primary is near-black for legibility.
        ink: "#0A0A0A",
        "ink-2": "#525560",
        muted: "#6E7178",
        "muted-2": "#B4B6BC",

        // Subtle borders. Most surfaces use `line`; only emphasized
        // dividers (e.g. table heads) use `line-strong`.
        line: "#E5E5EA",
        "line-strong": "#D1D1D6",
        "line-subtle": "#F0F0F0",

        // Brand accent — kept navy so Brief is identifiable next to
        // Kyvern's blue. Used for primary CTAs + active states.
        accent: "#1a2c4e",
        "accent-hover": "#2c3e5f",
        "accent-bg": "#EEF1F6",

        // Sui brand accent (used sparingly — status dot, on-chain links)
        sui: "#4DA2FF",

        // Semantic — the operator's language. Mirrors src/lib/ui.ts (the
        // inline-style source of truth) so className + inline paths agree.
        success: "#10B981",
        "success-deep": "#047857",
        danger: "#EF4444",
        caution: "#F59E0B",
        info: "#4DA2FF",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter: "-0.02em",
      },
      fontSize: {
        // Hero scale — matches Kyvern's typography rhythm
        "display-sm": ["clamp(3rem, 8vw, 5rem)", { lineHeight: "0.95", letterSpacing: "-0.04em" }],
        display: ["clamp(4rem, 10vw, 6.5rem)", { lineHeight: "0.92", letterSpacing: "-0.045em" }],
      },
      maxWidth: {
        page: "1180px",
        prose: "640px",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideEdgeIn: {
          "0%": { opacity: "0", transform: "translateX(-12px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        pulseGlow: {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgba(77, 162, 255, 0.12)",
          },
          "50%": {
            boxShadow: "0 0 0 4px rgba(77, 162, 255, 0.06)",
          },
        },
        // Ceremony — a scanner line that sweeps across the viewport once when
        // a new operator transitions LIVE. Subtle but visible.
        bootSweep: {
          "0%": { transform: "translateX(-40%)" },
          "100%": { transform: "translateX(140%)" },
        },
        // Ceremony — a soft red wash that fades in then out across the page
        // when the user clicks Revoke. Draws attention to the kill switch
        // landing on-chain.
        revokeDarken: {
          "0%": { opacity: "0" },
          "30%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        // Heartbeat — slow opacity pulse for the operator card's top accent
        // line. Continuous, subliminal. Sells "this is alive."
        operatorPulseLine: {
          "0%, 100%": { opacity: "0.85" },
          "50%": { opacity: "0.35" },
        },
        // Reveal — used by activity rows landing on-chain in real time.
        // Slightly more pronounced than fade-up for "something just happened."
        landIn: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "60%": { opacity: "1", transform: "translateY(-1px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Continuous scan line inside the OperatorCard — gives the surface
        // a "live system" undercurrent. Extremely low contrast so it never
        // distracts from content. Only renders when the operator is live.
        operatorScan: {
          "0%": { transform: "translateX(-60%)", opacity: "0" },
          "20%": { opacity: "1" },
          "80%": { opacity: "1" },
          "100%": { transform: "translateX(160%)", opacity: "0" },
        },
        // Number tick — a single, almost-invisible flash used when a
        // numeric value increments (e.g., enforced count). Adds the
        // operational "something just changed" beat.
        valueTick: {
          "0%": { color: "currentColor" },
          "20%": { color: "#15803D" },
          "100%": { color: "currentColor" },
        },
        // OperatorCard ripple — fires when a new Operator action lands.
        // A single soft green ring fades outward from the card edges. Subtle
        // and short (700ms). Reads as a system heartbeat for each action.
        operatorRipple: {
          "0%": {
            boxShadow:
              "0 0 0 0 rgba(21,128,61,0.35), 0 0 0 0 rgba(21,128,61,0.0)",
          },
          "55%": {
            boxShadow:
              "0 0 0 3px rgba(21,128,61,0.22), 0 0 28px 4px rgba(21,128,61,0.12)",
          },
          "100%": {
            boxShadow:
              "0 0 0 0 rgba(21,128,61,0), 0 0 0 0 rgba(21,128,61,0)",
          },
        },
        // Boot veil — a brief dimming of the screen while the operator is
        // brought online. Pairs with the bootSweep scanner. Fades in,
        // holds while the scanner crosses, then fades out cleanly.
        bootVeil: {
          "0%": { opacity: "0" },
          "18%": { opacity: "0.5" },
          "70%": { opacity: "0.5" },
          "100%": { opacity: "0" },
        },
        // Smooth reveal — used by the OperatorCard's inner elements on
        // first mount so the card materializes element-by-element rather
        // than landing as one block. Variants below stagger the delay.
        bootStagger: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Terminal-state desaturation — fires once when the operator
        // transitions from live → terminal. Quietly drains the green
        // accents toward grey. Visual "the chapter has closed."
        endedDesat: {
          "0%": { filter: "saturate(1)" },
          "100%": { filter: "saturate(0.6)" },
        },
        // Rejection landing flash — a brief red halo that surrounds the
        // Rejection row when it first mounts. The row's static left border
        // stays separate (an absolute div); this is purely the emphasis
        // glow that fades back to nothing.
        rejectionFlash: {
          "0%": { boxShadow: "0 0 0 0 rgba(220,38,38,0)" },
          "25%": { boxShadow: "0 0 26px -4px rgba(220,38,38,0.42)" },
          "100%": { boxShadow: "0 0 0 0 rgba(220,38,38,0)" },
        },
        // Chain Intervention veil — ambient red wash that fades in fast,
        // holds, and fades out cleanly while the app is paused for ~2s
        // around the moment Sui itself aborts the agent.
        chainIntervention: {
          "0%": { opacity: "0" },
          "20%": { opacity: "1" },
          "85%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        // Slow bounce — used on the landing's scroll cue arrow. Subtle
        // up-down to invite the viewer to scroll without flashing.
        bounceSlow: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(4px)" },
        },
      },
      animation: {
        "fade-up": "fadeUp 360ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-edge-in":
          "slideEdgeIn 420ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-glow": "pulseGlow 2.4s ease-in-out infinite",
        "boot-sweep": "bootSweep 1200ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "revoke-darken": "revokeDarken 1000ms ease-in-out forwards",
        "operator-pulse-line":
          "operatorPulseLine 2.8s ease-in-out infinite",
        "land-in": "landIn 420ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "operator-scan": "operatorScan 7s ease-in-out infinite",
        "value-tick": "valueTick 600ms ease-out both",
        "operator-ripple":
          "operatorRipple 720ms cubic-bezier(0.22, 1, 0.36, 1) both",
        // Cinematic boot — 1.6s sequence layered over the dashboard.
        "boot-veil": "bootVeil 1600ms cubic-bezier(0.4, 0, 0.2, 1) forwards",
        // Operator card staggered children — each variant offsets the
        // start so the card materializes element-by-element.
        "boot-stagger-1":
          "bootStagger 480ms cubic-bezier(0.22, 1, 0.36, 1) 380ms both",
        "boot-stagger-2":
          "bootStagger 480ms cubic-bezier(0.22, 1, 0.36, 1) 540ms both",
        "boot-stagger-3":
          "bootStagger 480ms cubic-bezier(0.22, 1, 0.36, 1) 700ms both",
        "boot-stagger-4":
          "bootStagger 480ms cubic-bezier(0.22, 1, 0.36, 1) 860ms both",
        "boot-stagger-5":
          "bootStagger 480ms cubic-bezier(0.22, 1, 0.36, 1) 1020ms both",
        "boot-stagger-6":
          "bootStagger 480ms cubic-bezier(0.22, 1, 0.36, 1) 1180ms both",
        // Terminal-state desaturation — one-shot on transition.
        "ended-desat": "endedDesat 800ms cubic-bezier(0.4, 0, 0.2, 1) forwards",
        // Rejection landing — single emphasis flash.
        "rejection-flash":
          "rejectionFlash 880ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
        // Chain intervention veil — 2s hold around the moment Sui aborts.
        "chain-intervention":
          "chainIntervention 2000ms cubic-bezier(0.4, 0, 0.2, 1) forwards",
        // Scroll cue
        "bounce-slow": "bounceSlow 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
