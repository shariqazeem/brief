// useAccountSigner · one hook that wraps either the dApp Kit wallet
// signer OR the zkLogin signer. Components that just want "I have a
// connected account, sign this tx for me" use this so they don't have
// to know which auth method is active.
//
// Lightweight on purpose: the zkLogin signing path dynamic-imports
// `./flow` only when there's an active zkLogin session AND a tx is
// actually being signed. Visitors and wallet-only users never pull
// the prover/Poseidon/BCS code into the bundle.

"use client";

import { useCallback } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import type { Transaction } from "@mysten/sui/transactions";

import { useZkLogin } from "./state";

export type AccountSource = "wallet" | "zklogin" | "none";

export type SignerResult = { digest: string };

export type SignAndExecuteOptions = {
  onSuccess?: (r: SignerResult) => void;
  onError?: (e: Error) => void;
};

export type AccountSigner = {
  /** The active on-chain address · or null if neither auth path is set. */
  address: string | null;
  source: AccountSource;
  signAndExecute: (
    transaction: Transaction,
    callbacks?: SignAndExecuteOptions,
  ) => void;
  /** Display label for the signed-in user. */
  label: string | null;
};

export function useAccountSigner(): AccountSigner {
  const wallet = useCurrentAccount();
  const { mutate: walletSignAndExecute } = useSignAndExecuteTransaction();
  const { session: zkSession } = useZkLogin();
  const sui = useSuiClient();

  const signAndExecute = useCallback(
    (transaction: Transaction, cb?: SignAndExecuteOptions) => {
      // zkLogin takes precedence · beginners who signed in with Google
      // shouldn't be hijacked by a separately-connected wallet.
      if (zkSession) {
        void (async () => {
          try {
            // Lazy: pull the crypto chunk only when the user is
            // actually signing. The "Sign in your wallet…" phase in
            // the mission launcher covers the few-ms chunk download.
            const flow = await import("./flow");
            const r = await flow.signTxWithZkLogin({
              sui,
              session: zkSession,
              transaction,
            });
            cb?.onSuccess?.(r);
          } catch (e) {
            // Translate the most common low-level failure into something
            // the wizard's error toast can actually act on. "Groth16
            // proof verify failed" almost always means the session's
            // maxEpoch is in the past; sometimes a wallet was rotated
            // while a stale session sat in storage.
            const raw = e instanceof Error ? e.message : String(e);
            const friendly =
              /Groth16|proof.*verify|InvalidUserSignature|epoch/i.test(raw)
                ? "Your Google sign-in expired · sign in again and retry. (Sui zkLogin sessions are good for ~2 days.)"
                : raw;
            cb?.onError?.(new Error(friendly));
          }
        })();
        return;
      }
      if (wallet) {
        walletSignAndExecute(
          { transaction },
          {
            onSuccess: (res) => cb?.onSuccess?.({ digest: res.digest }),
            onError: (e) =>
              cb?.onError?.(e instanceof Error ? e : new Error(String(e))),
          },
        );
        return;
      }
      cb?.onError?.(new Error("No account connected."));
    },
    [sui, wallet, walletSignAndExecute, zkSession],
  );

  const source: AccountSource = zkSession
    ? "zklogin"
    : wallet
      ? "wallet"
      : "none";
  const address = zkSession?.address ?? wallet?.address ?? null;
  const label = zkSession
    ? zkSession.email ?? "Google account"
    : wallet
      ? "Wallet"
      : null;

  return { address, source, signAndExecute, label };
}
