# LRMC — pre-deployment audit

**Verdict: do not deploy.** Nine blocking defects, all confirmed by reading the source.
Three of them disclose other people's data to any signed-in member. Two let one member
take money from another. One plants a published password in the production database.

The platform's 15,277 backend assertions, 4,020 SDK assertions and 1,262 browser
assertions are all green, and none of them is wrong. Every defect below lives in the
space those assertions cannot reach: code that only runs with a real database, a real
browser, two processes, or a second concurrent request.

---

## How much of the platform this covers

Eleven audit lenses were commissioned. **Seven completed. Four did not run** — the
session hit its usage limit partway through. The four that never ran are:

| Lens | What it would have covered |
|---|---|
| availability | unbounded queries, N+1, per-process state across two servers, floating promises |
| fairness | the self-dealing and null-vs-zero rules, applied across all 38 modules |
| reachability | routes mounted but undeclared; non-launch modules answerable by a real token |
| privacy | small-n re-identification in aggregates, audit-log contents, notification payloads |

The adversarial refutation pass — a second reviewer per finding, trying to disprove it —
**also did not run**. In its place, I read the source myself for every blocking finding.
All nine are confirmed with file, line and quoted code. The high and medium findings
carry the evidence the lens quoted but have **not** been independently refuted, so treat
them as strong leads rather than settled facts.

**This audit is therefore incomplete in a known direction.** Availability under real load,
scoping consistency across all 38 modules, and undeclared route surface are unexamined.

---

# BLOCKING — nine defects

## B1. `GET /payments/:userId/history` returns the entire platform ledger

`backend/src/modules/payment/index.ts:209` · `backend/src/shared/BaseService.ts:101`

`historyFilter()` builds the authorisation clause correctly:

```ts
const sides = { $or: [{ payer: { $in: profileIds } }, { payee: { $in: profileIds } }] };
if (scope === 'all') return { deletedAt: null, ...sides };
return { deletedAt: null, recordedBy: actorId, ...sides };
```

It is handed to `paymentService.list({ filters })`. `BaseService.buildFilter` keeps a
filter key **only if it appears in `filterableFields`**, which for payments is
`['kind','status','currency','subject','subjectKind','payer','payee']`:

```ts
if (value === undefined || value === '' || !allowed.includes(key)) continue;
```

`$or` is not in that list. Neither is `recordedBy`. Both are silently dropped. And
`list()` is called with **no actor**, so `scopeFor(undefined)` returns `{}` and adds
nothing back. The filter that reaches Mongo is `{ deletedAt: null }`.

**Failure:** any tenant signs in, opens the Payments page, and receives the platform's
whole payment ledger — payer, payee, amount, currency, reference, provider — 20 rows a
page, up to 100 with `?limit=100`.

**The tell:** `/summary`, ten lines further down, builds the same filter and calls
`Payment.find(filters)` directly. It is correct. The two endpoints disagree about who you
are, and only the one routed through the generic list layer is wrong.

## B2. The same defect leaks every lease and every maintenance request

`backend/src/modules/lease/index.ts:684` · `backend/src/modules/maintenance/index.ts:667`

```ts
filters: { $or: [{ tenant: { $in: profileIds } }, { landlord: { $in: profileIds } }] },
```

`leaseService.filterableFields` is `['status','property','tenant','landlord','coordinator','currency']`.
No `$or`. Dropped. Same for maintenance. Same missing actor.

Note that `lease/index.ts:467` and `:480` pass `{ tenant: id }` and `{ landlord: id }` —
both *are* in the allowlist, so those two endpoints are fine. That is what makes this so
hard to see: the pattern works three times and fails three times, in the same file.

**Fix for B1 and B2 together:** a server-built authorisation filter must never pass
through a client-facing allowlist. Add a distinct parameter to `BaseService.list` for
server-supplied filters that bypasses `filterableFields`, and make the allowlist apply
only to `params.filters` that came from the query string. Then sweep for every other
call site that passes a computed filter.

## B3. Three of four ride transitions have no ownership gate

`backend/src/modules/ride/index.ts:180, 195, 263`

`/accept` carries `requirePermission('ride:update', 'ride:readOwn')` and resolves the
caller's own driver profile. `/start`, `/complete` and `/cancel` carry only
`requirePermission('ride:update')` — and three roles hold that grant
(`config/roles.ts:693, 697, 733`), including both driver and rider.

**Failure:** any Ususu member who can name a `rideId` can complete somebody else's trip
and **declare the fare from their own request body**, writing a `status: 'succeeded'`
Payment row. `{"finalFare": 1}` mid-journey robs the driver; `{"finalFare": 50000}` bills
a rider who never agreed to it. A rider can `/cancel` a stranger's trip and put the
cancellation on that rider's record.

## B4. `GET /marketplace/overview` gives the whole order book to anyone without a marketplace profile

`backend/src/modules/marketplace/index.ts:1066`

```ts
const scope: Record<string, unknown> = { deletedAt: null };
if (merchant) scope.merchant = merchant._id;
else if (customer) scope.customer = customer._id;
const orders = await Order.find(scope).sort('-createdAt').limit(500).lean().exec();
```

Neither branch taken → `{ deletedAt: null }` → every order on the platform. This is the
empty-filter degradation the platform forbids everywhere else; `GET /orders` at line 712
gets it right and throws `forbidden('You have no marketplace account')`.

It is not hypothetical. `merchant` and `customer` are in `SELF_REGISTERABLE_ROLES`, but
`PROFILE_FACTORIES` in `auth.service.ts` has no entry for either — so **every
self-registered marketplace account lands permanently in the unscoped branch**.

## B5. An order reaches `paid` on a client-supplied string

`backend/src/modules/marketplace/index.ts:774`

```ts
const { paymentRef } = req.body as { paymentRef: string };
const updated = await transition(order, 'paid', 'buyer', req.actor!.userId,
  { paidAt: now, paymentRef }, 'Payment captured');
```

`moneyProvider` appears **zero times** in the marketplace module. No capture, no webhook,
no amount reconciliation. Any buyer posts any string and the order moves into escrow, and
stock comes down. The invariant the payment module states in its own header — a client
never asserts that money moved — holds in payments and is absent here.

## B6. The FAC lockout stops working after 200 attempts, permanently

`backend/src/modules/fac/index.ts:145`

```ts
const rows = await FacAttempt.find({ actor: actorId })
  .sort('at')      // oldest first
  .limit(200)
```

`.sort('at')` ascending with `.limit(200)` reads the **oldest** 200 rows. `FacAttempt` has
no TTL, so once an actor accumulates 200 rows the window never advances again and the
lockout arithmetic runs forever over ancient history.

**Failure:** an attacker with 200 recorded attempts can brute-force the six-digit Founder
Authorisation Code without ever being locked out. This is the credential guarding Zone A.

## B7. `POST /auth/refresh` never revokes the token it consumed

`backend/src/modules/auth/auth.service.ts:336`

`refresh` *reads* the denylist (`RevokedToken.findOne({ jti })`, line 343) and never
writes to it — the only write in the module is at line 452, inside `signOut`. So the
presented refresh token stays valid for its full 30 days and can be redeemed an unlimited
number of times, while each redemption mints an additional independent 30-day token.

**Failure:** sign-out revokes exactly one `jti` — the one the user presented. Any session
that has refreshed even once cannot be ended. A stolen refresh token is a permanent
account, and the member has no way to close it.

## B8. Every coordinator and back-office sign-in lands on a 404

`frontend/assets/js/auth.js:44`

```js
['backOfficeStaff', '/staff/index.html'],
['coordinator',     '/staff/index.html'],
```

`frontend/staff/` is an empty directory. There is no staff page in the repository, and it
is not on `PLANNED_PAGES` either. nginx's `try_files … =404` does exactly what it should.

**Failure:** on launch day, every coordinator — the people who run the platform — signs in
successfully and is sent to a page that does not exist. There is no route from a
successful login to any working surface for the two staff roles.

## B9. `npm run seed` will plant a published password in production

`backend/src/scripts/seed.ts:38`

```ts
const DEFAULT_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
```

No `NODE_ENV` or `isProduction` guard anywhere in the file. It connects to `env.MONGO_URI`
— which on the C4 box is production — and creates a founder account plus one active,
pre-verified account per role, all sharing that password, which is committed to the
repository and printed to the console on completion.

One command run in the wrong shell on deployment day hands the platform to anyone who has
read the repo.

---

# Deployment blockers I found outside the code

These are not defects in the software. They are reasons the software will not run.

**D1. The port does not match.** `backend/.env.example` sets `PORT=3000`.
`frontend/deploy/nginx.conf` proxies to `127.0.0.1:4000` in four places. Whichever is
right, the other is a 502 on every API call.

**D2. One database, two servers.** `MONGO_URI=mongodb://127.0.0.1:27017/lrmconsortium` is
a local single-node mongod. Deployed to two C4 servers as described, that is **two
separate databases** — each holding half the tenancies, neither aware of the other, and a
member's session working or failing depending on which server the load balancer picked.
It also means no replica set, so no transactions (which several fixes above want) and no
failover. This needs deciding before anything else.

**D3. There is no deployment.** No Dockerfile, no compose file, no systemd unit, no PM2
config, no CI, no migration tooling, no backup script, no runbook. `npm run build && node
dist/server.js` in a terminal is the entire deployment story, and nothing restarts the
process when the box reboots.

**D4. `npm run build` has never been run here.** The suites run through `tsx`, which
strips types without fully checking them. The production build path — `tsc -p
tsconfig.json` with `strict` and `noUncheckedIndexedAccess` — is unproven in this sandbox
because `@types/node` is trimmed. Run it on a real machine before you trust it.

---

# HIGH — reported with evidence, not independently refuted

Thirteen findings. Each names a file and line and quotes code, but the refutation pass
did not run, so confirm before acting.

1. **Regional scope does not exist.** `BaseService.scopeFor` (`shared/BaseService.ts:79`)
   treats `'regional'` the same as `'global'` and returns `{}`. `requireRegion` is
   exported and mounted on **zero** routes. `actor.regions` is read nowhere outside stats.
   A coordinator in Serrekunda sees the whole country — including, per the Week 4 doc, the
   Ususu registers that were specifically supposed to be confined.
2. **Every profile update schema accepts `status`** (`shared/validationFragments.ts:68`).
   `lifecycleCreate` is spread into all nineteen profile schemas and `toUpdateSchema`
   removes nothing, so a suspended driver can `PATCH /driver/me` themselves back to
   active.
3. **A merchant can set their own LRMC commission to 0%**
   (`marketplace/marketplace.validation.ts:35`). The comment says only Back Office may;
   no router enforces it.
4. **`?desk=` overwrites the role-derived reviewer allowlist** on the document queue
   (`document/index.ts:834`) — the restriction is computed and then replaced by the
   client's value on the next line.
5. **Any marketplace member can list every merchant's unpublished drafts**
   (`marketplace/index.ts:347`).
6. **Payout batch build is a read-then-write with no lock** (`payout/index.ts:107`). Two
   overlapping builds claim the same ledger rows and pay twice.
7. **Recording rent is an unguarded read-modify-write** (`lease/index.ts:238`). Two
   concurrent payments on one lease and the second overwrites the first. Money vanishes.
8. **The portal's only rent-recording path never touches the lease.** `POST
   /payments/record` writes the ledger row alone; `POST /lease/:leaseId/payments` writes
   the row *and* rolls arrears forward — and the browser SDK has no binding for it
   (`assets/js/sdk.js:350`). Arrears will never clear for anyone.
9. **Marketplace escrow releases with no ledger row**, and no payout kind exists that can
   pay a merchant (`marketplace/index.ts:902`). Money is held and never settled.
10. **Login enumerates accounts and can be used to lock anyone out**
    (`auth/auth.service.ts:308`). Lockout is keyed on an attacker-supplied email, checked
    before the password comparison, and nothing anywhere clears `lockedUntil`.
11. **`changePassword` invalidates nothing** (`auth/auth.service.ts:372`).
    `passwordChangedAt` is written and never read. The remediation for a stolen credential
    leaves the thief signed in.
12. **Viewings and applications compare a profile id to a user id**
    (`viewing/index.ts:154`, `application/index.ts:214`). `property.owner` is a
    `LandlordProfile._id` stored in a field declared `ref: 'User'` and matched against
    `actor.userId`. They can never be equal, so every landlord and coordinator sees an
    empty lettings pipeline.
13. **The `?next=` guard is bypassed by a tab or newline** (`public/login.html:211`). The
    hand-written checks run before the URL parser, which strips those characters. Open
    redirect on LRMC's own domain. Fix by parsing instead of scanning:
    `new URL(raw, location.origin).origin === location.origin`.

Also high, and worth grouping: **`POST /security/errors` answers 401 to everyone**
(`security/index.ts:194`) because `optionalAuthenticate` is missing before
`enterZone('PUBLIC_PORTAL')`. Three separate lenses found this independently. The entire
Week 5 error-capture subsystem is inert on exactly the public pages it was built for — and
the contract, the OpenAPI document, the SDK and the suite all say it is anonymous.

**The HQ surface does not work at all.** Four of five Command Center panels bind to
response fields the API has never produced (`hq/index.html:377`), and two panels on the
HQ *Executive* page call Zone A founder-only endpoints (`hq/index.html:198`), so an
executive sees "Could not load this panel" on the headline tiles. Separately, **Zone A
cannot be entered from a browser at all**: the clearance dialog (`assets/js/ui.js:265`)
asks for the six-digit code and contains no input field, and nothing in the frontend
calls `fac.verify`.

**Third-party JavaScript is unpinned in production** (`hq/index.html:68` and 32 other
pages): htmx and lucide load from unpkg with no SRI and no CSP, while access and 30-day
refresh tokens sit in sessionStorage. The pinning machinery exists and was only ever
wired up for Alpine, on the member pages.

---

# MEDIUM — worth fixing, not gating

- **nginx discards inherited security headers.** `add_header` replaces rather than merges,
  so every `/api/` and `/assets/` response ships without `nosniff`, HSTS or
  `X-Frame-Options` (`deploy/nginx.conf:170`). Conversely `X-Robots-Tag: noindex` is
  inherited by `location /` and stamped on the **public marketing site**
  (`deploy/nginx.conf:112`) — LRMC will not appear in search results.
- **Ride completion writes the Payment before the guarded status update**
  (`ride/index.ts:225`), so a lost race leaves an orphan `succeeded` fare row behind.
- **`Merchant.payoutAccountRef` is missing the `select: false`** that Landlord and Driver
  both carry (`marketplace/marketplace.model.ts:86`) — and `BaseService.list` uses
  `.lean()`, which bypasses the `toJSON` redaction that would have been its only other
  defence.
- **Unique indexes ignore `deletedAt`** (`landlord/landlord.model.ts:74` and others), so
  soft-deleting a record permanently blocks re-creating it with the same email.
- **The error-intake bound is keyed on a client-chosen header**
  (`security/index.ts:204`): vary the User-Agent and the 20-per-10-minutes cap resets
  every request. The counter map is also never pruned.
- **CORS is the one secret with no production refusal** (`config/env.ts:40`). Unset,
  `origin: true` reflects any origin with credentials, while `FAC_PEPPER` and the JWT
  secrets both refuse to boot.

---

# Go / no-go

## Must fix before any deployment

| | Finding | Why it gates |
|---|---|---|
| B1 | payments history returns the whole ledger | every member reads every member's money |
| B2 | same for leases and maintenance | every member reads every tenancy |
| B4 | marketplace overview unscoped | a stranger reads the order book |
| B3 | ride transitions have no owner check | one member takes another's fare |
| B5 | orders paid on a client string | goods ship for money that never arrived |
| B6 | FAC lockout stops after 200 attempts | Zone A is brute-forceable |
| B7 | refresh never revokes | sign-out does not sign out |
| B8 | staff sign-in 404s | coordinators cannot use the platform |
| B9 | seed has no production guard | one command hands over the platform |
| D1 | port mismatch | nothing works |
| D2 | single-node Mongo on two servers | half the data on each box |

## Must decide before deployment day

- **D2 again** — one replica set both servers share, or one app server for launch. This
  changes what else is possible (transactions for B2, payout locking, session state).
- **D3** — how the process starts, restarts, and is rolled back.
- Whether the **HQ surface and Zone A** launch at all. Neither currently works end to end,
  and neither is needed to serve a tenant in Banjul. Cutting them from day one is a
  legitimate answer and a much smaller job than fixing them.
- Whether the **non-launch modules** (hotel, resort, rentalCarCompany, airbnbHost,
  advertising, commercialClient) are mounted. The reachability lens never ran, so nobody
  has checked what they expose. Unmounting them until they are needed removes the question.

## Safe to launch with, fixed after

Everything in MEDIUM, plus the frontend polish items. None of them costs a member money or
shows them another person's data.

## What is not covered by this audit

Availability under real load, the fairness rules across all 38 modules, undeclared route
surface, and privacy re-identification. Four lenses, unrun. **Run them before you treat
this document as a clean bill of health for anything other than what it names.**

---

## One observation about the shape of all this

Nearly every blocking defect is in a module written *after* the pattern it should have
followed. The four gates are right, and rides skip the fourth. `DENY_ALL` is right, and
marketplace re-implements it as a bare object. The payment module's own header says a
client never asserts that money moved, and marketplace lets one. `optionalAuthenticate`
sits in front of every public-portal route, and the security module — the newest — omits
it.

The rules are good. What is missing is anything that makes a *new* module obey them. The
suites assert each rule where it was written, so the rule is proved and its absence
elsewhere is invisible. Two assertions that sweep rather than check — *every* route
declared `ownership: 'scoped'` actually mounts `requireOwnership`, and *every* route in
`PUBLIC_PORTAL` mounts an authenticate variant — would have caught four of these nine
before they were ever committed.
