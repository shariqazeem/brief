// StrategyAgent-Aggressive — alternate strategy authoring agent.
//
// Same input contract as the conservative StrategyAgent (consumes Research
// WorkObjects), but produces a different allocation policy. The conservative
// agent picks 60/30/10 across the top audited protocols; this one weights
// to the highest-yielding protocol it considers safe enough.
//
// The two strategies BRANCH from the same Research, giving the lineage
// graph the "Git for agents" moment: one input, multiple downstream forks,
// each owned by the user.
//
// Run: `npm run agent:strategy-alt`

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
const DEFAULT_ORDER_SIZE_USD = 1000;
const STRATEGY_VARIANT = "aggressive";

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
  variant: string;
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

const SYSTEM = `You are a Sui DeFi strategist with a yield-maximizing bias. You receive a research report with REAL on-chain protocol data. You favor higher APY when the protocol passes the audit + TVL + age sanity checks. Write a 2–3 sentence reasoning paragraph in plain English. Do NOT invent numbers. Output prose only.`;

/**
 * Aggressive policy: 80% to the highest-APY usable protocol, 20% to the
 * 2nd highest. "Usable" = audited OR (TVL > $50M AND partial audit).
 * Unaudited high-yield plays are too risky even for the aggressive variant.
 */
function allocateAggressive(
  evaluated: EvaluatedProtocol[],
): Record<string, number> {
  if (evaluated.length === 0) return { reserve: 1.0 };
  const usable = evaluated.filter(
    (p) =>
      p.audit_status === "audited" ||
      (p.audit_status === "partial" && p.tvl_usd > 50_000_000),
  );
  if (usable.length === 0) return { reserve: 1.0 };

  // Re-rank usable by APY descending (the aggressive bias)
  const byApy = [...usable].sort((a, b) => b.apy - a.apy);
  const weights: Record<string, number> = {};
  if (byApy[0]) weights[byApy[0].protocol] = 0.8;
  if (byApy[1]) {
    weights[byApy[1].protocol] = 0.2;
  } else {
    weights[byApy[0].protocol] = 1.0;
  }
  return weights;
}

function projected30dYield(
  evaluated: EvaluatedProtocol[],
  allocation: Record<string, number>,
): number {
  let weightedApy = 0;
  for (const [name, frac] of Object.entries(allocation)) {
    if (name === "reserve") continue;
    const p = evaluated.find((e) => e.protocol === name);
    if (!p) continue;
    weightedApy += (p.apy / 100) * frac;
  }
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
  const top = evaluated.find((e) =>
    Object.keys(allocation).includes(e.protocol),
  );
  const yieldPct = (projected * 100).toFixed(2);
  return `Aggressive variant: ${allocLine}. Projected 30-day yield ~${yieldPct}% by weighting to ${top?.protocol ?? "lead"}'s ${top?.apy?.toFixed(2) ?? "0"}% APY. Same intent as conservative ("${topic}"), but optimizes for yield over diversification.`;
}

function toStat(e: EvaluatedProtocol): ProtocolStat {
  return {
    name: e.protocol,
    category: e.category,
    tvl_usd: e.tvl_usd,
    audits:
      e.audit_status === "audited"
        ? 2
        : e.audit_status === "partial"
          ? 1
          : 0,
    audit_status: e.audit_status,
    age_days: e.age_days,
    best_apy: e.apy,
    best_apy_pool: e.best_pool,
    best_apy_tvl_usd: e.tvl_usd,
    risk: e.risk,
  };
}

async function handleResearch(
  ctx: ReturnType<typeof makeAgentContext>,
  env: ReturnType<typeof loadEnv>,
  eventId: string,
  owner: string,
): Promise<void> {
  const input = await fetchWorkObject(ctx, eventId);
  const inputBytes = await readWorkObjectPayload(input);
  if (!inputBytes) {
    console.warn(`[strategy-alt] ${eventId} has no readable payload, skipping`);
    return;
  }
  const research = decodePayload(inputBytes) as ResearchInput;
  const evaluated = Array.isArray(research.evaluated) ? research.evaluated : [];
  if (evaluated.length === 0) {
    console.warn(`[strategy-alt] ${eventId} has no evaluated protocols, skipping`);
    return;
  }

  const allocation = allocateAggressive(evaluated);
  const projected = projected30dYield(evaluated, allocation);
  const ptb_intent = buildPtbIntent(allocation, evaluated);
  const warnings = computeGuardianWarnings(
    evaluated.map(toStat),
    allocation,
    DEFAULT_ORDER_SIZE_USD,
  );

  const mode = llmMode(env);
  let reasoning: string;
  let llm_provider: "deepseek" | "template" = "template";
  if (mode === "llm") {
    try {
      const llmPrompt = `User intent: ${research.topic}\n\nResearch (REAL data):\n${JSON.stringify(evaluated, null, 2)}\n\nAggressive allocation (yield-weighted): ${JSON.stringify(allocation)}\nProjected 30-day yield: ${(projected * 100).toFixed(2)}%\nGuardian warnings: ${warnings.length}\n\nWrite a 2–3 sentence reasoning paragraph explaining the aggressive allocation. Reference only the data above.`;
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
        `[strategy-alt] LLM call failed, falling back to template: ${(e as Error)?.message ?? e}`,
      );
      reasoning = buildTemplateReasoning(research.topic, allocation, projected, evaluated);
    }
  } else {
    reasoning = buildTemplateReasoning(research.topic, allocation, projected, evaluated);
  }

  const payload: StrategyPayload = {
    parent_research_id: eventId,
    variant: STRATEGY_VARIANT,
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
        `[strategy-alt] walrus uploaded ${payloadBytes.length}B in ${up.uploadMs}ms (blobId=${up.blobId})`,
      );
    } catch (e) {
      console.warn(
        `[strategy-alt] walrus upload failed, falling back to inline: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  const tx = buildMintTx(ctx, {
    owner,
    kind: "StrategyAlt",
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
    `[strategy-alt] minted StrategyObject (variant=aggressive, alloc=${Object.keys(allocation).join("/")}, warnings=${warnings.length}, llm=${llm_provider}) parent=${eventId} tx=${result.digest}`,
  );
}

async function main() {
  const env = loadEnv();
  const mode = llmMode(env);
  const ctx = makeAgentContext(env);
  console.log(`[strategy-alt] address=${ctx.address} variant=aggressive mode=${mode}`);

  await startEventPoll({
    ctx,
    acceptsKind: "Research",
    cursorPath: ".cursors/strategy-alt.json",
    pollMs: 3000,
    label: "strategy-alt",
    onEvent: async ({ id, payload }) => {
      await handleResearch(ctx, env, id, payload.owner);
    },
  });
}

main().catch((e: unknown) => {
  console.error("[strategy-alt] fatal:", (e as Error)?.message ?? e);
  process.exit(1);
});
