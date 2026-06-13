// GET /api/policy?id=0x…
//
// Server-cached read of an OperatorPolicy object (sui_getObject), so the
// /proof page can render a live budget burn-down for a judge without
// every visitor hitting the fullnode. 30s cache, same pattern as
// /api/spot. Read-only; returns the decoded leash fields.

import { NextRequest, NextResponse } from "next/server";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30_000;
const cache = new Map<
  string,
  { generatedAtMs: number; payload: Record<string, unknown> }
>();

let client: SuiJsonRpcClient | null = null;
function sui(): SuiJsonRpcClient {
  if (!client) {
    const network =
      (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet").trim() === "mainnet"
        ? ("mainnet" as const)
        : ("testnet" as const);
    client = new SuiJsonRpcClient({ network, url: getJsonRpcFullnodeUrl(network) });
  }
  return client;
}

function num(v: unknown): number {
  if (typeof v === "string") return Number(v);
  if (typeof v === "number") return v;
  return 0;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !id.startsWith("0x")) {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }

  const hit = cache.get(id);
  if (hit && Date.now() - hit.generatedAtMs < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload);
  }

  try {
    const r = await sui().getObject({ id, options: { showContent: true } });
    const content = r.data?.content as
      | { fields?: Record<string, unknown> }
      | undefined;
    const f = content?.fields;
    if (!f) {
      return NextResponse.json(
        { ok: false, error: "policy not found" },
        { status: 404 },
      );
    }
    const budgetCapMist = num(f.budget_cap);
    const spentMist = num(f.spent);
    const venues = Array.isArray(f.allowed_venues) ? (f.allowed_venues as string[]) : [];
    const payload = {
      ok: true,
      id,
      generated_at_ms: Date.now(),
      name: typeof f.name === "string" ? f.name : null,
      owner: typeof f.owner === "string" ? f.owner : null,
      agent: typeof f.agent === "string" ? f.agent : null,
      revoked: f.revoked === true,
      budget_cap_sui: budgetCapMist / 1e9,
      spent_sui: spentMist / 1e9,
      remaining_sui: Math.max(0, (budgetCapMist - spentMist) / 1e9),
      allowed_venues: venues,
      expires_at_ms: num(f.expires_at_ms) || null,
    };
    cache.set(id, { generatedAtMs: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (e) {
    if (hit) return NextResponse.json({ ...hit.payload, stale: true });
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) },
      { status: 502 },
    );
  }
}
