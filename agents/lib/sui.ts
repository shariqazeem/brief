import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { AgentEnv } from "./env.js";

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
  const client = new SuiJsonRpcClient({
    network: env.network,
    url: env.rpcUrl,
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
