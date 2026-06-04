// One-shot: probe the on-chain agent_registry for the active address.
// Confirms that discoverWorkforce() in the Planner will have a specialist
// to assign tasks to.
import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";
import { findAgentRegistration } from "../agents/workforce/lib/agent-registry.js";

async function main(): Promise<void> {
  const ctx = makeAgentContext(loadEnv());
  console.log(`address=${ctx.address}`);
  const reg = await findAgentRegistration(ctx, ctx.address);
  if (!reg) {
    console.log("registration: NONE — Planner discoverWorkforce will return []");
    return;
  }
  console.log(`registration=${reg.id}`);
  console.log(`displayName=${reg.displayName}`);
  console.log(`capabilities=[${reg.capabilities.join(", ")}]`);
  console.log(`completedTasks=${reg.completedTasks}`);
  console.log(`totalPaidMist=${reg.totalPaid}`);
  console.log(`reputationScore=${reg.reputationScore}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
