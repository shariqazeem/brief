# Brief — Sui Overflow 2026 Submission (paste-ready)

*Fill the DeepSurge form with the values below. The Description is the highest-leverage field — judges skim it; it's written to hook in 5 seconds and reward a closer read.*

---

## FORM FIELDS

- **Project name:** `Brief`
- **Track:** **The Agentic Web (AI)** — Core Track
- **Deployment network:** **Mainnet**
- **Project Repo:** `https://github.com/shariqazeem/brief`
- **Website:** `https://usebrief.xyz`
- **Demo Video:** `<paste your YouTube link>`

**ADD LINK (do this — one-click verification is what wins a "verify, don't trust" project):**
- Label `Live Proof (verify on-chain)` → `https://usebrief.xyz/proof`
- Label `Sui Package on Suiscan` → `https://suiscan.xyz/mainnet/object/0x60daa61dbcf925f431b1fb89cac27d6be55cb2a1c686509ec7801d78e3702210`

---

## DESCRIPTION  *(paste this; apply the bold/bullets with the editor)*

**Brief — the first AI agent that manages real money, governed by on-chain law.**

An AI can decide what to do. The blockchain decides what it's *allowed* to do.

Brief lets anyone hand an AI agent real USDC to manage on Sui — autonomously and **non-custodially**. The agent trades your funds on DeepBook, but a Move contract makes it **physically impossible** for it to withdraw them, exceed its budget, touch a disallowed venue, or keep trading after you revoke it. Every guarantee is enforced by the protocol — not a backend, not a promise.

**Why it's different from every other "AI agent wallet"**
Everyone else enforces the spending limit in their backend. Brief enforces it in Move, and you can watch it fail safely:
- An over-budget trade **reverts on-chain** — `EBudgetExceeded`.
- Revoke the agent, and its next trade **aborts on-chain** — `EPolicyRevoked`. The agent tries to act, the chain says no, the funds never move.
- Your capital stays in **your own** DeepBook BalanceManager. The agent receives a trade-only TradeCap — and is **never** given a WithdrawCap.

**It's a real AI agent — and a second agent watches it**
- A load-bearing LLM advisor reviews macro context, the agent's own memory, and live risk, then sharpens, dampens, or **vetoes** each decision. It's explainable, not a black box.
- A separate, autonomous **Risk Guardian** agent can pause trading when volatility or drawdown crosses a threshold.
- Every decision is replayable, and its reasoning and lessons are anchored to **Walrus** — so if our server vanished, a new agent could recover its memory from decentralized storage and keep going.

**Proven on mainnet, with real money**
The full loop is live and independently verifiable on Suiscan: adopt → gated trades → over-budget revert → revoke → post-revoke abort → withdraw 100%. Don't trust us — **every claim on the Proof page is a clickable on-chain artifact.**

**Built across the Sui stack:** autonomous agents on Sui's object model (Agentic Web), real orderbook trading on **DeepBook**, and verifiable, recoverable memory on **Walrus**.

AI agents are about to start moving real money — ready or not. **Brief is the layer that makes it safe: the AI proposes, the chain enforces.**

---

## SHORT DESCRIPTION  *(if a separate one-liner field appears, or for socials)*

> The first AI agent that manages real money, governed by on-chain law. Hand an AI agent real USDC on Sui — it can trade, but a Move contract makes it physically unable to withdraw, overspend, or keep going once you revoke it. The AI proposes; the chain enforces. Live on mainnet, verifiable on Suiscan + Walrus.

---

## MEDIA — upload in this order, with these captions

1. **Dashboard** — *"The live agent: its current thesis, the two agents (Trader + Risk Guardian) and the on-chain leash, the custody chain, and an Operator Constitution where every article is enforced by Move."*
2. **Proof** — *"Verify everything, trust nothing. Every claim is a live on-chain artifact — including the Kill-Switch Test: revoke the agent and its next trade aborts on-chain with EPolicyRevoked."*
3. **Brain** — *"Read the agent's mind: what it saw, remembered, feared, and decided — with AI reasoning anchored to Walrus."*
4. **Results** — *"Did it work? Capital-preservation scorecard vs holding vs cash — computed from the real on-chain record, zero policy violations."*
5. **Evolution** — *"What the agent learned over time, with its memory anchored on Walrus and recoverable if the server disappears."*
6. **Logo** (1:1).

---

## THE 3 THINGS A JUDGE SHOULD WALK AWAY REMEMBERING
1. **"The agent tried to act, the chain rejected it, the money never moved."** (on-chain enforcement, not a backend promise)
2. **It's a real, explainable AI agent — two of them — and you can audit the reasoning on Walrus.**
3. **It's live on mainnet with real USDC, and every claim is one click to verify on Suiscan.**

*Package: `0x60daa61dbcf925f431b1fb89cac27d6be55cb2a1c686509ec7801d78e3702210` · Network: Sui mainnet*
