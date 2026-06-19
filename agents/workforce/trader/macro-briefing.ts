// Market Regime Oracle · a budget-safe macro briefing the operator weighs
// alongside its deterministic signals.
//
// Once every ~6 hours (NOT per tick), it asks the LLM for a concise read on
// crypto-wide sentiment, major news, and likely short-term impact on the
// SUI / DEEP / WAL tokens the operators trade. The result is cached to a single
// shared cursor (`.cursors/macro-briefing.json`) and prepended to the AI
// advisor's per-decision prompt so the AI weighs broader conditions.
//
// COST SAFETY · matches the ai-advisor discipline:
//   - Only runs when BRIEF_LLM_MODE=llm AND an LLM key is configured.
//   - Self-throttles to one refresh per 6h (reads the cached updatedAt), so the
//     trader's main loop can call it every tick for free.
//   - The refresh timestamp is written BEFORE the call so a transient failure
//     can never retry-storm the provider.
//   - Hard timeout; SAFE no-op fallback on any error (keep the old file).

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { callLlm, llmMode, DEFAULT_AI_MODEL } from "../../lib/llm.js";
import { activeLlmKey, loadEnv } from "../../lib/env.js";

export type MacroBriefing = {
  summary: string;
  updatedAt: number;
};

const DIR = ".cursors";
const MACRO_PATH = path.join(DIR, "macro-briefing.json");

/** Refresh cadence · one LLM call per 6h, shared across ALL operators. */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Beyond this age the cached briefing is too stale to influence a decision. */
const FRESH_WINDOW_MS = 12 * 60 * 60 * 1000;
/** Hard cap so a slow model never stalls the 15s trader loop. */
const MACRO_TIMEOUT_MS = 15_000;

// In-process guard: the timestamp is set immediately on the file too, but this
// avoids two concurrent ticks both firing a refresh in the same process.
let refreshingUntilMs = 0;

export async function loadMacroBriefing(): Promise<MacroBriefing | null> {
  try {
    const raw = await fs.readFile(MACRO_PATH, "utf8");
    const p = JSON.parse(raw) as MacroBriefing;
    if (p && typeof p.summary === "string" && typeof p.updatedAt === "number") {
      return p;
    }
  } catch {
    /* no briefing yet */
  }
  return null;
}

async function saveMacroBriefing(b: MacroBriefing): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = MACRO_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(b, null, 2));
  await fs.rename(tmp, MACRO_PATH);
}

/** A briefing fresh enough to influence a decision (≤12h old). Null otherwise. */
export async function loadFreshMacroBriefing(): Promise<MacroBriefing | null> {
  const b = await loadMacroBriefing();
  if (!b) return null;
  if (Date.now() - b.updatedAt > FRESH_WINDOW_MS) return null;
  return b;
}

/**
 * Refresh the macro briefing if the cached one is missing or older than 6h.
 * Gated on llmMode==="llm" + a key. Self-throttles · safe to call every tick.
 * Never throws (the trader loop must never break); on any error it leaves the
 * existing file untouched (no-op).
 */
export async function maybeRefreshMacroBriefing(): Promise<void> {
  const env = loadEnv();
  if (llmMode(env) !== "llm") return; // mock / no key → no macro layer
  const apiKey = activeLlmKey(env);
  if (!apiKey) return;

  const now = Date.now();
  if (now < refreshingUntilMs) return; // another tick is already refreshing
  const existing = await loadMacroBriefing();
  if (existing && now - existing.updatedAt < REFRESH_INTERVAL_MS) return; // still fresh

  // Reserve the refresh slot for the full interval BEFORE the call. This is the
  // ai-advisor rate-limit discipline: even if the call fails or never writes,
  // we won't retry until the next interval · no retry-storm on the provider.
  refreshingUntilMs = now + REFRESH_INTERVAL_MS;

  // Same fast non-reasoning model as the advisor (clean output, low latency).
  // Override via BRIEF_MACRO_MODEL.
  const model = process.env.BRIEF_MACRO_MODEL || DEFAULT_AI_MODEL;
  const prompt =
    "Summarize the current crypto market sentiment, major news, and likely " +
    "short-term impact on SUI, DEEP, and WAL tokens. Be concise (max ~120 words).";

  let summary: string;
  try {
    summary = await Promise.race([
      callLlm({
        apiKey,
        model,
        prompt,
        system:
          "You are a concise crypto macro analyst. Plain prose, no preamble, no markdown headers.",
        maxTokens: 256,
      }),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error("macro-briefing timeout")), MACRO_TIMEOUT_MS),
      ),
    ]);
  } catch (e) {
    console.warn(
      `[macro-briefing] refresh failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
    );
    return; // SAFE fallback · keep the old file, retry next interval
  }

  const clean = summary.trim().slice(0, 900);
  if (!clean) return; // empty response · keep the old file
  try {
    await saveMacroBriefing({ summary: clean, updatedAt: Date.now() });
    console.log(`[macro-briefing] refreshed (${clean.length} chars)`);
  } catch (e) {
    console.warn(
      `[macro-briefing] save failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
    );
  }
}
