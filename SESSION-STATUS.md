# Brief — Session status (2026-05-21 even later)

## NEW this session — Day-26 branching demo + structured WorkObject views

✅ **Day-26 STRETCH landed: 2nd StrategyAgent (aggressive variant).** `agents/strategy-alt/index.ts` consumes the SAME Research as the conservative `strategy/index.ts`, but weights 80/20 to highest-APY usable protocols instead of 60/30/10 across audited ones. Both agents poll the same `WorkObjectMinted::Research` event stream and produce sibling StrategyObjects parented to the same Research id.

✅ **`/app` now renders both strategies side-by-side** with per-strategy "Confirm conservative" / "Confirm aggressive" buttons. Whichever the user confirms, that strategy's Confirmation is minted parented to it; the other remains as the un-taken fork in the lineage graph.

✅ **Verified on-chain branch:** Research `0x6aeec45…babd98` has TWO Strategy children — `0xdae57a5d…789f` (aggressive: NAVI/Current) and `0xe990f3fe…6958` (conservative: NAVI/Current/Suilend/reserve). The SVG lineage page renders both as columns descending from the same parent — the Git-for-agents money shot.

✅ **WorkObjectCard rewritten with kind-specific structured renderers.** No more raw JSON dump per card. Now:
  - **Query** → blockquote of the intent
  - **Research** → top-pick headline + 5 mini protocol rows (name · TVL · APY · audit badge · risk pill) + reasoning + data source attribution
  - **Strategy** → stacked horizontal allocation bar + projected 30d yield + guardian-warning chips with severity colors
  - **Confirmation** → green check + "signed at HH:MM:SS"
  - **Execution** → mode badge (simulated/deepbook) + pool + PTB digest link + fills table
  - Plus a small "raw json" toggle for power users; the original auto-Explorer-linked JSON view stays as the fallback

✅ **`npm run agents:all` now spawns 4 agents** (research / strategy / strategy-alt / execution) in one command. Concurrently keeps log streams color-coded so the parallel work is visible.

---

# Brief — Session status (2026-05-21 late-night)

## What's NEW this session — agents do REAL work, no mock

✅ **DeFiLlama integration live** — `agents/lib/protocol-data.ts` fetches 43+ Sui DeFi protocols from `api.llama.fi/protocols` + cross-references `yields.llama.fi/pools`. 5-minute in-memory cache. Hardcoded snapshot fallback if DeFiLlama is unreachable so we never serve fabricated data.

✅ **ResearchAgent rewritten** — pulls live data, ranks for intent (low-risk vs aggressive vs lending vs LST), real top_pick with risk-band confidence. Template reasoning OR Claude Haiku reasoning when ANTHROPIC_API_KEY is set. Schema bumped to v2 with `data_source` + `llm_provider` fields so judges see exactly where each number came from.

✅ **StrategyAgent rewritten** — reads the Research's typed payload, allocates 60/30/10 across top audited protocols, computes real `guardian_warnings` from actual data (concentration, slippage, audit_risk, young_protocol). Projected 30-day yield calculated from real APYs. Template reasoning OR Claude Sonnet.

✅ **ExecutionAgent auto-fallback** — `BRIEF_EXECUTION_MODE=auto` (now the default). Checks BalanceManager id + live SUI balance at every confirmation. If wallet has ≥1.1 SUI → real DeepBook fills. Else simulated. Self-healing — top up the wallet later and the next cycle auto-switches with no redeploy.

✅ **Landing examples match reality** — the marketing page's "Research" / "Strategy" / "Execution" payload boxes now show the actual JSON shape with real DeFiLlama numbers (NAVI $161M @ 21.41% APY, Suilend $154M, SpringSui $64M). Judges read the landing and see the same numbers materialize in `/app` when they try it.

✅ **Verified end-to-end on testnet** — fresh Query → Research with $381M+ real TVL across 5 protocols → Strategy with allocation + real concentration warning at 60% NAVI → Confirmation → simulated Execution (auto-picked because wallet has 0.705 SUI < 1.1 min).

---

# Brief — Session status (2026-05-20 late-night)

Read this first when you come back.

---

## TL;DR — major milestones since last update

✅ **Full DeepBook execution wired in code** — agents/execution/deepbook.ts builds real deposit + market-order PTBs. Standalone probe runs end-to-end through validate_inputs. Blocked only on SUI balance (pool min 1.0 SUI, we have 0.79). Flip BRIEF_EXECUTION_MODE=deepbook once topped up.
✅ **Explicit Confirmation flow** — Intent Engine sub-track must-have satisfied. Users sign an on-chain Confirmation WorkObject before ExecutionAgent fires. Verified end-to-end: 5-node chain Query → Research → Strategy → Confirmation → Execution.
✅ **SVG lineage graph** — `/lineage/[id]` now renders an actual graph with kind-colored nodes and bezier-curved parent edges. No more indented list.
✅ **Animation pass + Explorer auto-links** — Cards fade-up on mount, Pending placeholders pulse-glow, payload JSON auto-links object IDs and tx digests to Sui Explorer.
✅ **Landing sub-track matrix** — New `#sub-track` section with the 4 Intent Engine must-haves and the proof artifact for each. Status pill links to the live package on Explorer.
✅ **Submission docs** — `SUBMISSION.md` (paste into overflow.sui.io), `DEMO-SCRIPT.md` (90-s teleprompter), `DEPLOY.md` (Vercel + custom domain + X-launch steps).
✅ **Git initialized** — repo ready, just needs `git push origin main` to GitHub.

**~22 of 33 plan days landed.**

---

## One short action you do

**Drop in your Anthropic API key** — `.env.local` → `ANTHROPIC_API_KEY=...` → set `BRIEF_LLM_MODE=anthropic`. Everything else is live. Without the key, agents use schema-valid mock data; with it, agents produce real Claude reasoning for the demo recording.

**Optional** — claim ~2 more testnet SUI (Sui web faucet on a different IP works; mine is throttled) so you can flip `BRIEF_EXECUTION_MODE=deepbook` for real on-chain SUI/DBUSDC fills in the demo. Without that, ExecutionReceipt uses simulated mode (real PTB, no real DEX fill).

---

## The flagship Confirmation-gated chain (testnet, late 2026-05-20)

The 5-node chain that proves every Intent Engine sub-track must-have:

| Layer | Sui Object | Notes |
|---|---|---|
| Query | `0xa119d939f42bd4f0521b890f23aecf7dc15bf7dc50e72bd320b104690bcf1901` | User-typed intent, inline payload |
| Research | `0x2b507799973fa9c31ce29c0de24c021a8f8969819e76f88362fb546a1ce8b028` | Walrus blob `X45mwBvuup132zwhk2U1rZo_UpWYzQKC_Nk_7VzC8GU` |
| Strategy | `0xdb87516f48fd0d2b25103bfbe5cf040931643e805756a3dc38b804c2ccedfeb5` | Walrus blob `r-8s2TVkwcYjx42JkPQAU8ecRTU46PfDEmwsLBo--Rk` (1 amber slippage warning) |
| Confirmation | `0xd71fc0a128a21db37437562cf11318bbf8e7c3de8b3c3b7b02b5aa5e42ecdb3a` | **User explicit sign-off**, inline |
| Execution | `0x1cc038331c7f9af2b8b667df4e84a0230e35d1a9c7e1eec1dba54be1d91df75f` | Walrus blob `LoFoi-TaQK8dSVRjmQWroJ_ozbVcWaiN8G8CuoNiFGQ`, parents=[Strategy, Confirmation] |

There is also an earlier Walrus-backed chain from earlier in the day
(receipt `0x7a97b4b311…e7f9`) and several inline-mode chains from
yesterday — `/app` will show them all when you connect the wallet.

Plus infrastructure:
- **Package** `0xfa3a152a…d084`
- **DeepBook BalanceManager** `0x1d9495d4…4771`

Walk it: `npm run lineage 0x7a97b4b311c6cd38e74542837ac2d78a2421b36e0f8be980cc9b0c963d6ee7f9`

Verify a Walrus payload directly: `curl https://aggregator.walrus-testnet.walrus.space/v1/blobs/Cu_8NjbpGNgwwf-9TKji-L5CLHW4grqo_5ehVbGYZiU | jq`

Also there's an earlier inline-mode chain still on chain (0xa89f47cc…c2ac receipt) — Walrus-backed and inline-backed examples coexist. Toggle via `BRIEF_USE_WALRUS=true|false` in `.env.local`.

---

## Plan days completed today (all on testnet, not just locally)

| Plan day | Result | Verification |
|---|---|---|
| Day 3 | Move package published | Tx `2t4ibVEf…`, all 4 modules deployed |
| Day 6 | DeepBook probe GO | BalanceManager created in 1 TX |
| Day 7 | ResearchAgent v0 runs real mints | Mock mode produces valid Research schema, mints in ~3 s |
| Day 8 | StrategyAgent v0 runs real mints | Produces guardian warnings, parents the Research, mints in ~3 s |
| Day 9 | ExecutionAgent v0 runs real mints | Simulated PTB anchors the receipt with on-chain tx digest |
| Day 14 | First demo data seeded | 1 Query dispatched, full chain processed end-to-end |
| Day 17 | Walrus probe SDK-GO | WalrusClient initialized + upload attempted; only blocked on WAL tokens |

Together with last night's pure-code work (Days 1, 2, 4, 5, 10, 15-16, 18, 20):
**~14 of 33 plan days landed.**

---

## What's left

### Direct unlock when you return (~1 hour total)

1. Claim WAL → re-run `tsx --env-file=.env.local scripts/probe-walrus.ts` → confirm GO
2. Drop in `ANTHROPIC_API_KEY` → flip to `BRIEF_LLM_MODE=anthropic` → re-run `npm run dispatch "<intent>"` → real LLM output appears in chain
3. (Optional) wire DeepBook into ExecutionAgent — `BalanceManager` is already created; need to add deposit + place_market_order PTB calls and flip `BRIEF_EXECUTION_MODE=deepbook`

### Days 22-28 — Polish phase (when Walrus is GO)

- Walrus payload offload in Research + Strategy mint paths (Days 22-23)
- UI animation pass — card fade-in, lineage edges (Day 24)
- Sui Explorer deep-links everywhere (Day 25)
- Branching demo — 2nd StrategyAgent (Day 26, stretch)
- Cross-browser smoke (Day 27)
- Internal demo dry-run (Day 28)

### Days 29-33 — Demo + submission

- Record demo video (1080p, < 90 s)
- Submission writeup (7 sections — see plan)
- Vercel deploy
- X launch from `@shariqshkt` + quote-tweet from `@kyvernlabs`
- Submit to overflow.sui.io

---

## Try the live frontend now

Dev server is running. Open in browser:

- **Landing** http://localhost:3000/ — see the design and "Try Brief" CTA
- **`/app`** http://localhost:3000/app — connect Sui Wallet extension (browse with `strange-jasper`), then you should see the existing chain rendered as 4 cards. Guardian panel on the Strategy card with the slippage warning. "show lineage" link at top of the chain.
- **Lineage** http://localhost:3000/lineage/0xa89f47ccf449d1d7bc74bc307411ce80bc401dac0db5c1494ab7cf7f279fc2ac — graph view of the chain

If the dev server's not up, restart it: `cd brief && npm run dev`.

---

## What's blocked / known issues

1. **WAL acquisition is CLI-only on testnet** — there's no web faucet. Use `walrus get-wal --context testnet` (CLI is installed at `/opt/homebrew/bin/walrus`, config at `~/.config/walrus/client_config.yaml`). One run gives you 0.5 WAL.
2. **DeepBook full agent wiring** is one session of work — `BalanceManager` exists, `agents/execution/deepbook.ts` still throws. ExecutionAgent uses simulated path. Wire up next session to qualify deeper for the DeepBook track.
3. **Anthropic mock mode** is on by default until you set an API key.
4. **Three agents share one wallet** — Day-11 hardening splits them. The "fast-forward cursor to event-stream head" fix in `event-poll.ts` mitigates the gas-coin race for fresh dispatches.
5. **Walrus aggregator URL** is `aggregator.walrus-testnet.walrus.space`, not the older `aggregator.testnet.walrus.space` (the latter is dead).
6. **Walrus chain takes ~70 s** end-to-end (3 × ~20 s upload). Slow vs. inline mode but real decentralized storage.

---

## Files touched today (2026-05-20)

```
brief/
├── .env.local                         NEW — package id, secret key, BalanceManager id
├── SESSION-STATUS.md                  UPDATED (this file)
├── move/Move.toml                     UPDATED — brief = "0xfa3a152a…d084"
├── agents/lib/
│   ├── env.ts                         UPDATED — ANTHROPIC_API_KEY optional + assertLlmKey helper
│   ├── llm.ts                         UPDATED — llmMode() resolves mock/anthropic
│   └── mock.ts                        NEW — hardcoded schema-valid mock data
├── agents/research/index.ts           UPDATED — branches on llmMode
├── agents/strategy/index.ts           UPDATED — branches on llmMode
└── scripts/
    ├── probe-deepbook.ts              NEW — Day-6 probe
    └── probe-walrus.ts                NEW — Day-17 probe
```

---

## Quick verification commands

```bash
cd /Users/macbookair/projects/myowncompany/brief

# All 3 gates from last night should still be green
npm run build                            # frontend
npm run move:build                       # Move package
npx tsc --noEmit -p tsconfig.agents.json # agent TS

# Re-run the chain end-to-end
npm run dispatch "your intent here"      # mints a Query
npm run agents:all                       # runs all 3 agents in mock mode

# Walk the lineage
npm run lineage 0xa89f47ccf449d1d7bc74bc307411ce80bc401dac0db5c1494ab7cf7f279fc2ac

# Probes
npx tsx --env-file=.env.local scripts/probe-deepbook.ts
npx tsx --env-file=.env.local scripts/probe-walrus.ts
```

---

## Memory pointers for next Claude session

- Plan: `/Users/macbookair/.claude/plans/warm-hugging-bengio.md`
- Memories auto-loaded: `project_brief_*` files in
  `/Users/macbookair/.claude/projects/-Users-macbookair-projects-myowncompany-kyvern-atlas/memory/`
- This doc is the project-level checkpoint
