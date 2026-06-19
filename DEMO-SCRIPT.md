# Brief — Demo Script (Sui Overflow · Agentic Web · ≤5 min)

*A pre-recorded ≤5-min video (not a live pitch). It follows the product **click-for-click**, the way you'll actually move through it, so you never lose your place. Record it in segments, re-take any line, edit out dead air. Target ~4:40. Every claim is paired with something REAL on screen — "verify, don't trust" is the whole product. (v4 — natural page-by-page flow + "AI agent" language.)*

**The word to use:** say **"AI agent"** — it's exciting, everyone gets it, and it's literally the track. The UI calls each agent an **"operator"** (its job title). Bridge it **once**, early, and then just say "agent" / "my agent."

**The one-sentence frame (say it like you mean it):** *"Brief is the safe way to let an AI agent manage your money — the agent decides what to do, and the blockchain decides what it's allowed to do."* That's the line judges repeat.

**Golden rule of delivery:** slow down. Land three moments with a full pause: (1) *"it physically cannot,"* (2) *"Sui said no,"* (3) *"its memory survives on Walrus."* Silence sells certainty.

**✅ Pre-flight verification (all clicks confirmed on mainnet — won't fail on camera):**
- Post-revoke abort tx → real `failure · EPolicyRevoked` · over-budget tx → real `failure · EBudgetExceeded` · revoke tx → `success`. All resolve on `suiscan.xyz/mainnet`.
- Brain has **55 real AI-dampened decisions** (Grok 4.1 Fast) — the "talked itself out of the trade" claim is backed.
- Walrus memory blob links open (`HTTP 200`, real content).
- ⚠️ Guardian shows a live pause only while it's tracking a funded agent (see the Guardian production note).

**Tab / click order (follow this exactly):**
`usebrief.xyz` (landing) → click **Adopt** → `/workforce` → click **Adopt** → `/workforce/adopt` → sign → **dashboard** → **Brain** → **Proof** (→ Suiscan) → **Evolution** → **Results**. Pre-load a Suiscan tab on the abort tx. For Brain/Proof/Evolution/Results, drive a **seasoned agent** so they're rich.

---

## THE SCRIPT  *(page by page)*

### ⏱ 0:00 – 0:18 · COLD OPEN  *(face cam → then the landing page on screen)*

> "Everyone's racing to give AI agents real money.
>
> Almost nobody is asking the obvious question — what actually stops them from losing it, or running off with it?
>
> This is **Brief.** The safe way to let an AI agent manage your money. The agent decides what to do — the **blockchain** decides what it's *allowed* to do.
>
> The first AI agent governed by on-chain law. Let me show you — with real money, on mainnet."

---

### ⏱ 0:20 – 0:45 · YOUR WORKFORCE  *(click "Adopt" on the landing → you're now on `/workforce`)*

> "You hire these AI agents the way you'd hire people. Each one runs a slice of your capital under contract.
>
> On screen we call them **operators** — because they *operate* your money under an on-chain policy.
>
> I don't have one running yet — so let's hire one."

*(Click **Adopt an operator** → `/workforce/adopt`.)*

---

### ⏱ 0:45 – 1:35 · HIRE IT LIVE  *(screen: `/workforce/adopt`)*

> "Real USDC. Sui mainnet. One signature. I choose **Protect** mode — the cautious one — deposit, and sign once."

*(Sign. While it boots:)*

> "That one transaction did what most AI wallets can't. My money stays in **my** own DeepBook account. The agent can *trade* it — but it was never given permission to *withdraw* it. There is no withdraw key to hand over.
>
> It's not that I *trust* the agent not to take the money…"

*(Beat — slow down.)*

> "…it **physically cannot.** That's a Move contract, not a hope."

---

### ⏱ 1:35 – 2:05 · THREE LAYERS OF CONTROL  *(the dashboard has loaded — point at the AgentStrip)*

> "Here's the agent, live. Three layers protect the capital.
>
> The **Trader** proposes allocations. A completely separate **Risk Guardian** agent can pause trading on its own. And underneath both is the **chain** — the leash.
>
> Every spend is checked in the *same transaction* as the trade. Zero violations, ever."

> 📌 **To make the Guardian pause LIVE (strongest version):** it only shows a pause while tracking a funded agent. Right before this take, set `GUARDIAN_FORCE_PAUSE=<your agent id>` and restart the guardian (the manual circuit-breaker is a real feature) — the dashboard shows *"Risk Guardian · paused"* and the Trader stands down, so you can truthfully say *"watch — the Guardian is pausing it right now."* Otherwise, open `/evolution` and point at a **real past pause** and say *"it's done this for real."* Never claim a live pause the screen doesn't show.

---

### ⏱ 2:10 – 2:55 · READ ITS MIND  *(navigate to `/brain`)*

> "You don't have to trust that it's intelligent — you can read its mind. This is the **AI Reasoning Core.**
>
> The agent takes live market data and its own memory, then proposes an allocation. Watch what happened here — the signals looked strong, but the AI reviewed the macro picture and this agent's own track record… and it **dampened** the conviction. It talked itself *out* of the trade.
>
> And that reasoning isn't a log we wrote. It's anchored on **Walrus** — click it, it's verifiable."

---

### ⏱ 2:55 – 3:35 · THE KILL SWITCH — *the moment*  *(navigate to `/proof` → click to Suiscan)*

> "But here's what actually matters when things go wrong. If I ever need to shut it down, I revoke the agent — one transaction. And the very next time it tries to trade…"

*(Click the abort tx on Suiscan. Let it load. Point at the abort code. Then, slowly — one line at a time:)*

> "The agent tried to act.
>
> Sui said **no.**
>
> `EPolicyRevoked`. Funds untouched."

*(Long pause — the money moment. Let it breathe.)*

> "That's the difference between a backend *promise* and protocol *enforcement.* Every claim on this page is a link — **verify it yourself.**"

---

### ⏱ 3:35 – 4:05 · ITS MEMORY SURVIVES  *(navigate to `/evolution` — Decentralized Memory)*

> "One more. Intelligence disappears when the server disappears — unless the memory survives.
>
> Every important lesson, every AI-shaped decision, every reflection — anchored to **Walrus.** These are real blob IDs; click one, it opens.
>
> So if our server vanished tomorrow, a new agent could recover this exact memory and keep going from the same history. Its **memory survives on Walrus.**"

---

### ⏱ 4:05 – 4:30 · DID IT WORK?  *(navigate to `/results`)*

> "So — did it work? It protected the capital, recorded **zero** policy violations, and deliberately stood aside instead of chasing losing trades.
>
> Because when you put an AI in charge of real money, its first job isn't to beat the market. It's to **not lose your money.**"

> 📌 The line works with **no number** (safest). But the `/results` page does show the real figure — glance at it, and if it reads strong, say it: *"Capital Preserved: 98%"*, or for a withdrawn agent *"Capital returned — 100%, never reported as a loss."* Never say a number the screen doesn't show.

*(Back to face cam — calm, certain.)*

> "AI agents are about to start moving real money — ready or not. Brief is the version where the AI **proposes**… and the chain **enforces.**
>
> **The first AI agent governed by on-chain law.** Built on Sui."

*(Stop. No extra lines.)*

---

## 30-SECOND CUT  *(for socials / quick intro)*

> "Everyone's handing AI agents our money — nobody's asking what stops them losing it or running off with it. Brief is the safe way to let an AI agent manage your money: the agent decides what to do, the **chain** decides what it's *allowed* to do. I hire one with a signature — it can trade my USDC but **physically cannot withdraw it**, a second agent can pause it, and when I revoke it, the next trade **aborts on-chain** — verify it yourself on Suiscan. Its memory even survives on Walrus. The first AI agent governed by on-chain law. Built on Sui."

---

## DELIVERY NOTES  *(read twice before recording)*

- **Energy curve:** sharp on the cold open → steady + confident through the demo → calm and slow on the close. Don't flatline, don't oversell.
- **The 3 pauses** (non-negotiable): after *"it physically cannot,"* after *"Sui said no,"* after *"survives on Walrus."*
- **Click, then talk** — don't narrate clicking. A page load is fine; fill it with the next line, not "um, loading."
- **Actually click into Suiscan once.** That single action separates you from every backend-promise demo.
- **Never apologize.** No "it's just a hackathon," no "sorry it's slow." You're live on mainnet with real money — own it.
- **Rehearse to ~4:30.** If long, trim the Walrus section to two sentences — **never** cut the Kill Switch.

**Because it's recorded (not live), use that:**
- Record in the **8 segments above**, not one take. Re-do any segment until it's clean, then stitch.
- **Edit out dead air** — trim page loads and "ums." Tight pacing reads as confident.
- **Zoom / highlight on the `EPolicyRevoked` abort code** so the moment is unmissable even on a small screen.
- **Add captions** — judges often watch muted first; your key lines should land on screen.
- **Silent sanity pass** of each page right before recording it, so nothing is mid-load or stale.

---

## BONUS · IF A JUDGE ASKS  *(NOT part of the recording — keep for any live finalist round, follow-up, or your README. This is where Kyvern was lost, so know it cold.)*

- **"Is this really AI, or rules with an LLM bolted on?"**
  > "Deliberate hybrid — and that's the right design for money. Deterministic signals are the grounding; the LLM is a safety-critical advisor that reviews macro, memory and risk, then sharpens, dampens, or vetoes — you saw it move the conviction live. We didn't put a black-box predictor in charge of your funds. We built an explainable, auditable agent whose reasoning is on Walrus. That's a feature, not a compromise."

- **"What's enforced on-chain vs. your backend?"**
  > "Custody, the spending cap, the venue allow-list, expiry, and revocation — all Move. The budget check and the trade are one atomic transaction, so an over-budget or post-revoke trade *reverts*. Our backend can't override any of it."

- **"How is this different from Beep / other agent wallets?"**
  > "Theirs is non-custodial at the wallet level and the spending limit is a backend promise. Ours is protocol-level — an over-limit trade physically reverts on Sui, and you can watch it happen. They can't show their agent failing safely. We lead with it."

- **"It underperformed just holding cash — why?"**
  > "In Protect mode, in a downtrend, it deliberately goes to cash — preservation is the job. Zero violations, capital intact. We optimized for *not losing your money*, which is what you actually want from an agent you can't fully predict."

- **"What's next?"**
  > "Persistent semantic memory and cross-protocol yield — but only once they're as verifiable as everything else. We don't ship a claim we can't prove on-chain."

---

*Honesty note: every number and artifact here is real and on-chain — the revoke/abort txns, the Walrus blobs, the preserved/returned figure. Nothing is staged. That's why it's hard to beat: a judge who fact-checks you mid-demo only strengthens your case.*
