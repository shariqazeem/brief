// Cross-process re-plan signal — paired with src/app/api/operator/replan/route.ts.
//
// The web app writes pending re-plan requests to .brief/replan-requests.json;
// the agent process polls this file at the top of each cycle and forwards
// any matching request into in-process memory via requestReplan().
//
// File-based signaling is enough at v1: a single agent process, a single
// web process, both on the same filesystem. No queue. No DB. The web side
// is rate-limited by user action (one click → one request), the agent side
// reads at most once per cycle (every 15s).

import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { requestReplan, type ReplanReason } from "./memory.js";

// Resolve at call time, not module-load time. npm scripts can chdir before
// the module is loaded, so capturing process.cwd() at import is brittle.
function replanFilePath(): string {
  return join(process.cwd(), ".brief", "replan-requests.json");
}

type FileShape = Record<string, { reason: ReplanReason; at: number }>;

function readAll(): FileShape {
  if (!existsSync(replanFilePath())) return {};
  try {
    return JSON.parse(readFileSync(replanFilePath(), "utf8")) as FileShape;
  } catch {
    return {};
  }
}

function writeAll(m: FileShape): void {
  try {
    writeFileSync(replanFilePath(), JSON.stringify(m, null, 2), "utf8");
  } catch {
    // ignore — if the file system errors we'll just leave the entry until
    // the next cycle. The user can retry from the UI.
  }
}

/**
 * If there's a pending re-plan request for this policy, forward it into
 * memory and clear it from disk. Idempotent — safe to call every cycle.
 */
export function drainPendingReplan(policyId: string): void {
  const m = readAll();
  const req = m[policyId];
  if (!req) return;
  console.log(
    `[operator] drained replan request for ${policyId.slice(0, 10)}… reason=${req.reason}`,
  );
  requestReplan(policyId, req.reason);
  delete m[policyId];
  writeAll(m);
}
