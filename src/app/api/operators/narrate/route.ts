// POST /api/operators/narrate
//
// On-demand, plain-English narration of ONE decision. Budget-safe by design:
//   • Only ever called from the Brain "Narrate" button · NEVER from the 24/7
//     trading loop (CommonStack credits are scarce: ~$0.50/week).
//   • If COMMONSTACK_API_KEY is unset, returns a deterministic summary composed
//     from the real decision fields · useful out of the box, zero spend.
//   • If set, makes exactly ONE CommonStack call per request.
//
// The narration only rephrases the operator's REAL reasoning + outcome · it
// never invents facts; the deterministic path proves that.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  regime?: string;
  thesis?: string;
  counter?: string;
  action?: string; // "added to SUI" | "moved to cash" | "held"
  target?: string; // e.g. "55% SUI"
  outcome?: string; // e.g. "+1.8%" | "settling" | "capital preserved"
};

function deterministic(b: Body): string {
  const regime = b.regime || "the current market";
  const action = b.action || "held its position";
  const target = b.target ? ` (target ${b.target})` : "";
  const because = b.thesis ? ` ${b.thesis}` : "";
  const caveat = b.counter ? ` It weighed the risk: ${b.counter.toLowerCase()}` : "";
  const result = b.outcome ? ` Outcome: ${b.outcome}.` : "";
  return `In a ${regime.toLowerCase()} regime, the operator ${action}${target}.${because}${caveat}${result}`.trim();
}

// Some models leak their scratchpad. Extract only the final answer; reject
// anything that still smells like reasoning so we fall back to the clean
// deterministic line rather than show the model thinking out loud.
const REASONING_SMELL =
  /\b(we need to|we must|we can|the instruction|the facts|two sentences|let me|i should|rephrase|first sentence|second sentence|non-technical|do not invent|as an ai)\b/i;
function cleanNarration(raw: string | undefined): string | null {
  if (!raw) return null;
  let s = raw;
  // If the model used a <think> block, keep only what's after it.
  const closeThink = s.lastIndexOf("</think>");
  if (closeThink >= 0) s = s.slice(closeThink + "</think>".length);
  s = s.replace(/<\/?think>/gi, "").trim();
  // Strip common wrappers/labels.
  s = s.replace(/^["'`]|["'`]$/g, "").trim();
  s = s.replace(/^(narration|summary|answer|output)\s*[:\-]\s*/i, "").trim();
  // Reject obvious reasoning leaks or runaway length.
  if (!s || s.length > 400 || REASONING_SMELL.test(s)) return null;
  return s;
}

export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    /* empty body → deterministic */
  }

  const key = process.env.COMMONSTACK_API_KEY;
  // Fast non-reasoning model · clean prose, low latency (reasoning models emit
  // scratchpad). Mirrors the agents' DEFAULT_AI_MODEL; override via COMMONSTACK_MODEL.
  const model = process.env.COMMONSTACK_MODEL || "x-ai/grok-4-1-fast-non-reasoning";

  // No key → honest deterministic narration (zero spend).
  if (!key) {
    return NextResponse.json(
      { ok: true, ai: false, narration: deterministic(body) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const sys =
      "You write a single decision summary for an autonomous on-chain capital operator. " +
      "Output EXACTLY two plain-English sentences for a non-technical owner and NOTHING else. " +
      "No preamble, no reasoning, no notes about your process, no quotes, no markdown. " +
      "Use only the facts given (you may restate any numbers in them); never invent numbers, " +
      "prices, or outcomes. Calm and factual, not promotional.";
    const user =
      "Write the two-sentence summary now, from these facts:\n" + JSON.stringify(body);
    const r = await fetch("https://api.commonstack.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 160,
        temperature: 0.3,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) throw new Error(`commonstack ${r.status}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const narration = cleanNarration(j.choices?.[0]?.message?.content);
    if (!narration) throw new Error("empty or low-quality narration");
    return NextResponse.json(
      { ok: true, ai: true, model, narration },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    // Any failure → fall back to the deterministic summary; never error out.
    return NextResponse.json(
      { ok: true, ai: false, narration: deterministic(body), note: String((err as Error)?.message ?? err).slice(0, 80) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
