// scripts/probe-walrus.ts — Day 17 probe (GO/NO-GO call).
//
// Uploads a 10 KB JSON blob to Walrus testnet, reads it back, verifies the
// round-trip. Reports latency. If under ~8 s end-to-end and round-trip is
// byte-exact, mark Walrus as GO for ResearchObject/StrategyObject payload
// offload (Days 22-23 in the plan).
//
// Run: tsx --env-file=.env.local scripts/probe-walrus.ts

import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { WalrusClient } from "@mysten/walrus";
import { loadEnv } from "../agents/lib/env.js";

async function main() {
  const env = loadEnv();
  const keypair = Ed25519Keypair.fromSecretKey(env.agentSecretKey);
  const address = keypair.getPublicKey().toSuiAddress();

  console.log(`[probe-walrus] wallet=${address}`);
  console.log(`[probe-walrus] network=${env.network}`);

  const sui = new SuiJsonRpcClient({
    network: env.network,
    url: env.rpcUrl,
  });

  // Upload relay endpoint — without this, the SDK fans out to ~2200 storage-node
  // requests and times out. The relay shrinks that to ~100.
  const RELAY_HOST = "https://upload-relay.testnet.walrus.space";

  const walrus = new WalrusClient({
    network: env.network as "testnet" | "mainnet",
    suiClient: sui as unknown as ConstructorParameters<typeof WalrusClient>[0]["suiClient"],
    uploadRelay: {
      host: RELAY_HOST,
      // Willing to pay a tip up to 10_000 MIST if the relay requires one.
      sendTip: { max: 10_000 },
    },
  });

  // Build a ~10 KB JSON blob shaped like a real ResearchObject payload.
  const payload = {
    topic: "I have 1000 SUI. Where for 30-day yield, low risk?",
    evaluated: Array.from({ length: 5 }, (_, i) => ({
      protocol: ["NAVI", "Scallop", "Suilend", "Cetus", "Bluefin"][i],
      apy: 6 + i * 0.5,
      tvl_usd: 100_000_000 - i * 10_000_000,
      reasoning: "X".repeat(1800),
    })),
    generated_at_ms: Date.now(),
  };
  const blob = new TextEncoder().encode(JSON.stringify(payload));
  console.log(`[probe-walrus] payload bytes: ${blob.length}`);

  console.log("\n[probe-walrus] STEP 1: writeBlob(epochs=1, deletable=false)");
  const uploadStart = Date.now();
  let blobId: string;
  let blobObjectId: string;
  try {
    const result = await walrus.writeBlob({
      blob,
      deletable: false,
      epochs: 1,
      signer: keypair,
    });
    blobId = result.blobId;
    blobObjectId = result.blobObject.id;
  } catch (e) {
    console.error(`\n[probe-walrus] ❌ upload failed: ${(e as Error).message}`);
    console.log(`\nFull error:\n${(e as Error).stack}`);
    console.log("\nVERDICT: NO-GO — keep inline payloads, drop Walrus track ambition");
    process.exit(1);
  }
  const uploadMs = Date.now() - uploadStart;
  console.log(`[probe-walrus] ✅ upload OK in ${uploadMs}ms`);
  console.log(`[probe-walrus]   blobId:       ${blobId}`);
  console.log(`[probe-walrus]   blobObjectId: ${blobObjectId}`);

  console.log("\n[probe-walrus] STEP 2: readBlob");
  const readStart = Date.now();
  const read = await walrus.readBlob({ blobId });
  const readMs = Date.now() - readStart;
  console.log(`[probe-walrus] ✅ read OK in ${readMs}ms (${read.length} bytes)`);

  const roundTrip = uploadMs + readMs;
  const bytesMatch =
    read.length === blob.length &&
    read.every((b, i) => b === blob[i]);

  console.log(`\n[probe-walrus] round-trip total: ${roundTrip}ms`);
  console.log(`[probe-walrus] bytes match:       ${bytesMatch}`);

  if (!bytesMatch) {
    console.log("\nVERDICT: NO-GO — bytes don't match. Investigate.");
    process.exit(1);
  }

  const verdict = roundTrip < 8000 ? "GO (under 8s target)" : "GO but slow";
  console.log(`\nVERDICT: ${verdict}`);
  console.log("\nNext steps:");
  console.log("  1. Days 22-23 — wire Walrus into ResearchAgent + StrategyAgent mint paths");
  console.log("  2. WorkObject's walrus_blob_id field gets populated, payload field stays empty for large blobs");
  console.log("  3. Frontend's WorkObjectCard fetches Walrus blob lazily when card is clicked");
}

main().catch((e: unknown) => {
  console.error("\n[probe-walrus] ❌ FAILED:", (e as Error)?.message ?? e);
  console.log("\nVERDICT: NO-GO — stay on inline payloads");
  console.error((e as Error)?.stack);
  process.exit(1);
});
