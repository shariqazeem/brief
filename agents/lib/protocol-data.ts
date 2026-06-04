// Real Sui DeFi data, fetched from public APIs. Backs ResearchAgent and
// StrategyAgent so the WorkObject payloads contain actual on-chain stats
// instead of hardcoded numbers.
//
// Sources:
//   - https://api.llama.fi/protocols      → protocol TVL + audit count + listing age
//   - https://yields.llama.fi/pools       → per-pool APY + TVL
//
// In-memory cache with 5-min TTL so agents firing concurrently don't
// hammer the API.

const DEFILLAMA_PROTOCOLS = "https://api.llama.fi/protocols";
const DEFILLAMA_YIELDS = "https://yields.llama.fi/pools";

const DEFI_CATEGORIES = new Set([
  "Lending",
  "Dexes",
  "Liquid Staking",
  "CDP",
  "Yield",
  "Yield Aggregator",
  "Liquid Restaking",
  "Derivatives",
]);

export type AuditStatus = "audited" | "partial" | "unaudited";
export type RiskBand = "low" | "medium" | "high";

export type ProtocolStat = {
  name: string;
  category: string;
  tvl_usd: number;
  audits: number;
  audit_status: AuditStatus;
  age_days: number;
  best_apy: number;
  best_apy_pool: string;
  best_apy_tvl_usd: number;
  risk: RiskBand;
};

type LlamaProtocol = {
  name: string;
  chains?: string[];
  category?: string;
  tvl?: number;
  audits?: string | number;
  listedAt?: number;
};

type LlamaPool = {
  chain: string;
  project: string;
  symbol: string;
  apyBase?: number | null;
  apyReward?: number | null;
  tvlUsd?: number;
  ilRisk?: string;
  exposure?: string;
};

let cache: { stats: ProtocolStat[]; fetchedAt: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

const POOL_MIN_TVL = 100_000; // filter sub-$100k pools (noise / inflated APY)
const TOP_PROTOCOL_COUNT = 12;

function auditStatusOf(audits: number): AuditStatus {
  if (audits >= 2) return "audited";
  if (audits === 1) return "partial";
  return "unaudited";
}

/**
 * Score risk band for a protocol. Heuristics:
 *   - high TVL + audits + age >= 180d   → low
 *   - middling TVL OR partial audit     → medium
 *   - small TVL OR no audit OR < 90d    → high
 */
function scoreRisk(p: {
  tvl_usd: number;
  audits: number;
  age_days: number;
  category: string;
}): RiskBand {
  if (p.audits >= 2 && p.tvl_usd >= 50_000_000 && p.age_days >= 180) {
    return "low";
  }
  if (p.audits === 0 || p.age_days < 90 || p.tvl_usd < 10_000_000) {
    return "high";
  }
  return "medium";
}

function findBestPool(
  pools: LlamaPool[],
  protocolNameLower: string,
): LlamaPool | null {
  // Match by project slug (lowercase). DeFiLlama project slugs are like
  // "navi-lending", "suilend", "scallop-lending", etc. We match by the
  // first significant word of the protocol name.
  const key = protocolNameLower.split(/\s+/)[0];
  const candidates = pools.filter(
    (y) =>
      y.chain === "Sui" &&
      (y.tvlUsd ?? 0) >= POOL_MIN_TVL &&
      y.project.toLowerCase().includes(key),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce<LlamaPool | null>((best, cur) => {
    const curApy = (cur.apyBase ?? 0) + (cur.apyReward ?? 0);
    const bestApy = best ? (best.apyBase ?? 0) + (best.apyReward ?? 0) : -1;
    return curApy > bestApy ? cur : best;
  }, null);
}

export async function fetchSuiDefiProtocols(): Promise<ProtocolStat[]> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.stats;
  }

  const [protocolsResp, yieldsResp] = await Promise.all([
    fetch(DEFILLAMA_PROTOCOLS),
    fetch(DEFILLAMA_YIELDS),
  ]);

  if (!protocolsResp.ok || !yieldsResp.ok) {
    throw new Error(
      `DeFiLlama HTTP ${protocolsResp.status} / ${yieldsResp.status}`,
    );
  }

  const protocols = (await protocolsResp.json()) as LlamaProtocol[];
  const yieldsJson = (await yieldsResp.json()) as { data: LlamaPool[] };
  const pools = yieldsJson.data;

  const nowSec = Math.floor(Date.now() / 1000);

  const suiDefi = protocols
    .filter((p) => (p.chains ?? []).includes("Sui"))
    .filter((p) => DEFI_CATEGORIES.has(p.category ?? ""))
    .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
    .slice(0, TOP_PROTOCOL_COUNT);

  const stats: ProtocolStat[] = suiDefi.map((p) => {
    const audits = Number(p.audits ?? 0) || 0;
    const age =
      p.listedAt && p.listedAt > 0
        ? Math.floor((nowSec - p.listedAt) / 86_400)
        : 365; // default: assume >1y old if no listedAt
    const bestPool = findBestPool(pools, p.name.toLowerCase());
    const apy = bestPool
      ? (bestPool.apyBase ?? 0) + (bestPool.apyReward ?? 0)
      : 0;

    const base = {
      name: p.name,
      category: p.category ?? "Unknown",
      tvl_usd: p.tvl ?? 0,
      audits,
      audit_status: auditStatusOf(audits),
      age_days: age,
      best_apy: Number(apy.toFixed(2)),
      best_apy_pool: bestPool?.symbol ?? "",
      best_apy_tvl_usd: bestPool?.tvlUsd ?? 0,
      risk: "medium" as RiskBand,
    };
    base.risk = scoreRisk(base);
    return base;
  });

  cache = { stats, fetchedAt: Date.now() };
  return stats;
}

/**
 * Pick the top N protocols matching a coarse intent ("yield" vs "lending"
 * vs "trading"). Heuristic — Brief is not a quant engine; the agent's
 * LLM step does the deeper reasoning.
 */
export function rankForIntent(
  stats: ProtocolStat[],
  intentText: string,
  n = 5,
): ProtocolStat[] {
  // Normalize: lowercase + collapse hyphens/underscores to spaces so
  // "low-risk", "low_risk", "low risk" all match the same way.
  const lower = intentText.toLowerCase().replace(/[-_]+/g, " ");
  const wantsLowRisk =
    /\blow\s*risk\b/.test(lower) ||
    /\bsafe(st)?\b/.test(lower) ||
    /\bconservative\b/.test(lower) ||
    /\bsustainable\b/.test(lower) ||
    /\baudited\b/.test(lower);
  const wantsAggressive =
    /\bhigh\s*yield\b/.test(lower) ||
    /\baggressive\b/.test(lower) ||
    /\bmax\s*apy\b/.test(lower) ||
    /\bhighest\s*yield\b/.test(lower);
  const wantsLending =
    /\blend(ing)?\b/.test(lower) ||
    /\byield\b/.test(lower) ||
    /\bdeploy\b/.test(lower);
  const wantsLst = /\bstak(e|ing)\b/.test(lower) || /\blst\b/.test(lower);

  const ranked = [...stats].sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;

    if (wantsLowRisk) {
      // Strong penalty for unaudited + high-risk; reward audited + low-risk
      if (a.risk === "low") scoreA += 30;
      if (b.risk === "low") scoreB += 30;
      if (a.risk === "high") scoreA -= 50;
      if (b.risk === "high") scoreB -= 50;
      if (a.audit_status === "audited") scoreA += 15;
      if (b.audit_status === "audited") scoreB += 15;
      if (a.audit_status === "unaudited") scoreA -= 20;
      if (b.audit_status === "unaudited") scoreB -= 20;
    }
    if (wantsAggressive) {
      // Skew toward higher APY when explicitly aggressive
      scoreA += Math.min(a.best_apy, 100) * 1.0;
      scoreB += Math.min(b.best_apy, 100) * 1.0;
    }
    if (wantsLending) {
      if (a.category === "Lending") scoreA += 20;
      if (b.category === "Lending") scoreB += 20;
    }
    if (wantsLst) {
      if (a.category === "Liquid Staking") scoreA += 25;
      if (b.category === "Liquid Staking") scoreB += 25;
    }
    // Modest APY tiebreaker (capped) — only matters when other factors tie
    scoreA += Math.min(a.best_apy, 30) * 0.3;
    scoreB += Math.min(b.best_apy, 30) * 0.3;
    // TVL tiebreaker (log-scaled) — bigger protocols slightly favored
    scoreA += Math.log10(Math.max(a.tvl_usd, 1)) * 2;
    scoreB += Math.log10(Math.max(b.tvl_usd, 1)) * 2;

    return scoreB - scoreA;
  });

  return ranked.slice(0, n);
}

/**
 * Inspect the data and produce any guardian warnings that apply to a
 * proposed allocation. Inputs are the ranked protocols and a fractional
 * allocation (sums to ~1.0).
 */
export function computeGuardianWarnings(
  ranked: ProtocolStat[],
  allocation: Record<string, number>,
  orderSizeUsd: number,
): Array<{
  kind: "concentration" | "slippage" | "stale_pool" | "audit_risk" | "young_protocol";
  severity: "info" | "amber" | "red";
  message: string;
}> {
  const warnings: ReturnType<typeof computeGuardianWarnings> = [];

  // Concentration: any single protocol > 50% of allocation
  for (const [name, frac] of Object.entries(allocation)) {
    if (frac > 0.7) {
      warnings.push({
        kind: "concentration",
        severity: "red",
        message: `${(frac * 100).toFixed(0)}% allocated to ${name} — single-protocol failure would wipe most of the position.`,
      });
    } else if (frac > 0.5) {
      warnings.push({
        kind: "concentration",
        severity: "amber",
        message: `${(frac * 100).toFixed(0)}% allocated to ${name}. Consider splitting across more protocols.`,
      });
    }
  }

  // Slippage: estimate vs pool TVL for each protocol receiving funds
  for (const [name, frac] of Object.entries(allocation)) {
    const protocol = ranked.find((p) => p.name === name);
    if (!protocol || frac <= 0) continue;
    const allocUsd = orderSizeUsd * frac;
    const poolTvl = protocol.best_apy_tvl_usd || protocol.tvl_usd;
    if (poolTvl <= 0) continue;
    const ratio = allocUsd / poolTvl;
    if (ratio > 0.05) {
      const pctSlip = Math.min(ratio * 0.6, 0.05) * 100;
      warnings.push({
        kind: "slippage",
        severity: ratio > 0.1 ? "red" : "amber",
        message: `Projected slippage on the ${name} deposit at this size is ~${pctSlip.toFixed(2)}%. Order is ${(ratio * 100).toFixed(1)}% of pool TVL — consider splitting across two transactions.`,
      });
    }
  }

  // Audit risk: any partially-audited or unaudited protocol receiving funds
  for (const [name, frac] of Object.entries(allocation)) {
    if (frac <= 0) continue;
    const protocol = ranked.find((p) => p.name === name);
    if (!protocol) continue;
    if (protocol.audit_status === "unaudited") {
      warnings.push({
        kind: "audit_risk",
        severity: "red",
        message: `${name} is unaudited per DeFiLlama. Treat the allocation as high-risk and consider reducing.`,
      });
    } else if (protocol.audit_status === "partial") {
      warnings.push({
        kind: "audit_risk",
        severity: "amber",
        message: `${name} has only one published audit. Verify the audit firm before allocating significant capital.`,
      });
    }
  }

  // Young protocol: any allocation to a protocol < 180 days old
  for (const [name, frac] of Object.entries(allocation)) {
    if (frac <= 0) continue;
    const protocol = ranked.find((p) => p.name === name);
    if (!protocol) continue;
    if (protocol.age_days < 90) {
      warnings.push({
        kind: "young_protocol",
        severity: "amber",
        message: `${name} is ${protocol.age_days} days old. Historical performance is limited; tail-risk events have not been tested.`,
      });
    }
  }

  return warnings;
}
