// Workforce-specific UI client. Wraps the operator-policy primitives with
// templates + helpers tuned for the Agent Commerce product:
// research / audit / treasury workforce capabilities, not the legacy
// DeepBook / NAVI / Suilend yield routing.

"use client";

import { useEffect, useState } from "react";
import { useSuiClient } from "@mysten/dapp-kit";
import {
  BRIEF_OPERATOR_ADDRESS,
  buildCreatePolicyTx,
  decodeOperatorPolicy,
  suiToMist,
  type OperatorPolicyDecoded,
} from "./operator-policy-client";
import { BRIEF_PACKAGE_ID, BRIEF_TYPE_ORIGIN_ID } from "./brief-client";
import { Transaction } from "@mysten/sui/transactions";

// Re-exported so the UI can show "planner agent: 0x…" without dipping
// into operator-policy-client directly.
export { BRIEF_OPERATOR_ADDRESS };

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
  /**
   * The Planner agent's address — this is the `agent` bound into the
   * OperatorPolicy and the wallet that posts sub-tasks. Defaults to
   * BRIEF_OPERATOR_ADDRESS (from env) so the wizard's signer (the
   * connected dApp Kit wallet, the OWNER) doesn't have to match the
   * agent. In Wk2 multi-wallet mode this can be passed explicitly.
   */
  agentAddress?: string;
  templateId: string;
  name?: string;
  budgetSui?: number;
  allowedVenues?: string[];
  maxConcentrationPct?: number;
  expiryHours?: number;
  autoApprovePct?: number;
  riskTolerance?: "low" | "medium" | "high";
};

// ---------------------------------------------------------------------------
// Live hooks
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "open"
  | "accepted"
  | "delivered"
  | "approved"
  | "expired"
  | "unknown";

export type WorkforceTask = {
  id: string;
  poster: string;
  assignedTo: string;
  title: string;
  primaryCapability: string;
  specBlob: string;
  bountyMist: bigint;
  status: TaskStatus;
  deliverableId: string | null;
  parentPolicy: string | null;
  postedAtMs: bigint;
  deadlineMs: bigint;
  postedTxDigest: string;
};

function statusFromCode(code: number): TaskStatus {
  switch (code) {
    case 0:
      return "open";
    case 1:
      return "accepted";
    case 2:
      return "delivered";
    case 3:
      return "approved";
    case 4:
      return "expired";
    default:
      return "unknown";
  }
}

function unwrapOptionId(
  v: string | null | { vec?: string[] },
): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v?.vec) && v.vec.length > 0) return v.vec[0];
  return null;
}

function readBountyAmount(b: unknown): bigint {
  if (b == null) return 0n;
  if (typeof b === "string" || typeof b === "number") return BigInt(b);
  if (typeof b === "object") {
    const anyB = b as { fields?: { value?: string | number } };
    if (anyB.fields?.value != null) return BigInt(anyB.fields.value);
  }
  return 0n;
}

/**
 * Poll on-chain for tasks parented to the given OperatorPolicy. Walks
 * TaskPosted events (descending, page of 50), filters by parent_policy,
 * then fetches each task object for its current status. Returns the
 * task list sorted by posted_at_ms desc.
 */
export function useTasksForPolicy(
  policyId: string | null | undefined,
  pollMs = 3000,
): { tasks: WorkforceTask[]; loading: boolean } {
  const client = useSuiClient();
  const [tasks, setTasks] = useState<WorkforceTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!policyId || !policyId.startsWith("0x")) {
      setTasks([]);
      setLoading(false);
      return;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const evResp = await client.queryEvents({
          query: { MoveEventType: `${BRIEF_TYPE_ORIGIN_ID}::task::TaskPosted` },
          order: "descending",
          limit: 50,
        });
        const candidates = evResp.data
          .map((ev) => {
            const p = ev.parsedJson as {
              task_id?: string;
              poster?: string;
              assigned_to?: string;
              title?: string;
              primary_capability?: string;
              bounty_amount?: string;
              deadline_ms?: string;
              parent_policy?: string | { vec?: string[] } | null;
              posted_at_ms?: string;
            };
            const parent = unwrapOptionId(
              (p?.parent_policy ?? null) as
                | string
                | null
                | { vec?: string[] },
            );
            if (!p?.task_id || parent !== policyId) return null;
            return {
              taskId: p.task_id,
              poster: p.poster ?? "",
              assignedTo: p.assigned_to ?? "",
              title: p.title ?? "",
              primaryCapability: p.primary_capability ?? "",
              bountyMistEvent: BigInt(p.bounty_amount ?? "0"),
              deadlineMs: BigInt(p.deadline_ms ?? "0"),
              postedAtMs: BigInt(p.posted_at_ms ?? "0"),
              parent,
              postedTxDigest: ev.id.txDigest,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        if (candidates.length === 0) {
          if (!cancelled) {
            setTasks([]);
            setLoading(false);
          }
          return;
        }

        const fetched = await Promise.all(
          candidates.map(async (c) => {
            try {
              const resp = await client.getObject({
                id: c.taskId,
                options: { showContent: true },
              });
              const content = resp.data?.content;
              if (!content || content.dataType !== "moveObject") return c;
              const f = (content as unknown as { fields: Record<string, unknown> }).fields;
              const statusCode = Number(f.status ?? 0);
              return {
                ...c,
                fields: f,
                bountyMist: readBountyAmount(f.bounty),
                status: statusFromCode(statusCode),
                deliverableId: unwrapOptionId(
                  f.deliverable_id as string | { vec?: string[] } | null,
                ),
                specBlob: String(f.spec_blob ?? ""),
              };
            } catch {
              return c;
            }
          }),
        );

        const resolved: WorkforceTask[] = fetched.map((c) => {
          const withFields = c as typeof c & {
            fields?: Record<string, unknown>;
            bountyMist?: bigint;
            status?: TaskStatus;
            deliverableId?: string | null;
            specBlob?: string;
          };
          return {
            id: withFields.taskId,
            poster: withFields.poster,
            assignedTo: withFields.assignedTo,
            title: withFields.title,
            primaryCapability: withFields.primaryCapability,
            specBlob: withFields.specBlob ?? "",
            bountyMist: withFields.bountyMist ?? withFields.bountyMistEvent,
            status: withFields.status ?? "unknown",
            deliverableId: withFields.deliverableId ?? null,
            parentPolicy: withFields.parent,
            postedAtMs: withFields.postedAtMs,
            deadlineMs: withFields.deadlineMs,
            postedTxDigest: withFields.postedTxDigest,
          };
        });

        resolved.sort((a, b) => Number(b.postedAtMs - a.postedAtMs));

        if (!cancelled) {
          setTasks(resolved);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    tick();
    const handle = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [policyId, client, pollMs]);

  return { tasks, loading };
}

/**
 * Fetch a single OperatorPolicy by id with light polling. The Wizard's
 * post-activation console uses this to surface up-to-date remaining
 * budget + revoked state.
 */
export function usePolicy(
  policyId: string | null | undefined,
  pollMs = 4000,
): { policy: OperatorPolicyDecoded | null; loading: boolean } {
  const client = useSuiClient();
  const [policy, setPolicy] = useState<OperatorPolicyDecoded | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!policyId || !policyId.startsWith("0x")) {
      setPolicy(null);
      setLoading(false);
      return;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const resp = await client.getObject({
          id: policyId,
          options: { showContent: true },
        });
        const decoded = decodeOperatorPolicy(resp);
        if (!cancelled) {
          setPolicy(decoded);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    tick();
    const handle = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [policyId, client, pollMs]);

  return { policy, loading };
}

/**
 * Resolve the OperatorPolicy object id from a recent grant tx digest by
 * inspecting the tx's created objects. Returns null until the tx
 * propagates + the policy is discoverable. Polls every `pollMs`.
 */
export function useResolvedPolicyId(
  txDigest: string | null | undefined,
  pollMs = 1800,
): string | null {
  const client = useSuiClient();
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!txDigest) {
      setResolved(null);
      return;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const tx = await client.getTransactionBlock({
          digest: txDigest,
          options: { showObjectChanges: true },
        });
        const created = (tx.objectChanges ?? []).find(
          (c) =>
            c.type === "created" &&
            typeof (c as { objectType?: string }).objectType === "string" &&
            (c as { objectType?: string }).objectType?.includes(
              "::operator_policy::OperatorPolicy",
            ),
        ) as { objectId?: string } | undefined;
        if (!cancelled && created?.objectId) {
          setResolved(created.objectId);
        }
      } catch {
        /* ignore — tx may still be propagating */
      }
    };

    tick();
    const handle = setInterval(() => {
      if (resolved) return; // resolved already, stop polling
      tick();
    }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [txDigest, client, pollMs, resolved]);

  return resolved;
}

// ---------------------------------------------------------------------------
// Agent registration — for profile cards in the Activity Stream
// ---------------------------------------------------------------------------

export type AgentProfile = {
  id: string;
  address: string;
  displayName: string;
  capabilities: string[];
  completedTasks: bigint;
  totalPaidMist: bigint;
  reputationScore: bigint;
  registeredAtMs: bigint;
  basePricePerCallMist: bigint;
};

export function useAgentRegistration(
  agentAddress: string | null | undefined,
  pollMs = 8000,
): { profile: AgentProfile | null; loading: boolean } {
  const client = useSuiClient();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agentAddress || !agentAddress.startsWith("0x")) {
      setProfile(null);
      setLoading(false);
      return;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const evResp = await client.queryEvents({
          query: {
            MoveEventType: `${BRIEF_TYPE_ORIGIN_ID}::agent_registry::AgentRegistered`,
          },
          order: "descending",
          limit: 100,
        });
        const matching = evResp.data
          .map((ev) => {
            const p = ev.parsedJson as { agent_address?: string };
            return p?.agent_address === agentAddress ? ev : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        if (matching.length === 0) {
          if (!cancelled) {
            setProfile(null);
            setLoading(false);
          }
          return;
        }
        // The registration object id isn't on the event; fetch the tx and
        // pick the AgentRegistration that was created in it.
        const txResp = await client.getTransactionBlock({
          digest: matching[0].id.txDigest,
          options: { showObjectChanges: true },
        });
        const created = (txResp.objectChanges ?? []).find(
          (c) =>
            c.type === "created" &&
            typeof (c as { objectType?: string }).objectType === "string" &&
            (c as { objectType?: string }).objectType?.includes(
              "::agent_registry::AgentRegistration",
            ),
        ) as { objectId?: string } | undefined;
        if (!created?.objectId) {
          if (!cancelled) setLoading(false);
          return;
        }
        const regResp = await client.getObject({
          id: created.objectId,
          options: { showContent: true },
        });
        const content = regResp.data?.content;
        if (!content || content.dataType !== "moveObject") {
          if (!cancelled) setLoading(false);
          return;
        }
        const f = (content as unknown as { fields: Record<string, unknown> }).fields;
        const result: AgentProfile = {
          id: created.objectId,
          address: String(f.agent_address ?? agentAddress),
          displayName: String(f.display_name ?? ""),
          capabilities: Array.isArray(f.capabilities)
            ? (f.capabilities as string[])
            : [],
          completedTasks: BigInt((f.completed_tasks as string | number) ?? "0"),
          totalPaidMist: BigInt((f.total_paid as string | number) ?? "0"),
          reputationScore: BigInt((f.reputation_score as string | number) ?? "0"),
          registeredAtMs: BigInt((f.registered_at_ms as string | number) ?? "0"),
          basePricePerCallMist: BigInt(
            (f.base_price_per_call as string | number) ?? "0",
          ),
        };
        if (!cancelled) {
          setProfile(result);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const handle = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [agentAddress, client, pollMs]);

  return { profile, loading };
}

// ---------------------------------------------------------------------------
// Deliverable preview — fetch the WorkObject + (if Walrus-backed) its
// markdown / JSON content for inline rendering in the Activity Stream.
// ---------------------------------------------------------------------------

export type DeliverableContent = {
  id: string;
  kind: string;
  walrusBlobId: string | null;
  // Resolved payload. For markdown deliverables it's the rendered text;
  // for JSON it's the prettified string.
  body: string | null;
  bodyKind: "markdown" | "json" | "text" | null;
  loading: boolean;
};

export function useDeliverable(
  deliverableId: string | null | undefined,
): DeliverableContent {
  const client = useSuiClient();
  const [state, setState] = useState<DeliverableContent>({
    id: deliverableId ?? "",
    kind: "",
    walrusBlobId: null,
    body: null,
    bodyKind: null,
    loading: !!deliverableId,
  });

  useEffect(() => {
    if (!deliverableId || !deliverableId.startsWith("0x")) {
      setState({
        id: "",
        kind: "",
        walrusBlobId: null,
        body: null,
        bodyKind: null,
        loading: false,
      });
      return;
    }
    let cancelled = false;
    async function tick() {
      try {
        const resp = await client.getObject({
          id: deliverableId as string,
          options: { showContent: true },
        });
        const content = resp.data?.content;
        if (!content || content.dataType !== "moveObject") {
          if (!cancelled) setState((s) => ({ ...s, loading: false }));
          return;
        }
        const f = (content as unknown as { fields: Record<string, unknown> }).fields;
        const kind = String(f.object_type ?? "");
        const blobId = unwrapWalrusBlobId(f.walrus_blob_id);
        const inlinePayload = (f.payload as number[] | undefined) ?? [];

        // Prefer inline; fall back to Walrus.
        let body: string | null = null;
        let bodyKind: "markdown" | "json" | "text" | null = null;
        if (inlinePayload.length > 0) {
          const decoded = new TextDecoder().decode(new Uint8Array(inlinePayload));
          ({ body, bodyKind } = classify(decoded));
        } else if (blobId) {
          try {
            const url = `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`;
            const r = await fetch(url);
            if (r.ok) {
              const text = await r.text();
              ({ body, bodyKind } = classify(text));
            }
          } catch {
            /* propagation delay */
          }
        }

        if (!cancelled) {
          setState({
            id: deliverableId as string,
            kind,
            walrusBlobId: blobId,
            body,
            bodyKind,
            loading: false,
          });
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    }
    tick();
  }, [deliverableId, client]);

  return state;
}

function unwrapWalrusBlobId(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.length > 0 ? v : null;
  if (typeof v === "object") {
    const anyV = v as { vec?: string[] };
    if (Array.isArray(anyV.vec) && anyV.vec.length > 0) return anyV.vec[0];
  }
  return null;
}

function classify(raw: string): {
  body: string;
  bodyKind: "markdown" | "json" | "text";
} {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return { body: JSON.stringify(parsed, null, 2), bodyKind: "json" };
    } catch {
      /* not json */
    }
  }
  if (trimmed.startsWith("#") || trimmed.includes("\n## ")) {
    return { body: raw, bodyKind: "markdown" };
  }
  return { body: raw, bodyKind: "text" };
}

export function buildActivateTx(args: ActivateArgs): Transaction {
  const t = templateById(args.templateId);
  if (!t) throw new Error(`unknown workforce template: ${args.templateId}`);
  const agentAddress = args.agentAddress ?? BRIEF_OPERATOR_ADDRESS;
  if (!agentAddress || !agentAddress.startsWith("0x") || agentAddress === "0x0") {
    throw new Error(
      "NEXT_PUBLIC_BRIEF_OPERATOR_ADDRESS is not set — the wizard can't grant authority to a missing Planner agent",
    );
  }
  const name = args.name ?? t.defaults.name;
  const budgetSui = args.budgetSui ?? t.defaults.budgetSui;
  const allowedVenues = args.allowedVenues ?? t.defaults.allowedVenues;
  const maxConcentrationPct = args.maxConcentrationPct ?? t.defaults.maxConcentrationPct;
  const expiryHours = args.expiryHours ?? t.defaults.expiryHours;
  const autoApprovePct = args.autoApprovePct ?? t.defaults.autoApprovePct;
  const riskTolerance = args.riskTolerance ?? t.defaults.riskTolerance;
  return buildCreatePolicyTx({
    packageId: args.packageId,
    agent: agentAddress,
    name,
    budgetCap: suiToMist(budgetSui),
    allowedVenues,
    maxConcentrationBps: Math.round(maxConcentrationPct * 100),
    expiresAtMs: BigInt(Date.now() + expiryHours * 3600 * 1000),
    autoApprovePct,
    riskTolerance,
  });
}
