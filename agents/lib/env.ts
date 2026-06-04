// Env loader + validator. Run agents with `tsx --env-file=.env.local …`
// so process.env is populated before this module is imported.

export type AgentEnv = {
  /** LATEST package id — use for moveCall targets. */
  packageId: string;
  /** ORIGINAL publish-at id — use for type filters (StructType, MoveEventType). */
  typeOriginId: string;
  network: "testnet" | "mainnet";
  rpcUrl: string;
  agentSecretKey: string;
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
      `Missing required env var ${key}. Add it to .env.local — see README.md`,
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
    commonstackApiKey: process.env.COMMONSTACK_API_KEY ?? "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  };
}

/** Return the active LLM key (Commonstack preferred), or empty if none. */
export function activeLlmKey(env: AgentEnv): string {
  return env.commonstackApiKey || env.anthropicApiKey || "";
}
