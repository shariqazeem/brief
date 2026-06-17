// GET /api/operators/ledger?policy_id=0x…
//
// Serves an operator's permanent allocation LEDGER (every buy/sell that moved
// capital, with its reason + settled outcome) plus its lifetime STATS (launch
// price for benchmarking, cumulative counts, peak value + worst drawdown).
// Read from the same `.cursors/operator-{ledger,stats}-*.json` the trader
// writes. The ledger is never trimmed · it's the track record.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX = /^0x[0-9a-fA-F]{2,}$/;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function GET(req: NextRequest) {
  const policyId = req.nextUrl.searchParams.get("policy_id") ?? "";
  if (!HEX.test(policyId)) {
    return NextResponse.json({ ok: false, error: "policy_id must be a 0x… id" }, { status: 400 });
  }
  const slug = policyId.slice(2, 14);
  const dir = path.join(process.cwd(), ".cursors");
  const ledger = await readJson<unknown[]>(path.join(dir, `operator-ledger-${slug}.json`), []);
  const stats = await readJson<unknown | null>(path.join(dir, `operator-stats-${slug}.json`), null);

  // Newest first for the UI.
  const events = Array.isArray(ledger) ? ledger.slice().reverse() : [];
  return NextResponse.json(
    { ok: true, count: events.length, ledger: events, stats },
    { headers: { "Cache-Control": "no-store" } },
  );
}
