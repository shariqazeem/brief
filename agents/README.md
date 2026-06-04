# Brief — Agent runtimes

Three reference agents live here. Each is a small Node.js + TypeScript
service that polls Sui for new on-chain events, processes the work, and
mints the next WorkObject on-chain.

| Agent | Reads | Writes | Day to build |
|---|---|---|---|
| `research/` | `Query` WorkObject | `ResearchObject` | Day 7 |
| `strategy/` | `ResearchObject` | `StrategyObject` | Day 8 |
| `execution/` | `StrategyObject` | `ExecutionReceipt` (via DeepBook) | Day 9 |

## Shape of each agent (pattern, not implementation yet)

**Important:** `SuiClient.subscribeEvent` (WebSocket) is deprecated and
scheduled for decommission ~July 2026. All agents poll `queryEvents` with
cursor pagination instead. Sub-10-second latency is achievable at a 3 s
poll interval.

```ts
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { readFileSync, writeFileSync } from "node:fs";

const PKG = process.env.NEXT_PUBLIC_BRIEF_PACKAGE_ID!;
const POLL_MS = 3000;
const CURSOR_FILE = "./.cursor.json"; // one per agent process

const client = new SuiClient({ url: getFullnodeUrl("testnet") });
const keypair = Ed25519Keypair.fromSecretKey(process.env.AGENT_SECRET_KEY!);

let cursor: { txDigest: string; eventSeq: string } | null = (() => {
  try { return JSON.parse(readFileSync(CURSOR_FILE, "utf8")); }
  catch { return null; }
})();

// Long-running poll loop
async function tick() {
  const page = await client.queryEvents({
    query: { MoveEventType: `${PKG}::work_object::WorkObjectMinted` },
    cursor,
    order: "ascending",
    limit: 50,
  });

  for (const event of page.data) {
    // Filter: only events for the input type this agent consumes
    const parsed = event.parsedJson as { id: string; object_type: string };
    if (parsed.object_type !== INPUT_TYPE) continue;

    // 1. Fetch the full WorkObject; deserialize payload (or pull from Walrus)
    const input = await fetchAndDecode(parsed.id);

    // 2. Run the agent's logic (LLM call, real-data API, etc.)
    const output = await produce(input);

    // 3. Mint the output as a new WorkObject parented to the input
    const tx = new Transaction();
    tx.moveCall({
      target: `${PKG}::work_object::mint`,
      arguments: [
        tx.pure.address(input.owner),
        tx.pure.string(OUTPUT_TYPE),
        tx.pure.u64(1),
        tx.pure.vector("u8", serialize(output)),
        tx.pure.option("string", null), // or Walrus blob id
        tx.pure.vector("id", [input.id]),
        tx.pure.u64(BASE_PRICE),
      ],
    });
    await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });
  }

  // Persist cursor so a crash + restart resumes without re-processing
  if (page.nextCursor) {
    cursor = page.nextCursor;
    writeFileSync(CURSOR_FILE, JSON.stringify(cursor));
  }
}

setInterval(tick, POLL_MS);
```

## Cursor persistence — why it matters

The cursor is the agent's restart-safe memory of "the last event I
handled." Without it, an agent that crashes and restarts will either:

- re-process events it already handled (duplicate mints; wasted SUI), or
- skip events that arrived during downtime (missing WorkObjects in the
  chain).

One `cursor.json` file per agent process. Stored alongside the agent's
keypair env file. Day-11 hardening task in the locked plan.

## Why each agent is separate

Each agent runs as its own process so failures are isolated. A crashing
StrategyAgent does not take down the ResearchAgent. Each holds its own
keypair (registered in `agent_registry`) and earns its own SUI.

In production these could move to long-running pm2/k8s workers; for the
hackathon demo they are local Node processes started by a `package.json`
script in the project root.

## What we are NOT doing

- Not using `SuiClient.subscribeEvent` (deprecated, WS decommission planned)
- Not generalizing into a shared `Agent` base class until two agents exist
- Not adding a queue / message broker — direct polling is fine for 3 agents
- Not adding retry middleware — let crashes bubble up, restart via shell `until` loop in Week 2
