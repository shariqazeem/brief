// Real DeepBook v3 execution path.
//
// Builds a PTB that deposits a small amount of SUI into the agent's
// BalanceManager and places a market sell-order on the SUI/DBUSDC pool.
// Fills are extracted from `balanceChanges` in the transaction result so
// we don't depend on the DeepBook event schema.

import { Transaction } from "@mysten/sui/transactions";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import {
  DeepBookClient,
  testnetCoins,
  testnetPools,
} from "@mysten/deepbook-v3";
import type { SimulatedFill } from "./simulated.js";

const POOL_KEY = "SUI_DBUSDC";
const BALANCE_MANAGER_KEY = "primary";

// Per-call sizes. Kept tiny so we don't burn the demo budget.
const DEPOSIT_SUI = 0.1;  // 0.1 SUI -> manager
const ORDER_QUANTITY_SUI = 0.05; // 0.05 SUI market-sold

export type DeepBookFill = SimulatedFill;

export type DeepBookContext = {
  db: DeepBookClient;
};

/**
 * Construct a DeepBookClient that knows about our BalanceManager so we can
 * reference it by key in deposit/order calls.
 */
export function makeDeepBookContext(
  sui: SuiJsonRpcClient,
  address: string,
  balanceManagerId: string,
): DeepBookContext {
  const db = new DeepBookClient({
    client: sui as unknown as ConstructorParameters<typeof DeepBookClient>[0]["client"],
    address,
    network: "testnet",
    coins: testnetCoins,
    pools: testnetPools,
    balanceManagers: {
      [BALANCE_MANAGER_KEY]: { address: balanceManagerId },
    },
  });
  return { db };
}

/**
 * Build a Transaction that:
 *   1. Deposits `DEPOSIT_SUI` worth of SUI into the BalanceManager
 *   2. Places a market sell-order on the SUI/DBUSDC pool
 *
 * The caller signs+executes the returned tx, then calls `parseDeepBookFills`
 * on the result to extract the swap details.
 */
export function buildDeepBookExecutionTx(
  ctx: DeepBookContext,
  _intent: { operations: { protocol: string; amount_pct: number }[] },
): Transaction {
  const tx = new Transaction();

  ctx.db.balanceManager.depositIntoManager(
    BALANCE_MANAGER_KEY,
    "SUI",
    DEPOSIT_SUI,
  )(tx);

  ctx.db.deepBook.placeMarketOrder({
    poolKey: POOL_KEY,
    balanceManagerKey: BALANCE_MANAGER_KEY,
    clientOrderId: Date.now().toString(),
    quantity: ORDER_QUANTITY_SUI,
    isBid: false, // sell base (SUI) for quote (DBUSDC)
    payWithDeep: false,
  })(tx);

  return tx;
}

/**
 * Extract simulated-fill-shaped data from a real DeepBook execution result.
 * Uses balanceChanges to detect the swap rather than parsing internal events.
 */
export function parseDeepBookFills(
  result: { balanceChanges?: unknown },
  ownerAddress: string,
): DeepBookFill[] {
  const changes = (result.balanceChanges ?? []) as Array<{
    owner: unknown;
    coinType: string;
    amount: string;
  }>;

  let suiSpent = 0;
  let usdcReceived = 0;

  for (const bc of changes) {
    const owner = bc.owner;
    const ownerAddr =
      typeof owner === "object" && owner !== null && "AddressOwner" in owner
        ? (owner as { AddressOwner: string }).AddressOwner
        : null;
    if (ownerAddr !== ownerAddress) continue;
    const amount = Number(bc.amount);
    if (Number.isNaN(amount)) continue;

    if (bc.coinType === "0x2::sui::SUI") {
      // negative = SUI sent (gas + order base)
      if (amount < 0) suiSpent -= amount;
    } else if (
      bc.coinType.toLowerCase().includes("usdc") ||
      bc.coinType.toLowerCase().includes("dbusdc")
    ) {
      if (amount > 0) usdcReceived += amount;
    }
  }

  if (usdcReceived === 0 && suiSpent === 0) {
    return [];
  }

  // SUI: 9 decimals; DBUSDC testnet: 6 decimals
  const suiUnits = suiSpent / 1e9;
  const usdcUnits = usdcReceived / 1e6;
  const price = suiUnits > 0 ? usdcUnits / suiUnits : 0;

  return [
    {
      pool: "SUI/DBUSDC",
      side: "sell",
      in_amount: Number(suiUnits.toFixed(6)),
      out_amount: Number(usdcUnits.toFixed(6)),
      price: Number(price.toFixed(6)),
    },
  ];
}
