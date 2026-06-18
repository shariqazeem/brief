# Brief — user flows + how it actually works (honest, code-grounded)

This is the full map: every user flow with page routes, what the agent does in
code that makes it act, how the pages interconnect as one ecosystem, and the
structure of each page (where each component sits, what the user sees, and what
the code actually writes there). Written to be **honest** — where something is
deterministic, display-only, or not wired, it says so.

File references are `path:line` against the repo at the time of writing.

---

## 0. The architecture in one paragraph

Brief is a Next.js app + a long-running **agent process** (pm2 `brief-trader`,
`tsx agents/workforce/trader/index.ts`) on a single VM. The bridge between them
is the **filesystem**: the agent writes JSON/NDJSON under `.cursors/`; Next.js
API routes read those files + the Sui fullnode; the pages render. There is **no
database**. The chain (Sui Move `operator_policy` + DeepBook v3) is the source of
truth for money + the leash; `.cursors/` is the source of truth for the
operator's reasoning/history; Walrus stores the immutable pledge.

```
User wallet (Slush)                      pm2 brief-trader (15s loop)
   │ signs adopt / withdraw / revoke         │ reads signals, decides, signs gas-only trades
   ▼                                          ▼
Sui mainnet  ── OperatorPolicy ── DeepBook BalanceManager ── DeepBook pools
   ▲  (budget cap, agent, owner, revoked)   (your USDC + assets; owner-only withdraw)
   │                                          │ writes
Next.js pages ◄── /api/* routes ◄── .cursors/*.json  ◄───────┘
(/, /workforce, /brain, /results, /evolution, /proof, /leaderboard)
```

---

## 1. FLOW A — a new user adopts an operator

### A1. Landing page `/`  (`src/app/page.tsx` → `OperatorLandingV2`, line 503)
What the user sees, top to bottom:
- **The Leash animation** (`LeashHero`, `page.tsx:328`) — a canvas: a gold
  operator dot tethered inside a boundary. The literal thesis as motion.
- **H1** (`page.tsx:555`): the one-line pitch.
- **Live proof stats row** (`ProofStat`, fed by `useNetworkProof()` →
  `/api/network/proof`): `N operators live · N decisions · $N managed · 0 policy
  violations · 0 custody incidents`. These are **real**, read from chain.
- **The live "Mind" pipeline** — a 5-step strip driven by `useGlobalWire()`
  (`page.tsx:142`), which tails the SSE of *whatever operator is currently
  thinking*: **Observing → Thesis → Risk → Decision → Chain** (`page.tsx:607-670`).
  Each lights as the real agent beat arrives. The Decision dot is green (buy),
  red (sell), or amber (hold/preserve).
- Sections below explain the model + a CTA to `/workforce`.

→ User clicks through to **`/workforce`**.

### A2. Workforce / fleet `/workforce`  (`src/app/workforce/page.tsx`)
This page branches on wallet + ownership (`WorkforceConsole`, line 133):
- `?policy=0x…` present → **`ViewOperator`** (read-only dashboard of any operator).
- Wallet connected → **`Connected`** (line ~1099):
  - Discovers the wallet's operators from **BOTH** localStorage **and the chain**
    (`useOperatorPolicies(address)` — address-scoped `PolicyCreated` events,
    merged by policyId; `page.tsx` `Connected`). This is why a returning user on
    any device sees their fleet, not an empty screen.
  - If they own ≥1 operator → **`OperatorsHome`** (the fleet grid:
    `OperatorHomeCard` per operator, each links to `?policy=<id>`).
  - If none → **`FirstOperatorEntry`** (the adopt hero with the 3 modes).
- No wallet → **`Disconnected`** (connect prompt + the mode grid).

→ User clicks **Adopt an operator →** (links to `/workforce/adopt`).

### A3. The adoption wizard `/workforce/adopt`  (`src/app/workforce/adopt/page.tsx`)
Three fields the user picks, then **one signature**:

1. **Mode** (`MODES`, `adopt/page.tsx:41`): the user buys a *goal*, not a strategy.
   | Mode | intent (shown) | personality (engine) | turnoverMultiple | goal |
   |---|---|---|---|---|
   | Protect | "Protect my capital" | conservative | **3×** | preserve |
   | Grow | "Grow steadily" | momentum | **5×** | grow 5%/30d |
   | Aggressive | "Beat passive SUI" | contrarian | **8×** | edge |

2. **Capital** (`amount`, default 5 USDC; presets + custom). This is what you
   fund **and what you can withdraw** — only you.

3. **Mandate (optional)** — a human objective + drawdown guard stored on Walrus.
   Off by default. The chain caps spend regardless.

**The one signature** (`onAdopt`, `adopt/page.tsx:204`) builds ONE transaction
(`buildAdoptTx`, `src/lib/deepbook-adopt.ts:114`) that atomically:
- creates **your** DeepBook **BalanceManager** (you own it),
- **deposits** your USDC into it,
- delegates a **DepositCap** (fuel-in only) + a **TradeCap** (trade-only, *never*
  withdraw) to the operator wallet,
- creates the on-chain **OperatorPolicy** via `operator_policy::create` with
  **`budgetCap = capital × turnoverMultiple`** (the cumulative-turnover leash),
  `agent = the trader wallet`, `owner = you`, an expiry, and allowed venues
  `[spot-sui, spot-wal, spot-deep]`.

After success the page reads the created object IDs from `objectChanges`, saves a
local `TraderIdentity`, and POSTs them to `/api/operators/register` →
`.cursors/operator-registry.json` (so the agent picks the operator up). Then a
**boot ceremony** plays and hands off to the live dashboard.

> **Custody truth:** the operator holds a **TradeCap** (can place orders) and a
> **DepositCap** (can add fuel). It does **not** hold withdraw authority — that
> stays with you. Every order also passes the on-chain budget check before it can
> touch DeepBook.

---

## 2. THE CORE — what the agent does in code, step by step

The agent is `agents/workforce/trader/index.ts`, run by pm2. On mainnet only the
**gated-spot loop** runs (`gatedSpotTick`, `index.ts:2768`; the BTC-Predict +
task-inbox paths are testnet-only legacy). The loop fires every
`BRIEF_OPERATOR_CYCLE_MS` (15s).

### 2.1 One tick (`gatedSpotTick`)
1. **Consolidate gas** for the operator wallet (`consolidateSuiCoins`, top of tick).
2. **Load the registry**, filter to live operators: `!e.revoked && !gatedSkip.has(id)`
   (`index.ts:2769-2770`).
3. **For each operator** (`index.ts:2847`):
   a. **Retire-if-withdrawn** (`index.ts`, top of loop): load `priorStats`; if
      `stats.withdrawn` → add to `gatedSkip`, emit a terminal event, `continue`.
      *(This is the "use and leave" lifecycle — no zombie loop.)*
   b. **Read every tradeable asset** (SUI/WAL/DEEP): build an `AssetCtx`
      (mid + signals) per asset, into `mids` (`index.ts:2855`).
   c. **Mark the portfolio** (`readGatedPortfolio`, `index.ts:2156`): reads the
      live BalanceManager balances (USDC + each asset × its mid) → `totalValue`.
   d. **Choose ONE asset to act on** (`index.ts:2860`): the strongest up-trend
      buy candidate (`buyScore`); else the largest current holding; else SUI.
   e. Call **`runGatedOperator`** for the chosen asset (passing `mids` +
      `priorStats`).

### 2.2 One decision (`runGatedOperator`, `index.ts:2189`)
The visible "7-step pipeline" the UI renders is this, in order:

1. **Observe** — emit `observe` (spot price). Publish the Walrus **manifesto**
   once per policy (idempotent, `publishManifestoOnce`, `index.ts:382`).
2. **Signals** (`signals.ts`): ROC over 5m/30m/60m/4h/24h, SMA 15m/60m, Wilder
   RSI 60m, annualized realized vol — all computed from `price-history-*.json`
   (CoinGecko-backfilled at adoption so it's never cold-start blind).
3. **Recall memory** (`recallSimilar`, `experience.ts:282`): finds ≤3 past
   regimes within Euclidean distance 1.5 and returns a **confidenceMult**
   (0.7 if losses ≥2× wins, 0.85 if more losses, 1.08 if more wins, else 1.0).
4. **Classify the regime** (`regime.ts`): on 30m + 4h ROC —
   - `mean-reversion` if `(rsi≥75 || rsi≤25) && |roc30|<0.006` → stand aside
   - `breakout` if `|roc30|≥0.012` → follow
   - `trending-up/down` if `|roc30|≥0.0025` and the MA agrees/neutral
   - fallback `trending` if `|roc4h|≥0.004`
   - else `range-bound` → stand aside
5. **Decision engine** (`decision-engine.ts`): mode ceilings —
   | mode | minConfidence | rocFloor | rsiCeiling | maxExposure |
   |---|---|---|---|---|
   | protect | 0.66 | 0.004 | 64 | 0.30 |
   | grow | 0.50 | 0.0025 | 72 | 0.55 |
   | aggressive | 0.38 | 0.0015 | 80 | 0.85 |
   - **Confidence** = `clamp01(max(|roc30|/0.01, |roc4h|/0.04))`, ×0.6 if MAs
     disagree, ×0.25 if not trending, ×0.5 on RSI exhaustion, **× the memory
     confidenceMult** (`decision-engine.ts:233` — memory genuinely gates here).
   - **Direction** follows the **regime first** (`trending-up→up`,
     `trending-down→down`), trend-ROC sign only as fallback. (This is why a
     "trending up" regime can never read as "selling.")
   - **Act gate**: `confidence ≥ minConfidence && trending && execOk &&
     !budgetBlocked && !mandateBlocked && !regimeBlocked`.
6. **Allocator** (`index.ts:2329`): target exposure (`up → max(20, conf ×
   maxExposure × 100)`, `down → 0`) vs current exposure; only rebalances when the
   gap exceeds the **15-point band** (`REBALANCE_BAND`). A feasibility guard
   cancels if there's no cash to buy / no inventory to sell.
7. **Execution-quality veto** (`spot-handler.ts` `readSpotExecution`): a real
   DeepBook depth/slippage check (`MAX_SLIPPAGE_PCT = 1.5%`) can veto even a
   confident decision. Then a **devInspect pre-flight** simulates the order so no
   gas is spent on a doomed trade.

If it acts → **`buildGatedSpotTx`** (`deepbook-spot.ts`): one atomic Move call
`gated_spot::gated_spot_market_order` that runs `operator_policy::record_spend`
(the budget check — aborts `EBudgetExceeded` if over cap, `EPolicyRevoked` if
killed) **then** `pool::place_market_order`. Atomic: if the policy says no, the
order never reaches DeepBook.

### 2.3 What gets written after each decision (the persistence)
- `emitAgentEvent(...)` → `agent-events.ndjson` (observe/signals/decision/…) —
  the live SSE.
- **Ledger** (`operator-ledger-*.json`): a permanent allocation event on each
  real order (side, exposure, mid, qty, `asset`, txDigest, outcome).
- **Experience** (`operator-experience-*.json`, capped 2000): the decision +
  regime fingerprint + `asset` + outcome — the Brain/Evolution source + recall.
- **Stats** (`operator-stats-*.json`): lifetime counts, `deposit` (the launch
  capital baseline), `peakValue`, `worstDrawdownPct`, `lastValue`, `withdrawn`.
- **Settlement**: `settlePending` (experience) + `settleLedger` (ledger) mature
  pending decisions at the ~1h horizon by comparing each record to **its own
  asset's** later mid (asset-aware; impossible >100% outcomes are clamped).
- **Walrus**: manifesto (once) + periodic journal when WAL-funded.

---

## 3. HOW THE PAGES CONNECT (the ecosystem)

Every page is a **read view** over the same chain + `.cursors/` state. Nothing is
rendered from a database. Single source of truth per number:

| Page (route) | Reads (API → file/chain) | Shows |
|---|---|---|
| `/workforce` dashboard | SSE `/api/agent-events`; `/api/operators/ledger` (stats+ledger); chain policy | live status + capital + performance + custody |
| `/results` | `/api/operators/ledger` (stats + ledger) | the verdict: return vs hold vs cash, drawdown, big moments |
| `/brain` | `/api/operators/decisions` (experience) | per-decision replay (saw / remembered / feared / did / happened) |
| `/evolution` | `/api/operators/decisions` (experience) → `operator-evolution.ts` | lessons learned + the path timeline |
| `/proof` | `/api/operators/proof` (chain policy + PolicySpend/Revoked events + Walrus blob) | courtroom evidence, all verifiable |
| `/leaderboard` | `/api/leaderboard` (PolicyCreated + PolicySpend events) | every operator, real trade counts |
| `/` landing | `/api/network/proof` + global SSE | network stats + the live Mind |

**The key invariant we just enforced:** the **return / drawdown** number is
computed in exactly one place — `benchmarkFromStats(stats)` (`operator-ledger.ts`)
off the persisted `stats` (which is withdrawal-aware + uses the real deposit
baseline). The dashboard hero's *live* mark is the agent's frozen-on-withdrawal
emit. The two can no longer disagree.

---

## 4. PAGE-BY-PAGE STRUCTURE (layout + what's written)

### 4.1 Operator dashboard — `/workforce?policy=<id>` (`operator-dashboard.tsx`)
Top → bottom:
1. **TopBar** (`:305`): operator name + glyph, a state dot (act/preserve/idle/
   grounded), nav (Brain / Evolution / Results / Proof), and the **"yank the
   leash"** revoke affordance (chain-resolved; hidden in read-only shared views).
2. **OperatorHero** (`:473`) — the dominant "status surface":
   - identity + `OBSERVING` / `LIVE · {lastWhen}` pill.
   - the **billboard statement** (`heroLine`) — the operator's current thinking,
     e.g. *"No clear edge. Holding 48% in DEEP."* When withdrawn it reads
     *"Capital withdrawn by owner · returned in full."*
   - **capital** marked-to-market: `{value} USDC · {pnl} · {pnlPct}% vs deposit`
     (frozen + "withdrawn · returned in full" when withdrawn).
   - **allocation bar** (per-asset segments + cash; suppressed when withdrawn).
   - **vitals** (`HeroStat`, `:658`): Last decision · Confidence · Mandate ·
     **Allowance left** (`% of the turnover allowance remaining`).
3. **WithdrawFunds** (`:338`) — owner-only; chain-resolves ownership; one signature.
4. **OperatorPerformance** (`:794`):
   - big **`{operatorPct}% since launch`** headline (now from the stats benchmark
     — the single source of truth).
   - `BenchCell` row: **Operator / Hold {asset} / Cash** + "X% vs holding".
   - vitals: Observations · Allocations · Abstentions · Worst drawdown ·
     Mandate · **Policy violations: 0**.
5. **ProtectedBySui** (`:351`) — the custody chain visual: Your wallet →
   BalanceManager (operator cannot withdraw) → TradeCap (trade-only, never
   withdraw) → Operator (cannot exceed budget) → DeepBook (verifiable on Sui).
6. **Collapsibles**: **Operator ledger** (`:917`, N allocations) · **How it
   thinks · reasoning & evidence** (the playbooks — *display-only*) · **Live
   activity** (`:386`, the SSE beat) · **Policy & proof**.

### 4.2 Brain — `/brain?policy=<id>` (`src/app/brain/page.tsx`)
"Read the operator's mind." A carousel of one **decision** at a time (newest
first), each rendered as 5 cinematic blocks (`BigBlock`):
- **What it saw**: the regime + `{ASSET} ${mid}` + momentum + volatility.
- **What it remembered**: `N similar situations · W/L` from recall.
- **What it feared**: the counterargument.
- **What it did**: `Held position` / `Added {asset}` / `Trimmed {asset}` + confidence.
- **What happened**: the settled outcome (or "Capital protected · discipline,
  not inaction" for a hold). Header counters: Decisions · Capital preserved.

### 4.3 Evolution — `/evolution?policy=<id>` (`operator-evolution.ts`)
"How {name} evolved." Built purely from the settled experience archive:
- **Lessons learned** + **Regimes understood** counts.
- **Most valuable lesson** (the highest-applied per-regime rule).
- **The path**: a timeline — began observing → learned to read each regime →
  first allocation → first profitable call → today (`N decisions · N lessons`).
  *(All milestones derive from settled outcomes; an operator with none settled
  shows a clean "still building" path rather than fabricated numbers.)*

### 4.4 Results — `/results?policy=<id>` (`src/app/results/page.tsx`)
"Did it work?" Outcome-first:
- name + objective + status (`running Nd` / **`capital withdrawn by owner`**).
- one-line **verdict** (e.g. *"The leash held. Capital protected."* /
  *"Capital returned in full, on demand."*).
- **"What would have happened if you'd done nothing?"** — three big numbers:
  **The operator / Held {asset} / Did nothing (cash)** + "X% vs holding".
- the record: Maximum drawdown · Capital preserved · Decisions · Trades executed
  · Trades avoided · **Policy violations: 0**.
- **Big moments**: settled allocations ("Captured +X%" / "Held through −X%").
- **Operator status** + the roadmap (Now / Next / Then).

### 4.5 Proof — `/proof?policy=<id>` (`src/app/proof/page.tsx`)
"Verify everything. Trust nothing." Five courtroom cards, each links to Suiscan /
Walrus:
1. **Your leash is a Move contract** — authorized vs used, agent, owner, status.
2. **Every authorized trade is an on-chain event** — the `PolicySpend` list.
3. **When the operator exceeds the cap, the chain says no** — the `EBudgetExceeded`
   reverted tx.
4. **The kill switch is a transaction, not a toggle** — the revoke tx + the
   `EPolicyRevoked` aborted re-attempt.
5. **The operator's reasoning is immutable** — the Walrus manifesto blob (amber
   "anchors on first cycle" if not yet published).

### 4.6 Leaderboard — `/leaderboard` (`src/app/leaderboard/page.tsx`)
Every adopted operator (from `PolicyCreated`), ranked. On mainnet each trade is a
real `PolicySpend` (all "live", no "simulated"); budgets in USDC; "House" badge
for the team's own operators; a "You" badge for the connected owner's.

---

## 5. LIFECYCLE FLOWS (what each owner action does)

- **Withdraw** (owner, anytime): drains the BalanceManager. The agent's next mark
  detects the collapse → freezes the displayed value at the last funded mark,
  shows **"capital returned in full · ±0%"** (never a loss), sets `stats.withdrawn`,
  and **retires** the operator next cycle (no zombie loop). The policy can still
  be revoked separately.
- **Revoke** (owner, one tx): `operator_policy::revoke`. The agent's very next
  order aborts `EPolicyRevoked` on-chain — the order never reaches DeepBook. Funds
  stay yours. This is the kill switch, enforced by the protocol, no backend call.
- **Expiry**: the policy's `expires_at_ms`; `assert_can_spend` aborts
  `EPolicyExpired` after it.
- **Turnover allowance reached** (`spent ≥ budgetCap`): the operator has used its
  full cumulative-trade allowance (`= capital × 3/5/8`). It stops trading and the
  status reads **"budget fully used · capital deployed"** (not an error).

---

## 6. HONEST notes (so the doc matches reality)

- The agent is a **deterministic trend-follower**, not a learned/LLM model. Every
  output is fixed arithmetic over RSI/ROC/MA/vol. The `opts.ai` reasoning hook
  (`decision-engine.ts`) exists but is **not wired** (needs an API key).
- **Memory is real but shallow**: recall genuinely modulates *confidence*
  (load-bearing), but it can't change direction, and the per-regime **playbook is
  computed but display-only** — it does not gate live decisions yet.
- **Settlement** marks win/loss on raw mid moves at a ~1h horizon (no fees /
  slippage folded in yet), so the recorded track record is optimistic.
- Most cycles **abstain** on quiet pools — that's by design and honest; "capital
  preserved" can also mean "did very little." The UI frames discipline as a
  first-class success.
- **Brief's real moat is the on-chain enforcement + transparency substrate**, not
  alpha. Pitch the trust layer; never pitch returns.

Roadmap to make it genuinely intelligent (ranked): wire the Claude reasoning hook
· fee-aware settlement · let the playbook gate decisions · volatility-adaptive
thresholds · whipsaw/regime-stability guard · persist in-memory state across
restarts.
