// Off-chain objective store. The Move OperatorPolicy can't carry an
// `objective: String` field under our compatible upgrade policy, so the
// user's mission charter lives in a tiny local JSON file on the server,
// keyed by policy id.
//
// POST { policy_id, objective }  → persists
// GET  ?policy_id=…              → reads (or null)
//
// The frontend POSTs after the user signs the grant; the operator agent
// reads via objectives.ts from the same file (`.brief/objectives.json`).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const OBJECTIVES_FILE = join(process.cwd(), ".brief", "objectives.json");

type ObjectivesMap = Record<string, string>;

function readAll(): ObjectivesMap {
  if (!existsSync(OBJECTIVES_FILE)) return {};
  try {
    return JSON.parse(readFileSync(OBJECTIVES_FILE, "utf8")) as ObjectivesMap;
  } catch {
    return {};
  }
}

function writeAll(m: ObjectivesMap): void {
  const dir = dirname(OBJECTIVES_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(OBJECTIVES_FILE, JSON.stringify(m, null, 2), "utf8");
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("policy_id");
  if (!id) {
    return Response.json({ error: "policy_id required" }, { status: 400 });
  }
  const m = readAll();
  return Response.json({ policy_id: id, objective: m[id] ?? null });
}

export async function POST(req: Request): Promise<Response> {
  let body: { policy_id?: unknown; objective?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const policyId = typeof body.policy_id === "string" ? body.policy_id : null;
  const objective =
    typeof body.objective === "string" ? body.objective.slice(0, 240) : null;
  if (!policyId || !objective) {
    return Response.json(
      { error: "policy_id and objective required" },
      { status: 400 },
    );
  }
  const m = readAll();
  m[policyId] = objective;
  writeAll(m);
  return Response.json({ ok: true, policy_id: policyId });
}
