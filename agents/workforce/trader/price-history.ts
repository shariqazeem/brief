// Per-asset rolling price history, persisted to disk so signals
// survive restarts.
//
// Each asset has its own JSON file under `.cursors/price-history-{asset}.json`.
// Points are appended on every poll cycle; old points are pruned when the
// array grows past MAX_POINTS so the file stays small and reads stay
// fast. Atomic write via tmp+rename so a crash mid-write never leaves
// the file half-parsed (the trader's auto-redeem and close loops cross-
// read these files, so corruption would have blast radius).

import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Keep ~26 hours of history (by age) so a 4h / 24h ROC has an anchor even
 *  right after adoption (seeded by backfillHistory). A hard count cap bounds
 *  the file size if a fast poll ever floods it. At 15 s polling, 26h ≈ 6240
 *  points; the cap is the safety net, not the normal limit. */
const RETAIN_MS = 26 * 60 * 60 * 1000;
const MAX_POINTS = 8000;
const DIR = ".cursors";

export type PricePoint = {
  /** Wall-clock ms when this observation was taken. */
  ts: number;
  /** Price in USD (scaled to a plain float). Spot for Predict oracles;
   *  pool mid for DeepBook spot pools. */
  price: number;
};

function pathFor(asset: string): string {
  return path.join(DIR, `price-history-${asset.toLowerCase()}.json`);
}

export async function loadHistory(asset: string): Promise<PricePoint[]> {
  try {
    const raw = await fs.readFile(pathFor(asset), "utf8");
    const arr = JSON.parse(raw) as PricePoint[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveHistory(asset: string, points: PricePoint[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = pathFor(asset) + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(points));
  await fs.rename(tmp, pathFor(asset));
}

/** Append a fresh observation and prune the oldest entries past MAX_POINTS.
 *  Duplicates of the very last ts are ignored (the poller can fire twice
 *  in the same tick during retries). */
export async function appendPoint(
  asset: string,
  point: PricePoint,
): Promise<void> {
  const history = await loadHistory(asset);
  if (history.length > 0 && history[history.length - 1]!.ts === point.ts) return;
  history.push(point);
  pruneInPlace(history, point.ts);
  await saveHistory(asset, history);
}

/** Drop points older than RETAIN_MS, then enforce the count cap. */
function pruneInPlace(history: PricePoint[], nowMs: number): void {
  const cutoff = nowMs - RETAIN_MS;
  let firstFresh = 0;
  while (firstFresh < history.length && history[firstFresh]!.ts < cutoff) firstFresh++;
  if (firstFresh > 0) history.splice(0, firstFresh);
  if (history.length > MAX_POINTS) history.splice(0, history.length - MAX_POINTS);
}

/** CoinGecko ids for the assets we backfill (verified to return chart data). */
const COINGECKO_ID: Record<string, string> = {
  SUI: "sui",
  WAL: "walrus-2",
  DEEP: "deep",
};

/** Seed an asset's rolling history with ~24h of recent real prices from
 *  CoinGecko, so a freshly-adopted operator isn't blind for the first 30+
 *  minutes and can see multi-hour / daily trends immediately. Best-effort:
 *  on any failure (network, rate-limit, unknown id) it no-ops and the
 *  history warms naturally from live polls. Only seeds when the existing
 *  history is too thin to span the long lookback. */
export async function backfillHistory(historyKey: string, nowMs: number): Promise<number> {
  // historyKey may carry a network suffix ("SUI-mainnet"); the CoinGecko id
  // comes from the bare asset.
  const asset = historyKey.split("-")[0]!.toUpperCase();
  const id = COINGECKO_ID[asset];
  if (!id) return 0;
  const existing = await loadHistory(historyKey);
  // Already have >4h of span? leave it (live data is better than API data).
  if (existing.length > 0 && nowMs - existing[0]!.ts > 4 * 60 * 60 * 1000) return 0;
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return 0;
    const json = (await res.json()) as { prices?: Array<[number, number]> };
    const prices = Array.isArray(json.prices) ? json.prices : [];
    if (prices.length < 6) return 0;
    const seeded: PricePoint[] = prices
      .filter(([ts, p]) => Number.isFinite(ts) && Number.isFinite(p) && p > 0)
      .map(([ts, p]) => ({ ts, price: p }))
      .sort((a, b) => a.ts - b.ts);
    if (seeded.length < 6) return 0;
    // Seed is the base; keep only existing LIVE points NEWER than the seed's
    // last candle (don't lose fresh observations). Save under historyKey.
    const lastSeedTs = seeded[seeded.length - 1]!.ts;
    const freshLive = existing.filter((pt) => pt.ts > lastSeedTs);
    const out = [...seeded, ...freshLive];
    pruneInPlace(out, nowMs);
    await saveHistory(historyKey, out);
    return seeded.length;
  } catch {
    return 0;
  }
}
