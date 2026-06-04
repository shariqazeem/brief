https://overflow.sui.io
Sui
Overflow
2026
May - August, 2026
Headline Partner:

Track Sponsor:

Register

Over $1,000,000 in prizes & seed funding
Registration is open!
Sui Overflow 2026 is Sui’s global hackathon, bringing together builders and explorers worldwide to push what’s possible. 
Sui Overflow 2026 is Sui’s global hackathon, bringing together builders and explorers worldwide to push what’s possible. 
$500K+ in total prizes across core and sponsored tracks - from AI agents that act, to financial rails that move without friction, to tools that make every developer faster. This is your moment to build something real on one of the most powerful and composable platforms. 
$500K+ in total prizes and rewards across core and specialized tracks - from AI agents that act, to financial rails that move without friction, to tools that make every developer faster. This is your moment to build something real on one of the most powerful and composable platforms. 
Top teams also gain access to exclusive developer opportunities and a high-quality network to take their projects beyond the hackathon.
Top teams also gain access to exclusive developer opportunities and a high-quality network to take their projects beyond the hackathon.
Register
Why join Sui Overflow 2026?
Sui Overflow 2026 is a global virtual hackathon featuring selected tracks, with opportunities designed to recognize both top-performing teams and standout projects.
01
Access Sui’s engineering and ecosystem experts
02
Chance to win your share of the prize pool
03
Build alongside high-signal teams from around the world
04
Join exclusive events and sessions
05
Get your project in front of leading judges and leaders
06
Create momentum for your project beyond the hackathon
Tracks
Core Track
Agentic Web
illustration of a key and person icon to illustrate securi
Core Track: Build autonomous AI agents that can act, transact, and coordinate using Sui’s object model and composability.
Core Track
DeFi & Payments
illustration of a stack of coins with sparkles
Core Track: Create financial primitives or payment rails on Sui that are fast, seamless, and usable in real-world scenarios.
1st place prize sponsor:

3rd place prize sponsor:

Specialized Track
Walrus

Specialized Track: Leverage Walrus to build applications that handle large, off-chain, or verifiable data.
Specialized Track
DeepBook
illustration of s stack of dollar bills
Specialized Track: Build trading or liquidity applications powered by DeepBook’s on-chain orderbook.
Prizes
Prizes per core track
Applies to: The Agentic Web (AI) · DeFi & Payments ·
#
1st place

$30,000 USD
#
2nd place

$15,000 USD
#
3rd place

$10,000 USD
#
4th place

$7,500 USD
Specialized Track Pools
See participant handbook for more details.
#
Walrus

$70,000 USD
#
DeepBook

$70,000 USD
Awards
These can be won alongside other prizes.
#
University Award

University Award sponsor:
Scallop Logo
$2,500 USD to 10 winners
If youʼre a team of university students, this special hackathon prize is for you!
#
And More...

$250,000+ in value for winning projects
From audit credits to hands-on support, eligible winners receive resources designed to help take their project to the next level.
Sponsors
Walrus
[
↗
]

DeepBook
[
↗
]
OpenZeppelin
[
↗
]

OtterSec
[
↗
]

Scallop
[
↗
]
Become a sponsor
Two years of Sui’s flagship hackathon
Across two editions, Sui Overflow drew 5,000+ registrants, 950+ project submissions, and distributed over $1M in prizes.
View Overflow 2025 Winners
View Overflow 2024 Winners

https://mystenlabs.notion.site/agentic-web-problem-statement

# Agentic Web Problem Statement

The Agentic Web track rewards projects that use Sui as a meaningful part of the AI stack — not as a payment rail bolted on at the end. Every submission must show why Sui specifically (Move objects, zkLogin, PTBs, Deepbook, Walrus, or Seal) makes the AI component better, safer, or more composable. Generic LLM wrappers that happen to hold SUI will not place.

### Sub-track 1: Autonomous Risk Guardian

DeFi protocols run on static risk parameters. A de-peg or flash crash makes them dangerously stale within seconds. Build a live risk monitor for a Sui lending or perpetuals protocol that ingests oracle price feeds, runs an AI risk model, and autonomously executes a parameter adjustment or market pause via a Move policy object — with every action logged on-chain and reversible by a DAO override.

- **Must have:** live price feed, visible AI risk score, at least one autonomous on-chain action, human override mechanism.

### Sub-track 2: Autonomous Agent Wallet

AI agents are stuck at the "approve" wall — every action needs a human signature. Build an agent wallet on Sui using zkLogin or a Move policy object that grants an AI agent a capped budget and protocol scope (e.g. "max 500 USDC, Deepbook only, expires 24h"). The agent must autonomously execute a strategy, enforce its own ceiling, and produce an on-chain activity log. Owner revocation must be demonstrable.

- **Must have:** real Deepbook orders, self-enforced budget ceiling, on-chain activity log, owner revocation demo.

### Sub-track 3: Intent Engine

Users shouldn't need to know what a liquidity pool is. Build an intent engine that parses a plain-English financial goal, compiles it into a Sui PTB, and before signing, runs a guardian check that surfaces risks (high slippage, concentration, stale pools) in plain language. The user must explicitly confirm before execution. A swap chatbot with no guardian layer is not an intent engine.

- **Must have:**  text → PTB → execution flow, human-readable PTB preview, guardian catching at least 2 risk classes, explicit confirmation step.


https://mystenlabs.notion.site/defi-payments-problem-statement


# DeFi & Payments Problem Statement

### ***Programmable Money, Payments & Financial Systems on Sui***

## **Problem**

Payments and DeFi today are disconnected:

- Payments are static transfers
- DeFi is complex and siloed
- Users must manually orchestrate everything

On Sui, this changes: **Payments can become programmable financial actions.**

Examples:

- A payment that automatically invests
- A salary that streams and earns yield
- A wallet that intelligently routes funds

## **Overview**

Sui introduces a fundamentally different model for building financial systems:

- Assets are objects, not just balances
- Transactions can bundle complex logic atomically (Programmable Transaction Blocks)
- Smart contracts (Move) enforce ownership and composability at the type level

This enables something beyond traditional DeFi:

**Programmable money — where assets, logic, and flows are natively composable.**

This track challenges you to build:

- Payment systems
- Financial workflows
- Capital management tools
- User-facing financial products

all powered by Sui Move.

## **What You’re Building**

---

**Systems that move, manage, and transform money programmatically.**

This includes:

- Payment flows
- Wallets and financial interfaces
- Vaults and capital allocators
- Automation systems
- Financial abstractions for real users

## **Core Building Blocks on Sui**

---

You are encouraged to use any combination of the following:

### **Sui Move (Core Layer)**

- Object-based assets
- Strong ownership model
- Type-safe financial logic

Enables:

- Safe asset flows
- Custom financial rules
- Composable modules

### **Programmable Transaction Blocks (PTBs)**

- Bundle multiple actions into one transaction
- Atomic execution

Enables:

- Multi-step payments
- Complex financial flows (e.g. pay → swap → deposit)
- Seamless user experience

### **Tokens & Assets**

- Fungible tokens (coins, stablecoins)
- NFTs / object-based assets

Enables:

- Payments
- Receipts
- Identity-linked finance
- Tokenized positions

### **DeFi Protocols (Optional)**

You may integrate with:

- Lending protocols
- DEXs / liquidity venues
- Yield platforms

These are tools, not requirements.

## **Idea bank**

---

Pick one, twist it, or ignore it entirely — these are starting points, not a checklist. Grouped loosely by flavor.

### **Trust-Minimized Finance**

Build systems that reduce or eliminate the need for trust between parties by enforcing financial logic programmatically.

Focus on conditional execution, automated enforcement, transparent rules, reduced reliance on overcollateralization

Examples:

- programmable loans
- milestone-based escrow
- payment-linked credit systems
- controlled treasury systems
- Novel prediction markets

### **Payments & Consumer Finance**

Focus on usability and real-world flows.

Examples:

- Smart wallets with built-in automation
- Merchant payment systems
- Subscription or streaming payments
- Payroll systems
- Privacy focused consumer payment rails

### **Vaults & Capital Management**

Focus on managing funds programmatically.

Examples:

- Yield vaults
- Automated savings strategies
- Treasury management systems
- Portfolio allocators

### **Financial Automation**

Focus on logic-driven execution.

Examples:

- Auto-investment bots
- Rebalancing systems
- Conditional payments
- Rule based financial agents

### **Infrastructure & Tooling**

Focus on enabling other builders.

Examples:

- SDKs for payments
- Tools for building or visualizing transaction flows
- Financial dashboards
- Debugging tools for Move contracts

## **What a Strong Project Looks Like**

---

A strong project demonstrates:

- A clear financial use case
- Correct handling of assets and ownership
- Working end-to-end integrations/flows
- Thoughtful abstraction for users

## **What a Top-Tier Project Looks Like**

---

Top projects go further by demonstrating:

- Novel use of programmable transactions
- Strong composability across components
- Excellent user experience for complex financial actions
- Real-world applicability

## **Submission Types**

---

You can submit:

- Full-stack applications
- Smart contract systems (Move modules)
- Bots or automation services
- Developer tools

**> Build something that makes money move smarter**

**> godspeed**


https://mystenlabs.notion.site/walrus-track-problem-statement/

# Walrus Track Problem Statement

AI agents today are powerful, but still fundamentally stateless and fragmented. They complete tasks in isolation, lose context across sessions, and struggle to share knowledge across tools, teams, or workflows. Memory is often tied to a single app, model, or device — making agent systems brittle, hard to scale, and difficult to trust.

As agents evolve from simple assistants to autonomous, long-running systems, they need a more durable foundation:

- the ability to store and retrieve memory across sessions
- share context across agents and workflows
- and access data that is portable, persistent, and not locked into a single platform

This track challenges you to rethink how agentic systems are built by using Walrus as a Verifiable Data Platform for AI.

## What you’ll build

Build functional AI agents or agentic workflows (single or multi-agent) in any domain — from finance to productivity to gaming — that demonstrate:

- Long-term memory using persistent, verifiable memory for agents
- Persistent data and file access using Walrus (directly or via a file management interface)
- Integrations and tooling that make it easier for developers to adopt Walrus or MemWal (Walrus Memory) in agentic systems

To guide you, we’re especially interested in:

- Long-running workflows where agents track state over time (e.g., research agents, trading agents, monitoring systems)
- Multi-agent coordination, such as negotiation, task delegation, or step-by-step execution across agents
- Artifact-driven workflows, where agents generate, store, and reuse files like datasets, logs, reports, or intermediate outputs

For integrations and tooling, think along the lines of:

- adding persistent memory to existing agent frameworks or tools (e.g., plugins or adapters to use Walrus directly, or to use MemWal as the Walrus Memory layer)
- creating workflow orchestration layers that combine memory, messaging, and execution across agents with Walrus as the underlying storage foundation
- enabling cross-tool or cross-agent memory sharing, where different systems can read/write to the same context stored on Walrus
- building interfaces or developer tools that make it easier to inspect, debug, or manage agent memory and data stored on Walrus

Your project could be:

- a user-facing agent or multi-agent system
- a developer tool or framework integration
- or a new interface for interacting with persistent AI memory and data

## What we’re looking for

We’re not just looking for demos — we’re looking for working systems that show:

- how agents become more useful when they can remember and build over time
- how workflows improve when data is shared, durable, and portable
- and how developers can move beyond fragile, siloed memory setups

The goal is to push toward a future where AI agents are not just reactive tools, but persistent, collaborative systems powered by a reliable data layer.

## References to use:

- Walrus docs
    - Getting started
    - CLI / HTTP API / Typescript SDK
    - Public aggregators and publishers
- Walrus Sites docs
    - Install the site-builder CLI
    - Publish a site
- MemWal (Walrus Memory) docs
    - MemWal (Walrus Memory) Playground - create an account and a delegate key for your agent
    - MemWal (Walrus Memory) Github Repo - includes sample apps, skills etc.
- Seal docs - privacy layer for Walrus and MemWal
- Sui Stack Messaging - messaging tooling that uses Walrus for storage & recovery and Seal for privacy

### Join the Walrus Builder Group

For questions, discussions, and direct support from the Walrus team, join the official ***Walrus Telegram group***

For idea validation and project discussion, join our ***Walrus Discord #developers channel***


https://mystenlabs.notion.site/deepbook-predict-problem-statement

# **DeepBook Predict Problem Statement**

<aside>
💡

Join our Telegram group!  https://t.me/+bZTS2KvwIBQyOGZl

Follow our X for update  https://x.com/DeepBookonSui

Register on deepsurge https://www.deepsurge.xyz/hackathons/b587dc0c-4cb8-4e63-ada5-519df38103bf

Workshop  https://www.youtube.com/watch?v=8m3Q9My-qDo 

https://mystenlabs.notion.site/db-predict-workshop-faq

</aside>

Prediction markets today are powerful, but still fundamentally fragmented and shallow. Most live venues either run as CLOB-matched event markets (Polymarket, Kalshi) or as off-chain sportsbooks pretending to be markets. They settle slowly, list a narrow set of binary outcomes, can't price strikes or ranges, and have no real notion of an underlying volatility surface — making serious quant strategies, structured products, and on-chain risk transfer nearly impossible.

As prediction markets evolve from "will X happen" novelty bets into a real piece of crypto market structure, they need a more durable foundation

- the ability to price *every* strike and expiry against a live volatility surface, not just hand-listed events
- short, rolling expiries that work like a real options market — sub-hour cycles, not weekly
- a vault that takes the other side of every trade so liquidity is always present, with on-chain LP economics anyone can audit and compose against
- and primitives that are portable across the wider Sui DeFi ecosystem — composable with margin, lending, structured vaults, and bots — not locked inside a single app

This track challenges you to build an innovative product and tools around **DeepBook Predict**, our programmable, vol-surface-priced prediction protocol on Sui.

Where Predict is today

- The Predict protocol itself is **live on Sui testnet** with rolling sub-hour BTC oracles, a public indexer/API at `predict-server.testnet.mystenlabs.com`, and a `dUSDC` quote asset. Mainnet launch is planned, and projects built during this hackathon are expected to redeploy on day one.
- The DeFi surface you'll compose against DeepBook spot, `deepbook_margin` (margin trading + liquidation), and `iron_bank` (permissioned USDsui supply with the Slush user vault on top) is **already live on Sui mainnet**.

<aside>
💡

You need DUSDC for deepbook predict, this is not the official USDC on testnet.

You can request DUSDC by submitting this form  https://tally.so/r/Xx102L

</aside>

## What you’ll build

Build functional applications, services, vaults, bots, or analytics — single product or multi-component — in any flavor (consumer, professional, structured, social).

To guide you, we're especially interested in:

- **Vault strategies** where capital is allocated programmatically across Predict positions, ranges, and PLP supply (e.g. range-ladder vaults, PLP+hedge vaults, BTC-collateralized premia harvesters, three-protocol margin loops)
- **Cross-venue arbitrage** where bots watch Predict's vol surface against Polymarket / Hyperliquid event markets, or Hyperliquid perps and trade the spread
- **Alt-flavor frontends** including gamified prediction apps, mobile-first PWAs, Telegram bots, or anything that surfaces a behavior the canonical pro UI won't (streaks, social feeds, chat-based trading, watch complications)
- **Analytics and developer tooling** that make Predict legible — live SVI surface viewers, PLP risk dashboards, manager PnL attribution, settlement leaderboards, oracle-feed health monitors

For integrations and tooling, think along the lines of:

- building tokenized share tokens on top of `PredictManager` so vault positions plug into other Sui DeFi (margin collateral, LP composability, structured products)
- composing Predict with `deepbook_margin` (already on mainnet) and `iron_bank` (USDsui supply, already on mainnet) to stack yield, leverage, or hedge exposure across protocols
- creating keeper services and orchestration layers — settled-redeem keepers, oracle monitors, withdrawal-limiter watchers — using `predict::redeem_permissionless` and the public `predict-server` event surface
- building interfaces or developer tools that make it easier to inspect, debug, or manage Predict markets, vault state, and per-user `PredictManager` accounts

Your project could be:

- a user-facing app or trading frontend
- a vault, structured product, or composable token built on top of Predict
- a bot, keeper, or arbitrage service
- a developer tool, SDK, analytics dashboard

### Minimum requirement

In order to be qualified, your project needs to

- Integrate deepbook predict contract on testnet.
- Work end to end if you are building a product, we will test the entire flow.
- Have proper simulation result if you are building a vault strategy.

## Idea bank

Pick one, twist it, or ignore it entirely — these are starting points, not a checklist.

### Vaults & structured products

1. Range Ladder Vault. Auto-deposits user funds into a strip of Predict ranges around the at-the-money strike at each new expiry, then auto-rolls into the next expiry on settlement. Issue a tokenized share so the position is portable across Sui DeFi. Hooks for hackers: pick the strike-width policy (fixed bps, 1σ from SVI, dynamic on realized vol), decide how to handle deep-ITM/OTM rolls, expose a withdrawal queue.

2. PLP + Hedge Vault. Supply quote into `predict::supply` to earn `PLP` returns, and simultaneously buy out-of-the-money binaries via `predict::mint` to cap left-tail drawdown. The product is "PLP yield minus crash insurance" — a much easier sell to outside LPs than raw PLP. Hooks for hackers: tune the hedge ratio dynamically based on vault utilization, sell the hedges back near expiry, expose a clean APY net of insurance cost.

3. BTC-collateral Predict Vault. Accept BTC (xBTC, sBTC, whatever's live), route through DeepBook spot to convert to dUSDC, deposit into a `PredictManager`, run a directional or range strategy, and return BTC-denominated yield to the user. Hooks for hackers: choose the strategy (delta-neutral premia harvest vs. directional momentum), price the FX leg honestly, handle settlement-day swap-back.

4. Three-Protocol Margin Loop. Borrow dUSDC on `deepbook_margin` against an `iron_bank` USDsui share token, deploy the borrow into Predict ranges, repay from settlement payouts. One team, three protocol logos — a flagship "this is what Sui DeFi composability actually looks like" demo. Hooks for hackers: design the liquidation path, bound LTV against worst-case Predict outcomes, expose a single PTB that opens the whole stack atomically.

### Frontends & consumer apps

5. Telegram Quick-Predict Bot. Commands like `/up 70k 15m 100usdc` resolve to a `predict::mint`, an inline keyboard offers "redeem now / show PnL / share to group," and settlement triggers a DM with the result. Lowest-friction onboarding for non-crypto-native users — the bot creates a `PredictManager` on first use and faucets dUSDC behind the scenes. Hooks for hackers: group-chat tournaments, copy-trading another user's bot wallet, leaderboards inside a single chat.

6. Streaks & Leaderboard PWA. Daily binary picks ("BTC up or down by close"), per-user streaks, weekly prize pools. Gamified retention loop on top of Predict's mint/redeem flow. Hooks for hackers: NFT badges for streaks, social graph from on-chain manager-to-manager interactions, mobile-first install flow.

### Bots, keepers, and arbitrage

7. Vol-Arb Bot: Predict ↔ Polymarket. Back-solves Predict's implied vol from `OracleSVI` (or directly evaluates the SVI params), compares against Polymarket BTC option smile at the matching expiry, and trades the spread when it exceeds a threshold. Stretch: delta-hedge the binary on Hyperliquid perps so the bot's PnL is pure vol edge. This is the single most realistic mainnet-day-one strategy — and it doubles as live stress test of the SVI feeder. Hooks for hackers: handle stale SVI updates gracefully, size by Kelly fraction, add a kill switch on feeder lag.

8. Settled-Redeem Keeper Network. Watches for settled oracles, scans the indexer for un-redeemed positions and ranges, and calls `predict::redeem_permissionless` in a single PTB to claim payouts on behalf of the owner — splitting a tip from the payout. Trivial to start, runs unattended, generates lots of low-friction testnet tx. Hooks for hackers: multi-keeper coordination so they don't collide on the same position, MEV-resistant submission, opt-in vs. opt-out tipping policies.

### Analytics & developer tooling

9. Predict Surface Studio. Live 3-D volatility surface (strike × expiry → IV) streamed from `oracle::OracleSVIUpdated` events, with a time-travel slider for replaying recent updates and an arbitrage-free checker that flags butterfly or calendar violations. A recruiting tool for sophisticated traders to sanity-check the protocol. Hooks for hackers: side-by-side comparison vs. Polymarket smile, alerts on smile shape change, embeddable widget for other Sui frontends.

10. PLP Risk Dashboard. Vault utilization, withdrawal-limiter token-bucket state, per-oracle exposure breakdown, and a "what-if" scenario simulator showing PLP PnL under a ±5σ BTC move. Directly addresses the "is PLP safe?" question that gates serious LP TVL. Hooks for hackers: historical drawdown replay, per-strike heatmap of vault inventory, exportable risk reports for institutional LPs.

## References to use:

- DeepBook Predict codebase (protocol, current testnet deployment, integration model)
    - remember to use branch `predict-testnet-4-16` instead of `main` branch
- Deepbook sandbox (1 line deployment of entire deepbook stack on your local machine, predict support coming soon)
- Deepbook predict doc
- Deepbook v3 doc
- Deepbook margin doc

### Join the DeepBook Builder Group

For questions, discussions, and direct support from the DeepBook team, join the official Telegram group: https://go.sui.io/ofw-deepbook-tg




Sui Overflow 2026
MAY 7 - JUN 20
$500,000 Prize Pool
DESCRIPTION
- SPONSORED BY - 
Headline Partner: Walrus
Track Sponsor: DeepBook
Prize Sponsor: OpenZeppelin
Prize Sponsor: OtterSec
University Award Sponsor: Scallop

Sui Overflow 2026 is Sui's flagship global hackathon, bringing together builders worldwide to ship real, production-ready applications. With over $500,000 in prizes, this year's hackathon rewards strong execution, real-world use cases, and projects built to last beyond the event. 

Participant Handbook: https://go.sui.io/overflow26-participant-handbook
Join Telegram: https://go.sui.io/suioverflow2026-tg
TRACKS
The Agentic Web
CORE TRACK PRIZES
DeFi & Payments
Special - Walrus
Special - DeepBook
PRIZES
1
$30,000
2
$15,000
3
$10,000
4
$7,500

https://www.deepsurge.xyz/hackathons/b587dc0c-4cb8-4e63-ada5-519df38103bf