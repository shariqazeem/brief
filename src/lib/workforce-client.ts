// Workforce-specific UI client. Wraps the operator-policy primitives with
// templates + helpers tuned for the Agent Commerce product:
// research / audit / treasury workforce capabilities, not the legacy
// DeepBook / NAVI / Suilend yield routing.

import {
  buildCreatePolicyTx,
  suiToMist,
  type OperatorPolicyDecoded,
} from "./operator-policy-client";
import { Transaction } from "@mysten/sui/transactions";

export type WorkforceTemplate = {
  id: string;
  label: string;
  blurb: string;
  defaults: {
    name: string;
    missionPlaceholder: string;
    budgetSui: number;
    allowedVenues: string[];
    maxConcentrationPct: number;
    expiryHours: number;
    autoApprovePct: number;
    riskTolerance: "low" | "medium" | "high";
  };
};

export const WORKFORCE_TEMPLATES: WorkforceTemplate[] = [
  {
    id: "investment-committee",
    label: "Investment Committee",
    blurb:
      "Evaluate a Move contract or protocol for a DAO grant. Research + audit + treasury sizing.",
    defaults: {
      name: "Investment Committee",
      missionPlaceholder:
        "Evaluate this Move contract for a $50,000 DAO grant. Recommend approve / reject with reasoning, and probe DeepBook liquidity to size the disbursement.",
      budgetSui: 0.5,
      allowedVenues: ["research", "audit", "treasury"],
      maxConcentrationPct: 50,
      expiryHours: 2,
      autoApprovePct: 100,
      riskTolerance: "low",
    },
  },
  {
    id: "move-audit-sprint",
    label: "Move Audit Sprint",
    blurb:
      "Single-pass research + audit on a target package. No treasury actions, fastest cycle.",
    defaults: {
      name: "Move Audit Sprint",
      missionPlaceholder:
        "Audit module X of package 0x… and produce a single deliverable noting capability objects, abort coverage, public surface, and concrete risks.",
      budgetSui: 0.2,
      allowedVenues: ["research", "audit"],
      maxConcentrationPct: 50,
      expiryHours: 1,
      autoApprovePct: 100,
      riskTolerance: "low",
    },
  },
  {
    id: "disbursement-planner",
    label: "Disbursement Planner",
    blurb:
      "Decide tranche sizing for an incoming payout using DeepBook liquidity probes. Treasury-heavy.",
    defaults: {
      name: "Disbursement Planner",
      missionPlaceholder:
        "We have $50k to disburse over the next 24h. Probe DeepBook depth for SUI/USDC, recommend tranche sizing and pacing.",
      budgetSui: 0.3,
      allowedVenues: ["audit", "treasury"],
      maxConcentrationPct: 60,
      expiryHours: 1,
      autoApprovePct: 100,
      riskTolerance: "low",
    },
  },
  {
    id: "open-workforce",
    label: "Open Workforce",
    blurb:
      "Larger envelope with all three capabilities. Use when the mission cuts across audit + treasury and you want headroom.",
    defaults: {
      name: "Open Workforce",
      missionPlaceholder: "",
      budgetSui: 1.0,
      allowedVenues: ["research", "audit", "treasury"],
      maxConcentrationPct: 70,
      expiryHours: 4,
      autoApprovePct: 100,
      riskTolerance: "medium",
    },
  },
];

export function templateById(id: string): WorkforceTemplate | undefined {
  return WORKFORCE_TEMPLATES.find((t) => t.id === id);
}

// Re-export the policy primitives so the UI doesn't need to know about
// the legacy operator-policy-client module.
export { buildCreatePolicyTx, suiToMist };
export type { OperatorPolicyDecoded };

// ---------------------------------------------------------------------------
// Mission queue — UI POSTs to /api/workforce/missions which appends to a
// local file. The planner-service (when wired Day 9+) drains the queue.
// For Wk1 / Day 8 scaffold, the user can also paste the CLI command shown
// after activation.
// ---------------------------------------------------------------------------

export type MissionPayload = {
  policyId: string;
  mission: string;
  targetPackageId?: string;
  bountySui?: number;
  maxSubtasks?: number;
};

export async function dispatchMission(args: MissionPayload): Promise<{
  ok: boolean;
  queuedAt: number;
}> {
  const res = await fetch("/api/workforce/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`dispatch failed: ${res.status} ${text}`);
  }
  return (await res.json()) as { ok: boolean; queuedAt: number };
}

export function plannerCliCommand(args: MissionPayload): string {
  const parts = [
    "npm run agent:planner --",
    `--policy ${args.policyId}`,
    `--mission ${JSON.stringify(args.mission)}`,
  ];
  if (args.targetPackageId) parts.push(`--target-package-id ${args.targetPackageId}`);
  if (args.bountySui) parts.push(`--default-bounty-sui ${args.bountySui}`);
  if (args.maxSubtasks) parts.push(`--max-subtasks ${args.maxSubtasks}`);
  return parts.join(" \\\n  ");
}

// ---------------------------------------------------------------------------
// Tiny wrapper used by the Hire Wizard's Activate stage. Returns a
// Transaction ready for useSignAndExecuteTransaction.
// ---------------------------------------------------------------------------

export type ActivateArgs = {
  packageId: string;
  agentAddress: string;
  templateId: string;
  name?: string;
  budgetSui?: number;
  allowedVenues?: string[];
  maxConcentrationPct?: number;
  expiryHours?: number;
  autoApprovePct?: number;
  riskTolerance?: "low" | "medium" | "high";
};

export function buildActivateTx(args: ActivateArgs): Transaction {
  const t = templateById(args.templateId);
  if (!t) throw new Error(`unknown workforce template: ${args.templateId}`);
  const name = args.name ?? t.defaults.name;
  const budgetSui = args.budgetSui ?? t.defaults.budgetSui;
  const allowedVenues = args.allowedVenues ?? t.defaults.allowedVenues;
  const maxConcentrationPct = args.maxConcentrationPct ?? t.defaults.maxConcentrationPct;
  const expiryHours = args.expiryHours ?? t.defaults.expiryHours;
  const autoApprovePct = args.autoApprovePct ?? t.defaults.autoApprovePct;
  const riskTolerance = args.riskTolerance ?? t.defaults.riskTolerance;
  return buildCreatePolicyTx({
    packageId: args.packageId,
    agent: args.agentAddress,
    name,
    budgetCap: suiToMist(budgetSui),
    allowedVenues,
    maxConcentrationBps: Math.round(maxConcentrationPct * 100),
    expiresAtMs: BigInt(Date.now() + expiryHours * 3600 * 1000),
    autoApprovePct,
    riskTolerance,
  });
}
