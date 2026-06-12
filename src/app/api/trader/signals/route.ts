// GET /api/trader/signals?asset=BTC&minutes=60
//
// Chart feed for the Mind canvas: the rolling price series the trader
// actually computed its signals from (same .cursors history file the
// agent reads), enriched with per-point SMA15/SMA60/RSI60 so the chart
// overlays are bit-faithful to the agent's own math. Served from our
// box so 100 dashboards don't each devInspect the fullnode.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PricePoint = { ts: number; price: number };

type SeriesPoint = {
  ts: number;
  price: number;
  sma15: number | null;
  sma60: number | null;
  rsi60: number | null;
};

const ASSETS = new Set(["BTC", "SUI", "WAL", "DEEP"]);
const CACHE_TTL_MS = 10_000;

const cache = new Map<
  string,
  { generatedAtMs: number; payload: Record<string, unknown> }
>();

function windowed(history: PricePoint[], endIdx: number, lookbackMs: number): PricePoint[] {
  const endTs = history[endIdx]!.ts;
  const cutoff = endTs - lookbackMs;
  const out: PricePoint[] = [];
  for (let i = endIdx; i >= 0; i--) {
    if (history[i]!.ts < cutoff) break;
    out.push(history[i]!);
  }
  return out.reverse();
}

// Same definitions as agents/workforce/trader/signals.ts — window
// average and gains/losses RSI over the trailing window at each point.
function smaAt(history: PricePoint[], endIdx: number, lookbackMs: number): number | null {
  const w = windowed(history, endIdx, lookbackMs);
  if (w.length < 2) return null;
  return w.reduce((a, p) => a + p.price, 0) / w.length;
}

function rsiAt(history: PricePoint[], endIdx: number, lookbackMs: number): number | null {
  const w = windowed(history, endIdx, lookbackMs);
  if (w.length < 4) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < w.length; i++) {
    const diff = w[i]!.price - w[i - 1]!.price;
    if (diff > 0) gains += diff;
    else losses += -diff;
  }
  if (gains + losses === 0) return 50;
  const rs = losses === 0 ? Infinity : gains / losses;
  return 100 - 100 / (1 + rs);
}

function rocFrom(history: PricePoint[], nowMs: number, lookbackMs: number): number | null {
  if (history.length === 0) return null;
  const target = nowMs - lookbackMs;
  let past: PricePoint | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.ts <= target) {
      past = history[i]!;
      break;
    }
  }
  if (!past || past.price === 0) return null;
  const cur = history[history.length - 1]!.price;
  return (cur - past.price) / past.price;
}

export async function GET(req: NextRequest) {
  const asset = (req.nextUrl.searchParams.get("asset") ?? "BTC").toUpperCase();
  if (!ASSETS.has(asset)) {
    return NextResponse.json({ ok: false, error: "unknown asset" }, { status: 400 });
  }
  const minutes = Math.max(
    10,
    Math.min(240, Number(req.nextUrl.searchParams.get("minutes") ?? 60) || 60),
  );

  const key = `${asset}:${minutes}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.generatedAtMs < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload);
  }

  let history: PricePoint[] = [];
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), ".cursors", `price-history-${asset.toLowerCase()}.json`),
      "utf8",
    );
    const arr = JSON.parse(raw) as PricePoint[];
    if (Array.isArray(arr)) history = arr;
  } catch {
    /* cold history — return an empty, renderable series */
  }

  const nowMs = Date.now();
  const cutoff = nowMs - minutes * 60_000;
  const points: SeriesPoint[] = [];
  for (let i = 0; i < history.length; i++) {
    const p = history[i]!;
    if (p.ts < cutoff) continue;
    points.push({
      ts: p.ts,
      price: p.price,
      sma15: smaAt(history, i, 15 * 60_000),
      sma60: smaAt(history, i, 60 * 60_000),
      rsi60: rsiAt(history, i, 60 * 60_000),
    });
  }

  const latest =
    history.length > 0
      ? {
          ts: history[history.length - 1]!.ts,
          spot: history[history.length - 1]!.price,
          roc5: rocFrom(history, nowMs, 5 * 60_000),
          roc30: rocFrom(history, nowMs, 30 * 60_000),
          roc60: rocFrom(history, nowMs, 60 * 60_000),
          rsi60: history.length >= 4 ? rsiAt(history, history.length - 1, 60 * 60_000) : null,
          sma15: smaAt(history, history.length - 1, 15 * 60_000),
          sma60: smaAt(history, history.length - 1, 60 * 60_000),
        }
      : null;

  const payload = {
    ok: true,
    asset,
    generated_at_ms: nowMs,
    points,
    latest,
  };
  cache.set(key, { generatedAtMs: nowMs, payload });
  return NextResponse.json(payload);
}
