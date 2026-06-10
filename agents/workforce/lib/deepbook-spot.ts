// DeepBook v3 spot directional-bet helpers.
//
// Trader-level usage:
//   - `openSpotPosition`  — atomic PTB:
//       [A] operator_policy::record_spend(policy, amount, venue, clock)
//       [B] pool::place_market_order(pool, bm, proof, ...)
//     Direction maps to `isBid` on the pool:
//       UP   = isBid=true  (buy base with quote)   — long the asset
//       DOWN = isBid=false (sell base for quote)    — short the asset
//
//   - `closeSpotPosition` — single-leg PTB that runs the opposite market
//     order to realize P&L. No policy gate: the close must survive a
//     revoke (mirrors `predict::redeem_permissionless`).
//
//   - `readBmAssetBalance` — durable BM-balance inspection so the trader
//     can compute realized P&L (closing-quote - opening-quote) from
//     on-chain deltas rather than trusting any cached state.
//
// Inventory model: the Treasury BalanceManager (`balanceManagerId`)
// stores both base and quote inventories. UP bets debit quote; DOWN bets
// debit base. The trader rebalances inventory periodically (or the
// human operator seeds it). All bets are real on-chain trades; no
// fabricated positions.

import { Transaction } from "@mysten/sui/transactions";
import {
  DeepBookClient,
  testnetCoins,
  testnetPools,
} from "@mysten/deepbook-v3";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";

import type { AgentContext } from "../../lib/sui.js";
import type { MarketSpec } from "./markets.js";

// One canonical key for the agent's BM in the SDK's local registry.
const BM_KEY = "TBM";

/** Build a DeepBookClient bound to the agent's BalanceManager. The agent
 *  uses the same `ctx.client` so RPC rotation + retries work end-to-end.
 */
export function makeDeepBook(
  ctx: AgentContext,
  balanceManagerId: string,
): DeepBookClient {
  return new DeepBookClient({
    client: ctx.client as unknown as ConstructorParameters<typeof DeepBookClient>[0]["client"],
    address: ctx.address,
    network: "testnet",
    coins: testnetCoins,
    pools: testnetPools,
    balanceManagers: { [BM_KEY]: { address: balanceManagerId } },
  });
}

/** A directional bet's args. `direction` is the human framing; the
 *  helper maps it to the right `isBid` for the asset's pool. */
export type OpenSpotArgs = {
  market: MarketSpec;
  direction: "up" | "down";
  /** Base quantity, in human units (e.g. 1.0 SUI). */
  baseQty: number;
  briefPackage: string;
  policyId: string;
  venue: string; // e.g. "spot-sui" (what record_spend asserts against)
  /** Notional-equivalent in 9-decimal units to debit from the policy
   *  budget. The trader computes this from baseQty * mid * 1e9. */
  recordSpendAmount: bigint;
  balanceManagerId: string;
};

/** Build the open PTB. Policy is checked first; if revoked/over-budget
 *  the market order never executes. */
export function buildOpenSpotTx(
  ctx: AgentContext,
  args: OpenSpotArgs,
): Transaction {
  if (args.market.venue !== "deepbook-spot") {
    throw new Error(`open: ${args.market.asset} is not a spot market`);
  }
  if (!args.market.spotPoolKey) {
    throw new Error(`open: ${args.market.asset} missing spotPoolKey`);
  }
  const db = makeDeepBook(ctx, args.balanceManagerId);
  const tx = new Transaction();
  // [A] Policy gate — aborts EPolicyRevoked / over-budget before the trade.
  tx.moveCall({
    target: `${args.briefPackage}::operator_policy::record_spend`,
    arguments: [
      tx.object(args.policyId),
      tx.pure.u64(args.recordSpendAmount),
      tx.pure.string(args.venue),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  // [B] Market order. UP = buy base; DOWN = sell base.
  const isBid = args.direction === "up";
  tx.add(
    db.deepBook.placeMarketOrder({
      poolKey: args.market.spotPoolKey,
      balanceManagerKey: BM_KEY,
      clientOrderId: String(Date.now()),
      quantity: args.baseQty,
      isBid,
      payWithDeep: false,
    }) as unknown as Parameters<Transaction["add"]>[0],
  );
  return tx;
}

/** Args to close a previously-opened spot bet. The close runs the
 *  OPPOSITE side of the original bet at the current market price. */
export type CloseSpotArgs = {
  market: MarketSpec;
  /** Was the original bet UP or DOWN? Close runs the opposite side. */
  originalDirection: "up" | "down";
  /** Base quantity to close — same as what was opened. */
  baseQty: number;
  balanceManagerId: string;
};

/** Build the close PTB. No policy gate — closes must work after revoke
 *  (the kill switch blocks NEW bets, not the user's right to realize
 *  what's already on the book). */
export function buildCloseSpotTx(
  ctx: AgentContext,
  args: CloseSpotArgs,
): Transaction {
  if (args.market.venue !== "deepbook-spot") {
    throw new Error(`close: ${args.market.asset} is not a spot market`);
  }
  if (!args.market.spotPoolKey) {
    throw new Error(`close: ${args.market.asset} missing spotPoolKey`);
  }
  const db = makeDeepBook(ctx, args.balanceManagerId);
  const tx = new Transaction();
  // Opposite side: UP bet opens as buy → close is sell; DOWN opens as
  // sell → close is buy.
  const isBid = args.originalDirection === "down";
  tx.add(
    db.deepBook.placeMarketOrder({
      poolKey: args.market.spotPoolKey,
      balanceManagerKey: BM_KEY,
      clientOrderId: String(Date.now() + 1),
      quantity: args.baseQty,
      isBid,
      payWithDeep: false,
    }) as unknown as Parameters<Transaction["add"]>[0],
  );
  return tx;
}

/** Read a coin balance inside the BalanceManager by walking the
 *  dynamic-field balances table. Used for boot-time reconciliation and
 *  realized-P&L computation. */
export async function readBmAssetBalance(
  ctx: AgentContext,
  balanceManagerId: string,
  coinType: string,
): Promise<bigint> {
  const bmObj = await ctx.client.getObject({
    id: balanceManagerId,
    options: { showContent: true },
  });
  const f = (bmObj.data?.content as { fields?: Record<string, unknown> })?.fields;
  const balances = (f?.balances as { fields?: { id?: { id?: string } } })?.fields;
  const tableId = balances?.id?.id;
  if (!tableId) return 0n;
  const dfs = await ctx.client.getDynamicFields({ parentId: tableId });
  // The dynamic field's `name.type` is the full BalanceKey<CoinType>; we
  // match on the inner coin type. Strip leading 0x0…0 padding so both
  // canonical and short forms match.
  const target = coinType.replace(/^0x0+/, "0x").toLowerCase();
  for (const d of dfs.data) {
    const t = String(d.name?.type ?? "").toLowerCase();
    if (t.includes(target.slice(2))) {
      const dfObj = await ctx.client.getDynamicFieldObject({
        parentId: tableId,
        name: d.name,
      });
      const dff = (dfObj.data?.content as { fields?: Record<string, unknown> })
        ?.fields;
      return BigInt((dff?.value as string | number | bigint) ?? 0);
    }
  }
  return 0n;
}
