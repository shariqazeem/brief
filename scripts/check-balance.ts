// One-shot: print the agent wallet's SUI balance + coin count.
import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const ctx = makeAgentContext(env);
  const b = await ctx.client.getBalance({ owner: ctx.address });
  console.log(`address=${ctx.address}`);
  console.log(
    `balance=${(Number(b.totalBalance) / 1e9).toFixed(4)} SUI (${b.coinObjectCount} coins)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
