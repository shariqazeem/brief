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
      className="sticky top-[49px] z-30 -mx-5 mb-6 px-4 py-2.5 sm:mx-0 sm:px-0"
      style={{
        background: "var(--glass)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {/* Segmented control · a light track with a filled navy pill for the
          active view. Unmistakably a switcher, not a row of labels. */}
      <div
        className="flex gap-1 overflow-x-auto rounded-[11px] p-1"
        style={{ background: "#F0F0F2" }}
        role="tablist"
      >
        {OPERATOR_TABS.map((t) => {
          const on = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              onClick={() => onChange(t.key)}
              aria-selected={on}
              className={`shrink-0 rounded-[8px] px-4 py-1.5 font-sans text-[13px] font-semibold tracking-tight transition-all duration-200 ${
                on ? "" : "text-ink-2 hover:text-ink"
              }`}
              style={
                on
                  ? { background: "#FFFFFF", color: NAVY, boxShadow: "0 1px 3px rgba(10,10,10,0.10)" }
                  : { background: "transparent" }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
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
