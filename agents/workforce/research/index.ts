// Research Agent — accepts tasks with primary_capability="research",
// fetches the target Move package's normalized module surface from Sui RPC,
// passes it to the LLM, and produces a multi-section markdown deliverable
// covering project research + Move audit + a recommendation. The deliverable
// is uploaded to Walrus (when enabled) and minted as a Deliverable
// WorkObject in the same PTB that calls task::submit — atomically.
//
// Boot: register self in the agent_registry (idempotent), then start the
// task inbox filtered by assigned_to=self.address.

import { loadEnv } from "../../lib/env.js";
import { makeAgentContextFor } from "../../lib/sui.js";
import { signAndExecuteWithRetry } from "../../lib/sui-retry.js";
import { callLlm, llmMode } from "../../lib/llm.js";
import { hasWalrusFunding, uploadToWalrus, walrusEnabled } from "../../lib/walrus.js";
import {
  augmentRegistration,
  type AgentRegistration,
} from "../lib/agent-registry.js";
import { startTaskInbox, type TaskPostedNotice } from "../lib/inbox.js";
import { recoverStuckTasks } from "../lib/recovery.js";
import {
  buildAcceptTaskTx,
  buildMintAndSubmitTx,
  fetchTask,
} from "../lib/task.js";
import type { AgentContext } from "../../lib/sui.js";

const POLL_MS = 3000;
const CURSOR_PATH = ".cursors/research-workforce.json";
const SCHEMA_VERSION = 1n;

// ---------------------------------------------------------------------------
// Spec parsing — accepts either inline JSON or a Walrus blob id (heuristic:
// leading "{" means inline; otherwise it's treated as a blob id and fetched).
// ---------------------------------------------------------------------------

type ResearchSpec = {
  target_package_id?: string;
  target_modules?: string[];
  context?: string;
  bounty_label?: string;
};

async function resolveSpec(
  ctx: AgentContext,
  specBlob: string,
): Promise<ResearchSpec> {
  const trimmed = specBlob.trim();
  if (trimmed.length === 0) return {};
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as ResearchSpec;
    } catch (e) {
      console.warn("[research] inline spec is not JSON:", (e as Error).message);
      return { context: trimmed };
    }
  }
  // Otherwise fetch from Walrus aggregator
  try {
    const url = `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${trimmed}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(
        `[research] walrus fetch for spec blob ${trimmed} returned ${resp.status}`,
      );
      return { context: `(spec blob ${trimmed} unreachable)` };
    }
    const text = await resp.text();
    try {
      return JSON.parse(text) as ResearchSpec;
    } catch {
      return { context: text };
    }
  } catch (e) {
    console.warn("[research] walrus spec fetch failed:", (e as Error).message);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Move module surface extraction
// ---------------------------------------------------------------------------

type ModuleSurface = {
  packageId: string;
  modules: Array<{
    name: string;
    structCount: number;
    functions: Array<{
      name: string;
      visibility: string;
      isEntry: boolean;
      paramCount: number;
      returnCount: number;
    }>;
    structs: string[];
  }>;
};

async function fetchModuleSurface(
  ctx: AgentContext,
  spec: ResearchSpec,
): Promise<ModuleSurface | null> {
  if (!spec.target_package_id) return null;
  try {
    const all = await ctx.client.getNormalizedMoveModulesByPackage({
      package: spec.target_package_id,
    });
    const wanted = spec.target_modules?.length
      ? new Set(spec.target_modules)
      : null;

    const modules = Object.entries(all)
      .filter(([name]) => !wanted || wanted.has(name))
      .map(([name, mod]) => {
        const fns = mod.exposedFunctions ?? {};
        return {
          name,
          structCount: Object.keys(mod.structs ?? {}).length,
          functions: Object.entries(fns).map(([fnName, fn]) => ({
            name: fnName,
            visibility: fn.visibility,
            isEntry: fn.isEntry ?? false,
            paramCount: (fn.parameters ?? []).length,
            returnCount: (fn.return ?? []).length,
          })),
          structs: Object.keys(mod.structs ?? {}),
        };
      });

    return { packageId: spec.target_package_id, modules };
  } catch (e) {
    console.warn(
      `[research] could not fetch module surface for ${spec.target_package_id}:`,
      (e as Error).message,
    );
    return null;
  }
}

function summarizeSurfaceForLlm(surface: ModuleSurface): string {
  let out = `# Target Package\n\n\`${surface.packageId}\`\n\n`;
  for (const m of surface.modules) {
    out += `## Module: \`${m.name}\`\n\n`;
    if (m.structs.length > 0) {
      out += `**Structs (${m.structs.length}):** ${m.structs.map((s) => `\`${s}\``).join(", ")}\n\n`;
    }
    if (m.functions.length > 0) {
      out += `**Functions (${m.functions.length}):**\n`;
      for (const f of m.functions) {
        const tag = f.isEntry ? "entry" : f.visibility;
        out += `- \`${f.name}\` — ${tag}, ${f.paramCount} params, ${f.returnCount} returns\n`;
      }
      out += "\n";
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deliverable composition
// ---------------------------------------------------------------------------

type Deliverable = {
  task_title: string;
  primary_capability: string;
  spec_context: string;
  target: { package_id: string | null; modules: string[] };
  sections: {
    project_research: string;
    move_audit: string;
    recommendation: string;
  };
  metadata: {
    produced_by: string;
    produced_at_ms: number;
    schema_version: number;
    llm_mode: "mock" | "llm";
  };
};

function templateDeliverable(args: {
  notice: TaskPostedNotice;
  spec: ResearchSpec;
  surface: ModuleSurface | null;
  llmMode: "mock" | "llm";
  agentAddress: string;
}): Deliverable {
  const { notice, spec, surface, llmMode: mode, agentAddress } = args;

  const project_research = surface
    ? `Project surface analysis. Package \`${surface.packageId}\` exposes ${surface.modules.length} module(s) (${surface.modules
        .map((m) => m.name)
        .join(", ")}) with ${surface.modules.reduce(
        (a, m) => a + m.structs.length,
        0,
      )} struct(s) and ${surface.modules.reduce(
        (a, m) => a + m.functions.length,
        0,
      )} exposed function(s). No off-chain GitHub or team data is available in this template path; the on-chain surface is the authoritative artifact.`
    : "No target package id was supplied in the task spec; project research is limited to the prompt context.";

  const move_audit = surface
    ? `Module surface compiled cleanly under sui_getNormalizedMoveModulesByPackage. Observations:\n\n${surface.modules
        .map((m) => {
          const entryFns = m.functions.filter((f) => f.isEntry).length;
          const publicFns = m.functions.filter((f) => f.visibility === "Public").length;
          return `- **${m.name}**: ${m.structs.length} struct(s), ${m.functions.length} fn(s) (${publicFns} public, ${entryFns} entry).`;
        })
        .join(
          "\n",
        )}\n\nNo deep static analysis is performed in template mode — recommend running this report through LLM mode for a substantive audit pass.`
    : "Audit not possible without a target package id.";

  const recommendation =
    surface && surface.modules.length > 0
      ? `Approve with conditions: require an LLM-augmented re-run of this deliverable with deeper static analysis before final disbursement. Surface is well-formed and consistent.`
      : `Reject — task spec did not include a target package id, so no contract was inspected.`;

  return {
    task_title: notice.title,
    primary_capability: notice.primaryCapability,
    spec_context: spec.context ?? "(no context provided in spec)",
    target: {
      package_id: spec.target_package_id ?? null,
      modules: surface?.modules.map((m) => m.name) ?? [],
    },
    sections: { project_research, move_audit, recommendation },
    metadata: {
      produced_by: agentAddress,
      produced_at_ms: Date.now(),
      schema_version: Number(SCHEMA_VERSION),
      llm_mode: mode,
    },
  };
}

async function llmEnrich(
  deliverable: Deliverable,
  surface: ModuleSurface | null,
  apiKey: string,
): Promise<Deliverable> {
  const surfaceMd = surface
    ? summarizeSurfaceForLlm(surface)
    : "(no on-chain surface available)";

  const prompt = `You are the Research Agent in Brief, an autonomous workforce on Sui. A planner agent has hired you to evaluate a Move package for a DAO grant.

## Task
"${deliverable.task_title}"

## Context from the poster
${deliverable.spec_context}

## On-chain module surface
${surfaceMd}

Produce a multi-section evaluation report in JSON with these three string fields:
- "project_research": 2–4 short paragraphs on what this package appears to do, the surface area, and any provenance signals you can infer purely from the module structure.
- "move_audit": 2–4 short paragraphs of audit observations covering: capability objects, abort code coverage, public function surface, shared-object lifecycle, and concrete risks (info / amber / red) tagged inline.
- "recommendation": one paragraph beginning with "APPROVE", "APPROVE WITH CONDITIONS", or "REJECT", followed by the reasoning.

Keep total length under 1200 words. Be specific. Cite module names with backticks.`;

  try {
    const raw = await callLlm({
      apiKey,
      system:
        "You are a senior Move auditor. You are blunt, specific, and grounded in the on-chain module surface you are given. You never speculate beyond it.",
      prompt,
      maxTokens: 1800,
      jsonSchemaHint:
        '{"project_research":"string","move_audit":"string","recommendation":"string"}',
    });
    const parsed = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, ""),
    ) as Deliverable["sections"];

    return {
      ...deliverable,
      sections: {
        project_research: parsed.project_research ?? deliverable.sections.project_research,
        move_audit: parsed.move_audit ?? deliverable.sections.move_audit,
        recommendation: parsed.recommendation ?? deliverable.sections.recommendation,
      },
      metadata: { ...deliverable.metadata, llm_mode: "llm" },
    };
  } catch (e) {
    console.warn("[research] LLM enrich failed, keeping template:", (e as Error).message);
    return deliverable;
  }
}

function renderMarkdown(d: Deliverable): string {
  return [
    `# Research & Audit Report\n`,
    `**Task:** ${d.task_title}\n`,
    `**Capability:** ${d.primary_capability}\n`,
    d.target.package_id
      ? `**Target:** \`${d.target.package_id}\` (${d.target.modules.length} modules)\n`
      : "",
    `**Produced by:** \`${d.metadata.produced_by}\` (mode: ${d.metadata.llm_mode})\n`,
    `\n---\n`,
    `\n## §1 — Project Research\n\n${d.sections.project_research}\n`,
    `\n## §2 — Move Contract Audit\n\n${d.sections.move_audit}\n`,
    `\n## §3 — Recommendation\n\n${d.sections.recommendation}\n`,
  ]
    .filter(Boolean)
    .join("");
}

// ---------------------------------------------------------------------------
// Main task handler
// ---------------------------------------------------------------------------

async function handleTask(
  ctx: AgentContext,
  reg: AgentRegistration,
  notice: TaskPostedNotice,
): Promise<void> {
  console.log(
    `[research] task ${notice.taskId.slice(0, 10)}… "${notice.title}" bounty=${notice.bountyAmount}`,
  );

  // Confirm on-chain state — protects against double-process if the
  // cursor lags or the chain rewinds. Recoverable: if the task is
  // already in ACCEPTED status AND we are the assigned agent, we
  // proceed straight to work+submit (the previous run crashed
  // mid-deliver and we're catching up).
  const t = await fetchTask(ctx, notice.taskId);
  if (t.status === "delivered" || t.status === "approved" || t.status === "expired") {
    console.log(`[research] task already ${t.status}, skipping`);
    return;
  }

  if (t.status === "open") {
    console.log("[research] accepting…");
    const acceptRes = await signAndExecuteWithRetry(
      ctx,
      () => buildAcceptTaskTx(ctx, notice.taskId),
      { showEffects: true },
      { label: "research:accept", attempts: 3 },
    );
    if (acceptRes.effects?.status?.status !== "success") {
      throw new Error(
        `accept failed: ${acceptRes.effects?.status?.error ?? "unknown"}`,
      );
    }
  } else if (
    t.status === "accepted" &&
    t.assignedTo.toLowerCase() === ctx.address.toLowerCase()
  ) {
    console.log(
      "[research] task already accepted by this wallet — resuming to deliver",
    );
  } else {
    console.log(
      `[research] task in unexpected state ${t.status} (assigned to ${t.assignedTo.slice(0, 10)}…), skipping`,
    );
    return;
  }

  // 2) Do the research
  console.log("[research] working…");
  const env = loadEnv();
  const mode = llmMode({
    anthropicApiKey: env.anthropicApiKey,
    commonstackApiKey: env.commonstackApiKey,
  });
  const apiKey = env.commonstackApiKey || env.anthropicApiKey;

  const spec = await resolveSpec(ctx, t.specBlob);
  const surface = await fetchModuleSurface(ctx, spec);

  let deliverable = templateDeliverable({
    notice,
    spec,
    surface,
    llmMode: mode,
    agentAddress: ctx.address,
  });

  if (mode === "llm" && apiKey) {
    deliverable = await llmEnrich(deliverable, surface, apiKey);
  }

  const markdown = renderMarkdown(deliverable);

  // 3) Walrus (when enabled) — store the markdown payload.
  //
  // Pre-flight WAL coin check: Walrus' writeBlob pays for storage in WAL,
  // and the SDK throws from a nested async chain on insufficient balance.
  // If the chain rejects after we've started signing, the rejection
  // escapes our try/catch as an UnhandledPromiseRejection and kills the
  // agent. So we check first; no WAL → fall back to inline.
  const payloadBytes = new TextEncoder().encode(markdown);
  let walrusBlobId: string | null = null;
  if (walrusEnabled() && payloadBytes.length > 0) {
    const funded = await hasWalrusFunding(ctx.client, ctx.address);
    if (!funded) {
      console.warn(
        `[research] Walrus is enabled but ${ctx.address.slice(0, 10)}… has no WAL coins — falling back to inline storage on this deliverable.`,
      );
    } else {
      try {
        console.log("[research] uploading deliverable to Walrus…");
        const uploaded = await uploadToWalrus(
          payloadBytes,
          ctx.client,
          ctx.keypair,
        );
        walrusBlobId = uploaded.blobId;
        console.log(
          `[research] walrus ok blob=${walrusBlobId} in ${uploaded.uploadMs}ms`,
        );
      } catch (e) {
        console.warn(
          "[research] walrus upload failed, falling back to inline:",
          (e as Error).message,
        );
      }
    }
  }

  // 4) Mint Deliverable WorkObject + submit task in one PTB
  const inlinePayload = walrusBlobId
    ? new Uint8Array() // stored on Walrus — leave inline empty
    : payloadBytes;

  console.log("[research] submitting deliverable…");
  const submitRes = await signAndExecuteWithRetry(
    ctx,
    () =>
      buildMintAndSubmitTx(ctx, {
        taskId: notice.taskId,
        deliverableOwner: notice.poster,
        schemaVersion: SCHEMA_VERSION,
        inlinePayload,
        walrusBlobId,
        paymentAmount: 0n, // bounty comes from the Task escrow, not the work_object
      }),
    { showEffects: true, showObjectChanges: true },
    { label: "research:submit", attempts: 3 },
  );

  if (submitRes.effects?.status?.status !== "success") {
    throw new Error(
      `submit failed: ${submitRes.effects?.status?.error ?? "unknown"}`,
    );
  }

  const tx = submitRes.digest;
  console.log(
    `[research] delivered. task=${notice.taskId.slice(0, 10)}… reg=${reg.id.slice(0, 10)}… tx=${tx.slice(0, 12)}…`,
  );
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const env = loadEnv();
  // Multi-wallet mode: signs as RESEARCH_SECRET_KEY when present; falls
  // back to AGENT_SECRET_KEY with a DEGRADED warning when not. The boot
  // address determines which AgentRegistration is created/augmented, so
  // reputation accrues to the research wallet specifically.
  const ctx = makeAgentContextFor(env, "research");

  console.log(
    `[research] booting · pkg=${ctx.packageId.slice(0, 10)}… address=${ctx.address}… walrus=${walrusEnabled()} llm=${llmMode(env)}`,
  );

  const reg = await augmentRegistration(ctx, {
    displayName: "Research Agent",
    capabilities: ["research", "audit"],
    acceptsObjectTypes: ["Task"],
    producesObjectTypes: ["Deliverable"],
    basePricePerCall: 3_000_000_000n, // 3 SUI nominal base price
    endpointUrl: "",
    bioBlob: "",
  });
  console.log(
    `[research] active · reg=${reg.id.slice(0, 10)}… capabilities=[${reg.capabilities.join(", ")}]`,
  );

  // Self-healing: re-process any task this wallet accepted but never
  // submitted (e.g., a prior crash before submit landed). Runs BEFORE
  // the inbox so we don't race the steady-state poll loop.
  await recoverStuckTasks(ctx, {
    capabilityFilter: "research",
    label: "research-recovery",
    onTask: (notice) => handleTask(ctx, reg, notice),
  });

  await startTaskInbox({
    ctx,
    cursorPath: CURSOR_PATH,
    pollMs: POLL_MS,
    assignedToFilter: ctx.address,
    capabilityFilter: "research",
    label: "research-inbox",
    onTask: async (notice) => {
      try {
        await handleTask(ctx, reg, notice);
      } catch (e) {
        console.error(
          `[research] task ${notice.taskId.slice(0, 10)}… handler failed:`,
          (e as Error)?.message ?? e,
        );
      }
    },
  });
}

main().catch((e) => {
  console.error("[research] fatal:", e);
  process.exit(1);
});
