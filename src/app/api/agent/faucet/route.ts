// POST /api/agent/faucet · proxy the Sui testnet faucet for any Sui
// address. The judge cold-start affordance on /workforce calls this with
// the connected wallet's address so a brand-new empty wallet can sign
// the grant.
//
// Body: { recipient?: string }
//   recipient · 0x… Sui address. When omitted, defaults to
//               NEXT_PUBLIC_BRIEF_OPERATOR_ADDRESS (the Planner). The
//               legacy POST-with-no-body shape is preserved.
//
// Rate-limit: light per-IP throttle so a script can't burn the faucet's
// per-IP cooldown indefinitely.

import {
  getFaucetHost,
  requestSuiFromFaucetV2,
} from "@mysten/sui/faucet";
import {
  getClientIp,
  rateLimit,
  rateLimitedResponse,
} from "@/lib/rate-limit";

const AGENT_ADDRESS = (
  process.env.NEXT_PUBLIC_BRIEF_OPERATOR_ADDRESS ?? ""
).trim();
const SUI_ADDR_RE = /^0x[0-9a-fA-F]{40,64}$/;

type Body = { recipient?: string };

export async function POST(req: Request): Promise<Response> {
  // ~ 3 requests per minute per IP. The public faucet itself rate-
  // limits at ~30s per address; our limit is just a guard rail.
  const rl = rateLimit("faucet", getClientIp(req), {
    windowMs: 60_000,
    max: 3,
  });
  if (!rl.ok) {
    return rateLimitedResponse(
      rl.retryAfterSec,
      `Faucet requests limited to 3 per minute per IP. Retry in ${rl.retryAfterSec}s.`,
    );
  }

  let body: Body = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      body = (await req.json()) as Body;
    }
  } catch {
    body = {};
  }

  const recipient = (body.recipient ?? AGENT_ADDRESS).trim();
  if (!recipient) {
    return Response.json(
      {
        error: "recipient_required",
        message:
          "No recipient provided and no NEXT_PUBLIC_BRIEF_OPERATOR_ADDRESS configured.",
      },
      { status: 400 },
    );
  }
  if (!SUI_ADDR_RE.test(recipient)) {
    return Response.json(
      {
        error: "invalid_recipient",
        message: "recipient must be a 0x… Sui address.",
      },
      { status: 400 },
    );
  }

  try {
    await requestSuiFromFaucetV2({
      host: getFaucetHost("testnet"),
      recipient,
    });
    return Response.json({
      ok: true,
      recipient,
      // Faucet currently sends 1 SUI per request on testnet; surfaced
      // so the UI can render an accurate "received N SUI" note.
      amountSui: 1,
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    const rateLimited = /rate.*limit|too many requests|429/i.test(msg);
    return Response.json(
      {
        error: rateLimited ? "rate_limited" : "faucet_failed",
        message: msg,
      },
      {
        status: rateLimited ? 429 : 502,
        headers: rateLimited ? { "Retry-After": "30" } : undefined,
      },
    );
  }
}
