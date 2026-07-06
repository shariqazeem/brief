// Operator tab bar · the single-surface navigation for the operator console.
//
// The operator page is ONE place: a persistent header, then tabs. This replaces
// the old scatter to /brain, /evolution, /results, /proof — everything is a tab
// now. Sticky under the header, glass, with an active underline; horizontally
// scrollable on mobile. Content cross-fades in the panel (see .operator-panel).

"use client";

import { NAVY } from "@/lib/ui";

export type OperatorTabKey = "live" | "mind" | "performance" | "memory" | "proof";

export const OPERATOR_TABS: { key: OperatorTabKey; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "mind", label: "Mind" },
  { key: "performance", label: "Performance" },
  { key: "memory", label: "Memory" },
  { key: "proof", label: "Proof" },
];

export function OperatorTabBar({
  active,
  onChange,
}: {
  active: OperatorTabKey;
  onChange: (k: OperatorTabKey) => void;
}) {
  return (
    <div
      className="sticky top-[49px] z-30 -mx-5 mb-6 flex gap-0.5 overflow-x-auto px-4 py-1.5 sm:mx-0 sm:px-1"
      style={{
        background: "var(--glass)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {OPERATOR_TABS.map((t) => {
        const on = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-current={on ? "page" : undefined}
            className="relative shrink-0 px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors hover:text-ink"
            style={{ color: on ? "#0A0A0A" : "#8E8E93" }}
          >
            {t.label}
            {on && (
              <span
                className="absolute inset-x-3 -bottom-[1px] h-[2px] rounded-full"
                style={{ background: NAVY }}
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Wrap a tab's content so it cross-fades + slides in on switch (250ms). */
export function OperatorPanel({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  if (!active) return null;
  return <div className="operator-panel">{children}</div>;
}
