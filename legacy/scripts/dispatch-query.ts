// dispatch-query.ts — mint the initial Query WorkObject that kicks off the
// Research → Strategy → Execution chain.
//
// Usage:
//   tsx --env-file=.env.local scripts/dispatch-query.ts "I have 1000 SUI. Where for 30-day yield, low risk?"

import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";
import { buildMintTx, encodePayload } from "../agents/lib/work-object.js";

const QUERY_FEE_MIST = 0n; // Query is user-minted; no agent payment

async function main() {
  const topic = process.argv.slice(2).join(" ").trim();
  if (!topic) {
    console.error('Usage: tsx scripts/dispatch-query.ts "<topic>"');
    process.exit(1);
  }

  const env = loadEnv();
  const ctx = makeAgentContext(env);

  const payload = encodePayload({ topic });

  const tx = buildMintTx(ctx, {
    owner: ctx.address,
    kind: "Query",
    schemaVersion: 1n,
    payload,
    walrusBlobId: null,
    parentIds: [],
    paymentAmount: QUERY_FEE_MIST,
  });

  const result = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });

  console.log(`Query minted. tx=${result.digest}`);

  const minted = result.effects?.created?.[0]?.reference?.objectId;
  if (minted) {
    console.log(`Query object id: ${minted}`);
    console.log(
      `Explorer: https://suiexplorer.com/object/${minted}?network=${env.network}`,
    );
  }
}

main().catch((e: unknown) => {
  console.error("dispatch failed:", (e as Error)?.message ?? e);
  process.exit(1);
});
