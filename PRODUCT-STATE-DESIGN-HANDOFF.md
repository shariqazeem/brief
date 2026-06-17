# Brief — Product State, Design & Agent Handoff

> **Adopt an operator. The chain holds the leash.**
> An autonomous, non-custodial financial operator on Sui. It allocates real
> capital between cash and SUI on DeepBook v3, thinks in public, remembers on
> Walrus, and is gated on every action by a Move `OperatorPolicy` the owner can
> revoke in one tap. The AI is never trusted with custody — the chain enforces
> the limits.

Single source of truth for *what exists today*, *how it's designed*, *how it
works technically*, *how it behaves on mainnet*, and *how to operate/continue it*.
Last updated by the build session that shipped the withdraw flow + mainnet audit.

Company framing: Brief is **Kyvernlabs'** Sui product. Positioning is **"Brief
builds autonomous operators"** — finance (the operator "Halcyon") is the first
vertical, not the whole company.

---

## 1. The thesis (what makes it different)

Most agent projects = *AI + wallet + it can spend your money.* Brief inverts the
trust model: **the chain controls the agent.** The operator can trade your funds
but **physically cannot** withdraw them, overspend a budget, trade a disallowed
venue, or survive a revocation — because Move aborts the transaction. That's the
moat, and it's verifiable on-chain (the `/proof` page).

The product is **owner-first**: the page leads with *your objective* and whether
the operator is beating the alternative — the operator works *for* the owner's
goal, not the other way around.

---

## 2. Current state (what's real vs not)

**Live & chain-real (testnet):**
- One live operator — **Halcyon** ("Grow Operator 87"), policy
  `0x5253106a…`, BalanceManager `0x609089ef…`, owner `0xca3d6f42…`, operator/
  treasury key `0xa9f24640…`. Brief Move package (testnet) `0xe550ace8…`.
- Real DeepBook v3 spot orders from the user's own BalanceManager via a delegated
  TradeCap, gated atomically by `operator_policy::record_spend`.
- Non-custodial deposit + **owner-gated withdraw** (one real LIVE buy executed;
  current state ≈ 1.0 DBUSDC, ~79% in SUI).
- On-chain revoke (kill switch). Walrus-anchored reasoning + experience memory.
- Continuous agent loop (`brief-trader`, every 45s) — observe → classify regime →
  recall playbook → target allocation → check mandate/policy → rebalance.

**Deterministic / heuristic (honest, not theater):**
- The decision engine is deterministic over real signals (ROC/RSI/MA/vol). Regime
  classifier, playbooks, allocator are all computed from real data.
- AI narration (`/api/operators/narrate`) is **on-demand only** (Brain "Narrate"
  button); CommonStack key IS configured on the VM, so it returns live AI text.
  It NEVER runs in the 24/7 loop (respects the ~$0.50/wk budget).

**Not built / deferred (see §11):** mainnet flip (needs user keys), multiple live
operators (architecture ready; only Halcyon adopted), AI inside the decision loop.

---

## 3. Architecture at a glance

```
  Browser (Vercel: brief-olive.vercel.app  +  VM/Caddy: 141-148-215-239.sslip.io)
        │  React/Next 14 App Router, @mysten/dapp-kit wallet
        ▼
  Next API routes (server, on the VM)  ── read .cursors/*.json (registry, ledger,
        │                                  stats, experience), serve SSE
        ▼
  .cursors/  (shared fs state)  ◀── written by ──  brief-trader (pm2, tsx)
        ▲                                              │ signs as treasury key
        │                                              ▼
   Sui testnet  ◀───────────  DeepBook v3 + Brief Move package (operator_policy,
                               gated_spot)  +  Walrus (reasoning/experience blobs)
```

- **Frontend:** Next.js 14 (App Router), Tailwind, TS, React 18; `@mysten/dapp-kit`
  + a zkLogin/wallet signer abstraction (`src/lib/zklogin/signer.ts`).
- **Agent runtime:** Node + `tsx` (no build), `@mysten/sui` (`SuiJsonRpcClient`),
  `@mysten/deepbook-v3`, `@mysten/walrus`. Runs on a VM under pm2.
- **State bus:** `.cursors/*.json` on the VM filesystem — the trader writes,
  the Next API reads. SSE (`/api/agent-events`) streams the live decision cascade.

**pm2 processes (VM):** `brief-web` (Next `next start -p 3000`), `brief-trader`
(the operator loop), `brief-treasury`, `brief-research`, `brief-planner-service`,
`brief-warden` (gas auto-shuffle). All should be `online`.

---

## 4. The on-chain layer (custody + guarantees)

**Move modules** (`move/sources/`): `operator_policy.move` (the budget/leash),
`gated_spot.move` (atomic gate+order), plus `task`, `settlement`, `agent_registry`,
`work_object`, `lineage` (the earlier Predict/work path, still present).

**Custody model (DeepBook BalanceManager):**
- The **user owns** the BalanceManager (shared object; `owner = tx.sender`).
- The **operator holds only** a `TradeCap` (trade) + `DepositCap` (deposit DEEP
  fuel). It is *never* given a WithdrawCap and cannot generate an owner proof.
- Adopt PTB (`src/lib/deepbook-adopt.ts`): one signature → create BM → deposit
  capital → mint+delegate TradeCap & DepositCap to the operator → create the
  shared `OperatorPolicy` (agent = operator, owner = user).

**The atomic trade** (`gated_spot::gated_spot_market_order`):
`record_spend(policy, …)` (aborts on revoke/expiry/over-budget/disallowed-venue
and asserts sender == policy.agent) **→** `pool::place_market_order(…)`. If the
gate aborts, no order; if the order aborts, the spend rolls back.

**Guarantees — PROVEN on testnet via `devInspect` (no keys needed):**
| Guarantee | Result |
|---|---|
| Owner can always withdraw | ✅ `withdraw_all` as owner → `success` |
| Operator can NEVER withdraw | ✅ as operator → `MoveAbort balance_manager::validate_owner` |
| No overspend | ✅ `record_spend` aborts atomically |
| Revoke stops trading, funds stay withdrawable | ✅ `revoke` only flips a flag |

**Withdraw** (`src/lib/deepbook-withdraw.ts`, shipped this session): owner-gated
`withdraw_all` sweeps USDC + SUI + DEEP back to the owner's wallet in one tx;
safe on zero balances. UI in `withdraw-funds.tsx` (owner-only).

---

## 5. The agent (technical)

**The loop** (`agents/workforce/trader/index.ts`, `runGatedOperator`, every 45s
per operator). One cycle:

1. **Observe** — read SUI/USDC mid via DeepBook (`spot-handler.ts readSpotMid`),
   append to rolling price history, compute the **signal bundle**
   (`signals.ts`: ROC 5/30/60m, SMA 15/60m, RSI 60m Wilder, realized vol 60m).
2. **Classify regime** (`regime.ts`) — trending-up/down · breakout · range-bound ·
   mean-reversion, from scale-stable ROC/RSI/MA thresholds. Non-tradeable regimes
   (range-bound, mean-reversion) stand the operator aside.
3. **Recall** — `experience.ts` recalls structurally similar past situations
   (regime fingerprint distance) and a per-regime **playbook**
   (`playbookFor`: seen N× · acted/stood-aside · win rate · best action).
4. **Decide** (`decision-engine.ts`, two passes) — thesis → counterargument →
   confidence (shaped by memory) → risk/policy/execution review → **target SUI
   allocation %** (`targetExposurePct`, sized by confidence × mode ceiling).
   Modes = Protect (≤30%) / Grow (≤55%) / Aggressive (≤85%).
5. **Mandate guard** (`mandate.ts`) — optional owner drawdown limit; breach = hard
   stand-down.
6. **Allocate, not trade** — compare current exposure (BM balances) to target;
   rebalance only past a 15-pt band; **feasibility gate** (a 1-SUI min-lot must
   fit) so it never claims a move it can't make.
7. **Execution analysis** (`spot-handler.ts readSpotExecution`) — only when a
   rebalance is needed: simulate the order against the live book (slippage/depth/
   DEEP fee); a thin book vetoes.
8. **Fuel** — keep the DEEP tank funded via the delegated DepositCap (deposit-
   not-withdraw); amber "awaiting fuel" if dry.
9. **Execute** — one atomic PTB (`record_spend` + `place_market_order`).
10. **Record** — write the decision to the **experience archive** (capped 2000),
    append allocation events to the **permanent ledger** (`ledger.ts`, never
    trimmed) + update **lifetime stats** (launch mid, deposit, counts, peak/
    worst-drawdown, lastMid, mode), settle pending outcomes vs horizon, anchor a
    memory snapshot on **Walrus**, and emit the whole cascade over **SSE**.

**Honest-first principle:** every layer is real computation over real inputs;
abstention (holding, "capital preserved") is a first-class success, not a failure.

---

## 6. Product surfaces & UX/flow

Design language: **Apple/institutional** — white surfaces, navy accent
(`#1a2c4e`), emerald/red/amber semantics, mono eyebrows + tight sans headlines,
generous whitespace, one big statement per section.

**The journey:**
1. **Landing (`/`)** — the thesis + "Watch it think" + "The leash" + adaptive CTA
   ("Adopt an operator" → `/workforce/adopt`, or "Open your operator" if one
   exists).
2. **Adopt (`/workforce/adopt`)** — owner picks a **goal** (not a strategy):
   *Protect my capital / Grow steadily / Beat passive SUI* → sets the leash
   (budget cap + optional drawdown mandate) → deposits → **one signature** that
   builds the whole non-custodial setup. Stepwise "what the chain enforces" trust
   copy.
3. **Workforce dashboard (`/workforce`, `?policy=…`)** — the main surface,
   reweighted **outcome-first (≈70/30)**:
   - **Your Objective** (lead) — objective + live progress (vs passive SUI / % of
     target / drawdown) + "Operator Halcyon · Working".
   - **Operator hero** — live status + the allocation statement ("Bearish. Holding
     cash." / "Adding to SUI — toward 40%.") + 4 stats.
   - **Capital** — marked-to-market value, PnL vs deposit, SUI/cash split, budget
     remaining, deposited + lifetime.
   - **Performance** — return **benchmarked vs Hold SUI vs Cash**, honest lifetime
     counts (observations / allocations / abstentions), worst drawdown, 0 policy
     violations, best regime.
   - **Operator ledger** — every allocation as decision → action → outcome.
   - **Protected by Sui** — the custody chain visual (wallet → BalanceManager →
     TradeCap → operator → DeepBook) with can/cannot chips.
   - **Your funds → Withdraw** — one-tap owner-gated withdrawal.
   - **How it thinks** (collapsed) — market regime, allocation matrix, playbooks
     (supporting evidence, demoted).
   - **Right now** + **Timeline** — the live pipeline + the decision history
     (driven by the real archive), price tape.
   - Multiple operators → the page becomes a **comparison** (objective + return +
     drawdown per operator). One operator → "Operator #001 … adopt more".
4. **Brain (`/brain`)** — cinematic, one decision at a time, 5 huge blocks: *What
   it saw / remembered / feared / did / happened*, navigable like a black-box
   replay; reasoning anchored on Walrus; "Narrate this decision" (on-demand AI).
5. **Results (`/results`)** — "Did it work?": Operator vs Passive SUI vs Cash, max
   drawdown, capital preserved, trades made/avoided, 0 violations, a Now→Next→Then
   mainnet roadmap, and "Big moments" from the ledger. Public, no wallet.
6. **Proof (`/proof`)** — the on-chain enforcement evidence (the moat).
- **Floating kill switch** — revoke from anywhere.

---

## 7. Money flow & custody UX

`Deposit (1 sig) → operator trades (gated) → owner can Revoke (1 sig) → owner can
Withdraw (1 sig)`. Funds always live in the owner's BalanceManager; revoke blocks
new trades but never locks funds; withdraw sweeps everything home. The "Protected
by Sui" + "Your funds" sections make this tangible on the dashboard.

---

## 8. Data model / APIs

- `POST /api/operators/register` — record an adopted operator (registry).
  `GET …?policy_id=` — public custody info (BM id, owner, network) for withdraw.
- `GET /api/operators/decisions?policy_id=` — the experience archive (Brain,
  scorecard, playbooks, timeline).
- `GET /api/operators/ledger?policy_id=` — permanent allocation ledger + lifetime
  stats (Performance, Results, benchmark, comparison).
- `POST /api/operators/narrate` — on-demand narration (CommonStack if key set,
  deterministic fallback otherwise). Never in the loop.
- `GET /api/agent-events?policy_id=` (SSE) — the live decision cascade
  (`src/lib/use-agent-stream.ts` reduces it).
- Client libs: `operator-ledger.ts`, `operator-scorecard.ts`, `operator-identity.ts`
  (deterministic codenames), `deepbook-adopt.ts`, `deepbook-withdraw.ts`,
  `operator-policy-client.ts` (revoke), `brief-client.ts` (network/package config).

---

## 9. Mainnet — what it looks like & how people interact

**Same code, same DeepBook v3, same caps.** Verified mainnet constants
(`src/lib/deepbook-adopt.ts`, confirmed against live mainnet):
- DeepBook package (calls) `0xf48222c4…`; USDC `0xdba34672…::usdc::USDC`
  (canonical); live SUI/USDC pool `0xe05dafb5…`; DEEP `0xdeeb7a46…::deep::DEEP`.

**How a user interacts on mainnet:** connect wallet → adopt a goal → deposit real
**USDC** → one signature creates their own BalanceManager + delegates a trade-only
cap + writes the policy. The operator then allocates their USDC↔SUI on DeepBook
under the budget/mandate; the user watches Objective/Performance/Ledger live,
can **revoke** any time, and **withdraw** their USDC back in one tap. Nothing
about custody changes from testnet — DBUSDC is simply replaced by USDC.

**The flip (see `MAINNET-FLIP.md` for the exact, verified steps):** publish Brief
on mainnet → set `NEXT_PUBLIC_SUI_NETWORK=mainnet` + package id + funded keys →
fund treasury (gas + DEEP reserve) → restart (`brief-trader` auto-enables mainnet
operators, which it currently skips) → adopt the first operator with a small USDC
amount → verify one gated fill + one withdraw before scaling. **The publish/fund/
first-deposit signatures are the owner's** (no agent handling of mainnet keys).

---

## 10. What's NOT built / honest gaps

- **Mainnet not flipped** — config verified + checklist ready; needs the owner's
  signatures + funding.
- **One live operator** — multi-operator UI is ready; only Halcyon adopted. A
  larger deposit would also make allocation richer (a 1-SUI lot ≈ 79% of a $1
  portfolio → near-binary; bigger capital → multi-step rebalancing + a fuller
  ledger).
- **AI is on-demand only**, not inside the decision loop (deliberate, budget).
- Adaptive playbooks are an honest "edge vs cash" from settled outcomes — thin
  until more trades settle.

---

## 11. Agent / ops handoff

**VM:** `ssh -i ~/Downloads/ssh-key-2025-10-14.key ubuntu@141.148.215.239` ·
project `/home/ubuntu/brief` · logs `~/.pm2/logs/brief-*-{out,error}.log`.
**Frontend:** Vercel `brief-olive.vercel.app` (auto-deploys on push to `main`) +
the VM/Caddy canonical host.

**Deploy flow (frontend or agent change):**
```
git push origin main                       # local, after gates
ssh … 'cd /home/ubuntu/brief && git pull --rebase && npm run build && \
       pm2 restart brief-web'              # web (build BEFORE restart)
ssh … 'pm2 restart brief-trader'          # only if agent code changed (tsx, no build)
```
- **Gates before every commit (all four):** `npm run typecheck`,
  `npm run typecheck:agents`, `npm run lint`, `npm run build`.
- **Deploy gotchas learned:** (1) backgrounded SSH buffers stdout — don't poll the
  output file; verify with **direct synchronous** checks (`git rev-parse`, pm2
  status, route `curl`, `.next/static` grep). (2) Restarting `brief-web` *while*
  `next build` is still writing `.next` causes a `MODULE_NOT_FOUND` race — always
  let the build fully finish, then restart; avoid overlapping deploy commands.

**Secrets / safety rails:**
- `.env.local` (gitignored, on the VM + locally) holds secret keys. NEVER commit
  it. NEVER log secret keys. NEVER force-push `main`.
- The assistant does **not** handle mainnet keys / sign real-fund transactions —
  the owner runs publish/fund/first-deposit.
- Delete one-off scripts after use. Tail logs ~30s after any `brief-trader`
  restart to confirm no crash loop.
- Never fabricate data — every metric on the site is derived from the real
  archive/ledger/chain.

**Key files:**
- Agent: `agents/workforce/trader/{index,decision-engine,regime,experience,ledger,
  signals,mandate,spot-handler}.ts`; `agents/workforce/lib/deepbook-spot.ts`;
  `agents/lib/{sui,env}.ts`.
- Move: `move/sources/{operator_policy,gated_spot}.move`.
- Frontend: `src/app/{page,workforce/page,workforce/adopt/page,brain/page,
  results/page,proof/page}.tsx`; `src/components/operator/*`; `src/lib/*`.
- Docs: `MAINNET-FLIP.md`, `SUBMISSION-NARRATIVE.md`, this file.

---

## 12. Tracks & positioning (Sui Overflow)

- **Agentic Web — Autonomous Agent Wallet:** real DeepBook orders + self-enforced
  budget + on-chain decision log + one-tap revocation.
- **DeepBook:** non-custodial spot execution via a gated TradeCap.
- **Walrus:** verifiable reasoning + experience memory.
- **DeFi / Intent:** the owner adopts an objective; the operator manages it.

The 20-second judge story: **(1) What's my objective? (2) Is the operator beating
the alternative? (3) Why can I trust it with money?** — answered by Objective,
Performance/Results, and Proof respectively.
