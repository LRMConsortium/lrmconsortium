#!/usr/bin/env bash
#
# Release one market.
#
#   deploy/release.sh unitedStates
#   deploy/release.sh gambia
#
# ── The shape, and why ──────────────────────────────────────────────────────
# Everything that can fail happens *before* the running process is touched, and
# the cutover is a symlink swap that can be undone in one command. The order is
# the whole design:
#
#   1. preflight   — configuration, secrets, and that the two markets share
#                    nothing. Reads only.
#   2. build       — TypeScript, and the public pages for *this* market.
#   3. verify      — the suites. A release that cannot pass them is not a
#                    release; finding out after the swap is finding out from a
#                    member.
#   4. migrate     — indexes. Before the new code runs, because this codebase
#                    uses unique indexes as concurrency control and the process
#                    refuses to serve traffic without them.
#   5. cut over    — symlink, then `pm2 reload`.
#   6. health      — poll /healthz. If it does not come up, **roll back
#                    automatically** and exit non-zero.
#
# Step 6 is the one people leave out. A deploy script that ends at "reload"
# reports success while the service is down.
#
# ── What this does not do ───────────────────────────────────────────────────
# It does not touch the other market. It does not run `seed`, which refuses in
# production anyway. It does not create the database or the `.env` — those are
# set up once by hand, and a release that could create them could also silently
# recreate one somebody had carefully configured.

set -euo pipefail

MARKET="${1:-}"
case "$MARKET" in
  unitedStates) SHORT=us ;;
  gambia)       SHORT=gm ;;
  *)
    echo "usage: $0 <unitedStates|gambia>" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASES="/srv/lrmc/$SHORT/releases"
CURRENT="/srv/lrmc/$SHORT/current"
HEALTH_TRIES=30
HEALTH_PAUSE=2

say() { printf '\n\033[1m── %s\033[0m\n' "$*"; }

# ── 1. Preflight ────────────────────────────────────────────────────────────
say "Preflight ($MARKET)"
cd "$ROOT/backend"
npm run preflight -- "$MARKET"

PORT="$(grep -E '^PORT=' ".env.$MARKET" | head -1 | cut -d= -f2 | tr -d '[:space:]')"
: "${PORT:?PORT is not set in backend/.env.$MARKET}"

# ── 2. Build ────────────────────────────────────────────────────────────────
say 'Build'
npm ci --omit=dev --no-audit --no-fund
npm ci --no-audit --no-fund          # dev deps for the build and the suites
npm run build

say "Public pages for $MARKET"
# Casper must be quoted in USD. The pages are static and built per market; a
# deployment that skips this serves the other market's currency and fee.
cd "$ROOT/frontend"
LRMC_MARKET="$MARKET" python3 build-public-pages.py

# ── 3. Verify ───────────────────────────────────────────────────────────────
say 'Verify'
cd "$ROOT/backend"
npm run verify
npm run blueprint >/dev/null
npm run openapi   >/dev/null
( cd "$ROOT/sdk" && npm run verify )

# ── 4. Stage the release ────────────────────────────────────────────────────
STAMP="$(date -u +%Y%m%d-%H%M%S)-$(git -C "$ROOT" rev-parse --short HEAD)"
TARGET="$RELEASES/$STAMP"
say "Staging $STAMP"
mkdir -p "$RELEASES"
rm -rf "$TARGET"
mkdir -p "$TARGET"
# The built artefacts and what serves them. Not the git history.
cp -R "$ROOT/backend/dist"          "$TARGET/dist"
cp -R "$ROOT/backend/node_modules"  "$TARGET/node_modules"
cp    "$ROOT/backend/package.json"  "$TARGET/package.json"
cp    "$ROOT/backend/.env.$MARKET"  "$TARGET/.env.$MARKET"
cp -R "$ROOT/frontend"              "$TARGET/frontend"
git -C "$ROOT" rev-parse HEAD > "$TARGET/COMMIT"
echo "$MARKET" > "$TARGET/MARKET"

# ── 5. Migrate ──────────────────────────────────────────────────────────────
# Before the new code runs. `syncIndexes` also drops indexes no longer declared,
# which is why this is a deliberate step and not a boot hook.
say 'Migrate (indexes)'
( cd "$TARGET" && env $(grep -v '^#' ".env.$MARKET" | xargs) node -e "
  require('./dist/scripts/migrate.js');
" ) || { echo 'Migration failed. Nothing has been cut over.' >&2; exit 1; }

# ── 6. Cut over ─────────────────────────────────────────────────────────────
PREVIOUS="$(readlink -f "$CURRENT" 2>/dev/null || true)"
say 'Cutting over'
ln -sfn "$TARGET" "$CURRENT"

if pm2 describe "lrmc-$SHORT" >/dev/null 2>&1; then
  pm2 reload "lrmc-$SHORT" --update-env
else
  pm2 start "$ROOT/deploy/ecosystem.config.cjs" --only "lrmc-$SHORT"
fi
pm2 save >/dev/null

# ── 7. Health ───────────────────────────────────────────────────────────────
say 'Health'
healthy=0
for i in $(seq 1 "$HEALTH_TRIES"); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    healthy=1
    echo "  up after ${i}s"
    break
  fi
  sleep "$HEALTH_PAUSE"
done

if [ "$healthy" -ne 1 ]; then
  echo >&2
  echo "  ✗ $SHORT did not answer /healthz. Rolling back." >&2
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    ln -sfn "$PREVIOUS" "$CURRENT"
    pm2 reload "lrmc-$SHORT" --update-env || pm2 restart "lrmc-$SHORT"
    echo "  rolled back to $(basename "$PREVIOUS")" >&2
  else
    echo '  no previous release to roll back to; the service is stopped.' >&2
  fi
  echo "  logs: pm2 logs lrmc-$SHORT --lines 100" >&2
  exit 1
fi

# ── 8. Tidy ─────────────────────────────────────────────────────────────────
# Five releases kept. Rollback needs the previous one; five is enough to step
# back through a bad afternoon and few enough not to fill the disk.
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf

say "Released $STAMP ($MARKET) — healthy on :$PORT"
