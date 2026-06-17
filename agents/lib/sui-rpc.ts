// Resilient RPC transport for Brief.
//
// The default Mysten public testnet RPC (fullnode.testnet.sui.io) is
// reliable but slow. publicnode.com / blockvision are fast but flake on
// certain endpoints (queryEvents in particular returns
// "Could not find the referenced transaction events" intermittently). For
// the demo + the live agents we want fast-when-it-works + resilient when
// it doesn't.
//
// This module exposes `makeResilientTransport(urls)` which returns an
// object implementing the same `request()` interface as
// `JsonRpcHTTPTransport` from @mysten/sui, but rotates through a list of
// URLs on retryable errors (429, 5xx, the publicnode "no events" error,
// network errors). A success on a non-active URL promotes it to active so
// subsequent calls fast-path through it.
//
// Use via SuiJsonRpcClient's `transport` constructor option.

const RETRYABLE_HTTP_CODES = new Set([408, 429, 500, 502, 503, 504]);

type JsonRpcRequest = {
  method: string;
  params: unknown[];
  signal?: AbortSignal;
};

export type ResilientTransport = {
  request<T>(input: JsonRpcRequest): Promise<T>;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isRetryableError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const anyE = e as { message?: unknown; status?: unknown; code?: unknown; cause?: unknown };
  const status = typeof anyE.status === "number" ? anyE.status : undefined;
  if (status && RETRYABLE_HTTP_CODES.has(status)) return true;
  const code = typeof anyE.code === "number" ? anyE.code : undefined;
  // JSON-RPC InternalError for missing events (publicnode flake)
  if (code === -32603) return true;
  // JSON-RPC server is busy (-32000 in some implementations)
  if (code === -32000 || code === -32603) return true;
  const msg = typeof anyE.message === "string" ? anyE.message.toLowerCase() : "";
  return (
    msg.includes("could not find the referenced") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("rate limit")
  );
}

export type MakeTransportOptions = {
  urls: string[];
  /** Optional log prefix; defaults to "sui-rpc". */
  label?: string;
  /**
   * Minimum cool-down between rotations to the same URL after it fails,
   * in ms. Default 30s · protects against hammering a sick endpoint.
   */
  cooldownMs?: number;
};

export function makeResilientTransport(opts: MakeTransportOptions): ResilientTransport {
  const urls = opts.urls.filter((u) => u && u.startsWith("http"));
  if (urls.length === 0) {
    throw new Error("makeResilientTransport: no usable URLs");
  }
  const tag = opts.label ?? "sui-rpc";
  const cooldownMs = opts.cooldownMs ?? 30_000;
  let activeIdx = 0;
  let requestId = 0;
  // Per-URL last-failure timestamp; we skip URLs in cooldown.
  const lastFailureAt = new Array<number>(urls.length).fill(0);

  function pickNextIdx(start: number): number {
    const now = Date.now();
    for (let attempt = 1; attempt <= urls.length; attempt++) {
      const idx = (start + attempt) % urls.length;
      if (now - lastFailureAt[idx] >= cooldownMs) return idx;
    }
    // Every URL is in cooldown · pick the least-recently-failed one anyway.
    let best = 0;
    let bestAge = -Infinity;
    for (let i = 0; i < urls.length; i++) {
      const age = now - lastFailureAt[i];
      if (age > bestAge) {
        bestAge = age;
        best = i;
      }
    }
    return best;
  }

  return {
    async request<T>(input: JsonRpcRequest): Promise<T> {
      requestId += 1;
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: input.method,
        params: input.params,
      });
      let firstError: unknown = null;
      // Try every URL once before giving up.
      let triedIdxs = new Set<number>();
      let idx = activeIdx;
      for (let attempt = 0; attempt < urls.length; attempt++) {
        if (triedIdxs.has(idx)) idx = pickNextIdx(idx);
        triedIdxs.add(idx);
        const url = urls[idx];
        try {
          const res = await fetch(url, {
            method: "POST",
            signal: input.signal,
            headers: {
              "Content-Type": "application/json",
              "Client-Sdk-Type": "typescript",
              "Client-Request-Method": input.method,
            },
            body: payload,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            const err = new Error(
              `HTTP ${res.status} from ${hostOf(url)}: ${text.slice(0, 120)}`,
            ) as Error & { status?: number };
            err.status = res.status;
            throw err;
          }
          const data = (await res.json()) as {
            error?: { message: string; code: number };
            result?: T;
          };
          if (data.error) {
            const err = new Error(data.error.message) as Error & { code?: number };
            err.code = data.error.code;
            throw err;
          }
          // Success · promote this URL to active.
          if (idx !== activeIdx) {
            console.log(
              `[${tag}] promoted ${hostOf(url)} to active (was ${hostOf(urls[activeIdx])})`,
            );
            activeIdx = idx;
          }
          return data.result as T;
        } catch (e) {
          if (firstError === null) firstError = e;
          if (!isRetryableError(e)) {
            throw e;
          }
          lastFailureAt[idx] = Date.now();
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(
            `[${tag}] ${hostOf(url)} failed (${msg.slice(0, 100)}) · rotating`,
          );
          idx = pickNextIdx(idx);
        }
      }
      throw firstError instanceof Error
        ? firstError
        : new Error(
            `[${tag}] all ${urls.length} URLs failed: ${String(firstError ?? "unknown")}`,
          );
    },
  };
}

/**
 * Read BRIEF_SUI_RPC_FALLBACKS (comma-separated) and produce a resilient
 * URL list: primary first, then fallbacks, then a hardcoded Mysten
 * fullnode as last resort. Deduped.
 */
export function resolveRpcUrls(primary: string): string[] {
  const fallbacksEnv = process.env.BRIEF_SUI_RPC_FALLBACKS ?? "";
  const fallbacks = fallbacksEnv
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  const mystenFallback = "https://fullnode.testnet.sui.io:443";
  const all = [primary, ...fallbacks, mystenFallback];
  return Array.from(new Set(all));
}
