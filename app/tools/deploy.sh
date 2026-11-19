#!/bin/sh
# Release the app: export the data, build, run every check, migrate the database, deploy.
# Stops at the first failure, so a build that fails a check is never deployed.
#
#   app/tools/deploy.sh production   deploy to the live site (the route in wrangler.jsonc)
#   (staging is accepted and does the same: there is no separate staging address any more)
#
# Needs: the Python environment (.venv) for the export, app/node_modules, a logged-in wrangler,
# and the generated media in app/public/media (frenchirix export-app, scripts/tts_questions.py).
set -eu

target="${1:-}"
case "$target" in
  staging|production) ;;
  *) echo "usage: $0 staging|production" >&2; exit 2 ;;
esac

app="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$app/.." && pwd)"

echo "== export the content bundle and verify it (media included)"
cd "$repo"
.venv/bin/frenchirix export-app --data-only
.venv/bin/frenchirix export-app --verify

echo "== build (before the checks: worker/health.test.ts reads dist/)"
cd "$app"
npm run build

echo "== checks: types, unit tests, every practice composed and played, no stuck puzzle"
npm run check
npm run check:liveness

echo "== production must not run in test mode"
if ! grep -q '"TEST_MODE": ""' wrangler.jsonc; then
  echo "wrangler.jsonc sets TEST_MODE; refusing to deploy" >&2
  exit 1
fi
echo "== production must not run as local development (no passwords)"
if grep -q '"LOCAL_DEV"' wrangler.jsonc; then
  echo "wrangler.jsonc sets LOCAL_DEV; refusing to deploy (it goes on the command line only, never in a config)" >&2
  exit 1
fi

echo "== database migrations"
npx wrangler d1 migrations apply DB --remote

# There is one deployment: wrangler.jsonc names the site's domain as its route, so both targets
# deploy to the live site.
echo "== deploy ($target: the live site, the route in wrangler.jsonc)"
npx wrangler deploy

echo "== done. Secrets (once each): npx wrangler secret put SESSION_SECRET, GATE_PASSWORD, ADMIN_PASSWORD"
