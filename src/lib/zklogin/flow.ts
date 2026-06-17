// Heavy zkLogin pipeline · dynamically imported.
//
// Every dependency that pulls in @mysten/sui/zklogin (Poseidon, BCS,
// the address machinery) OR the Ed25519 keypair primitive lives here.
// Nothing in the eager bundle imports this file statically · only the
// dynamic `import("./flow")` calls from state.tsx (signIn / OAuth
// callback) and signer.ts (transaction signing) reach it, so a
// visitor who doesn't engage Google never pays for these bytes.

"use client";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Transaction } from "@mysten/sui/transactions";
import {
  genAddressSeed,
  generateNonce,
  generateRandomness,
  getExtendedEphemeralPublicKey,
  getZkLoginSignature,
  jwtToAddress,
} from "@mysten/sui/zklogin";

import { apiUrl } from "@/lib/api-base";
import { buildGoogleAuthUrl, GOOGLE_CLIENT_ID } from "./oauth";
import {
  savePreSession,
  type ZkLoginPreSession,
  type ZkLoginProof,
  type ZkLoginSession,
} from "./session";

// Ephemeral key + nonce + maxEpoch horizon. Two epochs is what the
// docs recommend · long enough for the OAuth round-trip and a few
// grant/revoke clicks, short enough that a leaked ephemeral key
// expires fast.
const MAX_EPOCH_HORIZON = 2;

/**
 * Generate the ephemeral session, persist it to sessionStorage, and
 * return the Google OAuth URL to redirect the user to.
 */
export async function startSignIn(sui: SuiJsonRpcClient): Promise<string> {
  const ephemeral = new Ed25519Keypair();
  const { epoch } = await sui.getLatestSuiSystemState();
  const maxEpoch = Number(epoch) + MAX_EPOCH_HORIZON;
  const randomness = generateRandomness();
  const nonce = generateNonce(ephemeral.getPublicKey(), maxEpoch, randomness);
  const pre: ZkLoginPreSession = {
    ephemeralSecret: ephemeral.getSecretKey(),
    randomness,
    maxEpoch,
    nonce,
  };
  savePreSession(pre);
  const redirectUri = window.location.origin + "/workforce";
  return buildGoogleAuthUrl({
    clientId: GOOGLE_CLIENT_ID,
    redirectUri,
    nonce,
  });
}

/**
 * Finish the OAuth round-trip: salt → address → proof → addressSeed.
 * The caller has already validated the JWT's nonce against the
 * persisted pre-session; here we just run the math + the two server
 * calls and return the full ZkLoginSession ready to persist.
 */
export async function completeOAuthCallback({
  jwt,
  claims,
  pre,
}: {
  jwt: string;
  claims: { sub: string; aud: string; email?: string };
  pre: ZkLoginPreSession;
}): Promise<ZkLoginSession> {
  // 1) Salt · deterministic per user (server HMAC).
  const saltR = await fetch(apiUrl("/api/zklogin/salt"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jwt }),
  });
  const saltJ = (await saltR.json()) as {
    ok?: boolean;
    salt?: string;
    error?: string;
  };
  if (!saltJ.ok || !saltJ.salt) {
    throw new Error(saltJ.error ?? "salt lookup failed");
  }
  const salt = saltJ.salt;

  // 2) Address · derived from JWT + salt.
  const address = jwtToAddress(jwt, salt, false);

  // 3) Proof · call Mysten's testnet prover via our proxy.
  const ephemeral = Ed25519Keypair.fromSecretKey(pre.ephemeralSecret);
  const extendedEpk = getExtendedEphemeralPublicKey(ephemeral.getPublicKey());
  const proveR = await fetch(apiUrl("/api/zklogin/prove"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jwt,
      extendedEphemeralPublicKey: extendedEpk,
      maxEpoch: pre.maxEpoch,
      jwtRandomness: pre.randomness,
      salt,
      keyClaimName: "sub",
    }),
  });
  const proveJ = (await proveR.json()) as {
    ok?: boolean;
    proof?: Partial<ZkLoginProof>;
    error?: string;
  };
  if (!proveJ.ok || !proveJ.proof) {
    throw new Error(proveJ.error ?? "prover failed");
  }

  // 4) addressSeed · the prover doesn't return this; compute it
  //    client-side so getZkLoginSignature has every BCS field it needs.
  const addressSeed = genAddressSeed(
    BigInt(salt),
    "sub",
    claims.sub,
    claims.aud,
  ).toString();
  const proof: ZkLoginProof = {
    proofPoints: proveJ.proof.proofPoints!,
    issBase64Details: proveJ.proof.issBase64Details!,
    headerBase64: proveJ.proof.headerBase64!,
    addressSeed,
  };

  return {
    jwt,
    salt,
    proof,
    ephemeralSecret: pre.ephemeralSecret,
    maxEpoch: pre.maxEpoch,
    address,
    email: claims.email,
    aud: claims.aud,
  };
}

/**
 * Sign + execute a transaction as the zkLogin user. The ephemeral key
 * signs the tx bytes; getZkLoginSignature wraps that with the ZK proof
 * and maxEpoch into the on-chain signature.
 */
export async function signTxWithZkLogin({
  sui,
  session,
  transaction,
}: {
  sui: SuiJsonRpcClient;
  session: ZkLoginSession;
  transaction: Transaction;
}): Promise<{ digest: string }> {
  transaction.setSender(session.address);
  const txBytes = await transaction.build({ client: sui });
  const ephemeral = Ed25519Keypair.fromSecretKey(session.ephemeralSecret);
  const { signature: userSignature } = await ephemeral.signTransaction(txBytes);
  const zkSignature = getZkLoginSignature({
    inputs: session.proof,
    maxEpoch: session.maxEpoch,
    userSignature,
  });
  const res = await sui.executeTransactionBlock({
    transactionBlock: txBytes,
    signature: zkSignature,
    options: { showEffects: true },
  });
  if (res.effects?.status?.status !== "success") {
    throw new Error(res.effects?.status?.error ?? "zkLogin tx failed");
  }
  return { digest: res.digest };
}
