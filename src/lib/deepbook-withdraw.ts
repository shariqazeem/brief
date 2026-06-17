// Non-custodial WITHDRAW — the owner pulls their funds back out of the
// BalanceManager, any time, in one signature.
//
// DeepBook's `balance_manager::withdraw_all<T>` is OWNER-GATED: it calls
// `generate_proof_as_owner`, which asserts the signer is the BM owner (the
// user). The operator only ever held a TradeCap/DepositCap, so it can never
// build this proof — withdrawal is the user's alone. `withdraw_all` is safe on
// a zero balance (it returns an empty coin), so we sweep quote + SUI + DEEP in
// one tx and send everything home.

import { Transaction } from "@mysten/sui/transactions";
import { testnetCoins, mainnetCoins } from "@mysten/deepbook-v3";

import { DEEPBOOK_CFG, type DeepBookNetwork } from "./deepbook-adopt";

/** The coin types held in a gated-spot BalanceManager, by network. The quote
 *  matches exactly what was deposited (DEEPBOOK_CFG.capitalCoinType). */
export function withdrawCoinTypes(network: DeepBookNetwork): string[] {
  const coins = network === "mainnet" ? mainnetCoins : testnetCoins;
  return [
    DEEPBOOK_CFG[network].capitalCoinType, // USDC (mainnet) / DBUSDC (testnet)
    coins.SUI.type,
    coins.DEEP.type,
  ];
}

export type WithdrawArgs = {
  network: DeepBookNetwork;
  /** The user's BalanceManager (shared object). */
  bmId: string;
  /** Where the coins go — the owner's wallet (must equal the BM owner / signer). */
  owner: string;
};

/**
 * Append an owner-gated full withdrawal to `tx`: sweep quote + SUI + DEEP out
 * of the BalanceManager and transfer all of it to the owner. Must be signed by
 * the BM owner; the operator cannot produce this (no owner proof).
 */
export function buildWithdrawAllTx(tx: Transaction, args: WithdrawArgs): void {
  const deepbook = DEEPBOOK_CFG[args.network].deepbook;
  const coins = withdrawCoinTypes(args.network).map((coinType) =>
    tx.moveCall({
      target: `${deepbook}::balance_manager::withdraw_all`,
      typeArguments: [coinType],
      arguments: [tx.object(args.bmId)],
    }),
  );
  tx.transferObjects(coins, tx.pure.address(args.owner));
}
