// POST /api/workforce/missions — append a mission to the queue.
// GET  /api/workforce/missions?policy_id=… — fetch missions for a policy.
//
// Wk1 implementation: file-backed JSON queue at .brief/missions.json.
// The planner-service (added Day 9+) tails this file and runs decompose
// + post on each new mission. For Day 8 scaffold, the file is the source
// of truth; users can also paste the CLI command shown in the UI as a
// fallback.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

type Mission = {
  policy_id: string;
  mission: string;
  target_package_id?: string;
  bounty_sui?: number;
  max_subtasks?: number;
  queued_at_ms: number;
  status: "pending" | "running" | "complete" | "failed";
};

const QUEUE_PATH = join(process.cwd(), ".brief", "missions.json");
const MAX_MISSION_LEN = 1600;

function ensureFile(): void {
  try {
    mkdirSync(dirname(QUEUE_PATH), { recursive: true });
  } catch {
    /* ignore */
  }
  if (!existsSync(QUEUE_PATH)) {
    writeFileSync(QUEUE_PATH, "[]", "utf8");
  }
}

function loadQueue(): Mission[] {
  ensureFile();
  try {
    const raw = readFileSync(QUEUE_PATH, "utf8");
    return JSON.parse(raw) as Mission[];
  } catch {
    return [];
  }
}

function saveQueue(q: Mission[]): void {
  ensureFile();
  writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2), "utf8");
}

export async function POST(req: Request): Promise<Response> {
  let body: Partial<Mission> & { policyId?: string; targetPackageId?: string; bountySui?: number; maxSubtasks?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const policy_id = body.policy_id ?? body.policyId;
  const mission = body.mission;
  if (!policy_id || typeof policy_id !== "string" || !policy_id.startsWith("0x")) {
    return Response.json({ error: "policy_id must be a 0x… string" }, { status: 400 });
  }
  if (!mission || typeof mission !== "string" || mission.length === 0) {
    return Response.json({ error: "mission must be a non-empty string" }, { status: 400 });
  }
  if (mission.length > MAX_MISSION_LEN) {
    return Response.json({ error: `mission must be ≤ ${MAX_MISSION_LEN} chars` }, { status: 400 });
  }
  const entry: Mission = {
    policy_id,
    mission,
    target_package_id: body.target_package_id ?? body.targetPackageId,
    bounty_sui: body.bounty_sui ?? body.bountySui,
    max_subtasks: body.max_subtasks ?? body.maxSubtasks,
    queued_at_ms: Date.now(),
    status: "pending",
  };
  const queue = loadQueue();
  queue.push(entry);
  saveQueue(queue);
  return Response.json({ ok: true, queuedAt: entry.queued_at_ms });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const policyId = url.searchParams.get("policy_id");
  const queue = loadQueue();
  const filtered = policyId
    ? queue.filter((m) => m.policy_id === policyId)
    : queue;
  return Response.json({ missions: filtered });
}
