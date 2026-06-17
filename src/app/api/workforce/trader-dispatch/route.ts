// POST /api/workforce/trader-dispatch · server-signs a `predict-btc`
// task assigned to the Trader's on-chain wallet (the Treasury key).
//
// The user already signed ONE transaction in the frontend: the policy
// grant. That created an `OperatorPolicy` shared object with their
// chosen budget/expiry and the venue `predict-btc`. To make the trader
// actually trade, we need a task in the on-chain inbox the trader
// agent is polling. That task is posted server-side using the Planner
// key (the same key that pays bounties + auto-approves) so the user
// never sees a second signature.
//
// Inlines the small task::post PTB shape so this route doesn't have to
// import across the src/agents tree boundary (Next.js' webpack only
// follows aliases that point inside src/).
//
// Body: { policy_id, strategy, trader_name?, bounty_sui? }

import {
  getJsonRpcFullnodeUrl,
  SuiJsonRpcClient,
} from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import { bcs } from "@mysten/sui/bcs";

import { rateLimitDual, rateLimitedResponse } from "@/lib/rate-limit";

const HEX_RE = /^0x[0-9a-fA-F]{40,64}$/;
const ALLOWED_STRATEGIES = new Set([
  "conservative",
  "momentum",
  "contrarian",
  "quant",
]);
const ALLOWED_MARKETS = new Set(["btc_only", "sui_ecosystem", "all"]);
const NAME_MAX = 32;

type Body = {
  policy_id?: string;
  strategy?: string;
  trader_name?: string;
  bounty_sui?: number;
  /** Which markets this trader can play. Defaults to "btc_only". */
  markets?: string;
  /** Goal set at adoption · calibrates the trader's thresholds. */
  goal?: { type?: string; targetPct?: number; horizonDays?: number };
};

export const runtime = "nodejs";

function envTrim(k: string): string {
  return (process.env[k] ?? "").trim();
}

export async function POST(req: Request): Promise<Response> {
  // Per-session 4/min so co-located users don't share one bucket;
  // per-IP 20/min cap so cookie-minting can't multiply throughput.
  const rl = rateLimitDual(
    "trader-dispatch",
    req,
    { windowMs: 60_000, max: 4 },
    { windowMs: 60_000, max: 20 },
  );
  if (!rl.ok) {
    return rateLimitedResponse(
      rl.retryAfterSec,
      `Trader dispatch is limited to 4 per minute. Retry in ${rl.retryAfterSec}s.`,
    );
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  const policyId = (body.policy_id ?? "").trim();
  const strategy = (body.strategy ?? "").trim();
  const traderName = (body.trader_name ?? "").trim().slice(0, NAME_MAX);
  const bountySui =
    typeof body.bounty_sui === "number" && body.bounty_sui > 0
      ? body.bounty_sui
      : 0.01;
  const marketsRaw = (body.markets ?? "btc_only").trim();
  const markets = ALLOWED_MARKETS.has(marketsRaw) ? marketsRaw : "btc_only";

  // Sanitize the goal to the known shape; anything off → omit, and the
  // trader falls back to baseline thresholds.
  const GOAL_TYPES = new Set(["grow", "preserve", "edge"]);
  let goal: { type: string; targetPct?: number; horizonDays?: number } | undefined;
  if (body.goal && GOAL_TYPES.has(String(body.goal.type))) {
    goal = { type: String(body.goal.type) };
    if (goal.type === "grow") {
      const t = Number(body.goal.targetPct);
      const h = Number(body.goal.horizonDays);
      if (Number.isFinite(t) && t > 0) goal.targetPct = Math.min(100, t);
      if (Number.isFinite(h) && h > 0) goal.horizonDays = Math.min(365, h);
    }
  }

  if (!HEX_RE.test(policyId)) {
    return Response.json(
      { ok: false, error: "policy_id must be a 0x… Sui object id" },
      { status: 400 },
    );
  }
  if (!ALLOWED_STRATEGIES.has(strategy)) {
    return Response.json(
      {
        ok: false,
        error: `strategy must be one of: ${Array.from(ALLOWED_STRATEGIES).join(", ")}`,
      },
      { status: 400 },
    );
  }

  const plannerSecret =
    envTrim("AGENT_SECRET_KEY_OVERRIDE") || envTrim("AGENT_SECRET_KEY");
  const treasurySecret = envTrim("TREASURY_SECRET_KEY");
  const packageId = envTrim("NEXT_PUBLIC_BRIEF_PACKAGE_ID");
  if (!plannerSecret) {
    return Response.json(
      { ok: false, error: "AGENT_SECRET_KEY not configured" },
      { status: 500 },
    );
  }
  if (!treasurySecret) {
    return Response.json(
      { ok: false, error: "TREASURY_SECRET_KEY not configured" },
      { status: 500 },
    );
  }
  if (!packageId) {
    return Response.json(
      { ok: false, error: "NEXT_PUBLIC_BRIEF_PACKAGE_ID not configured" },
      { status: 500 },
    );
  }

  const network = (envTrim("NEXT_PUBLIC_SUI_NETWORK") || "testnet") as
    | "testnet"
    | "mainnet";
  const client = new SuiJsonRpcClient({
    network,
    url: getJsonRpcFullnodeUrl(network),
  });
  // The whole trader-product task lifecycle is signed by the Treasury
  // wallet (poster == assignee == policy.agent == approver), with the
  // user as policy.owner holding the kill switch. record_spend asserts
  // sender == policy.agent, so the poster/approver MUST be Treasury for
  // live mints + the revoke abort to clear. (Planner key kept available
  // for the legacy workforce path.)
  const treasury = Ed25519Keypair.fromSecretKey(treasurySecret);
  const treasuryAddress = treasury.toSuiAddress();
  void plannerSecret;

  const deadlineMs = BigInt(Date.now() + 30 * 60 * 1000);
  const specObj: Record<string, unknown> = {
    strategy,
    policyId,
    venue: "predict-btc",
    markets,
  };
  if (traderName) specObj.traderName = traderName;
  if (goal) specObj.goal = goal;
  const specBlob = JSON.stringify(specObj);
  const bountyMist = BigInt(Math.floor(bountySui * 1_000_000_000));
  const title = traderName
    ? `${traderName} · ${strategy}`
    : `Trader · ${strategy}`;

  try {
    const tx = new Transaction();
    const [bountyCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(bountyMist)]);
    tx.moveCall({
      target: `${packageId}::task::post`,
      arguments: [
        bountyCoin,
        tx.pure.address(treasuryAddress),
        tx.pure.string(title),
        tx.pure.string(specBlob),
        tx.pure.string("predict-btc"),
        tx.pure.u64(deadlineMs),
        // parent_policy = Some(policy_id)
        tx.pure(bcs.option(bcs.Address).serialize(policyId)),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });

    const res = await client.signAndExecuteTransaction({
      signer: treasury,
      transaction: tx,
      options: { showEffects: true, showObjectChanges: true },
    });
    if (res.effects?.status?.status !== "success") {
      return Response.json(
        { ok: false, error: res.effects?.status?.error ?? "post failed" },
        { status: 502 },
      );
    }
    const created = (res.objectChanges ?? []).find(
      (c) =>
        c.type === "created" &&
        typeof (c as { objectType?: string }).objectType === "string" &&
        (c as { objectType?: string }).objectType?.includes("::task::Task"),
    ) as { objectId?: string } | undefined;

    return Response.json({
      ok: true,
      task_id: created?.objectId ?? null,
      tx_digest: res.digest,
      treasury_address: treasuryAddress,
      title,
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return Response.json({ ok: false, error: msg }, { status: 502 });
  }
}
