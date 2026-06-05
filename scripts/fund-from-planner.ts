// Tiny one-shot: transfer SUI from the Planner wallet to another address.
// Workaround for the testnet faucet being stuck on a long IP cooldown.
//
// Usage:
//   tsx --env-file=.env.local scripts/fund-from-planner.ts \
//     --to 0x… --sui 0.3

import { Transaction } from "@mysten/sui/transactions";
import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args.to || !args.to.startsWith("0x")) throw new Error("--to 0x… required");
  if (!args.sui) throw new Error("--sui <amount> required");
  const mist = BigInt(Math.floor(Number(args.sui) * 1e9));

  const env = loadEnv();
  const ctx = makeAgentContext(env);

  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(mist)]);
  tx.transferObjects([coin], tx.pure.address(args.to));

  const res = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true, showBalanceChanges: true },
  });
  if (res.effects?.status?.status !== "success") {
    throw new Error(`transfer failed: ${res.effects?.status?.error}`);
  }
  console.log(
    `[fund] sent ${args.sui} SUI from ${ctx.address.slice(0, 10)}… to ${args.to.slice(0, 10)}… tx=${res.digest}`,
  );
}

main().catch((e) => {
  console.error("[fund] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
