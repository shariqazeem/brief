// POST /api/operator/replan — queues a re-plan request for a given policy.
//
// The actual re-plan happens inside the agent process (it composes a new
// plan via the LLM and mints a fresh Strategy WorkObject). We can't reach
// into the agent over JS bindings, so this endpoint writes a tiny signal
// file the agent polls at the top of each cycle. Cross-process signaling
// without a queue, message bus, or persistent IPC.
//
// Body: { policy_id: string, reason: "user_requested" | "exhausted" |
//                                    "regime_shift" | "abort_cluster" }
// On success: 202 Accepted { ok: true, queued_at_ms }

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const REPLAN_FILE = join(process.cwd(), ".brief", "replan-requests.json");

type ReplanReason =
  | "user_requested"
  | "exhausted"
  | "regime_shift"
  | "abort_cluster";

type ReplanRequestsMap = Record<string, { reason: ReplanReason; at: number }>;

function readAll(): ReplanRequestsMap {
  if (!existsSync(REPLAN_FILE)) return {};
  try {
    return JSON.parse(readFileSync(REPLAN_FILE, "utf8")) as ReplanRequestsMap;
  } catch {
    return {};
  }
}

function writeAll(m: ReplanRequestsMap): void {
  const dir = dirname(REPLAN_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(REPLAN_FILE, JSON.stringify(m, null, 2), "utf8");
}

function isReplanReason(v: unknown): v is ReplanReason {
  return (
    v === "user_requested" ||
    v === "exhausted" ||
    v === "regime_shift" ||
    v === "abort_cluster"
  );
}

export async function POST(req: Request): Promise<Response> {
  let body: { policy_id?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const policyId =
    typeof body.policy_id === "string" && body.policy_id.startsWith("0x")
      ? body.policy_id
      : null;
  const reason: ReplanReason = isReplanReason(body.reason)
    ? body.reason
    : "user_requested";
  if (!policyId) {
    return Response.json(
      { error: "policy_id (0x…) required" },
      { status: 400 },
    );
  }

  const m = readAll();
  // De-dupe: if a request for this policy is already queued, leave the
  // original (preserves the first reason for telemetry clarity).
  if (!m[policyId]) {
    m[policyId] = { reason, at: Date.now() };
    writeAll(m);
  }
  return Response.json(
    { ok: true, policy_id: policyId, reason, queued_at_ms: m[policyId]!.at },
    { status: 202 },
  );
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("policy_id");
  const m = readAll();
  if (id) {
    return Response.json({ policy_id: id, request: m[id] ?? null });
  }
  return Response.json({ requests: m });
}
