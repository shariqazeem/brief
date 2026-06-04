// Probe: actually execute a deposit + market order on DeepBook testnet.
// Doesn't depend on the Brief agent flow — just exercises the deepbook.ts
// helpers in isolation.

import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { loadEnv } from "../agents/lib/env.js";
import {
  buildDeepBookExecutionTx,
  makeDeepBookContext,
  parseDeepBookFills,
} from "../agents/execution/deepbook.js";

async function main() {
  const env = loadEnv();
  const bmId = process.env.BRIEF_BALANCE_MANAGER_ID;
  if (!bmId) {
    throw new Error("Set BRIEF_BALANCE_MANAGER_ID in .env.local");
  }

  const keypair = Ed25519Keypair.fromSecretKey(env.agentSecretKey);
  const address = keypair.getPublicKey().toSuiAddress();
  const sui = new SuiJsonRpcClient({ network: env.network, url: env.rpcUrl });

  console.log(`[probe-execute] wallet=${address}`);
  console.log(`[probe-execute] balance manager=${bmId}`);

  const dbCtx = makeDeepBookContext(sui, address, bmId);

  console.log("\n[probe-execute] building tx (deposit 0.1 SUI + sell 0.05 SUI for DBUSDC)");
  const tx = buildDeepBookExecutionTx(dbCtx, {
    operations: [{ protocol: "DeepBook", amount_pct: 100 }],
  });

  console.log("[probe-execute] executing...");
  const result = await sui.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: {
      showEffects: true,
      showBalanceChanges: true,
    },
  });

  console.log(`\n[probe-execute] tx digest: ${result.digest}`);
  console.log(
    `[probe-execute] explorer: https://suiexplorer.com/txblock/${result.digest}?network=testnet`,
  );
  console.log(`\n[probe-execute] effects status: ${result.effects?.status?.status ?? "?"}`);

  console.log("\n[probe-execute] balance changes:");
  for (const bc of result.balanceChanges ?? []) {
    console.log(`  ${bc.coinType.slice(0, 50)} ${bc.amount}`);
  }

  const fills = parseDeepBookFills(result, address);
  console.log("\n[probe-execute] parsed fills:", JSON.stringify(fills, null, 2));

  if (fills.length > 0 && fills[0].out_amount > 0) {
    console.log("\nVERDICT: GO — real DeepBook fill, ready to flip BRIEF_EXECUTION_MODE=deepbook");
  } else {
    console.log("\nVERDICT: NO FILL — order placed but no liquidity matched. Stay on simulated for demo.");
  }
}

main().catch((e: unknown) => {
  console.error("\n[probe-execute] FAILED:", (e as Error)?.message ?? e);
  console.error((e as Error)?.stack);
  process.exit(1);
});
