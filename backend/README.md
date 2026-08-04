# LRMC + Ususu — Backend Foundation

The institutional backend for **LRMC** (Legacy Rental Management Consortium) and
**Ususu Rideshare**: one platform, one identity model, one permission system,
covering residential rentals, commercial clients (Airbnb hosts, hotels, resorts,
rental car companies), field operations, mobility, and ad revenue.

TypeScript · Express · MongoDB/Mongoose · Zod · JWT

---

## Start here

```bash
cp .env.example .env          # set MONGO_URI and JWT_SECRET at minimum
npm install
npm run typecheck             # full type check against real @types
npm run verify                # 5,735 assertions on RBAC, rotation + API contract
npm run blueprint             # regenerate docs/API-BLUEPRINT.md from the declarations
npm run openapi               # regenerate docs/openapi.{json,yaml}
npm run seed                  # a working institution to click around in
npm run dev                   # http://localhost:3000/api/v1
```

**[`docs/API-BLUEPRINT.md`](docs/API-BLUEPRINT.md)** is the full route reference —
all 178 endpoints with zones, permissions, ownership rules, request schemas and a
computed list of which roles can reach each one. It is *generated* from
`src/config/apiBlueprint.ts`, so it cannot drift from the declarations.

**[`docs/openapi.yaml`](docs/openapi.yaml)** / **[`docs/openapi.json`](docs/openapi.json)**
is the OpenAPI 3.1 document — all 179 operations across all 20 modules, generated
from the same declaration, with `x-zone`, `x-roles`, `x-permissions` and
`x-ownership` on every operation and 77 component schemas covering every payload
(no bare `{type: object}` anywhere). Served live at `GET /api/v1/openapi.json`; point Swagger UI, Redoc or
a client generator straight at it.

At runtime, `GET /api/v1/_blueprint` returns the same contract as JSON, filtered
to what the calling role can actually reach — that is what the PWA shells should
build navigation and route guards from, instead of hard-coding permissions
client-side. `GET /api/v1` is the platform index; `GET /api/v1/auth/roles` is the
raw RBAC contract.

> **Note on this delivery.** `npm install` has not been run here — the build
> sandbox had no registry access. Types were verified against stubbed module
> declarations, so import paths, export names, generics and all internal wiring
> are checked; the third-party type conformance check (`npm run typecheck`) is
> your first command after `npm install`.

---

## The shape of the thing

Three ideas carry the whole design.

**1. Roles are data, not code.** A role is a bundle of `resource:action`
permission strings plus a list of HQ zones and named business actions. Adding a
role, or widening one, is an edit to `config/roles.ts` — never a change to a
route handler. `config/permissions.ts` defines the vocabulary; the matcher
understands `*:*`, `resource:*` and `*:action`, and knows that `read` implies
`readOwn`.

**2. Every request passes three independent gates.** Zone, then permission, then
ownership:

```ts
itemRouter.patch('/:vendorId',
  authenticate,                                // who are you
  enterZone('BACK_OFFICE'),                    // allowed on this surface at all
  requirePermission('vendorProfile:update'),   // may you do this
  validate({ params: namedIdParam('vendorId'), body: updateVendorSchema }),
  requireOwnership(service, 'vendorId'),       // is this record yours
  controller.update)
```

**3. Ownership is enforced in the data layer, not remembered by handlers.**
`BaseService.scopeFor()` narrows every query by the actor's scope. A landlord
who requests "all properties" gets a query silently restricted to their own —
the controller above never has to think about it, so it cannot forget.

---

## The five HQ zones

| | Zone | Owns |
|---|---|---|
| **A** | Founder Command Center | Policy, regulations, system-wide approval, ad pricing and rotation rules, the audit log, regional oversight |
| **B** | HQ Executive Layer | KPI dashboards, analytics, system health, regional performance, ad campaign approval |
| **C** | Back Office (HR & Staff) | Coordinator/vendor/staff records, Ususu driver verification, commercial-client onboarding |
| **D** | Member Portal | A member's own profile, performance, residency, rent ledger, compliance, engagement |
| **E** | Public Portal | Public content, website stats, traffic and conversion metrics, ad placement and rotation |

Each zone declares what it oversees (`oversees`), what it can do
(`capabilities`), what is needed to enter (`entryPermissions`), and what it must
never see regardless of role (`dataFirewall`). `zoneLineOfSight()` walks the
oversight graph.

Zone isolation is asserted, not assumed — `npm run verify` checks that every
role's allowed and restricted zones partition all five exactly, that a tenant
cannot reach Back Office, that Back Office cannot reach the Founder Command
Center, and that every zone's entry permissions are satisfiable by at least one
role allowed into it (so no zone is unreachable by construction).

## The fifteen roles

`founder` · `hqExecutive` · `backOfficeStaff` · `coordinator` · `vendor` ·
`landlord` · `tenant` · `airbnbHost` · `hotelManager` · `resortManager` ·
`rentalCarCompany` · `driver` · `rider` · `advertiser` · `publicUser`

Each declares `accessScope` (`global → regional → zonal → organizational → own →
public`), `permissions`, `allowedZones`, `restrictedZones` and `allowedActions`.
A user may hold several roles: grants union, scope widens to the broadest held.

---

## Folder structure

```
backend/src/
├── config/
│   ├── apiBlueprint.ts   the declared API contract — 179 endpoints, Express-free
│   ├── openapi.ts        OpenAPI 3.1 builder over the blueprint
│   ├── openapiSchemas.ts component schemas (fragments mirror schemaFragments)
│   ├── env.ts            fail-fast environment contract (Zod)
│   ├── database.ts       connection, pooling, graceful disconnect, syncIndexes
│   ├── logger.ts         structured JSON logs in production
│   ├── permissions.ts    resource:action vocabulary + wildcard matcher
│   ├── roles.ts          the 15 roles — the RBAC source of truth
│   └── hqZones.ts        the 5 HQ zones + the 3 ad-serving zones
├── middleware/
│   ├── authenticate.ts   JWT sign/verify, claims → full actor
│   ├── authorize.ts      enterZone, requirePermission, requireOwnership,
│   │                     requireRole, requireAction, requireRegion
│   ├── validate.ts       Zod validation that replaces req parts with parsed output
│   ├── errorHandler.ts   ApiError → HTTP, Mongo errors translated, 404 handler
│   ├── requestContext.ts request id, access log, three rate-limit buckets
│   └── auditTrail.ts     append-only trail for every successful mutation
├── shared/
│   ├── ApiError.ts       typed error codes → status codes
│   ├── http.ts           asyncHandler, response envelopes, pagination
│   ├── BaseService.ts    one CRUD engine: scoping, filtering, soft delete
│   ├── BaseController.ts CRUD handlers generated from a service
│   ├── moduleFactory.ts  a fully-gated route surface from one config object
│   ├── schemaFragments.ts reusable field groups + their TypeScript shapes
│   └── validationFragments.ts reusable Zod pieces
├── models/               model registry (User, AuditLog + re-exports)
├── controllers/          controller factory registry
├── services/             service registry
├── routes/
│   ├── index.ts          the single mount point for the entire API
│   └── blueprintCheck.ts boot-time drift detector: declaration vs. mounted
├── modules/
│   ├── auth/             register, login, refresh, me, roles, appointment
│   ├── founder/          hqExecutive/  backOfficeStaff/     (HQ)
│   ├── hq/               zone directory, KPIs, system health, audit log
│   ├── landlord/  tenant/  coordinator/  vendor/  property/  (LRMC)
│   ├── airbnbHost/  hotel/  resort/  rentalCarCompany/       (commercial)
│   ├── driver/  rider/                                       (Ususu)
│   ├── advertising/      advertiser, ad, adEvent, adPolicy, rotation, engine
│   └── publicPortal/     content, traffic and conversion metrics
├── scripts/
│   ├── seed.ts           a working institution, idempotent
│   ├── verify.ts         5,735 dependency-free assertions
│   ├── blueprint.ts      renders docs/API-BLUEPRINT.md
│   └── openapi.ts        renders docs/openapi.{json,yaml}
├── types/express.d.ts    the authenticated actor on req
├── app.ts                helmet, CORS for all four domains, compression, mounts
└── server.ts             boot, keep-alive tuning, graceful shutdown
```

Each profile module holds `<name>.model.ts`, `<name>.validation.ts` and an
`index.ts` that calls `defineProfileModule`. Adding a sixteenth profile type is
about 120 lines and one line in `routes/index.ts`; there is no other place a
route can be registered, which is what keeps the permission surface auditable.

---

## Profile schemas

Fourteen profile collections plus `Property`, `User` and `AuditLog`. Every
profile is built from shared field groups — contact, identity, location,
emergency contact, verification, lifecycle, rating — that exist in two matched
forms: a Mongoose fragment (`contactFields`) and a TypeScript shape
(`ContactShape`) that interfaces `extends`. That pairing is deliberate: when a
fragment gains a field, every profile gains it in both the schema and the type,
so the two cannot drift apart.

Sensitive fields (`IDNumber`, `nationalID`, `driverLicenseNumber`,
`payoutAccountRef`, `taxIdentificationNumber`, `monthlyIncome`,
`verificationNotes`, `passwordHash`) are `select: false` **and** stripped in
`toJSON`. Two layers, because one gets forgotten.

Deletes are soft everywhere (`deletedAt` + `status: 'archived'`) — nothing in an
institutional ledger should vanish. `AuditLog` blocks updates and deletes at the
schema level.

Notable domain decisions:

- **Landlord** — `diasporaStatus` is load-bearing, not decorative: payout
  currency, statement cadence and escalation branch on it.
- **Driver** — licence, insurance and roadworthy expiry are first-class fields,
  so `GET /drivers/verification-queue` surfaces documents about to lapse rather
  than waiting for a complaint. A `dispatchable` virtual combines verification,
  status and document currency.
- **Rider** — deliberately the lightest profile: no ID, no verification. Signup
  friction is the enemy of a rideshare marketplace.
- **Property** — one collection serves residential rentals, short-lets, hotel
  rooms and resort villas via a polymorphic owner (`ownerKind` + `owner`), so
  maintenance, inspection and coordinator machinery is written once.
- **Rental car company** — `fleet` is embedded, not a separate collection: a
  vehicle has no meaning outside its owning company, and utilisation reporting
  always reads the whole fleet at once.

---

## The advertising system

Four collections and one pure-function rotation module.

`AdvertiserProfile` (the account, with credit and policy standing) ·
`Ad` (the creative and its serving rules) · `AdEvent` (the raw
impression/click stream) · `AdPolicy` (Founder-owned, versioned).

**Rotation** (`modules/advertising/rotation.ts`) is deliberately pure — no Mongo,
no Express, no clock it doesn't receive as an argument:

- **Weighted** — the advertiser's requested `rotationWeight`, adjusted by
  priority tier, category multiplier, daypart multiplier and pacing. The
  requested weight is never overwritten, so a policy change doesn't rewrite
  advertiser data.
- **Time-based** — `dayParts` (hours 0–23) and `daysOfWeek` per ad; hour
  multipliers per policy.
- **Category-based** — filter by category, per-category weight multipliers,
  Founder-set banned categories.
- **Zone-based** — `PUBLIC_PORTAL`, `MEMBER_PORTAL`, `USUSU_PORTAL`, each with
  its own slot count; `houseAdOnlyZones` for surfaces that take no paid ads.
- **Paced** — an ad behind schedule is boosted, one ahead is damped, clamped to
  [0.25×, 2×] so pacing nudges the draw without dominating it.
- **Share-capped** — no advertiser exceeds `maxAdvertiserSharePercent` of a
  zone's slots; displaced slots are refilled from the same weighted pool rather
  than left empty.
- **Deterministic when it needs to be** — selection is seeded on
  (session, zone, minute), so a server-rendered page and its client hydration
  agree about what is on screen, and tests can assert on distributions.

Impressions and clicks are deduped per session inside a configurable window via
a partial unique index, so a refresh-spamming visitor cannot inflate an
advertiser's count. An ad that hits its impression or click cap flips to
`exhausted` on the write that crossed the line, not on the next serve.

Reporting rolls the event stream up by ad, zone and category with CTR at each
level. An advertiser's report request is silently narrowed to their own campaigns
regardless of what they ask for.

Founder control lives at `/api/v1/ad-policy`: publishing a policy creates a new
version and deactivates the previous one. Policy is versioned, never edited —
an ad served last Tuesday must still be explicable by the policy in force last
Tuesday. `GET /ad-policy/preview-rotation?zone=…` dry-runs the engine and shows
what would serve, with each ad's effective weight.

---

## API surface — 178 endpoints

The complete reference is **[`docs/API-BLUEPRINT.md`](docs/API-BLUEPRINT.md)**,
generated from `src/config/apiBlueprint.ts`. What follows is the shape of it.

All routes sit under `API_PREFIX` (default `/api/v1`).

**The LRMC route convention: plural for collections, singular for items, with a
named id parameter.** Every profile collection gets the same surface from
`defineProfileModule`, registered in this order so `me` is never parsed as an id:

```
GET    /<singular>/me            own record    member zone, resource:readOwn
PATCH  /<singular>/me            own record    member zone, resource:updateOwn
GET    /<plural>                 list          admin zone,  resource:read
POST   /<plural>                 create        admin zone,  resource:create
GET    /<singular>/:xId          read          admin zone,  read + ownership
PATCH  /<singular>/:xId          update        admin zone,  update + ownership
PATCH  /<singular>/:xId/verify   verification  admin zone,  resource:verify
DELETE /<singular>/:xId          archive       admin zone,  resource:delete
POST   /<singular>/:xId/restore                admin zone,  resource:update
```

| Collection | Item |
|---|---|
| `/founders` | `/founder/:founderId` |
| `/landlords` | `/landlord/:landlordId` |
| `/tenants` | `/tenant/:tenantId` |
| `/coordinators` | `/coordinator/:coordinatorId` |
| `/vendors` | `/vendor/:vendorId` |
| `/drivers` | `/driver/:driverId` |
| `/riders` | `/rider/:riderId` |
| `/airbnb-hosts` | `/airbnb-host/:hostId` |
| `/hotels` | `/hotel/:hotelId` |
| `/resorts` | `/resort/:resortId` |
| `/rental-car-companies` | `/rental-car-company/:companyId` |
| `/ads` | `/ad/:adId` |
| `/advertisers` | `/advertiser/:advertiserId` |
| `/properties` | `/property/:propertyId` |
| `/hq-executives` | `/hq-executive/:executiveId` |
| `/staff-members` | `/staff-member/:staffId` |

Each profile module contributes **two mounts** — the plural collection router and
the singular item router. Controllers still read `req.params.id`, so the item
router aliases its named id onto `id` on the way in: one line in the factory
rather than a special case in nine handlers.

Note the split: the **admin zone** is where a collection is administered, the
**member zone** is where its owner reaches their own record. That is why a
landlord cannot call `GET /landlords/:id` even for their own profile — Back Office
owns that route — and uses `GET /landlords/me` instead.

**Beyond the generic surface**

| Endpoint | Zone | Reachable by |
|---|---|---|
| `GET /_blueprint` | — | anyone (filtered to the caller) |
| `POST /auth/register` · `login` · `refresh` | — | anyone |
| `GET /auth/me` · `POST /auth/change-password` | — | any authenticated |
| `PATCH /auth/user/:userId/roles` | A | founder |
| `GET /auth/roles` | — | anyone |
| `GET /hq/zones` · `/hq/zones/:zone` | — | any authenticated |
| `GET /hq/dashboard` · `/kpis` · `/system-health` · `/regions` | B | founder, hqExecutive |
| `GET /hq/command-center` · `/hq/audit-log` | A | founder |
| `GET /properties/public` | E | anyone |
| `GET /properties` · `POST` · `PATCH /property/:propertyId` · `DELETE` | D | owners + HQ |
| `PATCH /coordinator/:coordinatorId/assign-properties` | C | backOfficeStaff, founder |
| `PATCH /driver/me/online` | D | driver |
| `GET /drivers/verification-queue` | C | backOfficeStaff, founder |
| `POST /rental-car-company/:companyId/fleet` · `GET …/utilization` | D | the company, HQ |
| `GET /ads/serve` · `POST /ads/track/impression` · `/click` | — | anyone, rate-limited |
| `GET /ads/reports` | D | advertiser (own), HQ (all) |
| `GET /ads` · `POST` · `PATCH /ad/:adId` · `/submit` · `/status` | D | advertiser, founder |
| `PATCH /ad/:adId/review` | B | founder, hqExecutive |
| `GET/POST /ad-policy` · `/history` · `/preview-rotation` · `PATCH /ad-policy/advertiser/:advertiserId/terms` | A | founder |
| `GET /public/content` · `/content/:slug` · `POST /public/track` | E | anyone |
| `GET /public/metrics` | E | publicUser, HQ |
| `/public/admin/content` (CRUD + publish) | E | staff with `publicContent:*` |
| `GET /healthz` | — | unauthenticated probe |

Responses are always `{ success, data, meta? }` or
`{ success: false, error: { code, message, details } }`.

## Verification

`npm run verify` runs 5,735 assertions with no database and no server, in about a
second:

- **Role matrix integrity** — all 15 roles defined; allowed and restricted zones
  partition all 5 exactly and are disjoint; every permission string uses a real
  resource and action; every verifiable role has a profile model.
- **Permission matcher** — founder wildcard reaches everything; a tenant cannot
  read another tenant, author policy, or read the rent ledger; Back Office can
  verify drivers but cannot touch policy, ad pricing or the audit log; an
  advertiser cannot approve their own ad; `read` implies `readOwn` but not the
  reverse; a landlord-and-driver dual role keeps both grant sets and gains no HQ
  powers.
- **Zone isolation** — seven role/zone expectation sets; no zone is unreachable
  by construction; multi-role scope widening.
- **Ad rotation** — seeded determinism; a 70/20/10 weighting lands within 2
  points over 30,000 draws; no duplicate or over-draw; zero weights still fill
  slots rather than serving blanks; pacing boosts behind/damps ahead and stays
  inside its clamp; tier, category and daypart multipliers; ten eligibility
  rules; the advertiser share cap holds slot count, respects the limit, refills
  from other advertisers, never duplicates, and degrades safely when there is no
  alternative inventory; slot resolution and CTR edge cases.

- **API contract** — every declared path unique per method; every permission
  string real; **no endpoint unreachable by every role** (a dead route hides
  mistakes); Zone A founder-only and Zone B HQ-only, *computed from the role
  matrix* rather than asserted in prose; no member-facing role reaching a Back
  Office route; every public endpoint genuinely reachable anonymously; every
  `/me` route self-scoped; **no literal path shadowed by an earlier `:id` route**;
  every profile collection exposing its full surface with declared ownership
  wiring; **the LRMC naming convention itself** — collection segment plural, item
  segment singular, id parameter named (never a bare `:id`), and `/me` declared
  ahead of the id route on every collection.

The suite was mutation-tested: breaking the pacing clamp and the tier boost
produced exactly the three expected failures, so it catches regressions rather
than restating the implementation.

The blueprint assertions have already earned their place. They caught a real
defect on their first run: `enterZone('PUBLIC_PORTAL')` on the public read routes
meant any *signed-in* member — tenant, landlord, driver — got a `403` browsing the
public property listings or marketing pages, because `PUBLIC_PORTAL` was in their
`restrictedZones`. The Public Portal is the open surface by definition, so it is
now universal across all fifteen roles, with the administrative capability inside
it still gated by `publicContent:*` / `publicMetrics:read`.

---

## Deployment (two C4 servers, Ghana)

- **Domain hierarchy.** One API behind four public faces, declared in the
  OpenAPI `servers` list and mirrored in `CORS_ORIGINS`:

  | Domain | Face |
  |---|---|
  | `api.lrmconsortium.africa` | LRMC HQ — Institutional Command Center |
  | `api.lrmconsortium.com` | LRMC Public Portal |
  | `api.africalrmc.com` | LRMC PR & Communications |
  | `api.africaususu.com` | Ususu Rideshare Platform |
  | `localhost:3000` | Local development |

  HQ leads the list because client generators take the first entry as the default
  base URL. `npm run verify` asserts the list, the ordering, that every entry
  carries the API prefix, and that localhost is the only non-TLS server.
- `trust proxy` is on, so client IPs come from `X-Forwarded-For` behind the
  reverse proxy.
- Keep-alive is set to 65s, just above a typical proxy idle timeout, so the
  proxy closes connections first.
- `SIGTERM`/`SIGINT` drain in-flight requests then close Mongo, with a 15s
  hard stop — a rolling deploy of one server at a time never cuts a request
  mid-transaction.
- `autoIndex` is off in production. Call `syncIndexes()` from the deploy
  pipeline instead of paying for index builds at boot.
- Three rate-limit buckets: global, tight on credentials, generous on ad serving.
- `GET /healthz` for liveness; `GET /api/v1/hq/system-health` for the real thing.

---

## What is deliberately not here yet

The permission vocabulary already declares `lease`, `rentPayment`,
`maintenanceRequest`, `ride` and `earnings`, and roles already carry grants for
them — but their modules are not written. That is the intended next layer, and
the vocabulary is in place so those modules slot in without touching the RBAC
core:

1. **Rent & leases** — lease documents, rent ledger, receipts, arrears, landlord
   statements and payouts.
2. **Maintenance** — request lifecycle, vendor assignment and quoting, photo
   evidence, spend approval, SLA tracking.
3. **Ususu rides** — ride lifecycle, fare calculation, driver/rider matching by
   `2dsphere` proximity, earnings and payouts.
4. **Notifications** — WhatsApp and SMS are the real channels here, not email.
   `preferredContactMethod` already defaults to WhatsApp on every profile.
5. **File storage** — profile photos, ID scans and ad creatives are string URLs
   today; they want signed uploads to object storage, with ID scans handled under
   the same firewall rules the schemas already declare.
6. **Frontends** — the PWA shells for the founder console, HQ dashboard, back
   office, member portal, Ususu app and public sites. `GET /auth/me` and
   `GET /auth/roles` exist precisely so those can be built against the contract
   rather than hard-coding permissions.
