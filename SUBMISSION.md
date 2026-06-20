# Brief - Sui Overflow 2026 Submission (paste-ready)

Fill the DeepSurge form with the values below. The Description is the highest-leverage field. It is written to hook fast and reward a closer read.

---

## FORM FIELDS

- Project name: `Brief`
- Track: The Agentic Web (AI), Core Track
- Deployment network: Mainnet
- Project Repo: `https://github.com/shariqazeem/brief`
- Website: `https://usebrief.xyz`
- Demo Video: `<paste your YouTube link>`

ADD LINK (do this, one-click verification is what wins a "verify, don't trust" project):
- Label `Live Proof (verify on-chain)` then `https://usebrief.xyz/proof`
- Label `Sui Package on Suiscan` then `https://suiscan.xyz/mainnet/object/0x60daa61dbcf925f431b1fb89cac27d6be55cb2a1c686509ec7801d78e3702210`

---

## DESCRIPTION  (paste this, apply the bold/bullets with the editor)

**Brief: the first AI agent that manages real money, governed by on-chain law.**

An AI can decide what to do. The blockchain decides what it is allowed to do.

Brief lets anyone deploy an autonomous AI agent (an operator) to manage real USDC on Sui. Operators can trade through DeepBook, but critical safety guarantees are enforced directly in Move. An operator cannot withdraw funds, exceed its budget, access disallowed venues, or continue trading after revocation. These constraints are enforced by the protocol itself.

**What makes Brief different**

Most AI agent products focus on intelligence. Brief focuses on intelligence and enforcement.

Every operator is governed by an on-chain policy that defines:
- who the authorized agent is
- how much it may spend
- which venues it may access
- when it expires
- whether it has been revoked

Every trade passes through that policy before execution. If an operator exceeds its budget, the transaction reverts on-chain. If an operator is revoked, subsequent trading attempts fail on-chain. The result is an autonomous agent that can act independently while remaining cryptographically constrained.

**Intelligence, memory, and oversight**

Brief combines multiple autonomous systems:
- A Trader agent that evaluates markets and proposes allocations.
- A Risk Guardian agent that independently monitors volatility and drawdown and can pause activity.
- An AI advisor that reviews market context, memory, and risk before influencing decisions.

Every decision is recorded and replayable. Reasoning, reflections, and memory artifacts are anchored to Walrus, making important parts of the agent's decision process independently verifiable.

**Built on the Sui stack**
- Agentic Web: autonomous operators that act on behalf of users
- DeepBook: real orderbook trading and execution
- Walrus: verifiable memory, reasoning, and reflections
- Sui Move: protocol-level enforcement of agent permissions

**Live on Mainnet**

Brief is running on Sui Mainnet with real USDC and real on-chain transactions. The complete lifecycle is live: Adopt, then Trade, then Revoke, then On-chain Rejection, then Withdraw. Every major claim in the product can be verified through the Proof page, on-chain events, or Walrus artifacts.

AI agents are beginning to manage real capital. Brief is what that looks like when they are governed by transparent, enforceable rules instead of trust alone.

The AI proposes. The chain enforces.

---

## SHORT DESCRIPTION  (if a separate one-liner field appears, or for socials)

The first AI agent that manages real money, governed by on-chain law. Hand an AI agent real USDC on Sui. It can trade, but a Move contract makes it physically unable to withdraw, overspend, or keep going once you revoke it. The AI proposes, the chain enforces. Live on mainnet, verifiable on Suiscan and Walrus.

---

## MEDIA  (upload in this order, with these captions)

1. Dashboard: The live agent. Its current thesis, the two agents (Trader and Risk Guardian), the on-chain leash, the custody chain, and an Operator Constitution where every article is enforced by Move.
2. Proof: Verify everything, trust nothing. Every claim is a live on-chain artifact, including the Kill-Switch Test where revoking the agent makes its next trade abort on-chain with EPolicyRevoked.
3. Brain: Read the agent's mind. What it saw, remembered, feared, and decided, with AI reasoning anchored to Walrus.
4. Results: Did it work? A capital-preservation scorecard versus holding versus cash, computed from the real on-chain record, with zero policy violations.
5. Evolution: What the agent learned over time, with its memory anchored on Walrus and recoverable if the server disappears.
6. Logo (1:1).

---

## THE 3 THINGS A JUDGE SHOULD REMEMBER
1. "The agent tried to act, the chain rejected it, the money never moved." On-chain enforcement, not a backend promise.
2. It is a real, explainable AI agent (two of them), and you can audit the reasoning on Walrus.
3. It is live on mainnet with real USDC, and every claim is one click to verify on Suiscan.

Package: `0x60daa61dbcf925f431b1fb89cac27d6be55cb2a1c686509ec7801d78e3702210` . Network: Sui mainnet
