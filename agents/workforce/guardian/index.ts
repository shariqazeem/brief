// Risk Guardian · Brief's SECOND autonomous agent.
//
// The trader decides WHEN to allocate; the Guardian decides WHEN NOT TO. It runs
// its own loop, independently watches each operator's risk (realized volatility
// + drawdown), and writes a pause/resume signal that the trader checks before it
// builds ANY trade. This is real multi-agent coordination: two agents, one
// shared on-disk signal, the Move policy still the ultimate gate, and the owner's
// revoke overriding everything.
//
// It is READ-ONLY (no keypair, no signing) — it never touches funds, it only
// raises or lowers a flag. A pause means the trader stands the operator down
// until conditions normalize; the owner can always revoke regardless.
//
// Deterministic circuit-breakers (env-tunable). Run via pm2 (brief-guardian).

import { promises as fs } from "node:fs";

import { loadHistory } from "../trader/price-history.js";
import { realizedVol } from "../trader/signals.js";
import { loadStats } from "../trader/ledger.js";
import { gatedAssetsFor } from "../lib/markets.js";
import { emitAgentEvent } from "../lib/agent-events.js";
import {
  loadGuardianStatus,
  saveGuardianStatus,
  type GuardianOperator,
  type GuardianStatus,
} from "../lib/guardian-status.js";

const POLL_MS = Number(process.env.GUARDIAN_POLL_MS ?? 45_000);
const OPERATOR_REGISTRY_PATH = ".cursors/operator-registry.json";

// Circuit-breaker thresholds (annualized realized vol; worst drawdown %).
// Hysteresis: pause above the high water mark, only resume below the low one.
const VOL_PAUSE = Number(process.env.GUARDIAN_VOL_PAUSE ?? 2.8);
const VOL_RESUME = Number(process.env.GUARDIAN_VOL_RESUME ?? 2.2);
const DD_PAUSE = Number(process.env.GUARDIAN_DD_PAUSE ?? 12);
const DD_RESUME = Number(process.env.GUARDIAN_DD_RESUME ?? 8);
// Comma-separated policy ids to force-pause (demo / manual circuit break).
const FORCED = new Set(
  (process.env.GUARDIAN_FORCE_PAUSE ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

type RegistryEntry = {
  policyId: string;
  network?: "mainnet" | "testnet";
  revoked?: boolean;
};

async function loadRegistry(): Promise<RegistryEntry[]> {
  try {
    const raw = await fs.readFile(OPERATOR_REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RegistryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Max annualized realized vol across the operator's tradeable assets. */
async function maxVol(network: "mainnet" | "testnet"): Promise<number | null> {
  let max: number | null = null;
  const now = Date.now();
  for (const asset of gatedAssetsFor(network)) {
    try {
      const v = realizedVol(await loadHistory(asset), now, 60 * 60_000);
      if (v != null && (max == null || v > max)) max = v;
    } catch {
      /* skip asset */
    }
  }
  return max;
}

async function tick(): Promise<void> {
  const prev = await loadGuardianStatus();
  const registry = (await loadRegistry()).filter((e) => !e.revoked);
  const now = Date.now();
  const operators: Record<string, GuardianOperator> = {};

  for (const e of registry) {
    const network = e.network ?? "mainnet";
    const vol = await maxVol(network);
    const stats = await loadStats(e.policyId);
    // A withdrawn operator is closed · the guardian doesn't manage it.
    if (stats?.withdrawn) continue;
    const dd = stats?.worstDrawdownPct ?? 0;
    const wasPaused = prev.operators[e.policyId]?.paused ?? false;
    const forced = FORCED.has(e.policyId);

    // Hysteresis: once paused, require BOTH metrics back under the low marks
    // (and not forced) to resume; once active, trip on EITHER high mark.
    const tripped =
      forced || (vol != null && vol > VOL_PAUSE) || dd > DD_PAUSE;
    const recovered =
      !forced && (vol == null || vol < VOL_RESUME) && dd < DD_RESUME;
    const paused = wasPaused ? !recovered : tripped;

    let reason: string;
    let severity: GuardianOperator["severity"];
    if (paused) {
      severity = "paused";
      reason = forced
        ? "Manually paused by the risk circuit-breaker."
        : dd > DD_PAUSE
          ? `Drawdown ${dd.toFixed(1)}% exceeded the ${DD_PAUSE}% limit — standing trading down.`
          : `Volatility spiking (${vol != null ? Math.round(vol * 100) : "?"}% annualized) — too risky to add exposure.`;
    } else if (vol != null && vol > VOL_RESUME) {
      severity = "watch";
      reason = `Elevated volatility (${Math.round(vol * 100)}% annualized) — watching closely.`;
    } else {
      severity = "ok";
      reason = "Risk within limits — trading permitted.";
    }

    const since = wasPaused === paused ? (prev.operators[e.policyId]?.since ?? now) : now;
    operators[e.policyId] = {
      paused,
      reason,
      severity,
      vol,
      drawdownPct: dd,
      since,
      updatedMs: now,
    };

    // Emit on transitions so the dashboard shows the pause/resume moment.
    if (paused !== wasPaused) {
      emitAgentEvent(paused ? "guardian_pause" : "guardian_resume", {
        policyId: e.policyId,
        asset: "SUI",
        data: { reason, vol, drawdown_pct: dd, severity },
      });
      console.log(
        `[guardian] ${e.policyId.slice(0, 10)}… ${paused ? "PAUSED" : "RESUMED"} · ${reason}`,
      );
    }
  }

  const status: GuardianStatus = { updatedMs: now, operators };
  await saveGuardianStatus(status);
}

async function main(): Promise<void> {
  console.log(
    `[guardian] Risk Guardian online · poll=${POLL_MS}ms · vol pause/resume ${VOL_PAUSE}/${VOL_RESUME} · drawdown ${DD_PAUSE}%/${DD_RESUME}%${FORCED.size ? ` · forced=[${[...FORCED].map((p) => p.slice(0, 8)).join(",")}]` : ""}`,
  );
  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.warn(`[guardian] tick error: ${String((err as Error)?.message ?? err).slice(0, 140)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

void main();
