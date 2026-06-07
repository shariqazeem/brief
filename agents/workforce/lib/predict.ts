// Shared DeepBook Predict helpers — used by the Trader agent's task
// handler and its auto-redeem service.
//
// All identifiers are pinned to the `predict-testnet-4-16` branch of
// MystenLabs/deepbookv3 (the active testnet deployment). The on-chain
// move surface we use is verbatim from the Phase-2 spike:
//
//   public fun create_manager(ctx): ID
//   public fun mint<Quote>(predict, manager, oracle, key, quantity, clock, ctx)
//   public fun redeem_permissionless<Quote>(predict, manager, oracle, key, quantity, clock, ctx)
//   public fun market_key::new(oracle_id, expiry, strike, is_up): MarketKey
//   public fun oracle::spot_price(oracle): u64
//   public fun oracle::is_settled(oracle): bool
//
// Quote: dUSDC (6 decimals). Strike / spot / settlement scaled by 1e9.

import { Transaction } from "@mysten/sui/transactions";
import type { AgentContext } from "../../lib/sui.js";
import { bcs } from "@mysten/sui/bcs";

// === Constants ===

export const PREDICT_PACKAGE =
  "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";
export const PREDICT_OBJECT =
  "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";
export const DUSDC_TYPE =
  "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";
export const SUI_CLOCK_ID = "0x6";

export const INDEXER_BASE =
  process.env.PREDICT_INDEXER_URL ??
  "https://predict-server.testnet.mystenlabs.com";

/** 1e9 — both strike and spot/settlement are scaled by this. */
export const PRICE_SCALAR = 1_000_000_000;
/** dUSDC has 6 decimals; 1 dUSDC = 1_000_000 base units. */
export const DUSDC_DECIMALS = 6;
export const DUSDC_BASE = 1_000_000;

// === Indexer types + fetch ===

export type IndexerOracle = {
  predict_id: string;
  oracle_id: string;
  oracle_cap_id: string;
  underlying_asset: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  status: "active" | "settled" | "pending" | string;
  activated_at?: number;
  settlement_price?: number;
  settled_at?: number;
};

export async function fetchAllOracles(): Promise<IndexerOracle[]> {
  const r = await fetch(`${INDEXER_BASE}/oracles`);
  if (!r.ok) throw new Error(`indexer /oracles ${r.status}`);
  return (await r.json()) as IndexerOracle[];
}

/** Active BTC oracles, sorted by expiry ascending (nearest first). */
export async function fetchActiveBtcOracles(): Promise<IndexerOracle[]> {
  const xs = await fetchAllOracles();
  return xs
    .filter((x) => x.underlying_asset === "BTC" && x.status === "active")
    .sort((a, b) => a.expiry - b.expiry);
}

/** Recently-settled BTC oracles for historical strategy signal. */
export async function fetchRecentSettledBtcOracles(
  limit = 10,
): Promise<IndexerOracle[]> {
  const xs = await fetchAllOracles();
  return xs
    .filter((x) => x.underlying_asset === "BTC" && x.status === "settled")
    .sort((a, b) => (b.settled_at ?? 0) - (a.settled_at ?? 0))
    .slice(0, limit);
}

// === On-chain oracle reads via devInspect ===

/** Read the live spot price (in raw 1e9 units) for an oracle. */
export async function readOracleSpot(
  ctx: AgentContext,
  oracleId: string,
): Promise<bigint> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PREDICT_PACKAGE}::oracle::spot_price`,
    arguments: [tx.object(oracleId)],
  });
  const r = await ctx.client.devInspectTransactionBlock({
    sender: ctx.address,
    transactionBlock: tx,
  });
  const ret = r.results?.[0]?.returnValues?.[0];
  if (!ret) {
    throw new Error("devInspect oracle::spot_price returned no value");
  }
  const [bytes] = ret;
  return BigInt(bcs.U64.parse(Uint8Array.from(bytes)));
}

/** Read whether an oracle has frozen its settlement price. */
export async function readOracleIsSettled(
  ctx: AgentContext,
  oracleId: string,
): Promise<boolean> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PREDICT_PACKAGE}::oracle::is_settled`,
    arguments: [tx.object(oracleId)],
  });
  const r = await ctx.client.devInspectTransactionBlock({
    sender: ctx.address,
    transactionBlock: tx,
  });
  const ret = r.results?.[0]?.returnValues?.[0];
  if (!ret) throw new Error("devInspect oracle::is_settled returned no value");
  const [bytes] = ret;
  return bcs.Bool.parse(Uint8Array.from(bytes));
}

// === Manager balance ===

/** Read the manager's dUSDC balance via the predict_manager::balance accessor. */
export async function readManagerDusdcBalance(
  ctx: AgentContext,
  managerId: string,
): Promise<bigint> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PREDICT_PACKAGE}::predict_manager::balance`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId)],
  });
  try {
    const r = await ctx.client.devInspectTransactionBlock({
      sender: ctx.address,
      transactionBlock: tx,
    });
    const ret = r.results?.[0]?.returnValues?.[0];
    if (!ret) return 0n;
    return BigInt(bcs.U64.parse(Uint8Array.from(ret[0])));
  } catch {
    return 0n;
  }
}

/** Strike helpers — round a spot price to the nearest valid tick within
 *  the oracle's grid. min_strike + tick * k for some k ∈ [0, 100_000]. */
export function nearestTickStrike(
  spot: bigint,
  minStrike: bigint,
  tickSize: bigint,
): bigint {
  if (spot <= minStrike) return minStrike;
  const offset = spot - minStrike;
  const ticks = (offset + tickSize / 2n) / tickSize;
  return minStrike + ticks * tickSize;
}

// === PTB builders ===

export type GatedMintArgs = {
  briefPackage: string;
  policyId: string;
  venue: string;
  managerId: string;
  oracleId: string;
  expiryMs: number;
  strike: bigint;
  isUp: boolean;
  quantity: bigint;
  /** Amount (in 1 = $1 nominal units) to bill against the policy budget.
   *  The policy budget is denominated in MIST (1e9) so the trader
   *  records `cost_dusdc_base * 1000` to convert from 6-decimal dUSDC
   *  to 9-decimal SUI-equivalent. Caller decides the mapping. */
  recordSpendAmount: bigint;
};

/** Build the atomic policy-gated mint PTB:
 *    [A] operator_policy::record_spend(policy, amount, venue, clock)
 *    [B] market_key::new(oracle_id, expiry, strike, is_up)
 *    [C] predict::mint<DUSDC>(predict, manager, oracle, key, quantity, clock)
 *  A revoked / expired / over-budget policy aborts at (A) and (C) never
 *  runs. That's the kill switch on the trade. */
export function buildGatedMintTx(args: GatedMintArgs): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${args.briefPackage}::operator_policy::record_spend`,
    arguments: [
      tx.object(args.policyId),
      tx.pure.u64(args.recordSpendAmount),
      tx.pure.string(args.venue),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  const key = tx.moveCall({
    target: `${PREDICT_PACKAGE}::market_key::new`,
    arguments: [
      tx.pure.id(args.oracleId),
      tx.pure.u64(args.expiryMs),
      tx.pure.u64(args.strike),
      tx.pure.bool(args.isUp),
    ],
  });
  tx.moveCall({
    target: `${PREDICT_PACKAGE}::predict::mint`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_OBJECT),
      tx.object(args.managerId),
      tx.object(args.oracleId),
      key,
      tx.pure.u64(args.quantity),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  return tx;
}

/** Build the permissionless redeem PTB. No policy gate — permissionless
 *  redeem must work even after the policy is revoked (the kill switch
 *  blocks new mints, not the user's right to claim what was already won). */
export function buildRedeemPermissionlessTx(args: {
  managerId: string;
  oracleId: string;
  expiryMs: number;
  strike: bigint;
  isUp: boolean;
  quantity: bigint;
}): Transaction {
  const tx = new Transaction();
  const key = tx.moveCall({
    target: `${PREDICT_PACKAGE}::market_key::new`,
    arguments: [
      tx.pure.id(args.oracleId),
      tx.pure.u64(args.expiryMs),
      tx.pure.u64(args.strike),
      tx.pure.bool(args.isUp),
    ],
  });
  tx.moveCall({
    target: `${PREDICT_PACKAGE}::predict::redeem_permissionless`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_OBJECT),
      tx.object(args.managerId),
      tx.object(args.oracleId),
      key,
      tx.pure.u64(args.quantity),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  return tx;
}

/** Build the manager creation PTB: predict::create_manager(ctx). */
export function buildCreateManagerTx(): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PREDICT_PACKAGE}::predict::create_manager`,
    arguments: [],
  });
  return tx;
}
