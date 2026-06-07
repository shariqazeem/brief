// Treasury Agent — places real DeepBook v3 limit orders on the SUI/DBUSDC
// pool to probe live market liquidity, then submits a deliverable listing
// the placed orders and the pool snapshot at the moment of placement.
//
// This is the DeepBook prize centerpiece for the Sui Overflow submission.
// Orders are placed POST_ONLY so they rest on the book (they don't take
// liquidity); the resulting on-chain order IDs are the audit trail.
//
// Atomic PTB shape (single transaction):
//   balance_manager::deposit_into_manager   ← top up the manager
//   pool::place_limit_order × N             ← the live test orders
//   work_object::mint(Deliverable)          ← audit trail with order IDs
//   task::submit(task, deliverable_id)      ← OPEN → DELIVERED
//
// Boot pattern:
//   1. Augment AgentRegistration to include the "treasury" capability
//      (single-wallet mode shares the address with Research, so we merge
//      rather than re-register).
//   2. Start the TaskPosted inbox filtered by capability="treasury".
//   3. On each matching task: pre-flight balance check, place orders OR
//      fall back to simulated mode, then submit.

import { Transaction } from "@mysten/sui/transactions";
import {
  DeepBookClient,
  OrderType,
  SelfMatchingOptions,
  testnetCoins,
  testnetPools,
} from "@mysten/deepbook-v3";

import { loadEnv } from "../../lib/env.js";
import { makeAgentContextFor, type AgentContext } from "../../lib/sui.js";
import { signAndExecuteWithRetry } from "../../lib/sui-retry.js";
import { augmentRegistration } from "../lib/agent-registry.js";
import { startTaskInbox, type TaskPostedNotice } from "../lib/inbox.js";
import { recoverStuckTasks } from "../lib/recovery.js";
import {
  appendMintAndSubmit,
  buildAcceptTaskTx,
  fetchTask,
} from "../lib/task.js";

const POLL_MS = 3000;
const CURSOR_PATH = ".cursors/treasury-workforce.json";
const SCHEMA_VERSION = 1n;

const POOL_KEY = "SUI_DBUSDC";
const BALANCE_MANAGER_KEY = "primary";

// Two test orders, sized to clear the pool's 1-SUI minimum when live.
const TEST_ORDER_SIZES_SUI = [1.0, 1.0];
const PRICE_OFFSETS_BPS = [50, 200]; // sells 0.5% and 2% above mid
const FALLBACK_MID_PRICE = 2.0;

// Sum of TEST_ORDER_SIZES_SUI — the manager needs this much tradable SUI
// before we can place the orders. Anything already deposited counts.
const PLANNED_TOTAL_SUI = TEST_ORDER_SIZES_SUI.reduce((a, b) => a + b, 0);

// Headroom above the deposit shortfall the wallet must keep for gas + a
// little safety. Tuned for the 4-call PTB (deposit + 2 orders + mint +
// submit) which has historically priced around 0.05–0.10 SUI.
const GAS_BUFFER_SUI = 0.2;

// ---------------------------------------------------------------------------
// DeepBook wiring
// ---------------------------------------------------------------------------

type DeepBookCtx = {
  db: DeepBookClient;
  balanceManagerId: string;
};

function makeDeepBookCtx(
  ctx: AgentContext,
  balanceManagerId: string,
): DeepBookCtx {
  const db = new DeepBookClient({
    client: ctx.client as unknown as ConstructorParameters<typeof DeepBookClient>[0]["client"],
    address: ctx.address,
    network: "testnet",
    coins: testnetCoins,
    pools: testnetPools,
    balanceManagers: {
      [BALANCE_MANAGER_KEY]: { address: balanceManagerId },
    },
  });
  return { db, balanceManagerId };
}

async function readMidPrice(dbCtx: DeepBookCtx): Promise<number> {
  try {
    const mid = await dbCtx.db.deepBook.midPrice(POOL_KEY);
    if (typeof mid === "number" && mid > 0 && Number.isFinite(mid)) {
      return mid;
    }
    return FALLBACK_MID_PRICE;
  } catch (e) {
    console.warn(
      `[treasury] midPrice fetch failed, using fallback $${FALLBACK_MID_PRICE}:`,
      (e as Error).message,
    );
    return FALLBACK_MID_PRICE;
  }
}

// ---------------------------------------------------------------------------
// Order planning
// ---------------------------------------------------------------------------

type OrderPlan = {
  clientOrderId: string;
  price: number;
  quantitySui: number;
  isBid: boolean;
  offsetBps: number;
};

function composeOrderPlan(
  midPrice: number,
  baseNonce: number,
): OrderPlan[] {
  const out: OrderPlan[] = [];
  for (let i = 0; i < TEST_ORDER_SIZES_SUI.length; i++) {
    const offset = PRICE_OFFSETS_BPS[i] ?? PRICE_OFFSETS_BPS[PRICE_OFFSETS_BPS.length - 1];
    const price = midPrice * (1 + offset / 10_000);
    out.push({
      // DeepBook v3's placeLimitOrder parses clientOrderId as a BigInt
      // (u128). The hyphen-separated `${nonce}-${i}` form we used to
      // emit was fine in simulated mode but threw "Cannot convert
      // {…}-{…} to a BigInt" the moment the wallet crossed the live
      // threshold. Encode the index as the last two digits of a pure
      // numeric id so each order in a plan stays unique while the
      // SDK can parse it.
      clientOrderId: `${baseNonce}${i.toString().padStart(2, "0")}`,
      price: Number(price.toFixed(6)),
      quantitySui: TEST_ORDER_SIZES_SUI[i],
      isBid: false, // sell SUI for DBUSDC — test asks
      offsetBps: offset,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mode selection (live vs simulated)
// ---------------------------------------------------------------------------

type ExecutionMode = "live" | "simulated";

type ModeDecision = {
  mode: ExecutionMode;
  /** SUI in the agent's wallet at decision time. */
  walletSui: number;
  /** Tradable SUI already free inside the BalanceManager (i.e. NOT
   *  locked under any resting order). */
  managerFreeSui: number;
  /** SUI we expect to recover by cancelling our resting orders on
   *  POOL_KEY in the same PTB before placing new ones. Each open order
   *  locks `TEST_ORDER_SIZES_SUI[i]` of base SUI; cancel_all_orders
   *  releases that collateral back into the manager's free balance
   *  inside the same atomic PTB, so it's available for the new orders. */
  recoverableSui: number;
  /** Number of existing open orders we'll cancel — non-zero means the
   *  PTB starts with a cancel_all_orders step. */
  openOrders: number;
  /** Fresh SUI we need to pull from the wallet into the manager. 0 when
   *  the manager's free + recoverable already covers the plan. */
  topupSui: number;
};

async function readManagerSui(dbCtx: DeepBookCtx): Promise<number> {
  // Best-effort — if the simulation fails (RPC blip, manager just
  // created and not indexed yet) we treat it as 0 so the agent errs on
  // the side of "deposit the plan and run live."
  try {
    const r = await dbCtx.db.checkManagerBalanceWithAddress(
      dbCtx.balanceManagerId,
      "SUI",
    );
    const b = Number(r.balance);
    return Number.isFinite(b) && b >= 0 ? b : 0;
  } catch (e) {
    console.warn(
      `[treasury] manager-balance check failed, treating as 0: ${(e as Error).message}`,
    );
    return 0;
  }
}

async function readOpenOrderCount(dbCtx: DeepBookCtx): Promise<number> {
  try {
    const orders = await dbCtx.db.accountOpenOrders(
      POOL_KEY,
      BALANCE_MANAGER_KEY,
    );
    if (Array.isArray(orders)) return orders.length;
    // The SDK occasionally returns a Set / iterable. Normalise.
    return Array.from(orders as Iterable<unknown>).length;
  } catch (e) {
    console.warn(
      `[treasury] open-orders check failed, treating as 0: ${(e as Error).message}`,
    );
    return 0;
  }
}

async function chooseMode(
  ctx: AgentContext,
  dbCtx: DeepBookCtx,
): Promise<ModeDecision> {
  const b = await ctx.client.getBalance({ owner: ctx.address });
  const walletSui = Number(b.totalBalance) / 1e9;
  const managerFreeSui = await readManagerSui(dbCtx);
  const openOrders = await readOpenOrderCount(dbCtx);
  // Each resting order from a prior run was sized 1 SUI (see
  // TEST_ORDER_SIZES_SUI). Cancelling them in the same PTB releases
  // that collateral *before* the new orders consume it — so it counts
  // toward what the manager can back this run. This is what lets a
  // single 3 SUI wallet top-up sustain many back-to-back live runs:
  // cancel + re-place recycles the same ~PLANNED_TOTAL_SUI of
  // collateral instead of paying a fresh deposit every time.
  const recoverableSui = Math.min(
    openOrders * TEST_ORDER_SIZES_SUI[0],
    PLANNED_TOTAL_SUI,
  );
  const effectiveManagerSui = managerFreeSui + recoverableSui;
  const topupSui = Math.max(0, PLANNED_TOTAL_SUI - effectiveManagerSui);
  const walletNeeded = topupSui + GAS_BUFFER_SUI;
  return {
    mode: walletSui >= walletNeeded ? "live" : "simulated",
    walletSui,
    managerFreeSui,
    recoverableSui,
    openOrders,
    topupSui,
  };
}

// ---------------------------------------------------------------------------
// Deliverable composition
// ---------------------------------------------------------------------------

type PostedOrderRecord = {
  client_order_id: string;
  price: number;
  quantity_sui: number;
  side: "ask" | "bid";
  offset_bps: number;
  status: "posted" | "simulated";
};

type TreasuryDeliverable = {
  task_title: string;
  primary_capability: string;
  spec_context: string;
  pool: {
    key: string;
    mid_price: number;
    price_source: "deepbook" | "fallback";
  };
  orders: PostedOrderRecord[];
  analysis: {
    estimated_depth_sui: number;
    disbursement_recommendation: string;
  };
  metadata: {
    produced_by: string;
    produced_at_ms: number;
    schema_version: number;
    mode: ExecutionMode;
    deposit_sui: number;
    balance_manager: string;
  };
};

function composeDeliverable(args: {
  notice: TaskPostedNotice;
  spec: { context?: string };
  midPrice: number;
  priceSource: "deepbook" | "fallback";
  plan: OrderPlan[];
  mode: ExecutionMode;
  topupSui: number;
  managerSui: number;
  balanceManagerId: string;
  agentAddress: string;
}): TreasuryDeliverable {
  const totalSize = args.plan.reduce((a, p) => a + p.quantitySui, 0);
  const recommendation =
    args.mode === "live"
      ? `Posted ${args.plan.length} live ask${args.plan.length === 1 ? "" : "s"} totalling ${totalSize.toFixed(2)} SUI at +${PRICE_OFFSETS_BPS.join("/")}bps over mid. Recommended initial disbursement tranche size: ${totalSize.toFixed(2)} SUI; if all fill, ladder by ${totalSize.toFixed(2)} SUI per hour over the disbursement window.`
      : `Simulated test orders (wallet couldn't cover the ${PLANNED_TOTAL_SUI.toFixed(2)} SUI plan + gas). Recommended initial disbursement tranche size: ${totalSize.toFixed(2)} SUI based on hardcoded reference price; re-run in live mode after wallet top-up to validate against real DeepBook depth.`;

  return {
    task_title: args.notice.title,
    primary_capability: args.notice.primaryCapability,
    spec_context: args.spec.context ?? "(no context provided in spec)",
    pool: {
      key: POOL_KEY,
      mid_price: args.midPrice,
      price_source: args.priceSource,
    },
    orders: args.plan.map((p) => ({
      client_order_id: p.clientOrderId,
      price: p.price,
      quantity_sui: p.quantitySui,
      side: p.isBid ? "bid" : "ask",
      offset_bps: p.offsetBps,
      status: args.mode === "live" ? "posted" : "simulated",
    })),
    analysis: {
      estimated_depth_sui: totalSize,
      disbursement_recommendation: recommendation,
    },
    metadata: {
      produced_by: args.agentAddress,
      produced_at_ms: Date.now(),
      schema_version: Number(SCHEMA_VERSION),
      mode: args.mode,
      // Only the fresh SUI we pulled from the wallet on *this* delivery.
      // The full collateral backing the orders is topup + already-on-deposit
      // (= PLANNED_TOTAL_SUI in live mode).
      deposit_sui: args.mode === "live" ? args.topupSui : 0,
      balance_manager: args.balanceManagerId,
    },
  };
}

// ---------------------------------------------------------------------------
// Spec parsing (light — Treasury's instructions live in the agent itself)
// ---------------------------------------------------------------------------

type TreasurySpec = {
  context?: string;
  action?: string;
};

function parseSpec(specBlob: string): TreasurySpec {
  const trimmed = specBlob.trim();
  if (trimmed.length === 0) return {};
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as TreasurySpec;
    } catch {
      return { context: trimmed };
    }
  }
  return { context: trimmed };
}

// ---------------------------------------------------------------------------
// Main task handler
// ---------------------------------------------------------------------------

async function handleTask(
  ctx: AgentContext,
  dbCtx: DeepBookCtx,
  notice: TaskPostedNotice,
): Promise<void> {
  console.log(
    `[treasury] task ${notice.taskId.slice(0, 12)}… "${notice.title}" bounty=${(Number(notice.bountyAmount) / 1e9).toFixed(3)} SUI`,
  );

  const t = await fetchTask(ctx, notice.taskId);
  if (t.status === "delivered" || t.status === "approved" || t.status === "expired") {
    console.log(`[treasury] task already ${t.status}, skipping`);
    return;
  }

  // ---- 1) Accept (or resume if previously accepted by this wallet) -------
  if (t.status === "open") {
    console.log("[treasury] accepting…");
    const acceptRes = await signAndExecuteWithRetry(
      ctx,
      () => buildAcceptTaskTx(ctx, notice.taskId),
      { showEffects: true },
      {
        label: "treasury:accept",
        attempts: 3,
        alreadyDone: async () => {
          try {
            const cur = await fetchTask(ctx, notice.taskId);
            if (
              cur.status === "accepted" &&
              cur.assignedTo.toLowerCase() === ctx.address.toLowerCase()
            ) {
              return "done";
            }
            if (cur.status === "delivered" || cur.status === "approved") {
              return "done";
            }
          } catch {
            /* fall through */
          }
          return null;
        },
      },
    );
    if (acceptRes.effects?.status?.status !== "success") {
      throw new Error(
        `accept failed: ${acceptRes.effects?.status?.error ?? "unknown"}`,
      );
    }
  } else if (
    t.status === "accepted" &&
    t.assignedTo.toLowerCase() === ctx.address.toLowerCase()
  ) {
    console.log(
      "[treasury] task already accepted by this wallet — resuming to deliver",
    );
  } else {
    console.log(
      `[treasury] task in unexpected state ${t.status} (assigned to ${t.assignedTo.slice(0, 10)}…), skipping`,
    );
    return;
  }

  // ---- 2) Snapshot pool mid + choose mode --------------------------------
  // Live mode is decided on funds *available to the manager* (wallet +
  // free balance + collateral we'll recover by cancelling our resting
  // orders in the same PTB), not the wallet alone. This is what lets a
  // single 3 SUI wallet top-up back many back-to-back live deliveries:
  // each run cancels the prior orders, releases that ~2 SUI of locked
  // collateral, and re-uses it for the new orders instead of paying a
  // fresh deposit.
  const decision = await chooseMode(ctx, dbCtx);
  const {
    mode,
    walletSui,
    managerFreeSui,
    recoverableSui,
    openOrders,
    topupSui,
  } = decision;
  console.log(
    `[treasury] mode=${mode} (wallet ${walletSui.toFixed(3)} SUI · manager free ${managerFreeSui.toFixed(3)} SUI · ${openOrders} resting orders → recoverable ${recoverableSui.toFixed(3)} SUI · planned ${PLANNED_TOTAL_SUI.toFixed(2)} SUI · topup ${topupSui.toFixed(3)} SUI · gas buffer ${GAS_BUFFER_SUI.toFixed(2)})`,
  );

  const midPrice = await readMidPrice(dbCtx);
  const priceSource: "deepbook" | "fallback" =
    midPrice === FALLBACK_MID_PRICE ? "fallback" : "deepbook";
  const plan = composeOrderPlan(midPrice, Date.now());

  const spec = parseSpec(t.specBlob);

  console.log(
    `[treasury] mid=${midPrice.toFixed(6)} source=${priceSource} planned_orders=${plan.length}`,
  );
  for (const p of plan) {
    console.log(
      `  · ${p.isBid ? "bid" : "ask"} ${p.quantitySui} SUI @ ${p.price.toFixed(6)} (+${p.offsetBps}bps) coid=${p.clientOrderId}`,
    );
  }

  // ---- 3) Build the atomic delivery PTB ----------------------------------
  // The deliverable is composed once (with the wall-clock metadata it
  // carries) and the inlinePayload is reused; only the Transaction
  // object is rebuilt on each retry so a coin-race retry picks up
  // fresh gas without altering the on-chain effects.
  const deliverable = composeDeliverable({
    notice,
    spec,
    midPrice,
    priceSource,
    plan,
    mode,
    topupSui,
    managerSui: managerFreeSui,
    balanceManagerId: dbCtx.balanceManagerId,
    agentAddress: ctx.address,
  });
  const inlinePayload = new TextEncoder().encode(JSON.stringify(deliverable));

  function buildTreasuryDeliverTx(): Transaction {
    const tx = new Transaction();
    if (mode === "live") {
      // Optional cancel: if we already have resting orders on this pool
      // from a previous delivery, cancel them first. cancel_all_orders
      // releases the locked collateral back into the manager's free
      // balance *inside this PTB* — the new orders below then consume
      // that recovered balance instead of waiting for a fresh deposit.
      if (openOrders > 0) {
        dbCtx.db.deepBook.cancelAllOrders(
          POOL_KEY,
          BALANCE_MANAGER_KEY,
        )(tx);
      }
      // Conditional top-up: only deposit the shortfall the manager
      // needs to back the planned orders. When recoverable + free
      // already cover the plan we skip the deposit entirely. This is
      // what stops the wallet self-draining below the live threshold.
      if (topupSui > 0) {
        dbCtx.db.balanceManager.depositIntoManager(
          BALANCE_MANAGER_KEY,
          "SUI",
          topupSui,
        )(tx);
      }
      for (const p of plan) {
        dbCtx.db.deepBook.placeLimitOrder({
          poolKey: POOL_KEY,
          balanceManagerKey: BALANCE_MANAGER_KEY,
          clientOrderId: p.clientOrderId,
          price: p.price,
          quantity: p.quantitySui,
          isBid: p.isBid,
          orderType: OrderType.POST_ONLY,
          selfMatchingOption: SelfMatchingOptions.SELF_MATCHING_ALLOWED,
          payWithDeep: false,
        })(tx);
      }
    }
    appendMintAndSubmit(tx, ctx, {
      taskId: notice.taskId,
      deliverableOwner: notice.poster,
      schemaVersion: SCHEMA_VERSION,
      inlinePayload,
      walrusBlobId: null,
      paymentAmount: 0n,
    });
    return tx;
  }

  console.log(
    `[treasury] submitting atomic PTB (mode=${mode}, ${plan.length} order${plan.length === 1 ? "" : "s"} + mint + submit)…`,
  );
  const submitRes = await signAndExecuteWithRetry(
    ctx,
    buildTreasuryDeliverTx,
    {
      showEffects: true,
      showObjectChanges: true,
      showEvents: true,
      showBalanceChanges: true,
    },
    {
      label: "treasury:submit",
      attempts: 3,
      // Idempotency: a retryable error after a successful submit
      // means the task is already DELIVERED. Re-executing the
      // mint+submit PTB would abort EWrongStatus on the submit step
      // (Run #3 of P6 hit this). Detect and short-circuit.
      alreadyDone: async () => {
        try {
          const cur = await fetchTask(ctx, notice.taskId);
          if (
            (cur.status === "delivered" || cur.status === "approved") &&
            cur.deliverableId
          ) {
            return "done";
          }
        } catch {
          /* fall through */
        }
        return null;
      },
    },
  );

  if (submitRes.effects?.status?.status !== "success") {
    throw new Error(
      `delivery PTB failed: ${submitRes.effects?.status?.error ?? "unknown"}`,
    );
  }

  console.log(
    `[treasury] delivered. tx=${submitRes.digest} mode=${mode} task=${notice.taskId.slice(0, 12)}…`,
  );

  // Surface DeepBook OrderPlaced events for the logs (best-effort).
  if (mode === "live") {
    const events = (submitRes.events ?? []) as Array<{
      type: string;
      parsedJson?: Record<string, unknown>;
    }>;
    const placed = events.filter((e) => e.type.endsWith("::OrderPlaced"));
    for (const ev of placed) {
      console.log(
        `[treasury] OrderPlaced: ${JSON.stringify(ev.parsedJson ?? {}).slice(0, 200)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const env = loadEnv();
  // Multi-wallet mode: signs as TREASURY_SECRET_KEY when present; falls
  // back to AGENT_SECRET_KEY with a DEGRADED warning when not. The boot
  // address determines which AgentRegistration is created/augmented, so
  // reputation accrues to the treasury wallet specifically.
  const ctx = makeAgentContextFor(env, "treasury");
  const balanceManagerId = process.env.BRIEF_BALANCE_MANAGER_ID;
  if (!balanceManagerId || !balanceManagerId.startsWith("0x")) {
    throw new Error(
      "BRIEF_BALANCE_MANAGER_ID is required in .env.local (the DeepBook BalanceManager object id)",
    );
  }

  console.log(
    `[treasury] booting · pkg=${ctx.packageId.slice(0, 10)}… address=${ctx.address}… manager=${balanceManagerId.slice(0, 10)}…`,
  );

  const reg = await augmentRegistration(ctx, {
    displayName: "Treasury Agent",
    capabilities: ["treasury"],
    acceptsObjectTypes: ["Task"],
    producesObjectTypes: ["Deliverable"],
    basePricePerCall: 3_000_000_000n,
    endpointUrl: "",
    bioBlob: "",
  });
  console.log(
    `[treasury] active · reg=${reg.id.slice(0, 10)}… capabilities=[${reg.capabilities.join(", ")}]`,
  );

  const dbCtx = makeDeepBookCtx(ctx, balanceManagerId);

  // Self-healing: re-process any task this wallet accepted but never
  // submitted. Runs BEFORE the inbox.
  await recoverStuckTasks(ctx, {
    capabilityFilter: "treasury",
    label: "treasury-recovery",
    onTask: (notice) => handleTask(ctx, dbCtx, notice),
  });

  await startTaskInbox({
    ctx,
    cursorPath: CURSOR_PATH,
    pollMs: POLL_MS,
    assignedToFilter: ctx.address,
    capabilityFilter: "treasury",
    label: "treasury-inbox",
    onTask: async (notice) => {
      try {
        await handleTask(ctx, dbCtx, notice);
      } catch (e) {
        console.error(
          `[treasury] task ${notice.taskId.slice(0, 10)}… handler failed:`,
          (e as Error)?.message ?? e,
        );
      }
    },
  });
}

main().catch((e) => {
  console.error("[treasury] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
