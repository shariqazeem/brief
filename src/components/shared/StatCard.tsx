// StatCard · a reusable stat block (label · value · optional sub-line).
//
// Replaces the inlined HeroStat patterns across the operator surface. Purely
// presentational: it takes a label, a value, an optional accent color for the
// value, and an optional sub-line. The signature mono-uppercase-wide-tracked
// label sits above a large tabular-nums value, with a subtle bottom hairline.

import { INK, SUB } from "@/lib/ui";

export type StatCardProps = {
  /** Rendered in the mono uppercase wide-tracked label style. */
  label: string;
  /** The headline number · large Inter, tabular-nums. */
  value: string | number;
  /** Optional value color · hex string or token (default INK). */
  accent?: string;
  /** Optional small sub-line under the value. */
  sub?: string;
  /** Optional className passthrough on the outer wrapper. */
  className?: string;
};

export default function StatCard({
  label,
  value,
  accent = INK,
  sub,
  className,
}: StatCardProps) {
  return (
    <div
      className={`bg-bg-elev px-4 py-3.5 ${className ?? ""}`}
      style={{ borderBottom: "1px solid #E5E5EA" }}
    >
      <p
        className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.22em]"
        style={{ color: SUB }}
      >
        {label}
      </p>
      <p
        className="mt-1.5 font-sans text-[24px] font-medium tabular-nums leading-none tracking-tight"
        style={{ color: accent }}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-1.5 font-mono text-[11px] tabular-nums" style={{ color: SUB }}>
          {sub}
        </p>
      )}
    </div>
  );
}
