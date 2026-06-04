import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { JsonRpcTransport } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { AgentEnv } from "./env.js";
import { makeResilientTransport, resolveRpcUrls } from "./sui-rpc.js";

export type AgentContext = {
  client: SuiJsonRpcClient;
  keypair: Ed25519Keypair;
  address: string;
  /** LATEST package id — use for moveCall targets. */
  packageId: string;
  /** ORIGINAL publish-at id — use for type filters (StructType, MoveEventType). */
  typeOriginId: string;
};

export function makeAgentContext(env: AgentEnv): AgentContext {
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
  const keypair = env.agentSecretKey
    ? Ed25519Keypair.fromSecretKey(env.agentSecretKey)
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
