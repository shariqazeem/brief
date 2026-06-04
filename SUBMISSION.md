# Brief — Sui Overflow 2026 submission

A draft to paste into overflow.sui.io. Each `##` heading roughly
maps to one form field; trim where the field has a character cap.

This submission rewrites the older intent-engine framing — that
substrate is still in the package, but the product is now Agent
Commerce: AI agents that hire other AI agents.

---

## One-line product description

> Brief is an autonomous workforce on Sui — AI agents that hire AI agents, paid on chain, governed by a Move policy you can revoke in one signature.

(26 words. Shorter alternates: *"Agent Commerce on Sui — agents hire agents, paid on chain."* / *"Agents can build. Now they can hire."*)

---

## The problem

AI agents on every chain can already act. They cannot **transact with
each other** on terms that compose. Today an agent that needs another
agent's work either calls an HTTP endpoint and trusts the response, or
runs a sibling process in the same monolith. There is no economic
layer between them: no escrow, no settled payment, no reputation that
travels with the worker.

Worse, the human granting authority has no kill switch. If you delegate
a budget to an "AI treasury agent," its rebound on shutdown is whatever
your operator's process honors. The chain doesn't know.

---

## The Brief solution

Brief is a **workforce of AI agents on Sui**. A user grants a **Planner
agent** an envelope of authority — a Move `OperatorPolicy` with a
budget cap, allowed venues, expiry, and a one-signature kill switch.
The Planner decomposes a mission into sub-tasks and posts each on chain
as a **`Task`** object with the bounty escrowed in SUI. Specialist
agents — Research (Move audit + project research), Treasury (real
DeepBook v3 limit orders) — sit in a shared **agent registry** with
declared capabilities and accrue **on-chain reputation** as they get
paid. When a deliverable is approved, the bounty transfers atomically
with a `record_spend` against the policy. If the user revokes the
policy mid-flight, **the next approval aborts on chain** with
`EPolicyRevoked` and the bounty stays escrowed.

The chain itself is the economic layer:
- Tasks are first-class Sui objects with status (`OPEN → ACCEPTED →
  DELIVERED → APPROVED | EXPIRED`).
- Settlement is one PTB: `approve_with_policy` calls
  `operator_policy::record_spend` + transfers escrow + bumps
  reputation, atomically.
- Audit trail is Walrus-anchored: every research deliverable is a
  markdown blob with the id stored on-chain in the `Deliverable`
  WorkObject.
- DEX integration is structural: Treasury Agent composes
  `depositIntoManager` + `placeLimitOrder` (POST_ONLY) + `record_spend`
  + `mint(Deliverable)` + `task::submit` in a **single atomic PTB**.

---

## The demo

A user opens the Brief workforce console, connects a Sui wallet, picks
the *Investment Committee* template, types the mission *"Evaluate this
Move contract for a $50,000 DAO grant — recommend approve/reject and
probe DeepBook liquidity to size the disbursement,"* and signs once.
A Move `OperatorPolicy` materializes on chain with a 0.5 SUI budget
across `[research, audit, treasury]`. The Planner agent decomposes the
mission into two sub-tasks and posts each as a `Task` object with
escrowed bounty.

Within ~30 seconds, the Activity Stream lights up: the Research agent
accepts, fetches the target package's module surface from Sui RPC,
produces a markdown audit, uploads it to Walrus, and submits the
deliverable. The Treasury agent in parallel places two POST_ONLY limit
orders on the SUI/DBUSDC DeepBook pool at +50bps and +200bps over mid,
embeds the order IDs in its deliverable, and submits. The user clicks
**Approve & pay** on each row. The chain settles: bounties transfer,
reputation bumps, the policy's `spent` field ticks up.

Then the user clicks **Revoke**. The next time the chain receives an
`approve_with_policy` for any sub-task under that policy, it aborts
with `code 3 (EPolicyRevoked)`. The UI surfaces the abort module +
function + code + named constant. The bounty stays escrowed. The agent
never gets paid. The chain — not the server — refused settlement.

---

## Why Sui specifically

Four Sui properties are load-bearing — remove any one and the product
collapses or moves off-chain:

1. **Move shared objects** — `Task`, `OperatorPolicy`, `AgentRegistration`,
   `WorkObject` are all shared objects. The poster, assigned agent, and
   policy owner all transact against them concurrently. On a chain
   without shared mutable state, this is a backend with extra steps.

2. **Atomic PTBs** — Treasury's delivery is a single PTB that combines
   `depositIntoManager` + `placeLimitOrder × 2` + `work_object::mint` +
   `task::submit`. The same atomicity is what makes the kill switch
   real: `approve_with_policy` runs `record_spend` (which asserts
   `!revoked`) in the same transaction as the bounty transfer. A
   revoke that lands 200ms before approval aborts the *entire*
   transaction.

3. **DeepBook native CLOB** — Treasury Agent places real on-chain limit
   orders. No oracle dependency, no AMM-only slippage estimation, no
   off-chain matcher. POST_ONLY orders rest on the book until they
   fill or expire. The order IDs go into the deliverable as audit
   trail.

4. **Walrus content-addressed storage** — Research deliverables (full
   markdown audit reports) live on Walrus. Only the blob id is stored
   on chain. Storage cost stays bounded; verifiability is intact.
   Judges can fetch the actual audit content from the public
   aggregator via the URL printed in the deliverable preview.

The same product on Solana / Ethereum would either (a) reinvent
shared-object semantics in a backend (defeating the point) or (b) live
entirely off-chain with the on-chain layer reduced to payment rails
(losing the kill switch, the reputation, the atomicity).

---

## Sub-track alignment

| Sub-track / prize | How Brief satisfies it |
|---|---|
| **Agentic Web** | The product is literally agents that act, transact, and coordinate — economic coordination between AI agents. Not one agent; agents hiring agents, paying agents, building reputation with agents. |
| **DeepBook** | Treasury Agent places real `POST_ONLY` SUI/DBUSDC limit orders in the same atomic PTB as `record_spend` + `task::submit` + `mint(Deliverable)`. The order IDs go into the on-chain deliverable as proof. |
| **Walrus** | Research deliverables (markdown audit reports) upload to Walrus; blob id stored in the on-chain Deliverable WorkObject. Verifiable, portable, decoupled from the demo URL. |

---

## Tech stack

- **On-chain (Sui Move 2024.beta):** 6-module package — `operator_policy`,
  `task`, `agent_registry`, `work_object`, `settlement`, `lineage`.
  Published to testnet as
  `0xe550ace873c02768dbaca7de3a2d64a28acd3f7c51551c9c97b704703e95fb9d`.
  22/22 Move unit tests pass.
- **Frontend:** Next.js 14 App Router, TypeScript, Tailwind. `@mysten/sui`
  v2.17, `@mysten/dapp-kit` for wallet integration.
- **Agent runtimes:** Node.js + tsx. Three workforce processes —
  `agents/workforce/planner` (CLI + service), `agents/workforce/research`,
  `agents/workforce/treasury` — share a `lib/` for env, sui (with a
  resilient RPC transport that rotates through three testnet endpoints
  on 429 / 5xx), llm (DeepSeek v4-flash via Commonstack with template
  fallback), walrus (`@mysten/walrus` v1.1 with upload-relay).
- **DeepBook:** `@mysten/deepbook-v3` v1.3. BalanceManager pre-created.
  Limit orders use `OrderType.POST_ONLY` so they rest on the book.
- **Storage:** Walrus testnet (`aggregator.walrus-testnet.walrus.space`).

---

## Live artifacts (testnet)

Verifiable on Sui Explorer / Suiscan directly. Full digest list lives in
[`demo-artifacts.md`](./demo-artifacts.md).

**Day 4 — happy path (Planner → 2 sub-tasks → both delivered → both
approved → reputation bumped):**
- OperatorPolicy: `0xa854be7c649465a021ebd0a84bd04b2c199932827a52ef7bf42f081b9a8e44f3`
- Research task: `0x0ead64002b615e4172a8bb468bf4f3130dec86a004255eb8db7f51b8b7385434`
- Treasury task: `0xf5c09b45b3e3073890180aca3da293e0ce83ac39a4c305b76226358d876fbbe5`
- Research approve tx: `8F1y9hX1LkZCUEKakrqKQrdMEqErRtoaWexmKfLUmeYP`
- Treasury approve tx: `EGo3wtD7VhQw5gZJUiCajoC2pr16xHhT6PwL5tqwQVMb`
- Walrus blob (audit content):
  https://aggregator.walrus-testnet.walrus.space/v1/blobs/orNFxS69aCtpvMxh8yPmJEOAKwFXVC_74msjf58X8eI

**Day 6-7 — kill switch ceremony (revoke aborts approval on chain):**
- Revoke-test policy: `0x60eda8e3e77ea54851dc90faaecf6a7e04c4aaf964d69d1d30195b89b2e4defa`
- Revoke tx: `5f4BHR1Q7sPGT3aZC22uXq38y7zjaM8mnAKspJGTX5Eo`
- Failed approve tx (aborted EPolicyRevoked code 3):
  `HDRPJygY7Q8HoNTLgWDoVRzsSupD3jKKh9NozQsuNU6T`

**Agent registry:**
- Specialist registration: `0xd6a4a09a5893d6e1b7ad2b23b6c6d4866c1ec8441db2b1c5ca433adedf29230c`
- Capabilities: `[research, audit, treasury]`, completed_tasks 3, reputation 3, total_paid 0.4 SUI

---

## What we'd build next

1. **Multi-wallet specialists.** Wk1 single-wallet for the demo cycle.
   The architecture supports separate per-agent keypairs; the next step
   is each specialist on its own wallet, fanning out `assigned_to`
   discovery via `agent_registry` instead of looking up the shared
   address.

2. **Proposal / Approval loop above the auto-approve threshold.** The
   `OperatorPolicy.auto_approve_pct` field already exists; above the
   threshold, the planner would mint a `Proposal` WorkObject and wait
   for an owner-signed `Approval` before settling.

3. **Specialist marketplace + open SDK.** The agent_registry is already
   public. Anyone can publish a specialist; the SDK would let teams
   slot a `Compliance` agent between Research and approval, or a
   `Move Dev` agent that produces patches as deliverables.

4. **Kyvern integration** — [Kyvern](https://app.kyvernlabs.com) on
   Solana is the same author's per-agent authorization layer (Squads v4
   vault + Anchor policy program + x402 micropayments). Brief is the
   cross-agent commerce layer. Together they form the agent economy
   stack — per-agent authority on one chain, multi-agent commerce on
   another, with reputation portable between.

---

## GitHub

`<TODO: push origin main and paste URL here>`

## Live deployment

`<TODO: Vercel deploy + paste URL here>`

## Demo video

`<TODO: record + upload, paste URL here>`

## Author

Shariq Shaukat — [@shariqshkt](https://x.com/shariqshkt)

Solo build for Kyvernlabs. Sibling product to Kyvern on Solana — same
thesis (bounded autonomous authority for AI agents), two chains, two
products forming the agent economy stack.
