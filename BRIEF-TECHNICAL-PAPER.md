# Brief — Technical Paper

**The first AI agent wallet governed by on-chain law.**
Sui mainnet · real USDC · non-custodial · LLM-guided · multi-agent · verifiable.

> A single reference for everything technical: the thesis, the architecture, the
> on-chain leash, every agent, every calculation, every page, and an honest
> 1st-place readiness assessment. Written to be read, discussed, and stress-tested.
> Everything here maps to live code + live on-chain behavior unless explicitly
> marked *roadmap*.

Mainnet package: `0x60daa61dbcf925f431b1fb89cac27d6be55cb2a1c686509ec7801d78e3702210`
Live: `https://usebrief.xyz` · canonical VM `141.148.215.239`

---

## 1. The one-sentence thesis

> An **operator** is an autonomous AI that manages **your** money on Sui — it can
> **trade** your funds but can **never** withdraw them, can **never** exceed the
> limit you set, and you can **kill it in one transaction**. The Sui blockchain
> enforces all of that, not our backend.

Everyone else builds agent wallets where the *backend* promises to behave. Brief
makes misbehavior **physically impossible** at the protocol layer, then makes the
agent genuinely intelligent on top of that floor. The moat is **enforcement +
transparency**, not alpha.

The four pillars (and the hackathon tracks they hit):
1. **On-chain enforcement** (Move `operator_policy`) — Agentic Web / Agent Wallet.
2. **Real autonomous trading** (DeepBook v3 spot, multi-asset) — DeepBook track.
3. **LLM-guided decisions + a second Risk-Guardian agent** — Agentic / multi-agent.
4. **Verifiable reasoning + memory on Walrus** — Walrus track.

---

## 2. Architecture (the whole stack)

```
 OWNER (Slush wallet)                         pm2 process fleet on one VM
   │ signs: adopt / withdraw / revoke            ├─ brief-web      (Next.js 14)
   ▼                                              ├─ brief-trader   (the operator brain)
 SUI MAINNET                                      ├─ brief-guardian (the risk agent)
   ├─ operator_policy  (the leash)                └─ brief-warden   (gas keeper)
   ├─ gated_spot       (atomic gated order)                │ write
   ├─ DeepBook v3      (BalanceManager + pools)            ▼
   └─ events           (PolicyCreated/Spend/Revoked)   .cursors/*.json  ◄── read ── Next.js API routes
                                                            │                          │
 WALRUS (testnet) ── manifesto + AI reasoning + journal     └────────► pages: / /workforce /brain
                                                                        /evolution /results /proof /leaderboard
```

- **No database.** The chain is the source of truth for money + the leash; the
  filesystem (`.cursors/`) is the source of truth for the agent's reasoning +
  history; Walrus stores the immutable pledge + AI reasoning. Every UI number is
  derived from one of these — nothing is faked.
- **Networks:** mainnet is the live product (gated-spot only). A testnet
  BTC-Predict path + task/inbox agents (research/treasury/planner) exist but are
  legacy/testnet-only.
- **LLM:** CommonStack (OpenAI-compatible). `claude-haiku-4-5` for the load-bearing
  advisor (clean JSON); `deepseek-v4-flash` for prose narration.

---

## 3. The on-chain leash (Move `operator_policy` + `gated_spot`)

### 3.1 Custody — why the agent can't run off with funds
| Object | What it is | Who controls it |
|---|---|---|
| **BalanceManager (BM)** | DeepBook v3 account holding the owner's USDC + bought assets | **Owner** |
| **TradeCap** | "may place orders from this BM" — **trade-only** | Operator (agent) |
| **DepositCap** | "may add fuel" — **deposit-only** | Operator (agent) |
| **OperatorPolicy** | the leash: budget cap, agent addr, owner, venues, expiry, revoked | Owner creates; **only owner revokes** |

The agent wallet (`0xa9f24640…`) holds the TradeCap + DepositCap. It **never** holds
a WithdrawCap. Withdrawing requires owner authority. That single fact is the safety
guarantee — the agent can move money *inside* DeepBook but cannot send it anywhere.

### 3.2 The enforcement — every trade is atomic + gated
A trade is ONE Move call, `gated_spot::gated_spot_market_order`, which runs:
1. `operator_policy::record_spend(...)` — the leash check (below), then
2. `pool::place_market_order(...)` — the real DeepBook order via the TradeCap.

Atomic: if the policy says no, the order never reaches DeepBook; if the order
fails, the spend is rolled back. `operator_policy::assert_can_spend` aborts the
**entire** transaction on any of:

| Check | Abort | Meaning |
|---|---|---|
| sender == bound agent | `ENotAgent` (2) | only your operator can trade your BM |
| not revoked | `EPolicyRevoked` (3) | you killed it → it can never trade again |
| not expired | `EPolicyExpired` (4) | past the expiry you set |
| spent + amount ≤ budget_cap | `EBudgetExceeded` (5) | can never exceed the cap |
| venue allowed | `EVenueNotAllowed` (6) | only the markets you permitted |

`extend()` (owner-only, raise-only) can grow the cap/expiry, never shrink — the
agent's envelope only ever grows or gets revoked.

### 3.3 budget_cap = a turnover allowance, not the deposit
At adoption, `budget_cap = capital × mode multiple` (**Protect 3× · Grow 5× ·
Aggressive 8×**). It is a **cumulative lifetime turnover ceiling** (every buy's
notional adds to `spent`; sells don't refund). The **deposited capital is the real
hard limit** (only the owner can withdraw it); the allowance is an additional
on-chain bound on activity, sized so the operator can rebalance for weeks instead
of retiring after deploying once. Hitting it is a normal end-state ("budget fully
used"), not an error.

### 3.4 Mainnet constants
DeepBook pkg `0xf48222c4…`; SUI/USDC pool `0xe05dafb5…`; USDC
`0xdba34672…::usdc::USDC`; WAL `0x356a26eb…::wal::WAL` (pool `0x56a1c985…`); DEEP
`0xdeeb7a46…::deep::DEEP` (pool `0xf948981b…`). Mainnet SUI/USDC accepts
`pay_with_deep=false` (fee from the traded asset) → no DEEP fuel needed.

---

## 4. The agents (a real multi-agent system)

### 4.1 Trader (`brief-trader`) — the operator brain
A 15s loop (`gatedSpotTick`). Each tick: consolidate gas → load the operator
registry → for each live operator: **retire-if-withdrawn**, read all asset
signals, mark the portfolio, choose one asset, run the decision (`runGatedOperator`).

**The decision pipeline** (the visible "7 steps"), with real thresholds:

1. **Observe** — live DeepBook mid; publish the Walrus manifesto once per policy.
2. **Signals** (`signals.ts`): ROC 5m/30m/60m/4h/24h, SMA 15m/60m, Wilder RSI 60m,
   annualized realized vol — all from `price-history-{asset}-{network}.json`
   (CoinGecko-backfilled at adoption, so never cold-start blind).
3. **Recall** (`experience.ts`): ≤3 nearest past regimes (Euclidean dist < 1.5) →
   a confidence multiplier (0.7 if losses ≥2× wins, 0.85 if more losses, 1.08 if
   more wins).
4. **Regime** (`regime.ts`, on 30m + 4h ROC): `mean-reversion` (rsi≥75|≤25 &
   |roc30|<0.6% → stand aside) · `breakout` (|roc30|≥1.2% → follow) ·
   `trending-up/down` (|roc30|≥0.25% & MA agrees) · fallback `trending`
   (|roc4h|≥0.4%) · else `range-bound` (stand aside).
5. **Decision engine** (`decision-engine.ts`), mode-calibrated:
   | mode | minConfidence | rocFloor | rsiCeiling | maxExposure |
   |---|---|---|---|---|
   | protect | 0.66 | 0.4% | 64 | 30% |
   | grow | 0.50 | 0.25% | 72 | 55% |
   | aggressive | 0.38 | 0.15% | 80 | 85% |
   - **Confidence** = `clamp(max(|roc30|/1%, |roc4h|/4%))`, ×0.6 if MAs disagree,
     ×0.25 if not trending, ×0.5 on RSI exhaustion, **× memory/playbook/vol
     multiplier**, **× (1 + AI modifier)**.
   - **Direction** follows the regime first (a "trending up" regime can never read
     as selling).
6. **AI advisor** (load-bearing — see §4.2): folds an LLM confidence modifier +
   direction + veto + thesis into the engine via `opts.ai`.
7. **Allocator** (`index.ts`): target exposure (`up → max(20, conf×maxExposure×100)`,
   `down → 0`) vs current; rebalance only when the gap clears the **vol-adaptive
   band** (`min(0.30, 0.12 + realizedVol×0.06)`, ≥15-pt floor). A feasibility guard
   cancels a move with no cash/inventory.
8. **Execution veto** (`spot-handler.ts`): real DeepBook depth/slippage check
   (`MAX_SLIPPAGE_PCT = 1.5%`) can veto; a `devInspect` pre-flight simulates the
   exact tx so no gas is spent on a doomed trade.
9. **Risk Guardian gate** (§4.3): if the guardian paused this operator, stand down.

Then: emit the live decision event, append the permanent ledger + experience
archive, update lifetime stats, settle matured decisions (asset-aware), and (on
AI-shaped trades) anchor the AI reasoning to Walrus.

### 4.2 AI advisor — the LLM as the load-bearing layer (`ai-advisor.ts`)
Each *meaningful* cycle, `maybeAiAdvise` sends a tight context prompt (portfolio,
signals, regime, budget, mode, recent memory, mandate, the deterministic base
confidence) to `claude-haiku-4-5` and gets back JSON:
`{ direction, confidenceMod (-0.30..+0.20), veto, thesis, counterargument, rationale }`.
The caller computes `aiConfidence = base × (1 + mod)` (or 0 on veto) and re-runs the
engine via `opts.ai` so the AI **actually moves the act-gate + allocator**. It can
sharpen or veto conviction; it can **never** fabricate a trade the signals don't
support, and the Move policy still gates execution.

- **Budget-safe by construction:** only fires on a tradeable regime with base
  confidence ≥ 0.18, rate-limited ≥ 8 min/operator, weekly cap 500 (~$0.35/wk
  worst-case), 12s timeout, safe deterministic fallback on any failure.
- **Verifiable:** when the AI shapes a real trade, the full prompt+response is
  anchored to Walrus (`brief.ai-reasoning.v1`); the Brain shows an "AI · model"
  badge + an "AI reasoning on Walrus" link.
- **Verified live:** operator "Echo" decision #34 — the AI dampened conviction
  0.72→0.46 → stand-down (talked the operator *out* of a trade).
- Toggle: `BRIEF_LLM_MODE=llm|mock` (per-process in the ecosystem config).

### 4.3 Risk Guardian (`brief-guardian`) — the second autonomous agent
An independent, **read-only** loop (no keypair, never touches funds). Every 45s it
watches each operator's **realized volatility + drawdown** and writes a pause/resume
signal (`.cursors/guardian-status.json`) with hysteresis + env-tunable
circuit-breakers (vol pause/resume 2.8/2.2 annualized; drawdown 12%/8%; a
force-pause override for demos). **The trader respects it before any trade** (fail-
open: if the guardian is down, trading continues — the Move policy is still the
ultimate gate, and the owner's revoke overrides everything). The dashboard shows
"Risk Guardian · monitoring / paused". This is genuine multi-agent coordination:
two agents, one shared signal, on-chain enforcement underneath.

### 4.4 Warden + legacy
`brief-warden` keeps the agent wallets solvent (gas rebalancing/faucet) and writes
health status. The testnet-only `research`/`treasury`/`planner` + BTC-Predict path
are legacy (the predict market wasn't republished on mainnet).

---

## 5. Memory & learning (real, honestly shallow)

- **Experience archive** (`operator-experience-*.json`, capped 2000): every
  decision as a regime fingerprint + outcome, fully replayable.
- **Settlement**: matured ACTs settle win/loss at a ~1h horizon against **their own
  asset's** later mid (asset-aware — fixed a bug where cross-asset settlement
  produced ±thousands-%); impossible >100% outcomes are clamped out.
- **Recall** genuinely modulates confidence (load-bearing).
- **Playbook** (per-regime settled win-rate) now **gates conviction** (×0.6 if a
  regime is demonstrably losing with ≥3 settled, ×0.85 unproven, ×1.1 if ≥55% win)
  — was display-only before.
- **Walrus anchoring**: the manifesto (pledge), AI reasoning (per trade), and a
  periodic journal are content-addressed on Walrus → verifiable, not claimed.
- **Honest limits:** the learning is heuristic, not a trained model; settlement
  marks raw mid moves (no fees/slippage folded in yet); the deeper "MemWal"
  semantic memory is roadmap.

---

## 6. Operator lifecycle

- **Adopt** (one signature): creates the BM, deposits USDC, delegates TradeCap +
  DepositCap, creates the policy (cap = capital × mode multiple). Registers the
  operator off-chain so the agent picks it up.
- **Trade**: the gated, atomic, AI-guided, guardian-checked order (above).
- **Withdraw** (owner, anytime): drains the BM → the agent freezes the displayed
  mark at the last funded value, shows "capital returned in full · ±0%" (never a
  loss), and **retires the operator** (no zombie loop).
- **Revoke** (owner, one tx): the next trade aborts `EPolicyRevoked` on-chain.
- **Expire / turnover-exhausted**: aborts `EPolicyExpired` / stops at the cap
  ("budget fully used"), both normal end-states.

---

## 7. Data-flow ecosystem (`.cursors/` ↔ API ↔ pages)

| File | Tracks | Read by |
|---|---|---|
| `agent-events.ndjson` | live lifecycle beats (observe→decision→…→guardian) | `/api/agent-events` SSE → landing Mind + dashboards |
| `operator-registry.json` | adopted operators (policy/BM/caps/owner/mode/revoked) | trader, guardian, leaderboard |
| `operator-stats-{slug}.json` | lifetime stats: deposit, peak, **worstDrawdown**, lastValue, **withdrawn** | `/api/operators/ledger` → Results + dashboard Performance |
| `operator-ledger-{slug}.json` | permanent allocation events (settled, asset-aware) | dashboard ledger + Results "big moments" |
| `operator-experience-{slug}.json` | decision archive + **aiReasoned/aiBlobId** | `/api/operators/decisions` → Brain + Evolution |
| `guardian-status.json` | per-operator pause/resume + vol/drawdown | trader (gate) + dashboard |
| `price-history-{asset}-{network}.json` | rolling ~26h prices (CoinGecko-seeded) | signals (trader + guardian) |
| `trader-manifest/{slug}.json` | Walrus manifesto publish state | `/api/operators/proof` |

**The correctness invariant:** the return/drawdown is computed in exactly one
place — `benchmarkFromStats(stats)` off the **real deposited capital** (not the
turnover allowance), withdrawal-aware (frozen `lastValue`). The live hero mark and
the stats benchmark can no longer disagree.

---

## 8. Every page (route · structure · what's shown)

- **`/` landing** — the Leash canvas animation, the H1 thesis, a live network proof
  row (`N operators · N decisions · $N managed · 0 violations · 0 custody
  incidents`, all real), and the live "Mind" pipeline (Observe→Thesis→Risk→
  Decision→Chain) driven by whatever operator is currently thinking.
- **`/workforce`** — the fleet. Discovers the connected wallet's operators from
  **both localStorage and the chain** (`useOperatorPolicies`, address-scoped) so a
  returning/cross-device user always sees their operators. Else the adopt hero.
- **`/workforce/adopt`** — the wizard: mode (Protect/Grow/Aggressive) · capital ·
  optional mandate → one signature (the adopt tx). Shows capital vs the N× on-chain
  trading allowance.
- **`/workforce?policy=<id>`** — the operator dashboard. Top to bottom: the
  **Status Surface** (state pill + the operator's current thinking as the
  billboard + capital marked-to-market + live multi-asset allocation bar +
  **Risk Guardian row** + vitals), **Withdraw funds** (owner-only, chain-resolved),
  **Performance** (operator vs hold vs cash + drawdown + 0 violations, from the
  stats benchmark), the **custody chain** visual, and collapsibles (ledger / how it
  thinks / live activity / policy & proof). The **kill switch** chain-resolves
  ownership (owner sees Revoke on any device).
- **`/brain?policy=<id>`** — "Read the operator's mind": each decision as 5 blocks
  (saw / remembered / feared / did / happened) with an **"AI · model" badge** +
  "AI reasoning on Walrus" link when LLM-shaped.
- **`/evolution?policy=<id>`** — lessons learned + regimes understood + the growth
  timeline, all from settled outcomes.
- **`/results?policy=<id>`** — "Did it work?": return vs holding vs cash, max
  drawdown, capital preserved, trades executed/avoided, 0 policy violations;
  withdrawal-aware ("capital returned in full").
- **`/proof?policy=<id>`** — the courtroom: 5 cards, each a live on-chain/Walrus
  artifact (the Move leash · every authorized trade is a `PolicySpend` · the
  `EBudgetExceeded` revert · the revoke + `EPolicyRevoked` abort · the Walrus
  manifesto). Read live from the fullnode + Walrus, nothing from a DB.
- **`/leaderboard`** — every adopted operator (from `PolicyCreated`), real trade
  counts (all live, no "simulated"), USDC budgets, "House"/"You" badges.

---

## 9. Honest engineering verdict

**What's genuinely strong:** real on-chain non-custodial enforcement proven on
mainnet with real USDC (adopt→trade→revoke→abort→withdraw, all real tx hashes); an
LLM that genuinely shapes decisions (verified) under an unbreakable Move policy; a
real second agent (Risk Guardian) coordinating with the trader; verifiable
reasoning on Walrus; multi-asset DeepBook v3; and a UI where every number is
on-chain-or-recorded truth (abstention shown as discipline, no fabricated P&L).

**Honest gaps (say them before a judge finds them):** the engine is heuristic +
LLM-modulated, not a trained predictive model; settlement ignores fees/slippage so
the recorded track record is optimistic; on quiet pools the operator abstains most
cycles (correct, but "capital preserved" can also mean "did little"); MemWal
semantic memory + Scallop cross-protocol yield are roadmap (the latter needs a Move
redeploy). The differentiator is the trust/enforcement substrate — **pitch that,
never returns.**

---

## 10. 1st-place readiness — the brainstorm

**Tracks covered:** Agentic Web / Agent Wallet (core), DeepBook (real multi-asset
spot), Walrus (manifesto + AI reasoning + journal). Plausibly three tracks from one
coherent product.

**The differentiator most teams can't match:** "the agent attempts an action → the
*chain* rejects it → the funds are untouched," shown as a real reverted mainnet tx.
Plus LLM-guided + multi-agent + verifiable, all live on real money. That
combination is rare.

**What likely separates 1st from "strong contender" (the levers):**
1. **The demo video.** This is the single biggest scoring lever and it's not built
   yet. 60-90s, tight: adopt → AI-influenced decision (Brain "AI" badge) → Risk
   Guardian watching → revoke → chain aborts the next trade → withdraw → the Proof
   page. Show the *rejection*, not just the happy path.
2. **The narrative.** "The first AI agent wallet governed by on-chain law" —
   enforcement + intelligence + verifiability in one breath. Avoid any
   alpha/returns claim.
3. **Make the AI's influence unmissable in the video** (the Brain badge + a visible
   confidence change + a Walrus reasoning link).
4. **Optional, higher-risk upside:** MemWal (Walrus-track flex) and Scallop
   composability — both deferred as roadmap because they need external setup / a
   Move redeploy that could destabilize the proven loop this close to submission.

**Candid read:** the *product* is at or near 1st-place quality — live on mainnet,
genuinely agentic, multi-agent, verifiable, honest. The remaining risk is
**presentation, not engineering**: a crisp demo video + a sharp narrative are what
convert "excellent and complete" into "winner." The biggest mistake now would be
adding more features instead of nailing the story.

---

*Companion docs: `HOW-THE-OPERATOR-WORKS.md` (plain-English), `DEMO-AND-SUBMISSION.md`
(video script + submission copy). This paper is the consolidated technical
reference and supersedes the agent-intelligence sections of the others where they
differ (the AI advisor + Risk Guardian are now live, not roadmap).*
