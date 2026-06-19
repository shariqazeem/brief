# Brief — 3 Minute Demo

*Read the lines as written. Point at the screen; the agent's live values can be anything — the script never depends on them.*

---

## 0:00 – 0:15 · OPEN

Most AI agent wallets give the AI access to your money and hope it behaves.

Brief does the opposite.

The AI can make decisions, but the blockchain decides what it's allowed to do.

Let's adopt an operator on Sui mainnet.

---

## 0:15 – 0:40 · ADOPT

I'm depositing real USDC.

One signature creates my operator.

The important part is custody.

My funds stay in my own DeepBook account.

The operator gets permission to trade.

It never gets permission to withdraw.

So even if the AI wanted to take the money, it can't.

Now let's see the operator.

---

## 0:40 – 1:10 · DASHBOARD

This is the operator dashboard.

At the top is the operator's current thesis — what it currently believes.

Right below that are the three layers that govern every decision.

The Trader proposes actions.

The Risk Guardian can pause trading if conditions become dangerous.

And the on-chain policy tracks exactly how much of its budget has been used.

Everything here is live and updates as the operator runs.

Let's look at how it actually thinks.

---

## 1:10 – 1:40 · BRAIN

This is the Brain.

Every decision is recorded step by step.

The operator observes the market.

Recalls similar situations from memory.

Reviews risk.

Checks policy constraints.

And then either acts or stands aside.

When AI influences a decision, the reasoning is attached here and anchored to Walrus.

So instead of asking us why the operator acted, you can inspect the reasoning directly.

---

## 1:40 – 2:00 · EVOLUTION

The Evolution page shows what the operator has learned over time.

You can see its historical decisions, lessons, and reflections.

The goal isn't to create a black box.

The goal is to make the learning process visible and auditable.

---

## 2:00 – 2:20 · RESULTS

This page answers one question:

Did it work?

Returns, drawdown, capital preservation, and decision statistics are all calculated from real activity.

No simulated trades.

No paper performance.

Everything comes from actual operator behavior.

---

## 2:20 – 2:50 · PROOF

This is the most important page.

Every claim has evidence.

The policy exists on-chain.

Every authorized trade is recorded on-chain.

The operator's reasoning is stored on Walrus.

And if the operator is revoked, the chain blocks future actions.

Let's do that now.

---

## 2:50 – 3:15 · REVOKE

I'm revoking the operator.

Now when it tries to act again, the transaction fails.

The chain rejects it.

The funds remain safe.

That's the core idea behind Brief.

The AI proposes.

The blockchain enforces.

Brief — the first AI capital operator governed by on-chain law.
