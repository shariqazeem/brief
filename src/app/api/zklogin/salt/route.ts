// /api/zklogin/salt — returns a deterministic per-user salt.
//
// Per the Sui zkLogin docs the salt is a value chosen by the dApp that
// (combined with the JWT's claims) determines the user's on-chain
// address. To make sign-in idempotent across devices we make the salt
// deterministic: HMAC-SHA-256(SERVER_SECRET, sub|aud). Same Google
// account → same Sui address.
//
// The salt MUST remain private if you treat it as part of "what only the
// user has" — but for testnet this is a soft constraint and the
// self-managed pattern is what the docs recommend for prototyping.
//
// SERVER_SECRET is read from ZKLOGIN_SALT_SECRET; the value lives in
// .env.local on the VM and on Vercel and is never committed.

import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";

export const runtime = "nodejs";

const SECRET = (process.env.ZKLOGIN_SALT_SECRET ?? "").trim();

// Salt must be < 2^128 per the zkLogin spec — we render the HMAC as a
// 16-byte (128-bit) big-endian integer.
function saltFromHmac(hmacHex: string): string {
  // Take the first 16 bytes (32 hex chars), parse as BigInt.
  const head = hmacHex.slice(0, 32);
  return BigInt("0x" + head).toString();
}

type JwtPayload = { sub?: string; aud?: string | string[] };

function decodeJwtPayload(jwt: string): JwtPayload | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    // Base64url decode the payload segment.
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!SECRET) {
    return NextResponse.json(
      { ok: false, error: "salt secret not configured" },
      { status: 500 },
    );
  }
  let body: { jwt?: unknown };
  try {
    body = (await req.json()) as { jwt?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad json" },
      { status: 400 },
    );
  }
  const jwt = typeof body.jwt === "string" ? body.jwt : "";
  if (!jwt) {
    return NextResponse.json(
      { ok: false, error: "missing jwt" },
      { status: 400 },
    );
  }
  const payload = decodeJwtPayload(jwt);
  if (!payload?.sub || !payload?.aud) {
    return NextResponse.json(
      { ok: false, error: "jwt missing sub/aud" },
      { status: 400 },
    );
  }
  const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
  const material = `${payload.sub}|${aud}`;
  const hmac = createHmac("sha256", SECRET).update(material).digest("hex");
  const salt = saltFromHmac(hmac);
  return NextResponse.json({ ok: true, salt });
}
