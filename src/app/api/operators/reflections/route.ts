// GET /api/operators/reflections?policy_id=0x…
//
// Serves an operator's Daily Performance Reflections · the once-a-day,
// LLM-written self-critique (what worked, what failed, the lesson) the trader
// anchors to Walrus and appends to `.cursors/daily-reflections-<slug>.json`.
// Mirrors the decisions/ledger routes: read from server fs, newest first.
// Powers the Evolution page's "Daily Reflections" section. CORS is added by
// the VM's Caddy reverse proxy.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX = /^0x[0-9a-fA-F]{2,}$/;

/** The EXACT on-disk schema the daily-reflection writer produces. */
type Reflection = {
  date: string;
  worked: string;
  failed: string;
  lesson: string;
  blobId: string | null;
  walrusUrl: string | null;
  createdMs: number;
};

export async function GET(req: NextRequest) {
  const policyId = req.nextUrl.searchParams.get("policy_id") ?? "";
  if (!HEX.test(policyId)) {
    return NextResponse.json({ ok: false, error: "policy_id must be a 0x… id" }, { status: 400 });
  }
  // Same slug scheme as the experience/ledger/stats cursors.
  const file = path.join(
    process.cwd(),
    ".cursors",
    `daily-reflections-${policyId.slice(2, 14)}.json`,
  );
  let recs: Reflection[] = [];
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) recs = parsed as Reflection[];
  } catch {
    /* no reflections yet · empty (reflections begin after the first full day) */
  }
  // Newest first for the timeline.
  const reflections = recs.slice().reverse();
  return NextResponse.json(
    { ok: true, count: reflections.length, reflections },
    { headers: { "Cache-Control": "no-store" } },
  );
}
