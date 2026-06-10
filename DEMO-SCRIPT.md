# Brief — demo video script

Target length: **4–4.5 minutes** (Sui Overflow guidance: 30–60 s problem
→ ~3 min product demo → 30–60 s conclusion + vision).

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
> is still authorized."

Cut to b-roll: the landing's three pillars (Predict · DeepBook · Walrus),
then close on the "ADOPT A TRADER" CTA.

> "Brief is autonomous trading with a chain-enforced leash.
> The AI is not trusted. The policy is."

---

## 0:45 – 3:45 · The product demo

### 0:45 – 1:15 · Sign in, pick a trader, set the leash

Screen recording, full-page, no cursor jitter:

1. Click **Sign in with Google** (zkLogin button, top-right).
2. Browser tab flips to Google's consent screen → consent → returns to
   `/workforce` authenticated.
3. Header shows the freshly-derived address chip; the AccountChip
   expands to show the address + balance.
4. Scroll to the gallery. Three personality cards: **Conservative ·
   Momentum · Contrarian**. Click **Momentum**.
5. Adoption panel slides up. Type name **"Memory"**. Slide the leash
   to **2 SUI**.
6. **Step 3 — Which markets?** Three cards: BTC only / Sui ecosystem /
   All. Click **All**.

Voiceover, brisk:

> "Sixty seconds, no wallet install.
> Give your trader a name. Pick a budget.
> Pick which markets — BTC, the Sui ecosystem, or all of them.
> One signature."

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
   *"Memory is betting UP on BTC."* Strike **$61,792**, spot
   $61,792.17. Expiry **Jun 12 8am UTC**. Live spot ticks every 8s; a
   distance gauge shows how close we are to the flip line.
10. Click the **mint tx link** (`B5FYRVPZ…`). Suiscan opens. Highlight
    the atomic PTB:
    - command 1: `operator_policy::record_spend(policy, 2_000_000_000, "predict-btc", clock)`
    - command 2: `market_key::new(oracle, expiry, strike, is_up=true)`
    - command 3: `predict::mint<DUSDC>(predict, manager, oracle, key, 2, clock)`
11. Scroll to the events tab. **PolicySpend** event shows the policy's
    `spent` field ticking from 0 → 2,000,000,000.

Voiceover:

> "The mint just ran.
> Every bet is a single atomic PTB.
> First: `record_spend` debits the policy — and aborts if it's revoked.
> Only then does the actual trade execute.
>
> The kill switch isn't a process flag. It's structural."

### 2:30 – 3:00 · The Walrus memory panel

12. Scroll down to **"Memory's memory · on Walrus."** Two emerald cards
    side-by-side: the running journal blob + this decision's reasoning
    blob.
13. Click the journal card. The Walrus aggregator URL opens. Show the
    markdown — frontmatter, list of all prior decisions, this entry,
    the reasoning narrative.

Voiceover:

> "Every decision Memory makes uploads to Walrus.
> A running journal regenerates each trade — content-addressed.
> Memory cannot rewrite history; you can verify it,
> right here, from the public aggregator."

### 3:00 – 3:30 · The non-BTC bet (real SUI directional)

14. Back to the dashboard. Click into the **track record** showing the
    SUI bet pair. Highlight:
    - OPEN tx `9fgEqR6N…` — sold 1 SUI for $0.744 DBUSDC (SUI DOWN bet)
    - CLOSE tx `81a2xFkH…` — bought 1 SUI back for $0.753 DBUSDC
    - **Realized P&L: −$0.009** (SUI rose; the bet lost — but the math
      is honest and on chain)
15. Tap each digest → Suiscan tab → real `pool::place_market_order`
    events.

Voiceover:

> "Memory isn't BTC-only anymore.
> This is a real SUI directional bet on DeepBook spot —
> open, close, realized P&L,
> all on chain, all losing nine-tenths of a cent because SUI rose
> while Memory was short.
>
> Same policy. Same leash. Different market."

### 3:30 – 3:45 · The kill switch climax (CHAIN REFUSED)

16. Return to the dashboard. Click **REVOKE**.
17. Wallet modal. Sign once.
18. Revoke tx lands. The next trader cycle fires. The Activity Stream
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

19. Back to the dashboard. Click **"See Memory on the leaderboard →"**.
20. Cut to `/leaderboard`. Ranked rows of every adopted trader on
    testnet. Memory is highlighted *"You're #1 · Memory"* with the
    emerald-1 spotlight. Per row: asset chips (BTC · SUI), trade
    count, realized P&L (green/red), owner short address, and a
    Walrus "Memory" CTA on each row.
21. Click another trader's Memory chip → Walrus aggregator opens →
    their content-addressed decision log.

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
> A momentum agent named Memory, betting BTC and SUI,
> bounded by a policy you can yank in one tap.
>
> The next surface is a stable —
> a roster of traders, each on their own leash,
> each picking their own markets,
> each accruing reputation as they win or lose.
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
| Landing page hero | `/` on briefkin.com | ✅ live |
| zkLogin Google → callback | live recording | needs capture |
| Trader gallery + adoption panel + Step 3 | `/workforce` | ✅ shipped |
| Policy object on Suiscan | live URL via policy id | ✅ on chain |
| Open Position panel with live spot tick | `/workforce` running trader | ✅ live |
| Atomic mint PTB events | Suiscan tx `B5FYRVPZ…` | ✅ on chain |
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
