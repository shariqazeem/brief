# Brief — Deploy guide

Steps to get the project from local-only → public GitHub repo + Vercel
deployment + custom domain. Do these in order; each one unblocks the
next.

---

## 1. Push to GitHub

```bash
cd /Users/macbookair/projects/myowncompany/brief

# Stage everything except .env.local (already gitignored)
git add .
git commit -m "Initial Brief commit — Sui Overflow 2026 submission

Move package published to testnet: 0xfa3a152a…d084
Walrus integration end-to-end on testnet
DeepBook BalanceManager: 0x1d9495d4…4771
Confirmation-gated execution flow
"

# Create a GitHub repo (use gh CLI or the web UI)
gh repo create brief --public --source=. --remote=origin --description "Composable work objects for autonomous agents on Sui · Overflow 2026"
git push -u origin main
```

Paste the resulting URL into `SUBMISSION.md` under "GitHub".

---

## 2. Deploy to Vercel

The frontend is a plain Next.js 14 App Router build. No env vars are
strictly required because the package id, network, RPC, and Walrus
endpoints are baked into the source. (Agents need env vars to run, but
agents run on your local machine, not Vercel.)

```bash
npm i -g vercel
vercel link    # follow prompts, link to a new project
vercel --prod  # build + deploy
```

The build is `next build`. Output is static + one dynamic route
(`/lineage/[id]`). Build time ~60 seconds.

Vercel will give you a URL like `brief-shariq.vercel.app`. Paste it into
`SUBMISSION.md` under "Live deployment".

---

## 3. (Optional) Custom domain

Buy one of:
- `brief.xyz` (matches the OG metadata; first choice)
- `usebrief.com`
- `runbrief.app`

At your registrar, set the Vercel-issued nameservers OR add the records
Vercel asks for. Then in Vercel project settings → Domains → add your
domain. SSL is automatic; takes ~5 minutes to propagate.

Update `src/app/layout.tsx`'s `SITE_URL` to match the new domain so
OpenGraph and Twitter cards use it.

---

## 4. Pre-submission smoke

```bash
# Move package still alive on testnet
curl -s "https://fullnode.testnet.sui.io:443" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getObject","params":["0xfa3a152aff2aba3886bf0fb41328e72da5ccd637074d4673c36b1924c850d084",{"showType":true}]}' \
  | python3 -m json.tool | head -10

# Public deployment responds
curl -sS -o /dev/null -w "deployed: %{http_code}\n" https://<your-domain>/
curl -sS -o /dev/null -w "/app:      %{http_code}\n" https://<your-domain>/app
```

Open the deployed URL in a fresh browser (or Incognito), connect a Sui
testnet wallet, run through the full Brief flow. Confirm:
- Wallet connect works
- "Brief it" mints a Query (you'll need testnet SUI in that wallet)
- Cards appear sequentially as agents fire (only if your local agents
  are running; otherwise nothing will appear past the Query)
- "Show lineage" renders the SVG graph for any existing chain

For the demo recording, you want the agents running on your local
machine, signing TXs against testnet, while the frontend you record is
either local (`localhost:3000`) or the deployed Vercel URL. Both work.

---

## 5. Submit at overflow.sui.io

Open `SUBMISSION.md` and copy each section into the matching form field.
Required fields:
- Project name: **Brief**
- One-line description: first paragraph of SUBMISSION.md
- Long description: assemble Problem + Solution + Demo + Why Sui
- Tech stack
- Sub-track: **Agentic Web → Intent Engine**
- Sponsor tracks: check both **Walrus** and **DeepBook**
- GitHub URL: from step 1
- Live deployment URL: from step 2 or step 3
- Demo video: from your recording (uploaded to YouTube unlisted)

Click submit. Save the confirmation screen.

---

## 6. X launch (post-submission)

From `@shariqshkt` (your handle):

```
Agents shouldn't just transact. They should compose.

I built Brief — composable work objects on Sui that let autonomous
agents pass typed outputs to each other, on-chain, with explicit
user confirmation gates.

Submitted to Sui Overflow 2026 ↓

[attach 90-second demo video]
```

Quote-tweet from `@kyvernlabs`:

```
Kyvern is how agents spend safely on Solana.
Brief is how agents compose on Sui.
Same author. Same thesis. Different chains.
```

---

## Troubleshooting

**`/app` shows "Move package not yet published" on Vercel deploy.**
The env var `NEXT_PUBLIC_BRIEF_PACKAGE_ID` is missing on Vercel. In
project settings → Environment Variables, add:
- `NEXT_PUBLIC_BRIEF_PACKAGE_ID` = `0xfa3a152aff2aba3886bf0fb41328e72da5ccd637074d4673c36b1924c850d084`
- `NEXT_PUBLIC_SUI_NETWORK` = `testnet`

Redeploy.

**Sui wallet doesn't connect on Vercel.**
Make sure the Sui Wallet browser extension is set to **testnet**.
Brief's dApp Kit provider doesn't auto-switch networks — it just talks
to whatever the wallet is configured for.

**Cards don't appear after Brief it.**
The agents aren't running. Start them:
```bash
npm run agents:all
```
The frontend doesn't include agents — agents are off-chain workers you
run separately. For the submission, you can demo with agents on your
local machine while showing the deployed URL.

**Walrus payload shows "fetching from walrus…" indefinitely.**
The aggregator can take 30-60 seconds to serve a freshly-uploaded blob.
Wait. If it persists past 2 minutes, the blob upload may have failed —
check the agent log.
