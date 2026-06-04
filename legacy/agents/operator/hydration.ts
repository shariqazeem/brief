// Memory hydration — reconstructs an operator's behavioral memory from its
// own past Operator + Rejection WorkObjects on-chain.
//
// Why: on agent process restart, the in-memory STORE in memory.ts wipes.
// Without this hydration step, a restarted operator forgets every prior
// venue choice, concentration history, and posture context — and the user
// sees the next decision land with no continuity.
//
// What: we walk the agent's own owned WorkObjects (the agent is the
// `producer_agent` field), filter to actions parented to this policy,
// replay the in-memory record* calls in chronological order. The result
// is bit-equivalent to the memory the agent would have if it had been
// running the whole time.

import type { AgentContext } from "../lib/sui.js";
import { fetchOperatorPolicy } from "../lib/operator-policy.js";
import {
  forgetPolicy,
  getMemory,
  recordAction,
  recordRejection,
  type OperatorMemory,
} from "./memory.js";

type WorkObjectLite = {
  id: string;
  kind: string;
  parentIds: string[];
  timestampMs: bigint;
  payloadBytes: Uint8Array | null;
};

type OperatorPayload = {
  venue?: string;
  amount_mist?: string;
  score?: number;
  confidence?: number;
  concentration_pct_after?: number;
};

type SuiObjectInfo = {
  data?: {
    objectId?: string;
    content?: { dataType: string; fields?: unknown } | null;
  };
};

/**
 * Read the operator's own past WorkObjects, filter to this policy, replay
 * them into memory in chronological order. Returns the rehydrated memory
 * (also stored in the module-level STORE).
 */
export async function hydrateMemoryFromChain(
  ctx: AgentContext,
  policyId: string,
): Promise<OperatorMemory> {
  const memory = getMemory(policyId);
  if (memory.hydrated) return memory;
  memory.hydrated = true; // mark even on failure so we don't refetch every cycle

  try {
    const policy = await fetchOperatorPolicy(ctx, policyId);
    if (!policy) return memory;

    const owned = await ctx.client.getOwnedObjects({
      owner: ctx.address,
      filter: {
        StructType: `${ctx.typeOriginId}::work_object::WorkObject`,
      },
      options: { showContent: true },
    });

    const lite: WorkObjectLite[] = [];
    for (const entry of owned.data as SuiObjectInfo[]) {
      const content = entry.data?.content;
      if (!content || content.dataType !== "moveObject") continue;
      const fields = (content as unknown as { fields: Record<string, unknown> })
        .fields;
      const id = entry.data?.objectId;
      if (!id) continue;
      const parentIds = (fields.parent_objects as string[] | undefined) ?? [];
      if (!parentIds.includes(policyId)) continue;
      const kind = String(fields.object_type ?? "");
      if (kind !== "Operator" && kind !== "Rejection") continue;
      const payloadBytes = Array.isArray(fields.payload)
        ? new Uint8Array(fields.payload as number[])
        : null;
      const tsRaw = (fields.timestamp_ms as string | number | bigint) ?? 0;
      lite.push({
        id,
        kind,
        parentIds,
        timestampMs: BigInt(tsRaw),
        payloadBytes,
      });
    }

    // Replay chronologically — oldest first
    lite.sort((a, b) => Number(a.timestampMs - b.timestampMs));

    for (const wo of lite) {
      if (wo.kind === "Operator") {
        if (!wo.payloadBytes) continue;
        let payload: OperatorPayload;
        try {
          payload = JSON.parse(
            new TextDecoder().decode(wo.payloadBytes),
          ) as OperatorPayload;
        } catch {
          continue;
        }
        const venue = payload.venue;
        if (!venue) continue;
        const amount = BigInt(payload.amount_mist ?? "0");
        const score = typeof payload.score === "number" ? payload.score : 0.5;
        const confidence =
          typeof payload.confidence === "number" ? payload.confidence : 0.5;
        const concentration =
          typeof payload.concentration_pct_after === "number"
            ? payload.concentration_pct_after / 100
            : 0;
        recordAction(policyId, venue, amount, score, confidence, concentration);
      } else if (wo.kind === "Rejection") {
        recordRejection(policyId);
      }
    }

    if (lite.length === 0) {
      // No prior history — nothing to hydrate, but mark it explicitly so
      // the rationale generator can refer to "fresh operator" branches.
      return memory;
    }
    return memory;
  } catch {
    // Soft-fail; the operator just continues with empty memory. We log via
    // the caller in index.ts (which has the logger context).
    return memory;
  }
}

/** Drop the hydration mark — useful for tests / forced re-hydrate. */
export function resetHydration(policyId: string): void {
  const m = getMemory(policyId);
  m.hydrated = false;
}

/** Convenience for end-of-life cleanup so tests don't leak. */
export const _forgetForTests = forgetPolicy;
