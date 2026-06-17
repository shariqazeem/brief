// POST /api/operators/register
//
// Records an adopted non-custodial operator so the trader's continuous
// gated-spot loop can find + trade it. Written here (server, same VM fs as
// the trader); the trader loop reads `.cursors/operator-registry.json`
// read-only. Each entry pins the on-chain objects the gated trade needs:
// the user's BalanceManager, the operator's delegated TradeCap, and the
// OperatorPolicy that gates every order.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX = /^0x[0-9a-fA-F]{2,}$/;
const REGISTRY = path.join(process.cwd(), ".cursors", "operator-registry.json");

type Goal = { type?: string; targetPct?: number; horizonDays?: number };
type Entry = {
  policyId: string;
  bmId: string;
  tradeCapId: string;
  /** Delegated DepositCap · lets the operator keep its DEEP fuel tank
   *  topped up (deposit-not-withdraw). Optional: pre-fuel adoptions lack it. */
  depositCapId: string | null;
  owner: string;
  personality: string;
  /** Operator mode · the engine's calibration (Protect/Grow/Aggressive).
   *  The decision engine reads this directly; personality/goal are legacy
   *  labels kept for the journal + manifesto. */
  mode: string;
  goal: Goal;
  /** Optional user investment mandate · objective + drawdown guard. */
  mandate?: Mandate | null;
  network: "mainnet" | "testnet";
  revoked: boolean;
  adoptedAtMs: number;
};

type Mandate = { targetReturnPct: number; horizonDays: number; maxDrawdownPct: number };

const MODES = ["protect", "grow", "aggressive"] as const;

function parseMandate(raw: unknown): Mandate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const d = Number(o.maxDrawdownPct);
  if (!Number.isFinite(d) || d <= 0) return null; // drawdown guard is required
  const t = Number(o.targetReturnPct);
  const h = Number(o.horizonDays);
  return {
    targetReturnPct: Number.isFinite(t) && t > 0 ? t : 0,
    horizonDays: Number.isFinite(h) && h > 0 ? h : 30,
    maxDrawdownPct: Math.min(90, d),
  };
}

// GET /api/operators/register?policy_id=0x… · the PUBLIC custody info the
// withdraw UI needs (BalanceManager id, network, owner). These are all public
// on-chain objects; no secrets. Returns 404 if the operator isn't registered.
export async function GET(req: NextRequest) {
  const policyId = req.nextUrl.searchParams.get("policy_id") ?? "";
  if (!HEX.test(policyId)) {
    return NextResponse.json({ ok: false, error: "policy_id must be a 0x… id" }, { status: 400 });
  }
  let list: Entry[] = [];
  try {
    const raw = await fs.readFile(REGISTRY, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed as Entry[];
  } catch {
    /* none */
  }
  const e = list.find((x) => x.policyId === policyId);
  if (!e) {
    return NextResponse.json({ ok: false, error: "operator not found" }, { status: 404 });
  }
  return NextResponse.json(
    {
      ok: true,
      policy_id: e.policyId,
      bm_id: e.bmId,
      owner: e.owner,
      network: e.network,
      revoked: e.revoked,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const policyId = String(body.policy_id ?? "");
  const bmId = String(body.bm_id ?? "");
  const tradeCapId = String(body.trade_cap_id ?? "");
  const owner = String(body.owner ?? "");
  for (const [k, v] of [
    ["policy_id", policyId],
    ["bm_id", bmId],
    ["trade_cap_id", tradeCapId],
    ["owner", owner],
  ] as const) {
    if (!HEX.test(v)) {
      return NextResponse.json({ ok: false, error: `${k} must be a 0x… id` }, { status: 400 });
    }
  }

  // DepositCap is optional, but if provided it must be a valid id.
  const depositCapId = body.deposit_cap_id == null ? null : String(body.deposit_cap_id);
  if (depositCapId !== null && !HEX.test(depositCapId)) {
    return NextResponse.json(
      { ok: false, error: "deposit_cap_id must be a 0x… id" },
      { status: 400 },
    );
  }

  const goalRaw = (body.goal ?? {}) as Goal;
  const goal: Goal = { type: typeof goalRaw.type === "string" ? goalRaw.type : "edge" };
  if (goal.type === "grow") {
    if (Number.isFinite(Number(goalRaw.targetPct))) goal.targetPct = Number(goalRaw.targetPct);
    if (Number.isFinite(Number(goalRaw.horizonDays))) goal.horizonDays = Number(goalRaw.horizonDays);
  }

  const entry: Entry = {
    policyId,
    bmId,
    tradeCapId,
    depositCapId,
    owner,
    personality: String(body.personality ?? "conservative"),
    mode: (MODES as readonly string[]).includes(String(body.mode))
      ? String(body.mode)
      : "grow",
    mandate: parseMandate(body.mandate),
    goal,
    network: body.network === "mainnet" ? "mainnet" : "testnet",
    revoked: false,
    adoptedAtMs: Date.now(),
  };

  let list: Entry[] = [];
  try {
    const raw = await fs.readFile(REGISTRY, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed as Entry[];
  } catch {
    /* first operator */
  }
  // Dedupe by policyId (re-register overwrites).
  list = list.filter((e) => e.policyId !== policyId);
  list.push(entry);

  await fs.mkdir(path.dirname(REGISTRY), { recursive: true });
  await fs.writeFile(REGISTRY, JSON.stringify(list, null, 2));

  return NextResponse.json({ ok: true, count: list.length, policy_id: policyId });
}
