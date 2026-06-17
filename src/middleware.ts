// Plants an anonymous session id (`brief_sid`) on first visit so the
// SUI-spending API routes can rate-limit per session instead of per
// IP · 100 hackathon judges on one venue NAT each get their own
// dispatch allowance (rate-limit.ts still keeps a per-IP cap so
// minting cookies doesn't multiply throughput).
//
// The id is random, carries no identity, and is never stored
// server-side · it only keys an in-memory token bucket.

import { NextRequest, NextResponse } from "next/server";

const COOKIE = "brief_sid";
const MAX_AGE_S = 30 * 24 * 3600;

export function middleware(req: NextRequest) {
  if (req.cookies.get(COOKIE)?.value) return NextResponse.next();
  const res = NextResponse.next();
  res.cookies.set(COOKIE, crypto.randomUUID(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_S,
    path: "/",
  });
  return res;
}

// Only page loads need the cookie planted; API calls just read it.
export const config = {
  matcher: ["/", "/workforce/:path*", "/leaderboard/:path*", "/app/:path*"],
};
