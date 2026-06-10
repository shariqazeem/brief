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

> Adopt an AI agent that bets BTC up/down on DeepBook Predict — and takes real directional positions on SUI / WAL / DEEP via DeepBook spot — using a vol-surface-aware strategy read live off the on-chain SVI oracle, bounded by a Move policy you hold. Connect a Sui wallet (Slush / Suiet). Yank the leash anytime. The chain refuses the next bet; past wins still pay out.

(54 words. Shorter alternates:
- *"AI trader that reads the on-chain vol surface. Move policy is the leash."*
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

Three more pieces complete the product:

- **A genuinely smart agent (real signals + live SVI vol surface).** Every
  decision is grounded in real data the trader observes itself: a rolling
  per-asset price history (atomic-write JSON, ~10h of points at the cap),
  derived signals (ROC 5m/30m/60m, SMA 15m/60m, Wilder RSI 60m, annualized
  realized vol), AND — for BTC Predict — the live on-chain **SVI volatility
  surface** read off the oracle in a single chained `devInspect` PTB. Four
  strategies (Conservative / Momentum / Contrarian / Quant·Vol) act on this
  data. The Quant·Vol strategy is the headline: it computes the
  market-implied `Pr(UP)` at the candidate strike using Black-Scholes-style
  inversion of the SVI total variance, derives its own probability estimate
  from the signal bundle, and bets only when `|agentP − marketP| ≥ 5%`. **Every
  strategy returns `null` cleanly when there's no edge — the agent honestly
  abstains rather than forcing a bet.** The dashboard's "Watch it think"
  panel surfaces all of this: the signals, the SVI parameters straight off
  chain, the market-vs-agent edge as visual bars, the plain reasoning.
- **zkLogin onboarding (wired, gated by Enoki for testnet).** The full
  Google OAuth → JWT → salt → address-derivation path is implemented
  end-to-end; only the on-chain Groth16 verifier path requires Mysten's
  Enoki-managed prover for testnet/mainnet (the public prover-dev
  endpoint targets devnet's trusted setup). For the demo we ship the
  Sui-wallet (Slush / Suiet) path, which signs the same atomic PTBs.
  Enabling Google in production is a one-line env swap once an Enoki
  API key is plugged into `/api/zklogin/prove`.
- **Walrus memory.** Every decision the trader makes — direction, strike,
  reasoning, **and the signal bundle + SVI surface that produced it** —
  uploads as a content-addressed Walrus blob. A cumulative *running memory
  journal* re-uploads on every trade. The dashboard surfaces it as
  **"{Trader Name}'s memory · on Walrus"** so a judge can open the URL and
  read the trader's full history. The agent doesn't rewrite history — the
  blob ids are content-addressed, and the "Watch it think" panel renders
  the exact contents of the blob the on-chain Deliverable points to.

---

## The four answers

| | |
|---|---|
| **What** | An autonomous AI trader that bets BTC up/down on DeepBook Predict + directional spot bets on SUI/WAL/DEEP via DeepBook v3, deciding from real signals + the live on-chain SVI vol surface, gated by a revocable Move policy you hold. |
| **Why it matters** | People want AI to act with their money but fear losing control. We give autonomy *with* a blockchain-enforced leash you can yank instantly. "The AI is not trusted — the policy is." And the AI isn't a black box — every decision is grounded in numbers the user can verify on chain. |
| **How it works** | Connect a Sui wallet (Slush/Suiet) → adopt → name → set leash → pick markets → one signature. The trader observes spot, computes signals, reads the live SVI surface, decides — or honestly abstains. You see the agent's actual reasoning ("Watch it think"). Revoke → chain refuses the next bet on any asset. Past wins still pay out via permissionless redeem/close. |
| **Sui stack** | OperatorPolicy + atomic PTBs (record_spend composes with the trade in one tx) · **DeepBook Predict** (binary up/down on BTC with on-chain SVI vol surface — the agent reads the same surface a market maker would) · **DeepBook v3 spot** (directional buy/sell on SUI/WAL/DEEP) · **Walrus** (verifiable accumulating agent memory — signals + SVI params + reasoning per decision) · **zkLogin** (Google onboarding wired, gated by Enoki; demo ships wallet path) · multi-wallet agent identity. |

---

## The demo (3 minutes)

A user lands on the deployed URL. They connect a Sui wallet (Slush /
Suiet) — Google sign-in is wired but gated by Enoki for testnet, so the
demo ships the wallet path that signs the same atomic PTBs.

They scroll into the gallery, pick the **Quant·Vol** personality (or
Momentum / Conservative / Contrarian), name their trader **Memory**, and
slide the leash to **2 SUI**. Step 3: *"Which markets?"* — three cards:
"BTC only" / "Sui ecosystem" / "All". They pick **All**.

One signature later, an `OperatorPolicy` materializes on chain with
`allowed_venues = [predict-btc, spot-sui, spot-wal, spot-deep]`, budget
cap 2 SUI-equivalent, kill switch armed. The page transitions into the
trader dashboard.

Within ~20 seconds Memory takes its first bet. The Open Position panel
fills in: *"Memory is betting UP on BTC."* Strike, spot at decision,
expiry. The mint tx digest is linked. The live BTC spot ticks every 8s;
a distance gauge shows how close we are to the flip.

**Then the showpiece** — directly below the position card, the *Watch it
think* panel renders. Four signal chips (ROC, SMA 60m, RSI, realized
vol) — each color-toned by what the value implies. The **SVI vol
surface block** with the five live on-chain parameters (`a, b, ρ, m, σ`)
read straight off the oracle. For Quant·Vol traders, the **edge moment**:
two horizontal bars — *Market says X.X% UP* and *Agent estimates Y.Y%
UP* — with the gap, the threshold, and the resulting direction called
out. Below: the plain reasoning. A "Verifiable on Walrus" pill at the
bottom links to the raw content-addressed blob. *This isn't a graphic —
the surface params change every cycle.*

If the agent doesn't see edge (`|edge| < 5%`), the panel headlines
"*Memory sat this one out · no edge*" with the same signal + surface
data and a "Why no bet" section. **Honest abstention with equal dignity.**
That's the actual frame the user is meant to absorb: this is an agent
disciplined enough not to force a bet — and you can see exactly why.

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

Click the dashboard's **"See {Name} on the leaderboard →"** CTA — the
`/leaderboard` page lists every adopted trader on testnet (17 today),
sorted by live trade count → realized P&L → asset breadth. The user's
trader is highlighted "You're #N · {Name}", emerald spotlight on rank
1, asset chips per row (BTC · SUI · WAL · DEEP). Each row links to that
trader's Walrus memory journal — *"here's how they earned their rank,
content-addressed, you can verify it."*

Vision close: *"This is one trader. The same primitives let a stable of
traders, each on its own leash, each picking its own markets. The
leaderboard is already live."*

---

## Why Sui specifically

Six Sui properties are load-bearing — remove any one and the product
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

4. **DeepBook Predict's on-chain SVI vol surface** — Each oracle exposes
   its volatility surface (`a, b, ρ, m, σ`) as live, queryable on-chain
   state. The trader reads it via a single chained `devInspect` PTB:
   `oracle::svi → svi_a/b/rho/m/sigma + spot/forward/expiry`. Decoding
   the I64 BCS gives the parameters in real numbers; plugging them into
   Black-Scholes-style implied probability inversion produces the
   market's `Pr(UP @ strike)`. The agent compares its own estimate
   against this market-implied number and bets only when the edge clears
   the threshold. **The agent literally reads the same vol surface a
   market maker would.** This is the deep Predict-track integration —
   not just minting from Predict, *reasoning from Predict*.

5. **DeepBook v3 spot pools** — Real CLOB-style orderbook with the same
   atomicity. Our spot bets are real market orders (`isBid` true/false)
   against SUI/DBUSDC, WAL/DBUSDC, DEEP/DBUSDC pools. No oracle
   dependency, no AMM-only slippage estimation.

6. **Walrus content-addressed storage** — Every decision a trader makes
   uploads as a Walrus blob — direction, strike, *plus the signal bundle
   the agent used and the SVI parameters it read off chain*. The
   cumulative memory journal regenerates per bet. The on-chain
   `Deliverable` carries the blob id, and the dashboard's "Watch it
   think" panel re-fetches the blob and renders it as structured cards.
   A judge can verify every number in the panel by opening the raw blob.

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
| **DeepBook (Predict)** | Real `predict::mint<DUSDC>` on the BTC oracle in an atomic PTB with `operator_policy::record_spend`. Mint tx, position event, policy spend event all on chain. **Plus deep oracle integration** — the agent reads the live SVI vol surface (`a, b, ρ, m, σ`) and forward off the oracle, inverts Black-Scholes-style to derive market-implied `Pr(UP @ strike)`, and bets only on a 5%+ edge. The Watch-it-think panel renders those parameters live every cycle. |
| **DeepBook (Spot)** | Real `pool::place_market_order` on SUI/DBUSDC for directional bets. Open + close + realized P&L all on chain. Multi-asset (SUI/WAL/DEEP) via the same pattern. Strategy decides from real signals (ROC, SMA, RSI, realized vol) the trader observes off the pool mid. |
| **Walrus** | Per-decision reasoning **including the signal bundle + SVI parameters that produced it** + cumulative memory journal upload to Walrus testnet. Blob ids in the on-chain `Deliverable`. The dashboard's "Watch it think" panel re-fetches the blob, parses the deterministic structure, and renders it as cards a judge can audit number-for-number against the raw blob. The agent that builds over time *and shows its work*, content-addressed. |
| **Agentic Web (Sub-track 2)** | The product *is* an autonomous AI agent with bounded delegated authority transacting on chain, **and the autonomous decision is grounded in on-chain market microstructure** (vol surface) rather than a heuristic. zkLogin + policy + atomic PTBs are the agent-grade primitives Sub-track 2 explicitly asks for. |

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
- **Agent runtimes:** Node.js + tsx. **Five pm2 processes** —
  `brief-web` (Next.js + UI + API routes), `brief-planner-service`
  (auto-approve loop), `brief-research`, `brief-treasury`,
  `brief-trader` — running on an Oracle Cloud VM behind Caddy with
  Let's Encrypt.
- **Smart-agent runtime (added in the final push):** per-asset rolling
  price-history poller (60s cadence, atomic tmp+rename JSON, MAX_POINTS
  600 ≈ 10h), deterministic signal library (ROC / Wilder RSI / SMA /
  realized vol), SVI vol-surface reader (chained `devInspect` PTB that
  walks `oracle::svi → svi_a/b/rho/m/sigma + spot/forward/expiry`, with
  I64 BCS decoded as 8 LE magnitude bytes + 1 sign byte), and four
  strategy functions that return `null` cleanly when there's no edge.

---

## Verifiable live artifacts (testnet)

Every digest below is queryable on Suiscan / Sui Explorer.

### Smart-agent live BTC mints (real signals + on-chain SVI surface)

The mints below were placed by the upgraded trader after the
real-signals / SVI / honest-abstention upgrade. Each Walrus blob lists
the signal bundle + SVI parameters the strategy actually used.

- **Momentum DOWN, qty 4, conv 0.50** — mint tx
  `7kJnuSVgP77FniFep3T8PkBcFtmm2w5qo9rSG2SpCTMP`, deliver tx
  `sLJR9a62qdEvkFLJmk9cfpba1gPCX91bv85yiWpf2Ut`. Signals at decision:
  5m ROC −0.20%, RSI 9.7 (oversold), realized vol 41.2% annualized;
  SVI params a=0.000525, b=0.023250, ρ=−0.2057, m=0.022261, σ=0.035143.
  Walrus blob `FPjKZJDYvsWQX52m-9z9mxq78XeMIKyRhGDWvlXnEmI`.
- **Momentum UP, qty 2, conv 0.39** (reversal after honest label fix) —
  mint tx `9mX9ewWnD4WGNKQKGDweXKgmdofL1H4ppzWLjRFBcaes`, deliver tx
  `5Un71DYkmHkXW79PWdEh4Ba9MVBiSYPhQwYSZgyZNASV`. Signals at decision:
  5m ROC +0.09%, RSI 30.1, realized vol 41.2%; SVI params a=0.000728,
  b=0.021966, ρ=−0.2056, m=0.023604, σ=0.027386. Walrus blob
  `cuPCF3WjpU0LOMt488oPX8hapxMAoCjdFibH-KhsYXw`. Same strategy, opposite
  direction — because the rolling signals genuinely moved.
- **Quant honest abstention** (cold price history) — sim deliver tx
  `7epX5xgJG3Sk2Axmkq8mQCnhvbpRH6TMpCzKwv8ZoVsP`, Walrus blob
  `kruyDraPTOBPlVe9WtLQ1HY_SXMqnPdhp1nbpMfLjH8`. No bet placed — the
  blob says exactly why (signals not yet computable). Discipline over
  forced action; same Watch-it-think panel renders this with equal
  dignity.

### Earlier live BTC mints (pre-smart-agent — clean atomic-PTB proof)
- `B5FYRVPZFr6WgzuTBhUa8kdadxke44pDGyta9jE26YSP` — strike $61,792, UP, 2 contracts
- `8pRZJvRS4rwpcwxUQYcAS7bHjgbznpiFGcVLKF28gfob` — strike $61,882, UP, 2 contracts
- `BuaNf8qxojU7GkvWCxWx4sAdgyFhMQTnT9P1DATX6Dcd`
- `4BcXnzEXXVHAHA9urKKJYLYG4zvsfqreCoxjugynUdNH`

All cleanly compose `operator_policy::record_spend` + `predict::mint`
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

Smart-agent reasoning blobs (signals + SVI surface + reasoning per the
new format the Watch-it-think panel parses):
- `FPjKZJDYvsWQX52m-9z9mxq78XeMIKyRhGDWvlXnEmI` — Momentum DOWN
- `cuPCF3WjpU0LOMt488oPX8hapxMAoCjdFibH-KhsYXw` — Momentum UP (reversal)
- `kruyDraPTOBPlVe9WtLQ1HY_SXMqnPdhp1nbpMfLjH8` — Quant honest abstention

Cumulative memory journals (regenerate per trade, same content-addressed
discipline):
- `9AHcDqtJNwFHUtbk6z-vY1hGXPDOV21cLmZcTAxPLl4` — 6 entries
- `KUNs69umKUrSH_NLVbvmncZnFlW2TZJMMWzd6CmQWNk` — 5 entries

Older blobs from the original product layer (Walrus-track regression set):
- Reasoning: `IQhlCLZ6zOYk2IVOC2MQSJ8Ue5KFnob0ZELaqXDRoI0` (427 B)
- Reasoning #2: `WinmOb1EFjYYpL9Qo0hFiYMFvVWIjkUaJ3-otLpr2iA`
- Journal (entries=2): `8u3tXnXZBF2ZTv6hqlQ2HLKiNe5B5lH35jiUB-YBBPI` (1.4 KB)
- Journal (entries=4): `YXzw_41WhnncBaz0Pfk4MmNojQxPbnelbCIuOQxCeiM`
- Reasoning #4: `aXZmPOwoji3wFnZmspWVrr4_BbEMBS6a3sA0aRN5s3w`
- Treasury smoke test: `7rSbhSkYPt7eoHcLSO2v8CXRfAlU6SLa_ofv1aL4xz8`

All blobs fetchable at
`https://aggregator.walrus-testnet.walrus.space/v1/blobs/{blobId}`.

### Honest W/L (no rigged outcomes)
- **SUI spot bet pair, realized P&L −$0.009 DBUSDC** — bet DOWN, SUI
  rose ~1.2% while we were short, the bet lost. The math is honest and
  on chain. Second cycle via lib e2e: −$0.0089.
- **BTC live mints above are in-flight** until the BTC oracle settles at
  expiry `2026-06-12T08:00:00Z`. Auto-redeem polls every 30s and will
  call `redeem_permissionless` once the oracle posts the settlement
  price; the realized P&L will be whatever the chain pays. (See "What's
  unresolved at submission time" below.)

### Infrastructure
- Treasury wallet (trader agent):
  `0xa9f24640b32f33fcfa8582791e84a542251398acfc3b696f382a08a768b6ddbf`
- Planner wallet (policy owner during tests):
  `0xd440b0b59ed5474b32ceb71d819c474e1512747179b7088ff324012767f5b435`

---

## What we'd build next

1. **Pyth-priced multi-asset markets (ETH, SOL).** DeepBook testnet has
   no ETH or SOL pools. A custom `brief::up_down_market` Move module
   reading Pyth feeds with a treasury-funded house pool unlocks the
   most-rooted-for tickers. Sketch ready; held out of this submission
   to keep the demo bulletproof.

2. **Open-source the smart-agent loop.** The per-asset signal pipeline,
   SVI surface reader, and the Black-Scholes implied-probability
   inversion are independently useful for any DeepBook-Predict bot. We'd
   carve them out as `@kyvernlabs/predict-signals` so other teams can
   reason from the surface without re-implementing the chained
   devInspect + I64 decoder dance.

3. **Surface-aware spot strategies.** Predict has a vol surface; spot
   pools have a depth + spread surface. Same Watch-it-think frame,
   different data — "agent estimates fill at $X, book says $Y, edge is
   the slippage budget."

4. **Mainnet.** Predict and DeepBook spot both have mainnet deployments.
   The Move package is upgrade-published; mainnet migration is a deploy
   run + config swap, not a rewrite.

## What's unresolved at submission time

- **The live BTC mints settle Jun 12 ~08:00 UTC.** Until then, "Watch
  it think" shows the bet as in-flight, and the realized P&L line in
  the dashboard reads `—`. After settlement: auto-redeem fires, the
  payout appears in the Treasury wallet, and the leaderboard's
  per-trader P&L tile flips from neutral to colored. Honest result
  either way — no rigged wins.

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
