# LRMC — remediation status, and the completed audit

**Supersedes the "How much of the platform this covers" section of
`pre-deployment-audit.md`.** All eleven lenses have now run. That document's findings
stand; its statement that four lenses were unrun does not.

Backend `npm run verify`: **15,329 checks green** (15,266 → 15,329).
SDK: 4,020 green. Contract: 362 endpoints, 269 paths, 0 shadowed, 0 dangling `$ref`s.
**37 mutations run, 37 caught** — after fixing three survivors.

---

## Fixed, with assertions and mutation tests

| | Defect | What closed it |
|---|---|---|
| B1/B2 | Payments, leases and maintenance returned whole collections | `BaseService.list` grew a `serverFilters` door that bypasses the client allowlist; clauses `$and`-composed, never spread; an empty server filter throws |
| B3 | Three ride transitions had no ownership gate | Party resolved from the ride via both profiles; `/start` and `/complete` driver-only; `/cancel` either party, side read from the ride |
| B4 | Marketplace overview unscoped | Refusal for callers with no marketplace account, **plus** the missing `merchant`/`customer` profile factories that made that branch reachable |
| B6 | FAC lockout froze after 200 attempts | `.sort('-at')` with `rows.reverse()` |
| B7 | Refresh never revoked | Rotation: presented token revoked before its replacement is issued, recorded as `rotated` |
| B9 | Seed could run against production | Two module-scope refusals; no default password |
| D1 | Port mismatch | Aligned to 4000, with a cross-file assertion that nginx and the app agree |
| **NEW** | Phantom `Property.landlord` leaked every maintenance request | `owner` + `ownerKind`, and a schema-aware sweep over every `Property` query and select |
| **NEW** | No index existed in production | `npm run migrate`, and production refuses to boot without them |

### Things the fixes turned up that the audit had not

- **A seventh `serverFilters` call site.** The sweep caught `ride/index.ts` on its first
  run. It was not leaking — `region` happens to be allowlisted. That is the whole problem:
  it worked by coincidence, and the same coincidence made `document/me` look fine while
  three siblings leaked.
- **`?expiringWithinDays=` never worked.** `expiresOn` is not allowlisted, so the range was
  dropped and an executive asking what lapses this month was answered with every document
  on the platform — which reads as "nothing is urgent".
- **`/cancel` read the canceller's side from `actor.roles`.** Anyone holding both roles who
  cancelled a ride *they had booked as a passenger* was recorded as a driver cancellation,
  against a stranger's driver record.
- **`/complete` accepted `currency` from the body.** A driver could re-denominate a fare
  already quoted, and the platform holds no exchange rate with which to notice.
- **Two more phantom selects**, found by the new sweep: `maintenance/index.ts` selected
  `coordinator` and `landlord`, neither a path on `Property`. Every request raised through
  that route was created with **no coordinator assigned** — it went into the queue and was
  routed to nobody. The sibling route ninety lines up had the right name all along.

### Three mutation survivors, and what they taught

1. A source assertion for `ApiError.internal` passed against a mutation that disabled the
   throw, because the identifier was still in the file. Replaced with a **probe that runs
   `buildFilter`** against a stub model — no database needed, since it never touches one.
2. and 3. Two assertions passed against mutations because **the line they grepped for was
   quoted in a comment**. This codebase quotes code in its prose, which is why the comments
   are worth reading and why source-greps are unreliable. Comments are now stripped before
   any source assertion in those sections. Same trap as the pricing placeholders and the
   CDN sweep — third and fourth instances.

---

## New blocking defects, from the four lenses that had not run

**N1. A partially-settled payout batch strands its lines forever.**
`payout/index.ts:255`. One failed transfer among many sets the batch to
`partiallySettled`, which no route can settle, cancel or retry — and `partiallySettled` is
absent from the `$nin: ['cancelled','failed']` claim filter, so the failed line's source
payments count as spent forever. A landlord whose mobile-money number was wrong cannot be
paid through the API at all; it needs a hand-written Mongo update. **Not yet fixed.**

**N2. No index existed in production.** `config/database.ts:17`. Fixed — see above. Worth
restating why it mattered: this codebase uses unique indexes as concurrency control, not
as tuning. The ususu period key, payment idempotency, `jti` uniqueness, and both TTL
indexes — including the ninety-day error-report expiry the security module presents to
members as a privacy commitment — were all inert.

---

## The largest finding, and it is not on either blocking list

**Eight findings across three lenses are one defect: profile ids stored in User-typed
fields, and User ids compared against profile-id columns.**

- `application/index.ts:84, 113, 214` — an application's `landlord` and `coordinator` are
  written from `property.owner` and `property.assignedCoordinator` (profile ids) into
  fields declared `ref: 'User'`, then compared to `actor.userId`. **Every landlord is
  403'd off their own property and every coordinator queue is permanently empty.**
- `application/index.ts:113` — applicant scoring queries `Payment.payer` and `Lease.tenant`
  (profile ids) with a User id, so both return `[]`. **No application can ever be
  recommended.**
- `viewing/index.ts:154` — the same, for the viewings pipeline.
- `lease/index.ts:256` and three other dispatch sites — notifications addressed to profile
  ids where `Notification.recipient` is a User reference. **Nobody ever receives a rent
  reminder, a receipt, or an SLA escalation.**
- `stats/statsScope.ts:105` — member-facing stats narrow on `actor.userId` against
  profile-id columns. **Four of the five member stats endpoints read zero for everybody.**

Individually these read as separate HIGH bugs. Together they mean **large parts of the
platform return 200 and do nothing** — empty lists, zero tiles, unsent notifications, no
recommendations — while every suite passes, because every suite asserts the rules and none
of them owns a database in which the two id spaces could fail to meet.

I have deliberately **not** fixed this cluster. It needs one decision made once — which
id space each cross-module reference speaks — and applied everywhere, and getting it wrong
silently is exactly how it arrived. It is the largest single piece of work outstanding and
it should be done deliberately, not patched site by site.

---

## Other new findings worth naming

- **`/dispute/:id/resolve` does not exist.** The contract, the OpenAPI document, the SDK
  and the browser client all point at it; the router mounts `/disputes/:id/resolve`
  (`apiBlueprint.ts:2472`). Dispute resolution is unreachable from any generated client.
- **Rental car fleet endpoints declare `ownership: 'scoped'` and mount no ownership gate**
  (`rentalCarCompany/index.ts:39`). Any company can write into another's fleet. Same shape
  as B3, in a module nobody is launching — which is an argument for not mounting it.
- **Two marketplace endpoints are mounted and undeclared** (`marketplace/index.ts:122`):
  `PATCH /merchant/:id/sellers` and `PATCH /customer/:id/buyers` answer on the running app
  and appear in nothing generated, documented or swept.
- **`POST /fac/verify` declares the tighter auth rate-limit bucket and never mounts it**
  (`apiBlueprint.ts:3342`). The credential guarding Zone A is behind the general limiter.
- **Marketplace stock uses `$set` from a stale read beside an atomic `$inc`** on the field
  next to it (`marketplace/index.ts:790`).
- **The access log writes full query strings** (`requestContext.ts:22`), so member names and
  phone numbers land in production stdout — while `redact` and `pathTemplate` are applied
  scrupulously to browser-reported errors.
- **Rent-reminder and SLA runs are non-idempotent N+1 loops** that outlive nginx's 30s
  timeout (`lease/index.ts:367`), so the operator's retry double-notifies every tenant.
- **Shutdown disconnects Mongo in the same tick** the last audit writes are issued
  (`server.ts:43`).

---

## Updated go / no-go

### Fixed and provable
B1, B2, B3, B4, B6, B7, B9, D1, plus production indexes and the phantom-path cluster in
maintenance and lease.

### Still blocking
- **B5** — orders reach `paid` on a client string. Stripe makes this real work, not a
  patch: `moneyProvider` needs a capture path, `PAYMENT_KINDS` an order kind, and merchant
  payouts want Connect.
- **B8** — coordinators and back-office sign in to a 404.
- **N1** — partially-settled payout batches strand money.
- **The id-space cluster** — not one defect but the reason large parts of the platform
  silently do nothing.
- **D2** — one database or two. Everything about concurrency depends on the answer.
- **D3** — nothing starts, restarts or rolls back the process.

### Decide, don't fix
- **Unmount what is not launching.** Hotel, resort, rental car, Airbnb host, advertising,
  commercial client. The reachability lens found real defects in surface nobody is
  launching; not mounting it removes the question and shrinks the audit surface.
- **The US pilot.** Every launch constant is Gambian and asserted — `LAUNCH_COUNTRY`,
  `LAUNCH_CURRENCY = 'GMD'`, `+220`. A US pilot needs them changed deliberately. If the
  pilot runs *beside* the Gambia launch rather than replacing it, that is two deployments,
  not one config.

### For counsel, not code
US security-deposit handling is state-regulated — escrow, interest, return timelines — and
LRMC holds deposits. Ususu pools members' money, which in the US can implicate money
transmission. Both are cheap to ask about now.

---

## One more time, because it is the pattern

Every defect fixed today was invisible to a suite that asserts rules where they were
written. The rules are right. What was missing is anything that sweeps.

Four of the new assertions are sweeps rather than checks — every module's filter door,
every `Property` query against the real schema, every self-registerable role against its
profile factory, nginx's upstream against the app's port. Three of them found something on
their first run that no one had reported. That ratio is the argument for writing more of
them: **every rule this platform states should have one assertion that proves it where it
was written, and one that looks for where it is missing.**
