// workforce:setup — provision the 3-wallet workforce in one shot.
//
// Brief is a multi-agent economy: the Planner (AGENT_SECRET_KEY) hires
// the Research and Treasury specialists. Each specialist signs as its
// own wallet so reputation and payments accrue to it, not the Planner.
// This script makes that real:
//
//   1. Confirms AGENT_SECRET_KEY is set (and prints its address).
//   2. For each of RESEARCH_SECRET_KEY / TREASURY_SECRET_KEY: reuses the
//      existing value if set; otherwise generates a fresh ed25519 keypair
//      and prints the bech32 secret so the operator can paste it into
//      .env.local. We DO NOT touch .env.local — this script is read-only
//      against your secrets.
//   3. Funds each of the three wallets via the Sui testnet faucet (with
//      30s back-off on rate limits) until each holds ≥ TARGET_SUI. Ample
//      for gas; Treasury can still drop to simulated DeepBook mode if a
//      live DEX flow would consume more than the wallet has.
//
// Safe to re-run any number of times. If all three keys are already set
// and the wallets are funded, this just confirms balances and exits.
//
// Usage: npm run workforce:setup

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  FaucetRateLimitError,
  getFaucetHost,
  requestSuiFromFaucetV2,
} from "@mysten/sui/faucet";

import { loadEnv, type AgentRole } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";

type WalletInfo = {
  role: AgentRole;
  envVar: "AGENT_SECRET_KEY" | "RESEARCH_SECRET_KEY" | "TREASURY_SECRET_KEY";
  address: string;
  secretKey: string;
  generated: boolean;
};

const TARGET_SUI = 1.0;
const MAX_FAUCET_ATTEMPTS = 8;
const RATE_LIMIT_BACKOFF_MS = 30_000;
const POLL_AFTER_FAUCET_MS = 4_000;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function resolveOrGenerate(
  role: AgentRole,
  envVar: WalletInfo["envVar"],
  existing: string,
): WalletInfo {
  if (existing && existing.length > 0) {
    const kp = Ed25519Keypair.fromSecretKey(existing);
    return {
      role,
      envVar,
      address: kp.getPublicKey().toSuiAddress(),
      secretKey: existing,
      generated: false,
    };
  }
  const kp = Ed25519Keypair.generate();
  return {
    role,
    envVar,
    address: kp.getPublicKey().toSuiAddress(),
    secretKey: kp.getSecretKey(),
    generated: true,
  };
}

async function fundUntilTarget(
  client: ReturnType<typeof makeAgentContext>["client"],
  wallet: WalletInfo,
): Promise<{ ok: boolean; finalSui: number; note?: string }> {
  const label = `${wallet.role.padEnd(8)}`;
  for (let attempt = 1; attempt <= MAX_FAUCET_ATTEMPTS; attempt++) {
    const b = await client.getBalance({ owner: wallet.address });
    const sui = Number(b.totalBalance) / 1e9;
    if (sui >= TARGET_SUI) {
      console.log(
        `[setup] ${label}  ${wallet.address}  ${sui.toFixed(3)} SUI ≥ ${TARGET_SUI} ✓`,
      );
      return { ok: true, finalSui: sui };
    }
    console.log(
      `[setup] ${label}  ${wallet.address}  ${sui.toFixed(3)} SUI — requesting faucet (attempt ${attempt}/${MAX_FAUCET_ATTEMPTS})…`,
    );
    try {
      await requestSuiFromFaucetV2({
        host: getFaucetHost("testnet"),
        recipient: wallet.address,
      });
      await sleep(POLL_AFTER_FAUCET_MS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const rateLimited =
        e instanceof FaucetRateLimitError ||
        /rate.*limit|too.*many.*requests|429/i.test(msg);
      if (rateLimited) {
        console.warn(
          `[setup] ${label}  rate-limited; sleeping ${RATE_LIMIT_BACKOFF_MS / 1000}s before retry…`,
        );
        await sleep(RATE_LIMIT_BACKOFF_MS);
      } else {
        console.warn(
          `[setup] ${label}  faucet error: ${msg.slice(0, 120)} — sleeping 5s and retrying…`,
        );
        await sleep(5_000);
      }
    }
  }
  const b = await client.getBalance({ owner: wallet.address });
  const sui = Number(b.totalBalance) / 1e9;
  return {
    ok: false,
    finalSui: sui,
    note: `did not reach ${TARGET_SUI} SUI after ${MAX_FAUCET_ATTEMPTS} attempts`,
  };
}

async function main(): Promise<void> {
  const env = loadEnv();

  if (!env.agentSecretKey) {
    console.error(
      "[setup] AGENT_SECRET_KEY is required in .env.local before the workforce can be provisioned.\n" +
        "        Generate one with:  sui keytool generate ed25519 --json | jq -r .privateKey\n" +
        "        Paste the suiprivkey1… value into .env.local as AGENT_SECRET_KEY and re-run.",
    );
    process.exit(1);
  }

  const wallets: WalletInfo[] = [
    resolveOrGenerate("planner", "AGENT_SECRET_KEY", env.agentSecretKey),
    resolveOrGenerate("research", "RESEARCH_SECRET_KEY", env.researchSecretKey),
    resolveOrGenerate("treasury", "TREASURY_SECRET_KEY", env.treasurySecretKey),
  ];

  // Surface the planner address as the operator address (used by the dApp
  // Kit Hire Wizard to default policy.agent).
  const operatorAddress =
    process.env.NEXT_PUBLIC_BRIEF_OPERATOR_ADDRESS ?? "";
  const plannerAddress = wallets[0].address;
  if (
    operatorAddress &&
    operatorAddress.toLowerCase() !== plannerAddress.toLowerCase()
  ) {
    console.warn(
      `[setup] WARNING: NEXT_PUBLIC_BRIEF_OPERATOR_ADDRESS (${operatorAddress}) does not match the Planner address (${plannerAddress}). The Hire Wizard binds policy.agent to NEXT_PUBLIC_BRIEF_OPERATOR_ADDRESS — update it to the Planner address or approvals will abort with ENotAgent.`,
    );
  }

  console.log("");
  console.log("[setup] Workforce roster:");
  for (const w of wallets) {
    const tag = w.generated ? " (NEW — copy into .env.local!)" : "";
    console.log(`  ${w.role.padEnd(8)} ${w.address}${tag}`);
  }
  console.log("");

  const generated = wallets.filter((w) => w.generated);
  if (generated.length > 0) {
    console.log(
      "[setup] The following secret keys are NEW — paste them into .env.local before",
    );
    console.log(
      "[setup] running any specialist agent, or the funded testnet SUI will be unrecoverable:",
    );
    console.log("");
    for (const w of generated) {
      console.log(`${w.envVar}=${w.secretKey}`);
    }
    console.log("");
  }

  // Build an RPC client using whichever wallet was already configured —
  // we don't need to sign anything; we just need a client for getBalance.
  // makeAgentContext uses env.agentSecretKey, which we already required.
  const { client } = makeAgentContext(env);

  console.log("[setup] Funding wallets via testnet faucet…");
  const results: Array<{
    wallet: WalletInfo;
    ok: boolean;
    finalSui: number;
    note?: string;
  }> = [];
  for (const w of wallets) {
    const r = await fundUntilTarget(client, w);
    results.push({ wallet: w, ...r });
  }

  console.log("");
  console.log("[setup] Summary:");
  let failed = 0;
  for (const r of results) {
    const status = r.ok ? "✓" : "✗";
    const note = r.note ? `  (${r.note})` : "";
    console.log(
      `  ${status} ${r.wallet.role.padEnd(8)} ${r.wallet.address}  ${r.finalSui.toFixed(3)} SUI${note}`,
    );
    if (!r.ok) failed += 1;
  }
  console.log("");

  if (generated.length > 0) {
    console.log(
      "[setup] ⚠️  Paste the NEW keys above into .env.local and re-run `npm run workforce:setup` to confirm balances persist.",
    );
  } else if (failed === 0) {
    console.log(
      "[setup] All three wallets funded and configured. Start the workforce: `npm run agents:all`",
    );
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("[setup] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
