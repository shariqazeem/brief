// Risk Guardian · Brief's risk faculty (graduated, asset-relative).
//
// The trader decides WHEN to allocate; the Guardian decides HOW MUCH risk is
// safe right now. It runs its own loop, watches each operator's risk PER ASSET
// relative to that asset's OWN recent normal (a rolling realized-vol percentile),
// and writes a graduated signal the trader applies before it builds any trade:
//
//   normal   → full size
//   elevated → smaller positions      (>70th percentile of the asset's own vol)
//   extreme  → no NEW exposure        (>90th · hold or reduce only)
//   crash    → move to cash           (>98th, or drawdown limit breached)
//
// It REDUCES exposure before it freezes, so a naturally-volatile asset like SUI
// (or DEEP) no longer looks broken. An absolute floor stops a genuinely calm
// market from tripping the breaker just because it is its own local top
// percentile. Each operator is judged ONLY against the assets in its universe.
//
// READ-ONLY (no keypair, no signing) — it never touches funds, only writes a
// signal. The Move policy is still the ultimate gate, and the owner's revoke
// overrides everything. Run via pm2 (brief-guardian).

import { promises as fs } from "node:fs";

import { loadHistory } from "../trader/price-history.js";
import { realizedVol } from "../trader/signals.js";
import { loadStats } from "../trader/ledger.js";
import { gatedAssetsFor } from "../lib/markets.js";
import { emitAgentEvent } from "../lib/agent-events.js";
import {
  loadGuardianStatus,
  saveGuardianStatus,
  type AssetGuardState,
  type GuardianOperator,
  type GuardianStatus,
  type RiskLevel,
} from "../lib/guardian-status.js";

const POLL_MS = Number(process.env.GUARDIAN_POLL_MS ?? 45_000);
const OPERATOR_REGISTRY_PATH = ".cursors/operator-registry.json";

// 60m realized-vol window + how we sample the trailing distribution for ranking.
const VOL_WINDOW_MS = 60 * 60_000;
const PCTL_SAMPLE_STEP_MS = 20 * 60_000;
const PCTL_MIN_SAMPLES = 12;

// Asset-relative percentile bands (of the asset's OWN trailing 60m-vol
// distribution). Reduce before freeze: elevated → smaller, extreme → no new
// exposure, crash → cash.
const PCTL_ELEVATED = Number(process.env.GUARDIAN_PCTL_ELEVATED ?? 70);
const PCTL_EXTREME = Number(process.env.GUARDIAN_PCTL_EXTREME ?? 90);
const PCTL_CRASH = Number(process.env.GUARDIAN_PCTL_CRASH ?? 98);

// Absolute sanity floor per asset (annualized): below this, vol is "normal"
// regardless of percentile, so a genuinely calm window can't trip the breaker
// just because something sits at its own local 98th percentile. Grounded in
// each asset's measured normal (SUI median ~57%, WAL ~79%, DEEP ~175%).
const VOL_FLOOR: Record<string, number> = { SUI: 1.2, WAL: 1.5, DEEP: 3.0 };
const VOL_FLOOR_DEFAULT = Number(process.env.GUARDIAN_VOL_FLOOR ?? 1.5);
const volFloorFor = (asset: string): number =>
  VOL_FLOOR[asset.toUpperCase()] ?? VOL_FLOOR_DEFAULT;

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
  /** Assets this operator may trade. Absent → all gated assets (back-compat). */
  universe?: string[];
};

/** The assets this operator is judged against · its own universe intersected
 *  with the network's gated assets. Defaults to all gated assets when unset. */
function entryUniverse(e: RegistryEntry): string[] {
  const all = gatedAssetsFor(e.network ?? "mainnet");
  if (!e.universe || e.universe.length === 0) return all;
  const allow = new Set(e.universe.map((a) => a.toUpperCase()));
  const f = all.filter((a) => allow.has(a.toUpperCase()));
  return f.length ? f : all;
}

async function loadRegistry(): Promise<RegistryEntry[]> {
  try {
    const raw = await fs.readFile(OPERATOR_REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RegistryEntry[]) : [];
  } catch {
    return [];
  }
}

type AssetRisk = {
  asset: string;
  vol: number | null;
  pct: number | null;
  level: RiskLevel;
};

const LEVEL_RANK: Record<RiskLevel, number> = {
  normal: 0,
  elevated: 1,
  extreme: 2,
  crash: 3,
};

/** Current 60m realized vol for one asset, its percentile within that asset's
 *  OWN trailing distribution, and the resulting graduated risk level (gated by
 *  an absolute floor so a calm market never trips on relative percentile alone). */
async function assetRisk(
  asset: string,
  network: "mainnet" | "testnet",
): Promise<AssetRisk> {
  let history: Awaited<ReturnType<typeof loadHistory>>;
  try {
    history = await loadHistory(`${asset}-${network}`);
  } catch {
    return { asset, vol: null, pct: null, level: "normal" };
  }
  if (!history || history.length < 3) {
    return { asset, vol: null, pct: null, level: "normal" };
  }
  const now = Date.now();
  const cur = realizedVol(history, now, VOL_WINDOW_MS);
  if (cur == null) return { asset, vol: null, pct: null, level: "normal" };
  // Below the absolute floor → always normal (calm market, don't punish).
  if (cur < volFloorFor(asset)) return { asset, vol: cur, pct: null, level: "normal" };

  // Build the asset's own trailing distribution of 60m vols.
  const first = history[0]!.ts;
  const last = history[history.length - 1]!.ts;
  const samples: number[] = [];
  for (let end = first + VOL_WINDOW_MS; end <= last; end += PCTL_SAMPLE_STEP_MS) {
    const v = realizedVol(history, end, VOL_WINDOW_MS);
    if (v != null && Number.isFinite(v)) samples.push(v);
  }

  if (samples.length < PCTL_MIN_SAMPLES) {
    // Too little history to rank · fall back to multiples of the absolute floor.
    const f = volFloorFor(asset);
    const level: RiskLevel =
      cur > f * 4 ? "crash" : cur > f * 2.5 ? "extreme" : cur > f * 1.5 ? "elevated" : "normal";
    return { asset, vol: cur, pct: null, level };
  }

  samples.sort((a, b) => a - b);
  let below = 0;
  for (const s of samples) if (s <= cur) below++;
  const pct = (below / samples.length) * 100;
  const level: RiskLevel =
    pct >= PCTL_CRASH
      ? "crash"
      : pct >= PCTL_EXTREME
        ? "extreme"
        : pct >= PCTL_ELEVATED
          ? "elevated"
          : "normal";
  return { asset, vol: cur, pct, level };
}

/** Human-legible reason for ONE asset's vol state · this string renders in the
 *  UI Guard step, e.g. "DEEP vol at the 94th percentile of its own 60m history
 *  — no new DEEP exposure, hold or reduce only." */
function assetVolReason(r: AssetRisk): string {
  const volTxt = r.vol != null ? `${Math.round(r.vol * 100)}% annualized` : "unknown vol";
  const pctTxt =
    r.pct != null ? `${Math.round(r.pct)}th percentile of its own 60m history` : volTxt;
  switch (r.level) {
    case "crash":
      return `${r.asset} in a volatility crash (${pctTxt}) — no ${r.asset} exposure, moving to cash.`;
    case "extreme":
      return `${r.asset} vol at the ${pctTxt} — no new ${r.asset} exposure, hold or reduce only.`;
    case "elevated":
      return `${r.asset} vol at the ${pctTxt} — trading ${r.asset} smaller.`;
    default:
      return `${r.asset} risk within limits (${volTxt}) — full size permitted.`;
  }
}

async function tick(): Promise<void> {
  const prev = await loadGuardianStatus();
  const registry = (await loadRegistry()).filter((e) => !e.revoked);
  const now = Date.now();
  const operators: Record<string, GuardianOperator> = {};

  for (const e of registry) {
    const network = e.network ?? "mainnet";
    // Judge EACH asset in the operator's universe against its OWN history and
    // keep a per-asset state · DEEP's normal wildness gates DEEP exposure only,
    // it never freezes a calm SUI position on the same operator. `top` is the
    // worst asset, used purely for the human-readable summary fields.
    const assets: Record<string, AssetGuardState> = {};
    let top: AssetRisk | null = null;
    for (const asset of entryUniverse(e)) {
      const r = await assetRisk(asset, network);
      assets[asset] = {
        level: r.level,
        reason: assetVolReason(r),
        vol: r.vol,
        pct: r.pct,
        pausedNewExposure: r.level === "extreme" || r.level === "crash",
      };
      if (top == null) {
        top = r;
        continue;
      }
      const worse =
        LEVEL_RANK[r.level] > LEVEL_RANK[top.level] ||
        (LEVEL_RANK[r.level] === LEVEL_RANK[top.level] && (r.vol ?? 0) > (top.vol ?? 0));
      if (worse) top = r;
    }
    if (!top) top = { asset: "SUI", vol: null, pct: null, level: "normal" };

    const stats = await loadStats(e.policyId);
    // A withdrawn operator is closed · the guardian doesn't manage it.
    if (stats?.withdrawn) continue;
    const forced = FORCED.has(e.policyId);

    // ── Portfolio-level drawdown pause (halts EVERYTHING, all assets) ──
    // Use the CURRENT drawdown from peak (peak vs last marked value), NOT the
    // monotonic worst-ever, so the pause can actually RESUME · with 12/8
    // hysteresis: trip at DD_PAUSE, stay paused until it recovers below
    // DD_RESUME. (worstDrawdownPct never decreases, so gating on it would
    // freeze an operator forever after a single bad hour — this fixes that.)
    const curDD =
      stats && stats.peakValue > 0 && stats.lastValue > 0
        ? Math.max(0, ((stats.peakValue - stats.lastValue) / stats.peakValue) * 100)
        : 0;
    const wasDrawdownPause = prev.operators[e.policyId]?.portfolio?.drawdownPause ?? false;
    const drawdownPause = wasDrawdownPause ? curDD > DD_RESUME : curDD > DD_PAUSE;
    const worstDd = stats?.worstDrawdownPct ?? 0;

    // Summary level = worst asset, escalated to crash by a portfolio halt or a
    // manual force. Per-asset gating (the real behaviour) lives in `assets`.
    let level: RiskLevel = top.level;
    if (drawdownPause) level = "crash";
    if (forced) level = "crash";

    // Only crash is a full pause · elevated/extreme keep the operator working at
    // reduced size (the whole point of the graduated guardian).
    const paused = level === "crash";
    const severity: GuardianOperator["severity"] =
      level === "crash" ? "paused" : level === "normal" ? "ok" : "watch";

    const reason = forced
      ? "Manually paused by the risk circuit-breaker."
      : drawdownPause
        ? `Portfolio drawdown ${curDD.toFixed(1)}% exceeded the ${DD_PAUSE}% limit — moving to cash across all assets.`
        : assetVolReason(top);

    const wasLevel = prev.operators[e.policyId]?.riskLevel ?? "normal";
    const wasPaused = prev.operators[e.policyId]?.paused ?? false;
    const changed = level !== wasLevel;
    const since = changed ? now : (prev.operators[e.policyId]?.since ?? now);

    operators[e.policyId] = {
      paused,
      reason,
      severity,
      vol: top.vol,
      drawdownPct: worstDd,
      since,
      updatedMs: now,
      riskLevel: level,
      volPct: top.pct,
      assets,
      portfolio: { drawdownPause, drawdownPct: curDD },
    };

    // Emit a pause/resume event on the crash boundary (the dramatic moment the
    // dashboard shows); log other level changes without an event.
    if (paused !== wasPaused) {
      emitAgentEvent(paused ? "guardian_pause" : "guardian_resume", {
        policyId: e.policyId,
        asset: top.asset,
        data: { reason, vol: top.vol, drawdown_pct: curDD, severity, risk_level: level },
      });
      console.log(
        `[guardian] ${e.policyId.slice(0, 10)}… ${paused ? "PAUSED" : "RESUMED"} · ${reason}`,
      );
    } else if (changed) {
      console.log(`[guardian] ${e.policyId.slice(0, 10)}… ${level.toUpperCase()} · ${reason}`);
    }
  }

  const status: GuardianStatus = { updatedMs: now, operators };
  await saveGuardianStatus(status);
}

async function main(): Promise<void> {
  console.log(
    `[guardian] Risk Guardian online (graduated) · poll=${POLL_MS}ms · percentile bands ${PCTL_ELEVATED}/${PCTL_EXTREME}/${PCTL_CRASH} · drawdown stop ${DD_PAUSE}% (resume ${DD_RESUME}%)${FORCED.size ? ` · forced=[${[...FORCED].map((p) => p.slice(0, 8)).join(",")}]` : ""}`,
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
