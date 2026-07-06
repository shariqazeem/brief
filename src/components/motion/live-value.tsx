// LiveValue · the value-change choreography primitive (prompt 01).
//
// Numbers ARE the product, so no money/stat figure ever hard-re-renders. On
// first mount the value counts up over 700ms; on change it tweens over 320ms
// with a 600ms color pulse (emerald up / red down, decaying to ink). Pass a
// `format` for currency/percent. Honest: it animates whatever real value it is
// given, it never invents motion. Respects prefers-reduced-motion (snaps).

"use client";

import { useEffect, useRef, useState } from "react";

import { SUCCESS, DANGER } from "@/lib/ui";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function LiveValue({
  value,
  format = (n) => String(Math.round(n)),
  countUp = true,
  pulse = true,
  className,
  style,
}: {
  value: number;
  format?: (n: number) => string;
  countUp?: boolean;
  pulse?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [display, setDisplay] = useState<number>(countUp ? 0 : value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const prev = useRef<number>(countUp ? 0 : value);
  const raf = useRef<number | null>(null);
  const mounted = useRef(false);

  // Tween helper · eased rAF from `prev.current` to `to`.
  const tweenTo = (to: number, dur: number) => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (prefersReducedMotion() || dur <= 0) {
      setDisplay(to);
      prev.current = to;
      return;
    }
    const from = prev.current;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setDisplay(from + (to - from) * eased);
      if (p < 1) {
        raf.current = requestAnimationFrame(step);
      } else {
        prev.current = to;
        raf.current = null;
      }
    };
    raf.current = requestAnimationFrame(step);
  };

  // Count-up on first mount only.
  useEffect(() => {
    mounted.current = true;
    tweenTo(value, countUp ? 700 : 0);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On subsequent value changes: tween + directional color pulse.
  useEffect(() => {
    if (!mounted.current) return;
    if (value === prev.current) return;
    if (pulse) setDir(value > prev.current ? "up" : "down");
    tweenTo(value, 320);
    const clr = window.setTimeout(() => setDir(null), 600);
    return () => window.clearTimeout(clr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const color = dir === "up" ? SUCCESS : dir === "down" ? DANGER : undefined;
  return (
    <span
      className={`tabular-nums ${className ?? ""}`}
      style={{ color, transition: "color 600ms var(--ease-base)", ...style }}
    >
      {format(display)}
    </span>
  );
}
