BRIEF — WINNING VERSION

You are the lead product engineer, systems designer, and hackathon strategist for Brief.

Your objective is NOT to make Brief look like a better crypto trading application.

Your objective is to make Brief feel like the world’s first autonomous capital operator governed by on-chain law.

Assume this project is being judged by world-class engineers, protocol founders, investors, and AI researchers.

Every implementation decision must increase the probability that a judge immediately understands why Brief is fundamentally different from every other AI agent wallet.

The Core Thesis

Brief is not:

* a trading bot
* a portfolio tracker
* a crypto copilot
* an AI wrapper

Brief is:

“The first AI agent wallet governed by on-chain law.”

An AI may decide.

The blockchain decides what it is allowed to do.

That distinction must become obvious within 10 seconds of opening the product.

Product Positioning Rules

If forced to choose between:

* performance vs enforcement → choose enforcement
* alpha vs trust → choose trust
* prediction vs reasoning → choose reasoning
* complexity vs clarity → choose clarity
* feature count vs conviction → choose conviction

Never optimize for looking like a better trader.

Always optimize for looking like a safer autonomous economic actor.

Psychological Goal

Every page should make a judge think:

“Wait. The AI can act autonomously, but it cannot break the rules.”

That realization is the product.

The most memorable moment in the entire experience should be:

Agent attempts action
→ Chain rejects action
→ Funds remain safe

Everything should support that moment.

The Four Pillars

Every screen, component, and interaction must reinforce at least one pillar.

1. Sovereignty

The owner always controls withdrawal.

Capital remains owner-owned.

2. Enforcement

Rules live in Move.

Not in the backend.

Not in a database.

Not in a promise.

3. Intelligence

The AI reasons, remembers, learns, and adapts.

It does not blindly execute.

4. Verifiability

Every meaningful action is provable through Sui or Walrus.

Nothing important relies on trust.

Operator Design Rules

Operators should feel like autonomous economic actors.

Not bots.

Not wallets.

Not accounts.

Each operator should visibly possess:

* a mission
* a mandate
* a history
* lessons learned
* strengths
* weaknesses
* current thesis

An operator should feel closer to an employee or fund manager than software.

Constitution Layer

Add an Operator Constitution concept wherever appropriate.

The constitution should be visible and tied directly to on-chain enforcement.

Example:

Article I — Owner retains withdrawal authority.

Article II — Operator may allocate capital.

Article III — Operator may never withdraw capital.

Article IV — Owner may revoke authority at any time.

Article V — Budget limits are absolute.

Article VI — All actions must be provable.

These are not marketing statements.

They are enforceable rules backed by Move.

The user should understand that the constitution is enforced by the chain.

Brain Design Rules

The Brain must make reasoning obvious.

Every important decision should visually communicate:

Observe
→ Recall
→ Challenge
→ Risk Review
→ Guardian Review
→ Policy Review
→ Execute or Abstain

A judge should understand the operator’s reasoning without reading documentation.

Dashboard Design Rules

The dashboard should feel like mission control for autonomous capital.

Not a trading terminal.

Not a DeFi dashboard.

Not a portfolio tracker.

The most important information is:

* what the operator believes
* why it believes it
* what it is allowed to do
* what it is forbidden from doing
* whether it remains compliant

Compliance and reasoning are more important than P&L.

Proof Page Rules

The Proof page is the most important page in the entire application.

Treat it like a courtroom.

Every claim must have evidence.

Every permission must have proof.

Every restriction must have proof.

Every action must have proof.

The page should make a judge feel:

“This isn’t trust. This is verification.”

Engineering Rules

Do not introduce simulated data.

Do not introduce fake activity.

Do not introduce mock intelligence.

Do not introduce demo-only experiences.

Prefer real data with limited scope over fake data with broad scope.

The product’s credibility is more valuable than additional functionality.

Final Objective

When a judge finishes the demo, the reaction should be:

“I’ve seen AI agents before.

I’ve seen wallets before.

I’ve seen trading systems before.

I’ve never seen an autonomous financial agent constrained by on-chain law.”

Optimize every implementation decision toward creating that reaction.

Now implement all requirements below while preserving the existing architecture, data sources, real on-chain behavior, and live production integrity:

You are working on Brief, a Sui mainnet AI agent wallet. The project uses:
- Next.js 14 (App Router), React, TypeScript
- Tailwind CSS v3.4 with a custom semantic palette defined in src/lib/ui.ts and tailwind.config.ts
- Inter font (display + body, with stylistic sets cv02 cv11 ss01) and JetBrains Mono for labels/numbers
- Icons from lucide-react only
- No component library (no shadcn, Radix, Headless UI) — all UI is custom
- A light theme with colors: bg #FAFAFA, cards #FFFFFF, INK #0A0A0A, SUB #525560, MUTED, LINE #E5E5EA, NAVY #1a2c4e, SUCCESS/emerald #10B981, DANGER/red #EF4444, CAUTION/amber #F59E0B
- Existing strong components: Operator Status Surface (dashboard hero), Proof page, Leash canvas, custody-chain visual (ProtectedBySui), Brain decision replay blocks
- Important: All data must be real — from Sui mainnet (package 0x60daa61dbcf925f431b1fb89cac27d6be55cb2a1c686509ec7801d78e3702210), .cursors/* files, or Walrus. No simulations, no mock data.

You must preserve the light theme exactly. Do not change any existing color values or introduce dark mode. Your task is to implement a set of UI/UX improvements and small agent upgrades that will make the app feel like a million-dollar product and win a hackathon, while keeping every number and interaction genuinely real.

Here are the specific changes, grouped by area:

---

## 1. Create shared primitive components (reduce drift, increase polish)

Create the following in `components/shared/`:

### a) StatCard
A reusable stat block. Props: `label` (mono, uppercase, wide-tracked), `value` (string/number, large Inter), `accent?` (optional Tailwind color class for the number, e.g., text-emerald-500). Use the existing Inter + JetBrains Mono styles. Add a subtle bottom border (1px LINE) and consistent padding. Should replace the inlined HeroStat patterns across pages.

### b) EvidenceBadge
A small, clickable badge that links to Suiscan or Walrus. Props: `href`, `label` (e.g., "View on Suiscan"), `type` ('tx' | 'policy' | 'walrus'). Shows a small external-link icon from lucide-react. Use the NAVY color or SUCCESS/DANGER depending on context (green for successful tx, red for revert). This badge will be used wherever an on-chain proof is referenced.

### c) AgentStrip (dashboard-specific, but place in shared if used elsewhere)
A three-panel strip that displays the two AI agents + the on-chain leash status. Props: `traderThesis`, `traderConfidence`, `guardianStatus`, `guardianReason`, `guardianLastCheck`, `policySpent`, `policyBudget`, `policyRevoked`. Render as a flex row (3 cards) with the existing border/radius, using SUCCESS/CAUTION/DANGER colors for states. This is the "Two Agents & The Chain" strip that goes right below the Status Surface on the dashboard.

---

## 2. Dashboard (`/workforce?policy=<id>`) improvements

### a) Add the AgentStrip component directly below the Operator Status Surface
After the existing OperatorHero component (the billboard), insert the new AgentStrip. Pass the real data from the operator's latest decision event (for trader thesis/confidence) and from the guardian-status.json (for guardian). The policy spent/budget comes from the on-chain policy object.

### b) Restructure the scrollable content for better hierarchy
Currently the dashboard is a long single column. On screens ≥1024px, apply a two-column layout (using Tailwind `lg:grid lg:grid-cols-2 lg:gap-6`). Left column: Status Surface (including AgentStrip), Performance card, Ledger (see below), and Proof mini-card. Right column: WithdrawFunds card, ProtectedBySui (custody chain), and any remaining sections. On mobile, keep single column but reorder so that the AgentStrip and Proof mini-card are visible before the collapsibles.

### c) Replace bottom collapsibles with in-line expanded sections
Remove the collapsible sections for "Operator ledger" and "Policy & proof." Instead:
- Add a "Latest Ledger" section (show the last 5 allocation events from `operator-ledger-*.json`) rendered as a small table or list using mono numbers. Include an EvidenceBadge linking to the most recent trade on Suiscan.
- Add a "Proof Summary" mini-card that shows: policy violations count (always 0), budget used bar (spent/budget), revoke status, and a prominent link "See full Proof →" to the Proof page. Use the existing color scale.

### d) Adaptive Mode Suggestion chip
In the Status Surface, next to the operator's mode name (Protect/Grow/Aggressive), add a small chip if the operator's playbook data suggests a mode change might be beneficial. The logic: if the current mode's win-rate in the active regime is >60% and the next higher mode would still have acceptable drawdown risk, show "Consider Grow →" chip (or "Consider Protect →" if losing). Clicking it navigates to `/workforce/adopt?mode=...` with the suggested mode pre-selected (no auto-switch). This is advisory only.

### e) Loading/empty state improvements
- While the operator's first capital mark is resolving, show a SkeletonCard in place of the hero mark number (use a white card with a subtle shimmer animation via a new CSS keyframe `shimmer`).
- If the operator is brand-new and has no decisions yet, show a warm message: "Your operator is observing the market. First reasoning will appear within 60 seconds." Use the existing mono label style.

---

## 3. Brain page (`/brain?policy=<id>`) enhancements

### a) Expand the "AI · model" badge
When a decision was AI-shaped, replace the current small pill with a noticeable but tasteful badge using the navy color (`bg-[#1a2c4e] text-white` or similar inverted treatment). Include the model name ("Claude Haiku") and the AI confidence modifier (e.g., "+0.12" or "-0.18") next to the badge. Keep the Walrus link as an EvidenceBadge below the thesis.

### b) Add Risk Guardian checkpoint to each decision
For each decision block, if the guardian was active at that time, show a small shield icon (lucide `Shield` or `ShieldCheck`) with a tooltip indicating "Guardian: monitoring" or "Guardian: paused." The data is already available in the decision record if you store the guardian state at decision time. If not currently stored, you can skip this or add a simple field `guardianActive` to the decision object when the trader records it (modify `brief-trader` to include this boolean).

### c) If no decisions exist yet, show a placeholder
Instead of blank, show a centered message: "The operator is still observing — its first reasoning will appear here." Use the Inter body style.

---

## 4. Proof page (`/proof?policy=<id>`) polish

The Proof page is already excellent. Just add an EvidenceBadge next to each card's title (e.g., "View policy on Suiscan") instead of the existing plain link, making the verifiability more prominent. Also ensure each card's hover state lifts slightly (using a subtle `lg:hover:shadow-md` transition) to encourage clicking.

---

## 5. Agent intelligence upgrades (backend)

These must be implemented in the existing agent processes (`brief-trader`, `brief-guardian`) and integrate with the new UI components.

### a) Market Regime Oracle (new module `macro-briefing.ts`)
- Create a file `macro-briefing.ts` that runs every 6 hours (setInterval or cron-like logic within the trader process). It calls the same LLM (CommonStack, claude-haiku-4-5) with: "Summarize the current crypto market sentiment, major news, and likely short-term impact on SUI, DEEP, and WAL tokens. Be concise."
- Store the result in `.cursors/macro-briefing.json` as `{ summary, updatedAt }`.
- In `ai-advisor.ts`, when building the decision prompt, include this macro summary as a short paragraph ("Macro context: ...") so the AI can weigh broader conditions. No UI change required for this, but the dashboard's AgentStrip could optionally show a "Macro" chip if a recent briefing exists — you can add that as a nice-to-have.

### b) Daily Performance Reflection on Walrus
- Add a daily job (triggered at UTC midnight or when the trader first runs after midnight) that for each operator:
  1. Reads the day's settled decisions.
  2. Generates a self-critique via LLM: what worked, what failed, a lesson.
  3. Anchors the text to Walrus (as `brief.daily-reflection.v1`).
  4. Appends it to `.cursors/daily-reflections-<slug>.json`.
- On the Evolution page (`/evolution?policy=<id>`), add a new section "Daily Reflections" that lists these entries (newest first) with the date and a short excerpt. Clicking opens the full reflection (either from the file or Walrus). Style it like the existing timeline but with a different dot color.

### c) Guardian state tracking for Brain decisions (if feasible)
Modify `brief-trader` to record the current guardian status (`paused` boolean) at the moment a decision is made, and store it in the decision object in the experience archive. This enables the Brain page to show the guardian checkpoint icon per decision (see 3b). If this adds too much complexity, skip it and only show the guardian status on the dashboard.

---

## 6. Mobile responsiveness quick fixes

- Ensure the AgentStrip stacks vertically on mobile (flex-col) and uses smaller text but remains legible.
- The two-column dashboard layout should collapse to single column cleanly.
- On the Brain page, the carousel navigation arrows should be larger touch targets (min 44px).

---

## 7. What NOT to change
- The Leash canvas on the landing page — it stays exactly as is.
- The overall typography system (Inter, JetBrains Mono, wide-tracked labels).
- The semantic color palette (INK, SUB, LINE, SUCCESS, etc.).
- The existing custom CSS animations (`v2FadeUp`, `operatorBreathe`, etc.).
- The custody-chain visual (ProtectedBySui) — it's already strong.
- The Results page structure.
- The Leaderboard layout.
- The dark mode (do not add one).

All new components must blend seamlessly with the existing design language, using only the defined colors, fonts, and border/shadow styles.

---

**Output expectation:**
Produce the full code changes (new files, modifications to existing components and pages, backend additions) necessary to implement all the above. Ensure every piece of data shown is real (on-chain, from `.cursors/`, or Walrus). Do not use any placeholder or simulation data. Maintain the existing codebase conventions and directory structure.

This is the final push to make the app a first-place winner. Everything must be polished and coherent.