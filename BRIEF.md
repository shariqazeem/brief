# Brief — Complete State, Design & How It Works

*Fresh, audited, honest snapshot — 2026-06-19. Live on Sui mainnet. This is the single source of truth; it replaces all prior state/design docs. Everything below was verified against the deployed code and on-chain state.*

---

## 1. What Brief is

**Adopt an autonomous AI capital operator. The chain holds the leash.**

A user deposits their own **USDC**, adopts **one AI operator** in one of **three modes**, optionally sets an **investment mandate**, and the operator manages that capital on **DeepBook v3** across **SUI / WAL / DEEP** — autonomously, non-custodially, and gated on-chain. It can trade the funds but can **never withdraw** them, can **never exceed** the budget cap, can **never touch a non-allowed venue**, **stands down** when a mandate or a second risk agent says so, and can be **revoked in one transaction**. Each guarantee is a **Move contract**, not a backend setting.

**The one-liner: "The first AI agent wallet governed by on-chain law."** An AI may *decide*; the blockchain decides what it is *allowed to do*.

Four pillars, reinforced on every screen:
- **Sovereignty** — the owner always controls withdrawal; capital stays owner-owned.
- **Enforcement** — the rules live in Move, not a database or a promise.
- **Intelligence** — it reasons, remembers, and adapts; it's two agents, LLM-guided.
- **Verifiability** — every meaningful action is provable on Sui or Walrus.

### Why it's different (vs Beep and other "agentic finance")

| Guarantee | Beep et al. | Brief |
|---|---|---|
| Funds stay in user's account | yes | yes |
| Spending cap enforced by | their backend | **a Move contract (`record_spend`)** |
| An over-budget trade | trusted not to happen | **reverts on-chain (`EBudgetExceeded`)** |
| Mandate ("max 8% drawdown") | — | **operator stands down; visible + verifiable** |
| Risk circuit-breaker | — | **a 2nd autonomous agent pauses trading** |
| Kill switch | API toggle | **`operator_policy::revoke` tx** |
| AI reasoning + memory | a black box | **load-bearing, replayable, anchored on Walrus** |

`/proof` and `/brain` make all of it verifiable on Suiscan/Walrus **without trusting us**.

---

## 2. Current state (honest)

**Live on Sui mainnet.** Package `0x60daa61dbcf925f431b1fb89cac27d6be55cb2a1c686509ec7801d78e3702210`; real USDC; multi-asset SUI/WAL/DEEP on DeepBook v3. Public site **usebrief.xyz**. The full real-money loop — **adopt → multi-asset gated trades → revoke → chain blocks the next trade → withdraw 100%** — is proven on-chain with real transaction hashes.

**Verified working (this audit):**
- One-signature non-custodial adoption — agent gets trade rights but **no WithdrawCap** (proven on live funds).
- The Move leash — every abort code asserted before any spend, backed by tests.
- The **AI advisor is load-bearing** (Grok 4.1 Fast) — verified moving conviction live.
- The **Risk Guardian** (2nd agent) — verified pausing on a volatility spike.
- Memory + per-regime playbook **gate** decisions (load-bearing).
- All pages return real chain/Walrus/`.cursors` data — no mocks.

**Honest limitations (own these, don't hide them):**
- The intelligence is **deterministic signals + LLM modulation**, not a trained predictive model (see §7).
- Win/loss settles on **raw mid moves** — fees/slippage aren't folded into the recorded record yet, so the track record is optimistic.
- Most cycles on quiet pools are **abstentions** — correct discipline, but it means the operator often does little (this is a feature; see §6).
- Walrus AI-reasoning anchoring needs a healthy SUI gas coin on the agent wallet; it's auto-consolidated but can occasionally skip.

**Roadmap (not built):** persistent semantic memory (MemWal) and cross-protocol idle-yield (Scallop) — deferred because they need a Move redeploy that would risk the proven mainnet loop.

---

## 3. On-chain architecture (the primitives)

Built on DeepBook v3's BalanceManager + a small Move package (`brief::operator_policy`, `brief::gated_spot`).

**One adoption transaction** (one signature, atomic PTB) creates the whole non-custodial relationship:

1. **BalanceManager (BM)** — created, its internal `owner` = the user. Capital lives here.
2. **TradeCap** — delegated to the agent: place orders, **cannot withdraw**.
3. **DepositCap** — delegated to the agent: top up the DEEP fuel tank (testnet), **cannot withdraw**.
4. **OperatorPolicy** — the leash (a shared object the user owns): `budget_cap`, `allowed_venues` = `["spot-sui","spot-wal","spot-deep"]`, `expires_at_ms`, `agent`, `owner`, `revoked`, `max_concentration`.
5. **No WithdrawCap is ever minted to the agent.**

**Non-custody is structural, not a promise.** DeepBook's withdraw path calls `generate_proof_as_owner`, which asserts `sender == BM.owner`. The agent address ≠ the owner, so the agent **literally cannot construct a withdraw proof**. *(Verified live: Echo's BM `owner` = the user `0xca3d6f42…`, while the agent is `0xa9f24640…`.)*

**The gate — `operator_policy::record_spend`** runs in the **same PTB** as every trade and asserts **before** any spend. Abort codes (verified in `move/sources/operator_policy.move` + tests):

| Code | Name | Fires when |
|---|---|---|
| 1 | `ENotOwner` | a non-owner calls revoke/extend |
| 2 | `ENotAgent` | sender ≠ the policy's agent |
| 3 | `EPolicyRevoked` | the policy is revoked |
| 4 | `EPolicyExpired` | past `expires_at_ms` |
| 5 | `EBudgetExceeded` | `spent + amount > budget_cap` |
| 6 | `EVenueNotAllowed` | venue not in `allowed_venues` |
| 7 | `EInvalidConfig` | bad config at creation |
| 8 | `ECannotShrink` | `extend()` tried to lower cap/expiry |

Because `record_spend` and the DeepBook order share one transaction, **a violation reverts the whole trade — no funds move.** `extend()` is owner-only and **raise-only**; `revoke()` is owner-only.

**Turnover allowance (important nuance):** `budget_cap = deposited capital × a mode multiple` (3× / 5× / 8×). The cap bounds **cumulative turnover**, not capital-at-risk — it lets the operator rebalance for weeks. The UI always shows **real deposited capital**, never the allowance. "Budget fully used · capital deployed" is a normal end state, not an error.

---

## 4. Adopting an operator — what actually happens

At `/workforce/adopt`: choose a mode → fund + set the leash → optional mandate → **one signature**. That single PTB builds the BM, deposits USDC, delegates the TradeCap + DepositCap, and creates the OperatorPolicy (`src/lib/deepbook-adopt.ts`). A boot ceremony plays, then the live dashboard opens.

Within ~15s the trader loop picks the new operator up from the registry and begins running the full decision pipeline. The first decision (usually an abstention while it reads the market) appears on the dashboard + Brain within a minute.

---

## 5. The three modes — Protect / Grow / Aggressive

One engine, three calibrations (`agents/workforce/trader/decision-engine.ts` `MODE_CFG`). When someone adopts, the chosen mode sets **how high the bar to act is** and **how much turnover the leash allows**:

| Mode | minConfidence | rocFloor | rsiCeiling | Turnover (cap = capital ×) | Character |
|---|---|---|---|---|---|
| **Protect** | 0.66 | 0.40% | 64 | **3×** | Acts only on a strong, confirmed trend; most cycles end in a green "capital protected" hold. Capital preservation first. |
| **Grow** | 0.50 | 0.25% | 72 | **5×** | The balanced default — trades a real edge, stands down on noise. |
| **Aggressive** | 0.38 | 0.15% | 80 | **8×** | Lower bar → more trades, more risk — but still hard-capped by the same Move leash. |

- **minConfidence** — the final conviction the operator must clear to act.
- **rocFloor** — the minimum momentum (rate-of-change) it treats as a real move.
- **rsiCeiling** — how overbought it tolerates before refusing to chase.
- **Turnover** — Protect can cycle capital 3×, Grow 5×, Aggressive 8× before the cap is reached.

Same safety in all three: the Move policy, the mandate guard, the Risk Guardian, and revoke apply identically. Mode only changes *how eager* the operator is — never *what it's allowed to do*.

---

## 6. How the operator thinks — the per-cycle pipeline

Every ~15s, for each live operator, the trader loop (`agents/workforce/trader/index.ts`) runs:

1. **Observe** — per-asset mid + signal bundle (ROC 30m/4h/24h, RSI, SMA alignment, realized vol). `signals.ts`.
2. **Recall (memory)** — the ≤3 nearest past regimes; their settled outcomes → a confidence multiplier. **Load-bearing** (can flip act↔stand-aside). `experience.ts`.
3. **Regime** — classify (trending-up/down, breakout, range-bound, mean-reversion). Non-tradeable → stand aside. `regime.ts`.
4. **Playbook gate** — the operator's own settled win-rate for *this exact regime* folds in: proven-losing (≥3 settled, <45%) ×0.6 (can flip act→hold), unproven ×0.85, proven-winning (≥55%) ×1.1. **Load-bearing.**
5. **Decision engine pass 1** — thesis, counterargument, risk review, mode-calibrated confidence bar.
6. **AI advisor (Grok)** — the LLM returns a confidence modifier (−30%…+20%), direction, veto, thesis, rationale; folded back into the engine (pass 2). It can sharpen, dampen, or hard-veto — but **never invent** a trade the signals don't support. (§7)
7. **Allocator** — think in *allocations*, not trades: compare current exposure to target, move only when the gap clears a **volatility-adaptive band** (`min(0.30, 0.12 + realizedVol·0.06)` → ~15% calm, ~30% chaotic).
8. **Execution analysis** — simulate the real order against the live DeepBook book (`devInspect`); slippage > 1.5% or a thin book **vetoes** (fail-safe — a read error never blocks).
9. **Risk Guardian gate** — honor the 2nd agent's pause flag (§8).
10. **Pre-flight + execute** — `devInspect` the exact gated tx; if it wouldn't clear, skip (no wasted gas). Else fire **one PTB: `record_spend` + `place_market_order`** for that asset (min lots: SUI ≥1, WAL ≥1, DEEP ≥10).
11. **Record** — decision event over SSE (live dashboard) + experience archive + (on AI-shaped decisions) a Walrus anchor.

**Final conviction = deterministic signal strength × memory/playbook multiplier × AI modifier**, checked against the mode's bar.

**Why it abstains a lot — and why that's the point.** Most cycles end in a green **"No clear edge · capital protected"** card. The operator does **not** trade for the sake of trading; it only acts on a real edge. In a down market, *not losing* is the win. Abstention is recorded as a first-class success. Reasons it holds: range-bound regime · no tradeable up-trend · sub-lot cash · **AI vetoed/dampened** · **Guardian paused** · allowance used up · mandate drawdown guard tripped.

---

## 7. The intelligence — where the AI works, and how it's a real AI agent

**Own the hybrid; it's a deliberate choice for safety + transparency.** Brief is **not** a black-box deep-learning price predictor — and it doesn't pretend to be. It's a **deterministic signal core with a safety-critical LLM advisor on top**, plus real memory. That makes it adaptable, explainable, and verifiable — exactly what you want for an agent moving real money.

**Where the AI genuinely acts** (`agents/workforce/trader/ai-advisor.ts`):
- On every meaningful cycle (tradeable regime, plausible base conviction), the operator sends its full context — portfolio, signals, regime, budget, mode, recent memory, and a 6-hourly **macro briefing** — to an LLM and **folds the verdict back into the engine**, so the AI moves the act-gate and the allocation. It can **sharpen, dampen, or hard-veto** conviction.
- **Model: `x-ai/grok-4-1-fast-non-reasoning`** (Grok 4.1 Fast) via **CommonStack**. A *non-reasoning* model → clean JSON, no scratchpad, ~5–6s. Config: strict JSON-only system message, `temperature 0`, `top_k 40`, `max_tokens 700`, 20s timeout, fence-proof parsing. Centralized as `DEFAULT_AI_MODEL` in `agents/lib/llm.ts` (also used by macro, reflections, narration).
- **Two hard guarantees:** the AI can **never invent a trade** the signals don't support, and the **Move policy still gates execution** regardless of what the AI says. Capital is never at the LLM's mercy.
- **Budget-safe:** fires only on a tradeable regime, rate-limited (~once/5 min per operator), weekly-capped (1500), deterministic fallback on any error.
- **Verifiable:** when the AI shapes a decision, its exact prompt + response anchor to **Walrus** (`brief.ai-reasoning.v1`). The Brain shows the model badge + a Walrus link — the *reasoning itself* is auditable, not just the trade.

**The judge framing:** *"The AI advisor sharpens or vetoes decisions based on macro context, memory, and risk appetite. It's not a black-box predictor — it's a safety-critical advisor that makes the operator adaptable and explainable, and its reasoning is verifiable on Walrus."*

**The other intelligence layers:**
- **Experience memory** — regime fingerprints + nearest-neighbour recall → a confidence multiplier (load-bearing).
- **Per-regime playbook** — the operator's own settled win-rate gates conviction (load-bearing).
- **Macro Regime Oracle** (`macro-briefing.ts`) — a 6-hourly LLM read on SUI/DEEP/WAL sentiment, fed into the advisor.
- **Daily Reflection** (`daily-reflection.ts`) — a once-a-day LLM self-critique (worked/failed/lesson), anchored to Walrus, shown on `/evolution`.

**Persisted per decision** (so the Brain can show the whole chain): `baseConfidence → aiConfidenceMod → final`, `aiDirection`, `aiVeto`, `aiRationale`, `aiSource`.

---

## 8. The two agents (multi-agent) — Trader + Risk Guardian

Brief isn't one agent — it's **two, coordinating**. The **trader** decides *when to allocate*; the **Risk Guardian** decides *when not to*.

**Risk Guardian** (`agents/workforce/guardian/index.ts`, its own process):
- Runs an independent ~45s loop, **read-only** (no keys, never touches funds).
- Computes each operator's **realized volatility** + **drawdown** from price history, plus a manual circuit-break (`GUARDIAN_FORCE_PAUSE`).
- **Hysteresis:** pauses on vol > 2.8 / drawdown > 12%, resumes only once both are back under 2.2 / 8%. Writes `guardian-status.json`.
- The **trader respects it before building any order** and stands down if paused. **Fail-open:** if the Guardian is down, trading continues, because the Move policy is still the ultimate gate and revoke overrides everything.
- Surfaced live on the dashboard ("Risk Guardian · monitoring / paused — reason"), in the AgentStrip, and as a per-decision shield in the Brain.

---

## 9. The fleet, the kill switch, the lifecycle

Runs on a VM under pm2: **`brief-trader`** (15s loop), **`brief-guardian`** (2nd agent), **`brief-web`** (Next.js), **`brief-warden`** (gas). The trader signs as the agent key; the Guardian holds no keys.

- **Kill switch:** the owner signs `operator_policy::revoke`; on the next tick `record_spend` aborts `EPolicyRevoked` and the loop retires the operator cleanly. No backend call. Funds stay in the BM; only new trades are blocked.
- **Withdrawal ≠ revoke** (independent, either order). Withdrawing returns 100% of capital to the owner (owner-only `withdraw_all` across USDC/SUI/DEEP). The ledger detects a withdrawal (value collapses below 50% of baseline) and **freezes** the marks — a withdrawal reads as "capital returned in full," **never as a −99% loss**. Withdrawn operators are retired (no zombie loop).
- **Gas:** `consolidateSuiCoins` runs before gas-sensitive ops so Walrus uploads / trades don't fail on coin fragmentation.

---

## 10. The pages — what each shows + how data flows

No database. Agents write `.cursors/*.json` (registry, experience, ledger, stats, guardian-status, macro-briefing, reflections, manifest); the web reads them via `/api/operators/*` + reads chain directly; the live decision cascade streams over SSE. **All data is real (chain / `.cursors` / Walrus) — no mocks.**

- **`/` — Landing.** A hand-coded `<canvas>` "Leash" animation (a gold operator tethered inside a boundary) + a live "Mind" pipeline that lights from real agent events + live network proof-stats. Editorial, light.
- **`/workforce` — the fleet / adopt entry.** Either operator cards (merging localStorage + on-chain via `useOperatorPolicies`) or the 3 mode cards to adopt.
- **`/workforce/adopt` — the wizard.** Mode → fund + leash (capital vs turnover allowance shown) → optional mandate → one signature → boot.
- **`/workforce?policy=<id>` — the dashboard** (most important; walletless, shareable; 2-column ≥1024px). Top: the **Operator Status Surface** — live state, the operator's *current thinking* as the headline, capital marked-to-market (real deposit), a multi-asset allocation bar, a **Risk Guardian row**, an advisory mode-suggestion chip, and vitals. Then the **AgentStrip** ("Two Agents & The Chain": Trader thesis+confidence · Guardian state · Leash spent/budget + 0 violations), Performance vs holding/cash, an inline **Latest Ledger** + **Proof Summary**, the **Operator Constitution** (six Articles tied to real Move enforcement), the custody chain (Protected by Sui), "How it thinks," and Live activity. Floating **Revoke** (chain-resolves ownership). Skeleton/empty states while warming.
- **`/brain?policy=<id>` — decision replay** (cinematic, one decision at a time): what it **saw** (regime + asset price) · **remembered** (recall) · **feared** (counterargument) · **"What the AI advised"** (deterministic → AI shift → final + verdict + rationale, model badge, Walrus link) · the **Guardian checkpoint** · what it **did** · what **happened** (+/−%, on-chain tx).
- **`/evolution?policy=<id>`** — lessons learned, a "the path" timeline, and **Daily Reflections** (Walrus-anchored self-critiques).
- **`/results?policy=<id>`** — "did it work?": a verdict, the **"if you'd done nothing"** comparison (operator vs hold SUI vs cash), the record grid (0 violations), and big moments.
- **`/proof?policy=<id>` — the courtroom** (the most important page): five numbered evidence cards, each a clickable on-chain/Walrus artifact via `EvidenceBadge` — the Move leash, every authorized trade (paginated `PolicySpend`), the `EBudgetExceeded` revert, the revoke + `EPolicyRevoked` abort, the Walrus manifesto. `revoked` is read **authoritatively from the live object** (a revoked operator can never show ACTIVE).
- **`/leaderboard`** — operators as a network (mainnet PolicySpend, USDC ÷1e6), ranked by activity.

---

## 11. Design system

**Register:** opening an institutional brokerage account, not launching a chatbot — light, precise, calm, "alive." **No component library** (fully custom): Tailwind v3 + `lucide-react` icons + `@mysten/dapp-kit` (connect button only). No shadcn/Radix/Framer; motion is custom CSS `@keyframes` + one `<canvas>`, behind a `prefers-reduced-motion` guard.

- **Type:** **Inter** (`font-sans`, stylistic sets `cv02 cv11 ss01`) for everything human; **JetBrains Mono** (`font-mono`) for data/addresses/labels. Signature: mono, uppercase, wide-tracked micro-labels + `tabular-nums` on every number.
- **Color:** light — `bg #FAFAFA`, cards `#FFFFFF`. A single semantic palette centralized in **`src/lib/ui.ts`**: INK `#0A0A0A`, SUB `#525560`, MUTED, LINE `#E5E5EA`; brand NAVY `#1a2c4e` + Sui blue `#4DA2FF`; SUCCESS/emerald `#10B981` (act/win/protected), DANGER/red `#EF4444` (abort/loss/revoke), CAUTION/amber `#F59E0B` (preserve/drawdown). Color carries state only.
- **Detailing:** sharp-cornered cards (`bg-bg-elev px-6 py-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]`), 3px top-accents for emphasis, hairline borders, generous whitespace.
- **Shared primitives** (`src/components/shared/`): `StatCard`, `EvidenceBadge`, `AgentStrip`, `OperatorConstitution`, `SkeletonCard`.

---

## 12. Tech map + ops

- **Move:** `move/sources/operator_policy.move`, `gated_spot.move`
- **Agents:** `agents/workforce/trader/` (`index.ts` loop, `decision-engine.ts`, `signals.ts`, `regime.ts`, `experience.ts`, `ai-advisor.ts`, `macro-briefing.ts`, `daily-reflection.ts`, `mandate.ts`, `ledger.ts`), `agents/workforce/guardian/index.ts`, `agents/workforce/lib/` (`deepbook-spot.ts`, `guardian-status.ts`, `markets.ts`), `agents/lib/{llm.ts (DEFAULT_AI_MODEL), env.ts, walrus.ts, sui-coin-consolidate.ts}`
- **PTBs:** `src/lib/deepbook-adopt.ts`, `deepbook-withdraw.ts`, `operator-policy-client.ts`
- **Surfaces:** `src/app/{workforce,workforce/adopt,brain,evolution,results,proof,leaderboard}/page.tsx`, `src/components/operator/*`, `src/components/shared/*`
- **APIs:** `src/app/api/operators/{decisions,ledger,proof,reflections,narrate,register}/route.ts`, `src/app/api/leaderboard/route.ts`, `src/lib/use-agent-stream.ts` (SSE)
- **Design:** `src/lib/ui.ts`, `tailwind.config.ts`, `src/app/globals.css`
- **Deploy (VM `141.148.215.239`, Brief-only, Caddy → usebrief.xyz):**
  `git reset --hard origin/main && rm -rf .next && NODE_OPTIONS=--max-old-space-size=1536 npm run build && pm2 restart brief-web brief-trader --update-env`
  - **Always `rm -rf .next`** before building — Next.js otherwise serves stale-compiled API routes from `.next/cache` (this caused real proof/leaderboard staleness bugs).
  - `next.config.mjs` skips in-build typecheck/lint; run `npx tsc --noEmit` separately.
  - `BRIEF_LLM_MODE=llm` is pinned in `.env.local`; agents run via `tsx --env-file=.env.local`.

---

## 13. Honest gaps & roadmap (say these before a judge can)

- It is **not** an alpha machine — it's a **trust + control layer** for agentic capital. It trades only on a real edge; in flat markets it holds.
- The intelligence is **deterministic signals + LLM modulation**, not a trained model. The LLM shapes conviction and is Walrus-verifiable — but it sharpens/vetoes an edge, it doesn't predict price.
- Win/loss settles on **raw mid moves** (no fees/slippage yet) → the recorded record is optimistic.
- Most cycles **abstain** — correct discipline, but it means the operator often does little on quiet pools.
- Fresh operators have **thin history** until they accumulate cycles.
- **Roadmap, not built:** MemWal (persistent semantic memory) + Scallop (idle-yield), both deferred to protect the proven mainnet loop.

*Bottom line: real, live on mainnet, multi-asset, on-chain-enforced, LLM-guided, and multi-agent — with every claim independently verifiable on Suiscan/Walrus.*
