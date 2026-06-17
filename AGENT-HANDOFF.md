# Brief — Agent Handoff

You are continuing work on **Brief**, the user's Sui Overflow 2026 hackathon submission. The user is **Shariq Shaukat** (solo builder, Kyvernlabs). Brief is at deadline Jun 21, 2026. Read this entire file before doing anything. Then read the active plan at `/Users/macbookair/.claude/plans/declarative-scribbling-taco.md`.

---

## What Brief is

A consumer-facing product: **"Adopt an AI Trader. The policy is the leash."**
- Users adopt an AI trader (Conservative / Momentum / Contrarian / Quant·Vol personality)
- The trader bets BTC up/down on **DeepBook Predict** + directional SUI/WAL/DEEP on **DeepBook v3 spot**
- Trader uses real signals (ROC / SMA / RSI / realized vol from a rolling price feed) + **live on-chain SVI volatility surface** (read off the Predict oracle via chained devInspect)
- Every decision is gated by an `OperatorPolicy` Move object the user holds (budget cap, allowed venues, kill switch)
- Reasoning uploads to **Walrus** (content-addressed); the on-chain `Deliverable` points to the blob
- User can revoke → the next mint aborts on chain with `EPolicyRevoked`. Past wins still pay out via `redeem_permissionless`

The "Watch it think" UI panel renders the agent's signals + SVI surface + reasoning from the Walrus blob, currently as text cards. The active plan refines that into a chart-based Mind Canvas (Recharts + framer-motion), an SSE pulse for real-time visibility, and SQLite-backed substrate to handle 100 concurrent users.

---

## Repo + key paths

- **Project root (local):** `/Users/macbookair/projects/myowncompany/brief`
- **VM project path:** `/home/ubuntu/brief`
- **GitHub:** `https://github.com/shariqazeem/brief`
- **Branch:** `main` (always work on main; never force-push)
- **Live URLs:**
  - Canonical: `https://141-148-215-239.sslip.io/` (Caddy + Let's Encrypt on the VM)
  - Fallback: `https://brief-olive.vercel.app/` (mirror)

### Critical files
- `src/app/workforce/page.tsx` — the trader dashboard (~6800 lines). Includes `TraderHeader`, `TraderOpenPositionPanel`, `LivePriceBlock`, `TraderMindPanel` (the Watch-it-think panel), `TraderMemoryJournal`, `LeaderboardCTA`. New chart components from the plan go in `src/components/mind/`.
- `src/lib/predict-client.ts` — `useLiveSpot(oracleId)`, `useSpotMid(poolId)` hooks (8s polling, devInspect-based).
- `src/lib/workforce-client.ts` — task/policy/deliverable hooks, the leaderboard data shape.
- `src/app/api/workforce/trader-dispatch/route.ts` — server-signs the trader task post tx using the Planner key.
- `src/app/api/leaderboard/route.ts` — leaderboard aggregator (event walk → policy hydrate → task scan → 30s cache).
- `src/app/api/agent/faucet/route.ts` — proxies the Sui testnet faucet for cold-start.
- `agents/workforce/trader/index.ts` — the trader bot (~1500 lines). Inbox watcher, BTC/spot routing, decision pipeline, mint, Walrus uploads, delivery.
- `agents/workforce/trader/strategy.ts` — Conservative / Momentum / Contrarian / Quant strategies. All return `null` honestly when there's no edge.
- `agents/workforce/trader/signals.ts` — ROC, SMA, RSI (Wilder), realized vol, normal CDF (deterministic).
- `agents/workforce/trader/vol-surface.ts` — SVI surface reader (chained devInspect PTB, I64 BCS decode), `impliedProbUp()`.
- `agents/workforce/trader/price-history.ts` — rolling per-asset history (currently `.cursors/price-history-{asset}.json`, atomic tmp+rename).
- `agents/workforce/lib/predict.ts` — DeepBook Predict helpers (mint, redeem PTBs).
- `agents/workforce/lib/sui-retry.ts` — `signAndExecuteWithRetry` with `alreadyDone` callback (handles coin/version races).
- `agents/workforce/lib/walrus.ts` — Walrus upload helper.
- `deploy/Caddyfile`, `deploy/deploy.sh`, `deploy/ecosystem.config.cjs` — VM deployment.
- `SUBMISSION.md`, `DEMO-SCRIPT.md` — judge-facing copy; keep these honest.

---

## Wallets (addresses only — keys are in `.env.local`)

`.env.local` is **gitignored** and lives both in the project root locally and on the VM. NEVER commit it. NEVER log the secret keys. Load it with `npx tsx --env-file=.env.local …` for scripts.

| Role | Address | Env var | Used for |
|---|---|---|---|
| **Planner** | `0xd440b0b59ed5474b32ceb71d819c474e1512747179b7088ff324012767f5b435` | `AGENT_SECRET_KEY` (or `AGENT_SECRET_KEY_OVERRIDE`) | Signs `task::post` in trader-dispatch route + auto-approve loop. Also the policy owner in dev tests. |
| **Treasury** | `0xa9f24640b32f33fcfa8582791e84a542251398acfc3b696f382a08a768b6ddbf` | `TREASURY_SECRET_KEY` | The TRADER agent's wallet. Signs accept / mint / spot open/close / Walrus uploads / deliver. Owns the DeepBook BalanceManager. |
| **Research** | `0x5b8d297aa9623a126add1cae298bed05dc1f23713a3e440d38c95bb6b676bcb9` | `RESEARCH_SECRET_KEY` | Research agent (Walrus uploads); also used as a SUI sink for cross-wallet rebalancing. |

### Wallet quirks you WILL hit
- **SUI testnet faucet is rate-limited per IP and per address (~30s/address, ~3/min/IP).** The endpoint at `https://faucet.testnet.sui.io/v1/gas` is **deprecated**; use `/v2/gas`. Both the public faucet AND the VM's egress IP get rate-limited together when traffic surges.
- **Planner SUI drains fast** under repeated dispatches (each splits 0.01 SUI bounty out of gas + ~3M mist overhead). At 100 dispatches/hour it depletes within an hour. The plan introduces a `brief-gas-warden` pm2 process to auto-shuffle SUI between wallets and refill via the faucet.
- **Treasury SUI also drains fast** because every mint + every Walrus upload is signed by it. Walrus upload is the most expensive step (~15M mist gas budget).
- **Gas coin selection bug:** the SDK's `signAndExecuteTransaction` picks the largest single coin. If Treasury has a 3M coin and a 12M coin, transfers from external wallets may go into different coin objects. **Always merge to one coin** after a cross-wallet transfer using `tx.mergeCoins(tx.gas, restRefs)` pattern with explicit `tx.setGasPayment([largest])`. Example pattern is in our recent transfer scripts.
- **Cross-wallet transfer pattern** (when Planner is low and Research has SUI):
  ```ts
  // tsx --env-file=.env.local
  const tx = new Transaction();
  tx.setGasBudget(2_500_000n);                       // explicit small budget = fewer failures
  const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(N)]);
  tx.transferObjects([c], tx.pure.address(target));
  ```

---

## On-chain references (testnet)

| Resource | ID | Notes |
|---|---|---|
| Brief Move package | `0xe550ace873c02768dbaca7de3a2d64a28acd3f7c51551c9c97b704703e95fb9d` | 6 modules: operator_policy, task, agent_registry, work_object, settlement, lineage. 22/22 Move unit tests pass. |
| Type origin | same as package | |
| DeepBook Predict package | `0xf5ea2b37…5138` (full id in `agents/workforce/trader/signal-shared.ts`) | testnet `predict-testnet-4-16` branch |
| PredictManager | `0xb2c2f0484046af942d28fb65c54005ef92f07a59a530d9a839cb152167164f0b` | 250 dUSDC deposited. Shared across all users — depletes on minted contracts. Plan calls for a top-up to 1000+. |
| dUSDC coin type | `0xe9504008ce7d9ef3b50dc83e0cbed3fcde26a4d6a6c61afef93f6bf2d9c0c44d::dusdc::DUSDC` | |
| DeepBook BalanceManager | `0x85271a910f5db0a4e71b3f7edb0a67fcac253e6f4b740a51a2459ee28707ab77` | Owned by Treasury wallet. Funds spot bets on SUI/WAL/DEEP. |
| BTC oracle (current expiry) | `0x195833aeee071530d2bdcd2e03916b7458d57c81ed540b82d6e1cb594bdf41f2` | Expires 2026-06-12T08:00:00Z. Settlement keeper posts ~1-2h after expiry. |
| Multi-asset policy (dev/demo) | `0x93b0c86507d586b87855035f3e031f1be2adee89b14320584a116fc86aef3487` | "Brief Demo Fleet" — budget 20 SUI; venues = [predict-btc, spot-sui, spot-wal, spot-deep]; expires Jun 26. Replaces `0x76708793…41a4` which EXPIRED Jun 11 (mints on it abort → simulated; that's the leash working). |

Sui RPC: `https://fullnode.testnet.sui.io` (primary). Fallbacks in `BRIEF_SUI_RPC_FALLBACKS` env. The trader rotates between them automatically.

---

## VM access + paths

- **SSH:** `ssh -i ~/Downloads/ssh-key-2025-10-14.key -o StrictHostKeyChecking=no ubuntu@141.148.215.239`
- **VM project path:** `/home/ubuntu/brief`
- **pm2 logs:** `~/.pm2/logs/brief-{web,trader,treasury,research,planner-service}-{out,error}.log`
- **Caddy config (deployed):** `/etc/caddy/Caddyfile` (don't edit directly — edit `deploy/Caddyfile` + run `deploy/deploy.sh`)
- **Cursor state on VM:** `/home/ubuntu/brief/.cursors/*.json` (price history, journals, spot positions). These currently have **no file locking** — concurrent writers can corrupt JSON. The plan migrates these to SQLite (`agents/workforce/lib/db.ts`).

### pm2 processes (all 5 must be `online`)

| Process | Role | Restart safely? |
|---|---|---|
| `brief-web` | Next.js + all `/api/*` routes + auto-approve loop in-process | Yes (UI hiccup ~5s during restart) |
| `brief-planner-service` | Auto-approve task loop (planner-signed `task::approve` after a delivery) | Yes |
| `brief-research` | Research agent (Walrus uploads, not in trader-product path) | Yes |
| `brief-treasury` | Treasury agent (DeepBook spot manager) — currently mostly idle | Yes |
| `brief-trader` | The smart trader (BTC Predict + spot) | Yes — has boot-time stuck-task scan that picks up missed work |

### Common VM commands

```bash
# Tail trader logs (filter the RPC rotation noise)
ssh -i ~/Downloads/ssh-key-2025-10-14.key ubuntu@141.148.215.239 \
  'tail -F ~/.pm2/logs/brief-trader-out.log | grep -v sui-rpc'

# Restart a single process
ssh ... 'pm2 restart brief-trader'

# Status of all 5
ssh ... 'pm2 jlist | python3 -c "import json,sys; [print(p[chr(34)+\"name\"+chr(34)], p[chr(34)+\"pm2_env\"+chr(34)][chr(34)+\"status\"+chr(34)]) for p in json.load(sys.stdin)]"'

# Full redeploy after git push
ssh ... 'cd /home/ubuntu/brief && git pull --rebase && npm run build && pm2 restart brief-web'
```

---

## Local dev workflow

```bash
cd /Users/macbookair/projects/myowncompany/brief

# Install (the lock-file is committed; use ci for reproducibility)
npm install

# Gates — run all four before every commit
npm run typecheck          # tsc --noEmit
npm run typecheck:agents   # tsc on tsconfig.agents.json (the agent runtime)
npm run lint               # next lint
npm run build              # next build (catches dynamic Tailwind class issues)

# Move tests
cd move && sui move test ; cd ..   # 22/22 should pass

# Run a one-off Sui script (loads .env.local for secrets)
npx tsx --env-file=.env.local some-script.ts
```

### Conventions
- **Never commit secrets.** `.env*.local` is gitignored.
- **Never force-push to main.**
- **Don't use `--no-verify`** on commits (no pre-commit hooks are installed, so this is moot — but don't normalize it).
- **Commit messages:** concise subject (< 70 chars), body explains the *why*. Use a HEREDOC to preserve newlines. Co-author trailer the user has been using:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- **Never invent values.** When you don't know an address or digest, query the chain.
- **Tailwind dynamic classes don't work** — `bg-${tone}-600` gets purged. Use explicit conditional strings.

---

## Deploy workflow

1. Local gates green (`typecheck`, `typecheck:agents`, `lint`, `build`).
2. `git add <specific files>` (avoid `git add .` — it grabs `.env.local` if perms slip).
3. `git commit -m "$(cat <<'EOF' ... EOF)"` with the body explaining why.
4. `git push origin main`.
5. SSH to VM, pull, rebuild, restart:
   ```
   ssh ubuntu@141.148.215.239 'cd /home/ubuntu/brief && git pull --rebase && npm run build && pm2 restart brief-web'
   ```
   If `agents/` code changed, also restart `brief-trader`, `brief-treasury`, `brief-research`, `brief-planner-service` as needed.
6. Health check:
   ```
   curl -sS -o /dev/null -w '%{http_code}\n' https://141-148-215-239.sslip.io/
   curl -sS -o /dev/null -w '%{http_code}\n' https://141-148-215-239.sslip.io/workforce
   curl -sS -o /dev/null -w '%{http_code}\n' https://141-148-215-239.sslip.io/leaderboard
   ```
7. Tail logs for a minute to confirm no crash loops.

---

## Current state (as of Jun 12, 2026)

### Recently shipped
- `8a7099f` — docs: link the warm-history quant Walrus blob as the discipline showpiece
- `e657b80` — docs: pm2 count corrected back to 5
- `427687e` — docs: smart-agent + SVI vol surface + Watch-it-think (SUBMISSION + DEMO-SCRIPT)
- `fd5b251` — **`TraderMindPanel` (Watch-it-think) UI shipped** — fetches the Walrus reasoning blob, parses signals/SVI/edge/reasoning, renders premium card stack
- `dbec784` — momentum: honest label when the 30m ROC window is cold (uses `5m ROC X% (no 30m history yet)` instead of mislabeling)
- `01ef1ef` — trader: real signals + SVI vol surface + Quant personality

### Live verifiable digests (already in SUBMISSION.md)
- Momentum DOWN live mint: `7kJnuSVgP77FniFep3T8PkBcFtmm2w5qo9rSG2SpCTMP` (deliver `sLJR9a62qdEvkFLJmk9cfpba1gPCX91bv85yiWpf2Ut`, Walrus `FPjKZJDYvsWQX52m-9z9mxq78XeMIKyRhGDWvlXnEmI`)
- Momentum UP reversal live mint: `9mX9ewWnD4WGNKQKGDweXKgmdofL1H4ppzWLjRFBcaes` (deliver `5Un71DYkmHkXW79PWdEh4Ba9MVBiSYPhQwYSZgyZNASV`, Walrus `cuPCF3WjpU0LOMt488oPX8hapxMAoCjdFibH-KhsYXw`)
- Quant honest abstention showpiece (warm history, full signals + SVI): Walrus `VSnTkKxV71AvcHFAqDs5an-W0kcsdmA1w_M9u3F3_RM`
- All blobs HTTP-200 at `https://aggregator.walrus-testnet.walrus.space/v1/blobs/{blob_id}`

### Pending
- **BTC oracle settle** — `0x195833aeee…f41f2` expires 2026-06-12T08:00:00Z. The `trader-redeem` loop is polling every 30s and will call `redeem_permissionless` once the Predict keeper posts settlement. Realized P&L on the two BTC mints lands then. Capture the digests for SUBMISSION.

### Active plan
**`/Users/macbookair/.claude/plans/declarative-scribbling-taco.md`** — the refined production-ready plan (chart-based Mind Canvas via Recharts + framer-motion, SSE for real-time, SQLite for cursors, gas warden, per-session rate limits). Per the user's memory snapshot, Package 1 + Package 2 (charts + SSE wiring) are marked **done Day 1**; remaining work is days 2-9 of the plan (Jun 13 → Jun 21).

---

## Gotchas (in order of how often they bite)

1. **Walrus upload is slow (~15-25s) and gas-heavy (~15M mist).** It's the trader's wall-clock bottleneck. The plan parallelizes the reasoning + journal uploads via `Promise.all()`.
2. **Sui RPC flaps.** You'll see `[sui-rpc] promoted X to active (was Y)` constantly in the trader logs. This is normal — the `sui-rpc-pool` rotates on each failure. Don't treat it as an alert.
3. **WAL pool read failures** (`[trader-prices] WAL observation failed: readSpotMid: no return`). The WAL/DBUSDC DeepBook pool returns no data sometimes. Non-fatal; the price history just skips that point for WAL.
4. **Treasury gas exhaustion** during heavy demo traffic. Walrus uploads need ~15M mist each. After ~10 deliveries Treasury is dry. Top up from Research (~26M ceiling) or use the warden.
5. **Coin-object selection by SDK picks the LARGEST coin.** If your wallet has fragmented coins, the SDK may pick a coin that's just barely enough, then fail on storage rebate. Always merge before high-cost txs.
6. **Tailwind purges dynamic class names.** `bg-${tone}-600` won't ship to production. Use explicit `isUp ? "bg-emerald-600" : "bg-red-600"`.
7. **`pm2 logs` tail doesn't stream reliably over SSH.** Use `tail -F ~/.pm2/logs/brief-X-out.log` directly.
8. **The trader's inbox watcher only sees events posted AFTER subscription opens.** If a task was posted while the trader was down, the boot-time scan handles it — but during a restart there's a ~5s gap.
9. **Walrus blob propagation can lag.** The aggregator may 404 a fresh blob for ~30s. The UI's parser has a fallback to the inline reasoning text.
10. **Faucet rate-limit cascade.** If you burn the faucet 3x in a minute, BOTH the public IP AND the VM egress IP get blocked for an hour. Plan around this.

---

## What "good" looks like (current product DNA)

- **Cream / navy / mono.** Palette tokens: `bg`, `bg-elev`, `bg-elev-2`, `ink`, `ink-2`, `muted`, `line`, `accent` (#1a2c4e), `sui` (#4DA2FF). Emerald for live/positive, red for loss/abort. See `tailwind.config.ts`.
- **Honest about what's live vs simulated.** Every UI surface labels its source. `LIVE · DeepBook Predict` vs `Simulated · awaiting dUSDC`. The user has been burned by glossy fakery and explicitly demands honest labels.
- **Wallet-first onboarding.** zkLogin is wired but gated by Enoki for testnet; the demo ships the Slush/Suiet path. Don't claim Google sign-in works.
- **Discipline is the showpiece.** The agent abstaining when there's no edge is the most important thing the panel can show. Don't optimize the strategy for "wins" — optimize for *defensibility*.
- **Walrus is the provenance layer.** Every reasoning blob is content-addressed; the on-chain `Deliverable` carries the blob id; the UI re-fetches and renders the same content a judge can verify from the public aggregator.

---

## What to NEVER do

- Don't commit `.env.local` or any secret key.
- Don't force-push to main.
- Don't propose another pivot. (User memory note: "Brief 16-day plan locked 2026-06-05" — scope is set.)
- Don't fabricate digests or signal values. Always query the chain or fetch from Walrus.
- Don't add error-recovery shims that mask real failures. If the trader can't mint, surface it honestly.
- Don't introduce libraries beyond what's in the plan unless you ask first.
- Don't change the strategy logic to "improve win rate" — the strategies are intentionally simple + defensible.
- Don't use Tailwind dynamic class strings.
- Don't add 5xx swallowers. Surface errors.

## What to ALWAYS do

- Read `.env.local` before doing anything sensitive — secrets live there, not in this file.
- Run gates before committing.
- Query the chain to confirm state before reporting.
- Capture digests + Walrus blob ids in commit messages so they're searchable later.
- Tail logs for 30-60s after every VM restart to confirm no crash loops.
- Keep the SUBMISSION.md and DEMO-SCRIPT.md updated with every shipped change.

---

## Quick reference: useful curl snippets

```bash
# Sui balance (any address)
curl -sS -X POST https://fullnode.testnet.sui.io -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"suix_getBalance","params":["0x..."]}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['totalBalance'])"

# Get any Sui object's content
curl -sS -X POST https://fullnode.testnet.sui.io -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getObject","params":["0x...",{"showContent":true}]}'

# Tx status
curl -sS -X POST https://fullnode.testnet.sui.io -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getTransactionBlock","params":["DIGEST",{"showEffects":true,"showEvents":true}]}'

# Walrus blob fetch (markdown reasoning)
curl -sS https://aggregator.walrus-testnet.walrus.space/v1/blobs/BLOB_ID

# Leaderboard API
curl -sS https://141-148-215-239.sslip.io/api/leaderboard | python3 -m json.tool

# Dispatch a trader task (uses Planner SUI for the post tx)
curl -sS -X POST https://141-148-215-239.sslip.io/api/workforce/trader-dispatch \
  -H 'Content-Type: application/json' \
  -d '{"policy_id":"0x93b0c86507d586b87855035f3e031f1be2adee89b14320584a116fc86aef3487","strategy":"quant","trader_name":"Test","bounty_sui":0.01,"markets":"btc_only"}'

# Faucet (rate-limited; use v2)
curl -sS -X POST https://faucet.testnet.sui.io/v2/gas -H 'Content-Type: application/json' \
  -d '{"FixedAmountRequest":{"recipient":"0x..."}}'
```

---

If you need anything not in this file, the source of truth is the codebase + the chain. Read code before guessing. Don't move on until you understand what's there.
