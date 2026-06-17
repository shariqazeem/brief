# Mainnet flip — verified config + step-by-step

Status: **money-safety validated on testnet; config verified; ready to flip.**
The only steps that move real funds are signed by **you** (publish, fund, first
deposit). I do not handle mainnet keys.

---

## What's already proven (testnet, identical code)

- **Owner can always withdraw** — `balance_manager::withdraw_all` is owner-gated;
  devInspect as the owner → `success`.
- **Operator can NEVER withdraw** — devInspect as the operator/treasury key →
  `MoveAbort … balance_manager::validate_owner`. The chain rejects it.
- **Budget enforced** — `operator_policy::record_spend` aborts on
  revoke/expiry/over-budget/disallowed-venue, atomically with the order.
- **Revoke** stops new trades and does **not** lock funds (withdraw still works).
- **Withdraw UI shipped** — one-tap "Withdraw funds" on the dashboard (owner-only).

## Verified mainnet constants (already in `src/lib/deepbook-adopt.ts`)

- DeepBook v3 package (calls): `0xf48222c4e057fa468baf136bff8e12504209d43850c5778f76159292a96f621e` — present in installed `@mysten/deepbook-v3`.
- USDC: `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` (canonical native USDC).
- DEEP: `0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP`.
- Live SUI/USDC pool: `0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407`.
- Re-verify the DeepBook package id against `@mysten/deepbook-v3` right before publish (DeepBook bumps it on upgrades; current installed SDK = the id above).

---

## The flip — steps you sign

> Run these yourself (the VM has the keys; use `! <cmd>` here or SSH). I'll
> prep/verify each and read back results.

1. **Publish Brief on mainnet** (your treasury key, needs ~2–3 SUI gas):
   ```
   cd /home/ubuntu/brief/move && sui client switch --env mainnet
   sui client publish --gas-budget 500000000
   ```
   → capture the new **package id**.

2. **Fund the mainnet wallets** (you):
   - Treasury/agent address: ~1–2 SUI (gas) + a small **DEEP** reserve (fuel for
     DeepBook fees) + the **USDC** you want the first operator to manage.
   - (Optional) research/planner wallets: ~0.5 SUI each if used.

3. **Set env** (`.env.local` on the VM **and** Vercel project env):
   ```
   NEXT_PUBLIC_SUI_NETWORK=mainnet
   NEXT_PUBLIC_BRIEF_PACKAGE_ID=<mainnet package id>
   NEXT_PUBLIC_BRIEF_TYPE_ORIGIN_ID=<mainnet package id>
   NEXT_PUBLIC_SUI_RPC_URL=https://fullnode.mainnet.sui.io:443
   # AGENT/TREASURY/RESEARCH secret keys = your mainnet-funded keys
   ```
   Never commit `.env.local`.

4. **Redeploy** (I run this): `git pull` is N/A (no code change) — just rebuild +
   restart web, and restart `brief-trader`. The agent auto-enables mainnet
   operators once `env.network === "mainnet"` (it currently skips them).

5. **Adopt the first mainnet operator with a SMALL amount** (you, in the UI):
   - Choose goal → set a low budget cap + a real USDC deposit (start tiny, e.g.
     1–5 USDC) → one signature.
   - I then verify on mainnet: the gated trade fires, `record_spend` enforces the
     cap, and — critically — you click **Withdraw funds** and confirm the USDC
     returns to your wallet.

6. **Smoke test before scaling**: confirm one gated fill + one withdraw on
   mainnet, then raise the budget / adopt more operators.

---

## Rollback / safety

- Testnet stays as the fallback path (untouched).
- At any moment: **Revoke** (operator stops on its next trade) then **Withdraw**
  (funds back to your wallet). Both are owner-signed, chain-enforced.
- Start with a tiny USDC amount; scale only after the first mainnet
  trade + withdraw round-trips cleanly.
