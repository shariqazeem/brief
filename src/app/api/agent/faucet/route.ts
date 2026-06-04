// One-click testnet faucet for the bound agent wallet.
//
// The agent operator wallet (BRIEF_OPERATOR_ADDRESS) needs ~3 SUI minimum
// to execute either a stake or a DeepBook market order with gas headroom.
// Rather than make every demo user copy the address, open a new tab,
// paste, click "request"... we proxy the Sui testnet faucet directly.
//
// The faucet rate-limits per-IP (~30s cooldown). When throttled we
// surface the error cleanly so the UI can render a "try again in N seconds"
// state instead of a generic 500.

import {
  getFaucetHost,
  requestSuiFromFaucetV2,
} from "@mysten/sui/faucet";

const AGENT_ADDRESS = process.env.NEXT_PUBLIC_BRIEF_OPERATOR_ADDRESS ?? "";

export async function POST(): Promise<Response> {
  if (!AGENT_ADDRESS || !AGENT_ADDRESS.startsWith("0x")) {
    return Response.json(
      {
        error: "agent_address_missing",
        message:
          "NEXT_PUBLIC_BRIEF_OPERATOR_ADDRESS is not configured on the server.",
      },
      { status: 500 },
    );
  }

  try {
    await requestSuiFromFaucetV2({
      host: getFaucetHost("testnet"),
      recipient: AGENT_ADDRESS,
    });
    return Response.json({
      ok: true,
      recipient: AGENT_ADDRESS,
      amountSui: 1,
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    // The Sui SDK throws FaucetRateLimitError specifically; we surface
    // the message to the client so the UI can render an appropriate
    // retry hint.
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
