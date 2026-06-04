// Simulated execution path — used when DeepBook probe (Day 6) is NO-GO
// or when running the demo without funded testnet SUI to trade.
//
// Builds a small self-transfer PTB so the resulting digest is a real
// on-chain TX, but no actual DEX order is placed. The ExecutionReceipt
// records `mode: "simulated"` so the frontend can label it honestly.

import { Transaction } from "@mysten/sui/transactions";

export type SimulatedFill = {
  pool: string;
  side: "buy" | "sell";
  in_amount: number;
  out_amount: number;
  price: number;
};

export function buildSimulatedExecutionTx(
  owner: string,
  intent: { operations: { protocol: string; amount_pct: number }[] },
): {
  tx: Transaction;
  fills: SimulatedFill[];
} {
  const tx = new Transaction();
  // Tiny self-transfer (1 MIST = 1e-9 SUI) just to anchor the receipt
  // in a real on-chain TX.
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1n)]);
  tx.transferObjects([coin], tx.pure.address(owner));

  const fills: SimulatedFill[] = intent.operations.map((op) => ({
    pool: `${op.protocol}/USDC`,
    side: "buy",
    in_amount: 100 * op.amount_pct,
    out_amount: 100 * op.amount_pct * 0.998, // -20 bps simulated slippage
    price: 0.998,
  }));

  return { tx, fills };
}
