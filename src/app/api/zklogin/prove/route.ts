// /api/zklogin/prove — server-side proxy to the Mysten zkLogin prover.
//
// We proxy rather than call the prover from the browser because:
//   1. CORS — the public prover is best treated as a JSON RPC that we
//      front so the browser never has to deal with cross-origin quirks.
//   2. URL agility — if Mysten rotates the prover URL we change one env
//      var (ZKLOGIN_PROVER_URL) without redeploying the client bundle.
//   3. Logging — proof failures should be observable server-side.
//
// We do not store the JWT or the proof. The request body is forwarded
// verbatim to the prover and the response is forwarded back. Latency
// is normally a few seconds — the UI shows a "preparing your secure
// session…" state while this is running.

import { NextResponse } from "next/server";

// Mysten's public dev prover backs the testnet network. The "prover.mystenlabs.com"
// host is mainnet-only. Allow override via env so this can swap to a
// self-hosted prover without a code change.
const PROVER_URL = (
  process.env.ZKLOGIN_PROVER_URL ?? "https://prover-dev.mystenlabs.com/v1"
).trim();

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad body" },
      { status: 400 },
    );
  }
  try {
    const r = await fetch(PROVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyText,
    });
    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: r.status,
          error: text.slice(0, 1200),
        },
        { status: 502 },
      );
    }
    // The prover returns the proof inputs as JSON. Pass them through.
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, error: "prover returned non-json", body: text.slice(0, 400) },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, proof: json });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
