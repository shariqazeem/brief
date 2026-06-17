// agent_registry Move module client helpers: tx builders for register/update
// + a fetcher that returns the agent's AgentRegistration shared object by
// the agent address. Used by the workforce agents to (a) self-register on
// first boot and (b) get their own `reg` object id for the approve_*
// settlement call.
//
// The on-chain registration is a shared object; we discover it by querying
// AgentRegistered events filtered by agent_address. Registration is idempotent
// from the agent's POV: if found, skip; otherwise register.

import { Transaction } from "@mysten/sui/transactions";
import type { AgentContext } from "../../lib/sui.js";

export type AgentRegisteredEvent = {
  agent_address: string;
  display_name: string;
  registered_at_ms: string;
};

export type AgentRegistrationFields = {
  id: { id: string };
  agent_address: string;
  display_name: string;
  capabilities: string[];
  accepts_object_types: string[];
  produces_object_types: string[];
  base_price_per_call: string;
  endpoint_url: string;
  bio_blob: string;
  completed_tasks: string;
  total_paid: string;
  last_settled_ms: string;
  reputation_score: string;
  registered_at_ms: string;
};

export type AgentRegistration = {
  id: string;
  agentAddress: string;
  displayName: string;
  capabilities: string[];
  acceptsObjectTypes: string[];
  producesObjectTypes: string[];
  basePricePerCall: bigint;
  endpointUrl: string;
  bioBlob: string;
  completedTasks: bigint;
  totalPaid: bigint;
  lastSettledMs: bigint;
  reputationScore: bigint;
  registeredAtMs: bigint;
};

export type RegisterAgentArgs = {
  displayName: string;
  capabilities: string[];
  acceptsObjectTypes: string[];
  producesObjectTypes: string[];
  basePricePerCall: bigint;
  endpointUrl: string;
  bioBlob: string;
};

export function buildRegisterAgentTx(
  ctx: AgentContext,
  args: RegisterAgentArgs,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::agent_registry::register`,
    arguments: [
      tx.pure.string(args.displayName),
      tx.pure.vector("string", args.capabilities),
      tx.pure.vector("string", args.acceptsObjectTypes),
      tx.pure.vector("string", args.producesObjectTypes),
      tx.pure.u64(args.basePricePerCall),
      tx.pure.string(args.endpointUrl),
      tx.pure.string(args.bioBlob),
    ],
  });
  return tx;
}

export type UpdateAgentArgs = {
  registrationId: string;
  capabilities: string[];
  acceptsObjectTypes: string[];
  producesObjectTypes: string[];
  basePricePerCall: bigint;
  endpointUrl: string;
  bioBlob: string;
};

/**
 * Build a tx calling agent_registry::update with the full new field set.
 * The on-chain function REPLACES (not merges) capabilities/accepts/produces.
 */
export function buildUpdateAgentTx(
  ctx: AgentContext,
  args: UpdateAgentArgs,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::agent_registry::update`,
    arguments: [
      tx.object(args.registrationId),
      tx.pure.vector("string", args.capabilities),
      tx.pure.vector("string", args.acceptsObjectTypes),
      tx.pure.vector("string", args.producesObjectTypes),
      tx.pure.u64(args.basePricePerCall),
      tx.pure.string(args.endpointUrl),
      tx.pure.string(args.bioBlob),
    ],
  });
  return tx;
}

/**
 * Find the AgentRegistration shared object for a given agent address by
 * walking AgentRegistered events. Returns null if none exists.
 *
 * Walks at most the last `limit` AgentRegistered events; testnet volume is
 * low enough that this is fine for the demo.
 */
export async function findAgentRegistration(
  ctx: AgentContext,
  agentAddress: string,
  limit = 200,
): Promise<AgentRegistration | null> {
  const eventType = `${ctx.typeOriginId}::agent_registry::AgentRegistered`;
  const page = await ctx.client.queryEvents({
    query: { MoveEventType: eventType },
    order: "descending",
    limit,
  });

  for (const ev of page.data) {
    const p = ev.parsedJson as AgentRegisteredEvent;
    if (p.agent_address !== agentAddress) continue;

    // We need the object ID. The event doesn't carry it; the registration
    // is created in the same tx, so fetch the tx's created objects and
    // find the one of type ::agent_registry::AgentRegistration.
    const tx = await ctx.client.getTransactionBlock({
      digest: ev.id.txDigest,
      options: { showObjectChanges: true },
    });
    const created = (tx.objectChanges ?? []).find(
      (c) =>
        c.type === "created" &&
        typeof (c as { objectType?: string }).objectType === "string" &&
        (c as { objectType?: string }).objectType?.includes(
          "::agent_registry::AgentRegistration",
        ),
    ) as { objectId?: string } | undefined;

    if (!created?.objectId) continue;
    return fetchAgentRegistration(ctx, created.objectId);
  }
  return null;
}

/**
 * Walk every AgentRegistered event (descending, capped at `limit`) and
 * return the most-recent live registration per distinct agent address.
 *
 * This is the multi-wallet planner's discovery primitive: it surfaces ALL
 * specialists registered on chain, not just the ones at the caller's own
 * address. Same address registering twice → only the newer one is kept
 * (matches the on-chain `update` semantics that REPLACE the prior fields).
 */
export async function listLatestRegistrationsByAddress(
  ctx: AgentContext,
  limit = 500,
): Promise<Map<string, AgentRegistration>> {
  const eventType = `${ctx.typeOriginId}::agent_registry::AgentRegistered`;
  const page = await ctx.client.queryEvents({
    query: { MoveEventType: eventType },
    order: "descending",
    limit,
  });

  const byAddress = new Map<string, AgentRegistration>();
  for (const ev of page.data) {
    const p = ev.parsedJson as AgentRegisteredEvent;
    // Descending order → first hit per address is the newest.
    if (byAddress.has(p.agent_address)) continue;

    const tx = await ctx.client.getTransactionBlock({
      digest: ev.id.txDigest,
      options: { showObjectChanges: true },
    });
    const created = (tx.objectChanges ?? []).find(
      (c) =>
        c.type === "created" &&
        typeof (c as { objectType?: string }).objectType === "string" &&
        (c as { objectType?: string }).objectType?.includes(
          "::agent_registry::AgentRegistration",
        ),
    ) as { objectId?: string } | undefined;

    if (!created?.objectId) continue;
    const reg = await fetchAgentRegistration(ctx, created.objectId);
    if (!reg) continue;
    byAddress.set(p.agent_address, reg);
  }
  return byAddress;
}

export async function fetchAgentRegistration(
  ctx: AgentContext,
  id: string,
): Promise<AgentRegistration | null> {
  const resp = await ctx.client.getObject({
    id,
    options: { showContent: true },
  });
  const content = resp.data?.content;
  if (!content || content.dataType !== "moveObject") return null;
  const f = (content as unknown as { fields: AgentRegistrationFields }).fields;
  return decodeRegistrationFields(f);
}

/**
 * Same as fetchAgentRegistration but tolerates RPC propagation lag:
 * retries up to `attempts` times when the object isn't visible yet (the
 * register/update tx just landed and we rotated to a different node
 * mid-call). Returns null if every attempt comes up empty.
 */
export async function fetchAgentRegistrationWithRetry(
  ctx: AgentContext,
  id: string,
  attempts = 6,
  delayMs = 750,
): Promise<AgentRegistration | null> {
  for (let i = 0; i < attempts; i++) {
    const reg = await fetchAgentRegistration(ctx, id);
    if (reg) return reg;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

function decodeRegistrationFields(
  f: AgentRegistrationFields,
): AgentRegistration {
  return {
    id: f.id.id,
    agentAddress: f.agent_address,
    displayName: f.display_name,
    capabilities: f.capabilities ?? [],
    acceptsObjectTypes: f.accepts_object_types ?? [],
    producesObjectTypes: f.produces_object_types ?? [],
    basePricePerCall: BigInt(f.base_price_per_call ?? "0"),
    endpointUrl: f.endpoint_url ?? "",
    bioBlob: f.bio_blob ?? "",
    completedTasks: BigInt(f.completed_tasks ?? "0"),
    totalPaid: BigInt(f.total_paid ?? "0"),
    lastSettledMs: BigInt(f.last_settled_ms ?? "0"),
    reputationScore: BigInt(f.reputation_score ?? "0"),
    registeredAtMs: BigInt(f.registered_at_ms ?? "0"),
  };
}

/**
 * Ensure this agent's declared capabilities are present in the on-chain
 * AgentRegistration. Augments the existing entry (via `update`) when one
 * already exists at this address · useful when multiple specialist agents
 * share a wallet during Wk1 single-wallet mode and each needs to publish
 * its own capability without clobbering the other's.
 *
 * The capability merge is set-union: existing ∪ args.capabilities. Same for
 * accepts/produces. Pricing / endpoint / bio are preserved when the existing
 * field is non-empty.
 */
export async function augmentRegistration(
  ctx: AgentContext,
  args: RegisterAgentArgs,
): Promise<AgentRegistration> {
  const existing = await findAgentRegistration(ctx, ctx.address);
  if (!existing) {
    return ensureRegistration(ctx, args);
  }
  const merge = (a: string[], b: string[]): string[] =>
    Array.from(new Set([...a, ...b]));
  const covers = (a: string[], b: string[]): boolean =>
    b.every((x) => a.includes(x));
  if (
    covers(existing.capabilities, args.capabilities) &&
    covers(existing.acceptsObjectTypes, args.acceptsObjectTypes) &&
    covers(existing.producesObjectTypes, args.producesObjectTypes)
  ) {
    console.log(
      `[registry] augmentation no-op · registration already covers [${args.capabilities.join(", ")}]`,
    );
    return existing;
  }
  const newCaps = merge(existing.capabilities, args.capabilities);
  const newAccepts = merge(existing.acceptsObjectTypes, args.acceptsObjectTypes);
  const newProduces = merge(existing.producesObjectTypes, args.producesObjectTypes);
  console.log(
    `[registry] augmenting: caps [${existing.capabilities.join(", ")}] → [${newCaps.join(", ")}]`,
  );
  const tx = buildUpdateAgentTx(ctx, {
    registrationId: existing.id,
    capabilities: newCaps,
    acceptsObjectTypes: newAccepts,
    producesObjectTypes: newProduces,
    basePricePerCall:
      existing.basePricePerCall > 0n ? existing.basePricePerCall : args.basePricePerCall,
    endpointUrl: existing.endpointUrl || args.endpointUrl,
    bioBlob: existing.bioBlob || args.bioBlob,
  });
  const res = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true },
  });
  if (res.effects?.status?.status !== "success") {
    throw new Error(
      `agent_registry::update failed: ${res.effects?.status?.error ?? "unknown"}`,
    );
  }
  const refetched = await fetchAgentRegistrationWithRetry(ctx, existing.id);
  if (!refetched) throw new Error("update succeeded but registration vanished");
  return refetched;
}

/**
 * Ensure this agent is registered. If a registration is found on chain,
 * returns it. Otherwise builds + signs a register tx, waits for inclusion,
 * then refetches and returns it.
 */
export async function ensureRegistration(
  ctx: AgentContext,
  args: RegisterAgentArgs,
): Promise<AgentRegistration> {
  const existing = await findAgentRegistration(ctx, ctx.address);
  if (existing) return existing;

  console.log(
    `[registry] no AgentRegistration found for ${ctx.address.slice(0, 10)}… · registering ${args.displayName}`,
  );

  const tx = buildRegisterAgentTx(ctx, args);
  const res = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showObjectChanges: true, showEffects: true },
  });

  if (res.effects?.status?.status !== "success") {
    throw new Error(
      `Failed to register agent: ${res.effects?.status?.error ?? "unknown"}`,
    );
  }

  const created = (res.objectChanges ?? []).find(
    (c) =>
      c.type === "created" &&
      typeof (c as { objectType?: string }).objectType === "string" &&
      (c as { objectType?: string }).objectType?.includes(
        "::agent_registry::AgentRegistration",
      ),
  ) as { objectId?: string } | undefined;

  if (!created?.objectId) {
    throw new Error("register tx succeeded but no AgentRegistration was created");
  }

  // Retry the read-back: register tx may have landed on one RPC node while
  // our resilient transport rotated to another mid-call.
  const reg = await fetchAgentRegistrationWithRetry(ctx, created.objectId);
  if (!reg) throw new Error("registered but could not refetch registration");
  console.log(
    `[registry] registered as ${reg.displayName} (reg=${reg.id.slice(0, 10)}…)`,
  );
  return reg;
}
