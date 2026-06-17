// Helpers for the operator_policy Move module: build TXs for create / revoke
// / extend / record_spend, fetch + decode the OperatorPolicy shared object.
//
// The on-chain policy is the trust anchor of the pivot · the AI is not
// trusted, the policy is. Any agent action that wants to spend must call
// `record_spend` in the same PTB as its trade; a violated invariant aborts
// the whole transaction.

import { Transaction } from "@mysten/sui/transactions";
import type { AgentContext } from "./sui.js";

/** Subset of SuiObjectResponse we read · kept structural and permissive
 *  so we don't bind to the SDK's internal type-module layout. */
type SuiObjectLite = {
  data?: {
    objectId?: string;
    content?: { dataType: string; fields?: unknown } | null;
  } | null;
};

/** Sui's shared Clock object lives at a well-known address. */
export const SUI_CLOCK_ID = "0x6";

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

export type PolicyCreatedEvent = {
  id: string;
  owner: string;
  agent: string;
  name: string;
  budget_cap: string;
  expires_at_ms: string;
  created_at_ms: string;
};

// ---------------------------------------------------------------------------
// Tx builders
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

export function buildExtendTx(args: {
  packageId: string;
  policyId: string;
  newBudgetCap: bigint;
  newExpiresAtMs: bigint;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.packageId}::operator_policy::extend`,
    arguments: [
      tx.object(args.policyId),
      tx.pure.u64(args.newBudgetCap),
      tx.pure.u64(args.newExpiresAtMs),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  return tx;
}

/**
 * Add a `record_spend` Move call to an existing PTB. Use this so the agent
 * can spend + enforce policy in one atomic transaction · if the policy is
 * revoked/expired/over-budget/wrong-venue, the whole PTB aborts.
 */
export function addRecordSpendCall(
  tx: Transaction,
  args: {
    packageId: string;
    policyId: string;
    amount: bigint;
    venue: string;
  },
): void {
  tx.moveCall({
    target: `${args.packageId}::operator_policy::record_spend`,
    arguments: [
      tx.object(args.policyId),
      tx.pure.u64(args.amount),
      tx.pure.string(args.venue),
      tx.object(SUI_CLOCK_ID),
    ],
  });
}

// ---------------------------------------------------------------------------
// Decoder + fetch
// ---------------------------------------------------------------------------

export function decodeOperatorPolicy(
  resp: SuiObjectLite,
): OperatorPolicyDecoded | null {
  const content = resp.data?.content;
  if (!content || content.dataType !== "moveObject") return null;
  const rawFields = content.fields;
  if (!rawFields || typeof rawFields !== "object" || Array.isArray(rawFields)) return null;
  const f = rawFields as Record<string, unknown>;
  const id =
    (f.id as { id?: string } | undefined)?.id ??
    resp.data?.objectId ??
    "";
  return {
    id,
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

export async function fetchOperatorPolicy(
  ctx: AgentContext,
  id: string,
): Promise<OperatorPolicyDecoded | null> {
  const resp = await ctx.client.getObject({
    id,
    options: { showContent: true },
  });
  return decodeOperatorPolicy(resp);
}
