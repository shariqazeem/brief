// Google OAuth · implicit id_token flow. The JWT comes back to the
// redirect URI as a URL fragment (#id_token=…) so we never need a
// server-side code exchange. Per the zkLogin docs the JWT must include
// the nonce we computed from (ephemeralPublicKey, maxEpoch, randomness).
//
// This module is intentionally crypto-free: it only builds the OAuth
// URL, reads the URL fragment, and base64url-decodes the JWT *payload*
// (no signature verification · that happens on chain via zkLogin). We
// avoid importing from `@mysten/sui/zklogin` here so the eager bundle
// stays small.

"use client";

/** Public Google OAuth client id · must be set or the button stays hidden. */
export const GOOGLE_CLIENT_ID = (
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ""
).trim();

export const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Build the Google OAuth implicit-flow URL.
 *
 * `redirectUri` must EXACTLY match one of the "Authorized redirect URIs"
 * registered against the OAuth client in the Google console. We use the
 * page itself (.../workforce) so the callback handler can pick up the
 * id_token from the URL fragment without an intermediate route.
 */
export function buildGoogleAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  nonce: string;
  /** Optional: where to come back to after the round-trip, encoded into
   *  the `state` param so the callback handler can pick it up. */
  state?: string;
}): string {
  const u = new URL(GOOGLE_OAUTH_BASE);
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("response_type", "id_token");
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("scope", "openid email");
  u.searchParams.set("nonce", args.nonce);
  if (args.state) u.searchParams.set("state", args.state);
  // Force the Google account chooser · beginners may be signed into
  // multiple Google accounts and we want them to pick deliberately.
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

/**
 * Extract an `id_token` from the current URL fragment, if present. Used
 * by the callback page to detect "we just came back from Google."
 */
export function readIdTokenFromFragment(): {
  jwt: string | null;
  state: string | null;
  error: string | null;
} {
  if (typeof window === "undefined") {
    return { jwt: null, state: null, error: null };
  }
  const hash = window.location.hash || "";
  if (!hash.startsWith("#")) return { jwt: null, state: null, error: null };
  const params = new URLSearchParams(hash.slice(1));
  const jwt = params.get("id_token");
  const state = params.get("state");
  const error = params.get("error");
  return { jwt, state, error };
}

/** Wipe the URL fragment after we've consumed the id_token. */
export function clearUrlFragment(): void {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  u.hash = "";
  window.history.replaceState({}, "", u.toString());
}

/** Minimal JWT claims we read from the id_token. */
export type GoogleJwtClaims = {
  sub: string;
  aud: string;
  iss: string;
  email?: string;
  nonce?: string;
  exp?: number;
};

export function decodeGoogleJwt(jwt: string): GoogleJwtClaims | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    // base64url → base64
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    // base64 → UTF-8 string. `atob` gives bytes-as-latin1; we widen via
    // TextDecoder so non-ASCII fields (names with accents, etc.) survive.
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const json = new TextDecoder("utf-8").decode(bytes);
    const p = JSON.parse(json) as Partial<GoogleJwtClaims> & {
      aud?: string | string[];
    };
    if (typeof p.sub !== "string" || typeof p.iss !== "string") return null;
    const aud = Array.isArray(p.aud) ? p.aud[0] : p.aud;
    if (typeof aud !== "string") return null;
    return {
      sub: p.sub,
      aud,
      iss: p.iss,
      email: p.email,
      nonce: p.nonce,
      exp: p.exp,
    };
  } catch {
    return null;
  }
}
