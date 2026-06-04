// Real Sui System validator staking.
//
// When the operator chooses "SuiSystem" as the cycle's venue, the PTB
// includes a native call to `0x3::sui_system::request_add_stake` with a
// coin split from gas — funding goes directly to the validator's stake
// pool and starts accruing rewards next epoch.
//
// Validator selection: query `getValidatorsApy()`, pick the highest-APY
// active validator with positive APY. Cache for 60 s. Env override
// (`BRIEF_STAKE_VALIDATOR`) wins so deployers can pin a specific
// validator if they want. If RPC fails AND we have no cache AND no env,
// the call throws — the cycle skips honestly rather than staking to
// `0x0`.

import type { Transaction } from "@mysten/sui/transactions";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

/** The Sui System State shared object — well-known address on every network. */
export const SUI_SYSTEM_STATE_ID = "0x5";
/** The Sui System package address. */
export const SUI_SYSTEM_PACKAGE_ID = "0x3";
/** Module + entry function for staking. */
export const SUI_STAKE_TARGET = `${SUI_SYSTEM_PACKAGE_ID}::sui_system::request_add_stake`;

const VALIDATOR_RPC_TIMEOUT_MS = 2_500;
const VALIDATOR_CACHE_TTL_MS = 60_000;

type CachedValidator = {
  address: string;
  apy: number;
  fetchedAt: number;
  source: "rpc" | "env";
};

let cached: CachedValidator | null = null;

/**
 * Resolve an active validator address to delegate to.
 *
 * Order:
 *   1. `BRIEF_STAKE_VALIDATOR` env override (operator pins a specific one)
 *   2. Cached result within the last 60 s
 *   3. Fresh `getValidatorsApy()` query — pick highest positive APY
 *
 * Throws if no candidate could be resolved. Callers must catch and skip
 * the cycle with `awaiting_validator` reason; we never default to
 * `0x0` or any "fake" validator address.
 */
export async function resolveActiveValidator(
  client: SuiJsonRpcClient,
): Promise<{ address: string; apy: number; source: "rpc" | "env" | "cache" }> {
  const envOverride = process.env.BRIEF_STAKE_VALIDATOR?.trim();
  if (envOverride && envOverride.startsWith("0x")) {
    return { address: envOverride, apy: 0, source: "env" };
  }

  if (cached && Date.now() - cached.fetchedAt < VALIDATOR_CACHE_TTL_MS) {
    return { address: cached.address, apy: cached.apy, source: "cache" };
  }

  const resp = await withTimeout(
    client.getValidatorsApy({}),
    VALIDATOR_RPC_TIMEOUT_MS,
  );
  const apys = resp?.apys ?? [];
  // Take the strictly-positive-APY set; on a healthy network this is most
  // validators. Sort descending so we pick the best yield.
  const positive = apys.filter((v) => v.apy > 0);
  const pool = positive.length > 0 ? positive : apys;
  if (pool.length === 0) {
    throw new Error(
      "No validators returned by getValidatorsApy — cannot select stake target",
    );
  }
  const sorted = [...pool].sort((a, b) => b.apy - a.apy);
  const top = sorted[0]!;
  cached = {
    address: top.address,
    apy: top.apy,
    fetchedAt: Date.now(),
    source: "rpc",
  };
  return { address: top.address, apy: top.apy, source: "rpc" };
}

/**
 * Append `request_add_stake` to an existing PTB. Splits the stake amount
 * from `tx.gas` so the user/agent's own SUI funds the delegation in the
 * same atomic transaction as `record_spend` + the audit mint.
 *
 * Order of arguments matches the Move signature exactly:
 *   request_add_stake(self: &mut SuiSystemState, stake: Coin<SUI>, validator: address)
 */
export function addStakeCalls(
  tx: Transaction,
  args: { amountMist: bigint; validatorAddress: string },
): void {
  const [stakeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(args.amountMist)]);
  tx.moveCall({
    target: SUI_STAKE_TARGET,
    arguments: [
      tx.object(SUI_SYSTEM_STATE_ID),
      stakeCoin!,
      tx.pure.address(args.validatorAddress),
    ],
  });
}

/** Last successful selection — useful for telemetry. */
export function lastResolvedValidator(): CachedValidator | null {
  return cached;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(
      () => reject(new Error(`rpc timeout after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(handle);
        resolve(v);
      },
      (e) => {
        clearTimeout(handle);
        reject(e);
      },
    );
  });
}
