// GET /api/system/health
//
// One honest snapshot of whether Brief is healthy enough to trade:
// wallet gas levels (from the warden's status file), PredictManager
// dUSDC, price-feed freshness, and event-wire freshness. The dashboard
// uses this for a quiet "Brief is healthy / Brief is low on X" strip;
// judges can hit it directly to see the system tell the truth about
// itself.

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5_000;
let cached: { generatedAtMs: number; payload: Record<string, unknown> } | null =
  null;

type WardenStatus = {
  ts: number;
  wallets: Array<{
    role: string;
    address: string;
    sui_mist: string;
    wal_mist: string;
    below_floor: boolean;
  }>;
  manager_dusdc: number;
  actions: Array<Record<string, unknown>>;
};

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

async function fileAgeMs(p: string): Promise<number | null> {
  try {
    const st = await fs.stat(p);
    return Date.now() - st.mtimeMs;
  } catch {
    return null;
  }
}

export async function GET() {
  if (cached && Date.now() - cached.generatedAtMs < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  const root = process.cwd();
  const warden = await readJson<WardenStatus>(
    path.join(root, ".cursors", "warden-status.json"),
  );
  const priceAgeMs = await fileAgeMs(
    path.join(root, ".cursors", "price-history-btc.json"),
  );
  const eventsAgeMs = await fileAgeMs(
    path.join(root, ".cursors", "agent-events.ndjson"),
  );

  const wallets = (warden?.wallets ?? []).map((w) => ({
    role: w.role,
    sui: Number(w.sui_mist) / 1e9,
    wal: Number(w.wal_mist) / 1e9,
    below_floor: w.below_floor,
  }));
  const lowWallets = wallets.filter((w) => w.below_floor).map((w) => w.role);

  // Price feed is "fresh" within 3 poll cycles (poller runs every 60s).
  const priceFresh = priceAgeMs !== null && priceAgeMs < 3 * 60_000;
  const wardenFresh = warden !== null && Date.now() - warden.ts < 3 * 60_000;

  const problems: string[] = [];
  if (!wardenFresh) problems.push("warden not reporting");
  if (lowWallets.length > 0) problems.push(`low gas: ${lowWallets.join(", ")}`);
  if (!priceFresh) problems.push("price feed stale");
  if (warden && warden.manager_dusdc < 10)
    problems.push("manager dUSDC low · live mints degrade to simulated");

  const payload = {
    ok: true,
    generated_at_ms: Date.now(),
    healthy: problems.length === 0,
    problems,
    wallets,
    manager_dusdc: warden?.manager_dusdc ?? null,
    price_feed_age_ms: priceAgeMs,
    event_wire_age_ms: eventsAgeMs,
    warden_last_tick_ms: warden?.ts ?? null,
    recent_actions: (warden?.actions ?? []).slice(-5),
  };
  cached = { generatedAtMs: Date.now(), payload };
  return NextResponse.json(payload);
}
