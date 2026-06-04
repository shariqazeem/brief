// scripts/probe-deepbook.ts — Day 6 probe (GO/NO-GO call).
//
// Tests whether @mysten/deepbook-v3 v1.3.6 works against our testnet wallet
// by creating a BalanceManager. If this TX succeeds, the SDK is wired
// correctly and we can wire DeepBook into ExecutionAgent.
//
// Run: tsx --env-file=.env.local scripts/probe-deepbook.ts

import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  DeepBookClient,
  testnetCoins,
  testnetPools,
} from "@mysten/deepbook-v3";
import { loadEnv } from "../agents/lib/env.js";

async function main() {
  const env = loadEnv();
  const keypair = Ed25519Keypair.fromSecretKey(env.agentSecretKey);
  const address = keypair.getPublicKey().toSuiAddress();

  console.log(`[probe-deepbook] wallet=${address}`);
  console.log(
    `[probe-deepbook] available testnet pools: ${Object.keys(testnetPools).join(", ")}`,
  );
  console.log(
    `[probe-deepbook] available testnet coins: ${Object.keys(testnetCoins).join(", ")}`,
  );

  const sui = new SuiJsonRpcClient({
    network: env.network,
    url: env.rpcUrl,
  });

  const db = new DeepBookClient({
    // The DeepBookCompatibleClient interface requires ClientWithCoreApi;
    // SuiJsonRpcClient satisfies it at runtime but the public types differ
    // slightly. Cast through unknown for the probe.
    client: sui as unknown as ConstructorParameters<typeof DeepBookClient>[0]["client"],
    address,
    network: env.network,
    coins: testnetCoins,
    pools: testnetPools,
  });

  console.log("\n[probe-deepbook] STEP 1: create + share a BalanceManager");
  const tx = new Transaction();
  db.balanceManager.createAndShareBalanceManager()(tx);

  const result = await sui.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });

  console.log(`[probe-deepbook] tx: ${result.digest}`);
  console.log(
    `[probe-deepbook] explorer: https://suiexplorer.com/txblock/${result.digest}?network=${env.network}`,
  );

  const created = result.objectChanges?.filter(
    (c) => c.type === "created",
  ) ?? [];

  console.log(`\n[probe-deepbook] created objects (${created.length}):`);
  for (const c of created) {
    if ("objectType" in c && "objectId" in c) {
      const typeShort = c.objectType.split("::").slice(-2).join("::");
      console.log(`  ${typeShort}  ${c.objectId}`);
    }
  }

  const bm = created.find(
    (c) =>
      "objectType" in c &&
      typeof c.objectType === "string" &&
      c.objectType.includes("BalanceManager") &&
      !c.objectType.includes("Cap"),
  );

  if (!bm || !("objectId" in bm)) {
    console.error("\n[probe-deepbook] ❌ BalanceManager not found in objectChanges");
    console.log("\nVERDICT: NO-GO — investigate before wiring DeepBook into ExecutionAgent");
    process.exit(1);
  }

  console.log(`\n[probe-deepbook] ✅ BalanceManager: ${bm.objectId}`);
  console.log("\nVERDICT: GO — DeepBook SDK wired, ready to extend ExecutionAgent");
  console.log(`\nNext steps:`);
  console.log(`  1. Save BalanceManager id to .env.local as BRIEF_BALANCE_MANAGER_ID`);
  console.log(`  2. Implement agents/execution/deepbook.ts using db.deepBook.placeMarketOrder`);
  console.log(`  3. Set BRIEF_EXECUTION_MODE=deepbook in .env.local`);
}

main().catch((e: unknown) => {
  console.error("\n[probe-deepbook] ❌ FAILED:", (e as Error)?.message ?? e);
  console.log("\nVERDICT: NO-GO — stay on simulated execution mode for the demo");
  console.log("Full error:");
  console.error((e as Error)?.stack);
  process.exit(1);
});
