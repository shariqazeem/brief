// CLI: approve a delivered task.
//
// Usage:
//   tsx --env-file=.env.local scripts/workforce-approve-task.ts \
//     --task 0x... [--policy 0x...] [--agent-reg 0x...]
//
// If --policy is supplied, calls task::approve_with_policy (atomic with
// operator_policy::record_spend). Otherwise calls task::approve_direct.
//
// --agent-reg can be omitted; the script discovers the agent's
// AgentRegistration by walking AgentRegistered events for task.assigned_to.

import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";
import {
  buildApproveWithPolicyTx,
  buildApproveDirectTx,
  fetchTask,
} from "../agents/workforce/lib/task.js";
import { findAgentRegistration } from "../agents/workforce/lib/agent-registry.js";

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
  if (!args.task) {
    console.error("Missing --task");
    process.exit(1);
  }

  const env = loadEnv();
  const ctx = makeAgentContext(env);

  const t = await fetchTask(ctx, args.task);
  console.log(
    `[approve] task ${t.id.slice(0, 10)}… status=${t.status} bounty=${t.bountyAmount} assigned_to=${t.assignedTo.slice(0, 10)}…`,
  );

  if (t.status !== "delivered") {
    console.error(`Cannot approve — task status is ${t.status}, must be delivered`);
    process.exit(1);
  }

  let agentRegId = args["agent-reg"];
  if (!agentRegId) {
    console.log(`[approve] looking up AgentRegistration for ${t.assignedTo.slice(0, 10)}…`);
    const reg = await findAgentRegistration(ctx, t.assignedTo);
    if (!reg) {
      console.error("No AgentRegistration found on chain for the assigned agent.");
      process.exit(1);
    }
    agentRegId = reg.id;
  }

  const policyId = args.policy ?? t.parentPolicy;
  const tx =
    policyId && policyId !== "true"
      ? buildApproveWithPolicyTx(ctx, {
          taskId: t.id,
          policyId,
          agentRegId,
        })
      : buildApproveDirectTx(ctx, {
          taskId: t.id,
          agentRegId,
        });

  console.log(
    `[approve] sending ${policyId ? "approve_with_policy" : "approve_direct"} · policy=${policyId?.slice(0, 10) ?? "none"} reg=${agentRegId.slice(0, 10)}…`,
  );

  const res = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true, showBalanceChanges: true },
  });

  if (res.effects?.status?.status !== "success") {
    console.error("FAILED:", res.effects?.status?.error);
    process.exit(1);
  }

  console.log(`[approve] ok · tx=${res.digest}`);
  const explorer = `https://suiscan.xyz/${env.network}/tx/${res.digest}`;
  console.log(`[approve] explorer=${explorer}`);
}

main().catch((e) => {
  console.error("[approve] fatal:", e);
  process.exit(1);
});
