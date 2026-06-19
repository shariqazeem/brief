// Decentralized memory · Walrus, not the server.
//
// Brief already ANCHORS the operator's memory to Walrus as it runs:
//   - per-decision AI reasoning   (schema brief.ai-reasoning.v1) → stored as
//     `detail.aiBlobId` on each experience record
//   - daily self-reflections      (schema brief.daily-reflection.v1) → stored
//     as `blobId` in .cursors/daily-reflections-<slug>.json with a `lesson`
//
// This module makes the claim "if the server dies, a new agent recovers its
// memory from Walrus" literally TRUE by doing two things:
//
//   1. aggregateWalrusMemory()  · gather the operator's REAL Walrus blob
//      references (reflections + AI reasoning) from the local cursors into one
//      normalized, newest-first list. The blob IDs are content-addressed on
//      Walrus · the cursor only remembers WHERE the memory lives, not the
//      memory itself.
//
//   2. recoverMemoryFromWalrus() · on boot, best-effort READ those blobs back
//      FROM the Walrus aggregator (not the local file) and parse out the
//      lessons. This is the proof: the memory survives without the server,
//      because a fresh process can reconstruct it from the chain-backed store.
//
// Honesty: REAL blob IDs only. If the operator has anchored nothing yet, the
// list is empty · the UI shows an honest empty state. Nothing is fabricated.
//
// Safety: the recovery path is fully fail-open — timeout-bounded, never throws,
// returns [] and logs a warning if Walrus is unreachable. It must NEVER block
// or break the trading loop.

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { walrusReadUrl } from "../../lib/walrus.js";

/** A single REAL Walrus-anchored memory reference. `blobId` is content-addressed
 *  on Walrus; `walrusUrl` resolves it via the public aggregator. */
export type MemoryRef = {
  /** Walrus blob id · content-addressed, verifiable, real. */
  blobId: string;
  /** Public aggregator URL to read the blob. */
  walrusUrl: string;
  /** Regime context for the memory, when known ("trending-up", …) or null. */
  regime: string | null;
  /** The human takeaway · the reflection's lesson, or the AI rationale. */
  lesson: string;
  /** Which kind of memory this blob holds. */
  kind: "reflection" | "reasoning";
  /** Epoch ms the memory was produced (for newest-first ordering). */
  ts: number;
};

/** A lesson reconstructed by reading a blob back FROM Walrus on boot. */
export type RecoveredLesson = {
  blobId: string;
  kind: "reflection" | "reasoning";
  /** Parsed takeaway from the blob fetched off Walrus (real, not local). */
  lesson: string;
  regime: string | null;
  ts: number;
};

const slugOf = (policyId: string) => policyId.slice(2, 14);

const reflectionsFile = (cwd: string, slug: string) =>
  path.join(cwd, ".cursors", `daily-reflections-${slug}.json`);
const experienceFile = (cwd: string, slug: string) =>
  path.join(cwd, ".cursors", `operator-experience-${slug}.json`);

/** On-disk reflection shape (mirrors daily-reflection.ts / the reflections route). */
type ReflectionRow = {
  date?: string;
  lesson?: string;
  blobId?: string | null;
  walrusUrl?: string | null;
  createdMs?: number;
};

/** On-disk experience record subset we need (mirrors experience.ts). */
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
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as T[]) : [];
  } catch {
    return []; // no file yet → honest empty (operator hasn't anchored anything)
  }
}

/**
 * Aggregate an operator's REAL Walrus-anchored memory references into one
 * normalized list, newest-first, deduped by blobId. Pure (filesystem read of
 * the same cursors the agent + API both see). REAL data only — entries without
 * a blob id are skipped, so an operator that hasn't anchored anything yet
 * returns [].
 *
 * `cwd` defaults to process.cwd() so this works identically from the agent
 * (run at repo root) and the Next.js API route (also process.cwd()).
 */
export async function aggregateWalrusMemory(
  policyId: string,
  cwd: string = process.cwd(),
): Promise<MemoryRef[]> {
  const slug = slugOf(policyId);

  const [reflections, experience] = await Promise.all([
    readJsonArray<ReflectionRow>(reflectionsFile(cwd, slug)),
    readJsonArray<ExperienceRow>(experienceFile(cwd, slug)),
  ]);

  const refs: MemoryRef[] = [];

  // Daily reflections · each anchored reflection carries a real blob id + lesson.
  for (const r of reflections) {
    const blobId = r.blobId;
    const lesson = (r.lesson ?? "").trim();
    if (!blobId || !lesson) continue; // placeholders / un-anchored days → skip
    refs.push({
      blobId,
      walrusUrl: r.walrusUrl || walrusReadUrl(blobId),
      regime: null,
      lesson,
      kind: "reflection",
      ts: r.createdMs ?? (r.date ? Date.parse(r.date + "T00:00:00Z") || 0 : 0),
    });
  }

  // Per-decision AI reasoning · records whose decision was shaped by the LLM
  // advisor anchored the full prompt+response to Walrus as detail.aiBlobId.
  for (const e of experience) {
    const blobId = e.detail?.aiBlobId;
    if (!blobId) continue; // only records with a REAL anchored AI-reasoning blob
    const lesson = (e.detail?.aiRationale || e.detail?.verdict || "").trim();
    refs.push({
      blobId,
      walrusUrl: walrusReadUrl(blobId),
      regime: e.regimeKind ?? null,
      lesson: lesson || "AI-shaped decision anchored on Walrus.",
      kind: "reasoning",
      ts: e.ts ?? 0,
    });
  }

  // Newest first, then dedupe by blobId (keep the first / newest occurrence).
  refs.sort((a, b) => b.ts - a.ts);
  const seen = new Set<string>();
  const deduped: MemoryRef[] = [];
  for (const r of refs) {
    if (seen.has(r.blobId)) continue;
    seen.add(r.blobId);
    deduped.push(r);
  }
  return deduped;
}

/** Fetch one blob's bytes from the Walrus aggregator, timeout-bounded. Returns
 *  null on any failure (404 while propagating, network blip, timeout). */
async function fetchBlobText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Pull a human lesson out of a blob fetched off Walrus, by schema. */
function lessonFromBlob(text: string, ref: MemoryRef): string | null {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (ref.kind === "reflection") {
      const lesson = typeof j.lesson === "string" ? j.lesson.trim() : "";
      return lesson || null;
    }
    // reasoning blob (brief.ai-reasoning.v1): the rationale lives in the
    // response/decision; fall back to the local rationale we already had.
    const decision = (j.decision ?? {}) as Record<string, unknown>;
    const resp = typeof j.response === "string" ? j.response : "";
    const dir = typeof decision.direction === "string" ? decision.direction : "";
    const summary = [dir && `direction=${dir}`, resp && resp.slice(0, 120)]
      .filter(Boolean)
      .join(" · ");
    return summary || ref.lesson || null;
  } catch {
    // Not JSON (e.g. a markdown snapshot) · the raw head is still a real recovery.
    const head = text.trim().slice(0, 140);
    return head || null;
  }
}

/**
 * BOOT RECOVERY · prove the memory survives the server.
 *
 * Best-effort: fetch the operator's most recent anchored memory blobs FROM
 * Walrus (the public aggregator, NOT the local file) and return the lessons a
 * fresh agent reconstructs. This is the demoable "a new agent reads its past
 * from Walrus" moment.
 *
 * Fully fail-open: every fetch is timeout-bounded, the whole thing is wrapped
 * in try/catch, and it returns [] (never throws) if Walrus is unreachable or
 * the operator has anchored nothing. Logs a single observable line:
 *   [walrus-memory] recovered N lessons from Walrus for <slug>
 */
export async function recoverMemoryFromWalrus(
  policyId: string,
  opts: { max?: number; perBlobTimeoutMs?: number; cwd?: string } = {},
): Promise<RecoveredLesson[]> {
  const slug = slugOf(policyId);
  const max = opts.max ?? 5;
  const perBlobTimeoutMs = opts.perBlobTimeoutMs ?? 8_000;
  try {
    const refs = (await aggregateWalrusMemory(policyId, opts.cwd)).slice(0, max);
    if (refs.length === 0) {
      console.log(
        `[walrus-memory] recovered 0 lessons from Walrus for ${slug} (no blobs anchored yet)`,
      );
      return [];
    }

    // Read the blobs back FROM Walrus in parallel · this is the real proof the
    // memory is recoverable without the server's local files.
    const results = await Promise.all(
      refs.map(async (ref): Promise<RecoveredLesson | null> => {
        const text = await fetchBlobText(ref.walrusUrl, perBlobTimeoutMs);
        if (text == null) return null; // unreachable / still propagating → skip
        const lesson = lessonFromBlob(text, ref);
        if (!lesson) return null;
        return {
          blobId: ref.blobId,
          kind: ref.kind,
          lesson,
          regime: ref.regime,
          ts: ref.ts,
        };
      }),
    );
    const recovered = results.filter((r): r is RecoveredLesson => r !== null);
    console.log(
      `[walrus-memory] recovered ${recovered.length} lessons from Walrus for ${slug}` +
        (recovered.length < refs.length
          ? ` (${refs.length - recovered.length} blob(s) unreachable/propagating)`
          : ""),
    );
    return recovered;
  } catch (e) {
    // NEVER throw into the trading loop · degrade to "no recovery this boot".
    console.warn(
      `[walrus-memory] recovery skipped for ${slug}: ${String((e as Error)?.message ?? e).slice(0, 140)}`,
    );
    return [];
  }
}
