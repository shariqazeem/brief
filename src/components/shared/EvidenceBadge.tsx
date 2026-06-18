// EvidenceBadge · a small, clickable pill linking to on-chain / Walrus proof.
//
// "View on Suiscan", "View policy", "Manifesto on Walrus" — each rendered as an
// inline-flex pill with a lucide ExternalLink glyph, opening in a new tab. The
// tone colors the text + border (low-opacity fill), deepening on hover, so a
// successful tx reads green, a revert reads red, and everything else reads navy.

import { ExternalLink } from "lucide-react";

import { NAVY, SUCCESS, DANGER } from "@/lib/ui";

export type EvidenceTone = "success" | "danger" | "neutral";

export type EvidenceBadgeProps = {
  href: string;
  /** e.g. "View on Suiscan". */
  label: string;
  /** What it points to · informs the implicit semantics, not the visuals. */
  type: "tx" | "policy" | "walrus";
  /** Color tone · default neutral (NAVY). */
  tone?: EvidenceTone;
  className?: string;
};

const TONE: Record<EvidenceTone, string> = {
  neutral: NAVY,
  success: SUCCESS,
  danger: DANGER,
};

export default function EvidenceBadge({
  href,
  label,
  type,
  tone = "neutral",
  className,
}: EvidenceBadgeProps) {
  const color = TONE[tone];
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-evidence-type={type}
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-opacity hover:opacity-100 ${className ?? ""}`}
      style={{
        color,
        borderColor: `${color}33`,
        opacity: 0.86,
      }}
    >
      {label}
      <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
    </a>
  );
}
