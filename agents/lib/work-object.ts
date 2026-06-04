import { Transaction } from "@mysten/sui/transactions";
import type { AgentContext } from "./sui.js";

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
  payment_amount: string; // u64 serialized as string
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

/**
 * Build a Transaction that mints a new WorkObject parented to zero-or-more
 * input WorkObjects. The producer is the calling agent (tx sender).
 */
export function buildMintTx(
  ctx: AgentContext,
  args: {
    owner: string;
    kind: WorkObjectKind;
    schemaVersion: bigint;
    payload: Uint8Array;
    walrusBlobId: string | null;
    parentIds: string[];
    paymentAmount: bigint;
  },
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::work_object::mint`,
    arguments: [
      tx.pure.address(args.owner),
      tx.pure.string(args.kind),
      tx.pure.u64(args.schemaVersion),
      tx.pure.vector("u8", Array.from(args.payload)),
      args.walrusBlobId === null
        ? tx.pure.option("string", null)
        : tx.pure.option("string", args.walrusBlobId),
      tx.pure.vector("id", args.parentIds),
      tx.pure.u64(args.paymentAmount),
    ],
  });
  return tx;
}

/**
 * Fetch a WorkObject by ID and decode its fields. Returns the inline
 * payload as a Uint8Array, or null if Walrus blob ID is set instead.
 */
export async function fetchWorkObject(
  ctx: AgentContext,
  objectId: string,
): Promise<{
  id: string;
  kind: string;
  schemaVersion: bigint;
  inlinePayload: Uint8Array | null;
  walrusBlobId: string | null;
  parentIds: string[];
  owner: string | null;
  producer: string;
}> {
  const resp = await ctx.client.getObject({
    id: objectId,
    options: { showContent: true, showOwner: true },
  });
  const content = resp.data?.content;
  if (!content || content.dataType !== "moveObject") {
    throw new Error(`Object ${objectId} has no Move content`);
  }
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
    inlinePayload: payloadBytes,
    walrusBlobId: fields.walrus_blob_id,
    parentIds: fields.parent_objects ?? [],
    owner: ownerAddr,
    producer: fields.producer_agent,
  };
}

export function decodePayload(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function encodePayload(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

/**
 * Return the payload bytes of a WorkObject. If inline is empty but a
 * walrus_blob_id is set, fetches from the Walrus aggregator with retry.
 * Walrus blobs need a few seconds after upload to propagate to the
 * aggregator, so we back off and retry on initial misses.
 */
export async function readWorkObjectPayload(input: {
  inlinePayload: Uint8Array | null;
  walrusBlobId: string | null;
}): Promise<Uint8Array | null> {
  if (input.inlinePayload && input.inlinePayload.length > 0) {
    return input.inlinePayload;
  }
  if (!input.walrusBlobId) return null;

  const url = `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${input.walrusBlobId}`;
  const delaysMs = [0, 2000, 4000, 6000, 8000, 12000];
  for (let i = 0; i < delaysMs.length; i++) {
    if (delaysMs[i] > 0) {
      await new Promise((r) => setTimeout(r, delaysMs[i]));
    }
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        return new Uint8Array(buf);
      }
      // Aggregator returns 404 while blob is still propagating; keep retrying
    } catch {
      // network blip; keep retrying
    }
  }
  return null;
}
