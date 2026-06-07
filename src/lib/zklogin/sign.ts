// Sign a transaction with a zkLogin signature.
//
// Per the docs, a zkLogin signature is the concatenation of:
//   1. the zero-knowledge proof inputs (proofPoints, issBase64Details,
//      headerBase64, addressSeed),
//   2. the maxEpoch the proof is valid up to, and
//   3. an ephemeral Ed25519 signature over the transaction bytes.
//
// We build (3) with the ephemeral key persisted in sessionStorage,
// pass (1)+(2)+(3) through `getZkLoginSignature(...)`, and submit the
// transaction with the resulting serialized signature.

"use client";

import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Transaction } from "@mysten/sui/transactions";
import { getZkLoginSignature } from "@mysten/sui/zklogin";

import {
  ephemeralKeypairFromSecret,
  type ZkLoginSession,
} from "./session";

export type ZkLoginExecResult = {
  digest: string;
};

export async function signAndExecuteWithZkLogin({
  sui,
  session,
  transaction,
}: {
  sui: SuiJsonRpcClient;
  session: ZkLoginSession;
  transaction: Transaction;
}): Promise<ZkLoginExecResult> {
  // Bind the tx to the zkLogin address and serialize the bytes the
  // ephemeral key needs to sign.
  transaction.setSender(session.address);
  const txBytes = await transaction.build({ client: sui });

  const ephemeral = ephemeralKeypairFromSecret(session.ephemeralSecret);
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
