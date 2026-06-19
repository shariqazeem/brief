// Daily Performance Reflection · the operator's once-a-day self-critique,
// anchored to Walrus so the learning is verifiable, not just claimed.
//
// On the first trader tick after UTC midnight, for each funded (non-withdrawn,
// non-revoked) operator with ≥1 SETTLED decision that day, we ask the LLM to
// critique the day: what worked, what failed, and the lesson. The text is
// anchored to Walrus (tag brief.daily-reflection.v1) and appended to a
// per-operator cursor the Brain page reads.
//
// COST SAFETY · matches the ai-advisor discipline:
//   - Only runs when BRIEF_LLM_MODE=llm AND an LLM key is configured.
//   - At most ONE reflection per operator per UTC day (the date guard is the
//     budget cap · ~1 LLM call/operator/day, far under the weekly LLM budget).
//   - The day marker is recorded BEFORE the LLM call (immediately after we
//     decide to attempt one) so a parse/LLM failure can never retry-storm the
//     same day · we skip that day cleanly and try again tomorrow.
//   - SAFE no-op fallback on any error · never throws into the trader loop.

import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { AgentContext } from "../../lib/sui.js";
import { callLlm, llmMode, DEFAULT_AI_MODEL } from "../../lib/llm.js";
import { activeLlmKey, loadEnv } from "../../lib/env.js";
import {
  hasWalrusFunding,
  uploadToWalrus,
  walrusEnabled,
  walrusReadUrl,
} from "../../lib/walrus.js";
import { loadExperience, type ExperienceRecord } from "./experience.js";

/** The EXACT on-disk schema the frontend reads (per-operator array). */
export type DailyReflection = {
  /** UTC date, "YYYY-MM-DD". */
  date: string;
  worked: string;
  failed: string;
  lesson: string;
  /** Walrus blob id of the anchored reflection text, or null if not anchored. */
  blobId: string | null;
  walrusUrl: string | null;
  createdMs: number;
};

const DIR = ".cursors";
/** Per-operator reflections file · slug = policyId.slice(2, 14) (matches the
 *  experience/ledger/stats/journal cursor scheme). */
const reflectionsFile = (slug: string) =>
  path.join(DIR, `daily-reflections-${slug}.json`);

const REFLECTION_TIMEOUT_MS = 15_000;

export async function loadReflections(slug: string): Promise<DailyReflection[]> {
  try {
    const raw = await fs.readFile(reflectionsFile(slug), "utf8");
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as DailyReflection[]) : [];
  } catch {
    return [];
  }
}

async function saveReflections(slug: string, xs: DailyReflection[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = reflectionsFile(slug) + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(xs, null, 2));
  await fs.rename(tmp, reflectionsFile(slug));
}

/** UTC "YYYY-MM-DD" for a timestamp. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Settled directional decisions that fell on the given UTC day. */
function settledOnDay(experience: ExperienceRecord[], day: string): ExperienceRecord[] {
  return experience.filter(
    (r) =>
      (r.outcome === "win" || r.outcome === "loss") && utcDay(r.ts) === day,
  );
}

/** Compact, factual day summary fed to the LLM (no fabrication · real outcomes). */
function summarizeDay(recs: ExperienceRecord[]): string {
  const wins = recs.filter((r) => r.outcome === "win").length;
  const losses = recs.filter((r) => r.outcome === "loss").length;
  const lines = recs.slice(-12).map((r) => {
    const dir = r.direction.toUpperCase();
    const out =
      r.outcome === "win"
        ? `WON (${((r.outcomePct ?? 0) * 100).toFixed(2)}%)`
        : `LOST (${((r.outcomePct ?? 0) * 100).toFixed(2)}%)`;
    return `- ${r.asset ?? "SUI"} ${dir} @ $${r.mid.toFixed(4)} · conf ${(r.confidence * 100).toFixed(
      0,
    )}% · ${out}`;
  });
  return [
    `Settled directional decisions today: ${recs.length} (${wins}W / ${losses}L).`,
    ...lines,
  ].join("\n");
}

/**
 * Generate (at most) one daily reflection per operator per UTC day. Gated on
 * llmMode==="llm" + a key. Idempotent per (operator, day) via the reflections
 * file. Best-effort Walrus anchoring (tag brief.daily-reflection.v1). Never
 * throws · safe to call inside the trader loop.
 *
 * `slug` MUST be the operator's policyId.slice(2, 14) so the file lines up with
 * its other per-operator cursors.
 */
export async function maybeRunDailyReflection(
  ctx: AgentContext,
  policyId: string,
  slug: string,
): Promise<void> {
  const env = loadEnv();
  if (llmMode(env) !== "llm") return; // mock / no key → no reflection
  const apiKey = activeLlmKey(env);
  if (!apiKey) return;

  const now = Date.now();
  const today = utcDay(now);

  let reflections = await loadReflections(slug);
  if (reflections.some((r) => r.date === today)) return; // already done today

  // Reflect on YESTERDAY (a complete UTC day with settled outcomes). On the
  // first tick after midnight, that's the day that just closed.
  const yesterday = utcDay(now - 24 * 60 * 60 * 1000);
  if (reflections.some((r) => r.date === yesterday)) return; // already reflected

  const experience = await loadExperience(policyId);
  const dayRecs = settledOnDay(experience, yesterday);
  if (dayRecs.length === 0) return; // nothing settled → nothing to reflect on

  // Reserve the day NOW (before the LLM call) so a parse/LLM failure can't
  // retry the same day every tick and burn the budget · matches the ai-advisor
  // "set the rate-limit immediately" fix. We write a placeholder that records
  // the date; if generation succeeds we overwrite it with the real content.
  const placeholder: DailyReflection = {
    date: yesterday,
    worked: "",
    failed: "",
    lesson: "",
    blobId: null,
    walrusUrl: null,
    createdMs: now,
  };
  reflections = [...reflections, placeholder];
  try {
    await saveReflections(slug, reflections);
  } catch {
    return; // can't even reserve the slot · bail (retry next tick)
  }

  const model = process.env.BRIEF_REFLECTION_MODEL || DEFAULT_AI_MODEL;
  const prompt = [
    `You are an autonomous on-chain trading operator reviewing your own day on Sui DeepBook.`,
    `Here is your settled track record for ${yesterday} (UTC):`,
    summarizeDay(dayRecs),
    ``,
    `Write a brief, honest self-critique. Be specific to the decisions above; do not invent trades or numbers.`,
    `Return ONLY JSON.`,
  ].join("\n");
  const schema = `{"worked":"<=140 chars","failed":"<=140 chars","lesson":"<=140 chars"}`;

  let raw: string;
  try {
    raw = await Promise.race([
      callLlm({ apiKey, model, prompt, jsonSchemaHint: schema, maxTokens: 256 }),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error("daily-reflection timeout")), REFLECTION_TIMEOUT_MS),
      ),
    ]);
  } catch (e) {
    console.warn(
      `[daily-reflection] ${slug} call failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
    );
    return; // placeholder already reserves the day · skip cleanly, no retry storm
  }

  // Loose JSON extraction · pull the first {...} block even if wrapped in prose.
  let j: { worked?: string; failed?: string; lesson?: string };
  try {
    const s = raw.indexOf("{");
    const eIdx = raw.lastIndexOf("}");
    if (s < 0 || eIdx <= s) throw new Error("no JSON object in response");
    j = JSON.parse(raw.slice(s, eIdx + 1));
  } catch (e) {
    console.warn(
      `[daily-reflection] ${slug} parse failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
    );
    return; // keep the placeholder · day is reserved
  }

  const worked = (j.worked ?? "").slice(0, 140);
  const failed = (j.failed ?? "").slice(0, 140);
  const lesson = (j.lesson ?? "").slice(0, 140);
  if (!worked && !failed && !lesson) return; // empty · keep the placeholder

  // Anchor the reflection to Walrus · the learning, verifiable on-chain.
  let blobId: string | null = null;
  let walrusUrl: string | null = null;
  if (walrusEnabled()) {
    try {
      if (await hasWalrusFunding(ctx.client, ctx.address)) {
        const payload = {
          schema: "brief.daily-reflection.v1",
          policyId,
          date: yesterday,
          worked,
          failed,
          lesson,
          settledDecisions: dayRecs.length,
          createdMs: Date.now(),
        };
        const up = await uploadToWalrus(
          new TextEncoder().encode(JSON.stringify(payload, null, 2)),
          ctx.client,
          ctx.keypair,
        );
        blobId = up.blobId;
        walrusUrl = walrusReadUrl(up.blobId);
        console.log(
          `[daily-reflection] ${slug} ${yesterday} anchored blob=${blobId} (${up.uploadMs}ms)`,
        );
      }
    } catch (e) {
      console.warn(
        `[daily-reflection] ${slug} walrus anchor skipped: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
      );
    }
  }

  // Replace the placeholder with the finished reflection (newest at the end ·
  // the frontend sorts). De-dup the date defensively.
  const finished: DailyReflection = {
    date: yesterday,
    worked,
    failed,
    lesson,
    blobId,
    walrusUrl,
    createdMs: Date.now(),
  };
  const current = await loadReflections(slug);
  const without = current.filter((r) => r.date !== yesterday);
  without.push(finished);
  try {
    await saveReflections(slug, without);
  } catch (e) {
    console.warn(
      `[daily-reflection] ${slug} save failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
    );
  }
}
