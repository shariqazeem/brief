// DeepBook non-custodial adoption — the mainnet spot path.
//
// One signature: create the user's own BalanceManager → deposit their
// capital (USDC on mainnet) → mint a TradeCap and delegate it to the
// operator → create the chain-enforced OperatorPolicy (agent = operator).
//
// After this tx the user OWNS the BalanceManager (owner-gated withdraw —
// custody never leaves), the operator holds only a TradeCap (trade, never
// withdraw), and `gated_spot`/record_spend enforce the budget on every
// trade. Proven end-to-end on testnet (adoption tx Gg8TaL4p…, gated fill
// 5TxLMUA7…). This module promotes that proven PTB into the product.
//
// The testnet DeepBook Predict path (buildActivateTx) is untouched and
// remains the fallback; this is the parallel mainnet spot path.

import { Transaction, type TransactionObjectArgument } from "@mysten/sui/transactions";

export type DeepBookNetwork = "mainnet" | "testnet";

type NetCfg = {
  /** DeepBook v3 published package id (from @mysten/deepbook-v3 constants). */
  deepbook: string;
  /** The capital coin the operator trades: real USDC on mainnet, DBUSDC on testnet. */
  capitalCoinType: string;
  /** Spot pools the operator is allowed to play (policy venues map to these). */
  spotVenues: string[];
};

// Verified against @mysten/deepbook-v3 constants (testnet confirmed live in
// the spike). Re-verify the mainnet package id immediately before the
// mainnet publish — DeepBook upgrades its package id on version bumps.
export const DEEPBOOK_CFG: Record<DeepBookNetwork, NetCfg> = {
  testnet: {
    deepbook: "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c",
    capitalCoinType: "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
    spotVenues: ["spot-sui", "spot-wal", "spot-deep"],
  },
  mainnet: {
    deepbook: "0xf48222c4e057fa468baf136bff8e12504209d43850c5778f76159292a96f621e",
    capitalCoinType: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    spotVenues: ["spot-sui", "spot-wal", "spot-deep"],
  },
};

export type AdoptArgs = {
  network: DeepBookNetwork;
  /** Brief package id for this network (testnet 0xe550…; mainnet set after publish). */
  briefPackageId: string;
  /** The operator (Treasury) wallet that receives the TradeCap + becomes policy.agent. */
  operator: string;
  /** A coin argument of `capitalCoinType` to deposit (caller splits it from the user's USDC). */
  capitalCoin: TransactionObjectArgument;
  name: string;
  /** Policy budget cap (in the policy's accounting units). */
  budgetCap: bigint;
  /** Policy expiry, ms since epoch. */
  expiresAtMs: bigint;
  maxConcentrationBps?: number;
  riskTolerance?: string;
};

/**
 * Append the non-custodial adoption to `tx`. One signature mints the
 * BalanceManager, deposits the capital, delegates a TradeCap to the
 * operator, and creates the OperatorPolicy. Mirrors the proven spike.
 */
export function buildAdoptTx(tx: Transaction, args: AdoptArgs): void {
  const cfg = DEEPBOOK_CFG[args.network];
  const bmType = `${cfg.deepbook}::balance_manager::BalanceManager`;
  const tradeCapType = `${cfg.deepbook}::balance_manager::TradeCap`;

  // 1) the user's own BalanceManager
  const bm = tx.moveCall({ target: `${cfg.deepbook}::balance_manager::new` });
  // 2) deposit the capital into it
  tx.moveCall({
    target: `${cfg.deepbook}::balance_manager::deposit`,
    typeArguments: [cfg.capitalCoinType],
    arguments: [bm, args.capitalCoin],
  });
  // 3) mint a TradeCap (owner-only) to delegate
  const tradeCap = tx.moveCall({
    target: `${cfg.deepbook}::balance_manager::mint_trade_cap`,
    arguments: [bm],
  });
  // 4) share the BalanceManager — owner field stays = the user (custody kept)
  tx.moveCall({
    target: `0x2::transfer::public_share_object`,
    typeArguments: [bmType],
    arguments: [bm],
  });
  // 5) delegate the TradeCap to the operator (trade-not-withdraw)
  tx.moveCall({
    target: `0x2::transfer::public_transfer`,
    typeArguments: [tradeCapType],
    arguments: [tradeCap, tx.pure.address(args.operator)],
  });
  // 6) create the chain-enforced policy (agent = operator); shares it
  tx.moveCall({
    target: `${args.briefPackageId}::operator_policy::create`,
    arguments: [
      tx.pure.address(args.operator),
      tx.pure.string(args.name),
      tx.pure.u64(args.budgetCap),
      tx.pure.vector("string", cfg.spotVenues),
      tx.pure.u16(args.maxConcentrationBps ?? 3000),
      tx.pure.u64(args.expiresAtMs),
      tx.pure.u8(0),
      tx.pure.string(args.riskTolerance ?? "medium"),
      tx.object("0x6"),
    ],
  });
}
