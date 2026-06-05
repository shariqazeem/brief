// Planner Agent — the head of Brief's autonomous workforce.
//
// Given a mission (a plain-English brief from a user) and an OperatorPolicy
// envelope, the Planner decomposes the mission into 1–N sub-tasks routed to
// specialist agents (Research today; Treasury once Day 3 lands), and posts
// each sub-task on chain with `parent_policy = Some(policy.id)` so the
// later `approve_with_policy` call enforces the kill switch atomically.
//
// For Wk1 this is a CLI one-shot — given a mission, decompose, post, exit.
// Day 8 wraps the same core in an event-driven loop bound to a UI-minted
// MissionRequested event.
//
// Usage:
//   tsx --env-file=.env.local agents/workforce/planner/index.ts \
//     --policy 0x... \
//     --mission "Evaluate this Move contract for a $50k DAO grant" \
//     [--target-package-id 0x...] \
//     [--max-subtasks 2] \
//     [--default-bounty-sui 0.5] \
//     [--deadline-min 30]
//
// Or via npm: `npm run agent:planner -- --policy 0x... --mission "..."`

import { Transaction } from "@mysten/sui/transactions";

import { loadEnv, activeLlmKey } from "../../lib/env.js";
import { makeAgentContext, type AgentContext } from "../../lib/sui.js";
import { callLlm, llmMode, extractJson } from "../../lib/llm.js";
import {
  fetchOperatorPolicy,
  type OperatorPolicyDecoded,
} from "../../lib/operator-policy.js";
import { signAndExecuteWithRetry } from "../../lib/sui-retry.js";
import { appendPostTask } from "../lib/task.js";
import { listLatestRegistrationsByAddress } from "../lib/agent-registry.js";

const DEFAULT_DEADLINE_MIN = 30;
const DEFAULT_BOUNTY_SUI = 0.5;
const DEFAULT_MAX_SUBTASKS = 2;
const GAS_BUFFER_MIST = 100_000_000n; // 0.1 SUI reserved for gas across posts

// ---------------------------------------------------------------------------
// CLI argv parsing
// ---------------------------------------------------------------------------

type Args = {
  policy: string;
  mission: string;
  targetPackageId?: string;
  maxSubtasks: number;
  defaultBountySui: number;
  deadlineMin: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const map: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      map[key] = "true";
    } else {
      map[key] = next;
      i++;
    }
  }
  if (!map.policy) {
    throw new Error("--policy <policy-id> is required");
  }
  if (!map.mission) {
    throw new Error('--mission "..." is required');
  }
  return {
    policy: map.policy,
    mission: map.mission,
    targetPackageId: map["target-package-id"] || undefined,
    maxSubtasks: Number(map["max-subtasks"] ?? DEFAULT_MAX_SUBTASKS),
    defaultBountySui: Number(map["default-bounty-sui"] ?? DEFAULT_BOUNTY_SUI),
    deadlineMin: Number(map["deadline-min"] ?? DEFAULT_DEADLINE_MIN),
  };
}

// ---------------------------------------------------------------------------
// Workforce discovery — multi-wallet.
//
// Walks every AgentRegistered event on chain, keeps the newest
// registration per address, and exposes the (capability, address) pairs
// the Planner can route sub-tasks to. CRITICAL invariant: entries whose
// address equals the Planner's own address are filtered out, because
// `task::approve_with_policy` requires `task.poster != task.assigned_to`
// in spirit (the policy bakes that contract: poster signs the approve;
// reputation must accrue to a DIFFERENT registration). If no distinct
// specialist exists for a required capability we fail loudly rather than
// silently self-assigning back to the Planner — that would collapse the
// "agents hiring agents" property the chain is supposed to prove.
// ---------------------------------------------------------------------------

type WorkforceEntry = {
  capability: string;
  address: string;
  registrationId: string;
  displayName: string;
  basePriceSui: number;
  reputationScore: bigint;
};

async function discoverWorkforce(ctx: AgentContext): Promise<WorkforceEntry[]> {
  const byAddress = await listLatestRegistrationsByAddress(ctx);
  const plannerAddr = ctx.address.toLowerCase();
  const out: WorkforceEntry[] = [];
  for (const reg of byAddress.values()) {
    if (reg.agentAddress.toLowerCase() === plannerAddr) continue;
    for (const capability of reg.capabilities) {
      out.push({
        capability,
        address: reg.agentAddress,
        registrationId: reg.id,
        displayName: reg.displayName,
        basePriceSui: Number(reg.basePricePerCall) / 1e9,
        reputationScore: reg.reputationScore,
      });
    }
  }
  return out;
}

/**
 * Pick the best specialist for a capability. Tie-break: higher
 * reputation_score first, then lower base_price_per_call. Planner's own
 * address is never eligible — discoverWorkforce filters it out by
 * construction, but we re-assert defensively here in case a caller hands
 * us a custom workforce list.
 */
function pickSpecialist(
  workforce: WorkforceEntry[],
  capability: string,
  plannerAddress: string,
): WorkforceEntry | null {
  const plannerLower = plannerAddress.toLowerCase();
  const candidates = workforce
    .filter(
      (w) =>
        w.capability === capability &&
        w.address.toLowerCase() !== plannerLower,
    )
    .sort((a, b) => {
      if (a.reputationScore !== b.reputationScore) {
        return a.reputationScore < b.reputationScore ? 1 : -1;
      }
      return a.basePriceSui - b.basePriceSui;
    });
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Mission decomposition
// ---------------------------------------------------------------------------

type SubTaskPlan = {
  capability: string;
  title: string;
  spec: Record<string, unknown>;
  bounty_sui: number;
  deadline_minutes: number;
  rationale: string;
};

function templateDecompose(args: Args, workforce: WorkforceEntry[]): SubTaskPlan[] {
  // Deterministic fallback when no LLM is available. For the canonical
  // demo mission ("evaluate Move contract for grant") we produce a single
  // research+audit sub-task; Day 3 adds a treasury sub-task to the bank.
  const plans: SubTaskPlan[] = [];
  const hasResearch = workforce.some((w) => w.capability === "research");
  if (hasResearch) {
    plans.push({
      capability: "research",
      title: "Research + Move audit",
      spec: {
        target_package_id: args.targetPackageId ?? null,
        context: args.mission,
      },
      bounty_sui: args.defaultBountySui,
      deadline_minutes: args.deadlineMin,
      rationale:
        "Single research+audit sub-task covers the full evaluation in template mode.",
    });
  }
  const hasTreasury = workforce.some((w) => w.capability === "treasury");
  if (hasTreasury && plans.length < args.maxSubtasks) {
    plans.push({
      capability: "treasury",
      title: "Disbursement sizing + liquidity probe",
      spec: {
        context: args.mission,
        action: "place_test_orders_to_size_disbursement",
      },
      bounty_sui: args.defaultBountySui,
      deadline_minutes: args.deadlineMin,
      rationale:
        "Treasury sub-task probes live DEX liquidity to size the recommended disbursement schedule.",
    });
  }
  return plans;
}

async function llmDecompose(
  args: Args,
  workforce: WorkforceEntry[],
  apiKey: string,
): Promise<SubTaskPlan[]> {
  const availableCapabilities = Array.from(
    new Set(workforce.map((w) => w.capability)),
  );
  if (availableCapabilities.length === 0) {
    throw new Error("no specialists available to decompose against");
  }
  const workforceTable = workforce
    .map(
      (w) =>
        `- ${w.displayName} (capability=${w.capability}, base=${w.basePriceSui.toFixed(2)} SUI)`,
    )
    .join("\n");

  const prompt = `You are the Planner agent in Brief, an autonomous workforce on Sui. Your job is to take a human's mission and decompose it into 1–${args.maxSubtasks} sub-tasks, each routed to a specialist agent.

## Mission
${args.mission}

## Context
- Target Move package id (if any): ${args.targetPackageId ?? "none"}
- Available specialist capabilities: [${availableCapabilities.join(", ")}]
- Default bounty per sub-task: ${args.defaultBountySui} SUI
- Default deadline per sub-task: ${args.deadlineMin} minutes
- Max sub-tasks: ${args.maxSubtasks}

## Workforce
${workforceTable}

## Rules
- Every sub-task's "capability" MUST be one of [${availableCapabilities.join(", ")}]. If only "research" is available, do not produce a "treasury" sub-task.
- Each sub-task must be self-contained — the specialist must be able to act on it without further clarification.
- The "spec" object is serialized to JSON and stored on chain as the spec_blob the specialist reads. Include target_package_id and a short context paragraph for research sub-tasks.
- Do not exceed ${args.maxSubtasks} sub-tasks. Fewer is fine.
- bounty_sui must be a positive number; default to ${args.defaultBountySui} unless the mission justifies more.

Respond with valid JSON ONLY, matching this schema:
{
  "subtasks": [
    {
      "capability": "<one of available>",
      "title": "<= 60 chars",
      "spec": { ... },
      "bounty_sui": 0.5,
      "deadline_minutes": 30,
      "rationale": "one short sentence"
    }
  ]
}`;

  const raw = await callLlm({
    apiKey,
    system:
      "You are the Planner agent in Brief. You output ONLY valid JSON matching the requested schema. No prose, no commentary, no markdown fences. Be specific and concrete.",
    prompt,
    maxTokens: 1500,
    jsonSchemaHint:
      '{"subtasks":[{"capability":"<available>","title":"...","spec":{...},"bounty_sui":0.5,"deadline_minutes":30,"rationale":"..."}]}',
  });

  let parsed: { subtasks?: SubTaskPlan[] };
  try {
    parsed = extractJson<{ subtasks?: SubTaskPlan[] }>(raw);
  } catch (e) {
    throw new Error(`LLM produced non-JSON output: ${(e as Error).message}`);
  }
  const subtasks = parsed.subtasks ?? [];
  if (subtasks.length === 0) {
    throw new Error("LLM returned no subtasks");
  }
  const validCaps = new Set(availableCapabilities);
  for (const st of subtasks) {
    if (!st.capability || !validCaps.has(st.capability)) {
      throw new Error(
        `LLM produced sub-task with unavailable capability "${st.capability}"`,
      );
    }
    if (typeof st.bounty_sui !== "number" || !(st.bounty_sui > 0)) {
      throw new Error(`Invalid bounty_sui on sub-task "${st.title}"`);
    }
    if (!st.title || typeof st.title !== "string") {
      throw new Error("sub-task missing title");
    }
    if (typeof st.deadline_minutes !== "number" || st.deadline_minutes <= 0) {
      st.deadline_minutes = args.deadlineMin;
    }
    if (!st.spec || typeof st.spec !== "object") {
      st.spec = {};
    }
    if (!st.rationale) st.rationale = "";
  }
  return subtasks.slice(0, args.maxSubtasks);
}

// ---------------------------------------------------------------------------
// Pre-post validation
// ---------------------------------------------------------------------------

function validatePolicyForPlanner(
  policy: OperatorPolicyDecoded,
  plannerAddress: string,
  subtasks: SubTaskPlan[],
): bigint {
  if (policy.revoked) {
    throw new Error(`Policy ${policy.id} is revoked — cannot post sub-tasks.`);
  }
  if (Number(policy.expiresAtMs) <= Date.now()) {
    throw new Error(
      `Policy ${policy.id} expired at ${new Date(Number(policy.expiresAtMs)).toISOString()}.`,
    );
  }
  if (policy.agent.toLowerCase() !== plannerAddress.toLowerCase()) {
    throw new Error(
      `Policy.agent (${policy.agent.slice(0, 10)}…) does not match the planner address (${plannerAddress.slice(0, 10)}…). The policy must bind to this wallet for record_spend to pass.`,
    );
  }
  const remaining = policy.budgetCap - policy.spent;
  const totalBountyMist = subtasks.reduce(
    (acc, st) => acc + BigInt(Math.floor(st.bounty_sui * 1e9)),
    0n,
  );
  if (totalBountyMist > remaining) {
    throw new Error(
      `Sub-task bounties (${(Number(totalBountyMist) / 1e9).toFixed(3)} SUI) exceed remaining policy budget (${(Number(remaining) / 1e9).toFixed(3)} SUI).`,
    );
  }
  const allowedSet = new Set(policy.allowedVenues.map((v) => v.toLowerCase()));
  for (const st of subtasks) {
    if (!allowedSet.has(st.capability.toLowerCase())) {
      throw new Error(
        `Sub-task capability "${st.capability}" is not in policy.allowed_venues [${policy.allowedVenues.join(", ")}]. Approval would abort with EVenueNotAllowed.`,
      );
    }
  }
  return totalBountyMist;
}

async function assertWalletHasFunds(
  ctx: AgentContext,
  totalBountyMist: bigint,
): Promise<void> {
  const balance = await ctx.client.getBalance({ owner: ctx.address });
  const have = BigInt(balance.totalBalance);
  const need = totalBountyMist + GAS_BUFFER_MIST;
  if (have < need) {
    throw new Error(
      `Insufficient SUI in planner wallet: have ${(Number(have) / 1e9).toFixed(3)} SUI, need ${(Number(need) / 1e9).toFixed(3)} SUI (${(Number(totalBountyMist) / 1e9).toFixed(3)} bounty + ${(Number(GAS_BUFFER_MIST) / 1e9).toFixed(2)} gas buffer).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

type PostedSubtask = {
  plan: SubTaskPlan;
  assignedTo: string;
  taskId: string;
  txDigest: string;
  bountyMist: bigint;
  deadlineMs: bigint;
};

/**
 * Post ALL sub-tasks of a mission in ONE atomic PTB:
 *   tx.splitCoins(tx.gas, [b1, b2, …, bN])
 *   appendPostTask(tx, …) × N
 *
 * Eliminates the intra-mission gas-coin race that previously dropped the
 * 2nd post when the SDK held a stale version of the same gas coin. The N
 * Task object ids are pulled from the TaskPosted events in the response
 * — events fire in PTB-call order, so events[i] matches plans[i].
 */
async function postSubtasks(
  ctx: AgentContext,
  plans: SubTaskPlan[],
  workforce: WorkforceEntry[],
  policyId: string,
): Promise<PostedSubtask[]> {
  if (plans.length === 0) return [];

  // Route every plan first; fail loudly BEFORE building the tx so the
  // judge never sees a half-built mission.
  const routes = plans.map((plan) => {
    const specialist = pickSpecialist(workforce, plan.capability, ctx.address);
    if (!specialist) {
      const capsSeen = Array.from(new Set(workforce.map((w) => w.capability)));
      throw new Error(
        `no distinct specialist registered for capability "${plan.capability}" — ` +
          `workforce has [${capsSeen.join(", ") || "none"}] from ${workforce.length} entries, ` +
          `all at planner address. Start the ${plan.capability} agent on its own wallet ` +
          `(see 'npm run workforce:setup') and re-run.`,
      );
    }
    return { plan, specialist };
  });
  for (const r of routes) {
    console.log(
      `[planner] routing "${r.plan.title}" → ${r.specialist.displayName} (${r.specialist.address.slice(0, 10)}…, rep=${r.specialist.reputationScore})`,
    );
  }

  // Build the single PTB: split N bounty coins out of gas, then N posts.
  const tx = new Transaction();
  const bountyMists = routes.map((r) =>
    BigInt(Math.floor(r.plan.bounty_sui * 1e9)),
  );
  const bountyCoins = tx.splitCoins(
    tx.gas,
    bountyMists.map((m) => tx.pure.u64(m)),
  );
  const deadlineMses = routes.map((r) =>
    BigInt(Date.now() + r.plan.deadline_minutes * 60 * 1000),
  );
  routes.forEach((r, i) => {
    appendPostTask(tx, ctx, {
      bountyCoin: bountyCoins[i],
      assignedTo: r.specialist.address,
      title: r.plan.title,
      specBlob: JSON.stringify(r.plan.spec),
      primaryCapability: r.plan.capability,
      deadlineMs: deadlineMses[i],
      parentPolicyId: policyId,
    });
  });

  console.log(
    `[planner] posting ${plans.length} sub-task${plans.length === 1 ? "" : "s"} in one atomic PTB…`,
  );
  const res = await signAndExecuteWithRetry(
    ctx,
    tx,
    {
      showEffects: true,
      showObjectChanges: true,
      showEvents: true,
    },
    { label: "planner:post-all" },
  );
  if (res.effects?.status?.status !== "success") {
    throw new Error(
      `batched post failed: ${res.effects?.status?.error ?? "unknown"}`,
    );
  }

  // TaskPosted events fire in PTB-call order, so events[i] is plans[i].
  const events = (res.events ?? []) as Array<{
    type: string;
    parsedJson?: { task_id?: string };
  }>;
  const postedEvents = events.filter((e) =>
    e.type.endsWith("::task::TaskPosted"),
  );
  if (postedEvents.length !== routes.length) {
    throw new Error(
      `batched post: expected ${routes.length} TaskPosted events, got ${postedEvents.length}`,
    );
  }

  return routes.map((r, i) => {
    const taskId = postedEvents[i].parsedJson?.task_id;
    if (!taskId) {
      throw new Error(`batched post: event ${i} missing task_id`);
    }
    return {
      plan: r.plan,
      assignedTo: r.specialist.address,
      taskId,
      txDigest: res.digest,
      bountyMist: bountyMists[i],
      deadlineMs: deadlineMses[i],
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const env = loadEnv();
  const ctx = makeAgentContext(env);
  const mode = llmMode(env);
  const apiKey = activeLlmKey(env);

  console.log(
    `[planner] booting · pkg=${ctx.packageId.slice(0, 10)}… address=${ctx.address.slice(0, 10)}… llm=${mode}`,
  );

  // 1) Validate the policy binding
  const policy = await fetchOperatorPolicy(ctx, args.policy);
  if (!policy) {
    throw new Error(`Policy ${args.policy} not found on chain`);
  }
  const remainingSui = (Number(policy.budgetCap - policy.spent) / 1e9).toFixed(3);
  console.log(
    `[planner] policy "${policy.name}" remaining=${remainingSui} SUI of ${(Number(policy.budgetCap) / 1e9).toFixed(2)} venues=[${policy.allowedVenues.join(", ")}] revoked=${policy.revoked}`,
  );

  // 2) Discover specialists from the on-chain registry
  const workforce = await discoverWorkforce(ctx);
  console.log(
    `[planner] workforce: ${workforce.length} capability binding(s) — [${workforce.map((w) => w.capability).join(", ")}]`,
  );

  // 3) Decompose the mission (LLM with template fallback)
  let subtasks: SubTaskPlan[];
  if (mode === "llm" && apiKey && workforce.length > 0) {
    try {
      console.log("[planner] decomposing via LLM…");
      subtasks = await llmDecompose(args, workforce, apiKey);
    } catch (e) {
      console.warn(
        "[planner] LLM decompose failed, falling back to template:",
        (e as Error).message,
      );
      subtasks = templateDecompose(args, workforce);
    }
  } else {
    console.log(
      `[planner] decomposing via template (llm=${mode}, key=${apiKey ? "set" : "absent"}, workforce=${workforce.length})`,
    );
    subtasks = templateDecompose(args, workforce);
  }

  if (subtasks.length === 0) {
    throw new Error(
      "decomposition produced zero sub-tasks; nothing to post (check that specialists are registered)",
    );
  }

  console.log(`[planner] plan: ${subtasks.length} sub-task(s)`);
  for (const st of subtasks) {
    console.log(
      `  · ${st.capability} | ${st.title} | ${st.bounty_sui} SUI | ${st.deadline_minutes}m — ${st.rationale}`,
    );
  }

  // 4) Validate the plan against the policy + wallet balance
  const totalBountyMist = validatePolicyForPlanner(policy, ctx.address, subtasks);
  await assertWalletHasFunds(ctx, totalBountyMist);

  // 5) Post EVERY sub-task in ONE atomic PTB. Either every sub-task
  // lands, or none of them do — the judge never sees a half-posted
  // mission and we sidestep the in-process gas-coin race entirely.
  const posted = await postSubtasks(ctx, subtasks, workforce, policy.id);
  for (const result of posted) {
    console.log(
      `[planner] ok task=${result.taskId.slice(0, 12)}… tx=${result.txDigest.slice(0, 12)}…`,
    );
  }

  // 6) Summary
  console.log("\n[planner] summary:");
  console.log(
    JSON.stringify(
      {
        mission: args.mission,
        policy_id: policy.id,
        posted_subtasks: posted.map((p) => ({
          capability: p.plan.capability,
          title: p.plan.title,
          task_id: p.taskId,
          assigned_to: p.assignedTo,
          bounty_sui: Number(p.bountyMist) / 1e9,
          deadline_ms: String(p.deadlineMs),
          tx_digest: p.txDigest,
          explorer: `https://suiscan.xyz/${env.network}/object/${p.taskId}`,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("[planner] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
