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
import { apiUrl } from "./api-base";
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
  // Trader templates — one per personality the adopt wizard offers.
  // The wizard passes every default through explicitly (name, budget,
  // venues), so these entries exist primarily to satisfy
  // `templateById()`'s presence check inside `buildActivateTx`.
  // The fallback `allowedVenues` here covers all four trader venues so
  // a future caller that drops the override still gets a valid policy.
  {
    id: "trader-conservative",
    label: "Conservative trader",
    blurb:
      "Adopt an AI agent that takes small positions on BTC/SUI/WAL/DEEP. Tightest leash.",
    defaults: {
      name: "Conservative trader",
      missionPlaceholder: "",
      budgetSui: 1.0,
      allowedVenues: ["predict-btc", "spot-sui", "spot-wal", "spot-deep"],
      maxConcentrationPct: 50,
      expiryHours: 12,
      autoApprovePct: 100,
      riskTolerance: "low",
    },
  },
  {
    id: "trader-momentum",
    label: "Momentum trader",
    blurb:
      "Adopt an AI agent that follows the last few settled bars on BTC and rides the move on SUI/WAL/DEEP spot.",
    defaults: {
      name: "Momentum trader",
      missionPlaceholder: "",
      budgetSui: 2.0,
      allowedVenues: ["predict-btc", "spot-sui", "spot-wal", "spot-deep"],
      maxConcentrationPct: 70,
      expiryHours: 12,
      autoApprovePct: 100,
      riskTolerance: "medium",
    },
  },
  {
    id: "trader-contrarian",
    label: "Contrarian trader",
    blurb:
      "Adopt an AI agent that fades the last move on BTC and shorts SUI/WAL/DEEP spot when momentum looks crowded.",
    defaults: {
      name: "Contrarian trader",
      missionPlaceholder: "",
      budgetSui: 2.0,
      allowedVenues: ["predict-btc", "spot-sui", "spot-wal", "spot-deep"],
      maxConcentrationPct: 70,
      expiryHours: 12,
      autoApprovePct: 100,
      riskTolerance: "medium",
    },
  },
  {
    id: "trader-quant",
    label: "Quant · Vol trader",
    blurb:
      "Reads DeepBook Predict's SVI surface, computes implied Pr(UP), bets only when its own signal diverges by ≥5%.",
    defaults: {
      name: "Quant · Vol trader",
      missionPlaceholder: "",
      budgetSui: 2.0,
      allowedVenues: ["predict-btc", "spot-sui", "spot-wal", "spot-deep"],
      maxConcentrationPct: 70,
      expiryHours: 12,
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
  const res = await fetch(apiUrl("/api/workforce/missions"), {
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

// ---------------------------------------------------------------------------
// Trader (Phase 3): one personality per adoption. Each personality has a
// stable `strategy` key (the on-chain agent's strategy spec) plus copy
// describing it in the trader's first-person voice — used on the adopt
// cards and in the dashboard chip. Glyph + tone are small typographic
// tokens; no emoji or external assets.
// ---------------------------------------------------------------------------

export type StrategyId = "conservative" | "momentum" | "contrarian" | "quant";

export type TraderPersonality = {
  strategy: StrategyId;
  /** Card title — short noun ("Conservative", "Momentum", "Contrarian"). */
  label: string;
  /** Single ascii glyph used as the personality's stamp ("◇ / ➤ / ⊘"). */
  glyph: string;
  /** Two-or-three-word temperament — e.g. "Cool, careful, small". */
  temperament: string;
  /** First-person one-sentence pitch — how the trader thinks about the
   *  market. Becomes the headline on the card AND part of the dashboard
   *  Narrator's opening beat. */
  voice: string;
  /** Card body paragraph — explains the betting rule in plain English. */
  blurb: string;
  /** Sensible defaults the leash slider snaps to first. */
  defaultBudgetSui: number;
  /** Plain-English stake/cadence note ("bets ~$1 every settled bar"). */
  cadence: string;
};

export const TRADER_PERSONALITIES: TraderPersonality[] = [
  {
    strategy: "conservative",
    label: "Conservative",
    glyph: "◇",
    temperament: "Cool, careful, small",
    voice:
      "I keep your stake small. I sit out when MAs disagree or RSI is extreme.",
    blurb:
      "I only bet when the 15m and 60m moving averages agree on direction and RSI isn't already overextended. I never upsize — discipline beats conviction.",
    defaultBudgetSui: 0.5,
    cadence: "~$1 per bet, only on clean signals.",
  },
  {
    strategy: "momentum",
    label: "Momentum",
    glyph: "➤",
    temperament: "Trend-following, brave",
    voice:
      "I follow real price action — ROC and the short MA tell me where to lean.",
    blurb:
      "I compute the 30-minute rate-of-change on real price ticks. If it's clearly positive, I bet UP; clearly negative, DOWN. I sit out when the tape is flat (|ROC30m| under 0.05%).",
    defaultBudgetSui: 1.0,
    cadence: "~$2 per bet, scaled by conviction.",
  },
  {
    strategy: "contrarian",
    label: "Contrarian",
    glyph: "⊘",
    temperament: "Mean-reverting, fades extremes",
    voice:
      "I fade overextended moves. If RSI(60m) is past 70 or under 30, I bet the snap-back.",
    blurb:
      "When the 60-minute RSI shows the tape is overbought or oversold, I take the opposite side. If the tape is sitting between 30 and 70 — no extension — I do nothing.",
    defaultBudgetSui: 1.0,
    cadence: "~$2 per bet, only when extended.",
  },
  {
    strategy: "quant",
    label: "Quant · Vol",
    glyph: "Σ",
    temperament: "Vol-surface arbitrage",
    voice:
      "I read DeepBook Predict's live SVI surface and bet only when my signal probability diverges from the market's by 5%+.",
    blurb:
      "I pull the BTC oracle's SVI parameters on chain, derive the market-implied probability that the strike settles UP, and compare to my own estimate from ROC / RSI / MA. I bet the side of the edge, sized by how big it is. No edge → I sit out.",
    defaultBudgetSui: 2.0,
    cadence: "~$2–3 per bet, only when |edge| ≥ 5%.",
  },
];

export function personalityById(
  strategy: StrategyId,
): TraderPersonality | undefined {
  return TRADER_PERSONALITIES.find((p) => p.strategy === strategy);
}

export type TraderDispatchResult = {
  ok: boolean;
  task_id?: string | null;
  tx_digest?: string;
  treasury_address?: string;
  title?: string;
  error?: string;
};

/** Market bundle keys recognised by the wizard + trader spec. */
export type TraderMarketBundle = "btc_only" | "sui_ecosystem" | "all";

export async function dispatchTraderTask(args: {
  policyId: string;
  strategy: StrategyId;
  traderName?: string;
  bountySui?: number;
  /** Which markets this trader is allowed to play. Defaults to BTC for
   *  backward compatibility with existing adopt flows. */
  markets?: TraderMarketBundle;
}): Promise<TraderDispatchResult> {
  const res = await fetch(apiUrl("/api/workforce/trader-dispatch"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      policy_id: args.policyId,
      strategy: args.strategy,
      trader_name: args.traderName,
      bounty_sui: args.bountySui,
      markets: args.markets,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as TraderDispatchResult;
  if (!res.ok) {
    return {
      ok: false,
      error: j.error ?? `dispatch ${res.status}`,
    };
  }
  return j;
}

// Local-storage helpers for trader identity. The on-chain anchor is the
// OperatorPolicy id; the trader's user-given name + chosen personality
// are pure UX state we persist per policy so a reload of the dashboard
// keeps showing the right name + voice without an extra round-trip.
const TRADER_IDENTITY_KEY = "brief:trader:identities";

export type TraderIdentity = {
  policyId: string;
  name: string;
  strategy: StrategyId;
  adoptedAtMs: number;
};

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveTraderIdentity(v: TraderIdentity): void {
  const s = safeStorage();
  if (!s) return;
  const raw = s.getItem(TRADER_IDENTITY_KEY);
  let arr: TraderIdentity[] = [];
  try {
    arr = raw ? (JSON.parse(raw) as TraderIdentity[]) : [];
  } catch {
    arr = [];
  }
  const i = arr.findIndex((x) => x.policyId === v.policyId);
  if (i >= 0) arr[i] = v;
  else arr.push(v);
  s.setItem(TRADER_IDENTITY_KEY, JSON.stringify(arr.slice(-20)));
}

export function loadTraderIdentity(
  policyId: string | null | undefined,
): TraderIdentity | null {
  if (!policyId) return null;
  const s = safeStorage();
  if (!s) return null;
  const raw = s.getItem(TRADER_IDENTITY_KEY);
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as TraderIdentity[];
    return arr.find((x) => x.policyId === policyId) ?? null;
  } catch {
    return null;
  }
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

export type DeepBookPlacedOrder = {
  /** The on-chain DeepBook order id (u128 as string), surfaced from
   *  the OrderPlaced event emitted by the deliver tx. */
  orderId: string;
  clientOrderId: string;
  /** Pool object id the order rests on. */
  poolId: string;
  /** BalanceManager owning the order. */
  balanceManagerId: string;
  isBid: boolean;
  /** DeepBook on-chain price (raw scaled u64). */
  priceRaw: string;
  quantityRaw: string;
};

export type DeliverableContent = {
  id: string;
  kind: string;
  walrusBlobId: string | null;
  /** The tx digest that created this Deliverable on-chain (= the
   *  agent's deliver tx). Lets the UI link a deliverable's contents
   *  back to the underlying transaction on suiscan. */
  deliverTxDigest: string | null;
  /** DeepBook OrderPlaced events surfaced from the deliver tx — used
   *  by the Treasury renderer to show real on-chain order IDs that a
   *  judge can click into. Empty when not a Treasury deliverable. */
  placedOrders: DeepBookPlacedOrder[];
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
    deliverTxDigest: null,
    placedOrders: [],
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
        deliverTxDigest: null,
        placedOrders: [],
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
          options: { showContent: true, showPreviousTransaction: true },
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
        const deliverTxDigest =
          (resp.data?.previousTransaction as string | undefined) ?? null;

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

        // For Treasury deliverables: pull the DeepBook OrderPlaced events
        // off the deliver tx so the UI can show real on-chain order IDs.
        // We only do this when the deliver tx digest is known and the
        // payload looks like JSON (cheap heuristic — saves an RPC call on
        // markdown / inline deliverables).
        let placedOrders: DeepBookPlacedOrder[] = [];
        if (deliverTxDigest && bodyKind === "json") {
          placedOrders = await fetchPlacedOrders(client, deliverTxDigest);
        }

        if (!cancelled) {
          setState({
            id: deliverableId as string,
            kind,
            walrusBlobId: blobId,
            deliverTxDigest,
            placedOrders,
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

// Pull DeepBook `OrderPlaced` events off a deliver tx and normalise them
// into the shape the Treasury renderer wants. Best-effort: if the RPC
// hiccups or no events match we just return [] — the deliverable still
// renders cleanly from its inline JSON.
async function fetchPlacedOrders(
  client: ReturnType<typeof useSuiClient>,
  digest: string,
): Promise<DeepBookPlacedOrder[]> {
  try {
    const tx = await client.getTransactionBlock({
      digest,
      options: { showEvents: true },
    });
    const events = (tx.events ?? []) as Array<{
      type: string;
      parsedJson?: Record<string, unknown>;
    }>;
    const out: DeepBookPlacedOrder[] = [];
    for (const ev of events) {
      // DeepBook v3 emits `…::order_info::OrderPlaced`. Match permissively
      // so future minor renames don't silently break the view.
      if (!ev.type.endsWith("::OrderPlaced")) continue;
      const j = ev.parsedJson ?? {};
      const orderId = String(j.order_id ?? "");
      const clientOrderId = String(j.client_order_id ?? "");
      if (!orderId || !clientOrderId) continue;
      out.push({
        orderId,
        clientOrderId,
        poolId: String(j.pool_id ?? ""),
        balanceManagerId: String(j.balance_manager_id ?? ""),
        isBid: Boolean(j.is_bid ?? false),
        priceRaw: String(j.price ?? "0"),
        // DeepBook v3's OrderPlaced event emits the quantity field as
        // `placed_quantity` (not `quantity`). Fall back to `quantity`
        // for compatibility with any older DeepBook version.
        quantityRaw: String(j.placed_quantity ?? j.quantity ?? "0"),
      });
    }
    return out;
  } catch {
    return [];
  }
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

// ---------------------------------------------------------------------------
// Roster + recent activity — drive the always-on /workforce view (renders
// even when the visitor hasn't connected a wallet so the screen never
// shows an empty state).
// ---------------------------------------------------------------------------

export type RegisteredAgent = AgentProfile;

/**
 * Walk every AgentRegistered event, dedupe to the most-recent registration
 * per address, and (optionally) exclude one address — typically the
 * Planner so the roster only shows specialists for hire. Polls every
 * `pollMs`.
 */
export function useRegisteredAgents(opts?: {
  excludeAddress?: string;
  pollMs?: number;
}): { agents: RegisteredAgent[]; loading: boolean } {
  const client = useSuiClient();
  const [agents, setAgents] = useState<RegisteredAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const exclude = opts?.excludeAddress?.toLowerCase();
  const pollMs = opts?.pollMs ?? 8000;

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const evResp = await client.queryEvents({
          query: {
            MoveEventType: `${BRIEF_TYPE_ORIGIN_ID}::agent_registry::AgentRegistered`,
          },
          order: "descending",
          limit: 200,
        });
        const seen = new Set<string>();
        const order: Array<{ address: string; txDigest: string }> = [];
        for (const ev of evResp.data) {
          const p = ev.parsedJson as { agent_address?: string };
          if (!p?.agent_address) continue;
          const a = p.agent_address;
          if (exclude && a.toLowerCase() === exclude) continue;
          if (seen.has(a)) continue;
          seen.add(a);
          order.push({ address: a, txDigest: ev.id.txDigest });
        }
        const profiles: RegisteredAgent[] = [];
        for (const { address, txDigest } of order) {
          try {
            const txResp = await client.getTransactionBlock({
              digest: txDigest,
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
            if (!created?.objectId) continue;
            const regResp = await client.getObject({
              id: created.objectId,
              options: { showContent: true },
            });
            const content = regResp.data?.content;
            if (!content || content.dataType !== "moveObject") continue;
            const f = (content as unknown as { fields: Record<string, unknown> }).fields;
            profiles.push({
              id: created.objectId,
              address: String(f.agent_address ?? address),
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
            });
          } catch {
            /* skip this entry */
          }
        }
        if (!cancelled) {
          // Sort by reputation desc, then completed desc.
          profiles.sort((a, b) => {
            const dr = Number(b.reputationScore - a.reputationScore);
            if (dr !== 0) return dr;
            return Number(b.completedTasks - a.completedTasks);
          });
          setAgents(profiles);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const h = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(h);
    };
  }, [client, exclude, pollMs]);

  return { agents, loading };
}

export type RecentActivityItem = {
  kind: "posted" | "approved";
  taskId: string;
  poster: string;
  assignedTo: string;
  capability: string;
  title: string;
  bountyMist: bigint;
  atMs: bigint;
  txDigest: string;
  parentPolicy: string | null;
};

/**
 * Pull recent TaskPosted + TaskApproved events across ALL policies, merge
 * and sort. Used by the always-on /workforce header so even a
 * disconnected visitor sees a living agent economy.
 */
export function useRecentTaskActivity(
  limit = 8,
  pollMs = 4000,
): { items: RecentActivityItem[]; loading: boolean } {
  const client = useSuiClient();
  const [items, setItems] = useState<RecentActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [posted, approved] = await Promise.all([
          client.queryEvents({
            query: { MoveEventType: `${BRIEF_TYPE_ORIGIN_ID}::task::TaskPosted` },
            order: "descending",
            limit: 25,
          }),
          client.queryEvents({
            query: { MoveEventType: `${BRIEF_TYPE_ORIGIN_ID}::task::TaskApproved` },
            order: "descending",
            limit: 25,
          }),
        ]);

        const out: RecentActivityItem[] = [];
        for (const ev of posted.data) {
          const p = ev.parsedJson as {
            task_id?: string;
            poster?: string;
            assigned_to?: string;
            primary_capability?: string;
            title?: string;
            bounty_amount?: string;
            posted_at_ms?: string;
            parent_policy?: string | null | { vec?: string[] };
          };
          if (!p?.task_id) continue;
          out.push({
            kind: "posted",
            taskId: p.task_id,
            poster: p.poster ?? "",
            assignedTo: p.assigned_to ?? "",
            capability: p.primary_capability ?? "",
            title: p.title ?? "",
            bountyMist: BigInt(p.bounty_amount ?? "0"),
            atMs: BigInt(p.posted_at_ms ?? "0"),
            txDigest: ev.id.txDigest,
            parentPolicy: unwrapOptionId(
              (p?.parent_policy ?? null) as
                | string
                | null
                | { vec?: string[] },
            ),
          });
        }
        for (const ev of approved.data) {
          const p = ev.parsedJson as {
            task_id?: string;
            poster?: string;
            agent?: string;
            primary_capability?: string;
            bounty_amount?: string;
            approved_at_ms?: string;
            parent_policy?: string | null | { vec?: string[] };
          };
          if (!p?.task_id) continue;
          out.push({
            kind: "approved",
            taskId: p.task_id,
            poster: p.poster ?? "",
            assignedTo: p.agent ?? "",
            capability: p.primary_capability ?? "",
            title: "",
            bountyMist: BigInt(p.bounty_amount ?? "0"),
            atMs: BigInt(p.approved_at_ms ?? "0"),
            txDigest: ev.id.txDigest,
            parentPolicy: unwrapOptionId(
              (p?.parent_policy ?? null) as
                | string
                | null
                | { vec?: string[] },
            ),
          });
        }
        out.sort((a, b) => Number(b.atMs - a.atMs));
        if (!cancelled) {
          setItems(out.slice(0, limit));
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const h = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(h);
    };
  }, [client, limit, pollMs]);

  return { items, loading };
}

// ---------------------------------------------------------------------------
// Brief auto-detection. The single-step grant form lets the user paste a
// 0x… address inline in their brief; we lift it out so the Planner sees
// a structured target_package_id without the user filling a second field.
// ---------------------------------------------------------------------------

const SUI_ADDR_RE = /\b0x[0-9a-fA-F]{40,64}\b/;

export function extractTargetPackageId(brief: string): string | null {
  const m = SUI_ADDR_RE.exec(brief);
  return m ? m[0] : null;
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
