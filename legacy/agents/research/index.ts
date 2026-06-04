// ResearchAgent — consumes Query WorkObjects, produces ResearchObjects.
//
// Pulls LIVE Sui DeFi protocol data from DeFiLlama (with a hardcoded
// snapshot fallback if DeFiLlama is unreachable), ranks for the user's
// intent, and optionally enriches with an LLM-generated reasoning blurb.
//
// Run: `npm run agent:research`

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
  fetchSuiDefiProtocols,
  rankForIntent,
  type ProtocolStat,
} from "../lib/protocol-data.js";

const RESEARCH_FEE_MIST = 500_000_000n; // 0.5 SUI symbolic
const SCHEMA_VERSION = 2n;

type QueryPayload = { topic: string };

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

type ResearchPayload = {
  topic: string;
  evaluated: EvaluatedProtocol[];
  top_pick: { protocol: string; apy: number; confidence: number };
  reasoning: string;
  data_source: {
    provider: "DeFiLlama" | "snapshot";
    fetched_at_ms: number;
    note?: string;
  };
  llm_provider: string;
  generated_at_ms: number;
};

const SYSTEM = `You are a Sui DeFi research analyst. You receive a user's intent and a list of REAL on-chain Sui DeFi protocols with current TVL, APY, audit, and age data fetched from DeFiLlama. Write a tight 2–3 sentence reasoning paragraph in plain English that explains the top_pick choice. Do NOT invent numbers — only reference the data provided. Do NOT recommend new protocols outside the data. Output the prose only, no JSON, no preamble.`;

function confidenceFor(risk: "low" | "medium" | "high"): number {
  if (risk === "low") return 0.85;
  if (risk === "medium") return 0.65;
  return 0.4;
}

function asEvaluated(p: ProtocolStat): EvaluatedProtocol {
  return {
    protocol: p.name,
    category: p.category,
    apy: p.best_apy,
    tvl_usd: p.tvl_usd,
    audit_status: p.audit_status,
    age_days: p.age_days,
    risk: p.risk,
    best_pool: p.best_apy_pool,
  };
}

function buildTemplateReasoning(
  topic: string,
  top: EvaluatedProtocol,
  also: EvaluatedProtocol[],
): string {
  const tvl = `$${(top.tvl_usd / 1e6).toFixed(0)}M`;
  const apy = top.apy > 0 ? `${top.apy.toFixed(2)}% APY` : "stable yield";
  const audit = top.audit_status === "audited" ? "fully audited" : `${top.audit_status} audit`;
  const others = also
    .slice(0, 2)
    .map((p) => `${p.protocol} ($${(p.tvl_usd / 1e6).toFixed(0)}M)`)
    .join(" and ");
  return `Top pick: ${top.protocol} — ${top.category} with ${tvl} TVL, ${apy}, ${audit}, ${top.age_days}-day track record. Risk band: ${top.risk}. Selected for "${topic}" over ${others}.`;
}

/**
 * Fallback snapshot — real numbers captured at build time. Used only if
 * DeFiLlama is unreachable so we never serve fabricated data.
 */
const SNAPSHOT_PROTOCOLS: ProtocolStat[] = [
  { name: "NAVI Lending", category: "Lending", tvl_usd: 160_900_000, audits: 2, audit_status: "audited", age_days: 1023, best_apy: 21.31, best_apy_pool: "ENZOBTC", best_apy_tvl_usd: 33_600_000, risk: "low" },
  { name: "Suilend", category: "Lending", tvl_usd: 156_700_000, audits: 2, audit_status: "audited", age_days: 800, best_apy: 0, best_apy_pool: "", best_apy_tvl_usd: 0, risk: "low" },
  { name: "SpringSui", category: "Liquid Staking", tvl_usd: 64_500_000, audits: 2, audit_status: "audited", age_days: 565, best_apy: 0, best_apy_pool: "", best_apy_tvl_usd: 0, risk: "low" },
  { name: "Bucket CDP", category: "CDP", tvl_usd: 16_200_000, audits: 2, audit_status: "audited", age_days: 1050, best_apy: 0, best_apy_pool: "", best_apy_tvl_usd: 0, risk: "medium" },
  { name: "Scallop Lend", category: "Lending", tvl_usd: 22_100_000, audits: 0, audit_status: "unaudited", age_days: 1381, best_apy: 12.48, best_apy_pool: "SUI", best_apy_tvl_usd: 3_500_000, risk: "high" },
];

async function getRankedProtocols(
  topic: string,
): Promise<{ ranked: ProtocolStat[]; source: "DeFiLlama" | "snapshot"; note?: string }> {
  try {
    const all = await fetchSuiDefiProtocols();
    if (all.length === 0) {
      return { ranked: SNAPSHOT_PROTOCOLS, source: "snapshot", note: "DeFiLlama returned empty list" };
    }
    return { ranked: rankForIntent(all, topic, 5), source: "DeFiLlama" };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.warn(`[research] DeFiLlama fetch failed (${msg}), using snapshot`);
    return { ranked: SNAPSHOT_PROTOCOLS, source: "snapshot", note: `DeFiLlama error: ${msg.slice(0, 100)}` };
  }
}

async function handleQuery(
  ctx: ReturnType<typeof makeAgentContext>,
  env: ReturnType<typeof loadEnv>,
  eventId: string,
  owner: string,
): Promise<void> {
  // 1. Read the user's query
  const input = await fetchWorkObject(ctx, eventId);
  const inputBytes = await readWorkObjectPayload(input);
  if (!inputBytes) {
    console.warn(`[research] ${eventId} has no readable payload, skipping`);
    return;
  }
  const query = decodePayload(inputBytes) as QueryPayload;

  // 2. Fetch REAL Sui DeFi protocol data (DeFiLlama → snapshot fallback)
  const { ranked, source, note } = await getRankedProtocols(query.topic);
  const evaluated = ranked.map(asEvaluated);
  const top = ranked[0];
  if (!top) {
    console.warn(`[research] no protocols ranked, skipping`);
    return;
  }
  const top_pick = {
    protocol: top.name,
    apy: top.best_apy,
    confidence: confidenceFor(top.risk),
  };

  // 3. Generate reasoning — LLM if key set, template otherwise
  const mode = llmMode(env);
  let reasoning: string;
  let llm_provider: "deepseek" | "template" = "template";
  if (mode === "llm") {
    try {
      const llmPrompt = `User intent: ${query.topic}\n\nREAL data (DeFiLlama, fetched ${new Date().toISOString()}):\n${JSON.stringify(evaluated, null, 2)}\n\nTop pick by ranking heuristic: ${top.name}\n\nWrite a 2–3 sentence reasoning paragraph in plain English. Do NOT invent numbers — only reference the data above.`;
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
        `[research] LLM call failed, falling back to template: ${(e as Error)?.message ?? e}`,
      );
      reasoning = buildTemplateReasoning(query.topic, evaluated[0], evaluated.slice(1));
    }
  } else {
    reasoning = buildTemplateReasoning(query.topic, evaluated[0], evaluated.slice(1));
  }

  // 4. Build payload + mint
  const payload: ResearchPayload = {
    topic: query.topic,
    evaluated,
    top_pick,
    reasoning,
    data_source: { provider: source, fetched_at_ms: Date.now(), ...(note ? { note } : {}) },
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
        `[research] walrus uploaded ${payloadBytes.length}B in ${up.uploadMs}ms (blobId=${up.blobId})`,
      );
    } catch (e) {
      console.warn(
        `[research] walrus upload failed, falling back to inline: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  const tx = buildMintTx(ctx, {
    owner,
    kind: "Research",
    schemaVersion: SCHEMA_VERSION,
    payload: inlinePayload,
    walrusBlobId,
    parentIds: [eventId],
    paymentAmount: RESEARCH_FEE_MIST,
  });

  const result = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true },
  });

  console.log(
    `[research] minted ResearchObject (top=${payload.top_pick.protocol}, src=${source}, llm=${llm_provider}) parent=${eventId} tx=${result.digest}`,
  );
}

async function main() {
  const env = loadEnv();
  const mode = llmMode(env);
  const ctx = makeAgentContext(env);
  console.log(`[research] address=${ctx.address} mode=${mode}`);

  await startEventPoll({
    ctx,
    acceptsKind: "Query",
    cursorPath: ".cursors/research.json",
    pollMs: 3000,
    label: "research",
    onEvent: async ({ id, payload }) => {
      await handleQuery(ctx, env, id, payload.owner);
    },
  });
}

main().catch((e: unknown) => {
  console.error("[research] fatal:", (e as Error)?.message ?? e);
  process.exit(1);
});
