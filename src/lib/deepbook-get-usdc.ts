// "Get test USDC" — one-signature SUI → DBUSDC for testnet adoption.
//
// The DEEP/DBUSDC pool is whitelisted (0 fee) but THIN — routing through it
// gave a terrible rate (~0.22 DBUSDC/SUI). The SUI/DBUSDC pool is deeply
// liquid (~0.80 DBUSDC/SUI) but charges a DEEP fee. So we do both in one PTB:
//   hop 1: a little SUI → DEEP on whitelisted DEEP_SUI (0 fee) — just enough
//          DEEP to pay the next hop's fee (0.3 SUI ≈ 13 DEEP, fee ≈ 0.05).
//   hop 2: the rest of the SUI → DBUSDC on the LIQUID SUI/DBUSDC pool, paying
//          the fee from hop 1's DEEP.
// The user signs once and walks away with a usable amount of DBUSDC.
//
// Testnet only. Addresses are pinned from @mysten/deepbook-v3 testnet
// constants — re-verify if DeepBook redeploys (same caveat as DEEPBOOK_CFG).

import { Transaction } from "@mysten/sui/transactions";

const DEEPBOOK_PKG =
  "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c";
const DEEP_SUI_POOL =
  "0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f";
const SUI_DBUSDC_POOL =
  "0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5";
const SUI_TYPE = "0x2::sui::SUI";
const DEEP_TYPE =
  "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP";
const DBUSDC_TYPE =
  "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC";
const CLOCK = "0x6";

/**
 * Build the testnet SUI → DBUSDC swap via the LIQUID SUI/DBUSDC pool, with a
 * little SUI first converted to DEEP to cover that pool's fee. `suiIn` is the
 * total SUI to spend (human units), split from the gas coin. The DBUSDC output
 * and every remainder coin are returned to `owner` so nothing dangles.
 */
export function buildGetTestUsdcTx(owner: string, suiIn: number): Transaction {
  const tx = new Transaction();
  // Reserve a slice of SUI to mint DEEP for the SUI/DBUSDC fee; the rest buys
  // DBUSDC. 0.3 SUI ≈ 13 DEEP — far more than any small swap's fee.
  const feeSui = Math.min(0.3, Math.max(0.08, suiIn * 0.2));
  const mainSui = Math.max(0.02, suiIn - feeSui);
  const [feeCoin, mainCoin] = tx.splitCoins(tx.gas, [
    tx.pure.u64(BigInt(Math.round(feeSui * 1e9))),
    tx.pure.u64(BigInt(Math.round(mainSui * 1e9))),
  ]);

  // hop 1 — SUI → DEEP on whitelisted DEEP_SUI (base=DEEP, quote=SUI), 0 fee
  // so a zero DEEP coin satisfies the signature.
  const zeroDeep = tx.moveCall({ target: "0x2::coin::zero", typeArguments: [DEEP_TYPE] });
  const [deepOut, feeSuiRem, deepFee1] = tx.moveCall({
    target: `${DEEPBOOK_PKG}::pool::swap_exact_quote_for_base`,
    typeArguments: [DEEP_TYPE, SUI_TYPE],
    arguments: [tx.object(DEEP_SUI_POOL), feeCoin, zeroDeep, tx.pure.u64(0), tx.object(CLOCK)],
  });

  // hop 2 — SUI → DBUSDC on the LIQUID SUI/DBUSDC pool (base=SUI, quote=DBUSDC):
  // base-for-quote, paying the fee from hop 1's DEEP.
  const [suiRem, dbusdcOut, deepRem] = tx.moveCall({
    target: `${DEEPBOOK_PKG}::pool::swap_exact_base_for_quote`,
    typeArguments: [SUI_TYPE, DBUSDC_TYPE],
    arguments: [tx.object(SUI_DBUSDC_POOL), mainCoin, deepOut, tx.pure.u64(0), tx.object(CLOCK)],
  });

  // Sweep DBUSDC + every remainder back to the user so nothing dangles.
  tx.transferObjects(
    [dbusdcOut, suiRem, deepRem, feeSuiRem, deepFee1],
    tx.pure.address(owner),
  );
  return tx;
}
