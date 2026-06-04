# Brief — Product State

Comprehensive snapshot as of **2026-05-25**, after the live-signals + mission-objective + chain-intervention pass. Written so an advisor, judge, or new contributor can read this cold and understand exactly what is real, what is heuristic, what is simulated, and how the whole thing fits together — visual, code, narrative.

---

## 0. Hackathon context (where this is going)

| Field | Value |
|---|---|
| Event | **Sui Overflow 2026** |
| Track | **Agentic Web** |
| Sub-tracks (merged) | **#2 Autonomous Agent Wallet · #3 Intent Engine** |
| Special prizes pursued | **DeepBook** (live integration on testnet) |
| Special prizes deferred | **Walrus** (deferred to v2 — landing claim removed to stay honest) |
| Tracks explicitly skipped | DeFi & Payments, Cross-chain — would dilute positioning |
| Network | **Sui testnet** (mainnet is roadmap-post-submission) |
| Submission deadline | **2026-06-21** |
| Demo target | **90 seconds**, Chrome desktop, 1080p |
| Builder | Shariq Shaukat — [@shariqshkt](https://x.com/shariqshkt) |

### Why sub-tracks 2 + 3 are the same product

The Intent Engine sub-track requires text-→-PTB-→-execution flow with human-readable PTB preview, ≥2 risk-class guardian warnings, and an explicit confirmation step. The Autonomous Agent Wallet sub-track requires a chain-enforced policy capability with revocation that actually blocks the agent.

Brief satisfies both with **one Move object** (`OperatorPolicy`) and **one autonomous loop**. The "constraint editor" in `GrantCeremony` is the PTB preview (every parameter the agent will run inside is visible before signing); the grant signature is the confirmation; the policy's on-chain asserts are the guardian; revocation hits the Move asserts in the agent's next PTB and aborts on-chain.

### Why DeepBook special prize is in scope

The operator's execution PTB calls `deep_book::place_market_order` on the SUI/DBUSDC pool in the same transaction as `record_spend`. When the agent wallet has ≥ 1.5 SUI free, the mode flips from `simulated` → `deepbook` automatically (verifiable in the action card's mode label and the tx digest's balance changes).

---

## 1. The product, in one paragraph

**Brief is a policy-controlled autonomous wallet for AI agents on Sui.** A human defines an *operator* — an envelope of budget, allowed protocols, max position size, expiry, risk profile, auto-approve threshold, **and a mission objective** — and signs it once. The envelope is a Move shared object called `OperatorPolicy`. An autonomous Node agent runs inside that envelope: every 15 s it fetches live market signals from DeFiLlama and Sui RPC, derives a world-state regime, scores each allowed venue against a deterministic policy that weighs liquidity, yield, execution quality, and risk-tolerance fit; picks one action that fits; and submits a single atomic Sui transaction that performs `record_spend` (the on-chain enforcement check), the trade (real DeepBook order when the wallet is funded, simulated mode otherwise), and the audit log mint — all or nothing on-chain. The agent carries running memory (recent venues, posture, average confidence); on process restart it rehydrates from chain history. The human holds a kill switch: a single signature flips `policy.revoked = true`, and the agent's next attempted spend hits `assert_can_spend`, aborts on-chain with `EPolicyRevoked`, and the entire UI freezes for ~2 s in deference — heartbeats stop, scan lines pause, a red ambient veil settles — while a Rejection WorkObject lands as audit evidence with the Move abort code cited in the policy-breach lifecycle.

**Tagline:** *Autonomous financial operators on Sui.*

**Manifesto (used as demo narration):** *The AI is not trusted. The policy is.*

**Strategic reframing (post-pivot 2026-05-23):** Brief is not an AI portfolio bot. Brief demonstrates **constitutional finance** — bounded autonomous authority granted to a software agent, enforced by the chain, revocable in one signature. The mission-objective field is the user's *charter*; the envelope is the *constitution*; the WorkObject log is the *audit trail*; revocation is the *separation of powers* working in real time.

---

## 2. The architectural thesis (why Sui specifically)

Build the same product on Solana / Ethereum and the policy lives in a backend database, the kill switch is a server flag, and the trust surface is whatever process honors that flag.

On Sui:

1. **`OperatorPolicy` is a Move shared object** — capability-as-data, on-chain, queryable, ownable.
2. **`assert_can_spend(policy, amount, venue, clock)` runs in the same PTB as the trade.** Move's atomicity means revoked-200 ms-ago aborts the *entire* transaction including the DeepBook call.
3. **The audit log is itself a Move object** — each action is a `WorkObject` parented to the policy id. Compose-by-parentage, queryable by `getOwnedObjects`, immortal under the typed account model.
4. **DeepBook native CLOB** — real fills in the same PTB as policy enforcement. No oracle dependency, no AMM-only slippage simulation, no separate settlement step.

Trying to reimplement this on a non-Move chain reinvents half of Move's type system in your backend. The policy isn't *modeled* on-chain — the policy *is* on-chain.

---

## 3. URLs + how to run

| Surface | URL / Location |
|---|---|
| Production landing | http://localhost:3000/ (Vercel deployment planned post-submission) |
| App console | http://localhost:3000/app |
| Off-chain mandate API | http://localhost:3000/api/objectives |
| Published package (LATEST, v2) | `0xb047640605f00ab27a68a900ca6177ae07e3aa9da0feae39c9851e5a32bbd1c0` |
| Type origin id (v1, used in type filters) | `0xfa3a152aff2aba3886bf0fb41328e72da5ccd637074d4673c36b1924c850d084` |
| Agent wallet (operator address) | `0xd440b0b59ed5474b32ceb71d819c474e1512747179b7088ff324012767f5b435` |
| Sui Explorer | https://suiscan.xyz/testnet/object/`0xb04764…` |

### Run locally

```bash
# Frontend
npm run dev                   # http://localhost:3000

# Operator agent (15 s cycles, mints Operator + Rejection WorkObjects)
npm run agent:operator

# Both together (concurrently)
npm run agents:all
```

Each operator policy is a shared object — agent loops attach on `PolicyCreated` events filtered to the agent address, and the user grants from the browser via dApp Kit.

---

## 4. The on-chain primitive: `OperatorPolicy`

A single Move module: [`move/sources/operator_policy.move`](move/sources/operator_policy.move). 9/9 unit tests pass.

### Fields

```move
public struct OperatorPolicy has key, store {
    id: UID,
    owner: address,             // only address that can revoke / extend
    agent: address,             // only address that can record_spend
    name: String,               // display name
    budget_cap: u64,            // total budget in MIST
    spent: u64,                 // running total, bumped by record_spend
    allowed_venues: vector<String>,
    max_concentration_bps: u16, // 3000 = 30% single-position cap
    expires_at_ms: u64,         // unix ms
    auto_approve_pct: u8,       // actions below this % of remaining auto-execute
    risk_tolerance: String,     // low | medium | high (informational on-chain)
    revoked: bool,              // THE kill switch
    created_at_ms: u64,
}
```

### Abort codes (the chain's vocabulary)

| Code | Constant | Meaning |
|---|---|---|
| 1 | `ENotOwner` | only owner can revoke/extend |
| 2 | `ENotAgent` | only bound agent can record_spend |
| 3 | `EPolicyRevoked` | the kill switch fired |
| 4 | `EPolicyExpired` | expiry timestamp reached |
| 5 | `EBudgetExceeded` | spent + amount > cap |
| 6 | `EVenueNotAllowed` | venue not in allowlist |
| 7 | `EInvalidConfig` | malformed at creation |
| 8 | `ECannotShrink` | `extend` cannot reduce budget or expiry |

### Public functions

- `create(...) → ID` — caller becomes owner; policy is shared
- `assert_can_spend(&policy, amount, &venue, &clock, &ctx)` — read-only enforcement; aborts on violation
- `record_spend(&mut policy, amount, venue, &clock, &mut ctx)` — calls assert + bumps `spent`; emits `PolicySpend`
- `revoke(&mut policy, &clock, &ctx)` — owner-only; flips `revoked = true`; emits `PolicyRevoked`
- `extend(&mut policy, new_budget_cap, new_expires_at_ms, &clock, &ctx)` — owner-only; raise budget/expiry (cannot shrink)

### Important constraint

The v1 → v2 package upgrade used `compatible` mode. We **cannot** add fields to `OperatorPolicy` without a non-compatible upgrade. This is why the `objective: String` (the operator's mission charter) lives **off-chain** in `.brief/objectives.json` keyed by policy id, written via `/api/objectives` and read by the agent via `objectives.ts`. Honestly framed in the UI as "the mandate the operator is serving" — every constraint that's actually enforced is on-chain; the objective is the *spirit* the user gave the agent, surfaced in every action payload for inspection.

---

## 5. Design system

### Palette (Tailwind tokens)

| Token | Hex | Use |
|---|---|---|
| `bg` | `#f4f2ec` | page background (cream foundation) |
| `bg-elev` | `#fbfaf6` | cards / surfaces (one step lighter) |
| `ink` | `#1a2c4e` | primary text + brand (navy — legal/document register) |
| `ink-2` | `#2c3e5f` | secondary text |
| `muted` | `#6b7888` | tertiary text / labels |
| `line` | `#d8dee8` | borders |
| `line-strong` | `#bcc6d4` | emphasized borders |
| `sui` | `#4DA2FF` | brand accent (used very sparingly — status dot, on-chain confirmations) |

Brand inheritance: cream + navy is the sibling product palette to Kyvern (cream + warm-black). Reads as "same author, different product" without forcing a separate identity.

Functional accents (used inside cards, never the chrome):

- **Green 600 / 700 / 800** — life / acceptance / live state
- **Red 100 → 800** — chain intervention / abort / decommissioned
- **Amber 500 / 600 / 700** — elevated / defensive / fragmented world states

### Typography

- **Sans:** `var(--font-inter)` — JetBrains-style letterspacing in display sizes
- **Mono:** `var(--font-jetbrains)` — used for every number, eyebrow, on-chain identifier, status pill
- **Display scale:** `clamp(3rem, 8vw, 5rem)` (display-sm) / `clamp(4rem, 10vw, 6.5rem)` (display)
- **Letter-spacing tokens:** `tightest: -0.04em` (hero), `tighter: -0.02em` (headings)

The visual register is **deliberately not a fintech dashboard**. Numbers use mono with tabular-nums; eyebrow labels use uppercase 10–11 px with 0.22em tracking; the whole thing reads more legal-document than crypto-trader.

### Motion philosophy

CSS-only — no Framer Motion. Three tiers:

1. **Continuous (subliminal)** — the operator is *alive*. Slow heartbeat on top accent (2.8 s `operator-pulse-line`), low-contrast horizontal scan line that sweeps the card every 7 s (`operator-scan`), `animate-ping` halo on the live-state PulseDot.
2. **Event-triggered (single-fire, 700–880 ms)** — `operator-ripple` (new action lands), `rejection-flash` (chain aborted), `value-tick` (remaining-SUI decrements), `boot-stagger-*` (card materializes element-by-element on first mount).
3. **Ceremony (page-level, 1–2 s)** — `boot-veil` + `boot-sweep` (Grant → Live, 1600 ms layered scanner + dim), `revoke-darken` (radial red wash on revoke signature, 1000 ms), **`chain-intervention`** (the new 2000 ms freeze when the chain actually intervenes — see §11).

All animations respect `prefers-reduced-motion`. The `data-chain-intervention="1"` attribute on `<html>` pauses every continuous animation for the duration of the ceremony.

---

## 6. Pages walkthrough

### 6.1 Landing — `/`

[`src/app/page.tsx`](src/app/page.tsx) — a single static page, ~440 LOC. Structure:

1. **Header** (top, sticky-free) — Brief mark (two stacked horizontal lines = the work-objects glyph) + nav anchors (`Demo`, `Why Sui`, `Sub-track`) + GitHub link.

2. **Hero**
   - `StatusPill` — pulsing-green dot + "Live on Sui testnet · 0xb04764…d1c0" linking to suiscan
   - `<h1>` "Autonomous financial operators on Sui." in display scale, tightest tracking
   - Sub-paragraph naming the four-stroke flow: grant → operate → revoke → on-chain block
   - CTAs: "Try Brief" (filled navy) + "See the flow" (outlined)
   - Footer line: "Sui Overflow 2026 · Agentic Web · Intent Engine sub-track"

3. **`/how-it-works`** — three `StepCard`s in a grid
   - **01 · Grant** — code preview showing the `create()` Move call with realistic args (`budget_cap: 50_000_000_000` MIST, `max_concentration_bps: 3000`, etc.); "0 SUI fee" eyebrow on the right
   - **02 · Operate** — code preview of the atomic PTB (`record_spend` + DeepBook market order + `work_object::mint`) with parents pointing to the policy id; "0.1 SUI receipt" eyebrow
   - **03 · Revoke** — code preview of `operator_policy::revoke` followed by the agent's next attempt aborting with `EPolicyRevoked (code 3)` and minting a Rejection WorkObject; "kill switch" eyebrow

4. **`/why-sui`** — four-cell grid (`WHY_SUI`)
   - **Capability objects** — OperatorPolicy *is* the capability; the chain holds it
   - **Atomic PTBs** — policy violation aborts the whole transaction including the trade
   - **Programmable enforcement** *(new — replaces the old Walrus claim)* — revoke flips one bool; Move atomicity guarantees the next PTB aborts as a unit
   - **DeepBook native CLOB** — real fills, real prices, in the same PTB as the policy check

5. **`/sub-track`** — must-haves matrix with two columns per row (must / answer). Six items covering on-chain enforcement, revocation, text→PTB flow, human-readable preview, guardian risk surfacing, and explicit confirmation.

6. **Footer** — Brief mark + "Sui Overflow 2026 · Submission 2026-06-21" + @shariqshkt link.

The whole landing is **static** (`○` in Next's build output: 138 B). Loads on first paint, no client JS for the marketing path.

### 6.2 App console — `/app`

[`src/app/app/page.tsx`](src/app/app/page.tsx) — the entire operator experience lives behind one route. The body is a state machine driven by wallet connection + on-chain policy state.

**Top chrome:** `PersistentHeader` (sticky) — Brief mark + connect button + (when there's a live policy) state pulse + operator name + remaining-SUI value-tick + expiry countdown + **WORLD STATE pill** *(new)* + Revoke button.

**States:**

#### A. Disconnected (no wallet)

`ConnectGate` — hero-scale headline, the philosophy line in pulsing mono, dApp Kit `ConnectButton`, suiscan link to the published package.

#### B. Connected, no policies ever

`GrantFlow` — three-stage `GrantCeremony` (see §6.3).

#### C. Connected, has a head policy (live | revoked | expired | exhausted)

`OperatorConsole` — the dashboard. Five visual zones in vertical order:

1. **OperatorCard** ([`src/components/operator/OperatorCard.tsx`](src/components/operator/OperatorCard.tsx))
   - Eyebrow: `OPERATOR · granted 4m ago`
   - Title: policy name in display scale
   - Subtitle: `Operating on DeepBook · NAVI · Suilend`
   - Bound-to line: agent address truncated + `risk low`
   - **MissionLine** *(new)* — mandate quoted with left-border accent, italic, mono eyebrow
   - **WorldStateBadge** *(new)* — color-coded pill (calm green / elevated amber / stressed red / unknown muted) with the regime label + caption from the latest action's `world_state`
   - **Heartbeat row** — `PulseDot` (md) + state label (`OPERATOR ENGAGED` / `SCANNING` / `DEPLOYING` / `BLOCKED BY POLICY` / `REVOKED` / `EXPIRED` / `BUDGET EXHAUSTED`) + countdown to next scan
   - **Enforcement evidence** — `7 actions accepted on-chain · 0 rejected by policy` (count of Operator vs Rejection WOs parented to the policy)
   - Continuous motion: top accent pulse-line, full-card scan line at 7 s cycle, ripple ring on new actions (sibling overlay div so box-shadow can extend beyond the card)
   - One-shot motion: `animate-ended-desat` on live → terminal transition

2. **RevokePendingBanner** (visible only between sign-revoke and on-chain Rejection)
   - Red surface with intensifying alpha (0.55 → 0.92 as the countdown hits zero)
   - Accelerating scanner line (1700 ms → 520 ms cycle)
   - Under 5 s remaining: "Imminent." copy, large countdown (text-[20px]), ShieldOff icon pulses

3. **ActivityStream** — `TELEMETRY · 7` heading + "Show telemetry detail" toggle
   - **ScanningRow** (top, only when live) — animated green dot + "SCANNING VENUES" + countdown + last-decision recap (`last decision · score 0.78 on NAVI`). Falls back to muted "AWAITING NEXT CYCLE" when overdue > 6 s (RPC throttle / paused agent — honest surface)
   - **StoodDownRow** (top, only when terminal) — red dot + state copy
   - **OperatorActionRow** per Operator WorkObject:
     - Row: marker · venue · amount · rationale · inline confidence cue (`score 0.78 · decisive`) · `formatRelative` · chevron
     - Expanded: **DecisionTrace** (see below) + FillDetail (pool · amount in/out · price · mode label · WO id with suiscan link)
   - **RejectionRow** per Rejection WO — red bg, red left border, `animate-rejection-flash` halo on first mount
     - Row: marker · "authority revoked" / "chain aborted" · venue · amount · reason · `policy enforced by Sui` badge
     - Expanded: **Policy Breach Lifecycle** *(new)* (5 numbered beats, see §11) + attempted rationale (italic) + Move abort error (mono, red-100 inset) + WO id link
   - **GrantRow** (bottom) — black marker · `MANDATE GRANTED` · envelope size + venue count · createdAt

4. **DecisionTrace** (inside expanded Operator row)
   - Eyebrow: `DECISION TRACE` + confidence `78% · decisive`
   - **Component bars** *(new)* — 4-column grid: `liquidity 0.62`, `yield 0.71`, `execution 0.58`, `policy fit 0.78` — each with a thin horizontal bar
   - **Venue ranking** — full evaluator output as horizontal bars (chosen = green, others = ink/25)
   - **Provenance line** *(new)* — `signal · apy 4.2% · tvl $61M · audited · live · defillama`
   - **Degraded mode line** *(new)* — amber "degraded signal mode — operating on cache / fallback" when applicable
   - **World + posture** *(new)* — `world · calm — liquidity stable… · posture · neutral`
   - Concentration footer: `envelope concentration on NAVI · 18.3% after this cycle`
   - **Mission alignment** *(new)* — italic one-liner: `low-risk yield captured at 4.2% apy`

5. **Drawers** — four-column grid, collapsed by default
   - **POLICY ENVELOPE** — venues, max position cap, auto-approve threshold, expiry, risk tolerance + a paragraph on Move enforcement
   - **DEPLOYED CAPITAL** — donut + per-venue rows showing percentage + SUI; cap reminder at the bottom
   - **OPERATOR MEMORY** *(new — replaced Performance drawer)* — posture, average confidence, cycles completed, chain rejections, recent venues, hydration status
   - **PRIOR OPERATORS** — **LAST TERMINATION scar** *(new)* (red-50 inset showing the last terminated operator's name, status, cycles, last venue, SUI deployed) + list of all prior policies with status pill ("decommissioned" for revoked) + action counts

6. **GrantNextSection** (only after the head policy ends) — divider + ceremony to grant another

**Floating overlays:**

- `CommandPalette` (⌘K) — context-aware commands: revoke active, view policy on suiscan, view owner on suiscan, grant new (when none active), open landing
- `BootSweep` — 1600 ms ceremony on Grant → Live transition
- `RevokeDarken` — 1000 ms red wash on revoke signature
- `ChainIntervention` *(new)* — 2000 ms freeze when an on-chain Rejection arrives for the current head policy

### 6.3 GrantCeremony — the three-stage flow

[`src/components/operator/GrantCeremony.tsx`](src/components/operator/GrantCeremony.tsx) — replaces what was originally a single form. Stages cross-fade; back buttons preserve config.

**StageCrumb** (top breadcrumb) — three pills (`Mode` → `Envelope` → `Activate`) with a connector line between, current stage outlined in ink, prior stages filled-in with a check icon.

#### Stage 1 — Mode

`ModeStage` — grid of four template cards (`OPERATOR_TEMPLATES` in [`src/lib/operator-policy-client.ts`](src/lib/operator-policy-client.ts)):

| Template | Budget | Venues | Concentration | Expiry | Risk |
|---|---|---|---|---|---|
| Conservative Yield | 50 SUI | DeepBook · NAVI · Suilend | 30% | 24h | low |
| Stablecoin Treasury | 100 SUI | DeepBook · NAVI | 50% | 7d | low |
| AI Market Maker | 30 SUI | DeepBook only | 80% | 12h | medium |
| Low-Risk Growth | 75 SUI | DeepBook · NAVI · Suilend · SpringSui | 40% | 72h | medium |

Each card: lowercase template-id eyebrow → 20px name → blurb → four mono pills (budget, venue count, expiry, risk) at the bottom. Selected card gets an ink border + soft shadow.

#### Stage 2 — Envelope

`EnvelopeStage` — large rounded surface with field rows:

- **name** — text input
- **mission objective** *(new)* — textarea, 2 rows, 240-char limit with counter, placeholder is the default for the chosen template. Subtext: *"The operator's mandate. Surfaces in every decision rationale. Stored off-chain; the envelope above is what the chain enforces."*
- **budget** — range slider 1–500 SUI + tabular-nums readout on the right
- **allowed venues** — multi-select chips (DeepBook · NAVI · Suilend · SpringSui · Bucket); selected = filled ink, others = outlined
- **max single position** — range slider 10–100% in 5% steps
- **expiry** — five chips (1h · 12h · 24h · 72h · 7d)
- **risk tolerance** — three chips (low · medium · high)
- **auto-approve under** — range slider 0–100% in 5% steps

Bottom row: back arrow on the left, ink "Review & activate" button on the right (disabled if no venues or empty name).

#### Stage 3 — Activate

`ActivateStage` — the "are you sure" surface, but written as a constitutional preamble.

- Mono eyebrow `activate`
- Large headline: "Authorize {operator name}."
- Surface card with:
  - Mono eyebrow `mission objective`
  - The objective quoted in italic (visible commitment to what was typed)
  - One paragraph of plain-English summary: *"Conservative Yield Operator will operate on DeepBook, NAVI, and Suilend with a budget of 50 SUI for 24 hours. Max single position 30% of envelope. Actions under 50% of remaining budget execute autonomously; larger actions require your explicit approval. Risk profile low."*
  - ShieldCheck icon + on-chain enforcement reminder paragraph
- Mono philosophy line below: `the AI is not trusted · the policy is`
- Centered "Activate operator" button (changes to spinner + "Signing…" on click)
- Error handling: `WalletSessionFix` panel when Slush wallet's keyring bug surfaces (offers disconnect / reconnect / alternative wallet)

**After sign:** the objective is stashed in `sessionStorage` under `brief:pending-objective` with the policy name + timestamp. AppPage's effect detects the new policy in the next poll tick (≤3 s) and POSTs to `/api/objectives` with the resolved policy id. SessionStorage gets cleared. The agent picks up the objective on attach via `resolveObjective` (env or file).

### 6.4 API — `/api/objectives`

[`src/app/api/objectives/route.ts`](src/app/api/objectives/route.ts) — minimal file-backed key-value store at `.brief/objectives.json`.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/objectives?policy_id=…` | — | `{ policy_id, objective: string \| null }` |
| POST | `/api/objectives` | `{ policy_id, objective }` (objective ≤ 240 chars) | `{ ok: true, policy_id }` |

`.brief/` is git-ignored. On the production VM, this would be on a tmpfs/EBS volume that the operator agent can also read. For the hackathon submission, dev + production share the same machine, so this is fine.

---

## 7. The operator agent runtime

Lives in [`agents/operator/`](agents/operator/). Process startup + per-policy loop.

### 7.1 Process startup

1. Load `.env.local` (package id, agent secret key, RPC url)
2. Make `AgentContext` (SuiClient + ed25519 keypair + addresses)
3. `reattachActivePolicies` — query the last 50 `PolicyCreated` events filtered to this agent address, spawn a loop for each non-revoked, non-expired one
4. Set up `setInterval(POLL_MS=3000)` to watch for new `PolicyCreated` events from a saved cursor (`.cursors/operator.json`)

### 7.2 Per-policy attach (NEW)

When a new policy is detected:

1. **Resolve objective** — env var `BRIEF_OBJECTIVES_JSON` → `.brief/objectives.json` → template-derived default. Store via `setObjective(policyId, …)`.
2. **Hydrate from chain** ([`agents/operator/hydration.ts`](agents/operator/hydration.ts)) — list the agent's owned WorkObjects, filter to ones parented to this policy, sort chronologically, replay each Operator action's `recordAction` and each Rejection's `recordRejection`. Result: a restarted agent picks up where it left off — recent venues, posture, average confidence, total actions, rejected attempts, all reconstructed.
3. Launch the policy loop in its own async function with an AbortController.

### 7.3 The cycle (every 15 s)

For each tick:

1. **Refetch the policy** — terminal short-circuit if revoked/expired/budget-exhausted (forget memory + stop)
2. **Compute market snapshot** ([`agents/operator/signals.ts`](agents/operator/signals.ts) — NEW)
   - Promise.all fan-out: DeFiLlama protocols (1500 ms timeout) + DeepBook pool RPC (1500 ms timeout)
   - 60 s cache on the full snapshot
   - Per-source status: `ok | timeout | error | skipped`
   - Static fallback if a venue gets no signal — explicit `source: "fallback"` tag, never silently fakes
   - Sets `degraded: true` if any source failed
3. **Derive world state** ([`agents/operator/world-state.ts`](agents/operator/world-state.ts) — NEW)
   - Checkpoint lag from Sui RPC (proxy for chain congestion)
   - Yield dispersion across signaled venues (proxy for volatility)
   - Median venue TVL (proxy for liquidity climate)
   - Regime: `calm | elevated | defensive | fragmented | stressed | unknown`
4. **Evaluate venues** ([`agents/operator/evaluator.ts`](agents/operator/evaluator.ts) — rewritten, no more `Math.sin`)
   - For each allowed venue with a signal:
     - Component score = `liquidity*0.35 + yield*0.30 + execution*0.20 + policy_fit*0.15`
     - Recency penalty (just-held = −0.10; rotation-eligible = +0.06)
     - Concentration penalty (would-breach = −0.5; near-cap = −0.18; low = +0.08)
     - Posture bias (defensive favors audited/lending; exploratory favors DeepBook/Bucket; assured rewards execution-strong venues)
   - Confidence = `0.5 + (top − second) * 2.2`, clipped to [0.5, 1.0]
5. **Decide or hold**
   - If top score < `SKIP_THRESHOLD (0.30)` → `recordCycleSkip` (bumps `consecutiveHolds`; 3+ holds flips posture to `exploratory`)
   - Otherwise → generate rationale and proceed
6. **Generate rationale** ([`agents/operator/rationale.ts`](agents/operator/rationale.ts))
   - Five-bank stitched sentence: opener (decisive/edge/close based on margin) + secondary factor (e.g., live APY) + rotation hint + concentration warning + **posture closer** (new)
   - Deterministic xorshift seeded by cycle count so wording varies but is reproducible
7. **Build the PTB** ([`agents/operator/index.ts`](agents/operator/index.ts))
   - `record_spend(policy, amount, venue, clock)` — enforces all asserts atomically
   - If venue is DeepBook AND wallet has ≥ amount + 0.5 SUI free: add `depositIntoManager` + `placeMarketOrder` — mode flips to `"deepbook"`
   - Otherwise mode stays `"simulated"` (same payload shape, no real swap)
   - `work_object::mint("Operator", payload, parents: [policy.id], payment: 0.1 SUI)`
   - Single atomic transaction — any policy abort kills everything
8. **Embed full provenance in the payload** (NEW fields marked)
   ```jsonc
   {
     "operator_policy": "0xabc…",
     "venue": "NAVI",
     "amount_mist": "1000000000",
     "rationale": "NAVI dominates — 4.2% live apy · rotation eligible",
     "score": 0.78,
     "confidence": 0.81,
     "components": { "liquidity": 0.62, "yield": 0.71, "execution": 0.58, "policy": 0.78, ... },   // NEW
     "evaluated": [{ "venue": "NAVI", "score": 0.78 }, ...],
     "market_snapshot": {                                                                          // NEW
       "fetched_at_ms": 1716640000000,
       "degraded": false,
       "source_status": { "defillama": "ok", "deepbook": "ok" },
       "summary": "llama=ok deepbook=ok · 4 venues",
       "signals": { "NAVI": { "raw": { "apy_pct": 4.2, "tvl_usd": 61400000, "audits": 2 },
                              "source": "defillama", "age_ms": 0, ... } }
     },
     "world_state": { "regime": "calm", "caption": "liquidity stable — deployment confidence intact", ... },  // NEW
     "memory_context": { "posture": "neutral", "average_confidence": 0.74,
                         "total_actions": 7, "rejected_attempts": 0, "recent_venues": [...],
                         "hydrated": true, ... },                                                  // NEW
     "objective": "Preserve capital while maintaining low-risk yield exposure",                    // NEW
     "posture": "neutral",                                                                         // NEW
     "mission_alignment": "low-risk yield captured at 4.2% apy",                                   // NEW
     "confidence_regime": "decisive",                                                              // NEW
     "fill": { "pool": "NAVI/SUI", "side_in": "SUI", "side_out": "yield-position", ... },
     "mode": "simulated",
     "spent_after": "...",
     "executed_at_ms": ...
   }
   ```
9. **Handle aborts** — on Move abort, parse the code (`detectAbortReason`), mint a Rejection WorkObject (which uses plain `work_object::mint` — does NOT touch the revoked policy, so this succeeds). Revoke/expired are terminal — stop the loop after the Rejection lands. Budget/venue aborts let the next cycle re-evaluate.
10. **Sleep variable cadence** — `computeCycleSleep(memory)` returns `0.8 * CYCLE_MS` (low confidence) to `1.3 * CYCLE_MS` (high confidence). Min 8 s. Makes the rhythm feel less mechanical.

### 7.4 The deliberate non-pre-check

The agent **never** checks `policy.revoked` before submitting. The whole point of on-chain enforcement is that the chain — not the server — blocks the agent. So we submit; if revoked, `record_spend` aborts on-chain; we catch the abort and mint the Rejection. The failed TX is itself the audit evidence. **This is the drama beat.**

---

## 8. Motion + ceremony system

### 8.1 Continuous (always on, live state only)

| Animation | Where | Duration | Effect |
|---|---|---|---|
| `operator-pulse-line` | OperatorCard top accent line | 2.8 s loop | slow opacity pulse 0.85 ↔ 0.35 |
| `operator-scan` | OperatorCard body diagonal | 7 s loop | low-contrast green sweep across the card |
| `animate-ping` | PulseDot halo | 1 s loop | concentric ring fade-out |

### 8.2 Event-triggered (one-shot)

| Animation | Trigger | Duration | Effect |
|---|---|---|---|
| `operator-ripple` | new Operator action lands | 720 ms | green ring fades outward from card edges (sibling overlay, no clipping) |
| `rejection-flash` | new Rejection row mounts | 880 ms | red halo emphasis flash |
| `value-tick` | remaining SUI decrements | 600 ms | one-shot green flash on the number |
| `boot-stagger-1..5` | OperatorCard first mount | 380–1180 ms staggered | element-by-element fade-in |
| `land-in` | new activity row | 420 ms | fade-up with slight overshoot |
| `ended-desat` | tone live → terminal | 800 ms | saturate(1) → saturate(0.6) |

### 8.3 Ceremonies (page-level overlays)

| Ceremony | Trigger | Duration | Effect |
|---|---|---|---|
| `BootSweep` | Grant → Live transition | 1600 ms | dim veil + 1100 ms scanner sweep (250 ms delay) |
| `RevokeDarken` | user signs revoke | 1000 ms | radial red wash fade-in/out |
| **`ChainIntervention`** *(new)* | on-chain Rejection lands for current policy | 2000 ms | ambient red veil + top halo line + `data-chain-intervention="1"` pauses heartbeat/scan/ripple/pulse-glow/ping |

### 8.4 RevokePendingBanner — tension escalation

Shown only between the moment `policy.revoked` flips on-chain and the moment the Rejection mints. Visual state interpolates with `intensity = clamp(0, 1, (15 − untilSec) / 15)`:

- bg alpha 0.55 → 0.92
- border alpha 0.45 → 0.95
- shadow blur 0 → 22 px
- scanner cycle 1700 → 520 ms
- scanner alpha 0.45 → 0.85
- under 5 s: "Imminent." copy + larger countdown (text-[20px]) + animate-pulse on icon + label

---

## 9. Operator State Language

[`src/lib/operator-language.ts`](src/lib/operator-language.ts) — every visible string in the operator console derives from this file. Constitutional vocabulary, not SaaS / DeFi.

### 9.1 State labels

| State | Label |
|---|---|
| online | `OPERATOR ENGAGED` |
| scanning | `SCANNING` |
| deploying | `DEPLOYING` |
| blocked | `BLOCKED BY POLICY` |
| revoked | `REVOKED` |
| expired | `EXPIRED` |
| exhausted | `BUDGET EXHAUSTED` |
| awaiting | `AWAITING APPROVAL` |

### 9.2 Section headers

`TELEMETRY` (activity stream) · `OPERATOR` (card eyebrow) · `POLICY ENVELOPE` (constraints) · `DEPLOYED CAPITAL` (allocation) · **`OPERATOR MEMORY`** *(new)* · `PRIOR OPERATORS` (history) · `DECISION TRACE` (per-action drilldown)

### 9.3 Action labels

`DEPLOYED` · `CHAIN ABORTED` · `MANDATE GRANTED` · `OPERATOR STOOD DOWN` · `SCANNING VENUES` · `DEPLOYING`

### 9.4 Outcome vocabulary (used in copy, badges, ARIA)

`accepted on-chain` · `policy enforced on-chain` · `rejected by policy` · `aborted on-chain` · **`authority revoked`** · **`policy intervention`** · **`chain aborted`** · **`operator stood down`** · **`mandate terminated`** · `kill switch`

Explicitly avoided: `error`, `failed`, `denied`, `crashed`, `cancelled`.

### 9.5 Rejection reasons (REJECTION_REASON map)

| Code | Short | Long |
|---|---|---|
| `revoked` | `authority revoked` | Mandate revoked by owner — the agent's attempted spend was aborted on-chain. |
| `expired` | `expiry reached` | Policy expiry reached — the agent's attempted spend was aborted on-chain. |
| `budget_exceeded` | `envelope exhausted` | Budget envelope full — over-spend aborted on-chain. |
| `venue_not_allowed` | `venue outside envelope` | Venue is not in the policy allowlist — trade aborted on-chain. |
| `not_agent` | `signer outside mandate` | Only the bound agent address can spend against this policy. |
| `unknown_policy_abort` | `policy intervention` | Policy enforcement aborted the transaction on-chain. |

---

## 10. What's real / heuristic / simulated / not-yet-wired

### Real (chain-verified, anyone can audit on suiscan)

- The `OperatorPolicy` Move object — owner, agent, name, budget cap, spent, allowed venues, max concentration, expiry, auto-approve, risk, revoked flag, created-at. Published v2 at `0xb04764…d1c0`.
- `assert_can_spend` running in every `record_spend` PTB. 9/9 abort tests pass; abort codes match the chain's documented codes 2–6.
- `revoke` flipping `revoked = true` and emitting `PolicyRevoked`. Verifiable.
- Every `Operator` WorkObject — owned by the user, parented to the policy, including the full decision payload (rationale, score, confidence, components, evaluated alternatives, market_snapshot, world_state, memory_context, objective).
- Every `Rejection` WorkObject — minted after a `record_spend` abort, includes the Move abort error string + reason code.
- **Live DeFiLlama** integration — TVL, APY, audit counts, age fetched via [`agents/lib/protocol-data.ts`](agents/lib/protocol-data.ts) (real HTTP). 5-min cache.
- DeepBook v3 testnet pool RPC reads for the SUI/DBUSDC pool (best-effort; defensive when RPC drifts).
- **DeepBook market orders** — when the agent wallet has ≥ 1.5 SUI free, the PTB includes `depositIntoManager` + `placeMarketOrder` on the SUI/DBUSDC pool. Mode label flips to `deepbook` and balance changes appear in the tx digest.
- **Memory hydration from chain** — restarted agent walks past WorkObjects to rebuild memory; verifiable by inspecting the operator log on restart.

### Heuristic (defensible logic, not arbitrary)

- The component-weighting model (`liquidity 0.35 + yield 0.30 + execution 0.20 + policy 0.15`) — chosen so liquidity dominates yield (avoids chasing thin pools) but yield still matters.
- The static fallback signals (`source: "fallback"`) used when no source returned data — deterministic per-venue offsets in the 0.40–0.55 band so the evaluator's other factors dominate. Honest about being fallback in the payload.
- The recency / concentration penalties — encourages rotation, blocks cap breaches.
- The posture derivation rules (`consecutiveRejections ≥ 2 → defensive`, etc.) — explainable, deterministic.
- World-state regime thresholds (yield_dispersion > 12 → elevated, etc.) — coarse but auditable.
- The expected-yield-bps projection on the action payload (uses real APY as a base, caps at 700 bps) — labeled honestly as "projected" in UI.

### Simulated (transparently labeled)

- The "simulated" trade mode when the agent wallet has < 1.5 SUI free. The PTB still calls `record_spend` (real enforcement) and mints the Operator WO (real audit trail), but no DeepBook order is added. The action card shows `mode · simulated`.
- The fill price + amount_out for non-DeepBook venues (NAVI, Suilend, etc.) — projected from the live APY signal. Not a financial claim.

### Not yet wired (honest gaps)

- **Walrus storage** — the operator's `executeAction` does NOT currently upload to Walrus. Payloads are stored inline in the WorkObject. The landing page no longer claims Walrus integration. Roadmap: ~90-min wire to upload rationale + market_snapshot + memory_context as a Walrus blob, store only the blob id on-chain. Would unlock the Walrus special prize.
- **Proposal / Approval loop** — `auto_approve_pct` exists on the policy but the agent does not currently mint Proposal WorkObjects above the threshold; all in-budget actions auto-execute. Roadmap: above-threshold actions mint a `Proposal`, wait for an `Approval` WorkObject from the owner, then execute.
- **Multi-agent fleets** — one agent address binds to one or more policies; cross-policy reasoning doesn't exist. Each policy loop is independent.
- **Mainnet** — testnet only. Mainnet deploy is post-submission.

---

## 11. The 90-second demo arc

Voice-over verbatim is in [`DEMO.md`](DEMO.md). Visual choreography:

| Time | Beat | Visual |
|---|---|---|
| 0:00–0:08 | Landing | Cursor on "Try Brief" CTA; the StatusPill pulses green |
| 0:08–0:20 | Connect + Mode | Wallet connects via Slush; the GrantCeremony breadcrumb appears; user picks "Conservative Yield" |
| 0:20–0:35 | Envelope | Sliders + chips + **mission objective typed in the textarea**; "Review & activate" |
| 0:35–0:42 | Activate | Plain-English summary surface with the objective quoted; one-signature Slush popup |
| 0:42–0:46 | **Boot ceremony** | `BootSweep` plays — 1600 ms dim veil + scanner sweep; OperatorCard materializes via boot-stagger |
| 0:46–1:00 | First cycle | Within 15 s the first Operator action lands — green ripple ring fires; ActivityStream row materializes with `land-in`; row expands to show DecisionTrace with component bars + live APY provenance + world-state `calm` + posture `neutral` + mission alignment line |
| 1:00–1:08 | Header trust check | Cursor moves to the header — the WORLD STATE pill is visible; remaining SUI ticks down |
| 1:08–1:15 | **Revoke** | Cursor clicks Revoke → modal opens → "Revoke now" → Slush signs → `RevokeDarken` plays (red radial wash) → `RevokePendingBanner` appears with `~15s` countdown |
| 1:15–1:25 | **Tension** | Countdown crosses 5s → "Imminent." copy, scanner accelerates from 1.7 s to 520 ms, banner deepens red |
| 1:25–1:28 | **Chain intervention** | Agent's next PTB hits chain → `assert_can_spend` aborts with `EPolicyRevoked` → Rejection WorkObject mints → `ChainIntervention` plays for 2 s: ambient red veil, heartbeats/scan-lines freeze, halo line settles at top → OperatorCard desaturates → header state flips to `REVOKED` |
| 1:28–1:30 | Audit beat | Rejection row expanded, Policy Breach Lifecycle visible (5 numbered beats from "operator prepared" to "operator stood down"), Move abort code 3 cited, suiscan link to the failed TX |

**The killer beat:** the user's `Revoke` signature lands → 15 s of tension → the *chain itself* aborts the operator → the UI freezes in deference → the audit row materializes.

Judges don't remember features. They remember the moment.

---

## 12. Sub-track alignment (must-haves matrix)

| Requirement | Where Brief satisfies it |
|---|---|
| **#2 — Chain-enforced policy capability** | `OperatorPolicy` Move shared object; `assert_can_spend` runs in every PTB |
| **#2 — Revocation that blocks the agent** | `revoke` flips `revoked = true`; next `record_spend` aborts with `EPolicyRevoked`; visible Rejection WO + Chain Intervention ceremony |
| **#2 — Bounded budget / venues / concentration** | `budget_cap`, `allowed_venues`, `max_concentration_bps` — all asserts on-chain |
| **#2 — Real DEX integration (DeepBook special)** | `place_market_order` on SUI/DBUSDC in the same PTB as `record_spend` when wallet funded; auto-fallback to simulated below |
| **#3 — Text → PTB → execution** | GrantCeremony's constraint editor IS the human-readable PTB preview; grant signature is the mint |
| **#3 — Human-readable preview** | ActivateStage shows plain-English summary including the mission objective + every policy constraint before signing |
| **#3 — Guardian catching ≥ 2 risk classes** | Budget cap + concentration cap + expiry + venue allowlist + agent identity — all chain-enforced asserts (5 risk classes, not 2) |
| **#3 — Explicit confirmation step** | Policy grant IS the explicit confirmation (full envelope visible before signing) |

---

## 13. Tech stack

- **Frontend** — Next.js 14 (App Router), Tailwind, TypeScript, JetBrains Mono + Inter, CSS-only motion (no Framer Motion)
- **Wallet** — `@mysten/dapp-kit@1.0.6` (`WalletProvider` + `ConnectButton` + `useSignAndExecuteTransaction`)
- **Sui SDK** — `@mysten/sui@2.17` (`@mysten/sui/transactions`, `@mysten/sui/jsonRpc`, `@mysten/sui/keypairs/ed25519`)
- **DeepBook** — `@mysten/deepbook-v3@1.3.6` (testnet pool keys + balance manager)
- **Move** — `2024.beta` edition, single `operator_policy.move` module + `work_object.move` + lineage/agent_registry/settlement helpers
- **Agent runtime** — Node + tsx, `--env-file=.env.local`
- **Market data** — DeFiLlama REST (`/protocols`, `/pools`) with 5-min cache; DeepBook v3 testnet pool object via Sui RPC
- **State (off-chain)** — `.brief/objectives.json` file for mission objectives; `.cursors/operator.json` for event cursor persistence
- **LLM** — none used in the operator runtime. All decisions are deterministic. (Research/Strategy agents in the broader repo have an LLM hook but are not in the operator demo path.)
- **Process supervision** — `concurrently` for dev (`npm run agents:all`); pm2 for production

---

## 14. Repo layout

```
brief/
├── PRODUCT_STATE.md           ← this file
├── DEMO.md                    ← 90s demo script
├── SUBMISSION.md              ← Sui Overflow 2026 submission writeup
├── PIVOT.md                   ← record of the 2026-05-23 operator pivot
├── README.md                  ← getting started
├── .brief/                    ← gitignored — off-chain mission objectives
│   └── objectives.json
├── .env.local                 ← gitignored — RPC, keys, package ids, BRIEF_OPERATOR_CYCLE_MS
├── move/
│   ├── Move.toml              ← published-at + brief = (v2 0xb04764…d1c0)
│   ├── sources/
│   │   ├── operator_policy.move    ← THE module (9/9 tests pass)
│   │   ├── work_object.move        ← typed audit-log object + mint
│   │   ├── agent_registry.move
│   │   ├── settlement.move
│   │   └── lineage.move
│   └── tests/
│       └── operator_policy_tests.move
├── agents/
│   ├── lib/
│   │   ├── sui.ts, env.ts, operator-policy.ts, work-object.ts, protocol-data.ts,
│   │   ├── walrus.ts, llm.ts, mock.ts, cursor.ts, event-poll.ts
│   ├── operator/                   ← THE operator
│   │   ├── index.ts                ← main loop
│   │   ├── signals.ts              ← live market signal pipeline (NEW)
│   │   ├── world-state.ts          ← regime derivation (NEW)
│   │   ├── evaluator.ts            ← scoring (NEW — no more Math.sin)
│   │   ├── rationale.ts            ← deterministic rationale gen with posture
│   │   ├── memory.ts               ← per-policy state + posture
│   │   ├── hydration.ts            ← rebuild memory from chain (NEW)
│   │   └── objectives.ts           ← objective resolver (NEW)
│   ├── research/, strategy/, strategy-alt/, execution/   ← legacy (not in operator demo path)
├── scripts/
│   ├── operator-cli.ts             ← grant / revoke from CLI for testing
│   ├── probe-deepbook*.ts          ← BalanceManager + market order probes
│   ├── probe-walrus.ts             ← Walrus aggregator upload smoke
│   └── (other probes for diagnostics)
└── src/
    ├── app/
    │   ├── page.tsx                ← landing
    │   ├── app/page.tsx            ← operator console (state machine)
    │   ├── api/objectives/route.ts ← off-chain mandate store (NEW)
    │   ├── layout.tsx              ← font + dApp Kit providers
    │   └── globals.css             ← reduced-motion + chain-intervention freeze rule
    ├── components/
    │   ├── sui-provider.tsx        ← WalletProvider + SuiClientProvider
    │   └── operator/
    │       ├── OperatorCard.tsx    ← L1 hero (with MissionLine + WorldStateBadge)
    │       ├── ActivityStream.tsx  ← TELEMETRY (with DecisionTrace + PolicyBreachSequence)
    │       ├── RevokePendingBanner.tsx
    │       ├── PersistentHeader.tsx ← sticky chrome (with WorldRegimePill)
    │       ├── Drawers.tsx         ← 4-card grid (with MemoryDrawer + LastTermination scar)
    │       ├── GrantCeremony.tsx   ← 3-stage flow (with mission objective field)
    │       ├── CommandPalette.tsx  ← ⌘K
    │       ├── CeremonyOverlays.tsx ← BootSweep + RevokeDarken + ChainIntervention (NEW)
    │       └── PulseDot.tsx
    └── lib/
        ├── brief-client.ts         ← BRIEF_PACKAGE_ID + useOwnedWorkObjects
        ├── operator-policy-client.ts ← tx builders + useOperatorPolicies + templates
        ├── operator-state.ts       ← OperatorState derivation + labels
        ├── operator-language.ts    ← single source of vocabulary
        ├── market-state.ts         ← signal types + provenance formatter (NEW)
        ├── objectives-client.ts    ← useObjective hook (NEW)
        └── work-object.ts          ← decode + mint helpers
```

(Note: `/src/app/lineage/` was removed in cleanup — it was a legacy yield-finder surface not linked from the operator demo.)

---

## 15. What works today (verified 2026-05-25)

- `npm run build` — clean. `/` 138 B + 87.3 kB shared; `/app` 29 kB + 252 kB; `/api/objectives` dynamic.
- `npm run typecheck` — clean.
- `npm run typecheck:agents` — clean.
- `npm run move:test` — 9/9 pass.
- `npm run dev` — ready in <2 s.
- `npm run agent:operator` — boots, watches PolicyCreated events, attaches policy loops, runs 15-s cycles.
- Grant → Live → first action lands ≤ 15 s after grant.
- Revoke → Chain Intervention ceremony plays → Rejection WO lands → operator stood down.
- Mission objective POST + GET round-trips through `/api/objectives`.
- Memory hydration on restart — verified by killing the operator process mid-session and restarting; the next cycle's payload shows `memory_context.hydrated: true` with continuous totals.
- DecisionTrace renders component bars + provenance line + world state + posture + mission alignment for every Operator action with the new payload schema.
- Old actions (pre-upgrade) render cleanly — all new fields are optional.
- Last Termination scar appears in History drawer when there's a terminated past policy.

---

## 16. Pending / known gaps

1. **Wallet top-up to ≥ 5 SUI** — current agent wallet has minimal balance; DeepBook mode hasn't auto-fired in recent cycles. Top up at https://faucet.testnet.sui.io/v1/gas and the next cycle flips mode to `deepbook` automatically.
2. **Walrus integration** — ~90 min of wire for the special prize. Operator's `executeAction` would upload `{ rationale, market_snapshot, memory_context }` to Walrus and store only the blob id on the WorkObject. Frontend already has `fetchWalrusPayload`. Wired but not used by the operator path.
3. **Proposal loop above auto-approve threshold** — currently all in-budget actions execute. Roadmap: mint Proposal WO above threshold, wait for owner Approval WO before execution.
4. **DeepBook depth/spread parsing** — `fetchDeepBookDepth` reads the pool object but doesn't extract level-2 ladder (Sui RPC shape evolves). Returns only `pool_id` for now; spread/depth fields stay null. Not blocking — DeFiLlama provides the dominant signal.
5. **Connect button styling** — dApp Kit's `ConnectButton` accepts limited className overrides; the rounded-full + height tweaks land but the dropdown menu inherits dApp Kit defaults. Acceptable for demo.
6. **Restart hydration latency** — `hydrateMemoryFromChain` runs async on attach. The first cycle after restart may evaluate with empty memory. Cosmetic only; subsequent cycles use full hydrated state.

---

## 17. Open questions for advisors

1. **Pursue Walrus prize, or stay focused on the Agentic Web spend?** Walrus is ~90 min for the wire but adds zero to the constitutional-finance narrative. Current call: ship without Walrus, frame it as roadmap.
2. **Lean harder on the "constitutional finance" framing, or keep it implicit?** The manifesto + the chain-intervention ceremony already convey it. We could add a marketing line on the landing ("policy-enforced operators · separation of powers between human, AI, and chain") but it might over-explain.
3. **Add a Proposal/Approval loop before submission?** Strong signal for sub-track #2 but each loop reduces demo focus on the autonomy story. Current call: skip, mention in submission writeup as roadmap.
4. **Operator wallet funding strategy?** Hackathon-time top-ups vs. deposit ≥ 50 SUI now so DeepBook always fires. Current call: top up to 10 SUI before the demo recording.
5. **One operator on screen during demo, or two?** Showing two parallel operators (e.g., Conservative Yield + AI Market Maker) demonstrates fleet behavior. But the 90-s budget really only fits one cycle from one operator. Current call: one operator, mention "policy per agent" in narration.

---

## 18. TL;DR

**Brief** is a policy-enforced autonomous wallet for AI agents on Sui. The owner grants a budget envelope and a mission charter; the agent operates inside the envelope autonomously; the chain enforces every constraint; revocation visibly interrupts the autonomy in real time.

| Bucket | What's in it |
|---|---|
| **Real** | OperatorPolicy + all asserts + revoke + Operator/Rejection WOs + DeFiLlama signals + DeepBook orders when funded + memory hydration |
| **Heuristic** | Scoring weights, fallback signal values, world-state thresholds, posture rules, expected-yield projection |
| **Simulated** | Trade execution when wallet < 1.5 SUI (labeled `mode: simulated`); fill price for non-DeepBook venues |
| **Not yet wired** | Walrus offload, Proposal/Approval loop, multi-agent fleets, mainnet |

**Target:** Sui Overflow 2026, Agentic Web track, sub-tracks #2 + #3 merged, DeepBook special prize. Submit by 2026-06-21.

**Slogan worth defending in front of judges:** *"The AI is not trusted. The policy is."*
