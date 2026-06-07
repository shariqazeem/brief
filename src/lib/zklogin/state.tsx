// React context for the zkLogin session. Wraps the page so any
// component can ask "is there a signed-in zkLogin user?" without
// repeatedly poking sessionStorage.
//
// The provider also handles the OAuth callback: on mount it scans the
// URL fragment for an id_token and, if found, completes the salt +
// prove + address-derivation pipeline and stores the resulting session.

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { useSuiClient } from "@mysten/dapp-kit";
import {
  generateNonce,
  generateRandomness,
  getExtendedEphemeralPublicKey,
  jwtToAddress,
} from "@mysten/sui/zklogin";

import { apiUrl } from "@/lib/api-base";
import {
  buildGoogleAuthUrl,
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
  savePreSession,
  saveSession,
  type ZkLoginPreSession,
  type ZkLoginProof,
  type ZkLoginSession,
} from "./session";

// Epoch headroom for ephemeral keys. The Sui docs recommend a small
// window — too short and a slow sign-in expires the session, too long
// and a stolen key has more time on chain.
const MAX_EPOCH_HORIZON = 2;

type ZkLoginPhase =
  | { kind: "idle" }
  | { kind: "starting" } // building OAuth URL
  | { kind: "callback" } // returned from Google, completing the flow
  | { kind: "error"; msg: string };

type ZkLoginContextValue = {
  session: ZkLoginSession | null;
  phase: ZkLoginPhase;
  /** True when the env var is set so the UI knows to show the button. */
  available: boolean;
  /** Begin the OAuth flow. Kicks the browser to Google. */
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

  // Restore from sessionStorage on mount.
  useEffect(() => {
    const s = loadSession();
    if (s) setSession(s);
  }, []);

  // Complete the OAuth round-trip if we arrived back with #id_token=...
  useEffect(() => {
    const { jwt, error } = readIdTokenFromFragment();
    if (!jwt && !error) return;
    void completeCallback({ jwt, error, sui, setPhase, setSession });
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
        // Per docs: ephemeral keypair + maxEpoch (current epoch + N) +
        // randomness → nonce. The nonce travels with the OAuth request
        // and comes back inside the JWT so the prover can bind the
        // ephemeral key to *this specific* sign-in.
        const ephemeral = new Ed25519Keypair();
        const { epoch } = await sui.getLatestSuiSystemState();
        const maxEpoch = Number(epoch) + MAX_EPOCH_HORIZON;
        const randomness = generateRandomness();
        const nonce = generateNonce(
          ephemeral.getPublicKey(),
          maxEpoch,
          randomness,
        );
        const pre: ZkLoginPreSession = {
          ephemeralSecret: ephemeral.getSecretKey(),
          randomness,
          maxEpoch,
          nonce,
        };
        savePreSession(pre);
        const redirectUri = window.location.origin + "/workforce";
        const url = buildGoogleAuthUrl({
          clientId: GOOGLE_CLIENT_ID,
          redirectUri,
          nonce,
        });
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

// Helper: complete the JWT → salt → prove → address pipeline. Lifted
// out of the component for clarity and so the error paths all set the
// same phase.
async function completeCallback({
  jwt,
  error,
  sui,
  setPhase,
  setSession,
}: {
  jwt: string | null;
  error: string | null;
  sui: ReturnType<typeof useSuiClient>;
  setPhase: (p: ZkLoginPhase) => void;
  setSession: (s: ZkLoginSession | null) => void;
}): Promise<void> {
  // Always clear the fragment so a refresh doesn't re-run the callback.
  clearUrlFragment();
  if (error) {
    setPhase({ kind: "error", msg: `Google sign-in failed: ${error}` });
    return;
  }
  if (!jwt) return;
  setPhase({ kind: "callback" });

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

  // 1) Salt — deterministic per user.
  let salt: string;
  try {
    const r = await fetch(apiUrl("/api/zklogin/salt"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jwt }),
    });
    const j = (await r.json()) as { ok?: boolean; salt?: string; error?: string };
    if (!j.ok || !j.salt) {
      setPhase({
        kind: "error",
        msg: `Salt lookup failed: ${j.error ?? "unknown"}`,
      });
      return;
    }
    salt = j.salt;
  } catch (e) {
    setPhase({
      kind: "error",
      msg: `Salt lookup failed: ${(e as Error).message}`,
    });
    return;
  }

  // 2) Address — derived from JWT + salt.
  let address: string;
  try {
    address = jwtToAddress(jwt, salt, false);
  } catch (e) {
    setPhase({
      kind: "error",
      msg: `Address derivation failed: ${(e as Error).message}`,
    });
    return;
  }

  // 3) Proof — call the Mysten testnet prover via our proxy.
  let proof: ZkLoginProof;
  try {
    const ephemeral = Ed25519Keypair.fromSecretKey(pre.ephemeralSecret);
    const extendedEpk = getExtendedEphemeralPublicKey(
      ephemeral.getPublicKey(),
    );
    const r = await fetch(apiUrl("/api/zklogin/prove"), {
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
    const j = (await r.json()) as { ok?: boolean; proof?: ZkLoginProof; error?: string };
    if (!j.ok || !j.proof) {
      setPhase({
        kind: "error",
        msg: `Prover failed: ${j.error ?? "unknown"}`,
      });
      return;
    }
    proof = j.proof;
  } catch (e) {
    setPhase({
      kind: "error",
      msg: `Prover failed: ${(e as Error).message}`,
    });
    return;
  }

  // 4) Persist the full session — clear the pre-session so a future
  //    refresh doesn't try to re-complete the callback.
  const sess: ZkLoginSession = {
    jwt,
    salt,
    proof,
    ephemeralSecret: pre.ephemeralSecret,
    maxEpoch: pre.maxEpoch,
    address,
    email: claims.email,
    aud: claims.aud,
  };
  saveSession(sess);
  clearPreSession();
  setSession(sess);
  setPhase({ kind: "idle" });
  void sui; // marked used
}
