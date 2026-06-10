// React context for the zkLogin session. Lightweight — none of the
// `@mysten/sui/zklogin` crypto or the Ed25519 keypair primitive lives
// in this module's eager imports. The crypto-heavy work (signIn,
// completing the OAuth callback, signing a tx) is reached via
// `await import("./flow")`, so a visitor who doesn't engage Google
// never pays for those bytes.

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSuiClient } from "@mysten/dapp-kit";

import {
  clearUrlFragment,
  decodeGoogleJwt,
  GOOGLE_CLIENT_ID,
  readIdTokenFromFragment,
} from "./oauth";
import {
  clearPreSession,
  clearSession,
  isSessionExpired,
  loadPreSession,
  loadSession,
  saveSession,
  type ZkLoginSession,
} from "./session";

type ZkLoginPhase =
  | { kind: "idle" }
  | { kind: "starting" } // building OAuth URL — flow.ts is loading
  | { kind: "callback" } // returned from Google, completing the flow
  | { kind: "error"; msg: string };

type ZkLoginContextValue = {
  session: ZkLoginSession | null;
  phase: ZkLoginPhase;
  /** True when the env var is set so the UI knows to show the button. */
  available: boolean;
  /** True when the prover proxy is configured to produce proofs that
   *  verify on the active Sui network. When false, OAuth still works
   *  (visitors can see their derived address) but signing is hidden so
   *  no one hits a Groth16 verify error mid-flow. */
  signingEnabled: boolean;
  /** Begin the OAuth flow. Lazy-loads the crypto, then redirects to Google. */
  signIn: () => void;
  /** Wipe the session and clear sessionStorage. */
  signOut: () => void;
};

const Ctx = createContext<ZkLoginContextValue | null>(null);

export function useZkLogin(): ZkLoginContextValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useZkLogin must be used inside <ZkLoginProvider>");
  }
  return v;
}

export function ZkLoginProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const sui = useSuiClient();
  const [session, setSession] = useState<ZkLoginSession | null>(null);
  const [phase, setPhase] = useState<ZkLoginPhase>({ kind: "idle" });

  // Restore from sessionStorage on mount. Cheap — no crypto.
  // Then validate the session's maxEpoch against the live testnet epoch;
  // an expired session would produce a "Groth16 proof verify failed"
  // error the moment the user tries to sign, so we wipe it here and
  // nudge them back to "Continue with Google" with a clear message.
  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setSession(s);
    void (async () => {
      try {
        const { epoch } = await sui.getLatestSuiSystemState();
        if (isSessionExpired(s, Number(epoch))) {
          clearSession();
          setSession(null);
          setPhase({
            kind: "error",
            msg: "Your Google sign-in expired — please continue with Google again.",
          });
        }
      } catch {
        /* RPC blip — keep the session, signing will throw a clearer
         * error if the proof is actually invalid. */
      }
    })();
  }, [sui]);

  // Complete the OAuth round-trip if we arrived back with #id_token=...
  // The heavy work (jwtToAddress, getExtendedEphemeralPublicKey, prover,
  // genAddressSeed) is dynamic-imported only after we detect a real
  // callback. The "preparing your secure session…" panel covers the
  // ~50 ms it takes the chunk to download.
  useEffect(() => {
    const { jwt, error } = readIdTokenFromFragment();
    if (!jwt && !error) return;
    clearUrlFragment();
    if (error) {
      setPhase({ kind: "error", msg: `Google sign-in failed: ${error}` });
      return;
    }
    if (!jwt) return;
    setPhase({ kind: "callback" });
    void (async () => {
      const pre = loadPreSession();
      if (!pre) {
        setPhase({
          kind: "error",
          msg: "We came back from Google but the ephemeral session was gone — try again.",
        });
        return;
      }
      const claims = decodeGoogleJwt(jwt);
      if (!claims) {
        setPhase({ kind: "error", msg: "Couldn't read the Google ID token." });
        return;
      }
      if (claims.nonce && claims.nonce !== pre.nonce) {
        setPhase({
          kind: "error",
          msg: "Google returned a JWT whose nonce doesn't match the session — refusing it.",
        });
        return;
      }
      try {
        // Lazy: pull the crypto chunk only now that we have a real JWT
        // in hand and the user is committed to finishing sign-in.
        const flow = await import("./flow");
        const sess = await flow.completeOAuthCallback({ jwt, claims, pre });
        saveSession(sess);
        clearPreSession();
        setSession(sess);
        setPhase({ kind: "idle" });
      } catch (e) {
        setPhase({
          kind: "error",
          msg: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [sui]);

  const signIn = useCallback(() => {
    if (!GOOGLE_CLIENT_ID) {
      setPhase({
        kind: "error",
        msg: "Google sign-in isn't configured for this environment (missing NEXT_PUBLIC_GOOGLE_CLIENT_ID).",
      });
      return;
    }
    void (async () => {
      try {
        setPhase({ kind: "starting" });
        // Lazy: pull the crypto chunk only at the moment the user
        // clicked. Until they click, nothing zkLogin-heavy is in
        // memory or in the network waterfall.
        const flow = await import("./flow");
        const url = await flow.startSignIn(sui);
        window.location.assign(url);
      } catch (e) {
        setPhase({
          kind: "error",
          msg: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [sui]);

  const signOut = useCallback(() => {
    clearSession();
    clearPreSession();
    setSession(null);
    setPhase({ kind: "idle" });
  }, []);

  // Public testnet zkLogin proofs from prover-dev.mystenlabs.com don't
  // verify against the testnet on-chain Groth16 verifier — that prover
  // serves devnet only, and Mysten gates the testnet/mainnet prover
  // behind Enoki. Until we add Enoki, we keep the OAuth + address-
  // derivation work in the bundle (so the AccountChip and leaderboard
  // "You're #N" detection still work) but expose `signingAvailable` so
  // the wizard can hide the Adopt button when it would only error out.
  //
  // NEXT_PUBLIC_ZKLOGIN_SIGNING_ENABLED=true overrides this once an
  // Enoki API key is wired into /api/zklogin/prove.
  const signingEnabled =
    process.env.NEXT_PUBLIC_ZKLOGIN_SIGNING_ENABLED === "true";

  const value = useMemo<ZkLoginContextValue>(
    () => ({
      session,
      phase,
      available: !!GOOGLE_CLIENT_ID,
      signingEnabled,
      signIn,
      signOut,
    }),
    [session, phase, signIn, signOut, signingEnabled],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
