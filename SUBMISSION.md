# Brief — Sui Overflow 2026 submission

> Adopt an autonomous AI trader. Watch it bet on chain. Yank the leash anytime.

A draft to paste into overflow.sui.io. Each `##` heading roughly maps to one
form field; trim where the field has a character cap.

This submission is the **"Adopt an AI Trader"** product on the workforce
substrate. The same Move primitives (`OperatorPolicy`, atomic settlement
PTBs, agent registry) that built the workforce in Phase 1 now power a
consumer-facing trader product: sign in with Google, name your trader,
set a leash, watch it take real on-chain bets across multiple assets, and
revoke any time.

---

## One-line product description

> Adopt an AI agent that bets BTC up/down on DeepBook Predict — and now also takes real directional positions on SUI / WAL / DEEP via DeepBook spot — bounded by a Move policy you hold. Sign in with Google. Yank the leash anytime. The chain refuses the next bet, but past wins still pay out.

(43 words. Shorter alternates:
- *"AI trader on chain. Move policy is the leash."*
- *"Autonomous trading, with a one-tap kill switch the chain enforces."*
- *"Adopt an AI trader. The policy is the leash."*)

---

## The problem

Everyone says they want AI to act with their money. Almost nobody actually
lets it. The fear isn't capability — it's **loss of control**. Once an AI
agent has signing authority, what stops it from blowing the budget,
chasing a bad strategy, or running for an extra five minutes after you've
changed your mind?

Today's answers are all off-chain — a process flag, a server-side circuit
breaker, a key rotation, a phone call to revoke. Every one of them depends
on infrastructure the AI agent might be running on. The chain has no
opinion on whether the agent is still authorized.

There's also the second problem: the AI economy isn't BTC-only. People
emotionally root for *their* asset — SUI, ETH, SOL, WAL, DEEP. A trader
that only plays one market is a toy, not a product.

---

## The Brief solution

Brief is **autonomous on-chain trading with a chain-enforced leash**.

A user adopts a trader through a 60-second flow (Sign in with Google →
name → set leash → pick markets). One signature mints an `OperatorPolicy`
Move object: budget cap, allowed venues (`predict-btc`, `spot-sui`,
`spot-wal`, `spot-deep`), expiry, kill-switch field. The trader's Sui
wallet is bound to it as the operator agent.

The trader runs as a node process on Brief's infrastructure. Every bet is
an **atomic PTB** that calls `operator_policy::record_spend` *first* —
the chain debits the policy's `spent` field and reverts if `revoked` or
`spent > budget_cap`. Only then does the rest of the PTB run: a Predict
`mint<DUSDC>` for BTC up/down, or a `pool::place_market_order` for SUI /
WAL / DEEP directional bets.

The user holds the kill switch. One `operator_policy::revoke` call (one
signature) flips the `revoked` flag. The very next time the trader tries
to place a bet — *any* asset — the `record_spend` aborts with
`EPolicyRevoked` and the trade never executes. The chain itself refused.

Crucially: **closing/redeeming already-open positions is permissionless**
(`predict::redeem_permissionless`, spot close uses no policy gate). So
revoking blocks new bets but doesn't trap your already-made wins.

Two more pieces complete the product:

- **zkLogin onboarding.** Sign in with Google. The user never sees a seed
  phrase, never installs a wallet, never copies a private key. A
  freshly-derived Sui address holds the policy and signs the grant.
- **Walrus memory.** Every decision the trader makes — direction, strike,
  reasoning — uploads as a content-addressed Walrus blob. A cumulative
  *running memory journal* re-uploads on every trade. The dashboard
  surfaces it as **"{Trader Name}'s memory · on Walrus"** so a judge can
  open the URL and read the trader's full history. The agent doesn't
  rewrite history — the blob ids are content-addressed.

---

## The four answers

| | |
|---|---|
| **What** | An autonomous AI trader that bets BTC up/down on DeepBook Predict + directional spot bets on SUI/WAL/DEEP via DeepBook v3, gated by a revocable Move policy you hold. |
| **Why it matters** | People want AI to act with their money but fear losing control. We give autonomy *with* a blockchain-enforced leash you can yank instantly. "The AI is not trusted — the policy is." |
| **How it works** | Sign in with Google → adopt → name → set leash → pick markets → one signature. The trader takes live bets within the policy. You watch live P&L. Revoke → chain refuses the next bet on any asset. Past wins still pay out via permissionless redeem/close. |
| **Sui stack** | OperatorPolicy + atomic PTBs (record_spend composes with the trade in one tx) · **DeepBook Predict** (binary up/down on BTC) · **DeepBook v3 spot** (directional buy/sell on SUI/WAL/DEEP) · **Walrus** (verifiable accumulating agent memory) · **zkLogin** (Google onboarding, no wallet required) · multi-wallet agent identity. |

---

## The demo (3 minutes)

A user lands on briefkin.com. They click *"Sign in with Google."* A zkLogin
flow returns them to the page authenticated, with a freshly-derived Sui
address ready to sign.

They scroll into the gallery, pick the **Momentum** personality, name
their trader **Memory**, and slide the leash to **2 SUI**. Step 3:
*"Which markets?"* — three cards: "BTC only" / "Sui ecosystem" / "All".
They pick **All**.

One signature later, an `OperatorPolicy` materializes on chain with
`allowed_venues = [predict-btc, spot-sui, spot-wal, spot-deep]`, budget
cap 2 SUI-equivalent, kill switch armed. The page transitions into the
trader dashboard.

Within ~20 seconds Memory takes its first bet. The Open Position panel
fills in: *"Memory is betting UP on BTC."* Strike $61,792, spot
$61,792.17, expiry Jun 12 8am UTC. The mint tx digest
(`B5FYRVPZ…`) is linked. The live BTC spot ticks every 8s; a distance
gauge shows how close we are to the flip.

The dashboard's memory panel shows **"Memory's memory · on Walrus"** —
two emerald cards link to the running journal blob (the entire decision
log) and the per-decision reasoning blob. Both are HTTP-200 from the
public aggregator. A judge can click and read.

The user clicks **REVOKE**. One signature. The revoke tx lands. The next
trader task that fires up the simulator hits `MoveAbort code:3 in
operator_policy::assert_can_spend` — that's `EPolicyRevoked`. The
trader's deliverable is recorded on chain with mode `simulated` and the
abort message in `reason_if_simulated`. The chain — not the server —
refused the trade.

Vision close: *"This is one trader. The same primitives let a stable of
traders, each on its own leash, each picking its own markets. The
leaderboard writes itself."*

---

## Why Sui specifically

Five Sui properties are load-bearing — remove any one and the product
collapses or moves off-chain:

1. **Move shared objects** — `OperatorPolicy`, `Task`, `Deliverable` are
   shared. The user (owner), trader (agent), and observers all transact
   against them concurrently. On a chain without shared mutable state,
   this is a backend with extra steps.

2. **Atomic PTBs** — Every trader bet is one PTB:
   `record_spend` → `market_key::new` → `predict::mint<DUSDC>` (for BTC)
   or `record_spend` → `pool::place_market_order` (for spot). The
   `record_spend` aborts the entire PTB if the policy is revoked. The
   kill switch is *structural*, not advisory.

3. **DeepBook Predict** — Binary up/down markets with on-chain settlement
   and oracle-derived payouts. The trader's mint runs against the real
   AMM, the position is a real on-chain object, redemption is
   permissionless after the oracle settles.

4. **DeepBook v3 spot pools** — Real CLOB-style orderbook with the same
   atomicity. Our spot bets are real market orders (`isBid` true/false)
   against SUI/DBUSDC, WAL/DBUSDC, DEEP/DBUSDC pools. No oracle
   dependency, no AMM-only slippage estimation.

5. **Walrus content-addressed storage** — Every decision a trader makes
   uploads as a Walrus blob. The cumulative memory journal regenerates
   per bet. The on-chain `Deliverable` carries the blob id. A judge can
   fetch the actual reasoning content from the public aggregator and
   verify the trader hasn't rewritten history.

Plus: **zkLogin** for consumer-grade Google onboarding (no wallet
install, no seed phrase) — the difference between "AI trader for crypto
natives" and "AI trader anyone can adopt."

The same product on Solana or Ethereum would lose at least the atomic
PTB + record_spend composition (the kill switch's structural guarantee)
and the Predict-native binary market (replaced by a perp DEX or an
AMM-shaped surrogate).

---

## Track prize alignment

| Track / prize | How Brief satisfies it |
|---|---|
| **DeepBook (Predict)** | Real `predict::mint<DUSDC>` on the BTC oracle in an atomic PTB with `operator_policy::record_spend`. Mint tx, position event, policy spend event all on chain. |
| **DeepBook (Spot)** | Real `pool::place_market_order` on SUI/DBUSDC for directional bets. Open + close + realized P&L all on chain. Multi-asset (SUI/WAL/DEEP) via the same pattern. |
| **Walrus** | Per-decision reasoning + cumulative memory journal upload to Walrus testnet. Blob ids in the on-chain `Deliverable`. Surfaced as "{Name}'s memory · on Walrus" cards. The agent that builds over time, content-addressed. |
| **Agentic Web (Sub-track 2)** | The product *is* an autonomous AI agent with bounded delegated authority transacting on chain. zkLogin + policy + atomic PTBs are the agent-grade primitives Sub-track 2 explicitly asks for. |

---

## Tech stack

- **On-chain (Sui Move 2024.beta):** 6-module package — `operator_policy`,
  `task`, `agent_registry`, `work_object`, `settlement`, `lineage`.
  Published to testnet as
  `0xe550ace873c02768dbaca7de3a2d64a28acd3f7c51551c9c97b704703e95fb9d`.
  22/22 Move unit tests pass.
- **DeepBook Predict** — package `0xf5ea2b37…5138` (testnet
  `predict-testnet-4-16` branch), oracle indexer
  `predict-server.testnet.mystenlabs.com`, dUSDC quote
  `0xe9504008…::dusdc::DUSDC`. PredictManager
  `0xb2c2f0484046af942d28fb65c54005ef92f07a59a530d9a839cb152167164f0b`
  (250 dUSDC deposited; tx `6yPutQR1AHP5YqGQKPqxKCwi57eC44YWqJquXHYziJQP`).
- **DeepBook v3 spot** — `@mysten/deepbook-v3` v1.3. BalanceManager
  `0x85271a91…`. Pools used: SUI_DBUSDC, WAL_DBUSDC, DEEP_DBUSDC,
  WAL_SUI, DEEP_SUI.
- **Walrus** — `@mysten/walrus` v1.1 with upload-relay. Testnet
  aggregator. Per-decision blob ~427 B; running journal ~1.4 KB after
  4 entries.
- **Frontend:** Next.js 14 App Router, TypeScript, Tailwind. dApp Kit +
  zkLogin (Google OAuth implicit flow, lazy-loaded crypto bundle).
  `/workforce` First-Load JS: 268 kB.
- **Agent runtimes:** Node.js + tsx. Five pm2 processes — `brief-web`,
  `brief-planner-service`, `brief-research`, `brief-treasury`,
  `brief-trader` — running on an Oracle Cloud VM behind Caddy with
  Let's Encrypt.

---

## Verifiable live artifacts (testnet)

Every digest below is queryable on Suiscan / Sui Explorer.

### Live BTC mints (real `predict::mint<DUSDC>` in atomic PTBs)
- Mint #1: `B5FYRVPZFr6WgzuTBhUa8kdadxke44pDGyta9jE26YSP` — strike $61,792, UP, 2 contracts, expiry 2026-06-12T08:00 UTC
- Mint #2: `8pRZJvRS4rwpcwxUQYcAS7bHjgbznpiFGcVLKF28gfob` — strike $61,882, UP, 2 contracts
- Mint #3: `BuaNf8qxojU7GkvWCxWx4sAdgyFhMQTnT9P1DATX6Dcd`
- Mint #4: `4BcXnzEXXVHAHA9urKKJYLYG4zvsfqreCoxjugynUdNH`

All four cleanly compose `operator_policy::record_spend` + `predict::mint`
in one PTB. PolicySpend events show the policy's `spent` field ticking up
exactly `qty × DUSDC_BASE × 1000` per mint — real budget depletion.

### Kill switch on a live policy
- Policy #1: `0x60f7e0a4f26401f5911ba9ce8a9516ac1a19dd9748481f568b5d909967e910c8`
- Revoke tx: `4yBvc6qVwoXugmZu1jNgNjHRC8ZtqMtoVefsuQZyB4YL`
- Post-revoke trader simulator caught `MoveAbort code:3 in
  operator_policy::assert_can_spend` (= `EPolicyRevoked`)
- Sim-fallback delivery tx: `BNbEUctbpVSF8Co39zQGpKXtcnKyFzZYUBqx3PxvD6dS`
  — deliverable body's `reason_if_simulated` field literally contains the
  abort message; on-chain proof the chain refused.

### Real non-BTC directional bet — SUI on DeepBook spot
- **OPEN** `9fgEqR6NuWawDGvW6MbWkcLJ5wreyHhMGJhUFEVxTXUS` — Treasury BM
  market-sold 1 SUI for 0.744 DBUSDC (effective SUI DOWN bet)
- **CLOSE** `81a2xFkHSe4Lw1x4r8RQqRt7mG1NeuBQ4bHiexh1JLiq` — bought 1 SUI
  back for 0.753 DBUSDC
- **Realized P&L: −$0.009 DBUSDC** — SUI rose ~1.2% between open and
  close, the bet LOST. Real on-chain non-BTC win/lose digest.
- Second cycle via the library e2e (open `B7J1JnooeXHWLryGzS3oq8g9uSuy58Y5fUZwVR1d5aGJ`
  close `9BCzvK5qXZDgCyGRQdVsFJKRpVfmSjWsS6fZM33XdHWZ`, P&L −$0.0089)
  exercising `openSpot`/`closeSpot` via the lib API.

### Unified multi-asset leash
- Multi-asset policy:
  `0x76708793641c7f319aa61fdbe4e6b7cfa100c405f1a0424b8fcf06806ab841a4`
- Allowed venues: `[predict-btc, spot-sui, spot-wal, spot-deep]` — one
  budget, four markets
- After the SUI spot bet, `policy.spent` ticked from 0 → 751,000,000
  (= $0.751 notional × 1e9). The same `record_spend` mechanism that
  governs BTC mints governs spot bets.

### Walrus memory blobs (HTTP 200 from public aggregator)
- Reasoning: `IQhlCLZ6zOYk2IVOC2MQSJ8Ue5KFnob0ZELaqXDRoI0` (427 B)
- Reasoning #2: `WinmOb1EFjYYpL9Qo0hFiYMFvVWIjkUaJ3-otLpr2iA`
- Journal (entries=2): `8u3tXnXZBF2ZTv6hqlQ2HLKiNe5B5lH35jiUB-YBBPI` (1.4 KB)
- Journal (entries=4): `YXzw_41WhnncBaz0Pfk4MmNojQxPbnelbCIuOQxCeiM`
- Reasoning #4: `aXZmPOwoji3wFnZmspWVrr4_BbEMBS6a3sA0aRN5s3w`
- Treasury smoke test: `7rSbhSkYPt7eoHcLSO2v8CXRfAlU6SLa_ofv1aL4xz8`

All blobs fetchable at
`https://aggregator.walrus-testnet.walrus.space/v1/blobs/{blobId}`.

### Infrastructure
- Treasury wallet (trader agent):
  `0xa9f24640b32f33fcfa8582791e84a542251398acfc3b696f382a08a768b6ddbf`
- Planner wallet (policy owner during tests):
  `0xd440b0b59ed5474b32ceb71d819c474e1512747179b7088ff324012767f5b435`

---

## What we'd build next

1. **Trader-side spot router live integration.** The asset abstraction
   (`markets.ts`, `deepbook-spot.ts`) + handlers (`spot-handler.ts`,
   `spot-positions.ts`) ship in the repo. The trader's task handler
   needs one branch to dispatch by `spec.asset`. The full spot lifecycle
   is already proven end-to-end via the lib API.

2. **WAL / DEEP markets.** Same SDK calls, different pool keys
   (`WAL_DBUSDC`, `DEEP_DBUSDC`). Registry already includes them; one
   inventory top-up per asset and they're live.

3. **Pyth-priced multi-asset markets (ETH, SOL).** DeepBook testnet has
   no ETH or SOL pools. A custom `brief::up_down_market` Move module
   reading Pyth feeds with a treasury-funded house pool unlocks the
   most-rooted-for tickers. Sketch ready; held out of this submission
   to keep the demo bulletproof.

4. **Leaderboard + stable of traders.** Each trader is one policy. A
   board ranking traders by realized P&L (which is content-addressed
   per trade on Walrus) makes the product social.

5. **Mainnet.** Predict and DeepBook spot both have mainnet
   deployments. The Move package is upgrade-published; mainnet
   migration is a deploy run + config swap, not a rewrite.

---

## GitHub

https://github.com/shariqazeem/brief

## Live deployment

https://141-148-215-239.sslip.io/workforce (canonical; HTTPS via Caddy + Let's Encrypt)

## Demo video

`<TODO: record + upload, paste URL here>` — see `demo-script.md`

## Author

Shariq Shaukat — [@shariqshkt](https://x.com/shariqshkt)

Solo build for **Kyvernlabs**. Brief is Kyvernlabs' Sui product;
[Kyvern](https://app.kyvernlabs.com) is its Solana product (per-agent
authority via Squads v4 + Anchor policy + x402 micropayments). Together
they form the agent-economy stack — per-agent authority on one chain,
multi-asset autonomous trading on another, with reputation portable
between.
