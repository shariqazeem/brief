# Brief — Current state of the project

A complete picture of what exists, how it works, what's verified, and
what's pending. Read top-to-bottom for full context, or skip to the
section you need.

Last updated: **2026-05-20 late evening** (4 sessions in).

---

## 1. What Brief is

**Brief is an intent engine on Sui** where every step of an autonomous
agent's reasoning is an **owned, transferable Sui object** with a typed
schema, parent references to its inputs, an explicit user confirmation
step, and a Walrus-backed payload.

> *"Agents shouldn't just transact — they should compose."*

The unit of work is the **WorkObject**. A user states a plain-English
financial intent; a chain of agents produces Research → Strategy →
Confirmation → ExecutionReceipt, each a real on-chain object linked to
its inputs. The result is a verifiable graph of who produced what,
gated by an explicit user signature, with the heavy reasoning stored on
Walrus and the final settlement executed through DeepBook.

**Hackathon target:** Sui Overflow 2026, submission deadline **2026-06-21**.

**Tracks:**
- **Primary:** Agentic Web → Intent Engine sub-track
- **Sponsor stack:** Walrus (storage), DeepBook (DEX)

---

## 2. What's live on Sui testnet right now

Verifiable artifacts. All clickable on Sui Explorer.

### On-chain Move package

| Item | ID |
|---|---|
| **Published package** | `0xfa3a152aff2aba3886bf0fb41328e72da5ccd637074d4673c36b1924c850d084` |
| **UpgradeCap** (kept by deployer) | `0x6e43e0c0001c398679f9f088b74952e80213f7fac9028e836d467447546abc2f` |
| **Publish TX** | `2t4ibVEf1mzuqPoqur86boNXetngzRzZzoFAqZeXSmtR` |

The package contains 4 modules: `work_object`, `agent_registry`,
`settlement`, `lineage`.

### DeepBook integration

| Item | ID |
|---|---|
| **BalanceManager** | `0x1d9495d48e2de6f86068c7fbde6defe528e196b6e7a4305b90fe454f3d244771` |
| **Create TX** | `C4Q15vpS3gmzWj3KE9a6dWtihw4CScU13jDXfBtfof7e` |
| **Target pool** | `SUI_DBUSDC` (testnet) |

### Wallet

| Item | Value |
|---|---|
| **Address** | `0xd440b0b59ed5474b32ceb71d819c474e1512747179b7088ff324012767f5b435` |
| **Alias** | `strange-jasper` |
| **SUI balance** | ~0.75 SUI |
| **WAL balance** | ~0.48 WAL |

### Sample full chain (Walrus-backed, Confirmation-gated)

This 5-node chain proves every sub-track must-have:

| Layer | Object ID | Storage |
|---|---|---|
| **Query** | `0xa119d939f42bd4f0521b890f23aecf7dc15bf7dc50e72bd320b104690bcf1901` | inline |
| **Research** | `0x2b507799973fa9c31ce29c0de24c021a8f8969819e76f88362fb546a1ce8b028` | Walrus `X45mwBvuup132zwhk2U1rZo_UpWYzQKC_Nk_7VzC8GU` |
| **Strategy** | `0xdb87516f48fd0d2b25103bfbe5cf040931643e805756a3dc38b804c2ccedfeb5` | Walrus `r-8s2TVkwcYjx42JkPQAU8ecRTU46PfDEmwsLBo--Rk` |
| **Confirmation** | `0xd71fc0a128a21db37437562cf11318bbf8e7c3de8b3c3b7b02b5aa5e42ecdb3a` | inline (user signed) |
| **Execution** | `0x1cc038331c7f9af2b8b667df4e84a0230e35d1a9c7e1eec1dba54be1d91df75f` | Walrus `LoFoi-TaQK8dSVRjmQWroJ_ozbVcWaiN8G8CuoNiFGQ` |

Walk it: `npm run lineage 0x1cc038331c7f9af2b8b667df4e84a0230e35d1a9c7e1eec1dba54be1d91df75f`

Also on-chain from prior runs:
- A Walrus-backed chain ending at execution `0x7a97b4b311…e7f9` (5 nodes, no Confirmation — pre-confirmation-flow run)
- An inline-only chain ending at execution `0xa89f47cc…c2ac` (4 nodes, simulated mode)

---

## 3. Architecture

Three layers. Each one isolated from the others; they talk only through
on-chain events.

```
┌──────────────────────────────────────────────────────────┐
│  Frontend (Next.js 14 App Router, src/)                  │
│  Landing  /  ·  /app  ·  /lineage/[id]                   │
│  Wallet via @mysten/dapp-kit · queryEvents polling       │
└────────────────┬───────────────────────────┬─────────────┘
                 │ mints Query, Confirmation │ reads owned objects
                 │ via dApp Kit              │
                 ▼                           ▼
┌──────────────────────────────────────────────────────────┐
│  On-chain Move package (brief = 0xfa3a…d084)             │
│  work_object · agent_registry · settlement · lineage     │
└────────────────┬─────────────────────────┬───────────────┘
                 │ emits WorkObjectMinted  │ getOwnedObjects
                 │ events                  │
                 ▼                         │
┌──────────────────────────────────────────────────────────┐
│  Off-chain agents (Node + tsx, agents/)                  │
│  research · strategy · execution                         │
│  Poll queryEvents every 3s · cursor-based · mint outputs │
└────────────────┬─────────────────────────────────────────┘
                 │ uploads payloads to Walrus,
                 │ executes DeepBook PTBs
                 ▼
       Walrus testnet + DeepBook v3 testnet
```

### 3.1 Move package — `move/sources/`

| Module | Lines | What it does |
|---|---|---|
| `work_object.move` | 179 | Defines `WorkObject` struct with key+store. `mint()` is public — anyone (any agent or user) calls it to create a new WorkObject. Emits `WorkObjectMinted` event with id, kind, parents, owner, payment, timestamp. `record_consumption()` is `public(package)` — only callable from other Brief modules. |
| `agent_registry.move` | 157 | Agents register themselves via `register()` which creates a shared `AgentRegistration` object. Capabilities, accepts/produces object types, base price, reputation. Mutating updates require caller == registered agent_address. |
| `settlement.move` | 71 | `pay_agent_and_record()` atomic flow: split user's SUI coin, transfer to agent, call `work_object::record_consumption()` on parent, bump agent reputation, emit `PaymentSettled` event. |
| `lineage.move` | 62 | Read-only helpers. `direct_parents()` returns a copy of `parent_objects`. `build_manifest()` packages a flattened ancestor list for archival. |

All four are deployed at the published package ID. Source compiles
clean with `sui move build` — zero warnings.

### 3.2 Agent runtimes — `agents/`

Each agent is an independent Node + TypeScript process. They share a
small library and talk only through on-chain events.

**Shared library** (`agents/lib/`):
| File | Purpose |
|---|---|
| `env.ts` | Loads + validates `.env.local`. `loadEnv()` returns `{ packageId, network, rpcUrl, agentSecretKey, anthropicApiKey }`. |
| `sui.ts` | `makeAgentContext(env)` constructs a `SuiJsonRpcClient` and `Ed25519Keypair`. |
| `cursor.ts` | `loadCursor` / `saveCursor` persist `{ txDigest, eventSeq }` to a JSON file per agent for restart-safe resume. |
| `event-poll.ts` | `startEventPoll({ ctx, acceptsKind, cursorPath, pollMs, onEvent })`. **Fast-forwards cursor to the current head on first start** so backlog events don't cause gas-coin races. Polls `queryEvents` for `WorkObjectMinted` and filters by kind. |
| `work-object.ts` | `buildMintTx()` builds a PTB calling `work_object::mint`. `fetchWorkObject()` reads an object's fields. `readWorkObjectPayload()` returns bytes from inline OR transparently fetches from Walrus aggregator (with retry/backoff for blob propagation). `encodePayload` / `decodePayload` JSON ↔ bytes. |
| `walrus.ts` | `uploadToWalrus()` uses `@mysten/walrus` with the `upload-relay.testnet.walrus.space` endpoint. `walrusEnabled()` reads `BRIEF_USE_WALRUS`. |
| `llm.ts` | `callLlm()` thin wrapper around Anthropic Messages API. `llmMode()` returns `mock` or `anthropic` based on env + key presence. |
| `mock.ts` | Hardcoded schema-valid JSON for Research and Strategy when `BRIEF_LLM_MODE=mock`. Lets the pipeline run without an API key. |

**ResearchAgent** (`agents/research/index.ts`, 130 LOC):
1. Polls for `Query` events.
2. Reads the Query payload (always inline; Queries are small).
3. Calls Anthropic Haiku (or returns mock) to produce a 5-protocol research blob with `top_pick`.
4. If `BRIEF_USE_WALRUS=true`, uploads the full payload to Walrus (~20 s), captures the blob ID.
5. Mints a `Research` WorkObject parented to the Query, with `walrus_blob_id` set or inline payload.

**StrategyAgent** (`agents/strategy/index.ts`, 130 LOC):
Same shape as Research but consumes `Research` events and emits
`Strategy`. Uses Anthropic Sonnet for higher-quality reasoning. The
output includes `guardian_warnings` typed entries (slippage,
concentration, stale_pool) — these are the risk surfacing the Intent
Engine sub-track requires.

**ExecutionAgent** (`agents/execution/`):
The most complex agent. Has two execution paths:

| Path | File | What it does |
|---|---|---|
| Simulated | `simulated.ts` | Builds a 1-MIST self-transfer so the receipt anchors to a real on-chain TX. Fills are computed from the intent operations. Default mode. |
| DeepBook | `deepbook.ts` | Real PTB: `depositIntoManager` 0.1 SUI + `placeMarketOrder` 0.05 SUI on SUI_DBUSDC, sell side. Fills extracted from `balanceChanges` in the tx result. Blocked on the pool's 1-SUI min — code-complete, needs more wallet SUI to actually fill. |

Index (`agents/execution/index.ts`, ~160 LOC):
1. **Polls for `Confirmation` events** (not `Strategy` — this is the
   explicit-confirmation gate).
2. On Confirmation, fetches the parent Strategy (via Walrus if needed).
3. Builds the execution TX in the selected mode (`BRIEF_EXECUTION_MODE`).
4. Executes and parses fills.
5. Uploads the receipt to Walrus if enabled.
6. Mints `Execution` parented to **both Strategy and Confirmation** so
   judges see the dual-lineage in the graph.

### 3.3 Frontend — `src/`

Next.js 14 App Router. All pages build clean to static or dynamic
prerender. Walrus aggregator URL points to
`aggregator.walrus-testnet.walrus.space`.

| Route | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Landing. Hero with thesis + "Try Brief" CTA → `/app`. "How Brief works" 3-step. "Why Sui" 4-card grid. **"Agentic Web · Intent Engine sub-track" matrix** showing each must-have and the proof. Live status pill links to package on Explorer. |
| `/app` | `src/app/app/page.tsx` | Wallet-gated composer. Connect Sui wallet → type intent → "Brief it" mints Query. Chains render as fade-up cards. **Guardian panel renders when Strategy exists; "Confirm execution" button mints a Confirmation.** Pending placeholders pulse-glow while agents work. |
| `/lineage/[id]` | `src/app/lineage/[id]/page.tsx` | SVG graph view. Kind-colored nodes, bezier-curved parent edges, Walrus badge per node, click-to-Explorer. Walks both parents and descendants from any entry point. |

| Component | File | Purpose |
|---|---|---|
| `SuiProvider` | `src/components/sui-provider.tsx` | Client wrapper. `SuiClientProvider` + `WalletProvider` + `QueryClientProvider`. Hard-coded networks: testnet + mainnet. Auto-connect on. |
| `WorkObjectCard` | `src/components/work-object-card.tsx` | Reusable card for any WorkObject kind. Animated fade-up on mount. Walrus link if blob set. **`PayloadPreview` auto-links every 0x-prefixed object id and base58 tx digest in the JSON to Sui Explorer.** |
| `GuardianPanel` | `src/components/guardian-panel.tsx` | Renders risk warnings + "Confirm execution" button. Reads strategy payload inline OR via Walrus fallback. Severity colors (info / amber / red) match the sub-track must-have. |

| Helpers | File | Purpose |
|---|---|---|
| `src/lib/work-object.ts` | `buildMintQueryTx`, `buildMintConfirmationTx`, `fetchWorkObject`, `fetchWalrusPayload`, `walrusBlobUrl` |
| `src/lib/brief-client.ts` | `useOwnedWorkObjects(owner)` polling hook (refetch every 2.5 s). `useWorkObject(id)` for the lineage page. `explorerUrl()` for txblock or object links. |

### 3.4 Operator scripts — `scripts/`

| Script | What it does |
|---|---|
| `dispatch-query.ts` | Mints a Query WorkObject from the agent wallet. `npm run dispatch "<topic>"`. |
| `confirm-strategy.ts` | CLI version of clicking "Confirm execution" — mints a Confirmation parented to a Strategy. `tsx --env-file=.env.local scripts/confirm-strategy.ts <strategy-id>`. |
| `walk-lineage.ts` | BFS over `parent_objects` from any node. Prints the chain. `npm run lineage <object-id>`. |
| `probe-deepbook.ts` | Day-6 probe. Creates a BalanceManager. Verifies DeepBookClient wiring. |
| `probe-deepbook-execute.ts` | Standalone deposit + market-order test. Shows the SDK reaches `validate_inputs` before pool-min abort. |
| `probe-pool-params.ts` | Inspects every testnet pool's lotSize / minSize / tickSize / midPrice. Used to debug the 1-SUI minimum. |
| `probe-all-pools.ts` | Same as above but compact. |
| `probe-walrus.ts` | Day-17 probe. Uploads + retrieves a 10 KB blob via the upload-relay endpoint. |

---

## 4. How the end-to-end flow works

### 4.1 User dispatches a Query

User opens `/app`, connects Sui wallet, types intent, clicks "Brief it".

**Frontend** (`src/lib/work-object.ts` → `buildMintQueryTx`):
```ts
tx.moveCall({
  target: `${packageId}::work_object::mint`,
  arguments: [
    tx.pure.address(owner),
    tx.pure.string("Query"),
    tx.pure.u64(1n),                       // schema version
    tx.pure.vector("u8", [...payload]),    // {topic: "..."} as JSON bytes
    tx.pure.option("string", null),        // no walrus blob
    tx.pure.vector("id", []),              // no parents (root)
    tx.pure.u64(0n),                       // 0 payment (user-minted)
  ],
});
```

User signs in their wallet extension. TX executes. A
`WorkObjectMinted` event is emitted with `object_type: "Query"`.

### 4.2 ResearchAgent picks it up

ResearchAgent's `event-poll.ts` is polling every 3 s for any
`WorkObjectMinted` event after its cursor. It filters by
`acceptsKind === "Query"`, sees the new one, and calls its `onEvent`
handler.

The handler (`agents/research/index.ts`):
1. Fetches the Query object's payload bytes via `fetchWorkObject` + `readWorkObjectPayload`.
2. Decodes `{ topic: string }`.
3. Calls `callLlm` (Anthropic Haiku) or returns `mockResearchJson(topic)` based on `BRIEF_LLM_MODE`.
4. Builds the Research payload object.
5. If `BRIEF_USE_WALRUS=true`, uploads the payload bytes to Walrus via the relay (~20 s), gets `blobId`.
6. Builds a mint TX via `buildMintTx` with:
   - `kind: "Research"`
   - `parents: [queryId]`
   - `payload: empty` (when Walrus) or full bytes (when inline)
   - `walrusBlobId: blobId` or null
   - `paymentAmount: 500_000_000` MIST (0.5 SUI symbolic fee)
7. Signs with the agent's keypair and submits.
8. Cursor advances past this event so it won't re-process.

### 4.3 StrategyAgent picks up the Research

Same pattern. Filters by `acceptsKind === "Research"`. Reads payload —
this time the payload is on Walrus, so `readWorkObjectPayload` does the
HTTP GET against `aggregator.walrus-testnet.walrus.space/v1/blobs/...`
with backoff retry (Walrus blobs take a few seconds to propagate after
upload).

Then Anthropic Sonnet (or mock) produces a strategy with
`guardian_warnings`. Same upload path. Mints `Strategy` parented to
the Research.

### 4.4 User confirms in the GuardianPanel

**Frontend** sees the new Strategy WorkObject via `useOwnedWorkObjects`
polling and renders a card + the GuardianPanel below it.

The GuardianPanel reads the Strategy payload (Walrus or inline) and
renders:
- Projected 30-day yield
- Number of operations
- Each guardian_warning as a severity-colored row
- "Confirm execution" button

User clicks the button. Frontend calls `buildMintConfirmationTx` and
`useSignAndExecuteTransaction` — wallet prompts, user signs, a
Confirmation WorkObject is minted parented to the Strategy.

### 4.5 ExecutionAgent picks up the Confirmation

ExecutionAgent's event filter is `acceptsKind === "Confirmation"`.
This is the **explicit confirmation gate** — without a Confirmation,
Execution never fires.

Handler:
1. Fetches the Confirmation (inline, small).
2. Gets `parentIds[0]` — that's the Strategy id.
3. Fetches the Strategy payload (Walrus → bytes).
4. Decodes the strategy.
5. Builds the execution TX:
   - **Simulated:** `buildSimulatedExecutionTx` returns `{ tx, fills }`. The tx is a tiny self-transfer.
   - **DeepBook:** `buildDeepBookExecutionTx` returns just `tx`. It contains `depositIntoManager` + `placeMarketOrder`. Fills are extracted post-execution from `balanceChanges`.
6. Executes the PTB. Captures `ptbDigest` and gas usage.
7. Builds an ExecutionReceipt payload with `parent_strategy_id`, `mode`, `ptb_digest`, `fills`, `gas_used`, `pool` (if deepbook).
8. Uploads to Walrus if enabled.
9. Mints `Execution` with `parents: [strategyId, confirmationId]` — dual lineage so the graph view shows both inputs.

### 4.6 User sees the lineage

User clicks "show lineage" → `/lineage/<query-id>`. The page walks
parents+descendants and renders the SVG graph.

---

## 5. What every file in the repo does

```
/Users/macbookair/projects/myowncompany/brief/
├── README.md                        Project overview, run instructions
├── STATE.md                         (this file) Comprehensive state
├── SESSION-STATUS.md                What changed in the latest session
├── SUBMISSION.md                    Ready to paste into overflow.sui.io
├── DEMO-SCRIPT.md                   90-second teleprompter for the demo video
├── DEPLOY.md                        GitHub + Vercel + custom domain steps
├── .env.local                       Wallet key, package id, mode flags (gitignored)
├── .env.local.example               Template — what env vars to set
├── .gitignore                       node_modules, .next, .env.local, .cursors, etc.
├── package.json                     Deps + 11 npm scripts
├── package-lock.json
├── tsconfig.json                    Next.js TS config (excludes agents/scripts/move)
├── tsconfig.agents.json             Type-checks agents/ and scripts/ separately
├── next.config.mjs                  reactStrictMode: true, nothing exotic
├── postcss.config.mjs               Tailwind + autoprefixer
├── tailwind.config.ts               Brand palette + fadeUp/pulseGlow keyframes
│
├── move/
│   ├── Move.toml                    [package] edition 2024.beta · [addresses] brief = 0xfa3a…d084
│   ├── Move.lock                    Locked dep tree
│   ├── Published.toml               Auto-generated post-publish
│   ├── README.md                    Move-package-specific notes
│   ├── sources/
│   │   ├── work_object.move         179 LOC — core WorkObject type
│   │   ├── agent_registry.move      157 LOC — shared agent catalog
│   │   ├── settlement.move          71 LOC — atomic pay + record
│   │   └── lineage.move             62 LOC — read-only graph helpers
│   └── tests/                       (empty; tests TBD)
│
├── agents/
│   ├── README.md                    Agent runtime pattern doc
│   ├── lib/                         7 shared modules (env, sui, cursor, event-poll, work-object, walrus, llm, mock)
│   ├── research/index.ts            130 LOC — Query → Research
│   ├── strategy/index.ts            130 LOC — Research → Strategy with warnings
│   └── execution/
│       ├── index.ts                 ~160 LOC — Confirmation → Execution
│       ├── simulated.ts             45 LOC — tiny self-transfer anchor
│       └── deepbook.ts              ~110 LOC — real DeepBook PTB (code-ready, balance-blocked)
│
├── scripts/
│   ├── dispatch-query.ts            Mint a Query from CLI
│   ├── confirm-strategy.ts          Mint a Confirmation from CLI (testing)
│   ├── walk-lineage.ts              BFS over an object's parent chain
│   ├── probe-deepbook.ts            Day-6 probe — create BalanceManager
│   ├── probe-deepbook-execute.ts    Standalone deposit+order test
│   ├── probe-pool-params.ts         Inspect SUI_DBUSDC pool config
│   ├── probe-all-pools.ts           All testnet pools' min/lot/tick/mid
│   └── probe-walrus.ts              Day-17 probe — upload + retrieve a blob
│
└── src/
    ├── app/
    │   ├── globals.css              Tailwind + smooth-scroll + reduced-motion
    │   ├── layout.tsx               Inter + JetBrains Mono · OG metadata · SuiProvider wrap
    │   ├── page.tsx                 Landing — Hero · How · Why Sui · Sub-track · Footer
    │   ├── app/
    │   │   └── page.tsx             /app — composer + chain renderer + guardian + confirm
    │   └── lineage/[id]/
    │       └── page.tsx             /lineage/[id] — SVG graph view
    ├── components/
    │   ├── sui-provider.tsx         dApp Kit providers (client-only)
    │   ├── work-object-card.tsx     Reusable card + PayloadPreview with auto-explorer-links
    │   └── guardian-panel.tsx       Strategy warnings panel + Confirm button
    └── lib/
        ├── work-object.ts           Frontend WorkObject helpers + Walrus fetch
        └── brief-client.ts          Polling hooks (useOwnedWorkObjects, useWorkObject)
```

---

## 6. Status — implemented vs pending

### Implemented and verified on testnet

| Item | Verified by |
|---|---|
| Move package compiles + publishes | `sui move build` EXIT 0; published tx `2t4ibVEf…` |
| WorkObject mint works | First Query at `0x44ad99ef…d22a`, event emitted |
| `parent_objects` tracking | walk-lineage prints correct ancestry |
| ResearchAgent end-to-end | Multiple ResearchObjects on chain |
| StrategyAgent end-to-end + warnings | Multiple StrategyObjects on chain with `guardian_warnings` |
| ExecutionAgent (simulated mode) | Multiple ExecutionReceipts with real PTB digests |
| Walrus upload + retrieve | 6+ blobs visible on aggregator; bytes match round-trip |
| Walrus aggregator URL | `aggregator.walrus-testnet.walrus.space` resolves + serves blobs |
| DeepBook BalanceManager creation | TX `C4Q15vpS…` on chain |
| DeepBook deposit + market-order PTB code | Standalone probe reaches `validate_inputs` (auth, gas, deposit all succeed) |
| Confirmation flow | 5-node chain `0xa119d939… → … → 0x1cc038331c…` with Confirmation gate |
| Lineage SVG graph | `/lineage/[id]` renders with bezier edges + kind colors |
| Frontend build | `npm run build` EXIT 0, 4 routes |
| Agent typecheck | `tsc --noEmit -p tsconfig.agents.json` EXIT 0 |

### Implemented in code, pending live verification

| Item | What's blocking |
|---|---|
| DeepBook live SUI/DBUSDC market order | Wallet has 0.75 SUI; pool's minSize is 1.0 SUI. Top up to 2+ SUI to enable. |
| Anthropic real-LLM mode | Need `ANTHROPIC_API_KEY` in `.env.local`. Mock mode works in the meantime. |
| Frontend confirm button → real signature | Verified via CLI (`confirm-strategy.ts`). Browser flow uses identical TX shape. |

### Pending — needs user action

| Item | Action |
|---|---|
| Push to GitHub | `git add . && git commit && git push` (see `DEPLOY.md`) |
| Deploy to Vercel | `vercel link && vercel --prod` (see `DEPLOY.md`) |
| Custom domain | Buy + DNS to Vercel (see `DEPLOY.md`) |
| Demo video | Record per `DEMO-SCRIPT.md` |
| Submission | Paste `SUBMISSION.md` sections into overflow.sui.io |
| X launch | Tweet per `DEPLOY.md` §6 |

### Intentionally deferred (out of scope for hackathon)

- Per-agent keypairs (Day-11 hardening) — agents currently share the user's wallet
- Sponsored gas via Sui Gas Pool — dropped per locked plan
- Mainnet deploy — testnet only for submission
- Move unit tests — `sui move build` clean is the gate
- Agent reliability hardening beyond cursor persistence — 3 agents, single wallet, OK for demo

---

## 7. How to run locally

### One-time setup

```bash
cd /Users/macbookair/projects/myowncompany/brief
npm install --legacy-peer-deps
cp .env.local.example .env.local        # then fill in: package id (already set), keypair, anthropic key
```

The wallet keypair is already in `.env.local`. The package id is
already set. Only `ANTHROPIC_API_KEY` is missing (and optional).

### Verify everything builds

```bash
npm run build                            # Next.js production build
npm run typecheck:agents                 # tsc --noEmit on agents/ + scripts/
npm run move:build                       # sui move build
```

All three should EXIT 0.

### Run the dev server

```bash
npm run dev
# Open http://localhost:3000
# Open http://localhost:3000/app to use the wallet
```

### Run the agents

In a separate terminal:

```bash
npm run agents:all
# concurrently launches research + strategy + execution
# They poll testnet every 3 s, fast-forward cursor on first start
```

### Dispatch a Query from CLI (smoke test)

```bash
npm run dispatch "I have 1000 SUI. Where for 30-day yield, low risk?"
# Outputs:
#   Query minted. tx=...
#   Query object id: 0x...
#   Explorer: https://suiexplorer.com/object/0x...?network=testnet
```

Watch the agents log progress. After ~70 s with Walrus enabled, the
Strategy mint should appear in the log. Then run:

```bash
npm run confirm-strategy <strategy-id>     # Or click "Confirm execution" in /app
```

ExecutionAgent picks it up and mints the receipt.

### Walk the lineage

```bash
npm run lineage <any-workobject-id>
# Prints the chain
```

---

## 8. Environment variables

All in `.env.local` (gitignored). See `.env.local.example` for the template.

| Var | Required | What |
|---|---|---|
| `NEXT_PUBLIC_BRIEF_PACKAGE_ID` | yes | The published Move package. Set to `0xfa3a152a…d084`. |
| `NEXT_PUBLIC_SUI_NETWORK` | yes | `testnet` or `mainnet`. Currently `testnet`. |
| `NEXT_PUBLIC_SUI_RPC_URL` | no | Override the default RPC. Defaults to mysten fullnode. |
| `AGENT_SECRET_KEY` | yes | Bech32 secret key (`suiprivkey1…`). Already set to the `strange-jasper` wallet. |
| `ANTHROPIC_API_KEY` | for `BRIEF_LLM_MODE=anthropic` | Get from console.anthropic.com. |
| `BRIEF_LLM_MODE` | no | `mock` or `anthropic`. Defaults to anthropic if key set, else mock. Currently `mock`. |
| `BRIEF_USE_WALRUS` | no | `true` or `false`. `true` makes agents upload payloads to Walrus. Currently `true`. |
| `BRIEF_EXECUTION_MODE` | no | `simulated` or `deepbook`. Currently `simulated`. |
| `BRIEF_BALANCE_MANAGER_ID` | for deepbook mode | Set to `0x1d9495d4…4771`. |

---

## 9. Known issues + workarounds

| Issue | Workaround |
|---|---|
| Sui testnet HTTP faucet 429s indefinitely after the first trigger from a given IP | Use the Web UI at faucet.sui.io from a different IP, or `walrus get-wal --context testnet` for WAL specifically. |
| `aggregator.testnet.walrus.space` returns DNS NXDOMAIN | Use `aggregator.walrus-testnet.walrus.space` instead. Already fixed in code. |
| Walrus blob takes ~30 s to propagate to aggregator after upload | `readWorkObjectPayload` has built-in retry with exponential backoff (0, 2, 4, 6, 8, 12 s). Eventually succeeds. |
| All 3 agents sharing one wallet causes gas-coin version conflicts on concurrent mints | `event-poll.ts` fast-forwards the cursor to event-stream head on first start, so backlog events don't trigger races. New chains process serially (Research → Strategy → Execution one at a time). |
| DeepBook `placeMarketOrder` aborts on `validate_inputs` code 1 | Pool's `minSize: 1` means 1.0 SUI minimum order. Wallet currently has 0.75 SUI. Top up to 2+ SUI to fill. |
| Google Fonts fetch failed in dev server | Next.js falls back to system font. Cosmetic only. Resolves once network is healthy. |

---

## 10. Plan progress

Locked plan: `/Users/macbookair/.claude/plans/warm-hugging-bengio.md`

| Week | Plan days | Status |
|---|---|---|
| Week 1 | Foundation (1-7) | All landed |
| Week 2 | Composition (8-14) | All landed |
| Week 3 | Frontend (15-21) | Days 15-20 landed; Day 21 buffer used |
| Week 4 | Walrus + polish (22-28) | Days 22-25 landed; Day 26 stretch skipped; 27-28 pending (cross-browser + dry-run video) |
| Week 5 | Demo + submission (29-33) | Pending — user actions |

**~22 of 33 plan days complete.** The product is functionally
submission-ready. Remaining items are user-facing: record demo video,
deploy, push to GitHub, submit to overflow.sui.io, launch on X.

---

## 11. Verification cheat sheet

Quick proof points for judges, in increasing depth:

| Proof | Where to look |
|---|---|
| Package is live | https://suiexplorer.com/object/0xfa3a152aff2aba3886bf0fb41328e72da5ccd637074d4673c36b1924c850d084?network=testnet |
| Modules deployed | Same page → "Modules" tab → see work_object, agent_registry, settlement, lineage |
| WorkObjects exist | https://suiexplorer.com/object/0x1cc038331c7f9af2b8b667df4e84a0230e35d1a9c7e1eec1dba54be1d91df75f?network=testnet → "Object Data" → kind = Execution, parents = [Strategy, Confirmation] |
| Walrus storage works | `curl https://aggregator.walrus-testnet.walrus.space/v1/blobs/X45mwBvuup132zwhk2U1rZo_UpWYzQKC_Nk_7VzC8GU \| jq` → real Research payload |
| DeepBook integration | https://suiexplorer.com/object/0x1d9495d48e2de6f86068c7fbde6defe528e196b6e7a4305b90fe454f3d244771?network=testnet → BalanceManager owned by deployer |
| Code is wired right | `npm run build` + `npm run typecheck:agents` + `npm run move:build` all EXIT 0 |
| End-to-end flow | `npm run agents:all` in one terminal, `npm run dispatch "test"` in another, watch chain on Explorer |

---

That's the full picture. Anything else you need to know is in
`SESSION-STATUS.md` (latest changes), `SUBMISSION.md` (the writeup),
`DEMO-SCRIPT.md` (the video plan), or `DEPLOY.md` (the launch plan).
