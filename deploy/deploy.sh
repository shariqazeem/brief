#!/usr/bin/env bash
# Idempotent redeploy of Brief on the production VM.
#
# Run from the repo root after `git pull` or after editing the ecosystem
# config. Safe to re-run any time — every step is idempotent.
#
#   bash deploy/deploy.sh
#
# Expects:
#   - Repo is checked out (anywhere; deploy.sh resolves its own path).
#   - .env.local exists at the repo root with the production secrets.
#   - pm2 is on $PATH (npm i -g pm2).
#   - Caddy is installed (apt-get install caddy) — handle Caddyfile via
#     `caddy-reload` step below.
#   - $BRIEF_HOST is exported in the caller's environment (e.g.
#     export BRIEF_HOST=141-148-215-239.sslip.io). If not set, we'll
#     warn and skip the Caddy reload.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> brief :: redeploy from $REPO_ROOT"

# ---------------------------------------------------------------------------
# 1. Fail fast on missing prerequisites
# ---------------------------------------------------------------------------

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local not found at repo root. Create it from .env.local.example."
  exit 1
fi
if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 is not on PATH. Install with: npm install -g pm2"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Pull + install + build
# ---------------------------------------------------------------------------

echo "==> pulling latest main"
git fetch --quiet origin
git checkout --quiet main
git reset --quiet --hard origin/main

echo "==> npm ci (full deps incl. tsx — the spawn routes need it at runtime)"
npm ci --no-audit --no-fund

echo "==> next build"
npm run build

# ---------------------------------------------------------------------------
# 3. PM2 — start or reload all four processes
# ---------------------------------------------------------------------------

echo "==> pm2 startOrReload"
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

# ---------------------------------------------------------------------------
# 4. Caddy — render Caddyfile with $BRIEF_HOST and reload
# ---------------------------------------------------------------------------

if [[ -n "${BRIEF_HOST:-}" ]]; then
  if command -v caddy >/dev/null 2>&1 && [[ -d /etc/caddy ]]; then
    echo "==> rendering /etc/caddy/Caddyfile for host=$BRIEF_HOST"
    # The template uses Caddy's `{$BRIEF_HOST}` syntax — envsubst would
    # leave the curly braces around the substituted value, which Caddy
    # then can't parse as a hostname. Use sed with the exact literal
    # so the substitution removes the braces too.
    sed "s|{\$BRIEF_HOST}|${BRIEF_HOST}|g" "$REPO_ROOT/deploy/Caddyfile" \
      | sudo tee /etc/caddy/Caddyfile >/dev/null
    echo "==> caddy reload"
    sudo systemctl reload caddy || sudo systemctl restart caddy
  else
    echo "WARN: caddy not installed or /etc/caddy missing; skipping reverse-proxy step"
  fi
else
  echo "WARN: BRIEF_HOST not set; skipping Caddy render. Export it and re-run if you want HTTPS reloaded."
fi

# ---------------------------------------------------------------------------
# 5. Status report
# ---------------------------------------------------------------------------

echo "==> done. pm2 status:"
pm2 status
echo
echo "==> tail recent logs (last 20 lines per process):"
pm2 logs --lines 20 --nostream
