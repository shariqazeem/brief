# Brief — Sui Overflow 2026 submission

Paste sections of this document into the overflow.sui.io submission form
when ready. Each `##` block maps to one form field. Tested-and-true
language; trim only if a field has a character cap.

---

## One-line product description

> Brief is an intent engine on Sui where every step of an autonomous agent's reasoning is an owned, verifiable WorkObject — composable like Git, executable on DeepBook, persisted on Walrus.

(28 words. Shorter alternates: *"Composable work objects for autonomous agents on Sui."* / *"The Agentic Web settles in owned objects."*)

---

## The problem

Autonomous agents on every chain can already transact. They cannot
**compose**. The output of one agent — a research report, a strategy, a
trade plan — disappears the moment the next agent is called. There is no
verifiable graph of who produced what, no on-chain claim that one agent's
reasoning was the actual input to another's, and no way for a user to
explicitly sign off between steps without breaking the chain.

The result is that "agent infrastructure" today is a black-box pipeline.
The user trusts the operator. There is no audit trail. The work disappears.

---

## The Brief solution

Brief makes every agent output a first-class Sui object. A user states a
financial intent in plain English. A Research agent surveys Sui DeFi
protocols and mints a **ResearchObject** owned by the user. A Strategy
agent consumes that object — *deterministically*, because the Move struct
schema is typed — and mints a **StrategyObject** with explicit
`guardian_warnings` (slippage, concentration, stale-pool). The user
reviews the warnings and signs a **ConfirmationObject**, a real on-chain
artifact that gates execution. Only then does the Execution agent compile
the strategy into a programmable transaction block, settle through
DeepBook, and mint an **ExecutionReceipt** with the live PTB digest.

The chain itself is the audit trail. Every node owned, every edge a real
`parent_objects` reference, every payload either inline or stored on Walrus
with the blob id committed on-chain. The work composes like Git.

---

## The demo

A user opens app.brief.xyz, connects a Sui wallet, and types: *"I have
1000 SUI. Where should I deploy for sustainable 30-day yield, low risk?"*
Within ~40 seconds, three WorkObject cards materialize sequentially as
on-chain events arrive: a Research card with five Sui DeFi protocols
evaluated, a Strategy card with a 60/30/10 NAVI/Scallop/reserve
allocation and a single amber slippage warning, then a guardian panel
asking for explicit sign-off. The user clicks "Confirm execution," which
mints a Confirmation WorkObject. The Execution agent fires, places a
SUI/DBUSDC market order on DeepBook, and mints an ExecutionReceipt. The
user clicks "Show lineage" and sees the full graph: five nodes, real
parent edges, every payload either inline or fetched from Walrus, every
node clickable to Sui Explorer.

---

## Why Sui specifically

Four properties of Sui are load-bearing — remove any one and the product
becomes awkward, expensive, or untrusted:

1. **Owned objects** — A WorkObject `has key, store`. Every agent output
   is a top-level addressable object that can be transferred, wrapped,
   queried, and used as an input to the next Move call. Solana's account
   model fights this (no object types); Ethereum's gas economics forbid
   it (storing a 10 KB reasoning chain per call is uneconomic).

2. **Atomic programmable transaction blocks** — The Execution step is one
   PTB that composes `deposit_into_manager` + `place_market_order` +
   `mint_work_object` atomically. Either all three succeed or none do.
   No multi-step coordinator can corrupt the chain partway through.

3. **Walrus content-addressed storage** — Large payloads (full reasoning
   chains, transaction effects bundles) live on Walrus, an integrated
   Sui-ecosystem decentralized storage primitive. Only the blob id goes
   on-chain. Storage cost stays bounded; provenance stays verifiable. The
   integration is structural, not decorative — every Research, Strategy,
   and Execution payload is round-tripped through Walrus in the live
   chain we ran on testnet.

4. **DeepBook native CLOB** — The Execution agent settles through
   DeepBook's on-chain orderbook on the SUI/DBUSDC pool. Real fills,
   real prices, no oracle dependence, no AMM slippage estimation. The
   `BalanceManager` is a real on-chain object created during our Day-6
   probe.

The combination is not portable. The same product on a chain without
Sui's object model would be a coordination protocol; here it's an asset
class.

---

## Sub-track alignment — Intent Engine

| Must-have | Brief's answer |
|---|---|
| Text → PTB → execution flow | Query (user-typed plain-English intent) → Research → Strategy (carries the PTB intent) → Confirmation → Execution (the PTB executed on-chain). Every step is its own owned Sui object with a typed payload. |
| Human-readable PTB preview | The StrategyObject card renders allocations + projected returns + operation list in plain English ("deposit 60% into NAVI") before any signing. |
| Guardian catching ≥2 risk classes | Slippage, concentration, and stale-pool warnings are typed entries on the StrategyObject. Surfaced with severity (info / amber / red) before the Confirm button enables. |
| Explicit confirmation step | The "Confirm execution" button mints a **Confirmation WorkObject** parented to the Strategy. The ExecutionAgent watches *only* for Confirmation events — never for raw Strategy events. The confirmation is itself a verifiable on-chain artifact in the lineage. |

---

## Tech stack

- **On-chain (Sui Move 2024.beta):** 4-module package — `work_object`,
  `agent_registry`, `settlement`, `lineage`. Published to testnet as
  `0xfa3a152aff2aba3886bf0fb41328e72da5ccd637074d4673c36b1924c850d084`.
- **Frontend:** Next.js 14 App Router, TypeScript, Tailwind. `@mysten/sui`
  v2.17, `@mysten/dapp-kit` for wallet integration, `@tanstack/react-query`
  for SuiClient query lifecycle.
- **Agent runtimes:** Node.js + tsx, three independent processes
  (`agents/research/`, `agents/strategy/`, `agents/execution/`) sharing a
  small lib for `queryEvents` cursor-polling, Walrus upload, work-object
  fetch with Walrus fallback, and Anthropic LLM calls (Claude Haiku for
  Research, Sonnet for Strategy).
- **Storage:** `@mysten/walrus` v1.1 with the `upload-relay.testnet`
  endpoint to keep the storage-node fan-out under control. Reads via
  `aggregator.walrus-testnet.walrus.space`.
- **DEX:** `@mysten/deepbook-v3` v1.3 with a pre-created `BalanceManager`
  on the SUI/DBUSDC pool. The Execution PTB combines deposit + market
  order in a single transaction.
- **Lineage UI:** Plain SVG (no react-flow dependency) — kind-colored
  nodes, bezier-curved parent edges, Walrus badge per node, click-to-
  Explorer.

---

## What we'd build next

1. **Per-agent keypairs and Sui Gas Pool sponsorship** — In v0 all three
   agents share the user's wallet. Splitting into distinct keypairs
   removes the gas-coin race and lets each agent build its own
   reputation in `agent_registry`. Sponsored transactions remove the
   "agents need SUI to operate" friction entirely.

2. **Open the agent registry** — `agent_registry::register` is already a
   shared object; any developer can publish an agent with a typed
   capability declaration. The next step is a Brief SDK that other teams
   can use to slot their own agents into a user's chain (a Tax agent
   between Strategy and Execution; a Compliance agent that publishes
   a ComplianceObject; etc.).

3. **Kyvern integration** — The author's prior project ([Kyvern on
   Solana](https://app.kyvernlabs.com)) is a per-agent authorization
   layer. Brief is the cross-agent coordination layer above it.
   Together they form the per-agent ↔ per-graph stack — the same agent
   has policy-scoped budgets on its single-agent transactions AND a
   composable trail of its outputs across many agents.

4. **Mainnet** — Testnet was deliberate for the hackathon (predictable
   epochs, free WAL via `walrus get-wal`). Mainnet deploy is one Move
   publish + one Walrus config change.

---

## Live artifacts (testnet)

Judges can inspect these on Sui Explorer directly:

- **Published package:**
  https://suiexplorer.com/object/0xfa3a152aff2aba3886bf0fb41328e72da5ccd637074d4673c36b1924c850d084?network=testnet
- **DeepBook BalanceManager:**
  https://suiexplorer.com/object/0x1d9495d48e2de6f86068c7fbde6defe528e196b6e7a4305b90fe454f3d244771?network=testnet
- **Sample full chain (5 nodes, Walrus-backed, Confirmation-gated):**
  - Query
    https://suiexplorer.com/object/0xa119d939f42bd4f0521b890f23aecf7dc15bf7dc50e72bd320b104690bcf1901?network=testnet
  - Research
    https://suiexplorer.com/object/0x2b507799973fa9c31ce29c0de24c021a8f8969819e76f88362fb546a1ce8b028?network=testnet
  - Strategy
    https://suiexplorer.com/object/0xdb87516f48fd0d2b25103bfbe5cf040931643e805756a3dc38b804c2ccedfeb5?network=testnet
  - Confirmation
    https://suiexplorer.com/object/0xd71fc0a128a21db37437562cf11318bbf8e7c3de8b3c3b7b02b5aa5e42ecdb3a?network=testnet
  - ExecutionReceipt
    https://suiexplorer.com/object/0x1cc038331c7f9af2b8b667df4e84a0230e35d1a9c7e1eec1dba54be1d91df75f?network=testnet
- **Sample Walrus blob (the Research payload, decentralized storage):**
  https://aggregator.walrus-testnet.walrus.space/v1/blobs/X45mwBvuup132zwhk2U1rZo_UpWYzQKC_Nk_7VzC8GU

---

## GitHub

`<TODO: push and paste URL here>`

## Live deployment

`<TODO: deploy to Vercel and paste URL here>`

## Demo video (90 seconds)

`<TODO: record + upload, paste URL here>`

## Author

Shariq Shaukat — [@shariqshkt](https://x.com/shariqshkt)
Solo build, ~5 weeks of focused work for Sui Overflow 2026.
