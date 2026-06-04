# Brief

**Composable work objects for autonomous agents.**
Sui Overflow 2026 submission. Track: Agentic Web → Intent Engine.
Submission deadline: **2026-06-21**.

> Agents shouldn't just transact — they should compose.
> Brief makes agent work into owned, transferable objects on Sui.

**For status read [`SESSION-STATUS.md`](./SESSION-STATUS.md) first** — it tracks what's built locally vs. what's blocked on testnet gas.

## What this repository contains

| Path | Stack | State (2026-05-19 EOD) |
|---|---|---|
| `/` (Next.js app) | Next.js 14, TypeScript, Tailwind | Landing + `/app` + `/lineage/[id]` all build clean |
| `move/` | Sui Move 2024.beta, 4 modules | All bodies implemented; `sui move build` exits 0; publish blocked on faucet |
| `agents/` | Node.js + tsx, 3 agents + shared lib | All code written + type-checked; runtime blocked on published package |
| `scripts/` | tsx helpers | `dispatch-query.ts`, `walk-lineage.ts` ready; `probe-deepbook.ts` and `seed-demo-data.ts` pending |

## Run locally

```bash
# Install (root Next.js app + agents)
npm install --legacy-peer-deps

# Dev server (landing + /app + /lineage)
npm run dev          # http://localhost:3000

# Production build
npm run build

# Move package
npm run move:build
npm run move:test       # (when tests written)
npm run move:publish    # needs gas — Day 3 of locked plan

# Agents (after package published + .env.local set up)
npm run dispatch "your intent here"     # mints a Query
npm run agents:all                       # run all 3 agents together
npm run lineage <object-id>              # walk the lineage of an object

# Type-check the agent + script TS
npm run typecheck:agents
```

Copy `.env.local.example` to `.env.local` and fill in the required vars
before running agents or scripts.

## Day-by-day plan (locked, do not expand without re-decision)

| Week | Focus | End-of-week proof |
|---|---|---|
| Week 1 — May 14-20 | `work_object` Move module + ResearchAgent | A ResearchObject visible on Sui testnet explorer |
| Week 2 — May 21-27 | Strategy + Execution Move modules + agents | Full Research→Strategy→Execution chain end-to-end from CLI |
| Week 3 — May 28-Jun 3 | Frontend `/app`, `/lineage/:id`, landing polish | A user can complete the demo in browser |
| Week 4 — Jun 4-10 | Walrus integration + polish + branching demo | Submission video recordable |
| Week 5 — Jun 11-17 | Demo video, writeup, docs, X launch | Submitted with 3-day buffer |
| Jun 20-21 | Buffer + submission | Submit + launch |

The full plan is the document the user pasted in conversation on 2026-05-19.
That document is the source of truth for scope.

## Brand

- Foundation cream `#f4f2ec` (same as Kyvern — sibling product, not unrelated)
- Ink **navy** `#1a2c4e` (the differentiation — legal-document feel fits "Brief")
- Single accent: Sui blue `#4DA2FF`, used only for the live status dot and on-chain confirmation glyphs
- Type: Inter (body) + JetBrains Mono (code, metadata, object IDs)
- No gradients, no shadows, no scroll animations. Type-driven.

## What this is NOT

(From the locked plan — repeated here so future-me does not drift)

- Not a generic AI agent framework
- Not an agent marketplace
- Not a coordination platform for "AI swarms"
- Not a multi-agent runtime
- Not infrastructure for agents to discover each other

The protagonists are the **work objects**, not the agents.

## Sibling project

[Kyvern](https://app.kyvernlabs.com) — single-agent authorization on Solana.
Brief is the coordination layer above single-agent infra. Same author,
different chain, complementary thesis. The submission writeup explicitly
references Kyvern in the "what we'd build next" section.
