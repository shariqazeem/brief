import { fetchSuiDefiProtocols, rankForIntent, computeGuardianWarnings } from "../agents/lib/protocol-data.js";

async function main() {
  console.log("Fetching live Sui DeFi data from DeFiLlama...");
  const all = await fetchSuiDefiProtocols();
  console.log(`\nTop 12 Sui DeFi protocols (live):\n`);
  for (const p of all) {
    console.log(
      `  ${p.name.padEnd(22)}  ${p.category.padEnd(18)}  TVL=$${(p.tvl_usd / 1e6).toFixed(1)}M  apy=${p.best_apy.toFixed(2)}%  audits=${p.audit_status.padEnd(10)}  age=${p.age_days}d  risk=${p.risk}`,
    );
  }

  console.log("\n--- For intent: 'I have 1000 SUI, low risk, 30-day yield' ---\n");
  const ranked = rankForIntent(all, "I have 1000 SUI, low risk, 30-day yield");
  for (const p of ranked) {
    console.log(`  ${p.name.padEnd(22)}  ${p.category.padEnd(18)}  apy=${p.best_apy.toFixed(2)}%  risk=${p.risk}`);
  }

  console.log("\n--- Sample allocation + warnings ---\n");
  const allocation: Record<string, number> = {};
  if (ranked[0]) allocation[ranked[0].name] = 0.6;
  if (ranked[1]) allocation[ranked[1].name] = 0.3;
  allocation["reserve"] = 0.1;
  console.log("Allocation:", allocation);
  const orderSizeUsd = 1000 * 1.07; // 1000 SUI ~= $1070
  const warnings = computeGuardianWarnings(ranked, allocation, orderSizeUsd);
  console.log(`\nWarnings (${warnings.length}):`);
  for (const w of warnings) {
    console.log(`  [${w.severity}] ${w.kind}: ${w.message}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
