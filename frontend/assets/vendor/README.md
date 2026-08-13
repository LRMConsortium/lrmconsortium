# Vendored third-party assets

Populated by `deploy/vendor-assets.sh`, which needs network access.

**This directory is empty in the sandbox this was built in** — the CDN and the
npm registry are both unreachable from it, so the files could not be fetched and
are not being faked. The mechanism that uses them ships and is tested; the
artefacts need one command on a connected machine.

What happens with the directory empty, in order:

1. `<script src="/assets/vendor/alpine.min.js">` 404s.
2. Its `onerror` appends the unpkg copy.
3. If that fails too, `assets/js/boot.js` marks the document `lrmc-no-alpine`
   and takes over the chrome — see `assets/css/utilities.css`.

Step 3 is tested by `verify-member-portal.py`. Steps 1 and 2 are not, because
testing them needs a network the suite does not have.
