#!/usr/bin/env bash
# Fetch the third-party assets LRMC serves itself.
#
# Run once on a machine with network access, then commit what it writes.
#
# ── Why self-host at all ───────────────────────────────────────────────────
# LRMC launches in The Gambia. A CDN request is the single most likely thing on
# a page to fail on intermittent mobile data, and when Alpine fails the chrome
# stops working — see `assets/js/boot.js` for what that looked like when it was
# measured. Serving these from the same origin as the pages removes one DNS
# lookup, one TLS handshake and one point of failure per page load.
#
# The pages fall back to the CDN if the local copy is missing, and to `boot.js`
# if the CDN is unreachable too. This script closes the first gap; the other two
# are belt and braces.
set -euo pipefail
cd "$(dirname "$0")/../assets/vendor"

fetch() {
  local name="$1" url="$2"
  echo "  $name"
  curl -fsSL --retry 3 --max-time 60 "$url" -o "$name.tmp"
  # Refuse an error page saved under a JavaScript name. A proxy that answers
  # 200 with HTML is common on captive networks and would ship a broken asset.
  if head -c 200 "$name.tmp" | grep -qi '<!doctype html\|<html'; then
    rm -f "$name.tmp"
    echo "    refused: that URL returned HTML, not a script" >&2
    exit 1
  fi
  mv "$name.tmp" "$name"
}

echo "Vendoring LRMC's third-party assets…"
fetch alpine.min.js   "https://unpkg.com/alpinejs@3.14.1/dist/cdn.min.js"
fetch htmx.min.js     "https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js"
fetch lucide.min.js   "https://unpkg.com/lucide@latest/dist/umd/lucide.js"

echo
echo "Done. Tailwind is deliberately NOT vendored here: the pages use the CDN"
echo "JIT build, and self-hosting it properly means a real build step that"
echo "compiles only the classes in use. That is a separate piece of work and"
echo "pretending a copied script is the same thing would be worse than saying so."
