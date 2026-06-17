// Durable cursor for the trader's open DeepBook spot positions.
//
// Open spot bets live between two transactions across a horizon. We
// persist enough state to (a) auto-close at expiry, (b) recover after
// a process restart, and (c) reconcile with the on-chain BalanceManager
// so we never report a position closed that isn't, or open one that's
// already been settled.
//
// Schema is intentionally append-style: each position is written once on
// open, mutated once on close, and never deleted. The reconciler scans
// the array on boot and reassigns `status` if the BM state contradicts
// the cursor's last write.

import { promises as fs } from "node:fs";
import * as path from "node:path";

const SPOT_POSITIONS_PATH = ".cursors/trader-spot-positions.json";

export type SpotPosition = {
  /** A stable id we generate at open time. */
  id: string;
  /** Task that triggered this bet. */
  taskId: string;
  traderName: string | null;
  /** Asset symbol (SUI, WAL, DEEP). */
  asset: string;
  /** DeepBook pool key (e.g. SUI_DBUSDC). */
  poolKey: string;
  /** Direction the trader bet: UP (long) or DOWN (short). */
  direction: "up" | "down";
  /** Base qty traded (e.g. 1.0 SUI). */
  baseQty: number;
  /** Quote received on open (DOWN) or spent on open (UP), in quote base units. */
  openQuoteBase: string;
  /** Open tx digest. */
  openTxDigest: string;
  /** Operator policy that gated this open. */
  policyId: string;
  openedAtMs: number;
  /** Auto-close target (ms since epoch). */
  closeAtMs: number;
  /** Strategy id that drove the decision. */
  strategy: string;
  /** Status · open until closed; failed only when the OPEN itself reverted. */
  status: "open" | "closed" | "failed";
  /** Set on close · close tx digest. */
  closeTxDigest?: string;
  /** Quote received on close (UP) or spent on close (DOWN). */
  closeQuoteBase?: string;
  /** Realized P&L in quote base units (positive = profit). */
  realizedPnlBase?: string;
  closedAtMs?: number;
};

export async function loadSpotPositions(): Promise<SpotPosition[]> {
  try {
    const raw = await fs.readFile(SPOT_POSITIONS_PATH, "utf8");
    return JSON.parse(raw) as SpotPosition[];
  } catch {
    return [];
  }
}

export async function saveSpotPositions(xs: SpotPosition[]): Promise<void> {
  await fs.mkdir(path.dirname(SPOT_POSITIONS_PATH), { recursive: true });
  await fs.writeFile(SPOT_POSITIONS_PATH, JSON.stringify(xs, null, 2));
}

/** Append a new open position. Idempotent on taskId · if a position
 *  already exists for this task we don't double-write. */
export async function appendSpotPosition(p: SpotPosition): Promise<void> {
  const all = await loadSpotPositions();
  if (all.some((x) => x.taskId === p.taskId)) return;
  all.push(p);
  await saveSpotPositions(all);
}

/** Update a position with close-side fields. */
export async function markSpotPositionClosed(
  id: string,
  close: {
    closeTxDigest: string;
    closeQuoteBase: bigint;
    realizedPnlBase: bigint;
  },
): Promise<void> {
  const all = await loadSpotPositions();
  const idx = all.findIndex((x) => x.id === id);
  if (idx < 0) return;
  all[idx] = {
    ...all[idx]!,
    status: "closed",
    closeTxDigest: close.closeTxDigest,
    closeQuoteBase: close.closeQuoteBase.toString(),
    realizedPnlBase: close.realizedPnlBase.toString(),
    closedAtMs: Date.now(),
  };
  await saveSpotPositions(all);
}

/** Find spot positions still flagged open whose horizon has elapsed. */
export async function dueSpotPositions(nowMs: number): Promise<SpotPosition[]> {
  const all = await loadSpotPositions();
  return all.filter((x) => x.status === "open" && x.closeAtMs <= nowMs);
}
