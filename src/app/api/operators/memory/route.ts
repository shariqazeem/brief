// GET /api/operators/memory?policy_id=0x…
//
// Serves an operator's DECENTRALIZED MEMORY · the REAL Walrus blob references
// the trader anchors as it runs:
//   - daily self-reflections  (each carries a `lesson` + blobId)  →
//     .cursors/daily-reflections-<slug>.json
//   - per-decision AI reasoning (anchored as detail.aiBlobId)     →
//     .cursors/operator-experience-<slug>.json
//
// Each blobId is content-addressed on Walrus · the cursor only remembers WHERE
// the memory lives, so a fresh agent can recover it from the chain-backed store
// even if this server dies. We read the SAME cursor files the trader writes (and
// the same the reflections/decisions routes read), normalize to one list,
// newest-first. REAL data only · an operator that hasn't anchored anything yet
// returns an empty list (the UI shows an honest empty state). Mirrors the
// sibling routes: nodejs runtime, force-dynamic, hex validation, no-store. CORS
// is added by the VM's Caddy reverse proxy.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX = /^0x[0-9a-fA-F]{2,}$/;
const MAX_BLOBS = 12;

const WALRUS_TESTNET_AGGREGATOR =
  "https://aggregator.walrus-testnet.walrus.space";
/** Public aggregator URL for a Walrus blob (mirrors agents/lib/walrus.ts). */
const walrusReadUrl = (blobId: string) =>
  `${WALRUS_TESTNET_AGGREGATOR}/v1/blobs/${blobId}`;

/** The normalized memory reference the frontend consumes verbatim. */
type MemoryRef = {
  blobId: string;
  walrusUrl: string;
  regime: string | null;
  lesson: string;
  kind: "reflection" | "reasoning";
  ts: number;
};

/** On-disk reflection row (mirrors daily-reflection.ts / reflections route). */
type ReflectionRow = {
  date?: string;
  lesson?: string;
  blobId?: string | null;
  walrusUrl?: string | null;
  createdMs?: number;
};

/** On-disk experience row subset (mirrors experience.ts). */
type ExperienceRow = {
  ts?: number;
  regimeKind?: string;
  detail?: {
    aiBlobId?: string | null;
    aiRationale?: string | null;
    verdict?: string | null;
  };
};

async function readJsonArray<T>(file: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return []; // no file yet → honest empty (operator hasn't anchored anything)
  }
}

export async function GET(req: NextRequest) {
  const policyId = req.nextUrl.searchParams.get("policy_id") ?? "";
  if (!HEX.test(policyId)) {
    return NextResponse.json(
      { ok: false, error: "policy_id must be a 0x… id" },
      { status: 400 },
    );
  }

  // Same slug scheme as the experience/reflections/ledger cursors.
  const slug = policyId.slice(2, 14);
  const reflectionsFile = path.join(
    process.cwd(),
    ".cursors",
    `daily-reflections-${slug}.json`,
  );
  const experienceFile = path.join(
    process.cwd(),
    ".cursors",
    `operator-experience-${slug}.json`,
  );

  const [reflections, experience] = await Promise.all([
    readJsonArray<ReflectionRow>(reflectionsFile),
    readJsonArray<ExperienceRow>(experienceFile),
  ]);

  const blobs: MemoryRef[] = [];

  // Daily reflections · each anchored reflection has a real blob id + lesson.
  for (const r of reflections) {
    const blobId = r.blobId;
    const lesson = (r.lesson ?? "").trim();
    if (!blobId || !lesson) continue; // placeholders / un-anchored days → skip
    blobs.push({
      blobId,
      walrusUrl: r.walrusUrl || walrusReadUrl(blobId),
      regime: null,
      lesson,
      kind: "reflection",
      ts: r.createdMs ?? (r.date ? Date.parse(r.date + "T00:00:00Z") || 0 : 0),
    });
  }

  // Per-decision AI reasoning · records the LLM advisor shaped anchored the full
  // prompt+response to Walrus as detail.aiBlobId.
  for (const e of experience) {
    const blobId = e.detail?.aiBlobId;
    if (!blobId) continue; // only records with a REAL anchored AI-reasoning blob
    const lesson = (e.detail?.aiRationale || e.detail?.verdict || "").trim();
    blobs.push({
      blobId,
      walrusUrl: walrusReadUrl(blobId),
      regime: e.regimeKind ?? null,
      lesson: lesson || "AI-shaped decision anchored on Walrus.",
      kind: "reasoning",
      ts: e.ts ?? 0,
    });
  }

  // Newest first, dedupe by blobId, cap at MAX_BLOBS.
  blobs.sort((a, b) => b.ts - a.ts);
  const seen = new Set<string>();
  const out: MemoryRef[] = [];
  for (const b of blobs) {
    if (seen.has(b.blobId)) continue;
    seen.add(b.blobId);
    out.push(b);
    if (out.length >= MAX_BLOBS) break;
  }

  return NextResponse.json(
    { ok: true, count: out.length, blobs: out },
    { headers: { "Cache-Control": "no-store" } },
  );
}
