#!/usr/bin/env bash
#
# Go back to the release before this one — or to a named one.
#
#   deploy/rollback.sh unitedStates              # the previous release
#   deploy/rollback.sh unitedStates 20260813-...  # a specific one
#   deploy/rollback.sh unitedStates --list        # what is available
#
# ── What rollback can and cannot undo ───────────────────────────────────────
# It undoes **code**. The symlink moves, PM2 reloads, and the previous build
# serves traffic again — usually within a few seconds, because the release is
# still on disk with its dependencies.
#
# It does **not** undo the database. `npm run migrate` runs `syncIndexes`, which
# creates indexes the new code declared and drops ones it no longer does. Going
# back to code that expects a dropped index leaves that code running without it
# — and this platform uses unique indexes as concurrency control, so "without
# it" means a retried payment can record twice.
#
# In practice this only bites when a release changed an index. When one has, the
# honest procedure is: roll back the code with this script to stop the bleeding,
# then run the *older* release's migrate to restore its indexes:
#
#   deploy/rollback.sh unitedStates
#   cd /srv/lrmc/us/current && node dist/scripts/migrate.js
#
# Said plainly here because a rollback script that implies the database came
# with it is worse than no script at all.

set -euo pipefail

MARKET="${1:-}"
TARGET_NAME="${2:-}"
case "$MARKET" in
  unitedStates) SHORT=us ;;
  gambia)       SHORT=gm ;;
  *)
    echo "usage: $0 <unitedStates|gambia> [release|--list]" >&2
    exit 2
    ;;
esac

RELEASES="/srv/lrmc/$SHORT/releases"
CURRENT="/srv/lrmc/$SHORT/current"
NOW="$(readlink -f "$CURRENT" 2>/dev/null || true)"

mapfile -t AVAILABLE < <(ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's:/*$::')

if [ "${TARGET_NAME}" = '--list' ]; then
  echo
  echo "Releases for $MARKET (newest first):"
  for r in "${AVAILABLE[@]}"; do
    mark='  '
    [ "$(readlink -f "$r")" = "$NOW" ] && mark='->'
    printf '  %s %s  %s\n' "$mark" "$(basename "$r")" "$(cat "$r/COMMIT" 2>/dev/null | cut -c1-12)"
  done
  echo
  exit 0
fi

if [ "${#AVAILABLE[@]}" -lt 2 ] && [ -z "$TARGET_NAME" ]; then
  echo "Only one release on disk for $MARKET. Nothing to roll back to." >&2
  exit 1
fi

if [ -n "$TARGET_NAME" ]; then
  TARGET="$RELEASES/$TARGET_NAME"
else
  # The newest release that is not the one currently linked.
  TARGET=''
  for r in "${AVAILABLE[@]}"; do
    if [ "$(readlink -f "$r")" != "$NOW" ]; then TARGET="$r"; break; fi
  done
fi

[ -d "$TARGET" ] || { echo "No such release: $TARGET" >&2; exit 1; }

# A release built for the other market must never be linked here. The directory
# says which one it is, and this is the last place to notice before Casper is
# quoted in dalasi.
BUILT_FOR="$(cat "$TARGET/MARKET" 2>/dev/null || echo unknown)"
if [ "$BUILT_FOR" != "$MARKET" ]; then
  echo "Refusing: $(basename "$TARGET") was built for '$BUILT_FOR', not '$MARKET'." >&2
  exit 1
fi

PORT="$(grep -E '^PORT=' "$TARGET/.env.$MARKET" | head -1 | cut -d= -f2 | tr -d '[:space:]')"
: "${PORT:?PORT missing from the release's .env.$MARKET}"

echo
echo "Rolling $MARKET back"
echo "  from: $(basename "${NOW:-none}")"
echo "  to:   $(basename "$TARGET")  $(cat "$TARGET/COMMIT" 2>/dev/null | cut -c1-12)"

ln -sfn "$TARGET" "$CURRENT"
pm2 reload "lrmc-$SHORT" --update-env || pm2 restart "lrmc-$SHORT"
pm2 save >/dev/null

for i in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "  healthy on :$PORT after ${i}s"
    echo
    echo "  If the release you rolled back from changed an index, restore this"
    echo "  one's with:  cd $CURRENT && node dist/scripts/migrate.js"
    echo
    exit 0
  fi
  sleep 2
done

echo "  ✗ still not answering /healthz after rollback." >&2
echo "    pm2 logs lrmc-$SHORT --lines 100" >&2
exit 1
