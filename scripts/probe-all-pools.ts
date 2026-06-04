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

  console.log("Pool".padEnd(18), "lot", "min", "tick".padEnd(8), "midPrice");
  for (const pk of Object.keys(testnetPools)) {
    try {
      const book = await db.poolBookParams(pk);
      let mid: number | string = "?";
      try { mid = await db.midPrice(pk); } catch { mid = "no-liq"; }
      console.log(pk.padEnd(18), String(book.lotSize).padEnd(5), String(book.minSize).padEnd(5), String(book.tickSize).padEnd(8), mid);
    } catch (e) {
      console.log(pk, "ERROR:", (e as Error).message);
    }
  }
}

main().catch((e: unknown) => { console.error((e as Error).message); process.exit(1); });
