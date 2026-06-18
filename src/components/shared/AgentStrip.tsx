// AgentStrip · "Two Agents & The Chain" · Brief's differentiator made visible.
//
// Three on-brand panels in a row (stacking on mobile):
//   1. The Trader        · what it's thinking now + its conviction
//   2. The Risk Guardian · the second agent, watching / standing it down
//   3. The Chain (Leash) · the on-chain budget the operator can never exceed
//
// Purely presentational — every value is passed in by the page. The Trader and
// Guardian are the two autonomous agents; the Chain is the non-custodial leash
// that holds them both. Together they say, in one glance, "two agents propose,
// the chain disposes."

import { Cpu, Shield, ShieldAlert, ShieldCheck, Lock } from "lucide-react";

import { INK, SUB, MUTED, NAVY, SUCCESS, DANGER, CAUTION } from "@/lib/ui";

export type GuardianStatus = "monitoring" | "watch" | "paused" | "unknown";

export type AgentStripProps = {
  /** The trader's current one-line thinking. */
  traderThesis: string;
  /** 0..1 conviction. */
  traderConfidence: number;
  /** e.g. "Claude Haiku" · shows a tiny "AI" tag when present. */
  traderAiModel?: string;
  guardianStatus: GuardianStatus;
  guardianReason?: string;
  /** e.g. "12s ago". */
  guardianLastCheck?: string;
  /** USDC spent against the budget. */
  policySpent: number;
  /** USDC budget cap. */
  policyBudget: number;
  policyRevoked?: boolean;
  className?: string;
};

// Shared card shell · matches the operator surface (white, flat, subtle shadow,
// a 2px top accent for weight) — sharp corners, no rounding, like the hero.
function Panel({
  accent,
  icon,
  label,
  badge,
  children,
}: {
  accent: string;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="bg-bg-elev px-5 py-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
      style={{ borderTop: `2px solid ${accent}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span style={{ color: accent }} aria-hidden>
            {icon}
          </span>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: SUB }}
          >
            {label}
          </span>
        </div>
        {badge}
      </div>
      <div className="mt-3.5">{children}</div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: "#E5E5EA" }}
    >
      <div
        className="h-full transition-[width] duration-500"
        style={{ width: `${w}%`, background: color }}
      />
    </div>
  );
}

const GUARDIAN: Record<
  GuardianStatus,
  { color: string; word: string; icon: React.ReactNode }
> = {
  monitoring: { color: SUCCESS, word: "Monitoring", icon: <ShieldCheck size={15} strokeWidth={1.75} /> },
  watch: { color: CAUTION, word: "On watch", icon: <ShieldAlert size={15} strokeWidth={1.75} /> },
  paused: { color: DANGER, word: "Paused", icon: <ShieldAlert size={15} strokeWidth={1.75} /> },
  unknown: { color: MUTED, word: "Idle", icon: <Shield size={15} strokeWidth={1.75} /> },
};

export default function AgentStrip({
  traderThesis,
  traderConfidence,
  traderAiModel,
  guardianStatus,
  guardianReason,
  guardianLastCheck,
  policySpent,
  policyBudget,
  policyRevoked,
  className,
}: AgentStripProps) {
  const confPct = Math.round(Math.max(0, Math.min(1, traderConfidence)) * 100);
  const g = GUARDIAN[guardianStatus];
  const budget = policyBudget > 0 ? policyBudget : 0;
  const spentPct = budget > 0 ? Math.round((policySpent / budget) * 100) : 0;
  const leashAccent = policyRevoked ? DANGER : NAVY;

  return (
    <div className={`grid grid-cols-1 gap-3 md:grid-cols-3 ${className ?? ""}`}>
      {/* 1 · The Trader */}
      <Panel
        accent={NAVY}
        icon={<Cpu size={15} strokeWidth={1.75} />}
        label="The Trader"
        badge={
          traderAiModel ? (
            <span
              className="inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.16em]"
              style={{ borderColor: `${NAVY}33`, color: NAVY }}
            >
              AI · {traderAiModel}
            </span>
          ) : undefined
        }
      >
        <p className="text-[13px] leading-snug" style={{ color: INK }}>
          {traderThesis}
        </p>
        <div className="mt-3.5">
          <div
            className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{ color: SUB }}
          >
            <span>Conviction</span>
            <span className="tabular-nums">{confPct}%</span>
          </div>
          <Bar pct={confPct} color={NAVY} />
        </div>
      </Panel>

      {/* 2 · The Risk Guardian */}
      <Panel
        accent={g.color}
        icon={g.icon}
        label="The Risk Guardian"
        badge={
          guardianLastCheck ? (
            <span
              className="font-mono text-[9px] uppercase tracking-[0.16em]"
              style={{ color: MUTED }}
            >
              {guardianLastCheck}
            </span>
          ) : undefined
        }
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${guardianStatus === "monitoring" ? "animate-pulse" : ""}`}
            style={{ background: g.color }}
            aria-hidden
          />
          <span
            className="font-mono text-[11px] uppercase tracking-[0.18em]"
            style={{ color: g.color }}
          >
            {g.word}
          </span>
        </div>
        <p className="mt-2.5 text-[12.5px] leading-snug" style={{ color: SUB }}>
          {guardianStatus === "paused"
            ? guardianReason ?? "Operator stood down · honouring your limit."
            : guardianStatus === "watch"
              ? guardianReason ?? "Risk elevated · tightening exposure."
              : guardianStatus === "monitoring"
                ? "Watching drawdown + concentration each cycle."
                : "Awaiting the next decision cycle."}
        </p>
      </Panel>

      {/* 3 · The Chain (Leash) */}
      <Panel
        accent={leashAccent}
        icon={<Lock size={15} strokeWidth={1.75} />}
        label="The Chain · Leash"
      >
        {policyRevoked ? (
          <p
            className="font-mono text-[11px] uppercase tracking-[0.18em]"
            style={{ color: DANGER }}
          >
            Authority revoked
          </p>
        ) : (
          <p
            className="font-mono text-[11px] uppercase tracking-[0.16em]"
            style={{ color: SUCCESS }}
          >
            0 policy violations
          </p>
        )}
        <div className="mt-3">
          <div
            className="mb-1 flex items-center justify-between font-mono text-[10px] tabular-nums"
            style={{ color: SUB }}
          >
            <span className="uppercase tracking-[0.16em]">Budget</span>
            <span>
              {policySpent.toFixed(2)} / {budget.toFixed(2)} USDC
            </span>
          </div>
          <Bar pct={spentPct} color={policyRevoked ? DANGER : NAVY} />
        </div>
        <p className="mt-2.5 text-[12px] leading-snug" style={{ color: MUTED }}>
          Enforced by Move · the operator can never exceed it.
        </p>
      </Panel>
    </div>
  );
}
