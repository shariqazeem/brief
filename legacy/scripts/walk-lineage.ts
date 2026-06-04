// walk-lineage.ts — off-chain traversal of a WorkObject's ancestor graph.
//
// Usage:
//   tsx --env-file=.env.local scripts/walk-lineage.ts <object-id>

import { loadEnv } from "../agents/lib/env.js";
import { makeAgentContext } from "../agents/lib/sui.js";
import { fetchWorkObject } from "../agents/lib/work-object.js";

async function main() {
  const rootId = process.argv[2];
  if (!rootId) {
    console.error("Usage: tsx scripts/walk-lineage.ts <object-id>");
    process.exit(1);
  }

  const env = loadEnv();
  const ctx = makeAgentContext(env);

  const visited = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }];
  const explorerBase = `https://suiexplorer.com/object`;
  const explorerSuffix = `?network=${env.network}`;

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    try {
      const obj = await fetchWorkObject(ctx, id);
      const indent = "  ".repeat(depth);
      console.log(
        `${indent}${obj.kind.padEnd(10)} ${id.slice(0, 12)}… owner=${obj.owner?.slice(
          0,
          10,
        )}… parents=${obj.parentIds.length}`,
      );
      console.log(`${indent}  ${explorerBase}/${id}${explorerSuffix}`);

      for (const parent of obj.parentIds) {
        queue.push({ id: parent, depth: depth + 1 });
      }
    } catch (e) {
      console.error(`failed to fetch ${id}:`, (e as Error)?.message ?? e);
    }
  }

  console.log(`\nTotal nodes in lineage: ${visited.size}`);
}

main().catch((e: unknown) => {
  console.error("walk failed:", (e as Error)?.message ?? e);
  process.exit(1);
});
