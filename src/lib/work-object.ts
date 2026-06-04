// Shared WorkObject helpers for the frontend. Mirrors agents/lib/work-object.ts
// but uses client-side wallet hooks for signing.

import { Transaction } from "@mysten/sui/transactions";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

export type WorkObjectKind =
  | "Query"
  | "Research"
  | "Strategy"
  | "StrategyAlt"
  | "Confirmation"
  | "Execution"
  | "Operator"
  | "Rejection";

export type MintEventPayload = {
  id: string;
  object_type: string;
  producer: string;
  owner: string;
  parent_objects: string[];
  payment_amount: string;
  timestamp_ms: string;
};

export type WorkObjectFields = {
  id: { id: string };
  object_type: string;
  schema_version: string;
  payload: number[];
  walrus_blob_id: string | null;
  parent_objects: string[];
  producer_agent: string;
  consumer_agents: string[];
  timestamp_ms: string;
  payment_amount: string;
};

export type DecodedWorkObject = {
  id: string;
  kind: string;
  schemaVersion: bigint;
  payloadBytes: Uint8Array | null;
  walrusBlobId: string | null;
  parentIds: string[];
  producer: string;
  owner: string | null;
  timestampMs: bigint;
  paymentAmount: bigint;
  consumerCount: number;
};

export function buildMintQueryTx(args: {
  packageId: string;
  owner: string;
  topic: string;
}): Transaction {
  const tx = new Transaction();
  const payload = new TextEncoder().encode(JSON.stringify({ topic: args.topic }));
  tx.moveCall({
    target: `${args.packageId}::work_object::mint`,
    arguments: [
      tx.pure.address(args.owner),
      tx.pure.string("Query"),
      tx.pure.u64(1n),
      tx.pure.vector("u8", Array.from(payload)),
      tx.pure.option("string", null),
      tx.pure.vector("id", []),
      tx.pure.u64(0n),
    ],
  });
  return tx;
}

/**
 * Mint a Confirmation WorkObject parented to a Strategy. This is the
 * "explicit confirmation step" required by the Intent Engine sub-track:
 * the user signs an on-chain TX before the ExecutionAgent fires. The
 * Confirmation is itself a real WorkObject in the lineage.
 */
export function buildMintConfirmationTx(args: {
  packageId: string;
  owner: string;
  strategyId: string;
}): Transaction {
  const tx = new Transaction();
  const payload = new TextEncoder().encode(
    JSON.stringify({
      confirmed: true,
      strategy_id: args.strategyId,
      confirmed_at_ms: Date.now(),
    }),
  );
  tx.moveCall({
    target: `${args.packageId}::work_object::mint`,
    arguments: [
      tx.pure.address(args.owner),
      tx.pure.string("Confirmation"),
      tx.pure.u64(1n),
      tx.pure.vector("u8", Array.from(payload)),
      tx.pure.option("string", null),
      tx.pure.vector("id", [args.strategyId]),
      tx.pure.u64(0n),
    ],
  });
  return tx;
}

export async function fetchWorkObject(
  client: SuiJsonRpcClient,
  objectId: string,
): Promise<DecodedWorkObject | null> {
  const resp = await client.getObject({
    id: objectId,
    options: { showContent: true, showOwner: true },
  });
  const content = resp.data?.content;
  if (!content || content.dataType !== "moveObject") return null;
  const fields = (content as unknown as { fields: WorkObjectFields }).fields;
  const owner = resp.data?.owner;
  const ownerAddr =
    typeof owner === "object" && owner && "AddressOwner" in owner
      ? (owner as { AddressOwner: string }).AddressOwner
      : null;

  const payloadBytes =
    Array.isArray(fields.payload) && fields.payload.length > 0
      ? new Uint8Array(fields.payload)
      : null;

  return {
    id: objectId,
    kind: fields.object_type,
    schemaVersion: BigInt(fields.schema_version),
    payloadBytes,
    walrusBlobId: fields.walrus_blob_id,
    parentIds: fields.parent_objects ?? [],
    producer: fields.producer_agent,
    owner: ownerAddr,
    timestampMs: BigInt(fields.timestamp_ms),
    paymentAmount: BigInt(fields.payment_amount),
    consumerCount: (fields.consumer_agents ?? []).length,
  };
}

export function decodePayload<T = unknown>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export const WALRUS_TESTNET_AGGREGATOR =
  "https://aggregator.walrus-testnet.walrus.space";

/** Walrus aggregator URL for a blob (cacheable via the browser). */
export function walrusBlobUrl(blobId: string): string {
  return `${WALRUS_TESTNET_AGGREGATOR}/v1/blobs/${blobId}`;
}

/** Fetch the JSON payload stored on Walrus for this WorkObject. */
export async function fetchWalrusPayload<T = unknown>(
  blobId: string,
  signal?: AbortSignal,
): Promise<T> {
  const resp = await fetch(walrusBlobUrl(blobId), { signal });
  if (!resp.ok) {
    throw new Error(`Walrus read ${blobId} failed: HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}
