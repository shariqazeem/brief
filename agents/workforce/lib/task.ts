// Task module client helpers. Mirrors brief::task in TypeScript: tx
// builders for post/accept/submit/approve/expire, and a fetcher that
// decodes a Task shared object.

import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import type { AgentContext } from "../../lib/sui.js";

export const SUI_CLOCK_OBJECT_ID = "0x6";

// Status codes from move/sources/task.move
export const TASK_OPEN = 0;
export const TASK_ACCEPTED = 1;
export const TASK_DELIVERED = 2;
export const TASK_APPROVED = 3;
export const TASK_EXPIRED = 4;

export type TaskStatus =
  | "open"
  | "accepted"
  | "delivered"
  | "approved"
  | "expired"
  | "unknown";

export function decodeStatus(code: number): TaskStatus {
  switch (code) {
    case TASK_OPEN:
      return "open";
    case TASK_ACCEPTED:
      return "accepted";
    case TASK_DELIVERED:
      return "delivered";
    case TASK_APPROVED:
      return "approved";
    case TASK_EXPIRED:
      return "expired";
    default:
      return "unknown";
  }
}

// ----------------------------------------------------------------------
// Event payload shapes (the BCS-decoded JSON the Sui RPC returns)
// ----------------------------------------------------------------------

export type TaskPostedEvent = {
  task_id: string;
  poster: string;
  assigned_to: string;
  title: string;
  primary_capability: string;
  bounty_amount: string; // u64 as string
  deadline_ms: string;
  parent_policy: string | null;
  posted_at_ms: string;
};

export type TaskAcceptedEvent = {
  task_id: string;
  agent: string;
  accepted_at_ms: string;
};

export type TaskSubmittedEvent = {
  task_id: string;
  agent: string;
  deliverable_id: string;
  submitted_at_ms: string;
};

export type TaskApprovedEvent = {
  task_id: string;
  poster: string;
  agent: string;
  deliverable_id: string;
  bounty_amount: string;
  primary_capability: string;
  parent_policy: string | null;
  approved_at_ms: string;
};

export type TaskExpiredEvent = {
  task_id: string;
  poster: string;
  bounty_returned: string;
  expired_at_ms: string;
};

// Normalize Sui's Option<ID> wire shape, which deserializes as
// { vec: [] } for None and { vec: [id] } for Some.
export function unwrapOptionId(
  v: string | null | { vec?: string[] },
): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v?.vec) && v.vec.length > 0) return v.vec[0];
  return null;
}

// ----------------------------------------------------------------------
// On-chain Task object decode
// ----------------------------------------------------------------------

export type TaskFields = {
  id: { id: string };
  poster: string;
  assigned_to: string;
  title: string;
  spec_blob: string;
  primary_capability: string;
  // Balance<SUI> serializes through Sui RPC's showContent as a bare numeric
  // string (since Balance<T> wraps a single u64 field). The { fields: { value } }
  // shape only appears for richer types; we tolerate both for safety.
  bounty: string | number | { fields?: { value?: string | number } } | null;
  posted_at_ms: string;
  deadline_ms: string;
  status: number;
  deliverable_id: string | { vec?: string[] } | null;
  parent_policy: string | { vec?: string[] } | null;
};

function readBalanceValue(
  b: TaskFields["bounty"],
): bigint {
  if (b == null) return 0n;
  if (typeof b === "string" || typeof b === "number") return BigInt(b);
  const nested = b?.fields?.value;
  if (nested != null) return BigInt(nested);
  return 0n;
}

export type TaskSummary = {
  id: string;
  poster: string;
  assignedTo: string;
  title: string;
  specBlob: string;
  primaryCapability: string;
  bountyAmount: bigint;
  postedAtMs: bigint;
  deadlineMs: bigint;
  status: TaskStatus;
  deliverableId: string | null;
  parentPolicy: string | null;
};

export async function fetchTask(
  ctx: AgentContext,
  taskId: string,
): Promise<TaskSummary> {
  const resp = await ctx.client.getObject({
    id: taskId,
    options: { showContent: true, showOwner: true },
  });
  const content = resp.data?.content;
  if (!content || content.dataType !== "moveObject") {
    throw new Error(`Task ${taskId} has no Move content`);
  }
  const fields = (content as unknown as { fields: TaskFields }).fields;

  return {
    id: taskId,
    poster: fields.poster,
    assignedTo: fields.assigned_to,
    title: fields.title,
    specBlob: fields.spec_blob,
    primaryCapability: fields.primary_capability,
    bountyAmount: readBalanceValue(fields.bounty),
    postedAtMs: BigInt(fields.posted_at_ms),
    deadlineMs: BigInt(fields.deadline_ms),
    status: decodeStatus(Number(fields.status)),
    deliverableId: unwrapOptionId(fields.deliverable_id),
    parentPolicy: unwrapOptionId(fields.parent_policy),
  };
}

// ----------------------------------------------------------------------
// Tx builders · direct module calls
// ----------------------------------------------------------------------

export type PostTaskArgs = {
  bountyCoinId: string; // owned Coin<SUI> id to use as bounty
  assignedTo: string;
  title: string;
  specBlob: string;
  primaryCapability: string;
  deadlineMs: bigint;
  parentPolicyId: string | null;
};

/**
 * Build a tx that splits the bounty out of the gas coin (so we don't need
 * to pre-merge SUI coins) and posts the task. The split keeps things tidy
 * for testing where we have one large gas coin and want to keep change.
 */
export function buildPostTaskTx(
  ctx: AgentContext,
  args: Omit<PostTaskArgs, "bountyCoinId"> & { bountyMist: bigint },
): Transaction {
  const tx = new Transaction();
  const [bountyCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(args.bountyMist)]);

  appendPostTask(tx, ctx, {
    bountyCoin,
    assignedTo: args.assignedTo,
    title: args.title,
    specBlob: args.specBlob,
    primaryCapability: args.primaryCapability,
    deadlineMs: args.deadlineMs,
    parentPolicyId: args.parentPolicyId,
  });

  return tx;
}

export type AppendPostTaskArgs = {
  /** A TransactionArgument referencing the coin to escrow as bounty -
   *  typically one element of a `tx.splitCoins(tx.gas, [...])` array. */
  bountyCoin: ReturnType<Transaction["splitCoins"]>[number];
  assignedTo: string;
  title: string;
  specBlob: string;
  primaryCapability: string;
  deadlineMs: bigint;
  parentPolicyId: string | null;
};

/**
 * Append a task::post call to an existing PTB. Lets the Planner batch
 * N sub-tasks of a single mission into ONE atomic transaction -
 * eliminates the intra-mission gas-coin race that previously dropped
 * the 2nd post when it tried to use a stale version of the same gas
 * coin. Use with tx.splitCoins(tx.gas, [b1, b2, …, bN]) to fund each
 * post in the same PTB.
 */
export function appendPostTask(
  tx: Transaction,
  ctx: AgentContext,
  args: AppendPostTaskArgs,
): void {
  tx.moveCall({
    target: `${ctx.packageId}::task::post`,
    arguments: [
      args.bountyCoin,
      tx.pure.address(args.assignedTo),
      tx.pure.string(args.title),
      tx.pure.string(args.specBlob),
      tx.pure.string(args.primaryCapability),
      tx.pure.u64(args.deadlineMs),
      args.parentPolicyId === null
        ? tx.pure(bcs.option(bcs.Address).serialize(null))
        : tx.pure(bcs.option(bcs.Address).serialize(args.parentPolicyId)),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}

export function buildAcceptTaskTx(
  ctx: AgentContext,
  taskId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::task::accept`,
    arguments: [tx.object(taskId), tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  return tx;
}

export type MintAndSubmitArgs = {
  taskId: string;
  deliverableOwner: string; // typically task.poster so the receipt is theirs
  schemaVersion: bigint;
  inlinePayload: Uint8Array;
  walrusBlobId: string | null;
  paymentAmount: bigint;
};

/**
 * Append the mint(Deliverable) + task::submit pair onto an existing PTB.
 * Useful when an agent wants to compose other on-chain effects (e.g. real
 * DeepBook limit orders) into the same atomic transaction.
 */
export function appendMintAndSubmit(
  tx: Transaction,
  ctx: AgentContext,
  args: MintAndSubmitArgs,
): void {
  const [deliverableId] = tx.moveCall({
    target: `${ctx.packageId}::work_object::mint`,
    arguments: [
      tx.pure.address(args.deliverableOwner),
      tx.pure.string("Deliverable"),
      tx.pure.u64(args.schemaVersion),
      tx.pure.vector("u8", Array.from(args.inlinePayload)),
      args.walrusBlobId === null
        ? tx.pure.option("string", null)
        : tx.pure.option("string", args.walrusBlobId),
      tx.pure.vector("id", [args.taskId]),
      tx.pure.u64(args.paymentAmount),
    ],
  });

  tx.moveCall({
    target: `${ctx.packageId}::task::submit`,
    arguments: [
      tx.object(args.taskId),
      deliverableId,
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}

/**
 * Mint the Deliverable WorkObject AND submit it to the task in a single
 * atomic PTB. The Deliverable is parented to the task (its ID), and the
 * task transitions to DELIVERED · both or neither.
 */
export function buildMintAndSubmitTx(
  ctx: AgentContext,
  args: MintAndSubmitArgs,
): Transaction {
  const tx = new Transaction();
  appendMintAndSubmit(tx, ctx, args);
  return tx;
}

/**
 * Approve a policied task. Atomic with operator_policy::record_spend -
 * if the policy is revoked between submit and this call, the whole PTB
 * aborts and the bounty stays escrowed.
 */
export function buildApproveWithPolicyTx(
  ctx: AgentContext,
  args: {
    taskId: string;
    policyId: string;
    agentRegId: string;
  },
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::task::approve_with_policy`,
    arguments: [
      tx.object(args.taskId),
      tx.object(args.policyId),
      tx.object(args.agentRegId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

export function buildApproveDirectTx(
  ctx: AgentContext,
  args: {
    taskId: string;
    agentRegId: string;
  },
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::task::approve_direct`,
    arguments: [
      tx.object(args.taskId),
      tx.object(args.agentRegId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

export function buildExpireTaskTx(
  ctx: AgentContext,
  taskId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::task::expire`,
    arguments: [tx.object(taskId), tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  return tx;
}
