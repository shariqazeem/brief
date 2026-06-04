# Brief — Pivot to Policy-Controlled Autonomous Operator

**Decision date:** 2026-05-23

**One-sentence reframe:** Brief is no longer a yield optimizer with a chat box. It is a **policy-controlled autonomous wallet for AI agents on Sui** — the human writes the constraints, the agent operates inside them, the chain enforces it, the kill-switch is one click.

**Sub-track:** Was Intent Engine (sub-track 3). Now **Autonomous Agent Wallet + Intent Engine merged** (sub-tracks 2 + 3).

**New tagline:** *Autonomous financial operators on Sui.*

**New philosophy line (use in demo narration):** *The AI is not trusted. The policy is trusted.*

---

## Why the pivot

The old framing — "type a goal, two AI plans, pick one, execute" — has three structural weaknesses:

1. DeFi degens already know where the yield is; they don't need an agent to tell them NAVI is at 21%.
2. Normies don't have 1000 SUI to "deploy."
3. The "pick one of two strategies" loop self-defeats: if the AI is smart, why am I picking? If I pick, what did the AI automate?

The new framing fixes all three:

- **The product targets agent builders and treasury operators**, not yield seekers. They want autonomy with safety, not advice.
- **Sui's object model becomes the actual product**, not decoration. A `PolicyObject` is the capability — the chain itself enforces budget, scope, expiry, and revocation. Build it on Solana with `&signer` + RPC checks and you've reimplemented half of it; build it on Sui and the policy IS the object.
- **The demo has dramatic beats**: grant → autonomous loop → kill switch → next trade fails on-chain. Before/after. Not "an AI agent showed me some yield numbers."

---

## What dies

- "Two strategies, pick one" loop — gone
- ResearchAgent's "survey 311 yield pools" framing — gone (the data fetch can survive as a tool the operator calls *if needed*, but it's not the headline)
- StrategyAgent + StrategyAlt as separate processes — collapse into one Operator runtime
- The current `/app` state machine that revolves around picking a strategy

## What survives (the 70% Claude was right about)

- **WorkObject primitive** — still the on-chain activity log. Every operator action is a WorkObject parented to the policy. Lineage graph still works.
- **The four-process agent runtime pattern** — same shape (poll, decode, act, mint), different trigger (policy activation instead of Query event) and different cadence (loop within budget vs one-shot).
- **Walrus integration** — operator action payloads + memory go here. The Walrus prize framing actually gets stronger ("verifiable agent memory + audit trail").
- **DeepBook integration** — already wired; just becomes mandatory (no simulated fallback for the live demo).
- **dApp Kit wallet** — same.
- **Cream + navy design language, Stepper, Timeline, WorkObjectCard, lineage SVG** — all reusable. The hero copy and the state machine driver change; the visual atoms stay.
- **`settlement.move`** — agent payment helper, kept.

## What's genuinely new

1. **`operator_policy.move`** — new Move module. Defines the `OperatorPolicy` shared object, its enforcement function (`assert_can_spend`), its mutating function (`record_spend`), and the kill-switch (`revoke`).
2. **Operator agent loop** — agent loops while policy is active, scans for opportunities, proposes/executes one action per cycle, calls `record_spend` on the policy in the same PTB as the trade.
3. **New UX flow** — Create Operator → Configure → Activate → Live dashboard with budget meter + countdown + action timeline + "Revoke mandate" → (optional) Pending approval card for above-threshold actions.

---

## Phased execution plan

**Phase 1 — Foundation (Move module).** Write `operator_policy.move` + tests + upgrade the published package. Verify `assert_can_spend` aborts correctly under: revoked, expired, budget-exceeded, venue-not-allowed, wrong-sender. *This is the trust anchor — everything else builds on it.*

**Phase 2 — Operator agent runtime.** Replace `agents/strategy/`, `agents/strategy-alt/`, `agents/execution/` with a single `agents/operator/index.ts`. Polls `PolicyCreated` events, then loops while the policy is active: scan opportunities (DeFiLlama + DeepBook order book), propose ONE action, build a PTB that does the trade AND calls `record_spend` in the same transaction (so policy violation aborts the whole thing).

**Phase 3 — Real DeepBook orders, non-negotiable.** Top up the wallet. Live DeepBook fills, not simulated. Settle every operator action through a real DeepBook order on testnet.

**Phase 4 — UX rebuild.** Replace `/app`'s state machine. New screens: **Create Operator** (templates: Conservative Yield, Stablecoin Treasury, Market Maker, Low-Risk Growth, Custom), **Configure** (budget slider, venue chips, expiry selector, risk tolerance, auto-approve threshold), **Active Operator Dashboard** (status, budget meter, expiry countdown, live action timeline using WorkObjectCard, pending approvals if any, **big "Revoke mandate" button**). Landing copy + hero copy update.

**Phase 5 — Demo polish.** Templates pre-fill realistic constraints. Animation timing on the budget meter ticking up + the revoke-then-fail dramatic beat. Sub-30-second activation flow. Demo video script.

---

## Sub-track alignment after pivot

| Track | How Brief satisfies it |
|---|---|
| **Sub-track 2 — Autonomous Agent Wallet** | `OperatorPolicy` is a Move capability object with on-chain enforcement (budget, scope, expiry, revocation). Agent operates autonomously inside the envelope. Real DeepBook orders. Kill-switch demonstrated. |
| **Sub-track 3 — Intent Engine** | The Create-Operator screen accepts natural-language intent; the Configure screen is the human-readable PTB-preview equivalent (you see what the agent CAN do before signing). Risk guardian is the on-chain `max_concentration_bps` + `assert_can_spend`. Explicit confirmation step = the policy-grant signature itself. |
| **Walrus prize** | Agent action payloads + reasoning memory stored on Walrus, blob IDs anchored on-chain in the WorkObject. "Verifiable agent memory layer" framing. |
| **DeepBook prize** | Every operator action settles through DeepBook v3. The integration is now load-bearing, not optional. |

---

## The demo arc (90 seconds)

| Beat | What's on screen | Voice-over |
|---|---|---|
| 1 | Landing page → "Autonomous financial operators on Sui" | "Today's AI agents are stuck at the approve wall. Brief unsticks them." |
| 2 | Create Operator screen — pick "Conservative Yield Operator" template | "I create an operator. I set its budget — 50 SUI. Allowed venues — DeepBook only. Expiry — 24 hours." |
| 3 | One signature → PolicyCreated event → page transitions to Active dashboard | "One signature. The policy is now a Sui object owned by me. The agent can operate inside it autonomously." |
| 4 | Live timeline: 3 WorkObject rows appear in sequence, budget meter ticks up 12 / 50 / 50, each row links to a real DeepBook fill on suiscan | "The agent scans, proposes, settles — every trade through real DeepBook orders. Every action is an on-chain WorkObject parented to the policy. Auditable." |
| 5 | I click "Revoke mandate" — single signature | "Now I revoke. One signature, instant on-chain." |
| 6 | Live attempt by the agent on its next cycle — the WorkObject minting attempt FAILS on-chain, timeline shows red `Policy revoked` row | "The agent tries another trade. It fails on-chain — the policy check aborts. The chain itself, not our server, blocked it." |
| 7 | Closing slide: "The AI is not trusted. The policy is trusted." | (same line) |

---

## Founder context (so this stays anchored)

The pivot doesn't reset the timeline. Phase 1 + 2 (Move + agent loop) is the only genuinely new work; everything else is reframing + selective deletion. Estimated 4–6 working days for a polished submission, well inside the 2026-06-21 deadline.

The deep advantage Shariq brings: **Squads v4 vault integration, an Anchor policy program, x402 micropayments, and KyvernOS** — all of which are *"agent has budget, agents transact autonomously, owner can revoke"* on Solana. Sub-track 2 is literally KyvernOS-on-Sui, played to home turf.
