import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { JsonRpcTransport } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { AgentEnv, AgentRole } from "./env.js";
import { resolveSecretKey } from "./env.js";
import { makeResilientTransport, resolveRpcUrls } from "./sui-rpc.js";

export type AgentContext = {
  client: SuiJsonRpcClient;
  keypair: Ed25519Keypair;
  address: string;
  /** LATEST package id · use for moveCall targets. */
  packageId: string;
  /** ORIGINAL publish-at id · use for type filters (StructType, MoveEventType). */
  typeOriginId: string;
};

/**
 * Back-compat: build a context using the Planner / shared
 * `AGENT_SECRET_KEY`. The Planner CLI, all scripts that act on behalf of
 * the policy owner (create-policy, approve-task, revoke-policy), and any
 * read-only probes go through this entry point so they continue to sign as
 * the wallet bound to `policy.agent`.
 */
export function makeAgentContext(env: AgentEnv): AgentContext {
  return buildContext(env, env.agentSecretKey);
}

/**
 * Multi-wallet entry point: build a context for a specific role. The
 * Research and Treasury agents call this so each specialist signs as its
 * own wallet (distinct address → distinct on-chain AgentRegistration →
 * reputation accrues to the specialist, not the Planner).
 *
 * Falls back to the Planner key when the specialist key is unset and emits
 * a loud DEGRADED warning so single-wallet mode is never silent.
 */
export function makeAgentContextFor(env: AgentEnv, role: AgentRole): AgentContext {
  const { key, degraded } = resolveSecretKey(env, role);
  if (degraded && role !== "planner") {
    console.warn(
      `[${role}] DEGRADED MULTI-WALLET MODE · ${role.toUpperCase()}_SECRET_KEY is not set; falling back to AGENT_SECRET_KEY. Run 'npm run workforce:setup' to provision a distinct ${role} wallet.`,
    );
  }
  return buildContext(env, key);
}

function buildContext(env: AgentEnv, secretKey: string): AgentContext {
  const urls = resolveRpcUrls(env.rpcUrl);
  // SuiJsonRpcClient's options are a union: pass either `url` or `transport`,
  // never both. We pass our resilient transport that rotates through `urls`
  // on 429/5xx/transient errors. Our transport implements the same
  // structural `request(...)` shape as JsonRpcHTTPTransport.
  const transport = makeResilientTransport({ urls }) as unknown as JsonRpcTransport;
  const client = new SuiJsonRpcClient({
    network: env.network,
    transport,
  });
  const keypair = secretKey
    ? Ed25519Keypair.fromSecretKey(secretKey)
    : Ed25519Keypair.generate();
  const address = keypair.getPublicKey().toSuiAddress();
  return {
    client,
    keypair,
    address,
    packageId: env.packageId,
    typeOriginId: env.typeOriginId,
  };
}
