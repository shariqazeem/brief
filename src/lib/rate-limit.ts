// Minimal per-process, per-IP token-bucket rate limit. Used by the
// SUI-spending API routes so a script can't drain the Planner wallet
// or hammer the faucet in a loop. Resets on process restart; that's
// fine for our scale.
//
// Each named bucket is a separate limit (e.g. one for "missions",
// another for "post-verification", another for "faucet"). Within a
// bucket, each remote IP gets its own count.

export type RateLimitConfig = {
  /** Window length in ms. */
  windowMs: number;
  /** Max requests per IP per window. */
  max: number;
};

type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

const NAMED_BUCKETS = new Map<string, Map<string, Bucket>>();

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

/**
 * Consume one token from the (bucketName, ip) bucket. Refills
 * proportionally to elapsed time. Returns { ok: false, retryAfterSec }
 * when the bucket is empty.
 */
export function rateLimit(
  bucketName: string,
  ip: string,
  cfg: RateLimitConfig,
): RateLimitResult {
  let perIp = NAMED_BUCKETS.get(bucketName);
  if (!perIp) {
    perIp = new Map();
    NAMED_BUCKETS.set(bucketName, perIp);
  }
  let bucket = perIp.get(ip);
  const now = Date.now();
  if (!bucket) {
    bucket = { tokens: cfg.max, lastRefillMs: now };
    perIp.set(ip, bucket);
  } else {
    const elapsed = now - bucket.lastRefillMs;
    if (elapsed > 0) {
      const refill = (elapsed / cfg.windowMs) * cfg.max;
      bucket.tokens = Math.min(cfg.max, bucket.tokens + refill);
      bucket.lastRefillMs = now;
    }
  }
  if (bucket.tokens < 1) {
    const need = 1 - bucket.tokens;
    const msToRefill = (need / cfg.max) * cfg.windowMs;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(msToRefill / 1000)) };
  }
  bucket.tokens -= 1;
  return { ok: true };
}

/**
 * Resolve the client IP from a Request. Prefers the X-Forwarded-For
 * header (set by Caddy / any reverse proxy) and falls back to
 * X-Real-IP. Returns "unknown" if neither is present (e.g., direct
 * connection in dev).
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xreal = req.headers.get("x-real-ip");
  if (xreal) return xreal.trim();
  return "unknown";
}

/**
 * Build a 429 Response with a Retry-After header. Use to short-circuit
 * the route when rateLimit() rejects.
 */
export function rateLimitedResponse(retryAfterSec: number, hint?: string): Response {
  return Response.json(
    {
      error: "rate_limited",
      message: hint ?? `Too many requests — retry in ${retryAfterSec}s.`,
      retry_after_sec: retryAfterSec,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
      },
    },
  );
}
