// GET /api/agent-events?policy_id=0x…  (Server-Sent Events)
//
// Live bridge from the trader process to the dashboard. The trader
// appends one NDJSON line per lifecycle beat to
// .cursors/agent-events.ndjson (see agents/workforce/lib/agent-events.ts);
// this route tails the file and re-streams matching lines so the Mind
// canvas animates each step of a decision as it happens · observe →
// signals → SVI → decision → mint → Walrus → delivered.
//
// Why a file tail and not an in-process emitter: the trader runs as a
// separate pm2 process. A shared append-only file is the simplest
// bridge that survives either process restarting and needs no new
// port through Caddy.
//
// Deploy note: Caddy buffers proxied responses by default · the
// /api/agent-events route needs `flush_interval -1` in the reverse_proxy
// block for events to arrive sub-second.

import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), ".cursors", "agent-events.ndjson");
const POLL_MS = 400;
const KEEPALIVE_MS = 15_000;
const REPLAY_LINES = 50;
const MAX_STREAM_MS = 30 * 60 * 1000; // hard cap per connection

type AgentEvent = {
  ts: number;
  seq: number;
  type: string;
  policy_id?: string | null;
  task_id?: string | null;
  asset?: string;
  data?: Record<string, unknown>;
};

function parseLines(chunk: string): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const line of chunk.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as AgentEvent);
    } catch {
      /* torn or rotated line · skip */
    }
  }
  return out;
}

function matches(e: AgentEvent, policyId: string | null): boolean {
  if (!policyId) return true;
  // Policy-scoped events must match; unscoped events (global ticks)
  // pass through so the canvas stays alive between tasks.
  return !e.policy_id || e.policy_id === policyId;
}

export async function GET(req: NextRequest) {
  const policyId = req.nextUrl.searchParams.get("policy_id");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastSize = 0;
      const startedAt = Date.now();

      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };
      const sendEvent = (e: AgentEvent) =>
        send(`data: ${JSON.stringify(e)}\n\n`);

      // Replay the recent tail so a freshly-opened dashboard shows the
      // current decision's steps instead of a blank waterfall.
      try {
        const raw = await fs.readFile(FILE, "utf8");
        lastSize = Buffer.byteLength(raw);
        const recent = parseLines(raw)
          .filter((e) => matches(e, policyId))
          .slice(-REPLAY_LINES);
        for (const e of recent) sendEvent(e);
      } catch {
        /* no event log yet */
      }
      send(`: connected\n\n`);

      const poll = setInterval(async () => {
        if (closed) return;
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        try {
          const stat = await fs.stat(FILE);
          if (stat.size === lastSize) return;
          if (stat.size < lastSize) {
            // Rotation · re-read from the top.
            lastSize = 0;
          }
          const raw = await fs.readFile(FILE, "utf8");
          const fresh = raw.slice(lastSize);
          lastSize = Buffer.byteLength(raw);
          for (const e of parseLines(fresh)) {
            if (matches(e, policyId)) sendEvent(e);
          }
        } catch {
          /* file missing or transient read error · keep polling */
        }
      }, POLL_MS);

      const keepalive = setInterval(() => send(`: ping\n\n`), KEEPALIVE_MS);

      const cleanup = () => {
        closed = true;
        clearInterval(poll);
        clearInterval(keepalive);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
