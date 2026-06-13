// CLI: post a task assigned to a specific agent address.
// Usage:
//   tsx --env-file=.env.local scripts/workforce-post-task.ts \
//     --to 0x... \
//     --capability research \
//     --bounty-sui 1 \
//     --title "Evaluate this contract" \
//     --spec '{"target_package_id":"0x...","context":"..."}' \
//     [--deadline-min 30]
//
// Posts from the agent wallet (AGENT_SECRET_KEY in .env.local). For Wk1
// smoke we use the agent wallet as both the user and the agent; multi-
// wallet scenarios come in Wk2 when the Planner agent enters.

import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext, makeAgentContextFor } from "../agents/lib/sui.js";
import { signAndExecuteWithRetry } from "../agents/lib/sui-retry.js";
import { buildPostTaskTx } from "../agents/workforce/lib/task.js";

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = "true";
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const required = ["to", "capability", "bounty-sui", "title"];
  for (const k of required) {
    if (!args[k]) {
      console.error(`Missing --${k}`);
      process.exit(1);
    }
  }
  const deadlineMin = Number(args["deadline-min"] ?? 30);

  const env = loadEnv();
  // `--as treasury` posts as the Treasury wallet so the trader product's
  // verification task has poster == policy.agent == Treasury (needed for
  // the Treasury-signed approve to clear). Default stays Planner (legacy).
  const ctx =
    args.as === "treasury"
      ? makeAgentContextFor(env, "treasury")
      : makeAgentContext(env);

  const bountySui = Number(args["bounty-sui"]);
  const bountyMist = BigInt(Math.floor(bountySui * 1_000_000_000));
  const deadlineMs = BigInt(Date.now() + deadlineMin * 60 * 1000);

  console.log(
    `[post-task] posting · poster=${ctx.address.slice(0, 10)}… to=${args.to.slice(0, 10)}… cap=${args.capability} bounty=${bountySui} SUI deadline=${deadlineMin}min`,
  );

  // Idempotency window: if a retryable error fires AFTER the chain
  // accepted the post, fetch any TaskPosted event from us within this
  // window. Anchor *before* the build, with cushion for any clock skew
  // between our process and the validator.
  const idempotencyAnchorMs = Date.now() - 5000;

  const res = await signAndExecuteWithRetry(
    ctx,
    () =>
      buildPostTaskTx(ctx, {
        bountyMist,
        assignedTo: args.to,
        title: args.title,
        specBlob: args.spec ?? "",
        primaryCapability: args.capability,
        deadlineMs,
        parentPolicyId: args["parent-policy"] || null,
      }),
    { showEffects: true, showObjectChanges: true, showEvents: true },
    {
      label: "post-task",
      attempts: 3,
      // Idempotency: if our first attempt already produced a TaskPosted
      // event matching (poster=us, assigned_to, capability) within the
      // anchor window, return that event's tx digest. Re-executing
      // would create a duplicate task.
      alreadyDone: async () => {
        try {
          const evResp = await ctx.client.queryEvents({
            query: {
              MoveEventType: `${ctx.typeOriginId}::task::TaskPosted`,
            },
            order: "descending",
            limit: 50,
          });
          for (const ev of evResp.data) {
            const p = ev.parsedJson as {
              poster?: string;
              assigned_to?: string;
              primary_capability?: string;
              posted_at_ms?: string;
              task_id?: string;
            };
            if (!p?.poster || !p.task_id) continue;
            if (p.poster.toLowerCase() !== ctx.address.toLowerCase()) continue;
            if (p.assigned_to?.toLowerCase() !== args.to.toLowerCase()) continue;
            if (p.primary_capability !== args.capability) continue;
            const postedAt = Number(p.posted_at_ms ?? "0");
            if (!Number.isFinite(postedAt) || postedAt < idempotencyAnchorMs) continue;
            // Found a matching post. Synthesize a response with the
            // tx digest + objectChanges-equivalent so downstream code
            // can pluck the Task object id.
            return {
              digest: ev.id.txDigest,
              effects: { status: { status: "success" } },
              objectChanges: [
                {
                  type: "created",
                  objectId: p.task_id,
                  objectType: `${ctx.packageId}::task::Task`,
                },
              ],
            } as unknown as import("@mysten/sui/jsonRpc").SuiTransactionBlockResponse;
          }
        } catch {
          /* fall through */
        }
        return null;
      },
    },
  );

  if (res.effects?.status?.status !== "success") {
    console.error("FAILED:", res.effects?.status?.error);
    process.exit(1);
  }

  const created = (res.objectChanges ?? []).find(
    (c) =>
      c.type === "created" &&
      typeof (c as { objectType?: string }).objectType === "string" &&
      (c as { objectType?: string }).objectType?.includes("::task::Task"),
  ) as { objectId?: string; objectType?: string } | undefined;

  const taskId = created?.objectId ?? "(not found)";
  const explorer = `https://suiscan.xyz/${env.network}/object/${taskId}`;

  console.log(`[post-task] ok · task=${taskId}`);
  console.log(`[post-task] tx=${res.digest}`);
  console.log(`[post-task] explorer=${explorer}`);
}

main().catch((e) => {
  console.error("[post-task] fatal:", e);
  process.exit(1);
});
