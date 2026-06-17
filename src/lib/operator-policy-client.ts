// React hooks + Transaction builders for the operator_policy Move module,
// frontend side. Mirrors agents/lib/operator-policy.ts but uses dApp Kit's
// SuiClient + tx builders for signing through the user's wallet.

"use client";

import { useEffect, useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useSuiClient } from "@mysten/dapp-kit";
import { BRIEF_PACKAGE_ID } from "./brief-client";

/** Sui's shared Clock object lives at a well-known address. */
export const SUI_CLOCK_ID = "0x6";

/** The OperatorAgent's wallet address; from .env.local. */
export const BRIEF_OPERATOR_ADDRESS = (
  process.env.NEXT_PUBLIC_BRIEF_OPERATOR_ADDRESS ?? "0x0"
).trim();

export type OperatorPolicyDecoded = {
  id: string;
  owner: string;
  agent: string;
  name: string;
  budgetCap: bigint;
  spent: bigint;
  allowedVenues: string[];
  maxConcentrationBps: number;
  expiresAtMs: bigint;
  autoApprovePct: number;
  riskTolerance: string;
  revoked: boolean;
  createdAtMs: bigint;
};

export type PolicyStatus = "active" | "revoked" | "expired" | "exhausted";

export function policyStatus(p: OperatorPolicyDecoded): PolicyStatus {
  if (p.revoked) return "revoked";
  if (Date.now() >= Number(p.expiresAtMs)) return "expired";
  if (p.spent >= p.budgetCap) return "exhausted";
  return "active";
}

// ---------------------------------------------------------------------------
// Tx builders (mirrors agents/lib/operator-policy.ts)
// ---------------------------------------------------------------------------

export function buildCreatePolicyTx(args: {
  packageId: string;
  agent: string;
  name: string;
  budgetCap: bigint;
  allowedVenues: string[];
  maxConcentrationBps: number;
  expiresAtMs: bigint;
  autoApprovePct: number;
  riskTolerance: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::operator_policy::create`,
    arguments: [
      tx.pure.address(args.agent),
      tx.pure.string(args.name),
      tx.pure.u64(args.budgetCap),
      tx.pure.vector("string", args.allowedVenues),
      tx.pure.u16(args.maxConcentrationBps),
      tx.pure.u64(args.expiresAtMs),
      tx.pure.u8(args.autoApprovePct),
      tx.pure.string(args.riskTolerance),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  return tx;
}

export function buildRevokeTx(args: {
  packageId: string;
  policyId: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::operator_policy::revoke`,
    arguments: [tx.object(args.policyId), tx.object(SUI_CLOCK_ID)],
  });
  return tx;
}

// ---------------------------------------------------------------------------
// Decode + hooks
// ---------------------------------------------------------------------------

type SuiObjectLite = {
  data?: {
    objectId?: string;
    content?: { dataType: string; fields?: unknown } | null;
  } | null;
};

export function decodeOperatorPolicy(
  resp: SuiObjectLite,
): OperatorPolicyDecoded | null {
  const content = resp.data?.content;
  if (!content || content.dataType !== "moveObject") return null;
  const raw = content.fields;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const f = raw as Record<string, unknown>;
  const idField = f.id as { id?: string } | undefined;
  return {
    id: idField?.id ?? resp.data?.objectId ?? "",
    owner: String(f.owner ?? ""),
    agent: String(f.agent ?? ""),
    name: String(f.name ?? ""),
    budgetCap: BigInt((f.budget_cap as string | number | bigint) ?? 0),
    spent: BigInt((f.spent as string | number | bigint) ?? 0),
    allowedVenues: Array.isArray(f.allowed_venues) ? (f.allowed_venues as string[]) : [],
    maxConcentrationBps: Number(f.max_concentration_bps ?? 0),
    expiresAtMs: BigInt((f.expires_at_ms as string | number | bigint) ?? 0),
    autoApprovePct: Number(f.auto_approve_pct ?? 0),
    riskTolerance: String(f.risk_tolerance ?? ""),
    revoked: Boolean(f.revoked),
    createdAtMs: BigInt((f.created_at_ms as string | number | bigint) ?? 0),
  };
}

/**
 * Poll for OperatorPolicy shared objects owned by `userAddress`.
 *
 * Strategy: filter PolicyCreated events server-side by the event type, then
 * filter the parsed events client-side by `owner == userAddress`, then
 * fetch each policy's current state. Sorted newest first.
 */
export function useOperatorPolicies(
  userAddress: string | undefined,
  pollMs = 3000,
): { policies: OperatorPolicyDecoded[]; loading: boolean } {
  const client = useSuiClient();
  const [policies, setPolicies] = useState<OperatorPolicyDecoded[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userAddress) {
      setPolicies([]);
      setLoading(false);
      return;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const events = await client.queryEvents({
          query: {
            MoveEventType: `${BRIEF_PACKAGE_ID}::operator_policy::PolicyCreated`,
          },
          order: "descending",
          limit: 50,
        });

        const ids = new Set<string>();
        for (const ev of events.data) {
          const p = ev.parsedJson as { id?: string; owner?: string };
          if (!p?.id || !p.owner) continue;
          if (p.owner !== userAddress) continue;
          ids.add(p.id);
        }

        if (ids.size === 0) {
          if (!cancelled) {
            setPolicies([]);
            setLoading(false);
          }
          return;
        }

        const fetched = await Promise.all(
          Array.from(ids).map((id) =>
            client.getObject({ id, options: { showContent: true } }),
          ),
        );
        const decoded = fetched
          .map(decodeOperatorPolicy)
          .filter((p): p is OperatorPolicyDecoded => !!p)
          .sort((a, b) => Number(b.createdAtMs - a.createdAtMs));

        if (!cancelled) {
          setPolicies(decoded);
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
  }, [userAddress, client, pollMs]);

  return { policies, loading };
}

// ---------------------------------------------------------------------------
// Templates · the four canned operator types judges see on the Create screen
// ---------------------------------------------------------------------------

export type OperatorTemplate = {
  id: string;
  label: string;
  blurb: string;
  defaults: {
    name: string;
    budgetSui: number;
    allowedVenues: string[];
    maxConcentrationPct: number;
    expiryHours: number;
    autoApprovePct: number;
    riskTolerance: "low" | "medium" | "high";
  };
};

export const OPERATOR_TEMPLATES: OperatorTemplate[] = [
  {
    id: "conservative-yield",
    label: "Conservative Yield",
    blurb: "Diversified low-risk yield across audited protocols. Tight concentration caps, frequent rebalancing.",
    defaults: {
      name: "Conservative Yield Operator",
      budgetSui: 50,
      allowedVenues: ["DeepBook", "NAVI", "Suilend"],
      maxConcentrationPct: 30,
      expiryHours: 24,
      autoApprovePct: 50,
      riskTolerance: "low",
    },
  },
  {
    id: "stablecoin-treasury",
    label: "Stablecoin Treasury",
    blurb: "Park USDC, generate yield through DeepBook market making and NAVI lending. Conservative sizing.",
    defaults: {
      name: "Stablecoin Treasury Operator",
      budgetSui: 100,
      allowedVenues: ["DeepBook", "NAVI"],
      maxConcentrationPct: 50,
      expiryHours: 168,
      autoApprovePct: 75,
      riskTolerance: "low",
    },
  },
  {
    id: "market-maker",
    label: "AI Market Maker",
    blurb: "Provide liquidity on DeepBook SUI pairs. Higher activity, looser concentration limits.",
    defaults: {
      name: "AI Market Maker",
      budgetSui: 30,
      allowedVenues: ["DeepBook"],
      maxConcentrationPct: 80,
      expiryHours: 12,
      autoApprovePct: 90,
      riskTolerance: "medium",
    },
  },
  {
    id: "growth",
    label: "Low-Risk Growth",
    blurb: "Modest exposure to higher-APY protocols when their TVL + audit + age checks pass.",
    defaults: {
      name: "Low-Risk Growth Operator",
      budgetSui: 75,
      allowedVenues: ["DeepBook", "NAVI", "Suilend", "SpringSui"],
      maxConcentrationPct: 40,
      expiryHours: 72,
      autoApprovePct: 60,
      riskTolerance: "medium",
    },
  },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export const SUI_DECIMALS = 9n;
export const MIST_PER_SUI = 1_000_000_000n; // 1e9

export function suiToMist(sui: number): bigint {
  return BigInt(Math.floor(sui * Number(MIST_PER_SUI)));
}

export function mistToSui(mist: bigint): number {
  return Number(mist) / Number(MIST_PER_SUI);
}

export function formatSui(mist: bigint, decimals = 2): string {
  return mistToSui(mist).toFixed(decimals);
}

export function formatCountdown(targetMs: bigint): string {
  const ms = Math.max(0, Number(targetMs) - Date.now());
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRelative(ms: bigint): string {
  const diff = Date.now() - Number(ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
