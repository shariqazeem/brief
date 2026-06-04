// One-shot: fetch a tx and print its effects status (success or abort code).
// Usage: tsx --env-file=.env.local scripts/check-tx.ts <tx-digest>
import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";

async function main(): Promise<void> {
  const digest = process.argv[2];
  if (!digest) throw new Error("usage: check-tx.ts <tx-digest>");
  const ctx = makeAgentContext(loadEnv());
  const tx = await ctx.client.getTransactionBlock({
    digest,
    options: { showEffects: true, showEvents: true, showInput: true },
  });
  const status = tx.effects?.status;
  console.log(`digest    ${digest}`);
  console.log(`status    ${status?.status ?? "unknown"}`);
  if (status?.error) {
    console.log(`error     ${status.error}`);
  }
  const events = tx.events ?? [];
  console.log(`events    ${events.length}`);
  for (const ev of events.slice(0, 5)) {
    console.log(`  ${ev.type}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
