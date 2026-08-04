# LRMC + Ususu

The **Legacy Rental Management Consortium** platform and **Ususu Rideshare**, as
one backend, one typed SDK, and one governance console.

| | |
|---|---|
| Endpoints | 266 across 30 modules |
| OpenAPI | 189 paths · 266 operations · 188 schemas |
| Backend checks | 11,020 |
| SDK checks | 1,858 |
| Console smoke checks | 45 |

## Layout

```
backend/     Express + Mongoose API. The source of truth for everything.
  src/config/apiBlueprint.ts   One declaration; four artefacts generated from it.
  docs/                        API-BLUEPRINT.md, openapi.json, openapi.yaml
sdk/         @lrmc/sdk — generated TypeScript client, one method per operation.
console/     Self-contained governance console + headless smoke test.
docs/        Integration guide.
```

## Running it

```bash
cd backend
cp .env.example .env          # then fill in MONGO_URI, JWT_SECRET, FAC_PEPPER
npm install
npm run seed                  # a working institution: founder, exec, staff, members
npm run dev
```

`npm test` runs the whole chain: typecheck, 11,020 assertions, blueprint
regeneration, OpenAPI regeneration.

## The one thing to get right before deploying

Generate a real `FAC_PEPPER` and keep it out of git:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The process **refuses to boot in production** without it, and also refuses to
boot on a secret that still contains placeholder wording — the string shipped in
`.env.example` is long and varied enough to pass every length check, which is
exactly why it is rejected by name instead.

Changing the pepper invalidates every existing Founder Authorisation Code.

## Generated, not hand-maintained

`backend/src/config/apiBlueprint.ts` declares every endpoint once. From it:

- `docs/API-BLUEPRINT.md` — the human reference
- `docs/openapi.{json,yaml}` — the machine reference
- `sdk/src/modules/*` — one typed method per operation
- assertions in `backend/src/scripts/verify.ts`

So the router, the spec and the client cannot drift apart without a test
failing. Add an endpoint by adding a blueprint entry, then re-running
`npm run blueprint && npm run openapi` and the SDK generator.

## Architecture in one paragraph

Roles are data — `resource:action` permission strings with wildcards, not
hard-coded checks. Every protected request passes three gates: `enterZone()`
decides which of the five HQ surfaces you may touch, `requirePermission()`
decides what you may do, and `requireOwnership()` narrows which rows are yours.
Zone A adds a fourth: `requireClearance()`, which asks not what your account is
allowed to do but whether you are presently at the keyboard, proved by the
six-digit Founder Authorisation Code.
