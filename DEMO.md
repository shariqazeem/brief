# Brief — 90-Second Demo Choreography

Everything below is **real and autonomous**. The agent makes its own decisions, the chain enforces every constraint, the abort happens on-chain. Nothing is mocked or pre-recorded.

The only thing being "choreographed" is the *cadence* (operator cycle = 15s), the *budget size* (10 SUI for visible meter movement), and the *human's clicks* (you).

---

## Setup checklist — do this 30 minutes before recording

### 1. Top up the agent wallet to ≥ 5 SUI on testnet

The operator's wallet (`0xd440b0b59ed5474b32ceb71d819c474e1512747179b7088ff324012767f5b435`) pays gas for every action, the DeepBook deposit, and the `record_spend` call. With ≥ 5 SUI free the `live deepbook` badge replaces `simulated` on every action — that's the demo-quality difference.

```
https://faucet.sui.io  →  Testnet  →  paste agent address  →  request 3 times
```

Verify:
```
sui client gas
# should show ≥ 5 SUI on 0xd440…b435
```

### 2. Run in production mode (avoids Slush hot-reload bug)

Dev mode's Fast Refresh disrupts Slush's wallet session — judges' patience won't survive an "incorrect password" loop during the demo.

```
cd brief
npm run build
nohup npm start > /tmp/brief-prod.log 2>&1 & disown
./agents/run-all.sh
```

Verify dev server gone, prod server up, operator polling:
```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/app   # 200
tail -3 /tmp/brief-operator.log                                       # cycle=15000ms
```

### 3. Connect the wallet **before** screen capture starts

Open `http://localhost:3000/app` → click Connect → sign once → confirm the ConnectButton now shows your address. Then close the browser tab. When you reopen at recording time, the wallet auto-reconnects without a popup.

### 4. Recommended browser setup

- Chrome or Brave, fullscreen, no dev tools open
- Cursor highlight ON (System Preferences → Accessibility → Pointer Control → "Shake mouse pointer to locate" — turn off, but keep "Increase contrast" for cursor)
- Browser zoom 100%
- Window 1920×1080 ideally

### 5. Pre-flight smoke (last sanity check)

```
curl -s -o /dev/null -w "%{http_code} %{size_download}B\n" http://localhost:3000/app
tail -3 /tmp/brief-operator.log
```

Both should respond. Operator should be on `cycle=15000ms`.

---

## The 90-second script

| Seconds | Surface | What you do | What happens autonomously | Voice-over |
|---|---|---|---|---|
| **0:00–0:08** | `/` landing | Hold on the hero. | Live status pill pulses green. | *"AI agents on Sui get stuck at the approve wall. Brief unsticks them — by giving the chain itself the kill switch. The AI is not trusted. The policy is."* |
| **0:08–0:11** | `/app` ConnectGate | Click "Try Brief". | Page transitions. Philosophy line slowly pulses. | *"I open the app. Wallet already connected from earlier."* |
| **0:11–0:18** | GrantCeremony · stage 1 | Hover over "Conservative Yield", click it. | Stage transitions to envelope. Breadcrumb shows ✓ Mode → Envelope. | *"I pick a Conservative Yield operator."* |
| **0:18–0:26** | GrantCeremony · stage 2 | Drag the budget slider to **10 SUI**. Leave other defaults. Click "Review & activate". | Stage transitions to activate. | *"10 SUI budget. DeepBook + NAVI + Suilend. 24 hours. Max single position 30%. Auto-approve under 50%."* |
| **0:26–0:33** | GrantCeremony · stage 3 | Read the plain-English summary on screen. Click "Activate operator". Sign in wallet. | Wallet popup → sign → tx lands. Boot sweep fires across the page. Dashboard mounts. | *"One signature. The policy is now a Move object on Sui that the chain itself will enforce."* |
| **0:33–0:38** | OperatorConsole | Don't touch anything. Let the camera rest on the OperatorCard. | Operator card breathes (top accent line pulses, scan line sweeps left-to-right). Status reads `OPERATOR ENGAGED`. ScanningRow at top of activity shows live countdown. | *"The agent is online."* |
| **0:38–0:42** | OperatorConsole | Watch the first action land. | Cycle 1 mints. ActivityRow slides in with `land-in` animation. `DEPLOYING` flashes for ~2s then back to `SCANNING`. Header budget remaining ticks down with a brief green flash. | *"First action — autonomous. Real DeepBook order in the same atomic transaction as the policy check."* |
| **0:42–0:55** | OperatorConsole | Click on the first action row. | DecisionTrace expands. Bars show every venue the agent considered with scores. The chosen one is green. Confidence label shown. | *"The agent considered DeepBook, NAVI, and Suilend. Each scored. The chosen one is shown. This is the trace, not a black box."* |
| **0:55–1:00** | OperatorConsole | Watch the second action land. | Cycle 2 mints. Another row lands. Budget ticks again. | *"Second cycle. Different venue — the agent rotates based on memory of recent positions."* |
| **1:00–1:05** | OperatorConsole | Press **⌘K**. | Command Palette opens centered. | *"Now I revoke."* |
| **1:05–1:08** | Command Palette | Type "rev". Hit ⏎. | Palette closes. Revoke modal opens. | — |
| **1:08–1:14** | Revoke modal | Read the modal copy ("policy.revoked = true on Sui…"). Click "Revoke mandate". Sign. | Wallet popup → sign → tx lands. Page darkens with red wash (RevokeDarken). Header status pill flips to **REVOKED** (red). RevokePendingBanner appears with countdown "chain intervention ~14s". | *"One signature. The policy is now revoked on-chain. Watch — the next agent attempt will hit `assert_can_spend` and abort."* |
| **1:14–1:25** | OperatorConsole | Sit on the dashboard. Don't click anything. | Countdown ticks down. OperatorCard's scan line stops. Status is REVOKED. | *"The chain is about to block it."* |
| **1:25–1:30** | OperatorConsole | Watch the Rejection land. | Operator's next cycle wakes. PTB lands → `record_spend` aborts on-chain with `EPolicyRevoked`. Red row slides in with `land-in` + red left border + cinematic treatment. StoodDownRow lands above it. OperatorCard gets a soft red glow. | *"Look at the abort code. EPolicyRevoked. The chain blocked it. Not our server. Not a guardian process. Sui itself."* |
| **1:30** | OperatorConsole | Hold. Don't speak. | Let the final dashboard state hold for 2 seconds — Rejection row in red, OperatorCard glowing, ActivityStream telling the whole story. | *(silence — let the chain do the talking)* |
| **1:30–1:35** | Closing card or VO | Optional: scroll up slowly to show the full timeline. | — | *"The AI is not trusted. The policy is. This is the agentic web on Sui."* |

Total: ~95s including the closing line. Tight to 90 if you cut a beat.

---

## Cycle math — why 15s cycles work

```
0:33  Activate signed                  → cycle 0 starts
0:36  Cycle 1 fires            (~3s after grant — operator's first scan)
0:51  Cycle 2 fires            (+15s)
1:06  Cycle 3 fires            (+15s)
1:08  User clicks Revoke
~1:25 Cycle 4 fires            (within 15-19s of revoke) → ABORTS
```

The revoke at 1:08 hits within cycle 3's sleep window. Cycle 4 wakes ~17s later (15s sleep + ~2s tick), fetches the now-revoked policy, attempts spend, aborts on-chain. **Total time from revoke signature to red Rejection row: 13-17 seconds.**

That's the dramatic tension window. Long enough to feel real (the chain decides, not our server). Short enough to keep the demo arc tight.

---

## What runs autonomously (zero human input)

- Operator scans every 15s
- Each cycle evaluates all allowed venues, scores them, picks one, builds the atomic PTB
- Every successful action mints an Operator WorkObject via the agent's own key
- Every failed attempt mints a Rejection WorkObject (the abort itself is on-chain)
- Memory continues across cycles (rotation logic, concentration tracking)
- Frontend polls every 2.5s — new chain state surfaces within seconds

## What you control (the only clicks in the demo)

1. Pick Conservative Yield template
2. Set budget to 10 SUI
3. Click Continue → Activate → sign
4. Click on one action row (decision trace expand)
5. ⌘K → "Revoke …" → Enter
6. Click "Revoke mandate" in modal → sign

That's it. **6 clicks + 2 signatures.** The rest is the chain doing what the chain does.

---

## Cinematic moments worth knowing about

- **Boot sweep** (1.2s) — fires when the OperatorPolicy transitions to LIVE in the dashboard. A subtle scanner line crosses the page.
- **Operator scan line** (continuous, 7s loop) — barely visible green gradient sweep across the OperatorCard. Stops on terminal states.
- **Top accent line pulse** (2.8s loop) — the thin line at the top of the OperatorCard slowly breathes opacity. Goes red on kill tone.
- **Action `land-in`** (420ms) — every new ActivityRow translates up + fades in.
- **Budget value-tick** (600ms green flash) — header's remaining-SUI number briefly tints green when it drops. New in this pass.
- **Revoke darken** (1s) — red radial wash across the page when policy.revoked transitions to true.
- **Rejection row** — red left border + larger amount text + reason badge ("policy revoked") + glow.
- **Operator card kill glow** — soft red box-shadow when state is blocked/revoked.

All CSS-driven. All respect `prefers-reduced-motion`.

---

## Recording technical setup

- **Tool:** macOS Screen Recording (⌘+Shift+5 → Record Selected Portion) or OBS
- **Frame rate:** 30fps minimum, 60fps preferred for smooth animations
- **Resolution:** 1920×1080 (export at this; YouTube/X re-encode handles the rest)
- **Audio:** Voice-over recorded separately, layered in post. The product makes no sound — don't pretend it does.
- **Browser zoom:** 100%
- **Browser:** Chrome / Brave. Safari sometimes garbles the backdrop-blur on the persistent header.
- **Camera framing:** No browser nav bar visible. Fullscreen Chrome (F11 / cmd+ctrl+F).
- **Cursor:** Default macOS cursor — DO NOT use any "cursor highlighter" plugin. It looks hackathon-y.

---

## If something goes wrong mid-take

- **Slush asks for password:** that's the keyring bug. Stop the take. Switch to Suiet. Re-record.
- **First action doesn't land in 5s:** operator probably restarted. Check `tail /tmp/brief-operator.log`. Usually `cycle=15000ms` should print on boot.
- **Wallet balance drops below 1.5 SUI:** every subsequent action runs in simulated mode (no `live deepbook` badge). Top up before re-take.
- **RevokePendingBanner doesn't appear:** the policy already had a Rejection minted (from prior testing). Use a fresh policy for the take.

---

## Closing line — write this on a slide if you have the time

> *"The AI is not trusted. The policy is."*
>
> *Built on Sui. Move-enforced. Walrus-anchored. DeepBook-executed.*

Sub-tracks: Agentic Web · Sub-track 2 (Autonomous Agent Wallet) + Sub-track 3 (Intent Engine) merged into one product.

---

## What this demo is **not**

- Not a slideshow with mocked timing
- Not a pre-recorded "agent thinking" animation
- Not a chatbot
- Not a yield optimizer
- Not a portfolio tracker

It is a **live Sui session** with a real Move policy object, a real agent process, real on-chain transactions, and a real revoke that aborts the next attempted spend at the chain level. Anything a judge clicks (any tx digest in the timeline) will resolve on suiscan.

The demo is the product. There is no other product.
