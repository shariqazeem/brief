// Inspect SUI_DBUSDC pool params (lot/min/tick sizes) to debug quantity scaling.

import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { DeepBookClient, testnetCoins, testnetPools } from "@mysten/deepbook-v3";
import { loadEnv } from "../agents/lib/env.js";

async function main() {
  const env = loadEnv();
  const sui = new SuiJsonRpcClient({ network: env.network, url: env.rpcUrl });

  const db = new DeepBookClient({
    client: sui as unknown as ConstructorParameters<typeof DeepBookClient>[0]["client"],
    address: "0x0000000000000000000000000000000000000000000000000000000000000000",
    network: "testnet",
    coins: testnetCoins,
    pools: testnetPools,
  });

  console.log("--- SUI_DBUSDC pool ---");
  const book = await db.poolBookParams("SUI_DBUSDC");
  console.log("poolBookParams:", JSON.stringify(book, null, 2));
  const trade = await db.poolTradeParams("SUI_DBUSDC");
  console.log("poolTradeParams:", JSON.stringify(trade, null, 2));
  try {
    const mid = await db.midPrice("SUI_DBUSDC");
    console.log("midPrice:", mid);
  } catch (e) {
    console.log("midPrice error:", (e as Error).message);
  }

  console.log("\n--- testnetPools entry ---");
  console.log(JSON.stringify(testnetPools.SUI_DBUSDC, null, 2));
  console.log("\n--- testnetCoins SUI / DBUSDC ---");
  console.log("SUI:", JSON.stringify(testnetCoins.SUI, null, 2));
  console.log("DBUSDC:", JSON.stringify(testnetCoins.DBUSDC, null, 2));
}

main().catch((e: unknown) => {
  console.error((e as Error)?.message ?? e);
  process.exit(1);
});
