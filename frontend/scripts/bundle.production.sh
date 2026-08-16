#!/usr/bin/env bash
#
# Build the frontend for the C4 servers.
#
#   ./scripts/bundle.production.sh
#
# Writes to `dist/`, leaving the source tree untouched. Emits
# `dist/asset-manifest.json`, which `assetManifest.ts` asserts against.
#
# ── The one change that matters most ───────────────────────────────────────
# Every page currently loads `cdn.tailwindcss.com`. That ships a JIT compiler —
# around 400KB of JavaScript — to every visitor, which then generates a few
# kilobytes of CSS in the browser. On the connections LRMC serves that is the
# single largest saving available anywhere in this codebase, and it is also why
# no page has ever been validated against real Tailwind: the sandbox this was
# built in could not reach the CDN, so the suites run against a hand-written
# subset.
#
# This script closes both. It runs the real CLI over the page templates and
# emits only the classes actually used, and it does it on a machine with a
# network so the output is the real thing.
#
# ── Hashed filenames ───────────────────────────────────────────────────────
# Every asset gets its content hash in its name, so nginx can cache it forever
# and a deploy still reaches somebody on a slow connection who last loaded the
# site a month ago. Without hashing, the cache headers have to be short, and a
# short cache on a slow connection means paying for the same bytes weekly.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
VENDOR="$ROOT/assets/vendor"

need() { command -v "$1" >/dev/null || { echo "$1 is required"; exit 1; }; }
need node; need npx; need jq; need openssl

# ── Refuse to build without the vendored assets ────────────────────────────
# A build with pending assets serves pages that reach for a CDN LRMC has
# decided not to depend on, which undoes the whole exercise silently. Better to
# stop here than to ship it.
missing=$(jq -r '[.assets[] | select(.url != "built") | select(.sha384 == null)] | length' \
  "$ROOT/deploy/vendor.lock.json")
if [ "$missing" -ne 0 ]; then
  echo "REFUSING: $missing vendored assets have no recorded hash." >&2
  echo "Run ./scripts/fetch-vendor-assets.sh --write first." >&2
  exit 1
fi

rm -rf "$DIST"; mkdir -p "$DIST/assets/css" "$DIST/assets/js" "$DIST/assets/vendor"

hash8() { openssl dgst -sha384 -binary "$1" | openssl base64 -A | tr -d '/+=' | cut -c1-8; }
sri()   { echo "sha384-$(openssl dgst -sha384 -binary "$1" | openssl base64 -A)"; }

MANIFEST="$DIST/asset-manifest.json"
echo '{ "generatedFrom": "scripts/bundle.production.sh", "assets": {} }' > "$MANIFEST"

record() {  # logical-name  built-path
  local logical="$1" built="$2"
  local rel="${built#$DIST/}"
  local tmp; tmp=$(mktemp)
  jq --arg k "$logical" --arg p "/$rel" --arg i "$(sri "$built")" \
     --argjson b "$(wc -c < "$built" | tr -d ' ')" \
     '.assets[$k] = { path: $p, integrity: $i, bytes: $b }' "$MANIFEST" > "$tmp"
  mv "$tmp" "$MANIFEST"
  echo "  $logical -> /$rel"
}

# ── Tailwind, compiled ─────────────────────────────────────────────────────
# `--content` over the pages AND the JS: half this platform's classes are in
# string literals in `portal.js` and `properties.js`, and a build that scanned
# only the HTML would drop every one of them — producing a stylesheet that looks
# right on a static page and falls apart the moment a card is rendered.
echo "Compiling Tailwind…"
npx --yes tailwindcss@3.4.13 \
  --input "$ROOT/assets/css/tailwind.src.css" \
  --content "$ROOT/**/*.html" \
  --content "$ROOT/assets/js/*.js" \
  --minify \
  --output "$DIST/assets/css/tailwind.tmp.css"
tw_hash=$(hash8 "$DIST/assets/css/tailwind.tmp.css")
mv "$DIST/assets/css/tailwind.tmp.css" "$DIST/assets/css/tailwind.$tw_hash.css"
record "tailwind.css" "$DIST/assets/css/tailwind.$tw_hash.css"

# ── LRMC's own stylesheets ─────────────────────────────────────────────────
for css in theme utilities; do
  cp "$ROOT/assets/css/$css.css" "$DIST/assets/css/$css.tmp.css"
  h=$(hash8 "$DIST/assets/css/$css.tmp.css")
  mv "$DIST/assets/css/$css.tmp.css" "$DIST/assets/css/$css.$h.css"
  record "$css.css" "$DIST/assets/css/$css.$h.css"
done

# ── LRMC's own scripts ─────────────────────────────────────────────────────
# boot.js is deliberately NOT minified. It is the file that has to work on the
# connection where everything else did not, and the few hundred bytes minifying
# would save are not worth making the one file somebody debugs in the field
# unreadable.
echo "Minifying scripts…"
for js in sdk auth ui properties portal error-capture; do
  npx --yes esbuild@0.23.1 "$ROOT/assets/js/$js.js" \
    --minify --target=es2015 --outfile="$DIST/assets/js/$js.tmp.js" >/dev/null
  h=$(hash8 "$DIST/assets/js/$js.tmp.js")
  mv "$DIST/assets/js/$js.tmp.js" "$DIST/assets/js/$js.$h.js"
  record "$js.js" "$DIST/assets/js/$js.$h.js"
done
cp "$ROOT/assets/js/boot.js" "$DIST/assets/js/boot.tmp.js"
h=$(hash8 "$DIST/assets/js/boot.tmp.js")
mv "$DIST/assets/js/boot.tmp.js" "$DIST/assets/js/boot.$h.js"
record "boot.js" "$DIST/assets/js/boot.$h.js"

# ── Vendored third-party ───────────────────────────────────────────────────
for v in "$VENDOR"/*.js; do
  [ -e "$v" ] || continue
  name=$(basename "$v" .js)
  cp "$v" "$DIST/assets/vendor/$name.tmp.js"
  h=$(hash8 "$DIST/assets/vendor/$name.tmp.js")
  mv "$DIST/assets/vendor/$name.tmp.js" "$DIST/assets/vendor/$name.$h.js"
  record "$name.js" "$DIST/assets/vendor/$name.$h.js"
done

# ── Pages ──────────────────────────────────────────────────────────────────
# Rewritten to point at the hashed names, and the Tailwind CDN script replaced
# with the compiled stylesheet. Done with node rather than sed because a regex
# over HTML is how a `<script>` inside a comment gets rewritten.
echo "Rewriting pages…"
node - "$ROOT" "$DIST" "$MANIFEST" <<'NODE'
const fs = require('fs'), path = require('path');
const [root, dist, manifestPath] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).assets;

const SKIP = new Set(['node_modules', 'test-doubles', '__pycache__', 'dist', 'scripts', 'deploy']);
const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.html')) pages.push(full);
  }
})(root);

let rewritten = 0;
for (const page of pages) {
  let html = fs.readFileSync(page, 'utf8');

  // The CDN JIT compiler, replaced by the compiled stylesheet. This is the
  // 400KB.
  html = html.replace(
    /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/,
    `<link rel="stylesheet" href="${manifest['tailwind.css'].path}" />`);
  // The inline `tailwind.config` block is meaningless without the JIT compiler
  // and would sit in every page as dead weight.
  html = html.replace(/<script>\s*tailwind\.config[\s\S]*?<\/script>/, '');

  for (const [logical, asset] of Object.entries(manifest)) {
    const from = logical.endsWith('.css') ? `/assets/css/${logical}` : `/assets/js/${logical}`;
    html = html.split(from).join(asset.path);
    // Vendored files live under their own directory.
    html = html.split(`/assets/vendor/${logical}`).join(asset.path);
  }

  const out = path.join(dist, path.relative(root, page));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  rewritten += 1;
}
console.log(`  ${rewritten} pages`);
NODE

# ── Static extras ──────────────────────────────────────────────────────────
[ -d "$ROOT/assets/img" ] && cp -r "$ROOT/assets/img" "$DIST/assets/img"

# ── Pre-compress ───────────────────────────────────────────────────────────
# nginx serves these directly with `gzip_static` / `brotli_static`, so the
# compression happens once at build time rather than per request. Brotli is
# meaningfully smaller than gzip on text and is worth the extra file.
echo "Pre-compressing…"
find "$DIST" -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.json' \) \
  -print0 | while IFS= read -r -d '' f; do
    gzip -9 -k -f "$f"
    command -v brotli >/dev/null && brotli -q 11 -f -k "$f" || true
  done

echo
echo "Built into dist/. Verify with:  cd ../backend && npm run verify"
