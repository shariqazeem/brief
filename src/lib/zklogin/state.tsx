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
  useEffect(() => {
    const s = loadSession();
    if (s) setSession(s);
  }, []);

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

  const value = useMemo<ZkLoginContextValue>(
    () => ({
      session,
      phase,
      available: !!GOOGLE_CLIENT_ID,
      signIn,
      signOut,
    }),
    [session, phase, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
