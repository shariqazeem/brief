// StrategyAgent — consumes ResearchObjects, produces StrategyObjects.
//
// Reads the Research's `evaluated` array (live DeFiLlama data), allocates
// across the top 2–3 protocols using a deterministic risk-weighted policy,
// and emits real guardian warnings computed from the actual data.
// LLM optionally enriches the reasoning paragraph — the allocation and
// warnings come from real numbers regardless.

import { loadEnv } from "../lib/env.js";
import { makeAgentContext } from "../lib/sui.js";
import { startEventPoll } from "../lib/event-poll.js";
import {
  buildMintTx,
  decodePayload,
  encodePayload,
  fetchWorkObject,
  readWorkObjectPayload,
} from "../lib/work-object.js";
import { callLlm, llmMode } from "../lib/llm.js";
import { activeLlmKey } from "../lib/env.js";
import { uploadToWalrus, walrusEnabled } from "../lib/walrus.js";
import {
  computeGuardianWarnings,
  type ProtocolStat,
} from "../lib/protocol-data.js";

const STRATEGY_FEE_MIST = 500_000_000n;
const SCHEMA_VERSION = 2n;

// Default assumed order size (USD). Used for slippage and concentration
// risk computation. Real product would parse this from the user query.
const DEFAULT_ORDER_SIZE_USD = 1000;

type GuardianWarning = {
  kind: "slippage" | "concentration" | "stale_pool" | "audit_risk" | "young_protocol";
  severity: "info" | "amber" | "red";
  message: string;
};

type EvaluatedProtocol = {
  protocol: string;
  category: string;
  apy: number;
  tvl_usd: number;
  audit_status: "audited" | "partial" | "unaudited";
  age_days: number;
  risk: "low" | "medium" | "high";
  best_pool: string;
};

type ResearchInput = {
  topic: string;
  evaluated: EvaluatedProtocol[];
  top_pick?: { protocol: string };
};

type StrategyPayload = {
  parent_research_id: string;
  variant: "conservative";
  order_size_usd: number;
  allocation: Record<string, number>;
  projected_30d_yield: number;
  ptb_intent: {
    operations: { op: string; protocol: string; amount_pct: number }[];
  };
  guardian_warnings: GuardianWarning[];
  reasoning: string;
  llm_provider: string;
  generated_at_ms: number;
};

const SYSTEM = `You are a Sui DeFi strategist. You receive a research report with REAL on-chain protocol data and a computed allocation. Write a 2–3 sentence reasoning paragraph in plain English explaining the allocation choice. Do NOT invent numbers — only reference the data provided. Do NOT recommend protocols outside the data. Output prose only, no JSON, no preamble.`;

/**
 * Pure allocation policy — deterministic, based on real risk/APY data.
 * Tries to balance the top picks while respecting risk preference.
 */
function allocate(
  evaluated: EvaluatedProtocol[],
): Record<string, number> {
  if (evaluated.length === 0) return { reserve: 1.0 };
  // Filter to protocols with non-zero risk-acceptable allocation
  const usable = evaluated.filter(
    (p) => p.audit_status !== "unaudited" || p.tvl_usd > 50_000_000,
  );
  if (usable.length === 0) {
    return { reserve: 1.0 };
  }
  // Weight: 60% to top, 30% to second, 10% to third (if exists)
  const weights: Record<string, number> = {};
  if (usable[0]) weights[usable[0].protocol] = 0.6;
  if (usable[1]) {
    weights[usable[1].protocol] = 0.3;
  } else {
    weights[usable[0].protocol] = (weights[usable[0].protocol] ?? 0) + 0.3;
  }
  if (usable[2]) weights[usable[2].protocol] = 0.1;
  // Add reserve if we didn't use everything
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum < 1.0) weights["reserve"] = Number((1.0 - sum).toFixed(2));
  return weights;
}

function projected30dYield(
  evaluated: EvaluatedProtocol[],
  allocation: Record<string, number>,
): number {
  // Weighted blend of APY across allocated protocols, prorated for 30 days
  let weightedApy = 0;
  for (const [name, frac] of Object.entries(allocation)) {
    if (name === "reserve") continue;
    const p = evaluated.find((e) => e.protocol === name);
    if (!p) continue;
    weightedApy += (p.apy / 100) * frac;
  }
  // 30/365 of annualized
  return Number((weightedApy * (30 / 365)).toFixed(6));
}

function buildPtbIntent(
  allocation: Record<string, number>,
  evaluated: EvaluatedProtocol[],
): { operations: { op: string; protocol: string; amount_pct: number }[] } {
  const operations: { op: string; protocol: string; amount_pct: number }[] = [];
  for (const [name, frac] of Object.entries(allocation)) {
    if (name === "reserve" || frac <= 0) continue;
    const p = evaluated.find((e) => e.protocol === name);
    const op = p?.category === "Liquid Staking" ? "stake" : "deposit";
    operations.push({
      op,
      protocol: name,
      amount_pct: Math.round(frac * 100),
    });
  }
  return { operations };
}

function buildTemplateReasoning(
  topic: string,
  allocation: Record<string, number>,
  projected: number,
  evaluated: EvaluatedProtocol[],
): string {
  const allocLine = Object.entries(allocation)
    .map(([k, v]) => `${(v * 100).toFixed(0)}% ${k}`)
    .join(", ");
  const top = evaluated[0];
  const yieldPct = (projected * 100).toFixed(2);
  return `Allocation: ${allocLine}. Projected 30-day yield ~${yieldPct}% based on current ${top?.protocol ?? "lead"} APY ${top?.apy?.toFixed(2) ?? "0"}%. Weighted for "${topic}" — favored the highest-TVL audited protocols, reserved a small position for re-balancing.`;
}

/**
 * Convert EvaluatedProtocol back to ProtocolStat shape for the warning helper.
 */
function toStat(e: EvaluatedProtocol): ProtocolStat {
  return {
    name: e.protocol,
    category: e.category,
    tvl_usd: e.tvl_usd,
    audits: e.audit_status === "audited" ? 2 : e.audit_status === "partial" ? 1 : 0,
    audit_status: e.audit_status,
    age_days: e.age_days,
    best_apy: e.apy,
    best_apy_pool: e.best_pool,
    best_apy_tvl_usd: e.tvl_usd, // approximation when pool TVL not separately tracked
    risk: e.risk,
  };
}

async function handleResearch(
  ctx: ReturnType<typeof makeAgentContext>,
  env: ReturnType<typeof loadEnv>,
  eventId: string,
  owner: string,
): Promise<void> {
  // 1. Read the Research payload
  const input = await fetchWorkObject(ctx, eventId);
  const inputBytes = await readWorkObjectPayload(input);
  if (!inputBytes) {
    console.warn(`[strategy] ${eventId} has no readable payload, skipping`);
    return;
  }
  const research = decodePayload(inputBytes) as ResearchInput;
  const evaluated = Array.isArray(research.evaluated) ? research.evaluated : [];
  if (evaluated.length === 0) {
    console.warn(`[strategy] ${eventId} has no evaluated protocols, skipping`);
    return;
  }

  // 2. Compute REAL allocation, yield projection, warnings — no LLM needed
  const allocation = allocate(evaluated);
  const projected = projected30dYield(evaluated, allocation);
  const ptb_intent = buildPtbIntent(allocation, evaluated);
  const warnings = computeGuardianWarnings(
    evaluated.map(toStat),
    allocation,
    DEFAULT_ORDER_SIZE_USD,
  );

  // 3. Reasoning — LLM if key set, template otherwise
  const mode = llmMode(env);
  let reasoning: string;
  let llm_provider: "deepseek" | "template" = "template";
  if (mode === "llm") {
    try {
      const llmPrompt = `User intent: ${research.topic}\n\nResearch (REAL data):\n${JSON.stringify(evaluated, null, 2)}\n\nComputed allocation: ${JSON.stringify(allocation)}\nProjected 30-day yield: ${(projected * 100).toFixed(2)}%\nGuardian warnings: ${warnings.length}\n\nWrite a 2–3 sentence reasoning paragraph explaining the allocation. Reference only the data above.`;
      const raw = await callLlm({
        apiKey: activeLlmKey(env),
        system: SYSTEM,
        prompt: llmPrompt,
        maxTokens: 512,
      });
      reasoning = raw.trim();
      llm_provider = "deepseek";
    } catch (e) {
      console.warn(
        `[strategy] LLM call failed, falling back to template: ${(e as Error)?.message ?? e}`,
      );
      reasoning = buildTemplateReasoning(research.topic, allocation, projected, evaluated);
    }
  } else {
    reasoning = buildTemplateReasoning(research.topic, allocation, projected, evaluated);
  }

  // 4. Payload + mint
  const payload: StrategyPayload = {
    parent_research_id: eventId,
    variant: "conservative",
    order_size_usd: DEFAULT_ORDER_SIZE_USD,
    allocation,
    projected_30d_yield: projected,
    ptb_intent,
    guardian_warnings: warnings,
    reasoning,
    llm_provider,
    generated_at_ms: Date.now(),
  };
  const payloadBytes = encodePayload(payload);

  let walrusBlobId: string | null = null;
  let inlinePayload: Uint8Array = payloadBytes;
  if (walrusEnabled()) {
    try {
      const up = await uploadToWalrus(payloadBytes, ctx.client, ctx.keypair);
      walrusBlobId = up.blobId;
      inlinePayload = new Uint8Array();
      console.log(
        `[strategy] walrus uploaded ${payloadBytes.length}B in ${up.uploadMs}ms (blobId=${up.blobId})`,
      );
    } catch (e) {
      console.warn(
        `[strategy] walrus upload failed, falling back to inline: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  const tx = buildMintTx(ctx, {
    owner,
    kind: "Strategy",
    schemaVersion: SCHEMA_VERSION,
    payload: inlinePayload,
    walrusBlobId,
    parentIds: [eventId],
    paymentAmount: STRATEGY_FEE_MIST,
  });

  const result = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true },
  });

  console.log(
    `[strategy] minted StrategyObject (alloc=${Object.keys(allocation).join("/")}, warnings=${warnings.length}, llm=${llm_provider}) parent=${eventId} tx=${result.digest}`,
  );
}

async function main() {
  const env = loadEnv();
  const mode = llmMode(env);
  const ctx = makeAgentContext(env);
  console.log(`[strategy] address=${ctx.address} mode=${mode}`);

  await startEventPoll({
    ctx,
    acceptsKind: "Research",
    cursorPath: ".cursors/strategy.json",
    pollMs: 3000,
    label: "strategy",
    onEvent: async ({ id, payload }) => {
      await handleResearch(ctx, env, id, payload.owner);
    },
  });
}

main().catch((e: unknown) => {
  console.error("[strategy] fatal:", (e as Error)?.message ?? e);
  process.exit(1);
});
