// GET /api/spot?oracle_id=0x…
//
// The single highest-leverage scaling fix: every open dashboard used
// to devInspect `oracle::spot_price` against the public fullnode every
// 8 seconds — 100 viewers ≈ 750 RPC calls/min from 100 IPs, which is
// how testnet rate limits kill a live demo. This route does that one
// devInspect server-side and lets every viewer share a 4s cache.
// useLiveSpot hits this first and falls back to direct devInspect only
// if the route is unreachable.

import { NextRequest, NextResponse } from "next/server";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors src/lib/predict-client.ts — keep in sync.
const PREDICT_PACKAGE =
  "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";
const READ_SENDER =
  "0xa9f24640b32f33fcfa8582791e84a542251398acfc3b696f382a08a768b6ddbf";
const CACHE_TTL_MS = 4_000;

const cache = new Map<string, { generatedAtMs: number; spotRaw: string }>();
// Per-oracle single-flight: concurrent cache-miss reads share ONE
// devInspect to the fullnode instead of each firing their own (which
// rate-limits the node under 100 VUs). Keyed by oracle id.
const inflight = new Map<string, Promise<string>>();

function readSpotOnce(oracleId: string): Promise<string> {
  const existing = inflight.get(oracleId);
  if (existing) return existing;
  const p = (async () => {
    const tx = new Transaction();
    tx.moveCall({
      target: `${PREDICT_PACKAGE}::oracle::spot_price`,
      arguments: [tx.object(oracleId)],
    });
    const r = await sui().devInspectTransactionBlock({
      sender: READ_SENDER,
      transactionBlock: tx,
    });
    const ret = r.results?.[0]?.returnValues?.[0];
    if (!ret) throw new Error("no return value");
    const spotRaw = BigInt(bcs.U64.parse(Uint8Array.from(ret[0]))).toString();
    cache.set(oracleId, { generatedAtMs: Date.now(), spotRaw });
    return spotRaw;
  })().finally(() => inflight.delete(oracleId));
  inflight.set(oracleId, p);
  return p;
}

let client: SuiJsonRpcClient | null = null;
function sui(): SuiJsonRpcClient {
  if (!client) {
    const network =
      (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet").trim() === "mainnet"
        ? ("mainnet" as const)
        : ("testnet" as const);
    client = new SuiJsonRpcClient({
      network,
      url: getJsonRpcFullnodeUrl(network),
    });
  }
  return client;
}

export async function GET(req: NextRequest) {
  const oracleId = req.nextUrl.searchParams.get("oracle_id");
  if (!oracleId || !oracleId.startsWith("0x")) {
    return NextResponse.json(
      { ok: false, error: "oracle_id required" },
      { status: 400 },
    );
  }

  const hit = cache.get(oracleId);
  if (hit && Date.now() - hit.generatedAtMs < CACHE_TTL_MS) {
    return NextResponse.json({
      ok: true,
      oracle_id: oracleId,
      spot_raw: hit.spotRaw,
      generated_at_ms: hit.generatedAtMs,
      cached: true,
    });
  }

  // Stale-while-revalidate: if we have ANY prior value, serve it now and
  // refresh once in the background — no caller blocks on the fullnode.
  if (hit) {
    void readSpotOnce(oracleId).catch(() => {});
    return NextResponse.json({
      ok: true,
      oracle_id: oracleId,
      spot_raw: hit.spotRaw,
      generated_at_ms: hit.generatedAtMs,
      cached: true,
      stale: true,
    });
  }

  try {
    const spotRaw = await readSpotOnce(oracleId);
    return NextResponse.json({
      ok: true,
      oracle_id: oracleId,
      spot_raw: spotRaw,
      generated_at_ms: cache.get(oracleId)?.generatedAtMs ?? Date.now(),
      cached: false,
    });
  } catch (e) {
    // Cold-start miss with a dead fullnode (any prior value is served
    // stale above, so there's nothing to fall back to here).
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) },
      { status: 502 },
    );
  }
}
