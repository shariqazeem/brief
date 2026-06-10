// Trader's DeepBook spot-bet handler.
//
// Flow per task:
//   1. Read the asset's pool mid price (devInspect on pool::mid_price)
//   2. Decide direction (existing strategy gives up/down)
//   3. Compute notional (baseQty * mid → dUSDC base) → recordSpendAmount
//   4. Build + submit atomic PTB:
//        [A] operator_policy::record_spend(policy, amount, "spot-{asset}", clock)
//        [B] pool::place_market_order(pool, bm, proof, qty, isBid, …)
//   5. Append a SpotPosition to the durable cursor (closeAtMs = now + horizon)
//   6. Return the open digest + sub-state for deliverable composition
//
// The trader's existing redemption loop is extended (separately) to scan
// `dueSpotPositions(now)` and call `closeSpotPosition` when each horizon
// elapses. Close has no policy gate — closes must survive a revoke.

import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";

import type { AgentContext } from "../../lib/sui.js";
import {
  buildCloseSpotTx,
  buildOpenSpotTx,
  readBmAssetBalance,
} from "../lib/deepbook-spot.js";
import type { MarketSpec } from "../lib/markets.js";

const DEEPBOOK_PACKAGE_ID =
  "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c";

/** Default close horizon — short enough to settle within a demo, long
 *  enough to capture meaningful price drift. */
export const DEFAULT_SPOT_HORIZON_MS = 60 * 60 * 1000; // 1h

/** Read pool mid via devInspect. Returns mid in quote/base human units
 *  (e.g. 0.74 DBUSDC per SUI). */
export async function readSpotMid(
  ctx: AgentContext,
  market: MarketSpec,
): Promise<number> {
  if (!market.spotPoolId || !market.baseCoinType || !market.quoteCoinType) {
    throw new Error(`readSpotMid: ${market.asset} missing spot config`);
  }
  const tx = new Transaction();
  tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::pool::mid_price`,
    arguments: [tx.object(market.spotPoolId), tx.object(SUI_CLOCK_OBJECT_ID)],
    typeArguments: [market.baseCoinType, market.quoteCoinType],
  });
  const r = await ctx.client.devInspectTransactionBlock({
    sender: ctx.address,
    transactionBlock: tx,
  });
  const ret = r.results?.[0]?.returnValues?.[0];
  if (!ret) throw new Error("readSpotMid: no return");
  const raw = BigInt(bcs.U64.parse(Uint8Array.from(ret[0])));
  // SDK formula: adjusted = raw * baseScalar / quoteScalar / FLOAT_SCALAR
  // FLOAT_SCALAR = 1e9
  const baseScalar = market.baseScalar ?? 1;
  const quoteScalar = market.quoteScalar ?? 1;
  return Number(raw) * baseScalar / quoteScalar / 1e9;
}

export type OpenSpotResult = {
  digest: string;
  midPrice: number;
  baseQty: number;
  /** Quote received (DOWN) or spent (UP), in quote base units. */
  quoteBase: bigint;
};

/** Run the atomic policy-gated open. Returns digest + economics. */
export async function openSpot(args: {
  ctx: AgentContext;
  market: MarketSpec;
  direction: "up" | "down";
  briefPackage: string;
  policyId: string;
  balanceManagerId: string;
}): Promise<OpenSpotResult> {
  const { ctx, market, direction, briefPackage, policyId, balanceManagerId } = args;
  if (!market.minOrderQty || !market.quoteScalar) {
    throw new Error(`openSpot: ${market.asset} missing minOrderQty / quoteScalar`);
  }
  const mid = await readSpotMid(ctx, market);
  const baseQty = market.minOrderQty;
  const notionalQuote = baseQty * mid;
  // record_spend amount is denominated in the same 9-decimal MIST-equivalent
  // as the BTC path: the policy budget caps a single $ envelope across all
  // assets. notionalQuote is in dollars; multiply by 1e9 for SUI-equivalent
  // unit so the policy's spent counter is comparable across venues.
  const recordSpendAmount = BigInt(Math.floor(notionalQuote * 1e9));
  const tx = buildOpenSpotTx(ctx, {
    market,
    direction,
    baseQty,
    briefPackage,
    policyId,
    venue: `spot-${market.asset.toLowerCase()}`,
    recordSpendAmount,
    balanceManagerId,
  });

  // Capture pre-state for quote-delta computation.
  const preQuoteBase = await readBmAssetBalance(
    ctx,
    balanceManagerId,
    market.quoteCoinType!,
  );

  const res = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });
  if (res.effects?.status?.status !== "success") {
    throw new Error(`openSpot: ${res.effects?.status?.error ?? "unknown"}`);
  }
  const postQuoteBase = await readBmAssetBalance(
    ctx,
    balanceManagerId,
    market.quoteCoinType!,
  );
  // For DOWN (sell base, receive quote): quote went up → delta is the
  // proceeds received. For UP (buy base, spend quote): quote went down →
  // delta is the cost paid (sign matters for P&L later).
  const quoteBase =
    direction === "down" ? postQuoteBase - preQuoteBase : preQuoteBase - postQuoteBase;

  return { digest: res.digest, midPrice: mid, baseQty, quoteBase };
}

export type CloseSpotResult = {
  digest: string;
  closeQuoteBase: bigint;
  realizedPnlBase: bigint;
};

/** Close a spot position by running the opposite-side market order.
 *  No policy gate — closes must succeed even after revoke. */
export async function closeSpot(args: {
  ctx: AgentContext;
  market: MarketSpec;
  originalDirection: "up" | "down";
  baseQty: number;
  /** Quote delta from the original open, used to compute realized P&L. */
  openQuoteBase: bigint;
  balanceManagerId: string;
}): Promise<CloseSpotResult> {
  const { ctx, market, originalDirection, baseQty, openQuoteBase, balanceManagerId } = args;
  const tx = buildCloseSpotTx(ctx, {
    market,
    originalDirection,
    baseQty,
    balanceManagerId,
  });
  const res = await ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });
  if (res.effects?.status?.status !== "success") {
    throw new Error(`closeSpot: ${res.effects?.status?.error ?? "unknown"}`);
  }
  // Parse the OrderFilled event for the exact quote_quantity — more
  // robust than diffing BM balance reads, which depend on a fragile
  // dynamic-field lookup that's been wrong for non-SUI coin types.
  const filled = (res.events ?? []).find((e: { type?: string }) =>
    String(e.type ?? "").endsWith("::OrderFilled"),
  );
  const closeQuoteBase = BigInt(
    ((filled as { parsedJson?: { quote_quantity?: string | number } })?.parsedJson?.quote_quantity) ?? 0,
  );

  // Realized P&L:
  //   UP   bet: pnl = closeProceeds - openCost     = closeQuoteBase - openQuoteBase
  //   DOWN bet: pnl = openProceeds  - closeCost    = openQuoteBase - closeQuoteBase
  const realizedPnlBase =
    originalDirection === "up"
      ? closeQuoteBase - openQuoteBase
      : openQuoteBase - closeQuoteBase;

  return { digest: res.digest, closeQuoteBase, realizedPnlBase };
}
