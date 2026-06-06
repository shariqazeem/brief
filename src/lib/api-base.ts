// Tiny shim so the UI can target the VM's API when deployed somewhere
// else (Vercel). On the VM the API routes live at the same origin, so
// the default (empty NEXT_PUBLIC_API_BASE_URL) yields relative URLs.
//
// On Vercel, set NEXT_PUBLIC_API_BASE_URL to the public VM URL and the
// UI will POST cross-origin to it. The VM's Caddy reverse proxy adds
// permissive CORS headers (see deploy/Caddyfile) so the browser
// preflight succeeds.

// .trim() guards against trailing whitespace on the platform env value;
// without it a "https://host\n" base URL produces unfetchable URLs.
export const API_BASE: string = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "")
  .trim()
  .replace(/\/$/, "");

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) path = "/" + path;
  return API_BASE + path;
}
