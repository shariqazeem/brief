# Brief — Product State, Design & Agent Handoff

> **Adopt an operator. The chain holds the leash.**
> An autonomous financial operator on Sui that *cannot steal your funds, cannot
> exceed its budget, and can be fired with one transaction.* It allocates real
> capital between cash and SUI on DeepBook v3, thinks in public, remembers on
> Walrus, learns over time, and is gated on every action by a Move
> `OperatorPolicy` the owner can revoke instantly. The AI is never trusted with
> custody — the chain enforces the limits.

Single source of truth for *what exists*, *how it's designed*, *how it works
technically*, *how it behaves on mainnet*, and *how to operate/continue it*.
Updated through: Evolution pillar, public leaderboard, "The Leash" hero,
above-the-fold proof, withdraw flow, and the mainnet `pay_with_deep` change.

**Positioning (authoritative):** Brief is **the first platform where autonomous
agents are controlled by on-chain law.** **Halcyon** is the first operator;
finance is the proof, not the whole company. Brief is **Kyvernlabs'** Sui
product. Four pillars: **Objective · Trust · Proof · Evolution.**

---

## 1. The thesis (why it's different)

Most agent projects = *AI + wallet + it can spend your money.* Brief inverts the
trust model: **the chain controls the agent.** It can trade your funds but
physically cannot withdraw them, overspend a budget, trade a disallowed venue,
or survive a revocation — Move aborts the transaction. That's the moat, and it's
verifiable on `/proof`. The product is **owner-first**: every page leads with
*your objective* and whether the operator is beating the alternative.

The 20-second judge story: **(1) What's my objective? (2) Is it beating the
alternative? (3) Why can I trust it with money?** — answered by Objective,
Performance/Results, and Proof.

---

## 2. Current state (real vs not)

**Live & chain-real (testnet):**
- Live operator **Halcyon** ("Grow Operator 87") — policy `0x5253106a…`,
  BalanceManager `0x609089ef…`, owner `0xca3d6f42…`, operator/treasury key
  `0xa9f24640…`. Brief Move package (testnet) `0xe550ace8…`.
- Real DeepBook v3 spot orders from the user's own BM via a delegated TradeCap,
  gated atomically by `operator_policy::record_spend`. One real LIVE buy executed
  (tx `E3u4uWTmig…`).
- `brief-trader` runs continuously (~every 45s); **800+ real decisions**, stable
  for hours, no crash loop, abstaining/allocating cleanly.
- Non-custodial deposit + **owner-gated withdraw** (UI shipped). On-chain revoke.
  Walrus reasoning + experience memory. SSE live cascade.

**Deterministic / honest (not theater):** the decision engine, regime
classifier, playbooks, allocator, evolution, scorecard, benchmarks are all real
computation over real signals/outcomes. AI narration is **on-demand only**
(Brain "Narrate" button; CommonStack key configured) — never in the 24/7 loop
(respects ~$0.50/wk).

**Not yet:** mainnet flip (needs owner keys/funds), a *real signed* withdraw
(devInspect-proven; do one in the UI before mainnet), multiple live operators
(architecture ready), AI inside the decision loop (deliberately out).

---

## 3. Architecture

```
 Browser — Vercel (brief-olive.vercel.app)  +  VM/Caddy (141-148-215-239.sslip.io)
   │  Next 14 App Router · Tailwind · @mysten/dapp-kit / zkLogin signer
   │  (Vercel sets NEXT_PUBLIC_API_BASE_URL → the VM, so API calls hit the VM)
   ▼
 Next API routes (on the VM) ── read .cursors/*.json (registry, ledger, stats,
   │                             experience) · serve SSE · query chain
   ▼
 .cursors/ (shared fs)  ◀── written by ──  brief-trader (pm2, tsx, treasury key)
   ▲                                           │
   │                                           ▼
 Sui testnet ◀── DeepBook v3 + Brief Move (operator_policy, gated_spot) + Walrus
```

**pm2 (VM):** `brief-web` (`next start -p 3000`), `brief-trader` (the operator
loop), `brief-treasury`, `brief-research`, `brief-planner-service`,
`brief-warden` (gas auto-shuffle). All should be `online`.

---

## 4. On-chain layer (custody + guarantees)

**Move** (`move/sources/`): `operator_policy.move` (budget/leash + revoke),
`gated_spot.move` (atomic gate + DeepBook order).

**Custody (DeepBook BalanceManager):** the **user owns** the BM (shared object,
`owner = tx.sender`); the **operator holds only** a `TradeCap` (+ `DepositCap`
for DEEP fuel on testnet) — never a WithdrawCap, and cannot generate an owner
proof. Adopt is one signature (`src/lib/deepbook-adopt.ts`): create BM → deposit
→ delegate caps → create shared OperatorPolicy.

**Atomic trade** (`gated_spot_market_order`): `record_spend` (aborts on
revoke/expiry/over-budget/disallowed-venue, asserts sender == agent) → DeepBook
`place_market_order`. Gate aborts → no order; order aborts → spend rolls back.

**Guarantees — PROVEN on testnet (devInspect, no keys):**
| Guarantee | Result |
|---|---|
| Owner can always withdraw | ✅ `withdraw_all` as owner → `success` |
| Operator can NEVER withdraw | ✅ as operator → `MoveAbort balance_manager::validate_owner` |
| No overspend | ✅ `record_spend` aborts atomically |
| Revoke stops trading, funds stay withdrawable | ✅ `revoke` only flips a flag |

**Withdraw** (`src/lib/deepbook-withdraw.ts` + `withdraw-funds.tsx`): owner-gated
`withdraw_all` sweeps USDC + SUI + DEEP to the owner in one tx; safe on zero
balances; the card self-checks ownership and renders even in the shared
`?policy=` view (owner-only, no-op for anyone else).

---

## 5. The agent (technical) — one 45s cycle

`agents/workforce/trader/index.ts` `runGatedOperator`:
1. **Observe** — DeepBook mid (`spot-handler.readSpotMid`) + signal bundle
   (`signals.ts`: ROC 5/30/60m, SMA 15/60m, RSI 60m, realized vol 60m).
2. **Classify regime** (`regime.ts`) — trending-up/down · breakout · range-bound ·
   mean-reversion; non-tradeable regimes stand aside.
3. **Recall** (`experience.ts`) — similar past situations + per-regime
   **playbook** (`playbookFor`: seen N× · acted/stood-aside · win rate · best play).
4. **Decide** (`decision-engine.ts`, 2 passes) — thesis → counter → confidence
   (shaped by memory) → risk/policy/exec review → **target SUI allocation %**
   (`targetExposurePct`, sized by confidence × mode ceiling: Protect ≤30 / Grow
   ≤55 / Aggressive ≤85).
5. **Mandate guard** (`mandate.ts`) — optional owner drawdown limit (hard stop).
6. **Allocate, not trade** — compare current exposure (BM balances) vs target;
   rebalance only past a 15-pt band; **feasibility gate** (a 1-SUI min-lot must
   fit) so it never claims a move it can't make.
7. **Execution analysis** (`spot-handler.readSpotExecution`) — when rebalancing,
   simulate vs the live book (slippage/depth/fee); thin book vetoes.
8. **Fuel (testnet only)** — keep the DEEP tank topped via DepositCap. **On
   mainnet the order pays its fee from the traded asset (`pay_with_deep=false`),
   so the operator needs NO DEEP** and never idles on fuel.
9. **Execute** — one atomic PTB (`record_spend` + `place_market_order`).
10. **Record** — experience archive (capped 2000) + **permanent ledger**
    (`ledger.ts`, allocation events never trimmed) + **lifetime stats** (launchMid,
    deposit, decisions/buys/sells, peak/worst-drawdown, lastMid, mode) + settle
    outcomes vs horizon + Walrus snapshot + SSE cascade.

Honest-first: abstention ("capital preserved") is a first-class success.

---

## 6. Product surfaces & UX/flow

Design language: **Apple/institutional** — white surfaces, navy `#1a2c4e`,
warm gold `#C49A2C` (the operator), emerald/red/amber semantics, mono eyebrows +
tight sans headlines, generous whitespace, one statement per section. Restraint
is the brand.

1. **Landing (`/`)** — **"The Leash" hero**: a warm-gold autonomous particle
   wanders inside a thin grey boundary that resists at the edge — never escapes,
   never stops (canvas, reduced-motion safe, no glow). The thesis before a word.
   Below: subline ("cannot steal / cannot exceed / can be fired"); **above-the-
   fold proof strip** (operators · decisions · managed · 0 policy violations · 0
   custody incidents, live from `/api/network/proof`); "Watch it think" live
   cascade; "The leash" 3-step; a closing **platform/mainnet** section ("the
   first platform where autonomous agents are controlled by on-chain law" +
   **Join mainnet access**).
2. **Adopt (`/workforce/adopt`)** — pick a **goal** (Protect my capital / Grow
   steadily / Beat passive SUI) → set the leash (budget cap + optional drawdown
   mandate) → deposit → **one signature**.
3. **Workforce dashboard (`/workforce?policy=…`)** — outcome-first order:
   **Your Objective** (progress vs benchmark / target / drawdown + "Operator
   Halcyon · Working") → **Capital** (mark-to-market + SUI/cash split) →
   **Performance** (return **vs Hold SUI vs Cash** + lifetime observations/
   allocations/abstentions + worst drawdown + 0 violations) → **Operator Ledger**
   (decision→action→outcome) → **Protected by Sui** (custody-chain visual) →
   **Your funds → Withdraw** (owner-gated) → **How it thinks** (collapsed: regime,
   allocation matrix, playbooks) → **Right now** (live pipeline) → **Timeline**.
   Top bar: Brain · Evolution · Results · Proof · Revoke. Multiple operators →
   comparison; one → "Operator #001 … adopt more".
4. **Brain (`/brain`)** — cinematic 5-block replay: *What it saw / remembered /
   feared / did / happened*, navigable; "Narrate this decision" (on-demand AI).
5. **Evolution (`/evolution`)** — **Pillar 4**: lessons learned, the single most
   valuable lesson, and a day-by-day growth timeline — all from the real archive
   (`operator-evolution.ts`). Makes it feel *alive*.
6. **Results (`/results`)** — "Did it work?": the comparison is the hero —
   *"What would have happened if you'd done nothing?"* Operator vs Held SUI vs
   Did-nothing; max drawdown; capital preserved; trades made/avoided; 0
   violations; a Now→Next→Then mainnet roadmap; "Big moments" from the ledger.
   Public, no wallet.
7. **Leaderboard (`/leaderboard`)** — "The operator workforce" network view:
   real on-chain operators, codename identity; one today, a network tomorrow.
8. **Proof (`/proof`)** — the on-chain enforcement evidence (the moat).
- Floating kill switch — revoke from anywhere.

---

## 7. Money flow & custody UX

`Deposit (1 sig) → operator allocates (gated) → Revoke (1 sig) → Withdraw (1 sig)`.
Funds always live in the owner's BM; revoke blocks new trades, never locks funds;
withdraw sweeps everything home. Made tangible by "Protected by Sui" + "Your
funds" on the dashboard.

---

## 8. Data model / APIs

- `POST /api/operators/register` (record an operator) · `GET …?policy_id=`
  (public custody info for withdraw: bm_id, owner, network).
- `GET /api/operators/decisions?policy_id=` — experience archive (Brain,
  scorecard, playbooks, timeline, evolution).
- `GET /api/operators/ledger?policy_id=` — permanent allocation ledger + lifetime
  stats (Performance, Results, benchmark, comparison, evolution).
- `GET /api/operators/proof?policy_id=` — per-operator on-chain proof (policy,
  PolicySpend/PolicyRevoked events, Walrus manifesto) for `/proof`.
- `GET /api/network/proof` — aggregate trust strip (operators, decisions, under
  management, 0 violations, 0 custody) for the homepage.
- `POST /api/operators/narrate` — on-demand narration (CommonStack if key set,
  deterministic fallback). Never in the loop.
- `GET /api/agent-events` (SSE) — live decision cascade (`use-agent-stream.ts`).
- `GET /api/leaderboard` — on-chain operator enumeration + P&L.
- Client libs: `operator-ledger.ts`, `operator-scorecard.ts`,
  `operator-evolution.ts`, `operator-identity.ts` (codenames),
  `deepbook-adopt.ts`, `deepbook-withdraw.ts`, `operator-policy-client.ts`
  (revoke), `brief-client.ts`, `api-base.ts`.

---

## 9. Mainnet — how it looks & how people interact

**Same code, same DeepBook v3, same caps; DBUSDC → USDC.** Verified vs live
mainnet (`src/lib/deepbook-adopt.ts`): DeepBook pkg `0xf48222c4…`; USDC
`0xdba34672…::usdc::USDC` (canonical); live SUI/USDC pool `0xe05dafb5…`.

**Onboarding is two tokens only** (we set `pay_with_deep=false` on mainnet → the
fee comes from the traded asset, so **no DEEP needed**):
- **USDC** — operator capital, **~$20–25** (start small; ≥$20 so a 1‑SUI lot
  isn't the whole portfolio → real multi-step allocation).
- **SUI** — gas, **~4–5** (one-time Move publish ~2–3 + ongoing ~1–2).

**User journey on mainnet:** connect → pick goal → deposit USDC → one signature
builds their own BM + delegates a trade-only cap + writes the policy → operator
allocates under the budget/mandate → owner watches Objective/Performance/
Evolution/Results live → **revoke** any time → **withdraw** USDC in one tap.
Custody is identical to testnet.

**The flip (owner-signed; see `MAINNET-FLIP.md`):** publish Brief on mainnet →
set `NEXT_PUBLIC_SUI_NETWORK=mainnet` + package id + funded keys → fund treasury
(SUI gas) → restart (`brief-trader` auto-enables mainnet operators) → adopt
Operator #001 with ~$20 USDC → verify one gated fill + one withdraw, then scale.
**The assistant does not sign mainnet publish/fund/first-deposit — those are the
owner's.**

---

## 10. What's done / what's next

**Done:** the product. Decision engine → regime → playbook → allocator;
Objective/Performance/Ledger/Evolution/Results/Proof/Leaderboard; non-custodial
deposit + withdraw + revoke (proven); Walrus memory; The Leash hero +
above-the-fold proof; mainnet config verified + no-DEEP onboarding.

**Next (go-to-market, mostly owner-driven — STOP building features):**
1. One real **testnet withdraw** in the UI (validates the signed path).
2. **Mainnet flip** + Operator #001 (~$20) → one trade + one withdraw.
3. **Brief X** account (`@briefonchain`/`@briefagents`; bio: "Autonomous
   operators that work for you. The chain holds the leash. Built on Sui.").
4. **Demo video** (0–180s: what is it → why trust it → watch it think → watch it
   trade → watch me revoke → why Sui; script in `SUBMISSION-NARRATIVE.md`).
5. **3–5 real operators** → "N operators · $X managed · 0 violations" screenshot.
6. Submit.

**Do NOT add:** chat/copilot, token, governance, marketplace, social, agent
swarm, mobile, AI-in-the-decision-loop. Restraint is the brand.

---

## 11. Agent / ops handoff

**VM:** `ssh -i ~/Downloads/ssh-key-2025-10-14.key ubuntu@141.148.215.239` ·
project `/home/ubuntu/brief` · logs `~/.pm2/logs/brief-*-{out,error}.log`.
**Frontend:** Vercel `brief-olive.vercel.app` (auto-deploys on push to `main`;
its `NEXT_PUBLIC_API_BASE_URL` → the VM) + the VM/Caddy canonical host.

**Deploy flow:**
```
git push origin main                         # after all four gates
ssh … 'cd /home/ubuntu/brief && git pull --rebase && npm run build && pm2 restart brief-web'
ssh … 'pm2 restart brief-trader'             # only if agent code changed (tsx, no build)
```
- **Gates before every commit:** `npm run typecheck`, `npm run typecheck:agents`,
  `npm run lint`, `npm run build`.
- **Deploy gotchas (learned the hard way):**
  1. Backgrounded SSH buffers stdout — don't poll the output file; verify with
     **direct synchronous** checks (`git rev-parse`, pm2 status, route `curl`,
     `.next/static` grep).
  2. On a loaded VM, `next build` can take ~7 min **and** the deploy chain's
     `pm2 restart` step sometimes drops (SSH exit 255), leaving `brief-web` on the
     OLD bundle. **Always finish with a manual `pm2 restart brief-web` once `ps`
     shows no `next build`**, then verify HEAD + uptime<30s + routes 200.
  3. New routes (e.g. `/evolution`) 404 until `brief-web` restarts (Next registers
     routes at boot).
  4. The assistant's own repeated SSH checks add to VM load — check sparingly.

**Secrets / safety rails:** `.env.local` (gitignored, on VM + local) holds secret
keys — NEVER commit/log them, NEVER force-push `main`. The assistant does **not**
handle mainnet keys / sign real-fund txs. Delete one-off scripts after use. Tail
trader logs ~30s after a restart. **Never fabricate data** — every metric is
derived from the real archive/ledger/chain.

**Key files:** Agent `agents/workforce/trader/{index,decision-engine,regime,
experience,ledger,signals,mandate,spot-handler}.ts`,
`agents/workforce/lib/deepbook-spot.ts`, `agents/lib/{sui,env}.ts`. Move
`move/sources/{operator_policy,gated_spot}.move`. Frontend
`src/app/{page,workforce/page,workforce/adopt/page,brain/page,evolution/page,
results/page,leaderboard/page,proof/page}.tsx`, `src/components/operator/*`,
`src/lib/*`, `src/app/api/**`. Docs `MAINNET-FLIP.md`, `SUBMISSION-NARRATIVE.md`,
this file.

---

## 12. Tracks (Sui Overflow)

- **Agentic Web — Autonomous Agent Wallet:** real DeepBook orders + self-enforced
  budget + on-chain decision log + one-tap revocation.
- **DeepBook:** non-custodial spot execution via a gated TradeCap.
- **Walrus:** verifiable reasoning + experience memory.
- **DeFi / Intent:** the owner adopts an objective; the operator manages it.

The strongest version isn't "look how much we built" — it's *"we figured out how
autonomous agents can safely manage real money."*
