// CLI version of clicking "Confirm execution" in the GuardianPanel.
// Mints a Confirmation WorkObject parented to a Strategy.
//
// Usage: tsx --env-file=.env.local scripts/confirm-strategy.ts <strategy-id>

import { Transaction } from "@mysten/sui/transactions";
import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";
import { encodePayload } from "../agents/lib/work-object.js";

async function main() {
  const strategyId = process.argv[2];
  if (!strategyId) {
    console.error("Usage: tsx scripts/confirm-strategy.ts <strategy-id>");
    process.exit(1);
  }

  const env = loadEnv();
  const ctx = makeAgentContext(env);

  console.log(`[confirm] wallet=${ctx.address}`);
  console.log(`[confirm] strategy=${strategyId}`);

  const payload = encodePayload({
    confirmed: true,
    strategy_id: strategyId,
    confirmed_at_ms: Date.now(),
  });

  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::work_object::mint`,
    arguments: [
      tx.pure.address(ctx.address),
      tx.pure.string("Confirmation"),
      tx.pure.u64(1n),
      tx.pure.vector("u8", Array.from(payload)),
      tx.pure.option("string", null),
      tx.pure.vector("id", [strategyId]),
      tx.pure.u64(0n),
    ],
  });

  const result = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true },
  });

  console.log(`[confirm] tx: ${result.digest}`);
  const created = result.effects?.created?.[0]?.reference?.objectId;
  console.log(`[confirm] Confirmation object: ${created}`);
  console.log(
    `[confirm] explorer: https://suiexplorer.com/object/${created}?network=${env.network}`,
  );
}

main().catch((e: unknown) => {
  console.error("[confirm] failed:", (e as Error)?.message ?? e);
  process.exit(1);
});
