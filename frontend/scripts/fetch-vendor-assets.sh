#!/usr/bin/env bash
#
# Fetch and pin the third-party assets LRMC serves itself.
#
#   ./scripts/fetch-vendor-assets.sh          fetch, verify against the lockfile
#   ./scripts/fetch-vendor-assets.sh --write  fetch, then RECORD the hashes
#
# ── Why this exists ────────────────────────────────────────────────────────
# LRMC launches in The Gambia. A CDN request is the single most likely thing on
# a page to fail on intermittent mobile data, and when Alpine fails the chrome
# stops working — `assets/js/boot.js` has the measurement. Serving these from
# the same origin removes a DNS lookup, a TLS handshake and a point of failure
# per page load.
#
# ── Why the hashes matter more than the fetch ──────────────────────────────
# Anybody can download a file. The point of the lockfile is that the bytes on
# disk are the bytes somebody reviewed. Without it, "we self-host Alpine" means
# "we serve whatever is in that directory", and a directory is a thing that can
# be written to.
#
# Run WITHOUT `--write` in CI: it fetches and compares, and a mismatch is a
# failure. Run WITH `--write` once, deliberately, when upgrading a version —
# and read the diff before committing it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/assets/vendor"
LOCK="$ROOT/deploy/vendor.lock.json"
WRITE=0
[ "${1:-}" = "--write" ] && WRITE=1

command -v jq  >/dev/null || { echo "jq is required"; exit 1; }
command -v curl >/dev/null || { echo "curl is required"; exit 1; }

mkdir -p "$VENDOR"
cd "$VENDOR"

hash_of() { openssl dgst -sha384 -binary "$1" | openssl base64 -A; }

fail=0

# ── Downloaded assets ──────────────────────────────────────────────────────
jq -c '.assets[] | select(.url != "built")' "$LOCK" | while read -r asset; do
  file=$(echo "$asset"   | jq -r .file)
  url=$(echo "$asset"    | jq -r .url)
  want=$(echo "$asset"   | jq -r '.sha384 // empty')
  version=$(echo "$asset"| jq -r .version)

  echo "  $file  ($version)"
  curl -fsSL --retry 3 --max-time 120 "$url" -o "$file.tmp"

  # A captive portal or a proxy answering 200 with an error page is common on
  # the kind of network this platform is built for, and it would otherwise ship
  # an HTML document under a JavaScript filename.
  if head -c 400 "$file.tmp" | grep -qiE '<!doctype html|<html'; then
    echo "    REFUSED: that URL returned HTML, not a script." >&2
    rm -f "$file.tmp"; exit 1
  fi
  # An empty or near-empty file passes every naive check and breaks every page.
  if [ "$(wc -c < "$file.tmp")" -lt 1024 ]; then
    echo "    REFUSED: under 1KB. That is not a library." >&2
    rm -f "$file.tmp"; exit 1
  fi

  got=$(hash_of "$file.tmp")
  if [ -n "$want" ] && [ "$want" != "null" ]; then
    if [ "$got" != "$want" ]; then
      echo "    HASH MISMATCH" >&2
      echo "      expected sha384-$want" >&2
      echo "      got      sha384-$got" >&2
      echo "    The bytes upstream are not the bytes that were reviewed." >&2
      rm -f "$file.tmp"; exit 1
    fi
    echo "    hash ok"
  elif [ "$WRITE" -eq 0 ]; then
    echo "    NO HASH RECORDED — run with --write to pin this version." >&2
    fail=1
  fi

  mv "$file.tmp" "$file"

  if [ "$WRITE" -eq 1 ]; then
    bytes=$(wc -c < "$file" | tr -d ' ')
    tmp=$(mktemp)
    jq --arg f "$file" --arg h "$got" --argjson b "$bytes" \
      '(.assets[] | select(.file == $f)) |= (.sha384 = $h | .bytes = $b)' \
      "$LOCK" > "$tmp" && mv "$tmp" "$LOCK"
    echo "    pinned sha384-$got"
  fi
done

# ── Tailwind is compiled, not downloaded ───────────────────────────────────
# `bundle.production.sh` runs the CLI over the page templates and emits only
# the classes in use. Downloading a prebuilt stylesheet would be a different
# thing wearing the same name — the CDN build the pages use today ships a JIT
# compiler to every visitor and generates the CSS in the browser.
echo
echo "Tailwind is not fetched here. Run ./scripts/bundle.production.sh to compile it."

if [ "$fail" -ne 0 ]; then
  echo
  echo "Some assets have no recorded hash. They are on disk but not pinned."
  exit 1
fi

echo
echo "Done. \`npm run verify\` in backend/ now checks these against the lockfile."
