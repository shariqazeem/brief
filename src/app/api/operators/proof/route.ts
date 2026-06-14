// GET /api/operators/proof?policy_id=0x…
//
// Everything the /proof page needs to render a verifiable artifact for one
// operator, server-side (so the page is walletless + shareable): the live
// OperatorPolicy fields, the PolicySpend events (each authorized trade), the
// PolicyRevoked event (if the leash was yanked), and the operator's Walrus
// manifesto blob. Read-only; 20s cache.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 20_000;
const cache = new Map<string, { at: number; payload: Record<string, unknown> }>();

const PKG = (
  process.env.NEXT_PUBLIC_BRIEF_PACKAGE_ID ??
  "0xe550ace873c02768dbaca7de3a2d64a28acd3f7c51551c9c97b704703e95fb9d"
).trim();

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

const num = (v: unknown): number =>
  typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("policy_id");
  if (!id || !/^0x[0-9a-fA-F]{6,}$/.test(id)) {
    return NextResponse.json({ ok: false, error: "policy_id required" }, { status: 400 });
  }

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload);
  }

  try {
    const c = sui();
    // 1) policy object
    const obj = await c.getObject({ id, options: { showContent: true } });
    const f = (obj.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields;
    if (!f) {
      return NextResponse.json({ ok: false, error: "policy not found" }, { status: 404 });
    }
    const policy = {
      name: str(f.name),
      owner: str(f.owner),
      agent: str(f.agent),
      revoked: f.revoked === true,
      budget_cap: num(f.budget_cap),
      spent: num(f.spent),
      allowed_venues: Array.isArray(f.allowed_venues) ? (f.allowed_venues as string[]) : [],
      expires_at_ms: num(f.expires_at_ms) || null,
      created_at_ms: num(f.created_at_ms) || null,
    };

    // 2) PolicySpend events for this policy
    const spendEv = await c.queryEvents({
      query: { MoveEventType: `${PKG}::operator_policy::PolicySpend` },
      limit: 50,
      order: "descending",
    });
    const spends = spendEv.data
      .filter((e) => (e.parsedJson as { policy_id?: string })?.policy_id === id)
      .map((e) => {
        const j = e.parsedJson as Record<string, unknown>;
        return {
          amount: num(j.amount),
          new_spent: num(j.new_spent),
          venue: str(j.venue),
          ms: num(j.ms),
          tx: e.id.txDigest,
        };
      });

    // 3) PolicyRevoked event for this policy (if any)
    let revoke: { revoked_by: string | null; ms: number; tx: string } | null = null;
    try {
      const revEv = await c.queryEvents({
        query: { MoveEventType: `${PKG}::operator_policy::PolicyRevoked` },
        limit: 50,
        order: "descending",
      });
      const r = revEv.data.find(
        (e) => (e.parsedJson as { policy_id?: string })?.policy_id === id,
      );
      if (r) {
        const j = r.parsedJson as Record<string, unknown>;
        revoke = { revoked_by: str(j.revoked_by), ms: num(j.ms), tx: r.id.txDigest };
      }
    } catch {
      /* revoke lookup best-effort */
    }

    // 4) Walrus manifesto blob (per-policy file written by the trader loop)
    let manifestBlob: string | null = null;
    try {
      const slug = id.slice(2, 14);
      const p = path.join(process.cwd(), ".cursors", "trader-manifest", `${slug}.json`);
      const raw = await fs.readFile(p, "utf8");
      const m = JSON.parse(raw) as { blobId?: string; published?: boolean };
      if (m.published && m.blobId) manifestBlob = m.blobId;
    } catch {
      /* no manifesto yet */
    }

    const payload = { ok: true, id, generated_at_ms: Date.now(), policy, spends, revoke, manifestBlob };
    cache.set(id, { at: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (e) {
    if (hit) return NextResponse.json({ ...hit.payload, stale: true });
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) },
      { status: 502 },
    );
  }
}
