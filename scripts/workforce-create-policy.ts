// Create an OperatorPolicy that grants the agent wallet authority to
// post + settle sub-tasks within an envelope (budget, venues, expiry).
// Used by Day 4 of the locked plan to wire the full workforce end-to-end.
//
// Single-wallet mode: policy.owner = policy.agent = ctx.address. The
// Planner can post sub-tasks with parent_policy=Some(policy.id); approval
// asserts policy.agent == sender.
//
// Usage:
//   tsx --env-file=.env.local scripts/workforce-create-policy.ts \
//     --name "Demo Workforce" \
//     --budget-sui 1.0 \
//     --venues research,audit,treasury \
//     --duration-hours 2 \
//     [--max-concentration-bps 5000] \
//     [--auto-approve-pct 100] \
//     [--risk low]

import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";
import { signAndExecuteWithRetry } from "../agents/lib/sui-retry.js";
import { buildCreatePolicyTx } from "../agents/lib/operator-policy.js";

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
  const env = loadEnv();
  const ctx = makeAgentContext(env);

  const name = args.name || "Demo Workforce Policy";
  const budgetSui = Number(args["budget-sui"] ?? 1.0);
  const venues = (args.venues ?? "research,audit,treasury")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const durationHours = Number(args["duration-hours"] ?? 2);
  const maxConcentrationBps = Number(args["max-concentration-bps"] ?? 5000);
  const autoApprovePct = Number(args["auto-approve-pct"] ?? 100);
  const risk = args.risk || "low";

  const planner = ctx.address;
  const budgetCap = BigInt(Math.floor(budgetSui * 1e9));
  const expiresAtMs = BigInt(Date.now() + durationHours * 3600 * 1000);

  console.log(
    `[create-policy] creating "${name}" budget=${budgetSui} SUI venues=[${venues.join(",")}] expires_in=${durationHours}h agent=${planner.slice(0, 10)}…`,
  );

  const tx = buildCreatePolicyTx({
    packageId: env.packageId,
    agent: planner,
    name,
    budgetCap,
    allowedVenues: venues,
    maxConcentrationBps,
    expiresAtMs,
    autoApprovePct,
    riskTolerance: risk,
  });

  const res = await signAndExecuteWithRetry(
    ctx,
    tx,
    { showEffects: true, showObjectChanges: true, showEvents: true },
    { label: "create-policy", attempts: 3 },
  );

  if (res.effects?.status?.status !== "success") {
    console.error("FAILED:", res.effects?.status?.error);
    process.exit(1);
  }

  const created = (res.objectChanges ?? []).find(
    (c) =>
      c.type === "created" &&
      typeof (c as { objectType?: string }).objectType === "string" &&
      (c as { objectType?: string }).objectType?.includes("::operator_policy::OperatorPolicy"),
  ) as { objectId?: string } | undefined;

  const policyId = created?.objectId ?? "(not found)";

  console.log(`[create-policy] ok policy=${policyId}`);
  console.log(`[create-policy] tx=${res.digest}`);
  console.log(
    `[create-policy] explorer=https://suiscan.xyz/${env.network}/object/${policyId}`,
  );
}

main().catch((e) => {
  console.error("[create-policy] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
