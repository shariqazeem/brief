// Gas Warden — keeps the agent fleet solvent so a demo (or 100 real
// users) never dies on "insufficient gas".
//
// Every WARDEN_POLL_MS it:
//   1. Reads SUI + WAL balances for Planner / Treasury / Research and
//      the PredictManager's dUSDC.
//   2. If a wallet is below its floor, pulls SUI from the richest
//      wallet that can spare it (donor keeps its own target + buffer),
//      consolidating coins on both sides — the SDK's largest-coin gas
//      selection makes fragmented wallets fail high-cost txs (see
//      AGENT-HANDOFF "gas coin selection bug").
//   3. Falls back to the public faucet (15-min cooldown — gotcha #10:
//      hammering it blocks the VM egress IP for an hour) only when no
//      wallet can donate.
//   4. Writes .cursors/warden-status.json for /api/system/health and
//      emits a `warden_topup` event so the dashboard can show the
//      self-healing moment honestly.
//
// The warden REPORTS WAL + dUSDC but never tries to acquire them —
// those come from the Walrus exchange + the dUSDC form, both human
// steps. Honest status beats silent magic.
//
// Run modes: pm2 long-lived (default) or WARDEN_ONCE=1 for a single
// tick (local rebalance / smoke test).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Transaction } from "@mysten/sui/transactions";

import { loadEnv } from "../../lib/env.js";
import {
  makeAgentContextFor,
  type AgentContext,
} from "../../lib/sui.js";
import { signAndExecuteWithRetry } from "../../lib/sui-retry.js";
import { consolidateSuiCoins } from "../../lib/sui-coin-consolidate.js";
import { readManagerDusdcBalance, DUSDC_BASE } from "../lib/predict.js";
import { emitAgentEvent } from "../lib/agent-events.js";
import type { AgentRole } from "../../lib/env.js";

const POLL_MS = Number(process.env.WARDEN_POLL_MS ?? 60_000);
const STATUS_PATH = path.join(".cursors", "warden-status.json");
const FAUCET_COOLDOWN_MS = 15 * 60_000;
const MIST = 1e9;

// Floors sized to the real cost profile: Treasury signs every mint +
// two Walrus uploads (~15M mist each); Planner signs every task post
// (0.01 SUI bounty + ~3M overhead); Research is mostly a reserve.
type WalletPlan = {
  role: AgentRole;
  floorMist: bigint;
  targetMist: bigint;
};
const PLAN: WalletPlan[] = [
  { role: "treasury", floorMist: 80_000_000n, targetMist: 450_000_000n },
  { role: "planner", floorMist: 150_000_000n, targetMist: 500_000_000n },
  { role: "research", floorMist: 20_000_000n, targetMist: 60_000_000n },
];
/** A donor never gives below its own target plus this buffer. */
const DONOR_BUFFER = 100_000_000n;
/** Don't bother moving dust. */
const MIN_TRANSFER = 20_000_000n;

const WAL_TYPE_FRAGMENT = "::wal::WAL";

type WalletSnapshot = {
  role: AgentRole;
  address: string;
  sui_mist: string;
  wal_mist: string;
  below_floor: boolean;
};

type WardenAction = {
  ts: number;
  type: "transfer" | "faucet" | "transfer_failed" | "faucet_failed";
  from?: string;
  to: string;
  amount_mist?: string;
  digest?: string;
  note?: string;
};

type WardenStatus = {
  ts: number;
  wallets: WalletSnapshot[];
  manager_dusdc: number;
  actions: WardenAction[];
};

let lastFaucetAtMs = 0;
let actionLog: WardenAction[] = [];

async function readBalances(
  ctx: AgentContext,
): Promise<{ sui: bigint; wal: bigint }> {
  let sui = 0n;
  let wal = 0n;
  const all = await ctx.client.getAllBalances({ owner: ctx.address });
  for (const b of all) {
    if (b.coinType === "0x2::sui::SUI") sui = BigInt(b.totalBalance);
    else if (b.coinType.endsWith(WAL_TYPE_FRAGMENT)) wal = BigInt(b.totalBalance);
  }
  return { sui, wal };
}

async function transferSui(
  donor: AgentContext,
  toAddress: string,
  amountMist: bigint,
): Promise<string> {
  // Merge donor coins first — a fragmented donor can pick a gas coin
  // too small for split+transfer and abort at balance::split.
  try {
    await consolidateSuiCoins(donor.client, donor.keypair);
  } catch {
    /* best-effort */
  }
  const buildTx = () => {
    const tx = new Transaction();
    tx.setGasBudget(3_000_000n);
    const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
    tx.transferObjects([c], tx.pure.address(toAddress));
    return tx;
  };
  const res = await signAndExecuteWithRetry(
    donor,
    buildTx,
    { showEffects: true },
    { label: "warden:transfer", attempts: 2 },
  );
  if (res.effects?.status?.status !== "success") {
    throw new Error(res.effects?.status?.error ?? "transfer failed");
  }
  return res.digest;
}

async function tryFaucet(address: string): Promise<string | null> {
  if (Date.now() - lastFaucetAtMs < FAUCET_COOLDOWN_MS) return null;
  lastFaucetAtMs = Date.now();
  try {
    const r = await fetch("https://faucet.testnet.sui.io/v2/gas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
    });
    if (!r.ok) return `HTTP ${r.status}`;
    return "ok";
  } catch (e) {
    return String((e as Error)?.message ?? e).slice(0, 80);
  }
}

function pushAction(a: WardenAction): void {
  actionLog = [...actionLog.slice(-19), a];
}

async function writeStatus(status: WardenStatus): Promise<void> {
  await fs.mkdir(path.dirname(STATUS_PATH), { recursive: true });
  const tmp = STATUS_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(status, null, 2));
  await fs.rename(tmp, STATUS_PATH);
}

async function tick(
  ctxs: Map<AgentRole, AgentContext>,
  managerId: string,
): Promise<void> {
  const balances = new Map<AgentRole, { sui: bigint; wal: bigint }>();
  for (const [role, ctx] of ctxs) {
    try {
      balances.set(role, await readBalances(ctx));
    } catch (e) {
      console.warn(
        `[warden] balance read failed for ${role}:`,
        String((e as Error)?.message ?? e).slice(0, 100),
      );
    }
  }

  // Rebalance: neediest (largest relative deficit) first.
  const needy = PLAN.filter((p) => {
    const b = balances.get(p.role);
    return b !== undefined && b.sui < p.floorMist;
  }).sort((a, b) => {
    const da = a.floorMist - (balances.get(a.role)?.sui ?? 0n);
    const db = b.floorMist - (balances.get(b.role)?.sui ?? 0n);
    return db > da ? 1 : -1;
  });

  for (const need of needy) {
    const needCtx = ctxs.get(need.role)!;
    const needBal = balances.get(need.role)!;
    const deficit = need.targetMist - needBal.sui;
    if (deficit < MIN_TRANSFER) continue;

    // Donor: richest wallet that stays above its own target + buffer.
    let donor: { plan: WalletPlan; surplus: bigint } | null = null;
    for (const p of PLAN) {
      if (p.role === need.role) continue;
      const b = balances.get(p.role);
      if (!b) continue;
      const surplus = b.sui - p.targetMist - DONOR_BUFFER;
      if (surplus >= MIN_TRANSFER && (!donor || surplus > donor.surplus)) {
        donor = { plan: p, surplus };
      }
    }

    if (donor) {
      const donorCtx = ctxs.get(donor.plan.role)!;
      const amount = deficit < donor.surplus ? deficit : donor.surplus;
      try {
        const digest = await transferSui(donorCtx, needCtx.address, amount);
        console.log(
          `[warden] topped up ${need.role} with ${(Number(amount) / MIST).toFixed(3)} SUI from ${donor.plan.role} tx=${digest}`,
        );
        pushAction({
          ts: Date.now(),
          type: "transfer",
          from: donor.plan.role,
          to: need.role,
          amount_mist: amount.toString(),
          digest,
        });
        emitAgentEvent("warden_topup", {
          data: {
            from: donor.plan.role,
            to: need.role,
            amount_sui: Number(amount) / MIST,
            tx: digest,
          },
        });
        // Merge the receiver so its next high-cost tx sees one coin.
        try {
          await consolidateSuiCoins(needCtx.client, needCtx.keypair);
        } catch {
          /* best-effort */
        }
        // Refresh both balances for subsequent passes this tick.
        balances.set(need.role, await readBalances(needCtx));
        balances.set(donor.plan.role, await readBalances(donorCtx));
      } catch (e) {
        const note = String((e as Error)?.message ?? e).slice(0, 120);
        console.warn(`[warden] transfer to ${need.role} failed:`, note);
        pushAction({ ts: Date.now(), type: "transfer_failed", to: need.role, note });
      }
    } else {
      const result = await tryFaucet(needCtx.address);
      if (result === "ok") {
        console.log(`[warden] no donor available — faucet requested for ${need.role}`);
        pushAction({ ts: Date.now(), type: "faucet", to: need.role });
      } else if (result !== null) {
        console.warn(`[warden] faucet for ${need.role} failed: ${result}`);
        pushAction({ ts: Date.now(), type: "faucet_failed", to: need.role, note: result });
      }
      // result === null → cooldown active; stay quiet.
    }
  }

  let managerDusdc = 0;
  if (managerId) {
    try {
      managerDusdc =
        Number(await readManagerDusdcBalance(ctxs.get("treasury")!, managerId)) /
        DUSDC_BASE;
    } catch {
      /* report 0; the trader independently degrades to simulated */
    }
  }

  const status: WardenStatus = {
    ts: Date.now(),
    wallets: PLAN.map((p) => {
      const ctx = ctxs.get(p.role)!;
      const b = balances.get(p.role);
      return {
        role: p.role,
        address: ctx.address,
        sui_mist: (b?.sui ?? 0n).toString(),
        wal_mist: (b?.wal ?? 0n).toString(),
        below_floor: (b?.sui ?? 0n) < p.floorMist,
      };
    }),
    manager_dusdc: managerDusdc,
    actions: actionLog,
  };
  await writeStatus(status);

  const summary = status.wallets
    .map((w) => `${w.role}=${(Number(w.sui_mist) / MIST).toFixed(3)}`)
    .join(" ");
  console.log(`[warden] ${summary} manager_dusdc=${managerDusdc.toFixed(1)}`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const ctxs = new Map<AgentRole, AgentContext>();
  for (const p of PLAN) {
    ctxs.set(p.role, makeAgentContextFor(env, p.role));
  }
  const managerId = (process.env.BRIEF_PREDICT_MANAGER_ID ?? "").trim();
  console.log(
    `[warden] online — watching ${PLAN.map((p) => p.role).join(", ")} every ${POLL_MS / 1000}s` +
      (managerId ? ` + manager ${managerId.slice(0, 10)}…` : ""),
  );

  if (process.env.WARDEN_ONCE === "1") {
    await tick(ctxs, managerId);
    console.log("[warden] WARDEN_ONCE=1 — single tick done, exiting");
    return;
  }

  // Serial loop (not setInterval) so a slow RPC tick never overlaps
  // the next one and double-spends a donor.
  for (;;) {
    try {
      await tick(ctxs, managerId);
    } catch (e) {
      console.warn("[warden] tick failed:", String((e as Error)?.message ?? e).slice(0, 140));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

void main();
