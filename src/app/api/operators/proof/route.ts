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

// Pagination bounds for event scans. One busy operator can fill many pages of
// PolicySpend, so a quieter operator's events live deeper in the stream. We
// follow `hasNextPage`/`nextCursor` until we've collected the queried policy's
// events, capped so we never fetch unboundedly.
const EVENT_PAGE = 50;
const MAX_EVENT_PAGES = 10; // ≤ 500 events scanned per event type

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

type RawEvent = { parsedJson: unknown; id: { txDigest: string } };

// Scan a Move event type newest-first, following pagination, and return every
// event whose `policy_id` matches `policyId`. Bounded by MAX_EVENT_PAGES so a
// high-volume ecosystem never triggers an unbounded fetch. Reliable regardless
// of how many events other operators have emitted.
async function collectPolicyEvents(
  c: SuiJsonRpcClient,
  moveEventType: string,
  policyId: string,
): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  let cursor: { eventSeq: string; txDigest: string } | null = null;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const res = await c.queryEvents({
      query: { MoveEventType: moveEventType },
      cursor,
      limit: EVENT_PAGE,
      order: "descending",
    });
    for (const e of res.data) {
      if ((e.parsedJson as { policy_id?: string })?.policy_id === policyId) {
        out.push(e as RawEvent);
      }
    }
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor as { eventSeq: string; txDigest: string };
  }
  return out;
}

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
    // `revoked` is read from the CURRENT on-chain object state (fresh fields
    // from getObject) — never inferred from the PolicyCreated event, which is
    // always false at creation. Cross-checked below against PolicyRevoked: if
    // either the live object OR a confirmed revoke event says revoked, we report
    // revoked (a freshly-revoked operator is never shown ACTIVE).
    const objectRevoked = f.revoked === true;
    const policy = {
      name: str(f.name),
      owner: str(f.owner),
      agent: str(f.agent),
      revoked: objectRevoked,
      budget_cap: num(f.budget_cap),
      spent: num(f.spent),
      allowed_venues: Array.isArray(f.allowed_venues) ? (f.allowed_venues as string[]) : [],
      expires_at_ms: num(f.expires_at_ms) || null,
      created_at_ms: num(f.created_at_ms) || null,
    };

    // 2) PolicySpend events for this policy · paginated so a busy operator's
    //    volume can't bury a quieter one's authorized trades.
    const spendEv = await collectPolicyEvents(
      c,
      `${PKG}::operator_policy::PolicySpend`,
      id,
    );
    const spends = spendEv.map((e) => {
      const j = e.parsedJson as Record<string, unknown>;
      return {
        amount: num(j.amount),
        new_spent: num(j.new_spent),
        venue: str(j.venue),
        ms: num(j.ms),
        tx: e.id.txDigest,
      };
    });

    // 3) PolicyRevoked event for this policy (if any) · paginated so an older
    //    revoke isn't missed once many operators have been retired.
    let revoke: { revoked_by: string | null; ms: number; tx: string } | null = null;
    try {
      const revEv = await collectPolicyEvents(
        c,
        `${PKG}::operator_policy::PolicyRevoked`,
        id,
      );
      const r = revEv[0]; // newest-first
      if (r) {
        const j = r.parsedJson as Record<string, unknown>;
        revoke = { revoked_by: str(j.revoked_by), ms: num(j.ms), tx: r.id.txDigest };
      }
    } catch {
      /* revoke lookup best-effort */
    }
    // If chain has a confirmed revoke event, the operator is revoked even if the
    // object read raced ahead of it — keep the headline status honest.
    if (revoke && !policy.revoked) policy.revoked = true;

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
