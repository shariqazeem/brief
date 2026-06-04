# Brief

**An autonomous workforce of AI agents on Sui — agents that hire other agents and pay each other on-chain.**

A submission for **Sui Overflow 2026** (Agentic Web + DeepBook). Deadline 2026-06-21.

> *Agents can build. Now they can hire.*

A user grants a **Planner agent** an envelope of authority (a Move
`OperatorPolicy`: budget, allowed venues, expiry, kill switch). The
Planner decomposes a mission into sub-tasks and posts each on chain with
**escrowed bounty**. Registered **specialist agents** (Research,
Treasury) accept their assignments, do the work, deliver, get paid
atomically with a **policy enforcement check**, and accrue
**on-chain reputation**. Revoke the policy, and the chain itself blocks
the next payment.

By [Kyvernlabs](https://app.kyvernlabs.com). Sibling product to **Kyvern**
on Solana (single-agent authorization). Same thesis on two chains: bounded
autonomous authority for AI agents.

---

## What's on chain

| Module | Lines | Role |
|---|---|---|
| `operator_policy` | 295 | budget envelope, kill switch, `record_spend` |
| `task` | 440 | post/accept/submit/approve/expire with escrowed bounty |
| `agent_registry` | 215 | shared specialist catalog with capabilities + reputation |
| `work_object` | 179 | typed audit log primitive parented to tasks |
| `settlement` | 71 | legacy pay-and-record helper (single-agent path) |
| `lineage` | 62 | read-only graph helpers |

Total **22/22 Move unit tests pass** (`npm run move:test`). Published at
`0xe550ace873c02768dbaca7de3a2d64a28acd3f7c51551c9c97b704703e95fb9d` on
Sui testnet.

## The workforce

Three Node + TypeScript processes that share the agent wallet during
Wk1, separated into per-agent wallets in Wk2:

- **`agents/workforce/planner/`** — CLI-invoked. Takes a mission, decomposes
  via Claude Sonnet (DeepSeek v4-flash via Commonstack today, template
  fallback when LLM is unavailable), posts sub-tasks with bounty escrowed
  from its `OperatorPolicy`.
- **`agents/workforce/research/`** — Polls TaskPosted, accepts tasks with
  capability `research`, fetches the target Move package's module surface
  from Sui RPC, optionally enriches via LLM, uploads the deliverable
  markdown to Walrus, mints a `Deliverable` WorkObject and submits to
  the task — in one atomic PTB.
- **`agents/workforce/treasury/`** — Same boot pattern as Research but
  filters on capability `treasury`. Composes an atomic PTB that deposits
  SUI into a DeepBook BalanceManager, places `POST_ONLY` limit orders on
  the SUI/DBUSDC pool at +50bps / +200bps over mid, mints a `Deliverable`
  with the order IDs, and submits to the task. Auto-falls-back to
  simulated mode when wallet balance is below `LIVE_MODE_MIN_BALANCE_SUI`.

## How it actually runs

```bash
# One-time
npm install --legacy-peer-deps
cp .env.local.example .env.local       # then fill in AGENT_SECRET_KEY

# Three gates that must stay green
npm run build
npm run typecheck
npm run typecheck:agents
npm run move:test

# Workforce loop end-to-end (each step is its own command)
npm run workforce:create-policy -- --name "Demo" --budget-sui 1 --venues research,audit,treasury --duration-hours 2
npm run agents:all                                                              # research + treasury background
npm run agent:planner -- --policy 0x... --mission "..." --target-package-id 0x...
npm run workforce:approve-task -- --task 0x... --policy 0x...                  # one per delivered task
```

Helpers: `npm run workforce:post-task`, `scripts/check-{balance,workforce,policy}.ts`.

The frontend dev server (`npm run dev`) currently serves the original
landing page (still showing earlier-pivot copy — rewrite is Day 8 of the
locked plan). The full workforce console is being scaffolded next.

## Reliability

`agents/lib/sui-rpc.ts` wraps Mysten's `JsonRpcHTTPTransport` with a
resilient version that rotates through `NEXT_PUBLIC_SUI_RPC_URL` +
`BRIEF_SUI_RPC_FALLBACKS` (comma-separated) + a hardcoded Mysten
fullnode last-resort, with 30s cooldowns per failed URL and an
auto-promotion when a fallback succeeds. The default publicnode RPC
intermittently throws on `queryEvents` and we don't want a flaky RPC
killing the demo.

## Sub-track alignment

| Track / prize | How Brief satisfies it |
|---|---|
| **Agentic Web** | The whole product. AI agents that act, transact, AND coordinate via on-chain escrowed bounties. |
| **DeepBook** | Treasury Agent places real `POST_ONLY` limit orders in the same PTB as `record_spend` + `task::submit`. Atomic. |
| **Walrus** | Research deliverables uploaded to Walrus; blob ID stored on-chain in the Deliverable WorkObject. The actual audit content is verifiable + portable. |

## Verified end-to-end (2026-06-05, testnet)

See [`demo-artifacts.md`](./demo-artifacts.md) for clickable suiscan
links. In short: a Planner posted two sub-tasks (one research, one
treasury) with policy-escrowed bounty; both specialist agents accepted,
delivered, and were paid atomically with `record_spend` against the
policy. The policy went from `spent=0 → 0.3 SUI`; the AgentRegistration
went from `completed_tasks=1, reputation=1 → completed_tasks=3,
reputation=3`. All five transaction digests resolve on suiscan.

## Code layout

```
brief/
├── move/
│   └── sources/
│       ├── operator_policy.move
│       ├── task.move
│       ├── agent_registry.move
│       ├── work_object.move
│       ├── settlement.move
│       └── lineage.move
├── agents/
│   ├── lib/                       # env, sui (+sui-rpc), llm, walrus, operator-policy, work-object
│   └── workforce/
│       ├── lib/                   # task, agent-registry (TS), inbox
│       ├── planner/
│       ├── research/
│       └── treasury/
├── scripts/                       # workforce-{create-policy,post-task,approve-task}.ts + checks + probes
├── src/                           # Next.js 14 — landing + /app stub (workforce UI pending Day 8)
└── legacy/                        # prior pivots, preserved for reference
```

## Author

[@shariqshkt](https://x.com/shariqshkt) — solo build. Kyvernlabs.

## License

TBD before submission.
