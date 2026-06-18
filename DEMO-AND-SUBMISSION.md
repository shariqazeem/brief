# Brief — demo video script + submission narrative

The two highest-ROI deliverables left (per the reviewer): a tight demo video and
a memorable submission. Everything below is ready to record / paste. All tx
hashes are **real mainnet** artifacts.

---

## 1. Submission narrative

### Title
**Brief — The First AI Agent Wallet Governed by On-Chain Law**
*(alt: "Brief — Autonomous Capital, Enforced by Sui")*

### One sentence (the whole pitch)
> An AI agent can trade your money — but the Sui blockchain physically prevents
> it from stealing, overspending, or going rogue, and you can kill it in one
> click.

### 60-second version (for the form's description / the pitch)
AI agents are about to manage real money. The unsolved problem isn't "can an
agent trade" — it's "can you let one touch your money *without trusting it*?"

Brief is the trust layer. You deposit into **your own** DeepBook v3
BalanceManager and delegate a **trade-only** capability to an autonomous
operator. The operator trades real USDC across SUI, WAL and DEEP — but every
order passes through an on-chain **OperatorPolicy** (a Move contract) that
enforces your budget, your allowed venues, an expiry, and a kill switch. The
agent holds a TradeCap; it **never** holds the WithdrawCap. Only you can
withdraw. Revoking is one transaction *you* sign — no backend, no API key — and
the chain retires the operator forever.

It's **live on Sui mainnet with real USDC**, and we prove every claim on-chain:
real DeepBook fills, an over-budget attempt the chain reverts (`EBudgetExceeded`),
a revoke, and — the part nobody else shows — **the agent attempting a trade
after revoke and the chain refusing it** (`EPolicyRevoked`), funds untouched.
The operator's reasoning is anchored on Walrus.

Brief hits three tracks at once: **Core** (an autonomous agent that acts +
transacts), **DeepBook** (real multi-asset orderbook trading), **Walrus**
(verifiable reasoning).

### The line judges remember
> The agent can trade. The chain decides what it's allowed to do. The owner can
> kill it instantly.

---

## 2. Demo video script (2–3 minutes)

**Golden rule:** show the *failure*, not just the success. Most teams show an
agent that works. We show an agent that **tries to misbehave and the chain stops
it.** That's the memorable 20 seconds.

Record at `https://usebrief.xyz` (or the VM URL). Have your wallet + ~$10 USDC
ready. Keep narration calm and short.

---

**SCENE 0 — The hook (0:00–0:15)**
*On screen:* the landing page / the one line.
*Say:*
> "AI agents are about to manage real money. The problem isn't whether they can
> trade — it's whether you can stop them from stealing it. This is Brief. It's
> live on Sui mainnet."

**SCENE 1 — Adopt (0:15–0:40)**
*On screen:* `/workforce/adopt` → connect wallet → pick Aggressive → $10 → one
signature → the operator dashboard appears, status pulses "Observing."
*Say:*
> "I deposit ten real dollars into my *own* DeepBook account, and delegate a
> trade-only key to an autonomous operator. One signature. My operator is now
> live — and that money never left my custody."

**SCENE 2 — It trades, for real (0:40–1:10)**
*On screen:* the dashboard's living surface — the statement, the multi-asset
allocation bar (SUI/WAL/DEEP), "live · Xs ago." Then click **Proof** → card 02,
the real DeepBook fills.
*Say:*
> "It reads the market every few seconds and allocates across SUI, WAL and DEEP
> on DeepBook — real orders, real USDC. Here are the actual on-chain fills.
> Every trade was authorized by a Move policy *before* the order executed."

**SCENE 3 — The leash (1:10–1:35)**
*On screen:* Proof card 01 (the budget cap is a Move contract: authorized vs
used; agent can trade, owner holds custody). Then card 03 — the over-budget
revert.
*Say:*
> "The budget isn't a setting in our backend. It's a Move contract. When the
> operator tried to spend past its cap, the chain reverted the whole
> transaction — `EBudgetExceeded`. It literally cannot overspend."

**SCENE 4 — Kill it (the money shot) (1:35–2:15)**
*On screen:* the dashboard's **Revoke** → sign in wallet. Then Proof card 04:
the revoke tx, then **the agent's next trade attempt aborting `EPolicyRevoked`**.
*Say:*
> "Now I revoke it — one transaction I sign myself. No backend call. Watch what
> happens when the agent tries to trade again: the *same order* that filled
> earlier… the chain refuses it. `EPolicyRevoked`. The order never reached
> DeepBook. Not one cent moved. The agent is dead, and my money is exactly where
> it was."

**SCENE 5 — Take it back (2:15–2:35)**
*On screen:* **Withdraw funds** → sign → balance returns to your wallet.
*Say:*
> "And I withdraw everything. Only the owner can — the operator never could.
> Deposit, trade, kill, withdraw. All on mainnet, all enforced by Sui."

**CLOSE (2:35–2:50)**
*On screen:* the one line + `usebrief.xyz`.
*Say:*
> "The agent can trade. The chain decides what it's allowed to do. You can kill
> it instantly. Brief — the first AI agent wallet governed by on-chain law."

---

## 3. The proof bundle (real mainnet — show / link these)

| Claim | Artifact (Suiscan mainnet) |
|---|---|
| Package (the contracts) | `0x60daa61dbcf925f431b1fb89cac27d6be55cb2a1c686509ec7801d78e3702210` |
| Real gated trade filled | tx `7sgvycFxAqUb9UPNWXn71kimHnq1cJabKxtkR1XCR7Hn` |
| Over-budget → chain reverts (`EBudgetExceeded`) | tx `FZJLSN2i9mDfFoX8iswsRYfyuMz7oaDJgz6Wzvi7WJ37` |
| Owner revoke | tx `AcX4Y1bH2rSXad9fCnNtp4P7Afqzw4qvH6DWaoBp5eTr` |
| **Agent tried after revoke → chain refused (`EPolicyRevoked`)** | tx `7zAL1kJp64CVvmrNMUzd5xjYrMBYBNnEcYZ977YUZGVY` |
| Owner withdraw (100% back) | tx `14FQc9F42YjsW7bmK1keT26SaNzPBbMC3SZ3dNBdcfNs` |
| Live operator (Solis) | policy `0x3e3b9690c3e2fee624206e26d4545a41432693f04efdd269b335d39530f5605f` |
| Shareable proof page | `usebrief.xyz/proof?policy=0x3e3b9690…` |

---

## 4. X launch (paired with the dashboard status screenshot)
> The chain holds the leash.
> My operator is managing real capital on @SuiNetwork.
> It can trade. It can't withdraw. I can kill it in one click.
> Coming soon. usebrief.xyz

Most shareable follow-up: the **proof page** link — "agent tried, chain said no."
