// One-shot: fetch and print an OperatorPolicy's current on-chain state.
// Usage: tsx --env-file=.env.local scripts/check-policy.ts <policy-id>
import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";
import { fetchOperatorPolicy } from "../agents/lib/operator-policy.js";

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id || !id.startsWith("0x")) {
    throw new Error("usage: check-policy.ts <policy-id>");
  }
  const ctx = makeAgentContext(loadEnv());
  const p = await fetchOperatorPolicy(ctx, id);
  if (!p) throw new Error(`policy ${id} not found`);
  const remaining = p.budgetCap - p.spent;
  console.log(`id           ${p.id}`);
  console.log(`name         ${p.name}`);
  console.log(`owner        ${p.owner}`);
  console.log(`agent        ${p.agent}`);
  console.log(`budget_cap   ${Number(p.budgetCap) / 1e9} SUI`);
  console.log(`spent        ${Number(p.spent) / 1e9} SUI`);
  console.log(`remaining    ${Number(remaining) / 1e9} SUI`);
  console.log(`venues       [${p.allowedVenues.join(", ")}]`);
  console.log(`max_conc_bps ${p.maxConcentrationBps}`);
  console.log(`expires_at   ${new Date(Number(p.expiresAtMs)).toISOString()}`);
  console.log(`auto_app_pct ${p.autoApprovePct}`);
  console.log(`risk         ${p.riskTolerance}`);
  console.log(`revoked      ${p.revoked}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
