// Env loader + validator. Run agents with `tsx --env-file=.env.local …`
// so process.env is populated before this module is imported.

export type AgentRole = "planner" | "research" | "treasury";

export type AgentEnv = {
  /** LATEST package id · use for moveCall targets. */
  packageId: string;
  /** ORIGINAL publish-at id · use for type filters (StructType, MoveEventType). */
  typeOriginId: string;
  network: "testnet" | "mainnet";
  rpcUrl: string;
  /**
   * Planner / "agent" secret key. Bound to policy.agent in every
   * OperatorPolicy granted via the Hire Wizard, so it CANNOT change without
   * re-granting every active policy. The /workforce dApp Kit flow defaults
   * policy.agent to NEXT_PUBLIC_BRIEF_OPERATOR_ADDRESS (= this key's address).
   */
  agentSecretKey: string;
  /** Research specialist key. Empty → degraded single-wallet fallback. */
  researchSecretKey: string;
  /** Treasury specialist key. Empty → degraded single-wallet fallback. */
  treasurySecretKey: string;
  /**
   * Either may be set; Commonstack (DeepSeek v4-flash) is the primary
   * provider. Empty string when not set; agents that need LLM fall back
   * to deterministic template reasoning.
   */
  commonstackApiKey: string;
  anthropicApiKey: string;
};

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) {
    throw new Error(
      `Missing required env var ${key}. Add it to .env.local · see README.md`,
    );
  }
  return v;
}

export function loadEnv(): AgentEnv {
  const network = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as
    | "testnet"
    | "mainnet";

  const packageId = requireEnv("NEXT_PUBLIC_BRIEF_PACKAGE_ID");
  return {
    packageId,
    // Falls back to packageId for pre-upgrade builds (origin == latest before any upgrade).
    typeOriginId: process.env.NEXT_PUBLIC_BRIEF_TYPE_ORIGIN_ID ?? packageId,
    network,
    rpcUrl:
      process.env.NEXT_PUBLIC_SUI_RPC_URL ??
      (network === "mainnet"
        ? "https://fullnode.mainnet.sui.io:443"
        : "https://fullnode.testnet.sui.io:443"),
    agentSecretKey:
      process.env.AGENT_SECRET_KEY_OVERRIDE ??
      process.env.AGENT_SECRET_KEY ??
      "",
    researchSecretKey: process.env.RESEARCH_SECRET_KEY ?? "",
    treasurySecretKey: process.env.TREASURY_SECRET_KEY ?? "",
    commonstackApiKey: process.env.COMMONSTACK_API_KEY ?? "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  };
}

/**
 * Resolve the secret key for a given role. Returns `{ key, degraded }`
 * where `degraded === true` means the specialist key was unset and the
 * Planner / shared key is being reused. Callers should warn loudly when
 * `degraded` is true so the multi-agent demo doesn't quietly collapse
 * back to single-wallet mode.
 */
export function resolveSecretKey(
  env: AgentEnv,
  role: AgentRole,
): { key: string; degraded: boolean } {
  if (role === "planner") {
    return { key: env.agentSecretKey, degraded: false };
  }
  if (role === "research") {
    return env.researchSecretKey
      ? { key: env.researchSecretKey, degraded: false }
      : { key: env.agentSecretKey, degraded: true };
  }
  if (role === "treasury") {
    return env.treasurySecretKey
      ? { key: env.treasurySecretKey, degraded: false }
      : { key: env.agentSecretKey, degraded: true };
  }
  throw new Error(`unknown agent role: ${role as string}`);
}

/** Return the active LLM key (Commonstack preferred), or empty if none. */
export function activeLlmKey(env: AgentEnv): string {
  return env.commonstackApiKey || env.anthropicApiKey || "";
}
