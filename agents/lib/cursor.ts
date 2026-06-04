import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export type EventCursor = {
  txDigest: string;
  eventSeq: string;
};

export function loadCursor(path: string): EventCursor | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as EventCursor;
  } catch {
    return null;
  }
}

export function saveCursor(path: string, cursor: EventCursor): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cursor));
}
