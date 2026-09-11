# LRMC + Ususu — Publishing & Integration Guide

Operational documentation for `@lrmc/sdk`, the unified TypeScript client for the
LRMC + Ususu API.

**What this covers**

1. [NPM Publishing Instructions](#1--npm-publishing-instructions)
2. [Frontend Integration Blueprint](#2--frontend-integration-blueprint)
3. [Mobile App Integration Plan](#3--mobile-app-integration-plan)

**What it assumes exists** — all verified in this repository:

| | |
|---|---|
| API | 251 operations, 175 paths, 28 modules |
| Spec | OpenAPI 3.1, 159 schemas, 0 dangling `$refs` |
| SDK | `@lrmc/sdk`, 30 modules, 1,736 runtime checks, 0 type errors |
| Convention | plural collections (`/landlords`), singular items (`/landlord/{landlordId}`) |
| Envelope | `{ success, data, meta? }` / `{ success: false, error }` |
| Gates | zone → permission → ownership, published as `x-zone` / `x-permissions` / `x-ownership` |

**The domain hierarchy** — one API behind four faces:

| Domain | Face | Primary consumer |
|---|---|---|
| `api.lrmconsortium.africa` | HQ — Institutional Command Center | Founder console, HQ dashboard, Back Office |
| `api.lrmconsortium.com` | Public Portal | Public site, member portal |
| `api.africalrmc.com` | PR & Communications | PR site |
| `api.africaususu.com` | Ususu Rideshare | Driver app, rider app, dispatch |
| `localhost:3000` | Local development | — |

---

# 1 · NPM Publishing Instructions

## 1.1 Registry choice

`@lrmc` is a scoped package. Three options, in order of what I would pick:

**GitHub Packages** (recommended to start). Access follows repository
permissions, so there is no second access-control system to keep in step with
staffing. Add to the package root:

```ini
# .npmrc  (committed)
@lrmc:registry=https://npm.pkg.github.com
```

**npm private** ($7/user/month). Simplest tooling, works everywhere, but you are
managing a second membership list.

**npm public.** Only if the SDK is genuinely open. Note that publishing it
publishes your API's shape — every route, role and zone name. That is not a
vulnerability, but decide it deliberately rather than by default.

> A scoped package is **private by default on npm**. Publishing publicly requires
> `--access public`. Do not add that flag reflexively.

## 1.2 `package.json` — the fields that matter

The shipped manifest is already correct. What each field is doing:

```jsonc
{
  "name": "@lrmc/sdk",
  "version": "1.0.0",
  "type": "module",              // ESM-first
  "sideEffects": false,          // lets bundlers tree-shake unused modules
  "engines": { "node": ">=18.0.0" },  // fetch is global from 18

  "main": "./dist/index.cjs",    // legacy CJS resolution
  "module": "./dist/index.js",   // legacy bundler hint
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",   // must come FIRST
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./package.json": "./package.json"
  },

  "files": ["dist", "README.md"],     // src/ and scripts/ never ship

  "peerDependencies": { "axios": ">=1.6.0" },
  "peerDependenciesMeta": { "axios": { "optional": true } }
}
```

Four of these are load-bearing:

- **`exports` ordering.** `types` must be the first key. Node and TypeScript
  match conditions top-down; put `import` first and TypeScript resolves the `.js`
  and reports the package as untyped.
- **`sideEffects: false`.** Without it, a bundler keeps all 22 modules in a
  browser build even if you only import `api.public`.
- **`files`.** An allow-list, not an ignore-list. `src/` and `scripts/` stay out
  of the tarball, so consumers download the build, not the generator.
- **`peerDependenciesMeta.axios.optional`.** This is what lets a browser project
  install the SDK without pulling axios. Drop `optional` and every web app
  installs an HTTP library it will never execute.

Add `repository`, `homepage` and `bugs` before the first publish. npm renders
them, and `npm repo @lrmc/sdk` stops working without them.

## 1.3 Versioning strategy

Semver, with the SDK version **tracking the API contract**, not the SDK's own
internals:

| Change | Bump | Example |
|---|---|---|
| New endpoint, new optional field | **minor** | A `leases` module lands |
| Bug fix, docs, internal refactor | **patch** | Retry backoff corrected |
| Removed/renamed operation or field | **major** | `/landlords/:id` → `/landlord/:landlordId` |
| Required field added to a request | **major** | It breaks existing callers |
| Field becomes optional in a response | **major** | Consumers destructure it today |
| Runtime/engine floor raised | **major** | Node 18 → 20 |

Two rules that prevent most versioning arguments:

1. **The generator decides, not the author.** If `npm run generate` produces a
   diff in `src/types/` or `src/modules/`, the API changed and the version must
   move. `git diff --exit-code src/types src/modules` in CI enforces it.
2. **A type-level break is a break.** Narrowing a union, adding a required
   property, or renaming an exported type breaks compilation for consumers even
   though no runtime behaviour changed. Major.

Pre-1.0 does *not* apply here — the API is in production behind four domains.
Start at `1.0.0` and mean it.

**Prereleases** for anything you want to try in an app before committing:

```bash
npm version prerelease --preid=rc     # 1.2.0 → 1.2.1-rc.0
npm publish --tag next                # NOT latest
```

Consumers opt in with `npm install @lrmc/sdk@next`. `npm install @lrmc/sdk`
still gets the stable release — which is the entire point of the `next` tag.

## 1.4 Build pipeline

`tsup` is already configured. It wraps esbuild for the JS and the TypeScript
compiler for declarations — you get both in one step.

```ts
// tsup.config.ts
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  platform: 'neutral',      // no Node built-ins assumed
  external: ['axios'],      // never inline it
});
```

Two settings carry weight:

- **`platform: 'neutral'`** stops esbuild assuming Node globals, so the same
  build runs in a browser, a worker and React Native.
- **`external: ['axios']`** keeps the dynamic `import('axios')` dynamic. Bundle
  it and every browser consumer ships an HTTP client they never call.

Build:

```bash
npm run build     # generate → tsup → dist/
```

Output: `dist/index.js` (ESM), `dist/index.cjs` (CJS), `dist/index.d.ts`, plus
source maps.

**esbuild instead of tsup?** Only if you want the control. You then run
`tsc --emitDeclarationOnly` yourself for the `.d.ts`, because esbuild does not
do types. Not worth it here.

## 1.5 Type declarations

`dts: true` emits `dist/index.d.ts` covering all 77 schemas, both `Input`
variants and the full client surface. Two things worth checking after the first
build:

```bash
npx @arethetypeswrong/cli --pack .   # catches ESM/CJS resolution mistakes
npx publint                          # catches manifest mistakes
```

`arethetypeswrong` is the one that finds the `exports` ordering bug described
above. Run it once before the first publish, then keep it in CI — it costs
seconds and catches a class of error that is invisible until a consumer files a
bug.

## 1.6 Prepublish checks

`prepublishOnly` runs on `npm publish` and **blocks the publish on failure**.
Recommended:

```jsonc
"scripts": {
  "prepublishOnly": "npm run test && npm run build && npm run check:dist"
}
```

The gate should refuse to publish when:

- [ ] `npm run generate` produces no diff — the committed SDK matches the spec
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run verify` — 1,736/1,736
- [ ] `dist/` exists with `.js`, `.cjs`, `.d.ts`
- [ ] `npm pack --dry-run` contains no `src/`, `scripts/`, `.env` or test files
- [ ] the version is not already published
- [ ] the working tree is clean and on the release branch

The drift check is the important one, and it is one line:

```bash
npm run generate && git diff --exit-code src/types src/modules \
  || (echo "SDK is stale — regenerate and commit" && exit 1)
```

Without it, someone edits the backend, forgets to regenerate, and ships an SDK
that describes last month's API.

Always inspect the tarball once by hand before the first publish:

```bash
npm pack --dry-run
```

## 1.7 Publishing

**First time:**

```bash
npm login --scope=@lrmc --registry=https://npm.pkg.github.com
npm run test
npm run build
npm publish            # add --access public ONLY if it should be public
```

**Verify it landed:**

```bash
npm view @lrmc/sdk versions
npm view @lrmc/sdk dist-tags
```

## 1.8 Publishing updates safely

The sequence that avoids most incidents:

```bash
git checkout -b release/1.2.0
npm run generate && git diff --stat src/          # what did the API change?
npm test                                          # 1,736 + typecheck
npm version minor -m "release: v%s"               # bumps, commits, tags
npm publish --tag next                            # NOT latest yet
```

Then install `@lrmc/sdk@next` in one real app — the HQ dashboard is the best
canary, it touches the most modules — and exercise a sign-in, a list, a
paginated walk and a mutation. When it holds:

```bash
npm dist-tag add @lrmc/sdk@1.2.0 latest
git push --follow-tags
```

**Do not unpublish.** npm forbids it after 72 hours and it breaks lockfiles even
inside the window. Deprecate instead:

```bash
npm deprecate @lrmc/sdk@1.2.0 "Broken pagination; use 1.2.1"
npm dist-tag add @lrmc/sdk@1.1.4 latest    # roll `latest` back
```

Then publish `1.2.1` with the fix. A bad version stays installable for anyone
pinned to it, which is correct — you break fewer people by moving the tag than
by removing the artefact.

## 1.9 Handling breaking changes

The API is behind four production domains. Breaking changes need a runway.

**Deprecate before removing.** One minor release marks the old surface, one
major removes it:

```ts
/** @deprecated Use `api.landlords.getById`. Removed in 2.0. */
```

TypeScript strikes it through in every editor, which reaches developers far more
reliably than a changelog entry.

**Ship both when you can.** A rename can keep an alias for a full major cycle:
`api.landlords.get = api.landlords.getById`. Cheap, and it turns a hard break
into a warning.

**Write a migration guide, not a list.** `MIGRATION-v2.md` with before/after for
each change, and a `sed`/codemod line where one is possible. The v2 changelog
links to it.

**When the API itself breaks**, version the API before the SDK: run `/api/v2`
alongside `/api/v1`, publish `@lrmc/sdk@2` against v2, and keep `@lrmc/sdk@1`
patched against v1 until the four frontends have moved. The `servers` list in
the OpenAPI spec is where the base path lives, so this is a spec change plus a
regenerate — not a rewrite.

**Announce with lead time.** Deprecated in 1.x, removed in 2.0, with at least
one release cycle and a dated notice in the changelog between them.

## 1.10 Changelogs

Use [Changesets](https://github.com/changesets/changesets). It suits this repo
because it separates *declaring* a change from *releasing* it, which is what you
want when the backend and SDK move together but publish separately.

```bash
npm install -D @changesets/cli
npx changeset init
```

Each PR that changes the SDK adds one:

```bash
npx changeset          # pick patch/minor/major, write one human sentence
```

That writes a small markdown file into `.changeset/`. At release time:

```bash
npx changeset version   # consumes them → bumps version, writes CHANGELOG.md
npx changeset publish   # publishes and creates git tags
```

**Write entries for the consumer, not the committer.** "Fixed pagination
`hasNext` on the last page" beats "refactor Page class" — the reader is deciding
whether they need to upgrade.

Group the changelog by impact: **Breaking**, then **Added**, then **Fixed**. Put
API changes that motivated an SDK change in the same entry, with the endpoint
named, so a reader can connect an SDK bump to the server behaviour that caused
it.

## 1.11 Tagging releases

`npm version` and `changeset publish` both create git tags. Conventions:

```
v1.2.0              SDK release
backend-v1.2.0      backend release (separate lifecycle, same repo)
```

Push tags with the commit, never separately:

```bash
git push --follow-tags
```

Create a GitHub Release from the tag with the changelog section as its body, and
attach `docs/openapi.yaml` as an asset. That last part matters more than it
sounds: it gives you an immutable record of exactly what the API looked like at
that version, which is what you will want the first time a client reports
behaviour that no longer matches the current spec.

Distinguish the two npm tag types, because they are easy to confuse:

- **git tags** mark commits (`v1.2.0`)
- **npm dist-tags** point at versions (`latest`, `next`, `legacy-v1`)

Keep `legacy-v1` pointing at the last 1.x while v2 stabilises. Consumers pinned
to it keep getting patches.

## 1.12 Testing the SDK locally before publishing

Four options, in increasing fidelity.

**`npm pack`** — highest fidelity, and what I would use before any real release.
It produces the exact tarball npm would publish:

```bash
cd sdk && npm pack                       # → lrmc-sdk-1.2.0.tgz
cd ../apps/hq-dashboard
npm install ../../sdk/lrmc-sdk-1.2.0.tgz
```

This is the only local method that exercises `files`, `exports` and the built
`dist/` exactly as a consumer would. If the tarball works, the publish works.

**`npm link`** — fastest loop, but least faithful:

```bash
cd sdk && npm link
cd ../apps/hq-dashboard && npm link @lrmc/sdk
```

Symlinks defeat `files`, and duplicate React/peer instances are a classic
symlink trap. Good for iterating, never sufficient as the final check.

**Verdaccio** — a local registry, for rehearsing the publish itself:

```bash
npx verdaccio &
npm publish --registry http://localhost:4873
npm install @lrmc/sdk --registry http://localhost:4873
```

Worth it before a major, because it exercises `prepublishOnly`, dist-tags and
install resolution end to end.

**npm workspaces** — if the four frontends live in this repo, make them
workspaces. They then resolve `@lrmc/sdk` from source with no linking at all, and
`npm pack` remains the pre-publish gate.

## 1.13 CI/CD

Two workflows. Keep them separate — verification runs on everything, publishing
runs on tags only.

**`.github/workflows/verify.yml`** — every push and PR:

```yaml
name: verify
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
        working-directory: backend
      - run: npm test          # typecheck + 9,638 checks + blueprint + openapi
        working-directory: backend
      - name: Spec must be committed
        run: git diff --exit-code docs/
        working-directory: backend

  sdk:
    needs: backend
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
        working-directory: sdk
      - run: npm run generate
        working-directory: sdk
      - name: SDK must match the spec
        run: git diff --exit-code src/types src/modules
        working-directory: sdk
      - run: npm run typecheck && npm run verify && npm run build
        working-directory: sdk
      - run: npx --yes publint && npx --yes @arethetypeswrong/cli --pack .
        working-directory: sdk
```

The two `git diff --exit-code` steps are the backbone. They make it impossible to
merge a backend change without the regenerated spec, or a spec change without the
regenerated SDK. Everything else in the pipeline is conventional; those two are
what keep three artefacts honest.

**`.github/workflows/publish.yml`** — on tag:

```yaml
name: publish
on:
  push:
    tags: ['v*']
permissions:
  contents: read
  id-token: write        # npm provenance
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: npm ci
        working-directory: sdk
      - run: npm test && npm run build
        working-directory: sdk
      - run: npm publish --provenance --access restricted
        working-directory: sdk
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

`--provenance` is worth enabling from day one. It signs the package with a
verifiable link back to the commit and workflow that built it, and npm displays
it. Zero cost, and it makes supply-chain questions answerable.

Use a **granular access token** scoped to `@lrmc/sdk` only, stored as
`NPM_TOKEN`, with an expiry and a calendar reminder to rotate it.

**Automating releases fully** with Changesets: add a `changesets/action` job on
`main` that opens a "Version Packages" PR accumulating pending changesets.
Merging it publishes. Nobody runs `npm publish` by hand, and the release notes
write themselves from the changeset entries.

---

# 2 · Frontend Integration Blueprint

## 2.1 Which base URL

Point each frontend at its own domain. Same API, same code, different `baseUrl`:

| Frontend | Base URL |
|---|---|
| Public Portal — lrmconsortium.com | `https://api.lrmconsortium.com/api/v1` |
| HQ Command Center — lrmconsortium.africa | `https://api.lrmconsortium.africa/api/v1` |
| PR Portal — africalrmc.com | `https://api.africalrmc.com/api/v1` |
| Ususu — africaususu.com | `https://api.africaususu.com/api/v1` |

Never hardcode it. `NEXT_PUBLIC_LRMC_API_URL` (or equivalent) per deployment, so
preview builds can point at staging without a code change.

## 2.2 Install and configure

```bash
npm install @lrmc/sdk
# axios is optional and only used server-side — see 2.3
npm install axios
```

Configure **once**, at the earliest point in the app's lifecycle:

```ts
// lib/api.ts
import { configureApi, api } from '@lrmc/sdk';

configureApi({
  baseUrl: process.env.NEXT_PUBLIC_LRMC_API_URL!,
  token: () => getAccessToken(),   // called per request — never captured once
  retries: 2,
  defaultTimeoutMs: 20_000,
});

export { api };
```

`token` as a **function** rather than a string is the important detail. It is
awaited on every request, so a token refreshed in the background is picked up
immediately. Pass a string and you have pinned the token the app started with.

## 2.3 How auto-selection works, and what it means for you

| Where your code runs | Transport | Why |
|---|---|---|
| Browser (client component, `useEffect`, event handler) | **fetch** | Already in the platform; nothing bundled |
| Web / service worker | **fetch** | Same |
| Next.js Server Component, route handler, `getServerSideProps` | **axios** | Node runtime |
| Next.js Edge runtime | **fetch** | No `process.versions.node`, detected as a worker |
| React Native | **axios** | Falls back to fetch if axios is absent |

Selection is **lazy** — the first request decides. Importing the SDK triggers
nothing, and a browser bundle never contains axios because the import is dynamic
and marked external.

The practical consequence for Next.js: the *same* `api.landlords.list()` call
uses fetch in a client component and axios in a server component, with no
branching in your code. If you do not install axios at all, the server side
quietly uses Node 18+'s global fetch and everything still works.

Force it when you need determinism (tests, a fetch polyfill, a pre-configured
axios instance with corporate proxy settings):

```ts
import { configureApi, createFetchTransport } from '@lrmc/sdk';
configureApi({ baseUrl, transport: createFetchTransport(myFetch) });
```

## 2.4 JWT auth

Sign-in returns both tokens plus the user's authorisation picture in one call:

```ts
const { accessToken, refreshToken, user } = await api.auth.login({
  email, password,
});
// user: { id, fullName, email, roles, primaryRole, isVerified,
//         status, profileId, accessScope, allowedZones, allowedActions }
```

Access tokens expire in 12h by default, refresh tokens in 30d. Refresh:

```ts
const next = await api.auth.refresh({ refreshToken });
```

**Refresh proactively, and only once at a time.** The pattern that avoids a
thundering herd of refreshes when several requests 401 simultaneously:

```ts
let inFlight: Promise<string> | null = null;

async function getAccessToken(): Promise<string | null> {
  const token = store.access;
  if (token && !expiringWithin(token, 60_000)) return token;

  inFlight ??= api.auth
    .refresh({ refreshToken: store.refresh })
    .then((r) => {
      store.set(r.accessToken, r.refreshToken);
      return r.accessToken;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}
```

One shared promise, so ten concurrent calls trigger one refresh.

`onUnauthorized` is the backstop for when refresh itself fails:

```ts
configureApi({
  baseUrl, token: getAccessToken,
  onUnauthorized: () => { store.clear(); router.push('/login'); },
});
```

## 2.5 Storing tokens

The honest summary: **there is no XSS-proof token storage in a browser.** If an
attacker runs JavaScript on your origin, they can use the token wherever it is.
The goal is to reduce blast radius, and the options rank clearly.

| Approach | XSS | CSRF | Verdict |
|---|---|---|---|
| `localStorage` | Readable | Safe | Convenient; the whole token leaks on any XSS |
| `sessionStorage` | Readable | Safe | Same, but dies with the tab |
| In-memory only | Not persisted | Safe | Best for the access token; lost on refresh |
| **httpOnly cookie** (via a BFF) | **Not readable** | Needs `SameSite`/CSRF token | **Best for the refresh token** |

**Recommended for the HQ Command Center and Member Portal** — the two surfaces
holding real authority:

- **Refresh token** → `httpOnly; Secure; SameSite=Strict` cookie, set by a
  Next.js route handler. JavaScript cannot read it, so XSS cannot exfiltrate it.
- **Access token** → memory only (a module variable or React context). Short
  lifetime, never persisted, gone on reload — at which point you silently
  re-obtain one from the refresh cookie.

That means the browser SDK never sees the refresh token at all. Sign-in and
refresh go through your own route handlers, which hold the cookie and hand back
only the access token:

```ts
// app/api/auth/login/route.ts  (Next.js App Router)
import { configureApi, api } from '@lrmc/sdk';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  configureApi({ baseUrl: process.env.LRMC_API_URL! });   // server-side, no token
  const { accessToken, refreshToken, user } = await api.auth.login(await req.json());

  cookies().set('lrmc_refresh', refreshToken, {
    httpOnly: true, secure: true, sameSite: 'strict',
    path: '/api/auth', maxAge: 60 * 60 * 24 * 30,
  });

  return Response.json({ accessToken, user });   // refresh token never reaches JS
}
```

For the **Public Portal and PR site**, most traffic is anonymous and the few
authenticated actions are low-stakes. `sessionStorage` is a defensible tradeoff
there. Do not use it for HQ.

Whatever you choose: `Secure` in production, short access-token lifetime, and
clear both stores on sign-out.

## 2.6 Calling the modules

Every profile module has the same nine or ten methods, so learning one teaches
you fourteen:

```ts
api.landlords.list({ query: { search: 'Asante', region: 'Greater Accra' } })
api.landlords.create(body)
api.landlords.getById(landlordId)
api.landlords.update(landlordId, patch)
api.landlords.delete(landlordId)          // archives; nothing is destroyed
api.landlords.restore(landlordId)
api.landlords.verify(landlordId, { status: 'verified' })
api.landlords.me()                        // the caller's own record
api.landlords.updateMe(patch)
```

Identical shape for `tenants`, `coordinators`, `vendors`, `drivers`, `riders`,
`airbnbHosts`, `hotels`, `resorts`, `rentalCarCompanies`, `advertisers`, `staff`,
`founders`, `hqExecutives`.

**Beyond the generic surface:**

```ts
// Field operations
api.coordinators.assignProperties(coordinatorId, { propertyIds: [...] })
api.drivers.verificationQueue()          // pending + documents expiring in 30d
api.drivers.setOnline({ isOnline: true, longitude, latitude })
api.rentalCarCompanies.addVehicle(companyId, vehicle)
api.rentalCarCompanies.utilization(companyId)

// Properties — one collection covers rentals, short-lets, hotel rooms, villas
api.properties.searchPublic({ query: { city: 'Accra', maxRent: 8000 } })  // anonymous
api.properties.list()
api.properties.create({ ownerKind: 'LandlordProfile', owner: landlordId, ... })

// Advertising
api.ads.serve({ query: { zone: 'PUBLIC_PORTAL', placement: 'heroBanner' } })
api.ads.trackImpression({ adId, zone: 'PUBLIC_PORTAL', sessionId })
api.ads.trackClick({ adId, zone: 'PUBLIC_PORTAL', sessionId })
api.ads.reports({ query: { from, to } })
api.ads.submitForReview(adId)
api.ads.review(adId, { decision: 'approve' })          // HQ Executive only
api.adPolicy.current()                                  // Founder only
api.adPolicy.previewRotation({ query: { zone: 'PUBLIC_PORTAL' } })

// HQ
api.hq.zones() · api.hq.dashboard() · api.hq.kpis()
api.hq.systemHealth() · api.hq.regions()
api.hq.commandCenter() · api.hq.auditLog()              // Zone A only

// RBAC
api.rbac.catalogue()                                    // the whole role matrix
api.rbac.assignRoles(userId, { roles: ['coordinator'] })// Founder only

// Public content
api.public.listContent({ query: { domain: 'lrmconsortium.com' } })
api.public.getContent(slug)
api.public.track({ domain, path, isConversion: true, conversionGoal: 'contactForm' })
```

### The operational modules

Six modules cover the day-to-day rather than the directory. They follow the same
plural/singular convention, so `list` / `create` / `getById` / `update` mean what
they mean everywhere else; what is worth reading is the handful of methods that
do not.

```ts
// Leases — the contract, and the rent recorded against it
api.leases.list({ query: { status: 'inArrears' } })
api.leases.create({ property, tenant, landlord, leaseStart, leaseEnd, monthlyRent })
api.leases.recordPayment(leaseId, { amount: 2500, method: 'mobileMoney' })
api.leases.mineAsTenant()            // the signed-in tenant's own leases
api.leases.mineAsLandlord()          // the signed-in landlord's own leases

// Maintenance — work orders
api.maintenanceRequests.create({ property, title, serviceType: 'plumbing' })
api.maintenanceRequests.assignVendor(requestId, { vendorId, scheduledFor })
api.maintenanceRequests.myQueue()                       // a vendor's open work
api.maintenanceRequests.historyForProperty(propertyId)

// Ususu dispatch — a strict forward march through the lifecycle
api.rides.request({ pickupAddress, dropoffAddress, vehicleType: 'sedan' })
api.rides.dispatchQueue()                               // unclaimed, verified drivers only
api.rides.accept(rideId, {})
api.rides.start(rideId, {})
api.rides.complete(rideId, { finalFare: 42 })           // splits commission, writes the ledger
api.rides.cancel(rideId, { reason: 'rider no-show' })
api.rides.mineAsDriver() · api.rides.mineAsRider()

// Payments — one ledger, read-only over HTTP
api.payments.list()                                     // Back Office
api.payments.mineAsTenant()      // rent and deposits paid
api.payments.mineAsLandlord()    // rent and payouts received
api.payments.mineAsDriver()      // fares and payouts earned
api.payments.mineAsAdvertiser()  // ad spend billed

// Notifications
api.notifications.registerToken({ token, platform: 'ios' })
api.notifications.inbox()
api.notifications.mark(notificationId, { read: true })
api.notifications.sendTest({ recipient, title, body })  // HQ Executive only

// Commercial clients — the contracting entity above the operational profiles
api.commercialClients.create({ clientName, clientKind: 'hospitalityGroup' })
api.commercialClients.properties(clientId)   // rolled up across every linked profile
api.commercialClients.fleet(clientId)
api.commercialClients.ads(clientId)
```

### Operational flows

```ts
// Rent arithmetic — schedule, arrears, next due date, all computed
api.leases.schedule(leaseId)
api.leases.runRentReminders({ dryRun: true })          // Back Office; rehearse first
api.leases.runRentReminders({ asOf: '2026-07-01', leadDays: 5 })

// SLA
api.maintenanceRequests.sla(requestId)                 // dueAt, overdueAt, state, escalation
api.maintenanceRequests.runSlaEscalation({ dryRun: true })

// Dispatch
api.rides.matches(rideId)                              // ranked candidates + rejection tally

// Payout batches — Back Office builds, the Founder releases
api.payoutBatches.build({ kind: 'driverPayout', currency: 'GHS', periodStart, periodEnd })
api.payoutBatches.lines(batchId)
api.payoutBatches.settle(batchId, { confirmNet: batch.net })   // Zone A only
api.payoutBatches.cancel(batchId, { reason: 'rebuilt for a corrected window' })

// Notifications
api.notifications.broadcast({ role: 'driver', title, body, dryRun: true })   // Zone B

// Client analytics
api.commercialClients.analytics(clientId, { query: { from, to, currency: 'GHS' } })
```

### The Document Engine

Verification is a state machine with obligations, not a status field. Every
transition is a POST on the singular item and returns `DocumentLifecycle` — the
document, what moved, and the audit summary.

```ts
// Holder
api.documents.create({ type: 'identity', fields: { holderName, documentNumber, issuingAuthority, issuedOn, expiresOn } })
api.documents.submit(documentId, { fields: { ...corrections } })
api.documents.mine()                                   // own documents + each one's clock

// Reviewer (Back Office)
api.documents.queue()                                  // own desk, oldest first
api.documents.verificationSummary(documentId)          // lifecycle + score + compliance + expiry
api.documents.review(documentId, {})
api.documents.requestInfo(documentId, { reason: 'the scan is illegible below the photo' })
api.documents.verify(documentId, {})
api.documents.reject(documentId, { reason: 'the name does not match the profile' })
api.documents.expire(documentId, {})
api.documents.reverify(documentId, {})

// HQ
api.documents.listAll() · api.documents.analytics({ query: { from, to } })
```

**Four rules that will shape your UI.**

*Nothing goes from upload straight to verified.* `submitted → verified` is not in
the transition table; review is the only door. An illegal move is **409**.

*A missing reason is 422, not 409.* `requestInfo` and `reject` are unusable
without one — the state was fine, the request was incomplete. Different code,
different retry.

*Verification is gated twice.* Compliance must be clear of **blocking** failures,
which a reviewer cannot waive; an **advisory** failure can be passed with
`overrideAdvisory: true` by someone who has read it. Then the score must clear
its floor. `verificationSummary().verifiable` is the AND of all four inputs, with
each shown beside it — build the verify button on that field, and show the four
underneath so a refusal explains itself.

*Verified freezes identity.* Type, holder, document number and dates cannot
change afterwards; a PATCH touching one returns 409. `reverify` is the way back.
The evidence file is frozen in object storage at the same moment.

**Two things worth knowing before you build against these.**

*The ledger is read-only.* `api.payments` exposes no `create`, `update` or
`delete`, and the server has no route for one. Money is written by the flow that
causes it — `leases.recordPayment` for rent, `rides.complete` for a fare — so a
payment row cannot exist without the event that produced it. A client asserting
"I paid" against the ledger directly is the whole class of bug this forbids.

*Ride transitions are a state machine, not a status field.* `accept`, `start`,
`complete` and `cancel` each check the current status against
`RIDE_TRANSITIONS` and use an optimistic-concurrency filter, so two drivers
cannot both claim one ride and a completed trip cannot be re-completed. An
illegal move returns **409**, not 422 — handle it as "someone got there first",
refresh the ride, and re-render.

*Settlement is asynchronous, and the API refuses to pretend otherwise.*
`payoutBatches.settle()` never returns `settled`. The rail returns `pending`, the
batch moves to `settling`, and the lines carry a `transferStatus` each. Build the
approval screen around "released, awaiting the rail" — code written against a
provider that settles synchronously breaks on the first real one. `confirmNet`
must equal the batch's stored net, so a stale screen cannot release a batch that
has since been rebuilt.

*Money maths rounds once.* Commission and management splits round the *fee* and
take the net as the remainder, so gross always equals fee plus net to the pesewa.
Do not recompute a net client-side from a percentage — at some amounts the two
answers differ by a pesewa, and the difference is what a driver will call about.

### A known gap: query parameter typing

`options.query` is typed as `Record<string, string | number | boolean | …>` on
every call, and **strongly typed only for list endpoints**. The eight
non-list query schemas — `ads.serve`, `ads.reports`, `properties.searchPublic`,
`adPolicy.previewRotation`, `public.listContent`, `public.metrics`,
`hq.auditLog`, `rbac.resolve` — are declared in the backend blueprint but are not
yet emitted as OpenAPI `parameters`, so the generator has nothing to type them
from.

They work correctly at runtime; you just get no autocomplete and no compile-time
check on the key names. Consult `docs/API-BLUEPRINT.md` for the accepted keys, and
treat a typo as a silent no-op rather than an error — the server ignores unknown
query keys. Closing this means emitting those schemas as parameters in
`backend/src/config/openapi.ts`, after which the SDK regenerates with typed
`query` objects and nothing else changes.

## 2.7 Envelope parsing

The API wraps everything. **The SDK unwraps it for you** — you never touch
`.data.data`:

```ts
// Wire:  { "success": true, "data": { "id": "…", "fullName": "Nana Asante" } }
const landlord = await api.landlords.getById(id);
landlord.fullName;                                  // straight to the payload
```

List calls return a `Page<T>` carrying `meta`. `204 No Content` resolves to
`undefined`. `GET /openapi.json` is the one endpoint that is deliberately *not*
enveloped, and the SDK passes it through unchanged.

**Errors are one type**, whatever went wrong — server, network, timeout, abort,
malformed body:

```ts
import { LrmcApiError } from '@lrmc/sdk';

try {
  await api.tenants.create(form);
} catch (err) {
  if (err instanceof LrmcApiError) {
    if (err.isAuthError)       return redirectToLogin();
    if (err.isPermissionError) return toast('Not permitted');
    if (err.code === 'VALIDATION_FAILED') return setFieldErrors(err.fieldErrors);
    if (err.isRetryable)       return toast('Network trouble — retrying');
  }
  throw err;
}
```

`err.fieldErrors` is `Record<string, string[]>`, shaped for form libraries:

```ts
const { setError } = useForm();
Object.entries(err.fieldErrors).forEach(([field, messages]) =>
  setError(field, { message: messages[0] }),
);
```

Server codes: `BAD_REQUEST` `VALIDATION_FAILED` `UNAUTHENTICATED` `FORBIDDEN`
`ZONE_RESTRICTED` `NOT_FOUND` `CONFLICT` `DUPLICATE_KEY` `UNPROCESSABLE`
`RATE_LIMITED` `POLICY_VIOLATION` `INTERNAL`. Client-side additions:
`NETWORK_ERROR` `TIMEOUT` `ABORTED` `MALFORMED_RESPONSE` `CLIENT_FORBIDDEN`
`CONFIGURATION_ERROR`.

## 2.8 RBAC helpers

Every operation ships the zone, roles and permissions the server enforces. Two
ways to use that, and **the first is usually the right one**.

**Read the metadata to shape the UI.** Better than catching a rejection, because
the user never sees a control they cannot use:

```ts
import { landlordsMeta, adsMeta, can } from '@lrmc/sdk';

const { authorization } = await api.auth.me();

const canCreateLandlord = landlordsMeta.create.permissions
  .some((p) => can(authorization.grants, p));

const canApproveAds = adsMeta.review.roles.includes(user.primaryRole);

<Button disabled={!canCreateLandlord}>Add landlord</Button>
```

`can()` mirrors the server matcher exactly — `*:*`, `resource:*`, `*:action`, and
`read` implying `readOwn`.

**Enable the guard to fail fast.** Blocks a disallowed call before it leaves the
browser:

```ts
const me = await api.auth.me();
configureApi({
  baseUrl, token: getAccessToken,
  enforceRbac: true,
  actor: {
    roles: me.user!.roles,
    grants: me.authorization.grants,
    allowedZones: me.authorization.allowedZones,
    restrictedZones: me.authorization.restrictedZones,
  },
});
```

> **This is a UX affordance, not a security boundary.** The server enforces the
> same three gates and is the only thing that matters. The guard saves a round
> trip; it protects nothing. Never move an authorisation decision into the client
> because the guard exists.

## 2.9 Zone helpers

```ts
import { HQ_ZONES, HQ_ZONE_INFO, isHQZone } from '@lrmc/sdk';

const nav = (await api.hq.zones()).zones
  .filter((z) => z.accessible)
  .map((z) => ({ href: `/${z.key.toLowerCase()}`, label: z.label }));
```

`GET /hq/zones` returns each zone with an `accessible` flag computed for the
caller — build navigation from that rather than from a hardcoded list, and a role
change in `config/roles.ts` propagates to every frontend with no deploy.

The five zones map naturally onto route groups:

| Zone | Route group | Domain |
|---|---|---|
| `FOUNDER_COMMAND_CENTER` | `/command` | lrmconsortium.africa |
| `HQ_EXECUTIVE` | `/hq` | lrmconsortium.africa |
| `BACK_OFFICE` | `/back-office` | lrmconsortium.africa |
| `MEMBER_PORTAL` | `/portal` | lrmconsortium.com |
| `PUBLIC_PORTAL` | `/` | lrmconsortium.com, africalrmc.com |

Note that **every role can enter the Public Portal** — it is the open front door.
Do not gate public pages on zone membership.

## 2.10 Pagination

```ts
const page = await api.drivers.list({
  query: { limit: 50, verificationStatus: 'pending' },
});

page.items          // Driver[]
page.total          // 412
page.meta           // { page, limit, total, totalPages, hasNext, hasPrev }
page.hasNext

const next = await page.next();      // Page<Driver> | null
const all  = await page.collect();   // every remaining item (maxPages guard)

for await (const driver of page.stream()) {   // streams, never buffers the lot
  await sendReminder(driver);
}
```

Prefer `stream()` over `collect()` for anything that could be large. A tenancy
roll of 40,000 does not need to be in memory before you process the first row.

Infinite scroll with TanStack Query:

```ts
useInfiniteQuery({
  queryKey: ['drivers'],
  queryFn: ({ pageParam = 1 }) =>
    api.drivers.list({ query: { page: pageParam, limit: 25 } }),
  getNextPageParam: (last) => (last.hasNext ? last.meta.page + 1 : undefined),
});
```

## 2.11 Next.js — App Router and Server Components

**Configure once per runtime.** Server and browser are separate module
instances, so both need it:

```ts
// lib/api.server.ts   — imported only by server code
import 'server-only';
import { configureApi, api } from '@lrmc/sdk';
import { cookies } from 'next/headers';

configureApi({
  baseUrl: process.env.LRMC_API_URL!,        // not NEXT_PUBLIC — stays server-side
  token: async () => cookies().get('lrmc_access')?.value ?? null,
});
export { api as serverApi };
```

```ts
// lib/api.client.ts   — 'use client' entry points
'use client';
import { configureApi, api } from '@lrmc/sdk';

configureApi({
  baseUrl: process.env.NEXT_PUBLIC_LRMC_API_URL!,
  token: () => tokenStore.get(),
});
export { api as clientApi };
```

The `server-only` package is worth adding: it turns "someone imported the server
config into a client component" from a runtime token leak into a build error.

**Server Components** fetch directly — no loading state, no client-side waterfall:

```tsx
// app/back-office/drivers/page.tsx
import { serverApi } from '@/lib/api.server';

export default async function DriversPage() {
  const queue = await serverApi.drivers.verificationQueue();
  return <VerificationTable rows={queue.items} />;
}
```

**Server Actions** for mutations, with the error mapping the form needs:

```tsx
'use server';
import { serverApi } from '@/lib/api.server';
import { LrmcApiError } from '@lrmc/sdk';
import { revalidatePath } from 'next/cache';

export async function verifyDriver(driverId: string) {
  try {
    await serverApi.drivers.verify(driverId, { status: 'verified' });
    revalidatePath('/back-office/drivers');
    return { ok: true };
  } catch (err) {
    if (err instanceof LrmcApiError) {
      return { ok: false, code: err.code, fields: err.fieldErrors };
    }
    throw err;
  }
}
```

**Caching.** Next.js caches `fetch` by default; the SDK uses axios on the server,
which Next does not cache. That is usually what you want for authenticated data —
but it means public content will refetch on every render unless you cache it
yourself:

```tsx
import { unstable_cache } from 'next/cache';

const getPublishedPages = unstable_cache(
  () => serverApi.public.listContent({ query: { domain: 'lrmconsortium.com' } }),
  ['public-content'],
  { revalidate: 300, tags: ['content'] },
);
```

**Edge runtime** is detected as a worker, so it uses fetch. Node APIs are absent
there; keep token storage in cookies rather than anything Node-specific.

**Streaming.** Wrap slow sections in `<Suspense>` — the HQ dashboard's KPI
snapshot touches every collection, so let the shell render first:

```tsx
<Suspense fallback={<KpiSkeleton />}>
  <KpiPanel />        {/* awaits serverApi.hq.kpis() */}
</Suspense>
```

## 2.12 React Admin dashboards

React Admin wants a `DataProvider`. The SDK maps onto it almost one-for-one —
this is the whole adapter:

```ts
import { api } from '@lrmc/sdk';
import type { DataProvider } from 'react-admin';

const MODULES = {
  landlords: api.landlords, tenants: api.tenants,
  coordinators: api.coordinators, vendors: api.vendors,
  drivers: api.drivers, riders: api.riders,
  hotels: api.hotels, resorts: api.resorts,
  airbnbHosts: api.airbnbHosts, rentalCarCompanies: api.rentalCarCompanies,
  advertisers: api.advertisers, properties: api.properties, ads: api.ads,
} as const;

const mod = (name: string) => {
  const m = MODULES[name as keyof typeof MODULES];
  if (!m) throw new Error(`Unknown resource: ${name}`);
  return m as any;
};

export const lrmcDataProvider: DataProvider = {
  async getList(resource, { pagination, sort, filter }) {
    const page = await mod(resource).list({
      query: {
        page: pagination.page,
        limit: pagination.perPage,
        sort: `${sort.order === 'DESC' ? '-' : ''}${sort.field}`,
        ...filter,
      },
    });
    return { data: page.items, total: page.total };
  },
  async getOne(resource, { id })      { return { data: await mod(resource).getById(String(id)) }; },
  async create(resource, { data })    { return { data: await mod(resource).create(data) }; },
  async update(resource, { id, data }){ return { data: await mod(resource).update(String(id), data) }; },
  async delete(resource, { id })      { await mod(resource).delete(String(id)); return { data: { id } as any }; },
  async getMany(resource, { ids }) {
    const rows = await Promise.all(ids.map((id) => mod(resource).getById(String(id))));
    return { data: rows };
  },
  async deleteMany(resource, { ids }) {
    await Promise.all(ids.map((id) => mod(resource).delete(String(id))));
    return { data: ids };
  },
  async getManyReference() { throw new Error('Not used'); },
  async updateMany()       { throw new Error('Not used'); },
};
```

Two things to get right:

**React Admin expects `id`.** The API returns `id` (the `toJSON` transform maps
`_id` → `id`), so no remapping is needed. Verify this early — it is the usual
first bug in a React Admin integration.

**Hide resources the role cannot reach**, using the same metadata:

```tsx
import { landlordsMeta, driversMeta } from '@lrmc/sdk';

<Admin dataProvider={lrmcDataProvider} authProvider={lrmcAuthProvider}>
  {(permissions) => [
    landlordsMeta.list.roles.includes(permissions.primaryRole)
      ? <Resource name="landlords" list={LandlordList} edit={LandlordEdit} />
      : null,
    driversMeta.list.roles.includes(permissions.primaryRole)
      ? <Resource name="drivers" list={DriverList} />
      : null,
  ]}
</Admin>
```

The `authProvider` wraps `api.auth`; `getPermissions` should return the
`authorization` block from `api.auth.me()` so the above works.

## 2.13 Static public pages

The Public Portal and PR site are mostly anonymous reads — ISR is the right shape.

```tsx
// app/properties/page.tsx
export const revalidate = 300;

export default async function Properties() {
  const page = await serverApi.properties.searchPublic({
    query: { city: 'Accra', limit: 24 },
  });
  return <Listings items={page.items} />;
}
```

```tsx
// app/[slug]/page.tsx
export async function generateStaticParams() {
  const page = await serverApi.public.listContent({ query: { limit: 100 } });
  return page.items.map((c) => ({ slug: c.slug }));
}

export const revalidate = 600;

export default async function Page({ params }: { params: { slug: string } }) {
  const content = await serverApi.public.getContent(params.slug);
  return <Article content={content} />;
}
```

Three notes specific to public pages:

**No token needed.** `properties.searchPublic`, `public.listContent`,
`public.getContent`, `public.track` and `ads.serve` all accept anonymous callers.
The spec marks them `security: [{}, {bearerAuth: []}]` — the empty object is what
tells tooling anonymous access is valid.

**Track conversions from the client**, where the session exists:

```ts
'use client';
await clientApi.public.track({
  domain: 'lrmconsortium.com',
  path: window.location.pathname,
  sessionId,
  isConversion: true,
  conversionGoal: 'landlordEnquiry',
});
```

**Ads must be requested per visitor, not per build.** Rotation is seeded on
(session, zone, minute), so a server-rendered ad would be identical for everyone
until revalidation — which destroys the rotation and the advertiser's numbers:

```tsx
'use client';
useEffect(() => {
  clientApi.ads
    .serve({ query: { zone: 'PUBLIC_PORTAL', placement: 'heroBanner', sessionId } })
    .then((r) => setAds(r.ads));
}, []);
```

Fire `trackImpression` when the creative actually enters the viewport
(`IntersectionObserver`), not when it is fetched — an ad rendered below the fold
and never seen should not be billed. Impressions are deduped per session inside
the configured window, so a repeat returns `{ counted: false }` rather than an
error.

## 2.14 Ususu dispatch UI

The dispatch surface is the one place where polling and geo matter.

```tsx
'use client';
import { api } from '@lrmc/sdk';

// Online, verified drivers in a region
const drivers = await api.drivers.list({
  query: { isOnline: true, verificationStatus: 'verified', region: 'Greater Accra', limit: 100 },
});

// Driver goes on shift
await api.drivers.setOnline({
  isOnline: true,
  longitude: coords.longitude,
  latitude: coords.latitude,
});
```

`setOnline` is refused unless the driver is verified — surface that as an
onboarding prompt rather than a generic error:

```ts
catch (err) {
  if (err instanceof LrmcApiError && err.isPermissionError) {
    return showVerificationPrompt();
  }
}
```

Use the `dispatchable` virtual on `Driver` rather than checking fields yourself —
it already combines verification, status and document currency:

```tsx
const available = drivers.items.filter((d) => d.dispatchable);
```

**Polling until rides ship.** The ride module is not built yet (see §3.11), so
dispatch polls. Poll the driver list on a visible-tab interval, back off when
hidden, and cancel in flight on unmount:

```ts
useEffect(() => {
  const controller = new AbortController();
  const tick = () => api.drivers.list({
    query: { isOnline: true, region },
    signal: controller.signal,
  }).then(setDrivers).catch(ignoreAborts);

  const id = setInterval(() => document.visibilityState === 'visible' && tick(), 10_000);
  tick();
  return () => { controller.abort(); clearInterval(id); };
}, [region]);
```

When rides land, replace the interval with a WebSocket and keep the SDK for
everything else. Nothing above changes shape.

---

# 3 · Mobile App Integration Plan

## 3.1 What runs where

| Platform | Approach |
|---|---|
| **React Native / Expo** | `@lrmc/sdk` directly — full type safety |
| **Flutter** | Generate a Dart client from `docs/openapi.yaml` |
| **iOS / Android native** | Generate Swift / Kotlin from `docs/openapi.yaml` |

The SDK is TypeScript, so only React Native uses it directly. The other two
consume the same OpenAPI document, which means they inherit the same contract —
including `x-zone`, `x-roles` and the envelope shape.

## 3.2 React Native — install and auto-selection

```bash
npm install @lrmc/sdk axios
npx expo install expo-secure-store
```

**Install axios on React Native.** It is optional in the package, but RN's fetch
has real gaps — no request timeout, patchy abort support, and inconsistent
upload progress. The SDK detects `navigator.product === 'ReactNative'` and
prefers axios for exactly these reasons. Without axios it falls back to RN's
fetch and still works, but you lose reliable timeouts.

Verify the selection once during bring-up:

```ts
import { detectRuntime, autoTransport } from '@lrmc/sdk';
console.log(detectRuntime());                 // 'react-native'
console.log((await autoTransport.resolve()).name);  // 'axios'
```

Detection order matters here: React Native is checked **first**, because it
defines `navigator` but has no DOM, and a naive browser check would misfire.

## 3.3 Secure token storage

Mobile has real secure storage, unlike the browser. Use it.

| Platform | Store | Backed by |
|---|---|---|
| iOS | `expo-secure-store` / `react-native-keychain` | Keychain Services |
| Android | Same | EncryptedSharedPreferences / Keystore |
| Flutter | `flutter_secure_storage` | Keychain / Keystore |
| Native | Keychain API / Android Keystore | — |

**Never** `AsyncStorage` for tokens — it is plaintext on disk and readable on a
rooted or jailbroken device.

```ts
import * as SecureStore from 'expo-secure-store';
import { configureApi, api } from '@lrmc/sdk';

const ACCESS = 'lrmc.access';
const REFRESH = 'lrmc.refresh';

let cachedAccess: string | null = null;   // memory cache; SecureStore is slow-ish
let refreshing: Promise<string | null> | null = null;

async function getToken(): Promise<string | null> {
  if (cachedAccess && !expiringWithin(cachedAccess, 60_000)) return cachedAccess;

  refreshing ??= (async () => {
    const rt = await SecureStore.getItemAsync(REFRESH);
    if (!rt) return null;
    try {
      const r = await api.auth.refresh({ refreshToken: rt });
      await SecureStore.setItemAsync(ACCESS, r.accessToken, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await SecureStore.setItemAsync(REFRESH, r.refreshToken);
      cachedAccess = r.accessToken;
      return r.accessToken;
    } catch {
      await signOut();
      return null;
    } finally { refreshing = null; }
  })();

  return refreshing;
}

configureApi({
  baseUrl: 'https://api.africaususu.com/api/v1',
  token: getToken,
  retries: 3,
  retryDelayMs: 500,
  defaultTimeoutMs: 20_000,
  onUnauthorized: signOut,
});
```

`WHEN_UNLOCKED_THIS_DEVICE_ONLY` keeps the token out of iCloud Keychain backups,
so a restored device does not arrive already signed in.

**Add biometric gating** for anything holding money — the driver earnings screen,
the advertiser billing screen:

```ts
import * as LocalAuthentication from 'expo-local-authentication';
const { success } = await LocalAuthentication.authenticateAsync({
  promptMessage: 'Confirm to view earnings',
});
```

## 3.4 Calling modules from mobile

Identical to web — same package, same signatures:

```ts
// Auth
await api.auth.register({ fullName, email, phone, password, role: 'driver',
                          vehicleType: 'sedan', region: 'Greater Accra' });
await api.auth.login({ email, password });
const me = await api.auth.me();

// Driver app
await api.drivers.me();
await api.drivers.updateMe({ vehicleColor: 'Silver' });
await api.drivers.setOnline({ isOnline: true, longitude, latitude });

// Rider app
await api.riders.me();
await api.riders.updateMe({ preferredPaymentMethod: 'mobileMoney' });

// Ads inside the app
const { ads } = await api.ads.serve({ query: { zone: 'USUSU_PORTAL', placement: 'ususuMapCard' } });
await api.ads.trackImpression({ adId: ads[0].id, zone: 'USUSU_PORTAL', sessionId });

// Member flows
await api.tenants.me();
await api.landlords.me();
await api.properties.list();
```

Self-registerable roles: `tenant` `landlord` `rider` `driver` `vendor`
`advertiser` `airbnbHost` `hotelManager` `resortManager` `rentalCarCompany`
`publicUser`. Everything else is appointed in Zone A — a mobile app cannot create
a coordinator.

## 3.5 Envelope parsing

Handled by the SDK on React Native exactly as on web.

For **Flutter and native**, you unwrap it yourself. Do it once, in one place:

```dart
class Envelope<T> {
  final bool success;
  final T? data;
  final PageMeta? meta;

  static T unwrap<T>(Map<String, dynamic> json, T Function(dynamic) parse) {
    if (json['success'] == true) return parse(json['data']);
    final e = json['error'];
    throw LrmcApiException(
      code: e['code'], message: e['message'],
      details: (e['details'] as List?) ?? const [],
    );
  }
}
```

Every response goes through it. The moment you unwrap inline in one screen, you
have two error paths and the second one will be wrong.

## 3.6 Consistent error handling

Map the twelve server codes to user-facing behaviour once, at the app shell, and
never write a bare error toast in a screen:

| Code | Mobile behaviour |
|---|---|
| `UNAUTHENTICATED` | Clear secure store, route to sign-in |
| `FORBIDDEN` / `ZONE_RESTRICTED` | "Not available for your account" — no retry |
| `VALIDATION_FAILED` | Bind `fieldErrors` to the form |
| `NOT_FOUND` | Empty state, not an error dialog |
| `CONFLICT` / `DUPLICATE_KEY` | "Already exists" — usually a double submit |
| `POLICY_VIOLATION` | Show the message verbatim; it explains a rule |
| `RATE_LIMITED` | Back off, retry silently |
| `NETWORK_ERROR` / `TIMEOUT` | Offline banner, queue the action |
| `INTERNAL` | "Something went wrong", log it, offer retry |

```ts
export function handle(err: unknown): UserFacing {
  if (!(err instanceof LrmcApiError)) return { kind: 'unknown' };
  if (err.isAuthError)                return { kind: 'signout' };
  if (err.isPermissionError)          return { kind: 'denied', message: err.message };
  if (err.code === 'VALIDATION_FAILED') return { kind: 'fields', fields: err.fieldErrors };
  if (err.isRetryable)                return { kind: 'retry' };
  return { kind: 'error', message: err.message };
}
```

## 3.7 Retries and interceptors

The SDK has retries built in — exponential backoff on network errors, timeouts,
429 and 5xx, and **never** on 4xx validation:

```ts
configureApi({ baseUrl, token: getToken, retries: 3, retryDelayMs: 500 });
```

Mobile networks justify more retries than web. Three is reasonable on a Ghanaian
mobile connection; more than five just delays the error.

**Interception** happens through config hooks rather than an axios interceptor
chain, so it works identically whichever transport is selected:

```ts
configureApi({
  baseUrl, token: getToken,
  onResponse: ({ method, path, status, durationMs }) => {
    analytics.track('api_call', { method, path, status, durationMs });
    if (durationMs > 5000) log.warn('slow', { path, durationMs });
  },
  onUnauthorized: signOut,
  headers: { 'X-Client': `ususu-driver/${Application.nativeApplicationVersion}` },
});
```

Sending a client version header from day one is worth it — the first time a
release misbehaves you will want to filter server logs by it.

**Offline queueing** is the piece the SDK does not provide, and mobile needs it.
Wrap mutations:

```ts
async function queued<T>(op: () => Promise<T>, replay: SerialisedOp): Promise<T | null> {
  try { return await op(); }
  catch (err) {
    if (err instanceof LrmcApiError &&
        (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT')) {
      await queue.push(replay);      // drain on NetInfo reconnect
      return null;
    }
    throw err;
  }
}
```

Only queue **idempotent or safely repeatable** operations. `drivers.setOnline` is
safe to replay; a payment is not.

## 3.8 Push notifications

The backend has no notification module yet (§3.11), so wire the token now and
point it at the endpoint when it lands.

```ts
import * as Notifications from 'expo-notifications';

const token = (await Notifications.getExpoPushTokenAsync()).data;
await api.drivers.updateMe({ pushToken: token } as never);   // once the field exists
```

Register on **sign-in and on token rotation**, not just first launch — Expo and
FCM both rotate tokens.

Planned notification classes, mapped to the flows below:

| Audience | Trigger |
|---|---|
| Driver | Verification approved/rejected; document expiring in 30d; ride offered |
| Rider | Driver assigned; arriving; trip complete |
| Tenant | Rent due; receipt; maintenance status change |
| Landlord | Monthly statement; maintenance needing approval; payout sent |
| Advertiser | Ad approved/rejected; budget 80% spent; campaign ended |
| Back Office | Verification queue threshold; document expiry batch |

Deep-link straight to the relevant screen (`ususu://driver/verification`) rather
than dropping the user on a home screen — a notification that requires three taps
to act on may as well not exist.

**When notifications are unavailable** — permission denied, or the module not yet
shipped — fall back to WhatsApp. Every profile carries `WhatsApp` and
`preferredContactMethod` defaults to `whatsapp`. In this market that is the more
reliable channel anyway, and the schema already anticipates it.

## 3.9 Ride dispatch flows

**Ride endpoints do not exist yet.** The permission vocabulary declares `ride`
and `earnings`, and roles already carry the grants, but the module is unbuilt.
What follows is the flow the current API supports, and where the gap is.

**Driver, today:**

```ts
const me = await api.drivers.me();
if (me.verificationStatus !== 'verified') return showOnboarding(me);
if (!me.documentsCurrent) return showDocumentRenewal(me);

await api.drivers.setOnline({ isOnline: true, longitude, latitude });
// … periodic position updates via the same call …
await api.drivers.setOnline({ isOnline: false });
```

`dispatchable` on the driver record already combines verification, active status
and document currency. Use it rather than re-deriving the rule on the client.

**Rider, today:** `api.riders.me()`, `updateMe` for saved places and payment
method, and `api.ads.serve({ zone: 'USUSU_PORTAL' })` for in-app placements.

**The gap:** requesting a ride, matching, live tracking, fare and earnings. When
`rides` ships it will follow the same convention — `POST /rides`,
`GET /ride/{rideId}`, `PATCH /ride/{rideId}/status` — and the SDK regenerates to
match. Build the driver and rider shells against what exists; the dispatch screen
is the one to leave until the module lands.

For live position, plan on WebSocket or SSE rather than polling. A rideshare map
polling every 3 seconds will drain a battery and burn a data bundle that matters
to the driver.

## 3.10 Driver verification flow

This is fully supported today and worth building first — it is the gate on
everything else.

```
register → profile draft → documents uploaded → Back Office review → verified
```

```ts
// 1. Register
const { user } = await api.auth.register({
  fullName, email, phone, password,
  role: 'driver', vehicleType: 'sedan', region: 'Greater Accra',
});
// status: 'pending', verificationStatus: 'pending'

// 2. Complete the profile
await api.drivers.updateMe({
  vehicleMake: 'Toyota', vehicleModel: 'Corolla',
  vehicleYear: 2019, vehiclePlate: 'GR-4821-24',
  driverLicenseExpiry: '2027-05-01T00:00:00Z',
  insuranceExpiry: '2026-11-01T00:00:00Z',
});

// 3. Upload documents — multipart
import { toFormData } from '@lrmc/sdk';
await api.drivers.updateMe(toFormData({
  driverLicensePhoto: { uri, name: 'licence.jpg', type: 'image/jpeg' },
  nationalIDPhoto:    { uri: idUri, name: 'ghana-card.jpg', type: 'image/jpeg' },
  vehiclePhotos: photos,
}) as never);

// 4. Poll status (or receive a push, once notifications ship)
const { verificationStatus, rejectionReason } = await api.drivers.me();
```

Two details that matter on the client:

**Uploaded documents are never returned.** `driverLicenseNumber`,
`driverLicensePhoto`, `nationalID` and `IDPhoto` are `writeOnly` — absent from the
`Driver` response type entirely. Show "uploaded ✓" from local state; do not expect
to read them back.

**Expiry drives re-verification.** `documentsCurrent` goes false when a licence or
insurance lapses, and the driver stops being `dispatchable`. Warn at 30 days —
which is the same window the Back Office queue uses, so driver and staff see the
same thing at the same time.

Back Office side: `api.drivers.verificationQueue()` then
`api.drivers.verify(driverId, { status: 'verified' })` or
`{ status: 'rejected', note: '…' }`. A rejection **requires** a note, and the
driver sees it as `rejectionReason` — write it as something the driver can act on.

## 3.11 Advertiser dashboard

A mobile advertiser dashboard is mostly read, with a light approval loop:

```ts
const advertiser = await api.advertisers.me();
if (!advertiser.inGoodStanding) return showAccountHold(advertiser);

const ads = await api.ads.list({ query: { status: 'active' } });
const report = await api.ads.reports({
  query: { from: startOfMonth, to: now },
});
// report.totals: { impressions, clicks, ctr, activeAds }
// report.byAd / byZone / byCategory
```

**An advertiser's report is silently narrowed to their own campaigns**, whatever
`advertiserId` is passed. You cannot leak another advertiser's numbers by
accident.

Lifecycle from the app:

```ts
await api.ads.create({ advertiser: advertiser.id, title, adImage, adLink,
                       adCategory: 'construction', startDate, endDate });
await api.ads.submitForReview(adId);          // → pendingReview
await api.ads.setStatus(adId, { action: 'pause' });
```

`status` is `readOnly` — it moves only through `submitForReview`, `setStatus` and
HQ's `review`. Never try to `update` it directly; the field is not in the request
type.

Surface `inGoodStanding` prominently. It combines active status, verification,
fewer than three policy strikes and credit within limit — and when it is false,
nothing will serve regardless of what the campaign screen shows.

## 3.12 Rental and lease flows

**Supported.** Profiles, properties, leases, the rent ledger and maintenance
work orders all have a callable surface.

**Profiles and properties:**

```ts
// Tenant
const tenant = await api.tenants.me();
tenant.leaseStart · tenant.leaseEnd · tenant.monthlyRent · tenant.rentDueDay
tenant.leaseDaysRemaining      // computed server-side
tenant.complianceScore · tenant.onTimePaymentRate

// Landlord
const landlord = await api.landlords.me();
const properties = await api.properties.list();      // scoped to their own
landlord.diasporaStatus · landlord.payoutCurrency · landlord.statementFrequency

// Commercial
await api.airbnbHosts.me();
await api.rentalCarCompanies.utilization(companyId);
await api.rentalCarCompanies.addVehicle(companyId, vehicle);
```

`leaseDaysRemaining` is computed server-side — do not recompute it from
`leaseEnd` on the client, or a device with a wrong clock will show a wrong
countdown.

**Leases, rent and maintenance:**

```ts
// Tenant home screen
const leases = await api.leases.mineAsTenant();
const ledger = await api.payments.mineAsTenant();
lease.daysRemaining · lease.isInArrears · lease.arrearsAmount

// Paying rent — this writes the ledger row and rolls the lease totals forward
await api.leases.recordPayment(leaseId, { amount: lease.monthlyRent, method: 'mobileMoney' });

// Raising a fault
await api.maintenanceRequests.create({
  property: lease.property, title: 'Kitchen tap leaking',
  serviceType: 'plumbing', priority: 'high', photosBefore: [url],
});

// Landlord statement screen
const mine = await api.leases.mineAsLandlord();
const received = await api.payments.mineAsLandlord();

// Vendor day
const queue = await api.maintenanceRequests.myQueue();   // open work, most urgent first
```

`totalPaid`, `arrearsAmount` and `lastPaymentAt` are `readOnly` — they move only
through `recordPayment`. Re-read the lease after a payment rather than adjusting
the numbers locally; the server also clears `inArrears` when the balance reaches
zero, and a client that guesses will disagree with the statement.

For **diaspora landlords** specifically — the core LRMC customer — the profile
carries `payoutCurrency`, `statementFrequency` and `managementFeePercent`, and
`payments.mineAsLandlord()` is the statement behind them. Filter on `kind` to
separate rent received from payouts made.

---

## Appendix · Verified state

| Artefact | Status |
|---|---|
| Backend `npm run verify` | 9,638 / 9,638 |
| Backend typecheck | Stub-verified; run after `npm install` |
| OpenAPI | 251 operations, 175 paths, 159 schemas, 0 dangling `$refs` |
| SDK `npm run verify` | 1,736 / 1,736 |
| SDK typecheck | 0 errors |
| SDK build (`tsup`) | Not yet run — `npm install` required |

**Known gaps**

| Gap | Impact | Fix |
|---|---|---|
| 8 non-list query schemas not emitted as OpenAPI `parameters` | `options.query` untyped on those calls; works at runtime | Emit them in `config/openapi.ts`, regenerate |
| `tsup` build never run | `dist/` unbuilt | `npm install && npm run build` |
| Backend typecheck stub-verified only | Real `@types` conformance unproven | `npm install && npm run typecheck` |

**Shipped with logic.** The six operational modules plus payout batches now
carry their business rules, not just their routes: rent arithmetic (arrears,
instalment schedules, month-end clamping, lifecycle), maintenance SLA clocks and
coordinator routing, the ride state machine with driver matching and commission
splits, payout batching with idempotent settlement, and portfolio analytics.

**Stubbed on purpose:** the two external integrations. `PushProvider` and
`MoneyProvider` are interfaces with offline stub implementations — they validate,
enforce idempotency, and return the shapes a real vendor returns. Registering FCM
or MTN MoMo at boot is `registerPushProvider()` / `registerMoneyProvider()`; no
call site changes. Both stubs identify themselves as `stub` in every response, so
nothing downstream can mistake a recorded send for a delivered one.

**Scheduling is external by design.** `POST /leases/run-rent-reminders` and
`POST /maintenance-requests/run-sla-escalation` are idempotent endpoints a
platform cron calls. Keeping the trigger outside the process means the job does
not silently stop when a container restarts, and an operator can replay a missed
day with `asOf` or rehearse with `dryRun` — no deploy required.

**The Document Engine adds a third stub:** `StorageProvider`. Evidence files are
addressed by *key*, never by URL — the document record holds a key and a signed
URL is minted on demand with a fifteen-minute life. A permanent link to a
passport scan in a database row is a breach waiting for a backup to leak.
`registerStorageProvider()` swaps the stub for S3, Backblaze or a Ghana-hosted
MinIO cluster; no call site changes.

**Still to come:** real dispatch optimisation (the matcher has no traffic model
and no forward-looking supply balancing), webhook handling for settlement
callbacks, OCR extraction to feed the clarity score (it degrades to a neutral 70
until then), an employer directory and a household register (their compliance
rules report `skipped` rather than a fabricated pass), and statement PDFs.
