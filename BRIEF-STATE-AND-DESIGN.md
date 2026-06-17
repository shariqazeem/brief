# Brief — State & Design

*Last updated: 2026-06-16. Authoritative snapshot of how the product works + looks today, after the Autonomous Portfolio Operator rebuild.*

---

## 1. What Brief is

**Adopt an autonomous financial operator. The chain holds the leash.**

A user deposits their own USDC, adopts **one AI operator** in one of **three modes**, optionally hands it an **investment mandate**, and the operator manages that capital on DeepBook — **autonomously, non-custodially, and gated on-chain.** It can trade the funds but can **never withdraw** them, can **never exceed** the budget cap, **stands down** if it would violate the mandate, and can be **revoked in one transaction**. Every one of those guarantees is a Move contract, not a backend setting.

The thesis that wins three tracks at once: **AI decides → Move enforces → the user revokes → non-custodial → all verifiable.**

### The wedge (vs Beep and every other "agentic finance" product)

Their "non-custodial" is **wallet-level**, and their spending limit is a **backend promise**. Brief's limit is **protocol-level**:

| Guarantee | Beep et al. | Brief |
|---|---|---|
| Funds stay in user's account | yes | yes |
| Spending cap enforced by | their backend | **a Move contract (`record_spend`)** |
| An over-budget trade | trusted not to happen | **reverts on-chain** |
| Mandate ("max 8% drawdown") | — | **operator stands down; visible + verifiable** |
| Kill switch | API toggle | **`operator_policy::revoke` tx** |
| Agent reasoning + memory | not published | **anchored on Walrus, and *used*** |
| Every decision | a black box | **fully replayable at `/brain`** |

`/proof` and `/brain` make all of this **verifiable on Suiscan/Walrus without trusting us.** Those are the pages they can't build.

---

## 2. On-chain architecture (the primitives)

Everything rests on DeepBook v3's BalanceManager + a small Move package (`brief::operator_policy`, `brief::gated_spot`).

**One adoption transaction** sets up the whole non-custodial relationship:

1. **`BalanceManager` (BM)** — created and **owned by the user**. Their capital lives here. Withdraw is owner-gated → the user keeps custody forever.
2. **`TradeCap`** — minted by the user, **delegated to the operator**. Place orders, **cannot withdraw**.
3. **`DepositCap`** — minted by the user, **delegated to the operator**. Lets the house top up the DEEP fuel tank. **Cannot withdraw.**
4. **`OperatorPolicy`** — the leash, a shared object the user owns: `budget_cap`, `allowed_venues` (`["spot-sui","spot-wal","spot-deep"]`), `expires_at_ms`, `agent`, `revoked`.
5. The user keeps the **WithdrawCap** (custody) the whole time.

**The gate — `operator_policy::record_spend`** runs in the *same PTB* as every trade and aborts on: sender ≠ `agent` (`ENotAgent`), `revoked` (`EPolicyRevoked`), expired (`EPolicyExpired`), `spent + amount > budget_cap` (`EBudgetExceeded`), venue not allowed (`EVenueNotAllowed`). Because `record_spend` and the DeepBook order share one transaction, **a violation reverts the whole trade — the order never executes, no funds move.**

---

## 3. The decision engine — the operator's brain

One operator, **three modes**, a **transparent 9-step pipeline** run over real market signals every cycle. Deterministic core (honest, reproducible — it articulates real logic over real inputs; an AI layer can later author the prose without changing the trust model). File: `agents/workforce/trader/decision-engine.ts`.

**The 9 visible steps** (rendered live on the dashboard, in order):

1. **Observe** — SUI/USDC mid + a price sparkline.
2. **Recall · experience** — similar past situations and what they did to confidence (see §4).
3. **Build thesis** — the case *for* a move (ROC, MA alignment, spot vs short MA).
4. **Challenge thesis** — the explicit **counterargument** (flat tape / RSI exhaustion / snap-back risk).
5. **Risk review** — budget used, realized vol, the mode's confidence bar.
6. **Execution analysis · DeepBook** — real slippage / depth / DEEP fee (see §5).
7. **Policy review** — the operator's own pre-check; the Move policy re-checks atomically.
8. **Decision** — ACT ▲/▼ or the green **NO TRADE · Capital protected** card.
9. **On chain** — the actual fill (Suiscan tx) or "stood down — no order placed."

**Three modes** (`MODE_CFG`) — one engine, different bars:

| Mode | minConfidence | rocFloor | rsiCeiling | Character |
|---|---|---|---|---|
| **Protect** | 0.66 | 0.40% | 64 | Acts only on a strong, confirmed trend; most cycles end green. |
| **Grow** (default) | 0.50 | 0.25% | 72 | Trades a real edge, stands down on noise. |
| **Aggressive** | 0.38 | 0.15% | 80 | Lower bar, more trades, more risk — still hard-capped. |

**Abstention is a success.** "No trade · Capital protected" is a first-class outcome with a big green card — discipline, not inaction. Hitting the budget cap is also graceful: the operator abstains and stays **alive** (it never self-destructs on an over-budget revert).

---

## 4. The Experience Engine — memory, not logs

`agents/workforce/trader/experience.ts`. Before every decision the operator **recalls structurally similar past situations** and their outcomes reshape its confidence:

> *"Found 3 similar situations: 2 settled against → confidence reduced ×0.70."*

- **Regime fingerprint** per decision: ROC 30m, RSI 60m, trend (MA alignment), realized vol.
- **Recall** = nearest regimes by normalized distance; outcomes → a confidence multiplier (more past losses dampen, wins reinforce).
- **Settlement** — a pending ACT settles win/loss by marking the decision's mid against later price.
- **Walrus** — the experience snapshot is anchored on Walrus (`kind: experience`), so the memory it reasons from is *verifiable, not claimed*. This is "uses Walrus to improve future decisions," not "stored on Walrus."

---

## 5. DeepBook execution analysis

Before firing, the operator simulates the **actual order against the live book** (devInspect, no signing) and reports **real** numbers — `pool::get_quote_quantity_out` (sell) / `get_base_quantity_out` (buy): effective slippage vs mid, depth, and the DEEP fee required. A thin book or slippage **over 1.5%** vetoes the trade; a read failure is **fail-safe** (never blocks — the on-chain order + Move policy stay the true gate). Verified live on SUI/DBUSDC (1 SUI sell ≈ 0.51% slippage).

---

## 6. The user mandate — a human objective it can't violate

`agents/workforce/trader/mandate.ts`. Optional at adoption: **target return % · horizon · max drawdown %** (e.g. *"grow 15% in 180 days, never down more than 8% from peak"*).

- Each cycle the operator **marks its portfolio to market** (quote + base·mid), tracks the **peak**, and if drawdown hits the limit the engine **hard-vetoes** new trades — *"mandate guard tripped, standing down."* It will not open risk that violates the human's instruction. (The on-chain budget cap remains the hard floor underneath.)
- The mandate is shown as a prominent **banner** (objective + live progress + a drawdown bar that goes emerald→amber→red), and anchored on Walrus.

The memorable judge line: **User sets mandate → Agent understands → Chain enforces → Agent later finds an opportunity → Chain/operator denies it (violates mandate).**

---

## 7. The agent loop + kill switch

Runs continuously on a VM (pm2 `brief-trader`), signing as the operator/treasury key every policy delegates to. Every **45s** the loop: reads the operator registry (skips revoked) → observes the SUI/USDC mid + computes the signal bundle → for each operator runs **§3–§6** (recall → engine pass 1 → execution analysis → engine pass 2 with the veto folded in → mandate guard) → on ACT: fuel check (DEEP via DepositCap) → inventory check → **gated trade** (one PTB: `record_spend` + `place_market_order`) → records the decision to the experience archive + Walrus → emits the whole cascade over SSE so the dashboard renders it live.

**Kill switch:** the user signs `operator_policy::revoke`; on the next tick `record_spend` aborts `EPolicyRevoked` and the loop retires the operator. No backend call. Funds stay in the user's BM; only new trades are blocked.

---

## 8. The Operator Brain — every decision inspectable

`/brain?policy=0x…` — **read-only, public, no wallet.** A judge sees, for every decision: **What I saw** (regime) · **What I remembered** (recall) · **My thesis** · **What I feared** (counterargument) · **Execution quality** (slippage) · **Policy constraints** · **Why I decided** + confidence · **What happened** (+/-%, on-chain tx). Plus an **"operator evolves"** bar — prior→recent settled win-rate — so Walrus reads as long-term learning. Backed by `/api/operators/decisions` over the persisted experience archive.

---

## 9. User flow — choose → (mandate) → deposit → adopt → run → watch → revoke

Two adoption paths, both reframed to **one operator, three modes**:

- **`/workforce`** (primary, inline) — disconnected hero "One operator. Three modes." → 3 mode cards (each shows a live "would act / would hold" read) → connect → inline panel (mode, deposit, "Get test USDC") → **one signature** → boot ceremony → live dashboard.
- **`/workforce/adopt`** (the clean wizard) — progressive reveal: choose a mode → set the leash (budget) → **optional mandate** (target / horizon / max drawdown) → deposit → **Adopt in {Mode} mode — One Signature** → 5-step trust narrative → redirect to the live operator.

One tx creates BM → deposits USDC → delegates TradeCap + DepositCap → creates the OperatorPolicy (14-day expiry). The loop picks it up within ~45s, fuels it, and runs the full pipeline.

### The surfaces

- **`/`** — landing (operator-first, no personalities).
- **`/workforce`** — adoption gallery + "View operator →" resume banner.
- **`/workforce?policy=<id>`** — the live dashboard. Walletless + shareable. Tabs: **Now** (the 9-step pipeline live + mode badge + mandate banner + fuel gauge + SUI chart), **Journal** (decisions + Walrus links, including the **Experience memory** blob), **Policy** (budget/spent/remaining, venues, agent, owner, expiry, manifesto). Bottom strip = last-10 dots.
- **`/brain?policy=<id>`** — the Decision Replay (§8).
- **`/proof?policy=<id>`** — five clickable on-chain/Walrus verification cards (Policy · Spend Witness · Failed Over-Budget Trade · Revocation · Manifesto).
- **Floating REVOKE** — bottom-right on every operator surface, with an on-chain receipt.

---

## 10. Networks

**Testnet — LIVE now.** Brief package `0xe550ace873c02768dbaca7de3a2d64a28acd3f7c51551c9c97b704703e95fb9d`; capital coin DBUSDC; pair SUI/DBUSDC (pool `0x1c19362c…`, DeepBook v3 pkg `0x22be4cade…`); operator/treasury `0xa9f24640…b6ddbf`. Proven on chain: autonomous fuel + gated buy, over-budget revert, revoke, Walrus manifesto. Honest caveats: testnet SUI ≈ $0.78 on the testnet pool (real, not mainnet pricing); testnet DBUSDC liquidity is thin (the in-app swap yields small amounts).

**Mainnet — code is network-aware; the credibility priority.** `buildAdoptTx`, the gated trade, and the loop switch to real USDC + mainnet DeepBook when `network = mainnet`. **Gaps to close before flip:** wire the mainnet SUI/USDC pool id + the mainnet trader context (the loop currently logs "awaiting mainnet publish + context"), re-verify the mainnet DeepBook package id + USDC type. **User's part (keys/funds):** `sui client publish` the package, fund treasury (gas + DEEP), adopt with real USDC. Min order = 1 SUI (~$3–4), so a deposit must clear that to trade.

---

## 11. What's live vs pending (honest status)

**Live + verified (testnet):** one-signature non-custodial adoption; the 9-step decision engine (3 modes); abstention-as-success + graceful budget cap; the Experience Engine (recall + Walrus, verified 7/7); DeepBook execution analysis (verified live); the user mandate + drawdown guard (verified 6/6); the Operator Brain `/brain`; one-tx kill switch; Walrus journal/manifesto/experience; `/proof`; both adoption flows; floating kill switch; "Get test USDC". Decision-engine behavior verified across the 4 scenarios (strong trend / choppy / budget-exhausted / revoke).

**Pending:** mainnet prep (pools + context — mine) then publish + funding (yours); the AI-authored thesis layer (P4 — CommonStack key staged, **deliberately delayed** per the "proof over features" steer); mandate input on the inline `/workforce` panel; demo video + `/proof` polish.

---

## 12. Design system — how Brief looks (and where to push it)

The register: **opening an institutional brokerage account, not launching a chatbot.** Light, precise, calm, "alive." Apple-clean foundation; Linear/Kyvern-grade hierarchy. CSS-only motion with a `prefers-reduced-motion` guard. No AI-slop gradients, no emoji-as-UI.

### 12.1 Color (tokens in `tailwind.config.ts`)

**Foundation (neutrals):**
- `bg #FAFAFA` · `bg-elev #FFFFFF` · `bg-elev-2 #F5F5F7` — off-white canvas, white cards.
- Text 4-tier: `ink #0A0A0A` · `ink-2 #525560` · `muted #8E8E93` · `muted-2 #C7C7CC`.
- Borders: `line #E5E5EA` (default hairline) · `line-strong #D1D1D6` · `line-subtle #F0F0F0`.

**Brand:**
- `accent #1a2c4e` (navy) + `accent-hover #2c3e5f` + `accent-bg #EEF1F6` — primary CTAs, active states, `::selection`. Kept navy so Brief reads distinct beside Kyvern's blue.
- `sui #4DA2FF` — used sparingly for status dots + on-chain links.

**Semantic (the operator's language — currently inline hex in dashboard/brain):**
- **Emerald `#10B981`** (+ deep `#047857`) — act / win / healthy / "capital protected."
- **Red `#EF4444`** — abort / loss / revoke / over-limit.
- **Amber `#F59E0B`** — preserve / fuel-low / caution / drawdown nearing limit.
- **Blue `#4DA2FF`** — settling / pending / on-chain.
- **Greys `#CCCCCC`/`#D4D4D4`** — pending/idle pipeline steps.

### 12.2 Typography

- **Inter** (`--font-inter`, `font-sans`) for everything human; **JetBrains Mono** (`--font-jetbrains`, `font-mono`) for data, addresses, tx digests, and **micro-labels**.
- Inter stylistic sets on: `font-feature-settings: "cv02","cv11","ss01"`; base `letter-spacing: -0.005em`; headings `tracking-tightest (-0.04em)` / `tighter`. Hero `display`/`display-sm` use `clamp()`.
- The signature tic: **mono, uppercase, wide tracking (0.16em–0.36em)** for every small label ("OBSERVE", "RISK REVIEW", "MANDATE"), and **`tabular-nums`** on every number so columns don't jitter.

### 12.3 Layout & detailing

- Widths: `max-w-page 1180px`, `max-w-prose 640px`; operator dashboard `max-w-4xl`, the pipeline `max-w-xl`.
- **Mostly 0px radius** (sharp, institutional), with deliberate exceptions: `rounded-md` on emphasis cards (the ACT/NO-TRADE verdict, mandate banner) and `rounded-full` on dots + progress bars.
- Hairline `1px` borders (`#E5E5EA`/`#F0F0F0`); whisper shadows `shadow-[0_1px_3px_rgba(0,0,0,0.06)]`. Generous whitespace.
- The decision pipeline is a **numbered vertical rail** (22px circular nodes connected by a thin line) — done nodes fill, the active one pulses, pending are grey.

### 12.4 Motion (the "alive" layer)

All keyframed in `tailwind.config.ts` + `globals.css`, eased `cubic-bezier(0.22,1,0.36,1)`:
- **Reveal:** `fade-up` (360ms), `land-in` (on-chain rows landing).
- **Heartbeat (sells "live"):** `operator-pulse-line`, `operator-scan`, `operator-ripple`, `op-breathe`, `op-glyph`, status-dot `animate-pulse`.
- **Ceremony:** the boot sequence (`boot-veil` + `boot-sweep` + staggered `boot-stagger-1..6`) when an operator goes live; `revoke-darken` + `chain-intervention` red wash when the chain aborts; `ended-desat` drains color on terminal state; `value-tick`/`rejection-flash` for "something just changed."
- All neutralized under `prefers-reduced-motion: reduce`.

### 12.5 Attention-to-detail wins already in place

Status dot that pulses only while acting; abstention rendered as a *green success*, not a grey absence; the mandate drawdown bar shifting emerald→amber→red; "would act / would hold" live reads on the mode cards before you even connect; walletless, shareable `/brain` + `/proof` + dashboard; honest copy everywhere ("stood down — no order placed", "honest loss").

### 12.6 Where to push it (improvement backlog)

- **Token discipline:** the dashboard + `/brain` hardcode semantic hex (`INK #111111` ≠ token `ink #0A0A0A`; emerald/red/amber inline). Promote these to Tailwind theme tokens (`success`/`danger`/`caution`/`info`) so the palette is centralized and themable.
- **Brand presence:** the navy `accent` barely appears on operator surfaces (they're ink+emerald). Brief's identity could be stronger — a consistent accent moment per surface.
- **`/brain` polish:** it's functional but plainer than the cinematic dashboard — it deserves the same rail/heartbeat treatment and a stronger header.
- **Pipeline density:** 9 steps is a lot on mobile; consider progressive disclosure (collapse upstream steps once decided) and tighter responsive spacing.
- **No dark mode** yet; the chart (`operator-chart`) styling is minimal; card radius is inconsistent (mix of 0 and `rounded-md`) — pick one rule.
- **Empty states** (fresh operator "building experience" / "no decisions yet") are honest but visually thin — a chance to teach the model while it warms up.

---

## 13. Tech map (where things live)

- **Move:** `move/sources/operator_policy.move`, `move/sources/gated_spot.move`
- **Engine + memory:** `agents/workforce/trader/decision-engine.ts`, `experience.ts`, `mandate.ts`, `spot-handler.ts` (mid + `readSpotExecution`), the loop in `index.ts`; deterministic strategy/calibration in `strategy.ts`; gated-trade + fuel in `agents/workforce/lib/deepbook-spot.ts`
- **Adoption PTB:** `src/lib/deepbook-adopt.ts`; **Get test USDC:** `src/lib/deepbook-get-usdc.ts`
- **Surfaces:** `src/app/workforce/page.tsx` (inline adopt), `src/app/workforce/adopt/page.tsx` (wizard), `src/components/operator/operator-dashboard.tsx` (dashboard + pipeline), `src/app/brain/page.tsx`, `src/app/proof/page.tsx`, `src/components/operator/floating-kill-switch.tsx`
- **APIs:** `src/app/api/operators/register/route.ts` (persists mode + mandate), `…/decisions/route.ts` (Brain archive), `…/proof/route.ts`, `src/lib/use-agent-stream.ts` (SSE)
- **Design:** `tailwind.config.ts` (tokens, keyframes), `src/app/globals.css` (utilities + motion guard), `src/app/layout.tsx` (Inter + JetBrains Mono)
- **Deploys:** VM `141-148-215-239.sslip.io` (web + agents + registry + live loop); Vercel `brief-olive.vercel.app` (frontend → VM API).
