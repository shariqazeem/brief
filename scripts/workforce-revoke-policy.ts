// One-shot CLI to revoke an OperatorPolicy. Owner-only.
// Sets policy.revoked = true on chain — subsequent record_spend calls
// (including task::approve_with_policy) abort with EPolicyRevoked.
//
// Usage: tsx --env-file=.env.local scripts/workforce-revoke-policy.ts <policy-id>

import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";
import { buildRevokeTx } from "../agents/lib/operator-policy.js";

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id || !id.startsWith("0x")) {
    throw new Error("usage: revoke-policy.ts <policy-id>");
  }
  const env = loadEnv();
  const ctx = makeAgentContext(env);

  const tx = buildRevokeTx({ packageId: env.packageId, policyId: id });
  const res = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });
  if (res.effects?.status?.status !== "success") {
    console.error("FAILED:", res.effects?.status?.error);
    process.exit(1);
  }
  console.log(`[revoke] ok policy=${id}`);
  console.log(`[revoke] tx=${res.digest}`);
  console.log(
    `[revoke] explorer=https://suiscan.xyz/${env.network}/tx/${res.digest}`,
  );
}

main().catch((e) => {
  console.error("[revoke] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
