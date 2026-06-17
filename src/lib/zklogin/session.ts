// zkLogin session · the long-lived state we need to sign a transaction
// as a zkLogin user. Persisted to sessionStorage so a refresh during
// the grant→watch→revoke arc doesn't drop the user back to the sign-in
// screen, but cleared whenever maxEpoch passes.
//
// We split persistence in two:
//   1. PRE-OAUTH session: the ephemeral key + randomness + maxEpoch we
//      generate BEFORE redirecting to Google. Persisted under
//      "brief:zkLogin:pre" so the redirect callback can recover them
//      after the OAuth round-trip.
//   2. POST-OAUTH session: the JWT + salt + zkProof + ephemeral key +
//      maxEpoch + derived address. Persisted under "brief:zkLogin"
//      and used by the signing path.

// Pure types + sessionStorage helpers. No `@mysten/sui/zklogin` imports
// live here so this module stays in the eager bundle without dragging
// the prover/Poseidon/BCS code along.

"use client";

const PRE_KEY = "brief:zkLogin:pre";
const POST_KEY = "brief:zkLogin";

export type ZkLoginPreSession = {
  /** Ed25519 ephemeral key, base64-encoded secret. */
  ephemeralSecret: string;
  /** Random salt used in the nonce. */
  randomness: string;
  maxEpoch: number;
  /** Nonce we sent to Google · used to validate the returning JWT. */
  nonce: string;
};

export type ZkLoginProof = {
  proofPoints: {
    a: string[];
    b: string[][];
    c: string[];
  };
  issBase64Details: {
    value: string;
    indexMod4: number;
  };
  headerBase64: string;
  addressSeed: string;
};

export type ZkLoginSession = {
  jwt: string;
  salt: string;
  proof: ZkLoginProof;
  ephemeralSecret: string;
  maxEpoch: number;
  address: string;
  /** Display name from the JWT, if available · e.g. the user's Google email. */
  email?: string;
  /** The aud (Google client id) the JWT was issued for. */
  aud?: string;
};

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadPreSession(): ZkLoginPreSession | null {
  const s = safeStorage();
  if (!s) return null;
  const raw = s.getItem(PRE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ZkLoginPreSession;
  } catch {
    return null;
  }
}

export function savePreSession(v: ZkLoginPreSession): void {
  safeStorage()?.setItem(PRE_KEY, JSON.stringify(v));
}

export function clearPreSession(): void {
  safeStorage()?.removeItem(PRE_KEY);
}

export function loadSession(): ZkLoginSession | null {
  const s = safeStorage();
  if (!s) return null;
  const raw = s.getItem(POST_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as ZkLoginSession;
    // Sanity-check the shape · an older build stored proofs without
    // the addressSeed field, which BCS-fails at signing time. Drop
    // those so the user gets a clean re-auth on refresh.
    if (
      !v?.proof?.addressSeed ||
      !v.proof.proofPoints ||
      !v.proof.issBase64Details ||
      !v.proof.headerBase64
    ) {
      s.removeItem(POST_KEY);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export function saveSession(v: ZkLoginSession): void {
  safeStorage()?.setItem(POST_KEY, JSON.stringify(v));
}

export function clearSession(): void {
  safeStorage()?.removeItem(POST_KEY);
}

/** Returns true if the session is past its maxEpoch and should be wiped. */
export function isSessionExpired(
  session: ZkLoginSession,
  currentEpoch: number,
): boolean {
  return currentEpoch > session.maxEpoch;
}
