// ExecutionAgent — consumes StrategyObjects, mints ExecutionReceipts.
//
// Two execution paths:
//   - simulated: 1-MIST self-transfer anchors the receipt to a real TX
//   - deepbook:  deposit + place_market_order on SUI/DBUSDC (real DEX fill)
//
// Switch via env: BRIEF_EXECUTION_MODE=simulated|deepbook (default simulated).

import { loadEnv } from "../lib/env.js";
import { makeAgentContext } from "../lib/sui.js";
import { startEventPoll } from "../lib/event-poll.js";
import {
  buildMintTx,
  decodePayload,
  encodePayload,
  fetchWorkObject,
  readWorkObjectPayload,
} from "../lib/work-object.js";
import {
  buildSimulatedExecutionTx,
  type SimulatedFill,
} from "./simulated.js";
import {
  buildDeepBookExecutionTx,
  makeDeepBookContext,
  parseDeepBookFills,
} from "./deepbook.js";
import { uploadToWalrus, walrusEnabled } from "../lib/walrus.js";

const EXECUTION_FEE_MIST = 1_200_000_000n; // 1.2 SUI
const SCHEMA_VERSION = 1n;

type ExecutionMode = "simulated" | "deepbook";

type StrategyInput = {
  allocation: Record<string, number>;
  projected_30d_yield: number;
  ptb_intent: {
    operations: { op: string; protocol: string; amount_pct: number }[];
  };
  guardian_warnings: { severity: string; message: string }[];
};

type ExecutionReceiptPayload = {
  parent_strategy_id: string;
  mode: ExecutionMode;
  ptb_digest: string;
  fills: SimulatedFill[];
  gas_used: string;
  pool?: string;
  generated_at_ms: number;
};

const DEEPBOOK_MIN_SUI_MIST = 1_100_000_000n; // 1.1 SUI (1.0 order min + 0.1 buffer)

/**
 * Pick execution mode based on environment + on-chain preconditions.
 *
 * BRIEF_EXECUTION_MODE accepts:
 *   - "simulated"  → always simulated, never tries DeepBook
 *   - "deepbook"   → require DeepBook; throws if preconditions missing
 *   - "auto" | unset → try DeepBook if possible, else fall back to simulated
 *
 * Preconditions for DeepBook:
 *   1. BRIEF_BALANCE_MANAGER_ID env var set (created via probe-deepbook.ts)
 *   2. Agent wallet has ≥ 1.1 SUI (pool minSize is 1.0 + gas buffer)
 *
 * If the agent's wallet is later topped up, the auto path picks DeepBook
 * on the next cycle without redeploy — properly self-healing.
 */
async function pickExecutionMode(
  ctx: ReturnType<typeof makeAgentContext>,
): Promise<{ mode: ExecutionMode; reason: string }> {
  const explicit = (process.env.BRIEF_EXECUTION_MODE ?? "auto").toLowerCase();
  if (explicit === "simulated") {
    return { mode: "simulated", reason: "explicit env override" };
  }
  const requireDeepBook = explicit === "deepbook";

  const bmId = process.env.BRIEF_BALANCE_MANAGER_ID;
  if (!bmId) {
    if (requireDeepBook) {
      throw new Error(
        "BRIEF_EXECUTION_MODE=deepbook requires BRIEF_BALANCE_MANAGER_ID. Run scripts/probe-deepbook.ts to create one.",
      );
    }
    return { mode: "simulated", reason: "no BalanceManager configured" };
  }

  // Check SUI balance via the running Sui client
  try {
    const bal = await ctx.client.getBalance({ owner: ctx.address });
    const lamports = BigInt(bal.totalBalance);
    if (lamports < DEEPBOOK_MIN_SUI_MIST) {
      if (requireDeepBook) {
        throw new Error(
          `BRIEF_EXECUTION_MODE=deepbook requires ≥ 1.1 SUI in wallet; have ${(Number(lamports) / 1e9).toFixed(3)}`,
        );
      }
      return {
        mode: "simulated",
        reason: `wallet has ${(Number(lamports) / 1e9).toFixed(3)} SUI, need ≥ 1.1 for DeepBook order min`,
      };
    }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (requireDeepBook) throw e;
    return { mode: "simulated", reason: `balance check failed: ${msg.slice(0, 80)}` };
  }

  return { mode: "deepbook", reason: "preconditions met (BalanceManager + ≥1.1 SUI)" };
}

async function handleConfirmation(
  ctx: ReturnType<typeof makeAgentContext>,
  env: ReturnType<typeof loadEnv>,
  confirmationId: string,
  owner: string,
): Promise<void> {
  // The Confirmation WorkObject is small (inline) and points to its parent
  // Strategy. We use the Strategy as the actual basis for execution.
  const confirmation = await fetchWorkObject(ctx, confirmationId);
  const strategyId = confirmation.parentIds[0];
  if (!strategyId) {
    console.warn(`[execution] confirmation ${confirmationId} has no parent strategy`);
    return;
  }

  const input = await fetchWorkObject(ctx, strategyId);
  const inputBytes = await readWorkObjectPayload(input);
  if (!inputBytes) {
    console.warn(`[execution] strategy ${strategyId} has no readable payload, skipping`);
    return;
  }
  const strategy = decodePayload(inputBytes) as StrategyInput;
  const eventId = strategyId;
  const confirmationParent = confirmationId;

  // Auto-pick mode: try DeepBook if wallet has enough SUI + BalanceManager
  // exists, else simulated. If user set BRIEF_EXECUTION_MODE explicitly,
  // honor that. The auto path self-heals on top-up — no redeploy needed.
  const { mode, reason } = await pickExecutionMode(ctx);
  console.log(`[execution] mode=${mode} (${reason})`);

  // Build the execution TX in the chosen mode
  let execTx;
  let preComputedFills: SimulatedFill[] | null = null;

  if (mode === "deepbook") {
    const bmId = process.env.BRIEF_BALANCE_MANAGER_ID!;
    const dbCtx = makeDeepBookContext(ctx.client, ctx.address, bmId);
    execTx = buildDeepBookExecutionTx(dbCtx, strategy.ptb_intent);
  } else {
    const built = buildSimulatedExecutionTx(owner, strategy.ptb_intent);
    execTx = built.tx;
    preComputedFills = built.fills;
  }

  // Execute the PTB
  const result = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: execTx,
    options: {
      showEffects: true,
      showBalanceChanges: true,
    },
  });

  const ptbDigest = result.digest;

  // Extract fills (real for deepbook, pre-computed for simulated)
  const fills =
    mode === "deepbook"
      ? parseDeepBookFills(result, ctx.address)
      : preComputedFills ?? [];

  const gasUsed =
    result.effects?.gasUsed?.computationCost ??
    result.effects?.gasUsed?.storageCost ??
    "0";

  const receipt: ExecutionReceiptPayload = {
    parent_strategy_id: eventId,
    mode,
    ptb_digest: ptbDigest,
    fills,
    gas_used: String(gasUsed),
    pool: mode === "deepbook" ? "SUI_DBUSDC" : undefined,
    generated_at_ms: Date.now(),
  };

  const receiptBytes = encodePayload(receipt);

  let walrusBlobId: string | null = null;
  let inlinePayload: Uint8Array = receiptBytes;
  if (walrusEnabled()) {
    const up = await uploadToWalrus(receiptBytes, ctx.client, ctx.keypair);
    walrusBlobId = up.blobId;
    inlinePayload = new Uint8Array();
    console.log(
      `[execution] walrus uploaded ${receiptBytes.length}B in ${up.uploadMs}ms (blobId=${up.blobId})`,
    );
  }

  const mintTx = buildMintTx(ctx, {
    owner,
    kind: "Execution",
    schemaVersion: SCHEMA_VERSION,
    payload: inlinePayload,
    walrusBlobId,
    // Execution parents = [Strategy, Confirmation] so judges can see BOTH
    // the strategy that drove execution and the explicit user sign-off.
    parentIds: [eventId, confirmationParent],
    paymentAmount: EXECUTION_FEE_MIST,
  });

  const mintResult = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: mintTx,
    options: { showEffects: true },
  });

  console.log(
    `[execution] mode=${mode} fills=${fills.length} exec_tx=${ptbDigest} receipt_tx=${mintResult.digest}`,
  );
}

async function main() {
  const env = loadEnv();
  const ctx = makeAgentContext(env);
  const initial = await pickExecutionMode(ctx);
  console.log(
    `[execution] address=${ctx.address} initial_mode=${initial.mode} (${initial.reason})`,
  );

  // ExecutionAgent only fires on explicit user confirmation, satisfying
  // the Intent Engine sub-track must-have. The Confirmation WorkObject is
  // minted by the user via the GuardianPanel "Confirm execution" button.
  await startEventPoll({
    ctx,
    acceptsKind: "Confirmation",
    cursorPath: ".cursors/execution.json",
    pollMs: 3000,
    label: "execution",
    onEvent: async ({ id, payload }) => {
      await handleConfirmation(ctx, env, id, payload.owner);
    },
  });
}

main().catch((e: unknown) => {
  console.error("[execution] fatal:", (e as Error)?.message ?? e);
  process.exit(1);
});
