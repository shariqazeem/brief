// One-shot CLI for testing the OperatorPolicy module + agent loop end-to-end.
// Usage:
//   npm run operator -- create [budget-sui] [minutes-til-expiry] [venues-csv]
//   npm run operator -- read <policy-id>
//   npm run operator -- revoke <policy-id>
//   npm run operator -- list

import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext, type AgentContext } from "../agents/lib/sui.js";
import {
  buildCreatePolicyTx,
  buildRevokeTx,
  fetchOperatorPolicy,
} from "../agents/lib/operator-policy.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const ctx = makeAgentContext(env);
  const cmd = process.argv[2];

  switch (cmd) {
    case "create": {
      const budgetSui = Number(process.argv[3] ?? "5");
      const minutes = Number(process.argv[4] ?? "30");
      const venuesCsv = process.argv[5] ?? "DeepBook,NAVI";
      const venues = venuesCsv.split(",").map((v) => v.trim()).filter(Boolean);
      const budgetMist = BigInt(Math.floor(budgetSui * 1e9));
      const expiresAtMs = BigInt(Date.now() + minutes * 60 * 1000);

      console.log(`[cli] creating policy: budget=${budgetSui} SUI, expiry=${minutes}min, venues=${venues.join(",")}`);

      const tx = buildCreatePolicyTx({
        packageId: ctx.packageId,
        agent: ctx.address,
        name: "Smoke Test Policy",
        budgetCap: budgetMist,
        allowedVenues: venues,
        maxConcentrationBps: 3000,
        expiresAtMs,
        autoApprovePct: 50,
        riskTolerance: "low",
      });

      const result = await ctx.client.signAndExecuteTransaction({
        signer: ctx.keypair,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      console.log(`[cli] tx: ${result.digest}`);
      const policyId = extractCreatedPolicyId(result, ctx);
      if (policyId) {
        console.log(`[cli] policy id: ${policyId}`);
        console.log(`[cli] suiscan: https://suiscan.xyz/testnet/object/${policyId}`);
        console.log(`[cli] watch operator: tail -f /tmp/brief-operator.log`);
      }
      break;
    }

    case "read": {
      const id = process.argv[3];
      if (!id) throw new Error("usage: operator read <policy-id>");
      const policy = await fetchOperatorPolicy(ctx, id);
      console.log(
        JSON.stringify(
          policy,
          (_k, v) => (typeof v === "bigint" ? v.toString() : v),
          2,
        ),
      );
      break;
    }

    case "revoke": {
      const id = process.argv[3];
      if (!id) throw new Error("usage: operator revoke <policy-id>");
      const tx = buildRevokeTx({ packageId: ctx.packageId, policyId: id });
      const result = await ctx.client.signAndExecuteTransaction({
        signer: ctx.keypair,
        transaction: tx,
        options: { showEffects: true },
      });
      console.log(`[cli] revoke tx: ${result.digest}`);
      console.log(`[cli] policy ${id.slice(0, 10)}… revoked. The operator agent's next cycle will detect it and stop.`);
      break;
    }

    case "list":
    default: {
      console.log("commands:");
      console.log("  create [budget-sui=5] [minutes-til-expiry=30] [venues-csv='DeepBook,NAVI']");
      console.log("  read <policy-id>");
      console.log("  revoke <policy-id>");
    }
  }
}

function extractCreatedPolicyId(
  result: Awaited<ReturnType<AgentContext["client"]["signAndExecuteTransaction"]>>,
  ctx: AgentContext,
): string | null {
  const changes = result.objectChanges ?? [];
  for (const c of changes) {
    if (
      c.type === "created" &&
      typeof c.objectType === "string" &&
      c.objectType.includes("::operator_policy::OperatorPolicy")
    ) {
      return c.objectId;
    }
  }
  // Try guessing from the typeOriginId too (Sui type-id normalizes to origin)
  const expectedType = `${ctx.typeOriginId}::operator_policy::OperatorPolicy`;
  for (const c of changes) {
    if (c.type === "created" && c.objectType === expectedType) {
      return c.objectId;
    }
  }
  return null;
}

main().catch((e: unknown) => {
  console.error("FATAL:", (e as Error)?.message ?? e);
  process.exit(1);
});
