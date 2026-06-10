# Brief — demo video script

Target length: **5 minutes** (Sui Overflow guidance: 30–60 s problem
→ ~3.5 min product demo → 30–60 s conclusion + vision). The 30-second
Watch-it-think beat is the load-bearing addition over the prior 4:30
cut — every other section was trimmed slightly to fit it.

Pull every digest, blob, and screen from real testnet artifacts already
captured in [`SUBMISSION.md`](./SUBMISSION.md). Nothing on the cutting-
room floor is fake.

---

## 0:00 – 0:45 · The problem

Voiceover, calm, over a slow zoom into the landing page hero (cream/navy
typography, the **"Adopt an AI trader. The policy is the leash."**
headline).

> "Everyone wants AI to act with their money.
> Almost nobody actually lets it.
>
> Because once an AI agent has signing authority — what stops it?
> A process flag? A server-side circuit breaker?
> A phone call to revoke?
>
> Every one of those depends on infrastructure
> the AI agent might be running on.
>
> The chain has no opinion on whether the agent
> is still authorized.
>
> And the agent itself —
> is it really *deciding*, or just rolling a die?"

Cut to b-roll: the landing's three pillars (Predict · DeepBook · Walrus),
then close on the "ADOPT A TRADER" CTA.

> "Brief is autonomous trading with a chain-enforced leash —
> and an agent that decides from real, on-chain data.
> The AI is not trusted. The policy is.
> The decision isn't trusted. The data is."

---

## 0:45 – 3:45 · The product demo

### 0:45 – 1:15 · Connect, pick a trader, set the leash

Screen recording, full-page, no cursor jitter:

1. Click **Connect Wallet** (Slush / Suiet — zkLogin is wired but
   gated by Enoki for testnet; the wallet path signs the same atomic
   PTBs, so the demo uses it).
2. Wallet popup → approve. Header shows the address chip.
3. Scroll to the gallery. **Four** personality cards: **Conservative ·
   Momentum · Contrarian · Quant·Vol**. Click **Quant·Vol**.
4. Adoption panel slides up. Type name **"Memory"**. Slide the leash
   to **2 SUI**.
5. **Step 3 — Which markets?** Three cards: BTC only / Sui ecosystem /
   All. Click **All**.

Voiceover, brisk:

> "One wallet signature. No second prompt.
> Give your trader a name. Pick a budget.
> Pick which markets — BTC, the Sui ecosystem, or all.
> Quant·Vol is the new one — it reads the on-chain vol surface."

### 1:15 – 1:45 · The grant

7. Click **Adopt Memory →**. The wallet signature modal appears.
8. Sign. The page transitions to the dashboard. A new `OperatorPolicy`
   appears on chain with `allowed_venues = [predict-btc, spot-sui,
   spot-wal, spot-deep]`, budget cap 2 SUI-equivalent, `revoked=false`.

Voiceover:

> "That signature minted a Move object on chain.
> Inside it: the budget you set, the markets you allowed,
> a kill-switch field you control.
> The trader's wallet is bound to it as the operator."

Cut to Suiscan showing the policy object's fields. Linger on
`allowed_venues` and `revoked: false`.

### 1:45 – 2:30 · The first bet (LIVE on the BTC market)

9. The dashboard's **Open Position** panel fills in. Headline:
   *"Memory is betting UP on BTC."* Strike, spot at decision, expiry.
   Live spot ticks every 8s; a distance gauge shows how close we are
   to the flip line.
10. Click the **mint tx link**. Suiscan opens. Highlight the atomic PTB:
    - command 1: `operator_policy::record_spend(policy, X, "predict-btc", clock)`
    - command 2: `market_key::new(oracle, expiry, strike, is_up=…)`
    - command 3: `predict::mint<DUSDC>(predict, manager, oracle, key, qty, clock)`
11. Scroll to the events tab. **PolicySpend** event shows the policy's
    `spent` field ticking up exactly `qty × DUSDC_BASE × 1000`.

Voiceover:

> "The mint just ran.
> Every bet is a single atomic PTB.
> First: `record_spend` debits the policy — and aborts if it's revoked.
> Only then does the actual trade execute.
>
> The kill switch isn't a process flag. It's structural."

### 2:30 – 3:00 · Watch it think (the showpiece)

12. Scroll down *one* card. The **Watch {Memory} think** panel renders.
    Headline: *"How Memory decided · quant"*. Linger on each block for
    ~3s:
    - **Signals row** — four chips. *ROC 30m*: −0.20% (red). *SMA 60m*:
      $61,563.09. *RSI 60m*: 30.1, sub-label *oversold* (emerald).
      *Realized vol*: 41.2% annualized. *Numbers the agent observed
      from rolling price history.*
    - **SVI vol surface · live, on-chain** — Forward $61,503.59, Spot
      $61,489.34. Five parameter cards: `a, b, ρ, m, σ`. *These came
      from a single chained devInspect off the oracle.*
    - **(Quant only) Where the bet comes from · vol-surface edge** —
      two horizontal bars. *Market says X.X% UP* (the ink bar) and
      *Agent estimates Y.Y% UP* (emerald or red, depending on the
      direction). Below the bars: *"Edge +5.5% → bet UP · fires when
      |edge| ≥ 5.0%."*
    - **Plain reasoning** — the strategy's full narrative in one
      paragraph, citing the same numbers above.
    - **Verifiable on Walrus** pill at the bottom — opens the raw
      content-addressed blob in a new tab. The numbers on screen are
      the same numbers in the blob.

Voiceover, slower, weight on each beat:

> "Now you can see the agent thinking.
>
> These are real signals — Memory observed them itself,
> from a rolling price feed on disk.
>
> This is the live volatility surface,
> read off the DeepBook Predict oracle.
> Forward, spot, and the five SVI parameters — `a, b, ρ, m, σ`.
> The same numbers a market maker would use.
>
> *(point to the edge block)*
> This is where the bet comes from.
> The market — implied from the SVI surface — says the probability of UP
> is X percent.
> Memory's own estimate, from the signals it computed, is Y percent.
> The gap is the edge. When it clears 5%, Memory bets.
> When it doesn't, Memory sits out.
>
> Watch what 'sits out' looks like."

13. Cut to a *second* recording (queued; see shot list) — a quant or
    momentum task that abstained. The Watch-it-think panel shows the
    same surface, headlined *"Memory sat this one out · no edge."*
    Same signal chips. Same SVI surface. Section retitled *"Why no
    bet"* with the strategy's plain-language abstention paragraph.

Voiceover, holding the cadence:

> "Same panel, same numbers, no bet placed.
> The discipline is the impressive part —
> not every cycle is a trade.
>
> The agent shows its work either way."

### 3:00 – 3:15 · The Walrus memory panel

14. Scroll down to **"Memory's memory · on Walrus."** Two emerald cards
    side-by-side: the running journal blob + this decision's reasoning
    blob.
15. Click the journal card. The Walrus aggregator URL opens. Show the
    markdown — frontmatter, list of all prior decisions, this entry,
    the reasoning narrative.

Voiceover:

> "And every decision Memory makes uploads to Walrus —
> the same signals, the same SVI parameters, the same reasoning.
> A running journal regenerates each trade — content-addressed.
> Memory cannot rewrite history; you can verify it,
> right here, from the public aggregator."

### 3:15 – 3:30 · The non-BTC bet (real SUI directional)

16. Back to the dashboard. Click into the **track record** showing the
    SUI bet pair. Highlight:
    - OPEN tx `9fgEqR6N…` — sold 1 SUI for $0.744 DBUSDC (SUI DOWN bet)
    - CLOSE tx `81a2xFkH…` — bought 1 SUI back for $0.753 DBUSDC
    - **Realized P&L: −$0.009** (SUI rose; the bet lost — but the math
      is honest and on chain)
17. Tap each digest → Suiscan tab → real `pool::place_market_order`
    events.

Voiceover:

> "Memory isn't BTC-only anymore.
> This is a real SUI directional bet on DeepBook spot —
> open, close, realized P&L,
> all on chain, all losing nine-tenths of a cent because SUI rose
> while Memory was short.
>
> Honest result. Same policy. Same leash. Different market."

### 3:30 – 3:45 · The kill switch climax (CHAIN REFUSED)

18. Return to the dashboard. Click **REVOKE**.
19. Wallet modal. Sign once.
20. Revoke tx lands. The next trader cycle fires. The Activity Stream
    surfaces the trader's deliverable with mode **simulated** and the
    reason field literally showing
    `MoveAbort code:3 in operator_policy::assert_can_spend`.

A subtle red bar pulses across the open-position panel as it transitions
to the "CHAIN REFUSED" state.

Voiceover, paced:

> "One revoke.
>
> The next time Memory tries to bet —
> the chain itself refuses the trade.
> Not the server. Not the agent's process.
> The chain.
>
> But the position Memory already has?
> When the oracle settles, `redeem_permissionless` still pays it out.
> Past wins flow. New bets don't."

---

### 3:45 – 4:15 · The leaderboard (the social hook)

21. Back to the dashboard. Click **"See Memory on the leaderboard →"**.
22. Cut to `/leaderboard`. Ranked rows of every adopted trader on
    testnet. Memory is highlighted *"You're #1 · Memory"* with the
    emerald-1 spotlight. Per row: asset chips (BTC · SUI), trade
    count, realized P&L (green/red), owner short address, and a
    Walrus "Memory" CTA on each row.
23. Click another trader's Memory chip → Walrus aggregator opens →
    *their* content-addressed reasoning blob. Same format the
    Watch-it-think panel was rendering — *every other trader's mind is
    just as auditable.*

Voiceover:

> "Every row is a real adopted trader.
> Every digit of P&L is verifiable on Suiscan.
> Click any row's memory — read how they earned their rank,
> straight off Walrus.
>
> One adopt, one signature, you're on the board."

---

## 4:15 – 4:45 · Conclusion + vision

Cut to a wide shot of the dashboard with Memory's track record visible:
the BTC bet, the SUI bet, the policy's spent field, the kill switch
state.

Voiceover:

> "This is one trader.
> A quant·vol agent named Memory.
> Reading the live volatility surface off the on-chain oracle.
> Computing its signals from a feed it maintains itself.
> Betting only when the edge clears the threshold.
> Bounded by a policy you can yank in one tap.
>
> The next surface is a stable —
> a roster of traders, each on their own leash,
> each picking their own markets,
> each accruing reputation as they win or lose,
> *each one's reasoning legible on Walrus.*
>
> The leaderboard writes itself.
> Memory is just the first."

End card:

> **Brief**
> Adopt an AI trader. The policy is the leash.
>
> briefkin.com
> github.com/shariqazeem/brief
>
> By Kyvernlabs · Sui Overflow 2026

---

## Shot list / b-roll inventory

| Shot | Source | Status |
|---|---|---|
| Landing page hero | `/` on the deployed URL | ✅ live |
| Wallet connect (Slush / Suiet) → callback | live recording | needs capture |
| Trader gallery + adoption panel + Step 3 (4 personality cards incl. Quant·Vol) | `/workforce` | ✅ shipped |
| Policy object on Suiscan | live URL via policy id | ✅ on chain |
| Open Position panel with live spot tick | `/workforce` running trader | ✅ live |
| **Watch-it-think panel — quant/positive (signals + SVI + edge bars)** | `/workforce` after a quant bet | ✅ shipped — capture a frame with all four blocks visible |
| **Watch-it-think panel — abstention variant** | `/workforce` after a no-edge cycle | ✅ shipped — capture a frame with the "Why no bet" headline |
| Atomic mint PTB events | Suiscan tx `7kJnuSVg…` or `9mX9ewWn…` | ✅ on chain |
| Walrus reasoning blob open (the new format with Signals + SVI sections) | `cuPCF3WjpU0LOMt488oPX8hapxMAoCjdFibH-KhsYXw` | ✅ HTTP 200 |
| Memory panel + Walrus aggregator open | dashboard + blob URL | ✅ HTTP 200 |
| SUI bet pair (open + close) | Suiscan + track record | ✅ on chain |
| Revoke tx → simulated fallback | live recording | needs capture |

## Recording notes

- Browser: Chrome with the **Window Resizer** extension fixed at
  1440×900 (matches the design's break points).
- Hide bookmarks bar, extensions, downloads.
- Cursor: enable a soft yellow ring (Cursor Highlighter extension) so the
  viewer's eye lands at clicks without a hard visual.
- Audio: tight VO, no music for the demo block; a single low pad
  underneath the conclusion.
- Re-record any segment where a Suiscan page takes >5 s to load.
- Total target: trimmed to 4:30 max; the bar to clear is "every claim is
  visible on chain in the same frame."
