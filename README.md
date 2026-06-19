# Brief

**Adopt an autonomous AI capital operator. The chain holds the leash.**

The first AI agent wallet governed by on-chain law. A user deposits their own USDC, adopts one AI operator (Protect / Grow / Aggressive), and it manages that capital on Sui's DeepBook v3 (SUI / WAL / DEEP) — autonomously and non-custodially. It can trade but can **never withdraw**, **never exceed** its budget, and can be **revoked in one transaction**. Every guarantee is a Move contract, not a backend setting. An AI decides; the blockchain decides what it's *allowed* to do.

**Live on Sui mainnet** · package `0x60daa61dbcf925f431b1fb89cac27d6be55cb2a1c686509ec7801d78e3702210` · [usebrief.xyz](https://usebrief.xyz)

> 📄 **Full documentation:** see **[BRIEF.md](./BRIEF.md)** — the complete, audited, honest reference: state, on-chain architecture, how the operator + the two agents work, how the three modes behave, where the AI/intelligence is load-bearing, and what every page (Dashboard / Brain / Evolution / Results / Proof / Leaderboard) shows.

## The four pillars
- **Sovereignty** — the owner always controls withdrawal.
- **Enforcement** — the rules live in Move (`operator_policy::record_spend`), not a database.
- **Intelligence** — two coordinating agents, LLM-guided (Grok 4.1 Fast), with real memory.
- **Verifiability** — every meaningful action is provable on Sui or Walrus (`/proof`, `/brain`).

## Stack
- **Move:** `move/sources/` (`operator_policy.move`, `gated_spot.move`)
- **Agents (Node/TS via tsx, pm2):** `agents/workforce/trader` (15s decision loop), `agents/workforce/guardian` (risk circuit-breaker), `agents/lib` (LLM, Walrus, Sui)
- **Web (Next.js 14 App Router):** `src/app`, `src/components`, `src/lib`
- **AI:** Grok 4.1 Fast (non-reasoning) via CommonStack — `DEFAULT_AI_MODEL` in `agents/lib/llm.ts`

## Local
```bash
npm install
npm run dev          # web (reads .env.local)
npx tsc --noEmit     # typecheck (CI gate; build skips in-build typecheck)
```

## Deploy (VM, Brief-only, Caddy → usebrief.xyz)
```bash
git reset --hard origin/main
rm -rf .next          # REQUIRED — Next caches stale API routes otherwise
NODE_OPTIONS=--max-old-space-size=1536 npm run build
pm2 restart brief-web brief-trader --update-env
```

*Hackathon: Sui Overflow — Agentic Web track. Brief is the Sui product of Kyvernlabs.*
