# Brief — 90-second demo teleprompter

The locked plan's beat-by-beat target. Time-stamped voice-over + what's
on screen at each beat. Record on Chrome desktop at 1920×1080. Aim for
3 takes; pick the cleanest.

Setup before recording:
- Wallet: `strange-jasper` connected via dApp Kit
- Network: testnet
- `.env.local`: `BRIEF_USE_WALRUS=true`, `BRIEF_EXECUTION_MODE=simulated` (or `deepbook` if you've topped up to 2+ SUI)
- Agents: `npm run agents:all` running in a separate terminal
- `/app` page open at http://localhost:3000/app, wallet connected, textarea empty

---

## Beat 1 — 0:00–0:08

**On screen:** Landing page at `/`. Cursor moves to the "Try Brief" CTA.

> "Agents on Sui can already transact. They cannot compose. Brief fixes that."

(8 seconds. Pause briefly on the "Live on Sui testnet" pill — judges
will notice it links to a real package.)

---

## Beat 2 — 0:08–0:20

**On screen:** `/app` page. Wallet address visible top-right. User clicks
into the textarea and types:

> *I have 1000 SUI. Where should I deploy for 30-day yield, low risk?*

Then clicks **Brief it**. The wallet extension prompts; user signs.

> "I state a financial intent in plain English. My wallet signs the Query."

(12 seconds. Show the txblock confirmation pill that appears after signing.)

---

## Beat 3 — 0:20–0:35

**On screen:** ResearchObject card materializes (fade-up animation), then
shows: kind label, ID slice, "owned by you · ResearchAgent", Walrus
payload badge, JSON payload preview with NAVI/Scallop/etc.

> "Agent number one surveys five Sui protocols, scores them on yield and
> risk, and mints a ResearchObject. It's owned by me. The full reasoning
> is stored on Walrus — content-addressed, verifiable, off-chain."

(15 seconds. Hover the Walrus badge to show the link to the aggregator.)

---

## Beat 4 — 0:35–0:55

**On screen:** StrategyObject card appears below Research. JSON preview
shows 60/30/10 allocation. Then the **GuardianPanel** renders directly
below with a single amber-severity slippage warning.

> "Agent two consumes the ResearchObject deterministically — because the
> object has a typed schema — and produces a Strategy. A guardian flag
> warns me that the NAVI deposit has 0.34% projected slippage. I review
> it. I sign Confirm."

User clicks **Confirm execution**. Wallet signs. A Confirmation card
appears.

(20 seconds. Linger on the warning text — judges read it.)

---

## Beat 5 — 0:55–1:15

**On screen:** ExecutionReceipt card appears. JSON preview shows mode,
pool, ptb_digest, fills. The Walrus badge appears on this card too.

> "Agent three sees the Confirmation, compiles the strategy into a
> programmable transaction block, settles through DeepBook, and mints
> the receipt. The PTB digest is on-chain. The fills are real."

(20 seconds. Click the explorer link on the receipt card to briefly
show the TX on Sui Explorer in a new tab. Switch back to /app.)

---

## Beat 6 — 1:15–1:25

**On screen:** Click the "show lineage" link at top of the chain block.
Navigate to `/lineage/<query-id>`. Wait for the SVG graph to render.

> "Five nodes. Real parent edges. Every node clickable. The chain is the
> audit trail."

(10 seconds. Cursor hovers over the Confirmation node — judges see the
explicit-user-sign step in the graph.)

---

## Beat 7 — 1:25–1:30

**On screen:** Caption fade-in over the lineage view: *"This is the
Agentic Web."* Then Brief wordmark.

> "This is what the Agentic Web actually looks like. Composable work
> objects on Sui."

(5 seconds. Hold for a beat. End.)

---

## Total: 90 seconds

## Visual emphasis priorities

1. The **Walrus badge** on each card — proves Walrus track integration.
2. The **GuardianPanel warnings** — proves Intent Engine sub-track must-haves.
3. The **Confirmation card** appearing in the chain — proves explicit confirmation.
4. The **SVG lineage graph** with parent edges — the visual money shot.
5. **Sui Explorer links** opening real txblocks — proves it's all on chain.

## What to NOT show

- Don't show the terminal with agents running. Judges want the user UX.
- Don't narrate the mock LLM mode (or anthropic mode) — let the output speak.
- Don't show the .env.local. Don't show the keystore.
- Don't apologize for slow Walrus uploads — frame them as "real
  decentralized storage takes a moment."
- Don't show the simulated-vs-deepbook toggle. Pick one mode for the
  recording.

## Post-production

- Add subtle background music (quiet, not distracting). Lo-fi or
  ambient electronic. Free assets at chosic.com or pixabay.com.
- Add a small "Brief · Sui Overflow 2026" watermark in the corner.
- Export 1080p H.264, 30 fps, under 90 seconds.
- Upload to YouTube as unlisted; paste the link in `SUBMISSION.md`.
