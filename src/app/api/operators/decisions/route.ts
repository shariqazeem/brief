// GET /api/operators/decisions?policy_id=0x…
//
// Serves an operator's decision archive · the full, replayable story of every
// decision it has made (what it saw, remembered, feared, concluded, and how it
// turned out). Read from the same `.cursors/operator-experience-*.json` the
// trader writes (server fs), newest first. Powers the Brain / Decision Replay
// page. CORS is added by the VM's Caddy reverse proxy.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX = /^0x[0-9a-fA-F]{2,}$/;

export async function GET(req: NextRequest) {
  const policyId = req.nextUrl.searchParams.get("policy_id") ?? "";
  if (!HEX.test(policyId)) {
    return NextResponse.json({ ok: false, error: "policy_id must be a 0x… id" }, { status: 400 });
  }
  // Same naming the trader's experience store uses.
  const file = path.join(
    process.cwd(),
    ".cursors",
    `operator-experience-${policyId.slice(2, 14)}.json`,
  );
  let recs: Record<string, unknown>[] = [];
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) recs = parsed as Record<string, unknown>[];
  } catch {
    /* no decisions yet · empty archive */
  }
  // Newest first for the timeline.
  const decisions = recs.slice().reverse();
  return NextResponse.json(
    { ok: true, count: decisions.length, decisions },
    { headers: { "Cache-Control": "no-store" } },
  );
}
