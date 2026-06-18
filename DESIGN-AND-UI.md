# Brief — Design & UI (current state)

An honest, current map of how Brief *looks and feels*: the design language, every
page's layout (where each component sits, what the user actually sees), what's
genuinely excellent, what's clunky, and exactly what we're built on. Written to be
read + brainstormed against. Reflects the deployed UI on `https://usebrief.xyz`.

---

## 0. The short answers (the questions you asked)

- **Landing page?** A **hand-coded `<canvas>` animation** (the "Leash": a gold
  operator dot tethered inside a boundary, breathing/orbiting), *not* a video and
  *not* a particle library — plus a **live data pipeline** ("the Mind") that lights
  up Observe→Thesis→Risk→Decision→Chain from real agent events. Light, editorial,
  single-column.
- **Dashboard layout?** **Single column, centered (`max-w-3xl`), vertically
  stacked card sections** — a dominant "Status Surface" hero on top, then Withdraw,
  Performance, Custody chain, then collapsibles (Ledger / How it thinks / Live
  activity / Policy & proof). A slim top bar with nav + the revoke control; a
  floating kill-switch bottom-right. **No side nav.**
- **Component library?** **None — fully custom.** Tailwind CSS v3 for styling,
  `lucide-react` for icons, `@mysten/dapp-kit` for the wallet connect button only.
  No shadcn, no Radix, no Headless UI, no Framer Motion. All components hand-built;
  all animation is custom CSS `@keyframes` (+ the one canvas).
- **Proud of?** The **Operator Status Surface** (the billboard hero), the **Proof
  page** (courtroom of clickable on-chain artifacts), the **Leash canvas**, the
  **custody-chain visual**, and the **Brain's cinematic decision replay**. See §3.
- **Clunky / under-designed?** Dashboard **density + length**; the live "waterfall"
  is muted in prod (SSE → 15s polling behind Caddy); thin **loading/empty states**;
  **mobile** is "OK, not tuned"; the **new AI/Guardian surfaces are minimal**; some
  **component drift**. See §4.

---

## 1. The design language

**Editorial / Swiss-minimal — "constitutional finance," not a generic dapp.**
The whole aesthetic is built to feel *serious, calm, and trustworthy* (it's
managing real money), and to make one idea legible in two seconds.

- **Type:** **Inter** (sans, display + body) + **JetBrains Mono** (labels, numbers,
  tx hashes). Inter stylistic sets are on (`cv02 cv11 ss01`) for a refined look.
  The signature move: **monospace, uppercase, wide-tracked labels**
  (`tracking-[0.22em]`) over large Inter display headlines. Numbers are
  `tabular-nums` everywhere.
- **Color:** light theme — `--bg #FAFAFA`, cards `#FFFFFF`. A single **semantic
  palette** (`src/lib/ui.ts`, mirrored in Tailwind): INK `#0A0A0A`, SUB `#525560`,
  MUTED, LINE `#E5E5EA`; brand **NAVY `#1a2c4e`** + Sui **blue `#4DA2FF`**; and the
  operator's language — **SUCCESS/emerald `#10B981`** (act/win/protected),
  **DANGER/red `#EF4444`** (abort/loss/revoke), **CAUTION/amber `#F59E0B`**
  (preserve/drawdown). Color is used *sparingly and meaningfully* — most of the UI
  is ink-on-off-white with thin `#E5E5EA` rules; green/red/amber only carry state.
- **Lines, not shadows:** borders (`1px`/`2px` `#E5E5EA`) define structure;
  shadows are barely-there (`0 1px 3px rgba(0,0,0,.04)`). No gradients, no glass, no
  neon. Generous whitespace.
- **Motion:** custom CSS `@keyframes` (`v2FadeUp`, `operatorBreathe`, `operatorHalo`,
  `operator-pulse-line`, `operator-ripple`, `bootSettle`, …) — restrained, purposeful
  (a pulse line on a live operator, a ripple when the chain debits the leash). A neat
  detail: a global `data-chain-intervention="1"` flag **freezes the ambient
  animations** at the revoke moment, so the kill reads as a hard stop.

**One-line identity:** confident editorial typography + a single semantic palette +
hairline structure + one hero canvas. Distinctive without a component library.

---

## 2. Page by page (layout + what's there)

### `/` — Landing (`OperatorLandingV2`)
Single column, centered. Top → bottom:
1. **Header** — `Brief` wordmark + a system-health dot + minimal nav.
2. **The Leash canvas** (`LeashHero`) — the hero animation: a gold operator dot
   orbiting inside a drawn boundary (the leash). Hand-drawn on `<canvas>`.
3. **H1 thesis** (large Inter) + subline.
4. **Live proof-stat row** — 5 mono stats (`N operators live · N decisions ·
   $N managed · 0 policy violations · 0 custody incidents`), real from
   `/api/network/proof`.
5. **The Mind** — a 5-step live pipeline (Observing → Thesis → Risk → Decision →
   Chain) that lights from the global SSE wire as a real operator thinks; includes
   a tiny price sparkline.
6. Explanatory sections (the model, the leash) + CTA into `/workforce`.

*Feel:* calm, premium, "this is infrastructure." The canvas + live pipeline make it
feel alive, not a static splash.

### `/workforce` — Fleet / adopt entry
- **Header:** `Brief · WORKFORCE`, nav (Brain/Evolution/Results/Proof when relevant),
  a **leaderboard** link, and the **wallet chip** (`0xCA3D… · N SUI`).
- **Connected with operators → `OperatorsHome`:** an editorial header ("Your
  operators.") + a **2-column grid of operator cards** (`OperatorHomeCard`: codename,
  mode, live stat), then a **"Future operators"** row of low-opacity **ghost cards**
  (Atlas/Sentinel "coming soon") signaling the platform vision.
- **Connected, none → `FirstOperatorEntry`:** the adopt hero with the **3 mode
  cards** (Protect ◈ / Grow ◇ / Aggressive ◆) + a single "Adopt an operator →" CTA.
- **Disconnected:** connect prompt + the same mode grid.

### `/workforce/adopt` — Adoption wizard
Single column, progressive sections revealed as you go, each with a **numbered mono
SectionLabel** ("01 · …"): connect → **choose a mode** (cards) → **fund + set the
leash** (a big `40px` tabular number for the amount + presets + the capital-vs-
turnover-allowance sub-line) → optional **mandate** → **the one signature** (a single
dark CTA that runs the whole atomic adopt tx, with a step-by-step "doing/done"
progress list). Ends in a **boot ceremony** → the dashboard.

### `/workforce?policy=<id>` — Operator dashboard  ← the most important screen
**Single column, `max-w-3xl`, stacked sections** (no side nav):
1. **TopBar** — operator name + glyph, a state dot (act/preserve/idle/grounded),
   nav links, and the **"yank the leash" Revoke** affordance.
2. **OperatorHero — the Operator Status Surface** (the dominant element): a 2px-bordered
   card with the identity + `OBSERVING`/`LIVE · {when}` pill; **the billboard** —
   the operator's current thinking as the *largest text on the page* ("No clear
   edge. Holding 48% in DEEP."); a new **Risk Guardian row** ("monitoring" /
   "paused — reason"); **capital marked-to-market** + a **multi-asset allocation
   bar** (SUI/WAL/DEEP/cash segments); and a **vitals grid** (Last decision ·
   Confidence · Mandate · Allowance left).
3. **WithdrawFunds** card — owner-only, chain-resolved, one signature.
4. **OperatorPerformance** card — a big `% since launch`, a 3-cell benchmark
   (Operator / Hold SUI / Cash) + "vs holding," and a vitals grid (Observations ·
   Allocations · Abstentions · Worst drawdown · Mandate · Policy violations: 0).
5. **ProtectedBySui** — the **custody-chain visual**: Your wallet → BalanceManager
   (✗ operator cannot withdraw) → TradeCap (✓ trade only, ✗ never withdraw) →
   Operator (✗ cannot exceed budget) → DeepBook (✓ verifiable on Sui).
6. **Collapsibles** — Operator ledger · How it thinks (playbooks) · Live activity
   (the SSE beat) · Policy & proof.
7. **FloatingKillSwitch** — a persistent bottom-right "Operator active · Revoke →".

### `/brain?policy=<id>` — Operator Brain
Single column, **cinematic**. Header + counters (Decisions · Capital preserved), an
**older/newer carousel of ONE decision at a time** rendered as **5 big blocks**
(`BigBlock`, very large type): *What it saw* (regime + asset-labelled price), *What
it remembered* (recall), *What it feared* (counterargument), *What it did* (Held /
Added, + confidence), *What happened* (outcome + tx). New: an **"AI · model" badge**
+ **"AI reasoning on Walrus"** link on LLM-shaped decisions. A dot pager + a
"Narrate this decision" button (on-demand LLM prose).

### `/evolution?policy=<id>` — Operator Evolution
Single column. Header + 2 stat cards (Lessons learned · Regimes understood), a
**"Most valuable lesson"** card, and **"The path"** — a vertical timeline (colored
dots + dated entries) of how the operator grew, all from settled outcomes.

### `/results?policy=<id>` — Results ("Did it work?")
Single column, `max-w-2xl`, outcome-first. Name + objective + status, a one-line
**verdict** headline, the **"what if you'd done nothing?"** trio (3 big numbers:
The operator / Held SUI / Did nothing), a 6-cell **record grid** (drawdown ·
preserved · decisions · trades executed · avoided · 0 violations), a Protected-by-Sui
strip, an Operator-status + roadmap block, and a **Big moments** list.

### `/proof?policy=<id>` — Proof ("Verify everything. Trust nothing")  ← the closer
Single column. Header + the operator id, then **5 numbered courtroom cards** (01–05),
each with a **colored left border** and a live, clickable on-chain/Walrus artifact:
the Move leash (authorized vs used bar) · every authorized trade (`PolicySpend`
list) · the `EBudgetExceeded` revert · the revoke + `EPolicyRevoked` abort · the
Walrus manifesto. Every value read live; "nothing here is rendered from our DB."

### `/leaderboard` — Operators as a network
Header + editorial intro, then **ranked rows**: codename + name, trade count, asset
chips, a P&L **sparkline**, and badges ("House" / "You"). Network framing
("one today, a workforce tomorrow").

---

## 3. Components I think are genuinely excellent

1. **The Operator Status Surface (dashboard hero).** Making the operator's *current
   thinking* the biggest thing on the page — "an AI is managing my money and here's
   what it's doing right now" in two seconds. This is the soul of the product.
2. **The Proof page.** Conceptually + visually strong: every claim is a clickable
   on-chain artifact, the `EBudgetExceeded` / `EPolicyRevoked` reverts are the
   killer exhibits. Few projects show "the chain said no."
3. **The Leash canvas.** The thesis as motion, hand-drawn, no library — distinctive
   and on-message.
4. **The custody-chain visual** (ProtectedBySui). The ✓/✗ capability tags down the
   chain make non-custody instantly legible.
5. **The Brain's cinematic 5-block replay.** Reasoning as a story, not logs — large
   type, one decision at a time.
6. **The typographic system.** Inter + wide-tracked mono labels + tabular numbers
   = a confident, editorial identity with zero component library.
7. **Honest-by-construction details** — abstention shown as discipline, "capital
   returned in full" on withdrawal, 0 violations as a first-class stat.

---

## 4. What feels clunky / under-designed (honest)

1. **Dashboard density + length.** It's a long single column; the most valuable
   evidence (ledger, reasoning, proof) is in **collapsibles at the bottom** that are
   easy to miss. Could use a tighter information hierarchy or a 2-column layout on
   wide screens.
2. **The live "waterfall" is muted in prod.** The SSE stream doesn't pass through
   the VM's Caddy proxy, so the dashboard falls back to **15s polling** — the
   real-time "watch it think" animation is the weakest where it should be strongest.
   (Functionally fine; visually a missed wow.)
3. **Loading / empty states are thin.** The fresh-operator "—" while capital
   resolves, and "first decision lands shortly," are functional but plain — no
   skeletons/shimmer; the first impression of a brand-new operator is a little bare.
4. **Mobile is "OK, not tuned."** Vitals grids (`grid-cols-2/4`), the landing
   pipeline, and leaderboard rows reflow but aren't deeply optimized for small
   screens; some mono labels get tight.
5. **The new AI + Risk Guardian surfaces are minimal.** The AI badge is a small
   pill and the Guardian is a one-line text row — the **multi-agent + LLM story is
   under-celebrated visually** relative to how important it is to the pitch.
6. **Component drift.** With no library, similar patterns (HeroStat grids, BigBlock,
   benchmark cells) are re-implemented per page; a shared primitive layer is only
   partial, so spacing/scale vary slightly across pages.
7. **"Future operators" ghost cards.** Aspirational placeholders (Atlas/Sentinel
   "coming soon") read as vision to some, as padding to others — a judgment call.
8. **Restrained to a fault in places.** The discipline is great, but Brief's brand
   signature beyond the leash canvas is subtle; a touch more distinct visual
   identity (a motif, a consistent "evidence" treatment) could make it memorable.
9. **No dark mode** (light only) — fine, but worth noting.

---

## 5. What we're built on (the stack, explicitly)

- **Framework:** Next.js 14 (App Router), React, TypeScript.
- **Styling:** **Tailwind CSS v3.4** (utility classes) + a **custom semantic
  palette** in `src/lib/ui.ts` (for the many inline `style={{color}}` dynamic cases)
  mirrored in `tailwind.config.ts` — "one palette, no drift." Global tokens +
  `@keyframes` in `src/app/globals.css`.
- **Icons:** `lucide-react` (only).
- **Wallet UI:** `@mysten/dapp-kit` `ConnectButton` (the one third-party UI piece).
- **Animation:** hand-written CSS `@keyframes` + one `<canvas>` (the Leash). **No
  Framer Motion.**
- **Component library:** **none** — no shadcn, Radix, Headless UI, MUI, Chakra.
  Every card, pill, grid, collapsible, modal, and the kill-switch is hand-built.
  - *Why it's good:* distinctive look, zero bloat, full control, fast loads.
  - *Cost:* we hand-roll accessibility/primitives (focus traps, popovers, dialogs);
    more maintenance; the pattern drift in §4.6.

---

## 6. Highest-leverage design moves (if we polish before submission)

1. **Make the AI + Guardian visible** — give the LLM influence and the second agent
   real visual weight on the dashboard (a compact "two agents + the chain" strip),
   since that's the differentiator the demo must show.
2. **Tighten the dashboard hierarchy** — surface (or auto-expand) the ledger/proof
   evidence; consider a 2-column layout ≥`lg`.
3. **Loading/empty polish** — light skeletons + a warmer first-operator state.
4. **One reusable primitive pass** — unify HeroStat/BigBlock/benchmark cells to kill
   drift and tighten rhythm.
5. **Demo-screen pass** — whatever the video frames (adopt → AI decision → Guardian →
   revoke → Proof) should be the most polished pixels in the app.

*Companion docs: `BRIEF-TECHNICAL-PAPER.md` (full technical reference),
`HOW-THE-OPERATOR-WORKS.md` (plain-English mechanics). This file is the design/UI
reference.*
