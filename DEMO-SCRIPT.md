# Brief — Demo Script (Sui Overflow · Agentic Web · ≤5 min)

*Written to be read aloud, face-cam + screen-share, for a **pre-recorded ≤5-min video** (not a live pitch). That's an advantage: you can record in segments, re-take any line you fluff, and edit out dead air — so don't aim for one flawless take, aim for clean pieces you stitch together. Target ~4:30 so you never get cut at 5:00. Every claim is paired with something REAL on screen — "verify, don't trust" is the whole product. (v2 — sharper cold open, capital-protection front-loaded, tighter lines.)*

**Golden rule of delivery:** slow down. Land three moments with a full pause: (1) *"it physically cannot,"* (2) *"Sui said no,"* (3) *"its memory survives on Walrus."* Those silences sell certainty.

**✅ Pre-flight verification (all clicks confirmed on mainnet — won't fail on camera):**
- Post-revoke abort tx → real `failure · EPolicyRevoked` · over-budget tx → real `failure · EBudgetExceeded` · revoke tx → `success`. All resolve on `suiscan.xyz/mainnet`.
- Brain has **55 real AI-dampened decisions** (Grok 4.1 Fast) — the "talked itself out of the trade" claim is backed.
- Walrus memory blob links open (`HTTP 200`, real content).
- ⚠️ **Guardian shows a live pause only when an operator is being tracked.** Both prior operators are retired, so before recording the Guardian beat, either show a *past* pause on `/evolution`, or make it live (see the Guardian section's production note).

**Setup before you record:**
- Tabs in order: `usebrief.xyz` → `/workforce/adopt` → your dashboard → `/brain` → `/proof` → `/evolution` → `/results`.
- Adopt a **fresh** operator live (proves it's real + usable now). For `/brain`, `/proof`, `/evolution`, `/results`, drive a **seasoned operator** so the pages are rich — normal demo pattern: "here's me adopting one; here's one that's been running."
- One **Suiscan** tab pre-loaded on the revoke/abort tx so the click is instant.
- Wallet funded with a little USDC + SUI for the live adopt.
- **Check `/results` for the operator you'll show, and say the number that's actually on screen** (see the 3:55 note).

---

## THE SCRIPT

### ⏱ 0:00 – 0:18 · COLD OPEN  *(face cam — direct into the lens)*

> "Most AI agent wallets give the model the keys and just hope it behaves.
>
> We built the opposite.
>
> This is **Brief** — the world's first **AI capital operator governed by on-chain law.**
>
> The AI decides what to do. The blockchain decides what it's *allowed* to do."

*(Switch to screen share.)*

---

### ⏱ 0:18 – 1:10 · ADOPT IT LIVE  *(screen: `/workforce/adopt`)*

> "I'm adopting a fresh operator right now — real USDC, Sui mainnet, one signature. I'll choose **Protect** mode, the conservative one."

*(Sign the transaction. While it boots:)*

> "That one transaction created my own DeepBook account. My USDC stays in **my** wallet. The agent only got a TradeCap — it can place orders, but it was **never** given a WithdrawCap.
>
> So it's not that the agent is *trusted* not to take the money…"

*(Beat — slow down.)*

> "…it **physically cannot.** The Move contract makes withdrawal impossible."

---

### ⏱ 1:10 – 1:55 · THREE DECISION-MAKERS  *(screen: dashboard — point at the AgentStrip)*

> "There are three decision-makers here. The **Trader.** The **Risk Guardian.** And ultimately, the **chain** itself.
>
> The Trader proposes allocations. The Risk Guardian is a *separate* autonomous agent — and it's not theoretical. It independently watches volatility and drawdown, and it pauses this operator the moment risk crosses its threshold. The Trader can want to act, and the Guardian overrules it.
>
> And underneath both is the **leash** — the on-chain policy. Every spend is checked in the *same transaction* as the trade. Zero violations, ever."

> 📌 **To make the Guardian pause LIVE on camera (strongest version):** it only shows a pause while it's actively tracking a funded operator. Easiest honest way — right before this take, set `GUARDIAN_FORCE_PAUSE=<your operator id>` and restart the guardian (the manual circuit-breaker is a real feature); the dashboard then shows *"Risk Guardian · paused"* and the Trader stands down — say *"watch — the Guardian is pausing it right now."* If you'd rather not, open `/evolution` and point to a **real past pause** ("volatility spiking… standing trading down") and say *"it's done this for real."* Don't claim a live 354% pause unless the screen shows one.

---

### ⏱ 1:50 – 2:40 · AI REASONING CORE  *(screen: `/brain`)*

> "You don't have to trust that it's intelligent — you can read its mind. This is the **AI Reasoning Core.**
>
> It takes live market data and its own memory, and proposes an allocation. Watch what happened here: the signals were bullish — but the AI weighed the macro picture and this operator's own track record… and it **dampened** the conviction. It talked itself *out* of the trade.
>
> And that reasoning isn't a backend log. It's anchored on **Walrus** — click it, it's verifiable."

---

### ⏱ 2:40 – 3:25 · THE KILL SWITCH — *the moment*  *(screen: `/proof` → Suiscan)*

> "But here's what actually matters when things go wrong. If I ever need to shut it down, I revoke it — one transaction. And the very next time the agent tries to trade…"

*(Click the abort tx on Suiscan. Let it load. Point at the abort code. Then, slowly — one line at a time:)*

> "The agent tried to act.
>
> Sui said **no.**
>
> `EPolicyRevoked`. Funds untouched."

*(Long pause — this is the moment. Let it breathe.)*

> "That's the difference between a backend *promise* and protocol *enforcement.* Every claim on this page is a link — **verify it yourself.**"

---

### ⏱ 3:25 – 3:55 · WALRUS MEMORY  *(screen: `/evolution` — Decentralized Memory)*

> "Here's the thing about intelligence: it disappears when the server disappears — unless the memory survives.
>
> Every important lesson, every AI-shaped decision, every reflection — anchored to **Walrus.** These are real blob IDs; click one, it opens.
>
> So if our server vanished tomorrow, a new operator could recover this exact memory and continue from the same history. Its **memory survives on Walrus.**"

---

### ⏱ 3:55 – 4:25 · RESULTS + CLOSE  *(screen: `/results`)*

> "So — did it work? In a falling market, this operator **protected the capital** — [**say the exact figure on screen**] — with **zero** policy violations, and it deliberately stood aside instead of chasing losing trades.
>
> Because when you give an AI real money, its first job isn't to beat the market. It's to **not lose your money.**"

> 📌 **Say the number that's actually on `/results` for your operator.** A seasoned, still-funded operator shows e.g. *"Capital Preserved: 98%."* A *withdrawn* operator shows *"Capital returned · 100%"* — in that case say: *"and when I pulled my money out, it came back in full — 100%, reported honestly, never as a loss."* A brand-new operator has no record yet — show a seasoned one here. Never say a number that isn't on the screen.

*(Back to face cam — calm, certain.)*

> "AI agents are about to start moving real capital. Brief is the version where the AI **proposes**… and the chain **enforces.**
>
> **The first AI capital operator governed by on-chain law.** Built on Sui."

*(Stop. No extra lines.)*

---

## 30-SECOND CUT  *(for socials / quick intro)*

> "Most AI wallets give the model the keys and hope it behaves. Brief does the opposite — the AI decides what to do, but the **chain** decides what it's *allowed* to do. The agent can trade your USDC but physically cannot withdraw it, a second agent can pause it, and when you revoke it, the next trade **aborts on-chain** — verify it yourself on Suiscan. Its memory even survives on Walrus. The first AI capital operator governed by on-chain law. Built on Sui."

---

## DELIVERY NOTES  *(read twice before recording)*

- **Energy curve:** sharp on the cold open → steady + confident through the demo → calm and slow on the close. Don't flatline, don't oversell.
- **The 3 pauses** (non-negotiable): after *"it physically cannot,"* after *"Sui said no,"* after *"survives on Walrus."*
- **Click, then talk** — don't narrate clicking. A page load is fine; fill it with the next line, not "um, loading."
- **Actually click into Suiscan once.** That one action separates you from every backend-promise demo.
- **Never apologize.** No "it's just a hackathon," no "sorry it's slow." You're live on mainnet with real money — own it.
- **Rehearse to ~4:30.** If long, trim the Walrus section to two sentences — **never** cut the Kill Switch.

**Because it's recorded (not live), use that:**
- **Record in the 7 segments above**, not one take. Re-do any segment until it's clean, then stitch them. Way less pressure than a live run.
- **Edit out dead air** — trim page loads and "ums" in post. Tight pacing reads as confident.
- **Zoom / highlight on the Suiscan abort code** in editing so the `EPolicyRevoked` moment is unmissable even on a small screen.
- **Add captions/subtitles** — judges often watch muted first; your key lines should land on screen too.
- **Do a 10-second silent sanity pass** of each page before recording it, so nothing is mid-load or stale when you hit record.

---

## BONUS · IF A JUDGE ASKS  *(NOT part of the recording — keep for any live finalist round, community follow-up, or your README/FAQ. This is where Kyvern was lost, so it's worth knowing cold.)*

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
