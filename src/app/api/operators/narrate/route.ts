// POST /api/operators/narrate
//
// On-demand, plain-English narration of ONE decision. Budget-safe by design:
//   • Only ever called from the Brain "Narrate" button — NEVER from the 24/7
//     trading loop (CommonStack credits are scarce: ~$0.50/week).
//   • If COMMONSTACK_API_KEY is unset, returns a deterministic summary composed
//     from the real decision fields — useful out of the box, zero spend.
//   • If set, makes exactly ONE CommonStack call per request.
//
// The narration only rephrases the operator's REAL reasoning + outcome — it
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

export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    /* empty body → deterministic */
  }

  const key = process.env.COMMONSTACK_API_KEY;
  const model = process.env.COMMONSTACK_MODEL || "claude-haiku-4-5";

  // No key → honest deterministic narration (zero spend).
  if (!key) {
    return NextResponse.json(
      { ok: true, ai: false, narration: deterministic(body) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const sys =
      "You are narrating a single decision made by an autonomous on-chain capital operator. " +
      "Rephrase ONLY the facts provided into two crisp, plain-English sentences for a non-technical owner. " +
      "Do not invent numbers, prices, or outcomes. Be calm and factual, not promotional.";
    const user = JSON.stringify(body);
    const r = await fetch("https://api.commonstack.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 160,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) throw new Error(`commonstack ${r.status}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const narration = j.choices?.[0]?.message?.content?.trim();
    if (!narration) throw new Error("empty narration");
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
