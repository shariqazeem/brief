// GET /api/vol-surface?oracle_id=0x…[&strike=104250]
//
// Server-side mirror of the trader's SVI surface read (one devInspect
// PTB, 9 move calls) so a hundred dashboards hit our 30s cache instead
// of fanning out devInspects to the public fullnode. Returns the
// decoded surface plus a pre-sampled smile curve the chart can bind
// directly; when ?strike= is given, also the market-implied Pr(UP) at
// that strike — the same number the quant strategy compares against.

import { NextRequest, NextResponse } from "next/server";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";

import {
  impliedProbUp,
  sampleSmile,
  strikeK,
  type SviSurface,
} from "@/lib/svi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors src/lib/predict-client.ts (browser reader) — keep in sync.
const PREDICT_PACKAGE =
  "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";
const READ_SENDER =
  "0xa9f24640b32f33fcfa8582791e84a542251398acfc3b696f382a08a768b6ddbf";
const PRICE_SCALAR = 1e9;
const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { generatedAtMs: number; surface: SviSurface }>();

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

function parseI64(bytes: number[]): bigint {
  if (bytes.length < 9) throw new Error(`I64 needs 9 bytes, got ${bytes.length}`);
  const mag = BigInt(bcs.U64.parse(Uint8Array.from(bytes.slice(0, 8))));
  return bytes[8] !== 0 ? -mag : mag;
}

async function readSurface(oracleId: string): Promise<SviSurface> {
  const tx = new Transaction();
  const svi = tx.moveCall({
    target: `${PREDICT_PACKAGE}::oracle::svi`,
    arguments: [tx.object(oracleId)],
  });
  for (const fn of ["svi_a", "svi_b", "svi_rho", "svi_m", "svi_sigma"]) {
    tx.moveCall({ target: `${PREDICT_PACKAGE}::oracle::${fn}`, arguments: [svi] });
  }
  for (const fn of ["spot_price", "forward_price", "expiry"]) {
    tx.moveCall({
      target: `${PREDICT_PACKAGE}::oracle::${fn}`,
      arguments: [tx.object(oracleId)],
    });
  }
  const r = await sui().devInspectTransactionBlock({
    sender: READ_SENDER,
    transactionBlock: tx,
  });
  const results = r.results ?? [];
  function u64At(idx: number): bigint {
    const ret = results[idx]?.returnValues?.[0];
    if (!ret) throw new Error(`SVI read: missing return at ${idx}`);
    return BigInt(bcs.U64.parse(Uint8Array.from(ret[0])));
  }
  function i64At(idx: number): bigint {
    const ret = results[idx]?.returnValues?.[0];
    if (!ret) throw new Error(`SVI read: missing I64 return at ${idx}`);
    return parseI64(ret[0]);
  }
  const s = (v: bigint) => Number(v) / PRICE_SCALAR;
  return {
    a: s(u64At(1)),
    b: s(u64At(2)),
    rho: s(i64At(3)),
    m: s(i64At(4)),
    sigma: s(u64At(5)),
    spotUsd: s(u64At(6)),
    forwardUsd: s(u64At(7)),
    expiryMs: Number(u64At(8)),
  };
}

export async function GET(req: NextRequest) {
  const oracleId = req.nextUrl.searchParams.get("oracle_id");
  if (!oracleId || !oracleId.startsWith("0x")) {
    return NextResponse.json({ ok: false, error: "oracle_id required" }, { status: 400 });
  }
  const strikeParam = Number(req.nextUrl.searchParams.get("strike") ?? NaN);

  let surface: SviSurface;
  const hit = cache.get(oracleId);
  if (hit && Date.now() - hit.generatedAtMs < CACHE_TTL_MS) {
    surface = hit.surface;
  } else {
    try {
      surface = await readSurface(oracleId);
      cache.set(oracleId, { generatedAtMs: Date.now(), surface });
    } catch (e) {
      // Serve a stale surface over an error — the smile drifts slowly.
      if (hit) {
        surface = hit.surface;
      } else {
        return NextResponse.json(
          { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) },
          { status: 502 },
        );
      }
    }
  }

  const smile = sampleSmile(surface);
  const withStrike = Number.isFinite(strikeParam) && strikeParam > 0;
  return NextResponse.json({
    ok: true,
    generated_at_ms: Date.now(),
    surface,
    smile,
    strike: withStrike
      ? {
          strikeUsd: strikeParam,
          k: strikeK(surface, strikeParam),
          marketProbUp: impliedProbUp(surface, strikeParam),
        }
      : null,
  });
}
