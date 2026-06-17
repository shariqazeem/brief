// Scroll-driven reveal hooks · IntersectionObserver-backed, CSS-only motion.
//
// Two primitives:
//
//   useReveal(threshold?)  → { ref, visible }
//     Toggles `visible` true the FIRST time the ref enters the viewport
//     past the given threshold (default 0.15). Stays true thereafter so
//     the user can scroll back without re-running the animation.
//
//   useScrollProgress(ref) → 0..1
//     Continuous 0–1 progress across the ref element's scroll lifetime
//     (0 when its top hits the bottom of the viewport, 1 when its
//     bottom leaves the top). Useful for sticky-section cinema where
//     content beats need to interpolate across a scroll.

"use client";

import { useEffect, useRef, useState } from "react";

export function useReveal(threshold = 0.15): {
  ref: React.RefObject<HTMLElement>;
  visible: boolean;
} {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            return;
          }
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  return { ref, visible };
}

export function useScrollProgress(
  ref: React.RefObject<HTMLElement>,
): number {
  const [p, setP] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 when rect.top === vh (just entering bottom)
      // 1 when rect.bottom === 0 (just leaving top)
      const total = rect.height + vh;
      const traveled = vh - rect.top;
      const next = Math.max(0, Math.min(1, traveled / total));
      setP(next);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", compute);
    };
  }, [ref]);

  return p;
}
