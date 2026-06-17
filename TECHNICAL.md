# Brief — Technical Deep Dive

*How the product and the agent actually work, in words. Written so you can read it, understand every step, and discuss it. Last updated 2026-06-16.*

---

## 0. The one-paragraph mental model

A user deposits their own USDC into **their own** DeepBook account (a BalanceManager), then hands an AI **operator** two things: a *trade-only* key (it can place orders but never withdraw) and an on-chain **policy** (a budget cap + rules). A program — the **agent** — runs 24/7, reads the market every 45 seconds, and for each adopted operator runs a transparent reasoning pipeline (observe → recall memory → build a thesis → argue against it → check risk, execution quality, and policy → decide). When it decides to trade, the trade and the policy check happen in **one atomic on-chain transaction**: if the trade would break the budget, the venue, the expiry, or a revocation, the **chain itself rejects the whole thing** — no funds move. The frontend just watches this over a live wire and renders it. Nothing about "the AI won't overspend" is a promise — it's a Move contract.

---

## 1. The big picture — four layers

```
┌──────────────────────────────────────────────────────────────┐
│ 1. SUI BLOCKCHAIN  (the trust core)                          │
│    • DeepBook v3: BalanceManager, TradeCap, DepositCap,      │
│      the spot order book (SUI/USDC)                          │
│    • brief::operator_policy  — the leash (budget/venue/      │
│      expiry/revoke), enforced by record_spend()             │
└──────────────────────────────────────────────────────────────┘
            ▲ signs txs                  ▲ reads state
            │                            │
┌──────────────────────────────────────────────────────────────┐
│ 2. THE AGENT  (a Node/TS program on a VM, pm2: brief-trader) │
│    Every 45s: read market → per operator: reason → (maybe)   │
│    place ONE gated trade → record memory → emit live events  │
└──────────────────────────────────────────────────────────────┘
            │ Server-Sent Events (SSE) + REST
            ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. THE FRONTEND  (Next.js on Vercel)                         │
│    Landing · Wizard · Operators home · live Dashboard ·     │
│    Brain (decision replay) · Proof (on-chain verification)   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ 4. WALRUS  (decentralised storage)                           │
│    The operator's journal, manifesto, and experience memory  │
│    — content-addressed, so it can't rewrite its own history. │
└──────────────────────────────────────────────────────────────┘
```

**Where each lives:**
- Chain: testnet now (Brief package `0xe550…fb9d`; DeepBook v3 `0x22be…1a3c`; SUI/DBUSDC pool `0x1c19…63a5`).
- Agent: a VM, run by pm2 as `brief-trader` (TypeScript via `tsx`, no build step).
- Frontend: `brief-olive.vercel.app` — it calls the VM's API + SSE cross-origin.

---

## 2. The on-chain layer — the trust core

Everything rests on **DeepBook v3's BalanceManager** plus a tiny Move package (`brief::operator_policy`). **One adoption transaction** wires up the whole non-custodial relationship:

1. **BalanceManager (BM)** — created and **owned by the user**. Their capital lives here. It's a *shared object*, but withdraw is gated to the owner, so the user keeps custody forever.
2. **TradeCap** — minted by the user, **handed to the operator**. It authorises placing orders from the BM. It **cannot withdraw**.
3. **DepositCap** — minted by the user, **handed to the operator**. It authorises *depositing* DEEP (the fuel for fees) into the BM. It **cannot withdraw** either.
4. **OperatorPolicy** — the leash. A shared object with: `budget_cap`, `allowed_venues` (e.g. `["spot-sui","spot-wal","spot-deep"]`), `expires_at_ms`, `agent` (the operator's address), `revoked`, and a running `spent` counter.
5. The user keeps the **WithdrawCap** — the only key that can pull funds out.

### The gate: `record_spend()`

This is the heart. Before any trade, `operator_policy::record_spend(policy, amount, venue, clock)` runs and **asserts** (each abort has a fixed code):

| Check | Abort if false | Code |
|---|---|---|
| caller **is** the policy's agent | `ENotAgent` | 2 |
| policy **not** revoked | `EPolicyRevoked` | 3 |
| `now < expires_at_ms` | `EPolicyExpired` | 4 |
| `spent + amount ≤ budget_cap` | `EBudgetExceeded` | 5 |
| `venue ∈ allowed_venues` | `EVenueNotAllowed` | 6 |

If all pass, it adds `amount` to `spent` and emits a `PolicySpend` event. **Crucially**, `record_spend` and the actual DeepBook order are placed in the **same transaction (PTB)**. In Move, if any instruction aborts, the *entire* transaction reverts. So:

> If the operator tries to spend past its cap (or after revocation/expiry, or on a wrong venue), `record_spend` aborts → the DeepBook order in the same tx never runs → **no funds move**. Enforcement isn't our backend trusting the AI; it's protocol-level reversion.

That single failed transaction (a real one is preserved on the Proof page) is the strongest artifact in the whole product.

---

## 3. The agent — how it runs

The agent is a long-running TypeScript process on a VM. It **signs as the operator/treasury key** — the single address every adopted policy names as its `agent`. It's the "operator" behind every leash. It runs several loops; the important one is the **gated-spot loop**.

### The master loop — `startGatedSpotLoop` → `gatedSpotTick`, every 45 seconds

```
TICK (every 45s):
  1. Load the operator registry (.cursors/operator-registry.json) — every
     adopted operator (policyId, BM, TradeCap, DepositCap, owner, mode, goal,
     mandate, network). Skip revoked + already-retired ones.
  2. Read the SUI/USDC mid price ONCE (devInspect on pool::mid_price).
     Append it to a rolling price history file.
  3. Compute the SIGNAL BUNDLE from that history (ROC, SMA, RSI, vol). [§4]
  4. Consolidate the agent's gas coins (so many trades from one wallet
     don't fragment gas).
  5. FOR EACH active operator → runGatedOperator (steps below).
```

(A separate loop appends the price history every 60s; another redeems/settles; the warden tops up the agent's gas.)

### Per operator — `runGatedOperator`

This is the decision + execution cycle for one operator, in order:

```
1. Resolve its MODE (Protect/Grow/Aggressive) from the registry.
   Emit "observe" (price) and "signals" events on the live wire.

2. READ THE POLICY BUDGET on-chain → cap, spent, remaining.
   recordSpendAmount = one min-lot of SUI at the current mid, in 6dp DBUSDC
                     = floor(1 * mid * 1e6).
   budgetExhausted = (remaining < recordSpendAmount).   ← graceful cap stop

3. CAPITAL + MANDATE: read the BM's USDC + SUI balances, mark to market
   (value = usdc + sui*mid). Track the peak. If a mandate is set and the
   drawdown from peak ≥ the limit → mandate "breached". Emit the live
   portfolio value (this is the "Operator Capital" card). [§9]

4. EXPERIENCE: load the operator's own decision history, settle any matured
   past trades against the latest price, then RECALL the most similar past
   regimes → a confidence multiplier + a one-line note. [§7]

5. DECISION ENGINE, PASS 1: run the reasoning over signals + memory (no
   execution analysis yet) → a provisional decision. [§5]

6. If pass 1 says "act": DEEPBOOK EXECUTION ANALYSIS — simulate the real
   order against the live book → slippage, depth, DEEP fee. A thin book or
   slippage > 1.5% can VETO. Then re-run the engine (PASS 2) with that
   result folded in. [§8]

7. Emit the rich "decision" event (thesis, counterargument, risk, execution,
   policy, verdict, mode, recall, mandate, portfolio) → the dashboard renders
   the living timeline from this.

8. RECORD the decision into the experience memory (an ACT is "pending" until
   it settles; an abstention is terminal). Anchor an experience snapshot on
   Walrus (throttled).

9. If the decision is ABSTAIN → stop here. "Capital protected" is a
   first-class, successful outcome. (Most ticks abstain — that's discipline.)

10. If the decision is ACT:
    a. FUEL CHECK — make sure the BM's DEEP tank can pay the DeepBook fee;
       top it up via the DepositCap if low. [§10]
    b. INVENTORY CHECK — a buy needs USDC, a sell needs SUI; skip honestly
       if that side isn't funded.
    c. GATED TRADE — one atomic PTB: record_spend(...) + place_market_order
       from the user's BM via the TradeCap. The chain authorises the spend,
       then the order fills. [§11]
    d. Record the on-chain tx digest, write the journal to Walrus, emit the
       "spot_opened"/"delivered" events.
```

**Why deterministic?** None of steps 4–6 use an LLM or randomness. Every number is derived from the persisted price history, so a third party can recompute the agent's exact reasoning. (An optional AI layer can *narrate* a decision on demand — but it never runs in this loop and never decides; see §14.)

---

## 4. The signals — turning price into numbers (`signals.ts`)

Each tick we have a rolling list of `{ts, price}` points. From it we compute a **signal bundle** (every field is `null` if history doesn't reach back far enough → "no signal, sit out"):

- **ROC (rate of change)** over 5m / 30m / 60m: `(now − then) / then`. E.g. `+0.012` = +1.2%. This is the trend's *direction and strength*.
- **SMA (simple moving average)** over 15m / 60m: the average price in that window. Comparing the short MA to the long MA tells you if the trend is *aligned*.
- **RSI (60m, Wilder)**: 0–100. Sums up-moves vs down-moves in the window → `100 − 100/(1+gains/losses)`. ~50 = balanced; >70 = overextended up (exhaustion risk); <30 = oversold. *(Shown to users as words — "momentum overextended" — never the raw number on primary screens.)*
- **Realized volatility (60m)**: annualised standard deviation of log-returns. How choppy the market is.

That's the entire perception layer — fast, transparent, reproducible.

---

## 5. The decision engine — `decision-engine.ts`

One engine, one function (`runDecisionEngine`), called with the signals, the mode, the budget state, the mandate state, and the memory/execution add-ons. It produces a structured `OperatorDecision`. Here's the logic **in words**:

**a. Direction.** `up` if 30m ROC ≥ 0, else `down`. (The directional lean.)

**b. Trending?** `trending = |30m ROC| ≥ the mode's rocFloor`. Below the floor, the tape is "flat" — there's nothing to ride.

**c. Thesis** (the case *for*): e.g. *"SUI firming: 30m ROC +1.20% (5m +0.60%), spot $0.802 above the short MA → leaning UP."*

**d. Counterargument** (the case *against*) — the engine argues with itself:
- flat tape → *"30m ROC sits inside the ±band. No trend to ride."*
- up + RSI over the ceiling → *"Momentum overextended — exhaustion risk on a long."*
- down + RSI very low → *"Momentum deeply oversold — snap-back risk on a short."*
- otherwise → *"No strong counter-signal — momentum confirmed across ROC and the MA."*

**e. Confidence (0–1)** — built multiplicatively:
```
confidence = clamp(|30m ROC| / 0.01, 0..1)   // trend strength (1% ROC ⇒ full)
           × (MA aligned ? 1 : 0.6)            // penalise if MAs disagree
           × (trending ? 1 : 0.25)             // flat tape nearly kills it
           × (RSI exhaustion on this side ? 0.5 : 1)   // overextended penalty
           × memory.confidenceMult             // experience reshapes it [§7]
```

**f. Risk review** — a human line: budget % used, realized vol, and the bar this mode requires.

**g. Policy review** — the operator's own pre-check ("within budget, not revoked, not expired, venue allowed — the Move policy will re-check this atomically"). The chain is the real gate; this is the operator showing its work.

**h. Execution review** — filled by the DeepBook simulation [§8] when acting.

**i. The decision rule** — it acts only if **all** are true:
```
act =  confidence ≥ mode.minConfidence
   AND trending
   AND execution approved          (not a thin book / excessive slippage)
   AND NOT budgetExhausted          (room for one more min-lot)
   AND NOT mandateBreached          (drawdown guard not tripped)
```
Otherwise it **stands down**, and the verdict says exactly why (flat tape / below the bar / budget deployed / mandate guard / execution).

That's it. No black box — every input and every gate is inspectable, and the Brain page replays all of it per decision.

---

## 6. The three modes — Protect · Grow · Aggressive

There is **one** operator and **one** engine. A "mode" is just three knobs that set how hard it leans in. (`MODE_CFG` in `decision-engine.ts`.)

| Mode | minConfidence (the bar to act) | rocFloor (what counts as "trending") | rsiCeiling (overextended above this) |
|---|---|---|---|
| **Protect** | **0.66** | 0.40% | 64 |
| **Grow** (default) | **0.50** | 0.25% | 72 |
| **Aggressive** | **0.38** | 0.15% | 80 |

What each *means behaviourally*:

- **Protect — "most days: no trade."** Needs **66%** confidence and a clearly-formed trend (≥0.40% 30m ROC). Flags exhaustion early (RSI > 64). So it sits out chop and only acts on a strong, confirmed move. Most cycles end green ("capital protected"). For someone who wants the operator to be a sentinel, not a trader.

- **Grow — "most days: 1–3 decisions."** The balanced default. Acts at **50%** confidence, treats ≥0.25% as a trend, tolerates RSI up to 72. Trades a genuine edge, stands down on noise.

- **Aggressive — "most days: several decisions."** Lowest bar — acts at **38%**, treats even 0.15% as trending, tolerates RSI up to 80. More trades, more risk, accepts more uncertainty. Still hard-capped by the same on-chain leash.

**Worked example (real, from the live operator).** SUI is "strongly bullish" but RSI is extreme → the counterargument fires ("momentum overextended"), which halves confidence to **44%**.
- Under **Grow** (bar 50%): 44% < 50% → **NO TRADE, capital protected.**
- Under **Aggressive** (bar 38%): 44% > 38% → it would **ACT (buy)**.
Same market, same engine — the mode is the only difference.

Under the hood each mode also carries a legacy *personality* + *goal* label (Protect↔conservative/preserve, Grow↔momentum/grow, Aggressive↔contrarian/edge) purely so the journal/manifesto keep reading; the engine runs off the mode.

---

## 7. The Experience Engine — memory, not logs (`experience.ts`)

The operator **remembers** and lets the past reshape the present.

- **Regime fingerprint** of every decision: `{ roc30, rsi, trend(-1/0/1), vol }` — a compact description of "what the market looked like."
- **Recall**: before deciding, it measures the distance between *now* and every past regime (each axis normalised — 1% ROC ≈ 1 unit, 20 RSI points ≈ 1 unit, trend is categorical, 1% vol ≈ 1 unit), keeps the **3 closest** within a similarity threshold, and looks at how they turned out.
- **Confidence shaping** (the `confidenceMult` in §5e):
  - more losses than wins in similar situations → **×0.70–0.85** (dampen)
  - more wins → **×1.08** (reinforce)
  - none settled yet → ×1 ("first time in conditions like these — recording it")
- **Settlement**: an ACT is stored "pending"; once an hour passes, it's marked **win/loss** by comparing the decision's price to the later price (did the directional call pay off?). That feeds future recalls.
- **On Walrus**: a snapshot of this experience is uploaded (content-addressed), so the memory the operator reasons from is *verifiable*, not just claimed. This is the difference between "stored on Walrus" and "**uses Walrus to improve future decisions**."

So a real recall reads like: *"Found 3 similar situations: 2 settled against → confidence reduced ×0.70."*

---

## 8. DeepBook execution analysis (`spot-handler.ts → readSpotExecution`)

Before firing, the operator **simulates the actual order against the live order book** (a read-only `devInspect` — no signing, no cost):

- a **buy** uses `pool::get_base_quantity_out(quote)`; a **sell** uses `pool::get_quote_quantity_out(base)`.
- from the result it computes the **effective fill price vs the mid → slippage %**, the available depth, and the **DEEP fee** the fill needs.
- if the book is too thin to fill cleanly, or slippage exceeds **1.5%**, it **vetoes** the trade (the engine flips to abstain).
- **fail-safe:** if the read fails for any reason, it does **not** block — the on-chain order + the Move policy remain the true gate.

Verified live: selling 1 SUI on the SUI/DBUSDC pool ≈ **0.51% slippage**. This is what makes the "Execution" step show real numbers, not invented ones.

---

## 9. The mandate — a goal the operator can't violate (`mandate.ts`)

Optional at adoption: **target return % · horizon (days) · max drawdown %** (e.g. *"grow 15% in 180 days, never down more than 8% from peak"*).

- Each cycle the operator **marks its portfolio to market** (USDC + SUI·mid), tracks the **peak value**, and computes the drawdown from that peak.
- If drawdown **≥ the max** → the engine **hard-vetoes** new trades ("mandate guard tripped — standing down"). It will not open risk that violates the human's instruction.
- The on-chain `budget_cap` is the absolute floor; the mandate is a *tighter, human* guard layered on top.
- Shown live in the dashboard (objective + a drawdown bar that goes green→amber→red) and anchored on Walrus.

The memorable line: **user sets a mandate → operator acts toward it → if it would breach, it (and ultimately the chain) refuse.**

---

## 10. Fuel — why DEEP, and the auto top-up

DeepBook charges a small fee in its native **DEEP** token for non-whitelisted pairs (SUI/USDC is one). So each trade needs a little DEEP in the BM. The user never thinks about this:

- the operator keeps a small **DEEP tank** in the BM.
- if it drops below ~**0.05 DEEP**, the house deposits **2 DEEP** via the delegated **DepositCap** (deposit-only — can't withdraw the user's funds).
- if the house reserve is dry, the operator idles with an amber "awaiting fuel" — alive, capital untouched.

This is how "your operator comes fuelled" stays true *and* non-custodial.

---

## 11. The trade itself — one atomic gated PTB (`deepbook-spot.ts`)

When the operator acts, it builds **one** programmable transaction with two moves:
1. `operator_policy::record_spend(policy, recordSpendAmount, "spot-sui", clock)` — the gate (§2).
2. `pool::place_market_order(pool, BM, tradeProof, baseQty, isBid, …)` — the actual DeepBook order, from the **user's** BM, authorised by the **TradeCap**.

Order size is **one min-lot = 1 SUI** per edge; the real ceiling is the budget cap. Because both moves share the transaction, the spend is authorised and the order fills **together, or not at all**. The `PolicySpend` event it emits is the on-chain witness shown on the Proof page.

---

## 12. The kill switch — revoke (`operator_policy::revoke`)

The user signs one transaction that flips `policy.revoked = true`. On the **next 45s tick**, the operator's `record_spend` aborts with `EPolicyRevoked` (code 3); the loop catches that terminal abort and **retires** the operator (skips it + marks it in the registry). No backend call, no API-key rotation. Funds stay in the user's BM; only *new* trades are blocked, and past wins still settle.

---

## 13. Walrus — the verifiable memory

Three things go to Walrus, all content-addressed (so they can't be silently rewritten):
- **Journal** — the operator's full decision log, re-uploaded as it works.
- **Manifesto** — published once at adoption: declared identity, calibrated parameters, and a pledge ("I act only on edge; I never exceed the policy the chain enforces; my owner can revoke me anytime").
- **Experience snapshot** — the memory the recall step reasons from (§7).

---

## 14. The frontend — what renders, and from what

It's a Next.js app. It holds **no trading logic** — it reflects the chain + the agent's live wire.

- **The live wire** (`use-agent-stream.ts`): opens a Server-Sent-Events connection to `/api/agent-events?policy_id=…` and reduces the stream (observe → signals → decision → fuel → executed) into one state object. This drives everything "live."
- **Surfaces (the ecosystem):**
  - **Landing (`/`)** — the pitch; its CTA adapts (new user → wizard; returning → your operators).
  - **Wizard (`/workforce/adopt`)** — the single adoption flow: choose a mode (behaviour, not jargon) → set the budget (the leash) → optional mandate → deposit (with one-tap "Get test USDC") → **one signature** that creates the BM, deposits, delegates TradeCap + DepositCap, and creates the OperatorPolicy.
  - **Operators home (`/workforce`)** — your **fleet**: every operator as a premium card (name, mode, live status, budget). Click one to open it.
  - **Dashboard (`/workforce?policy=…`)** — the command center, one scroll: **Hero** (status + last decision + 4 stats) → **Operator Capital** (live mark-to-market) → **Market State** (a sentence) → **Right now** (the living timeline of the current decision) → **Timeline · experience** (history) → **Policy & proof** (collapsible, incl. the Active→Revoke→Withdraw lifecycle).
  - **Brain (`/brain?policy=…`)** — one decision per screen, read like a black box: What I saw → remembered → could go wrong → execution quality → policy → decision → outcome, plus a prior→recent win-rate ("operator evolves").
  - **Proof (`/proof?policy=…`)** — five clickable on-chain/Walrus artifacts: the policy, the spend events, the failed over-budget trade, the revocation, the manifesto. Walletless + shareable.
- **APIs (served by the VM):** `/api/operators/register` (writes the registry the loop reads), `/api/operators/decisions` (the Brain archive), `/api/operators/proof` (assembles the proof from chain + Walrus), `/api/trader/signals` (the live feed), `/api/agent-events` (the SSE wire).
- **The optional AI layer (not in the loop):** the engine has a seam (`opts.ai`) where an LLM could author the thesis/counterargument *instead of* the deterministic text — but the Move policy still gates execution, so the AI never moves money. It is designed to run **on-demand only** (a button), never in the 24/7 loop, because the API budget is tiny. Today it is **unwired**; the loop is 100% deterministic and free.

### End-to-end data flow

```
Wizard: one signature
   → on-chain: BM + TradeCap + DepositCap + OperatorPolicy created
   → POST /api/operators/register  (operator added to the registry)
        ↓
Agent loop (every 45s) reads the registry → reasons → (maybe) trades on
DeepBook in one gated PTB → records memory → emits SSE events
        ↓
Dashboard subscribes to /api/agent-events → renders Capital, Market State,
the living timeline, the experience, in real time
        ↓
User can Revoke (one tx) → next tick the chain refuses → operator retired
```

---

## 15. Networks

- **Testnet — live now.** Capital coin is **DBUSDC** (DeepBook's test USDC), pair **SUI/DBUSDC**. The agent/treasury is the operator + holds the DEEP fuel reserve. Honest caveats: testnet SUI ≈ $0.80 on the testnet pool (real price discovery, not mainnet), and testnet RSI can saturate because the pool barely moves — which is why momentum is shown as words.
- **Mainnet — code is network-aware.** The adoption PTB, the gated trade, and the loop all switch to **real USDC + mainnet DeepBook** when `network = mainnet`. What's left to flip: publish the Move package on mainnet, wire the mainnet pool ids + trader context, fund the treasury, and re-verify DeepBook's mainnet package id.

---

## 16. Key constants (quick reference)

| Thing | Value | Where |
|---|---|---|
| Loop cadence | **45 s** | `GATED_LOOP_POLL_MS` |
| Price history cadence | 60 s | `PRICE_HISTORY_POLL_MS` |
| Order size per edge | **1 SUI** (min lot) | `GATED_BASE_QTY` |
| Trade venue | `spot-sui` | `GATED_VENUE` |
| Fuel floor / top-up | 0.05 DEEP / +2 DEEP | `FUEL_FLOOR_BASE` / `FUEL_TOPUP_DEEP` |
| Experience settle horizon | 1 hour | `SPOT_HORIZON_MS` |
| Max execution slippage | 1.5% | `readSpotExecution` |
| Recall set size / threshold | 3 / 1.5 | `experience.ts` |
| Protect / Grow / Aggressive bars | 0.66 / 0.50 / 0.38 | `MODE_CFG` |
| Abort codes | NotAgent 2 · Revoked 3 · Expired 4 · BudgetExceeded 5 · VenueNotAllowed 6 | `operator_policy.move` |

---

## 17. The thesis, in one line

**The AI decides; Move enforces; the user revokes; the funds never leave the user's custody; and every step is verifiable on-chain and on Walrus.** The intelligence is transparent and free (deterministic); the *guarantees* are the protocol's, not ours. That's what makes Brief different from every other "AI trading agent."
