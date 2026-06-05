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
import { makeAgentContext } from "../agents/lib/sui.js";
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
  const ctx = makeAgentContext(env);

  const bountySui = Number(args["bounty-sui"]);
  const bountyMist = BigInt(Math.floor(bountySui * 1_000_000_000));
  const deadlineMs = BigInt(Date.now() + deadlineMin * 60 * 1000);

  const tx = buildPostTaskTx(ctx, {
    bountyMist,
    assignedTo: args.to,
    title: args.title,
    specBlob: args.spec ?? "",
    primaryCapability: args.capability,
    deadlineMs,
    parentPolicyId: args["parent-policy"] || null,
  });

  console.log(
    `[post-task] posting · poster=${ctx.address.slice(0, 10)}… to=${args.to.slice(0, 10)}… cap=${args.capability} bounty=${bountySui} SUI deadline=${deadlineMin}min`,
  );

  const res = await signAndExecuteWithRetry(
    ctx,
    tx,
    { showEffects: true, showObjectChanges: true, showEvents: true },
    { label: "post-task", attempts: 3 },
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
