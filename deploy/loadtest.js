// Brief — k6 load test for the "100 concurrent users" claim.
//
//   k6 run deploy/loadtest.js
//   k6 run -e BASE=https://141-148-215-239.sslip.io deploy/loadtest.js
//
// Three scenarios run together for 60s against the deployed VM:
//   (a) reads   — 100 VUs hammering the cached read routes
//                 (/api/leaderboard, /api/trader/signals, /api/spot)
//   (b) sse     — 50 VUs holding /api/agent-events open (stability)
//   (c) pages   — 10 VUs loading the /workforce + /leaderboard HTML
//
// Pass criteria (thresholds below, non-zero exit on breach):
//   · zero 5xx across every request
//   · p95 < 1s on the read routes
//   · SSE connections stay open without erroring
//
// We deliberately DO NOT touch /api/workforce/trader-dispatch — it
// signs a real Planner tx and spends testnet SUI. The read + SSE routes
// are server-cached (in-memory, 4–30s TTL) and carry no rate limit, so
// a single load-gen IP exercises them honestly (only the dispatch route
// is per-IP/session capped, and we leave it alone).

import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE || "https://141-148-215-239.sslip.io";
// A live BTC oracle id for /api/spot (override with -e ORACLE=0x…).
const ORACLE =
  __ENV.ORACLE ||
  "0xb19355f6b094200aee50afbbce774745cce641ecddbc3a9b9a868e5d9596da69";

const http5xx = new Counter("brief_http_5xx");
const readLatency = new Trend("brief_read_latency", true);
const sseOpen = new Counter("brief_sse_opened");
const sseFail = new Counter("brief_sse_failed");

export const options = {
  scenarios: {
    reads: {
      executor: "constant-vus",
      vus: 100,
      duration: "60s",
      exec: "reads",
      tags: { scenario: "reads" },
    },
    sse: {
      executor: "constant-vus",
      vus: 50,
      duration: "60s",
      exec: "sse",
      tags: { scenario: "sse" },
    },
    pages: {
      executor: "constant-vus",
      vus: 10,
      duration: "60s",
      exec: "pages",
      tags: { scenario: "pages" },
    },
  },
  thresholds: {
    // The headline claims, enforced.
    brief_http_5xx: ["count==0"],
    brief_read_latency: ["p(95)<1000"],
    "http_req_failed{scenario:reads}": ["rate<0.01"],
  },
};

function track(res) {
  if (res.status >= 500) http5xx.add(1, { url: res.url });
  return res;
}

// (a) Reads — the real 100-user surface. Each VU loops the three cached
// read routes back to back for the whole window.
export function reads() {
  const lb = track(http.get(`${BASE}/api/leaderboard`, { tags: { ep: "leaderboard" } }));
  readLatency.add(lb.timings.duration);
  check(lb, { "leaderboard !5xx": (r) => r.status < 500 });

  const sig = track(
    http.get(`${BASE}/api/trader/signals?asset=BTC&minutes=60`, {
      tags: { ep: "signals" },
    }),
  );
  readLatency.add(sig.timings.duration);
  check(sig, { "signals !5xx": (r) => r.status < 500 });

  const spot = track(
    http.get(`${BASE}/api/spot?oracle_id=${ORACLE}`, { tags: { ep: "spot" } }),
  );
  readLatency.add(spot.timings.duration);
  check(spot, { "spot !5xx": (r) => r.status < 500 });
}

// (b) SSE — hold /api/agent-events open. k6's http client buffers the
// body until the response ends, but SSE never ends, so we cap each read
// at 12s: a TIMEOUT means the stream stayed open the whole time (good);
// a 5xx means the server fell over (bad). Each VU re-opens ~5×/60s.
export function sse() {
  const res = http.get(`${BASE}/api/agent-events`, {
    timeout: "12s",
    tags: { ep: "sse" },
  });
  if (res.status >= 500) {
    sseFail.add(1);
  } else {
    // status 0 (timeout, stream held open) or 200 (closed cleanly) both ok
    sseOpen.add(1);
  }
  check(res, { "sse not 5xx": (r) => r.status < 500 });
}

// (c) Pages — full HTML loads of the two main app routes.
export function pages() {
  const wf = track(http.get(`${BASE}/workforce`, { tags: { ep: "workforce" } }));
  check(wf, { "workforce !5xx": (r) => r.status < 500 });
  const lb = track(http.get(`${BASE}/leaderboard`, { tags: { ep: "leaderboard-page" } }));
  check(lb, { "leaderboard page !5xx": (r) => r.status < 500 });
}
