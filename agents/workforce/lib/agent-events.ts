// Append-only NDJSON event log · the cross-process bridge between the
// trader (pm2 background process) and the web tier's SSE endpoint.
//
// The trader emits one line per lifecycle beat (observe → signals →
// SVI read → decision → mint → Walrus → delivered); the Next.js
// /api/agent-events route tails this file and re-streams matching
// lines to connected dashboards. A file is the simplest bridge that
// survives either process restarting, needs no new port, and doubles
// as a local decision audit log.
//
// Emission is fire-and-forget and serialized through an internal
// queue; an event write must NEVER fail a trade.

import { promises as fs } from "node:fs";
import * as path from "node:path";

const FILE = path.join(".cursors", "agent-events.ndjson");
const MAX_BYTES = 1_500_000;
const KEEP_LINES = 800;

export type AgentEventType =
  | "task_started"
  | "observe"
  | "signals"
  | "svi"
  | "decision"
  | "mode"
  | "mint_pending"
  | "mint_landed"
  | "mint_failed"
  | "spot_opened"
  | "spot_closed"
  | "walrus_uploaded"
  | "delivered"
  | "task_failed"
  | "asset_fallback"
  | "warden_topup"
  | "fuel";

export type AgentEvent = {
  ts: number;
  seq: number;
  type: AgentEventType;
  policy_id?: string | null;
  task_id?: string | null;
  asset?: string;
  data?: Record<string, unknown>;
};

let seq = 0;
let queue: Promise<void> = Promise.resolve();

async function rotateIfNeeded(): Promise<void> {
  try {
    const stat = await fs.stat(FILE);
    if (stat.size <= MAX_BYTES) return;
    const raw = await fs.readFile(FILE, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const kept = lines.slice(-KEEP_LINES).join("\n") + "\n";
    const tmp = FILE + ".tmp";
    await fs.writeFile(tmp, kept);
    await fs.rename(tmp, FILE);
  } catch {
    /* missing file or transient fs error · never escalate */
  }
}

/** Emit a lifecycle event. Fire-and-forget; never throws. */
export function emitAgentEvent(
  type: AgentEventType,
  fields: {
    policyId?: string | null;
    taskId?: string | null;
    asset?: string;
    data?: Record<string, unknown>;
  } = {},
): void {
  seq += 1;
  const event: AgentEvent = {
    ts: Date.now(),
    seq,
    type,
    policy_id: fields.policyId ?? null,
    task_id: fields.taskId ?? null,
    ...(fields.asset ? { asset: fields.asset } : {}),
    ...(fields.data ? { data: fields.data } : {}),
  };
  const line = JSON.stringify(event) + "\n";
  queue = queue
    .then(async () => {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.appendFile(FILE, line);
      if (seq % 50 === 0) await rotateIfNeeded();
    })
    .catch(() => {
      /* swallow · events are best-effort */
    });
}
