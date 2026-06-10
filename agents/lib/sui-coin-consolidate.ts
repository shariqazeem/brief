// Pre-flight: keep the agent wallet's SUI coins consolidated into a
// single object. Several SDK paths (notably @mysten/walrus when paying
// for storage) auto-pick gas coins and abort with
// `0x2::balance::split, abortCode=2` if they grab a coin that's smaller
// than the requested split amount.
//
// We learned this the hard way: the trader's repeated mint deliveries
// kept fragmenting the Treasury wallet's SUI through change outputs;
// once any of those fragments dipped below the Walrus storage cost the
// next reasoning/journal upload aborted at simulation. Consolidating
// before gas-sensitive ops makes Walrus uploads, spot bets, and faucet
// swaps all robust against the same failure mode.
//
// Cost: one PTB (~0.0003 SUI gas) when fragmentation is detected; a
// pure read when only one coin exists. We skip the merge entirely if
// the wallet already has exactly one SUI coin.

import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";

export type ConsolidateResult = {
  /** True iff a merge tx was actually submitted. */
  merged: boolean;
  /** Digest of the merge tx (only when `merged`). */
  digest?: string;
  /** ObjectId of the (now-)primary SUI coin. */
  coinId: string;
  /** Balance of the primary coin in MIST. */
  balance: bigint;
  /** How many SUI coins existed before the merge. */
  coinsBefore: number;
};

/** Consolidate the signer's SUI coins into a single object. Idempotent. */
export async function consolidateSuiCoins(
  sui: SuiJsonRpcClient,
  signer: Ed25519Keypair,
): Promise<ConsolidateResult> {
  const owner = signer.toSuiAddress();
  const coins = await sui.getCoins({ owner });
  const list = coins.data ?? [];
  if (list.length === 0) {
    return { merged: false, coinId: "", balance: 0n, coinsBefore: 0 };
  }
  if (list.length === 1) {
    return {
      merged: false,
      coinId: list[0]!.coinObjectId,
      balance: BigInt(list[0]!.balance),
      coinsBefore: 1,
    };
  }
  // Sort by balance desc — use the largest coin as the gas-payment
  // anchor so the merge doesn't fail with "no valid gas coin".
  const sorted = [...list].sort((a, b) =>
    BigInt(b.balance) > BigInt(a.balance) ? 1 : -1,
  );
  const primary = sorted[0]!;
  const rest = sorted.slice(1);

  const tx = new Transaction();
  tx.setGasPayment([
    {
      objectId: primary.coinObjectId,
      version: primary.version,
      digest: primary.digest,
    },
  ]);
  tx.mergeCoins(
    tx.gas,
    rest.map((c) => tx.object(c.coinObjectId)),
  );

  const res = await sui.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true },
  });
  if (res.effects?.status?.status !== "success") {
    throw new Error(
      `consolidateSuiCoins failed: ${res.effects?.status?.error ?? "unknown"}`,
    );
  }
  const after = await sui.getCoins({ owner });
  const merged = after.data?.[0];
  return {
    merged: true,
    digest: res.digest,
    coinId: merged?.coinObjectId ?? primary.coinObjectId,
    balance: BigInt(merged?.balance ?? 0),
    coinsBefore: list.length,
  };
}
