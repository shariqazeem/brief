# How the Brief operator actually works

Plain-English, end-to-end. No design talk — just *what the agent does, why it
does it, and how every page reflects its real activity*. Everything here maps
to real code + real on-chain behavior on Sui mainnet (package
`0x60daa61dbcf925f431b1fb89cac27d6be55cb2a1c686509ec7801d78e3702210`).

---

## 1. The one-sentence model

> An **operator** is an autonomous AI that manages **your** money on Sui —
> it can **trade** your funds but can **never** withdraw them, it can **never**
> exceed the budget you set, and you can **kill it in one click**. The Sui
> blockchain enforces all of that, not our backend.

Three on-chain pieces make this true:

| Piece | What it is | Who controls it |
|---|---|---|
| **BalanceManager (BM)** | A DeepBook v3 account that holds your USDC + any tokens it buys | **You** (owner) |
| **TradeCap** | A delegated capability: "you may place orders from this BM" | Held by the **operator** (the agent) — trade-only |
| **OperatorPolicy** | The on-chain leash: budget cap, allowed venues, expiry, revoked flag, and the agent's address | **You** create it; **only you** can revoke it |

The operator (the agent wallet, `0xa9f24640…`) holds the TradeCap. **It never
holds the WithdrawCap.** That single fact is the whole safety story: the agent
can move your money *within* DeepBook, but it physically cannot send it
anywhere. Only you can withdraw.

---

## 2. What happens the moment you adopt (one signature)

When you click adopt and sign once in your wallet, a single atomic transaction
(`buildAdoptTx`) does all of this on-chain:

1. **Creates your own BalanceManager** — a fresh DeepBook account that *you* own.
2. **Deposits your USDC** into it (e.g., $5).
3. **Mints a TradeCap and hands it to the operator** — the agent can now trade,
   but the cap is trade-only (minting a WithdrawCap is never done for the agent).
4. **Mints a DepositCap to the operator** — lets the house top up "fuel" (DEEP
   for fees) into your BM later, deposit-only, never withdraw. (On mainnet the
   operator pays fees from the traded asset, so this is rarely needed — but it's
   there.)
5. **Creates the OperatorPolicy** — the leash, with:
   - `agent` = the operator's address (only this address can trade your BM)
   - `budget_cap` = a **cumulative trading allowance** = your capital × the
     mode's turnover multiple (**Protect 3× · Grow 5× · Aggressive 8×**). It
     bounds the *total turnover* the operator may ever transact — large enough to
     buy/sell/rebalance for weeks instead of retiring after one deployment. Your
     **deposited capital is the real hard limit** (only you can withdraw it); the
     allowance is an additional on-chain ceiling on activity.
   - `allowed_venues` = `spot-sui`, `spot-wal`, `spot-deep`
   - `expires_at_ms` = an expiry date
   - `revoked` = false

After that transaction, the wizard reads the new object IDs and **registers the
operator** with the agent (an off-chain record: policy id, BM id, TradeCap id,
owner, mode, network). That's the agent's signal to start working on your
operator. **No money was sent to Brief. It's all in your own account.**

---

## 3. The autonomous loop — what the agent does, every cycle

The agent (`brief-trader`, a process running 24/7 on the server) wakes up
**every 15 seconds** and, for each adopted operator, runs one full decision
cycle. Here's exactly what it does, in order:

### 3a. Look at the market (every asset)
For **each** asset the operator can trade — **SUI, WAL, DEEP** (all priced in
USDC on DeepBook v3) — the agent:
- Reads the **live pool mid-price** from DeepBook on-chain (`pool::mid_price`).
- **Backfills ~24h of real price history** from CoinGecko the first time, so a
  brand-new operator isn't blind — it can see multi-hour and daily trends
  immediately instead of waiting 30+ minutes to accumulate data.
- Appends the new live price point to its rolling history.
- Computes **signals**: rate-of-change over 5m / 30m / 60m / **4h / 24h**, RSI
  (momentum), moving averages, realized volatility.
- **Classifies the regime**: `Trending up`, `Trending down`, `Breakout`,
  `Range-bound`, or `Mean-reversion`.

### 3b. Pick the asset with the best opportunity
The operator only holds USDC to start, so it can only **open longs** (buy). It
scores each asset: a **tradeable up-trend** is a buy candidate; the strength
comes from the stronger of the 30-minute or 4-hour momentum. It picks the
**highest-conviction up-trend**. If nothing is trending up, it looks at what
it's already holding (to possibly trim), and otherwise defaults to SUI just to
record an honest "I'm watching, no edge" decision.

### 3c. Mark the whole portfolio to market
It reads the BM's real balances — USDC cash + SUI + WAL + DEEP — and values
them at current prices. That's the honest "how much money do I have right now"
and "what do I own," across all tokens.

### 3d. Run the decision engine (a transparent 7-step pipeline)
Mode-calibrated (you chose Protect / Grow / Aggressive at adoption):

1. **Observe** — the price + signals.
2. **Thesis** — the case *for* a move ("SUI firming: 30m ROC +0.4%, 4h +1.6%…").
3. **Counterargument** — the case *against* (flat tape? overextended RSI?).
4. **Risk review** — budget used, realized vol, the mode's confidence bar.
5. **Policy check** — does this respect the on-chain leash + your mandate?
6. **Execution review** — *simulate the real order against the live DeepBook
   order book* (`devInspect`) for slippage and depth; a thin book or bad
   slippage **vetoes** the trade.
7. **Decision** — act, or stand aside.

### 3e. Think in allocations, not trades (the allocator)
This is the part that makes it a *capital manager*, not a trade firehose. Each
mode has an **exposure ceiling**:

| Mode | Max exposure to a risk asset |
|---|---|
| Protect | 30% |
| Grow | 55% |
| Aggressive | 85% |

The engine sets a **target exposure** (scaled by conviction, up to the
ceiling). It compares where capital *is* to where the thesis *wants* it, and
**only rebalances when the gap clears a 15% band** — so it doesn't churn on
noise. Direction follows the regime, so "Trending up" can never read as
"selling."

### 3f. Safety gates before spending a cent
- **Feasibility** — is there enough cash to buy one min-lot? (SUI ≥1, WAL ≥1,
  DEEP ≥10). If not, it holds honestly.
- **Pre-flight** — it `devInspect`s the *exact* gated transaction first. If it
  wouldn't clear on-chain, it skips — **no gas wasted on a doomed trade.**

### 3g. Execute — the gated trade (atomic)
If everything clears, the agent signs **one transaction** (as the operator
key, which must equal `policy.agent`) that does two things atomically
(`gated_spot::gated_spot_market_order`):

1. `operator_policy::record_spend(...)` — the **leash check** (see §4).
2. `pool::place_market_order(...)` — the **real DeepBook order** from *your* BM
   via the delegated TradeCap.

If the leash check fails, the order never happens. If the order fails, the
spend is rolled back. Move guarantees the atomicity.

### 3h. Record everything (this is what the pages read)
- Emits a **live decision event** (powers the dashboard waterfall over SSE).
- Appends to the **experience archive** (every decision, replayable — the
  Brain), periodically **anchored to Walrus** so the reasoning is verifiable,
  not just claimed.
- Appends to the permanent **ledger** (every allocation: decision → action →
  outcome).
- Updates **lifetime stats** (decisions, allocations, abstentions, drawdown,
  the SUI benchmark) — the Performance + Results numbers.

Each pending decision later **settles** win/loss at its ~1h horizon against
**its own asset's** later price (SUI vs SUI, DEEP vs DEEP — never cross-asset),
and any physically-impossible >100% outcome is dropped as corrupt. The return
baseline is the operator's **actual deposited capital** (not the larger trading
allowance), so the Performance/Results numbers are honest.

---

## 4. The leash — exactly what the chain enforces

Every trade routes through `operator_policy::assert_can_spend`, which aborts
the **entire** transaction if any of these fail:

| Check | Abort code | Meaning |
|---|---|---|
| sender is the bound agent | `ENotAgent` (2) | only your operator can trade your BM |
| policy not revoked | `EPolicyRevoked` (3) | you killed it → it can never trade again |
| not expired | `EPolicyExpired` (4) | past the expiry you set |
| spend ≤ budget cap | `EBudgetExceeded` (5) | it can never exceed your budget |
| venue is allowed | `EVenueNotAllowed` (6) | only the markets you permitted |

**This is the whole differentiator.** Competitors enforce limits in a
*backend* (a promise). Brief enforces them in a *Move contract* (the protocol).
We proved this on mainnet: the *same* trade that filled before a revoke
**aborted with `EPolicyRevoked` after** — order never placed, funds untouched.

**Why it can never run off with your money:** the agent holds only the
TradeCap. Withdrawing requires the WithdrawCap, which only *you* hold. Revoking
is one transaction *you* sign — no backend call, no API key to rotate; the
chain retires the leash forever.

---

## 4b. When you pull the plug — the non-custodial lifecycle

Two separate owner actions, both yours, both one signature:

- **Withdraw** (anytime): you pull your USDC + any held tokens out of your
  BalanceManager back to your wallet. This **drains the operator's book**, so the
  agent's next mark sees the balance collapse. The agent treats this correctly:
  it **freezes** the displayed value at the last funded mark and shows
  **"capital withdrawn · returned in full"** at ±0% — a withdrawal is *never*
  reported as a trading loss (it's the whole point of non-custody). It then
  **retires the operator cleanly** (stops cycling — no zombie loop burning
  resources), and the Results page reads *"Capital returned in full, on demand."*
- **Revoke** (anytime): `operator_policy::revoke`. The operator's very next trade
  aborts `EPolicyRevoked` on-chain — the order never reaches DeepBook. Your funds
  stay in your BM; you can still withdraw after revoking.

You can do either, in either order. Withdraw ≠ revoke: withdrawing pulls the
money; revoking kills the trading right. Both are enforced by the protocol, not
our backend.

---

## 5. Why it sometimes does *nothing* (and why that's correct)

If you watch it hold cash, that's the operator working, not broken. It abstains
when:
- the regime is **range-bound / mean-reversion** (no directional edge),
- no asset is in a tradeable **up-trend** (it won't buy a falling market),
- a rebalance isn't **feasible** (sub-lot cash),
- the **trading allowance is used up** (`spent ≥ capital × the turnover
  multiple` — a normal end state; the allowance lets it rebalance for weeks
  first, and the status reads "budget fully used · capital deployed," not an
  error),
- a **mandate drawdown guard** trips (it stands down to honor your limit).

Abstention is recorded as a **success**: "capital positioned, none at new
risk." In a down market, *not* losing is the win — e.g., holding cash while SUI
fell several percent beats riding it down.

> Honest framing: this is a **trust + control layer for agentic capital**, not
> an alpha machine. The engine is deterministic and disciplined. Its job is to
> be safe, transparent, and killable — and to act only on a real signal.

---

## 6. Every page — what it shows and how the agent updates it

All pages read **real** data: on-chain state (BM balances, policy `spent`,
DeepBook fills), the agent's recorded decisions/ledger/stats, and Walrus.
Nothing is rendered from a database of made-up numbers.

### Dashboard — `/workforce?policy=<id>`
The operator's home. Top is the **Operator Status Surface**: live state
(Observing / Executing / Grounded) with a pulsing indicator + "live · last
decision N seconds ago," the operator's current thinking as the headline
("No clear edge. Holding 48% in DEEP."), capital marked-to-market, and the
**live multi-asset allocation bar** (SUI / WAL / DEEP / cash). Below: your
funds (owner-only withdraw), performance vs holding SUI vs cash, the custody
chain, the ledger, reasoning, and the policy/proof.
**Updated by the agent:** live via SSE on each decision event + 15s polling of
the recorded scorecard/ledger/stats (so it stays truthful even if the live
stream drops).

### Brain — `/brain?policy=<id>`
Replays **every** decision as the operator reasoned it: *what it saw* (regime +
price), *what it remembered* (similar past regimes), *what it feared* (the
counterargument + the live execution check), *what it did* (e.g., "Added to
DEEP" / "Held position"), and *what happened* (settled outcome, with the
on-chain tx link).
**Updated by the agent:** every cycle writes a full replayable record to the
experience archive; the Brain reads it newest-first.

### Evolution — `/evolution?policy=<id>`
The operator getting *better*: lessons learned, regimes understood, its single
most valuable lesson, and a timeline of its growth — all derived from settled
outcomes (its real track record), not claims.

### Results — `/results?policy=<id>`
"Did it work?" The operator's return vs **holding SUI** vs **doing nothing
(cash)**, max drawdown, capital preserved, decisions made, trades executed,
trades avoided, and **0 policy violations / 0 custody incidents** — with a
**Mainnet · live, real USDC** status (network-aware).

### Proof — `/proof?policy=<id>`  ← the page that wins
Every claim as a **live on-chain artifact** you can click into Suiscan/Walrus:
1. The leash is a Move contract (budget authorized vs used, agent vs owner).
2. Every authorized trade is an on-chain `record_spend` event (real fills:
   SPOT-SUI, SPOT-DEEP…).
3. When it exceeds the cap, the chain reverts (`EBudgetExceeded`, a real failed
   tx).
4. The kill switch is a transaction, not a toggle (revoke → revoked policy).
5. The operator's reasoning is anchored on Walrus (immutable, content-addressed).
Read live from the Sui fullnode + Walrus aggregator — nothing from our DB.

### Workforce — `/workforce`
The operator gallery + the adopt flow (one signature, the wizard from §2).

### Leaderboard
Operators as a network (aggregate: how many live, decisions, capital,
violations).

---

## 7. Is it $30k-ready? (honest assessment)

**What it nails:**
- **Three tracks at once:** Core (an autonomous AI agent that *acts + transacts*
  on Sui), **DeepBook** (real multi-asset orderbook trading), **Walrus**
  (verifiable reasoning).
- **Proven on mainnet, real USDC** — adopt → multi-asset gated trades → revoke →
  the chain blocks the next trade → withdraw 100%. Real tx hashes, not a demo.
- **The memorable, unique thing:** "agent attempts action → the chain rejects
  it → funds safe." Almost nobody shows that.
- **Honest by construction:** every number is on-chain or from the operator's
  real record; abstention is shown as discipline; no fabricated P&L.
- **Differentiated vs the obvious competitor (Beep):** on-chain *enforcement*
  vs a backend *promise*.

**Be honest about (so a judge can't catch you off-guard):**
- It is **not** an alpha machine — pitch it as the **trust/control layer** for
  agentic capital. The engine is conservative; in flat markets it holds.
- The decision engine is **deterministic** today; the Claude reasoning layer is
  on-demand narration, not the live decision-maker (the Move policy gates
  execution regardless). The `opts.ai` hook to make it the live decider exists
  but isn't wired (needs an API key).
- **Memory is real but shallow:** recalled past regimes genuinely modulate
  *confidence* (can flip act↔stand-down), but the per-regime **playbook is shown,
  not yet used to gate decisions**, and win/loss is marked on raw mid moves (no
  fees/slippage folded in yet), so the recorded record is optimistic.
- Fresh operators have **thin history** until they accumulate cycles.

**Bottom line:** the product is real, live on mainnet, multi-asset, and
on-chain-enforced — a genuine first-place contender. The remaining points are
in the **demo video** and the **submission narrative** ("the first agent wallet
controlled by on-chain law"), not more features.

---

*Everything above reflects the live code paths: `buildAdoptTx`
(deepbook-adopt), `gated_spot.move`, `operator_policy.move`, the trader's
`gatedSpotTick` + `runGatedOperator`, the decision engine, regime classifier,
signals + backfill, and the experience / ledger / stats stores that the pages
read.*
