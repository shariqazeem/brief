// "Get test USDC" — one-signature SUI → DBUSDC for testnet adoption.
//
// SUI/DBUSDC isn't a whitelisted DeepBook pool (it charges a DEEP fee), but
// DEEP_SUI and DEEP_DBUSDC both ARE whitelisted (0 fee). So we route
// SUI → DEEP → DBUSDC in one PTB — no DEEP needed in the wallet, because
// the per-hop fee coin is a freshly-minted coin::zero<DEEP>. The user signs
// once and walks away with DBUSDC to adopt with.
//
// Testnet only. Addresses are pinned from @mysten/deepbook-v3 testnet
// constants — re-verify if DeepBook redeploys (same caveat as DEEPBOOK_CFG).

import { Transaction } from "@mysten/sui/transactions";

const DEEPBOOK_PKG =
  "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c";
const DEEP_SUI_POOL =
  "0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f";
const DEEP_DBUSDC_POOL =
  "0xe86b991f8632217505fd859445f9803967ac84a9d4a1219065bf191fcb74b622";
const SUI_TYPE = "0x2::sui::SUI";
const DEEP_TYPE =
  "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP";
const DBUSDC_TYPE =
  "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC";
const CLOCK = "0x6";

/**
 * Build the testnet SUI → DEEP → DBUSDC swap (both hops whitelisted, 0 fee).
 * `suiIn` is in SUI (human units); it's split from the gas coin. The DBUSDC
 * output and every remainder coin are returned to `owner` so nothing is left
 * dangling in the PTB.
 */
export function buildGetTestUsdcTx(owner: string, suiIn: number): Transaction {
  const tx = new Transaction();
  const suiMist = BigInt(Math.round(suiIn * 1e9));
  const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(suiMist)]);

  // Fee coins: whitelisted pools take 0 DEEP, so a zero coin satisfies the
  // signature without the wallet holding any DEEP.
  const zeroDeep1 = tx.moveCall({
    target: "0x2::coin::zero",
    typeArguments: [DEEP_TYPE],
  });
  // hop 1 — SUI → DEEP on DEEP_SUI (base=DEEP, quote=SUI): quote-for-base.
  const [deepOut, suiRem, deepFee1] = tx.moveCall({
    target: `${DEEPBOOK_PKG}::pool::swap_exact_quote_for_base`,
    typeArguments: [DEEP_TYPE, SUI_TYPE],
    arguments: [
      tx.object(DEEP_SUI_POOL),
      suiCoin,
      zeroDeep1,
      tx.pure.u64(0), // minOut: accept any (testnet, tiny size)
      tx.object(CLOCK),
    ],
  });

  const zeroDeep2 = tx.moveCall({
    target: "0x2::coin::zero",
    typeArguments: [DEEP_TYPE],
  });
  // hop 2 — DEEP → DBUSDC on DEEP_DBUSDC (base=DEEP, quote=DBUSDC):
  // base-for-quote, feeding hop 1's DEEP straight in.
  const [deepRem, dbusdcOut, deepFee2] = tx.moveCall({
    target: `${DEEPBOOK_PKG}::pool::swap_exact_base_for_quote`,
    typeArguments: [DEEP_TYPE, DBUSDC_TYPE],
    arguments: [
      tx.object(DEEP_DBUSDC_POOL),
      deepOut,
      zeroDeep2,
      tx.pure.u64(0),
      tx.object(CLOCK),
    ],
  });

  // Sweep the DBUSDC + every remainder (leftover SUI/DEEP, zeroed fee coins)
  // back to the user so the PTB has no dangling values.
  tx.transferObjects(
    [dbusdcOut, suiRem, deepRem, deepFee1, deepFee2],
    tx.pure.address(owner),
  );
  return tx;
}
