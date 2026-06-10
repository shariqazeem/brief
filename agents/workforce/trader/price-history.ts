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

/** Cap each history at ~4 hours @ 30 s polling = 480 points. Plenty for
 *  hourly ROC + RSI + SMA(15m / 60m) without bloating the journal. */
const MAX_POINTS = 600;
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
  if (history.length > MAX_POINTS) {
    history.splice(0, history.length - MAX_POINTS);
  }
  await saveHistory(asset, history);
}
