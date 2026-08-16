# LRMC + Ususu — API Blueprint

> **Generated file.** Produced by `npm run blueprint` from
> `src/config/apiBlueprint.ts`. Do not edit by hand — edit the declaration.
> The role columns are computed from `src/config/roles.ts`, so they reflect the
> RBAC configuration rather than a hand-maintained table.

All paths are relative to `API_PREFIX` (default `/api/v1`).

**363 endpoints** — 141 from the generic profile surface across 16 collections, 222 hand-mounted.

---

## How to read this

Every authenticated request passes three independent gates, in order:

1. **Zone** — `enterZone(...)`. Is this actor allowed on this surface at all?
   Checked against the role's `restrictedZones`, then against the zone's own
   `entryPermissions`. Failure is `403 ZONE_RESTRICTED`.
2. **Permission** — `requirePermission(...)`. Any *one* of the listed grants is
   sufficient. Failure is `403 FORBIDDEN`.
3. **Ownership** — `requireOwnership(service)`. For actors whose scope is `own`
   or `organizational`, the record must belong to them; wider scopes pass
   straight through. Failure is `403 FORBIDDEN`.

The **Own** column says which ownership rule applies:

| Value | Meaning |
|---|---|
| `—` | No narrowing. The resource is not owned by anyone. |
| `scoped` | `BaseService.scopeFor()` narrows the query; `requireOwnership` guards `:id`. |
| `self` | The record is resolved from the token, never from the URL. |

### Response envelope

```jsonc
// success
{ "success": true, "data": { /* … */ } }

// success, paginated
{ "success": true, "data": [ /* … */ ],
  "meta": { "page": 1, "limit": 20, "total": 84, "totalPages": 5,
            "hasNext": true, "hasPrev": false } }

// failure
{ "success": false,
  "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed",
             "details": [ { "field": "email", "message": "Invalid email address" } ] } }
```

`code` is one of `BAD_REQUEST` `VALIDATION_FAILED` `UNAUTHENTICATED` `FORBIDDEN`
`ZONE_RESTRICTED` `NOT_FOUND` `CONFLICT` `DUPLICATE_KEY` `UNPROCESSABLE`
`RATE_LIMITED` `POLICY_VIOLATION` `INTERNAL`.

### Role abbreviations

| | | | | |
|---|---|---|---|---|
| `FN` founder | `EX` hqExecutive | `BO` backOfficeStaff | `CO` coordinator | `VE` vendor |
| `LL` landlord | `TE` tenant | `AH` airbnbHost | `HO` hotelManager | `RE` resortManager |
| `RC` rentalCarCompany | `DR` driver | `RI` rider | `AD` advertiser | `ME` merchant |
| `SE` seller | `CU` customer | `BU` buyer | `PU` publicUser |  |

---

## The five HQ zones

| | Zone | Entry requires | Owns |
|---|---|---|---|
| **A** | Founder Command Center | `policy:*` | Constitutional layer. Writes rules, regulations and policy; approves system-wide change; owns ad pricing and rotation policy; oversees every region and service. |
| **B** | HQ Executive Layer | `analytics:read` | Sees the whole institution and steers it: high-level dashboards, KPIs, analytics and system health. Reads into Back Office, Member Portal and public metrics. |
| **C** | Back Office (HR & Staff) | `coordinatorProfile:read`, `vendorProfile:read` | Operational engine room. Owns coordinator, vendor and staff records, Ususu driver verification, and commercial-client onboarding for Airbnb hosts, hotels, resorts and rental car companies. |
| **D** | Member Portal | _nothing beyond zone membership_ | Where members live: their own profile, their performance, residency, rent, compliance and engagement history. |
| **E** | Public Portal | _nothing beyond zone membership_ | The face of the consortium: website stats, traffic analytics, conversion metrics, public content, and ad placement with rotation. |

The Public Portal is the open surface: **every role may enter it**, because a
signed-in landlord browsing the property listings is still just a visitor to the
public website. Nothing leaks — Zone E's `dataFirewall` blocks ID numbers, rent
and earnings, and administering it (content authoring, traffic metrics) is gated
by `publicContent:*` / `publicMetrics:read`, which no member role holds.

---

## The generic profile surface

`defineProfileModule` mounts the same routes for all 16 profile collections,
in the LRMC convention — **plural for collections, singular for items, with a**
**named id parameter** — and in this registration order (`/me` before the id
route, or Express parses `me` as an id):

| Method | Path | Zone | Permission | Own |
|---|---|---|---|---|
| `GET` | `/<plural>/me` → **`/<singular>/me`** | member | `<resource>:readOwn` | self |
| `PATCH` | `/<singular>/me` | member | `<resource>:updateOwn` | self |
| `GET` | `/<plural>` | admin | `<resource>:read` | scoped |
| `POST` | `/<plural>` | admin | `<resource>:create` | — |
| `GET` | `/<singular>/:<name>Id` | admin | `<resource>:read` or `:readOwn` | scoped |
| `PATCH` | `/<singular>/:<name>Id` | admin | `<resource>:update` or `:updateOwn` | scoped |
| `PATCH` | `/<singular>/:<name>Id/verify` | admin | `<resource>:verify` | — |
| `DELETE` | `/<singular>/:<name>Id` | admin | `<resource>:delete` | — |
| `POST` | `/<singular>/:<name>Id/restore` | admin | `<resource>:update` | — |

The **admin zone** is where the collection is administered; the **member zone**
is where its owner reaches their own record. For most collections that is Back
Office and Member Portal respectively — which is why a landlord cannot call
`GET /landlords/:id` even for their own record, and uses `GET /landlords/me`
instead.

Two routers, two mount points: `/landlords` carries the collection verbs, and
`/landlord` carries everything addressing one record. Controllers still read
`req.params.id`, so the item router aliases its named id onto `id` on the way
in — one line in the factory instead of a special case in nine handlers.

| Collection (plural) | Item (singular) | Resource | Admin zone | Member zone | Verifiable |
|---|---|---|---|---|---|
| `/merchants` | `/merchant/:merchantId` | `merchantProfile` | C · Back Office | D · Member | yes |
| `/customers` | `/customer/:customerId` | `customerProfile` | C · Back Office | D · Member | yes |
| `/founders` | `/founder/:founderId` | `founderProfile` | A · Founder | A · Founder | no |
| `/hq-executives` | `/hq-executive/:executiveId` | `hqExecutiveProfile` | A · Founder | B · HQ Exec | no |
| `/staff-members` | `/staff-member/:staffId` | `backOfficeStaffProfile` | C · Back Office | D · Member | yes |
| `/landlords` | `/landlord/:landlordId` | `landlordProfile` | C · Back Office | D · Member | yes |
| `/tenants` | `/tenant/:tenantId` | `tenantProfile` | C · Back Office | D · Member | yes |
| `/coordinators` | `/coordinator/:coordinatorId` | `coordinatorProfile` | C · Back Office | D · Member | yes |
| `/vendors` | `/vendor/:vendorId` | `vendorProfile` | C · Back Office | D · Member | yes |
| `/airbnb-hosts` | `/airbnb-host/:hostId` | `airbnbHostProfile` | C · Back Office | D · Member | yes |
| `/hotels` | `/hotel/:hotelId` | `hotelProfile` | C · Back Office | D · Member | yes |
| `/resorts` | `/resort/:resortId` | `resortProfile` | C · Back Office | D · Member | yes |
| `/rental-car-companies` | `/rental-car-company/:companyId` | `rentalCarCompanyProfile` | C · Back Office | D · Member | yes |
| `/drivers` | `/driver/:driverId` | `driverProfile` | C · Back Office | D · Member | yes |
| `/riders` | `/rider/:riderId` | `riderProfile` | C · Back Office | D · Member | no |
| `/advertisers` | `/advertiser/:advertiserId` | `advertiserProfile` | C · Back Office | D · Member | yes |

---

## Ownership: what `scopeFor` does per resource

`BaseService.scopeFor(actor)` returns a Mongo filter fragment that is merged
into *every* read. Actors with scope `global`, `regional` or `zonal` get an empty
fragment (no narrowing). Actors with scope `own`, `organizational` or `public`
get the clauses below, OR-ed together.

| Collection | `ownerPath` | `organizationPath` | Effect |
|---|---|---|---|
| `/merchants` | `user` | `_id` | organizational callers see only their own merchant record (matched on `user` or on the record's own id) |
| `/customers` | `user` | `_id` | organizational callers see only their own customer record (matched on `user` or on the record's own id) |
| `/founders` | `user` | — | own-scoped callers see only the founder profiles whose `user` is their own account id |
| `/hq-executives` | `user` | — | own-scoped callers see only the executive profiles whose `user` is their own account id |
| `/staff-members` | `user` | — | own-scoped callers see only the staff records whose `user` is their own account id |
| `/landlords` | `user` | — | own-scoped callers see only the landlord profiles whose `user` is their own account id |
| `/tenants` | `user` | — | own-scoped callers see only the tenant profiles whose `user` is their own account id |
| `/coordinators` | `user` | — | own-scoped callers see only the coordinator profiles whose `user` is their own account id |
| `/vendors` | `user` | — | own-scoped callers see only the vendor profiles whose `user` is their own account id |
| `/airbnb-hosts` | `user` | `_id` | organizational callers see only their own Airbnb host record (matched on `user` or on the record's own id) |
| `/hotels` | `user` | `_id` | organizational callers see only their own hotel record (matched on `user` or on the record's own id) |
| `/resorts` | `user` | `_id` | organizational callers see only their own resort record (matched on `user` or on the record's own id) |
| `/rental-car-companies` | `user` | `_id` | organizational callers see only their own rental car company record (matched on `user` or on the record's own id) |
| `/drivers` | `user` | — | own-scoped callers see only the driver profiles whose `user` is their own account id |
| `/riders` | `user` | — | own-scoped callers see only the rider profiles whose `user` is their own account id |
| `/advertisers` | `user` | `_id` | organizational callers see only their own advertiser record (matched on `user` or on the record's own id) |
| `/properties` | `owner` | `owner` | own/organizational callers see only properties whose `owner` is their own profile id — one rule covers landlords, hosts, hotels and resorts because the owner is polymorphic |
| `/ads` | `user` | `advertiser` | advertisers see only ads they submitted (`user`) or that belong to their advertiser account (`advertiser`) |
| `/public/content` | — | — | not owned by anyone; the public read path filters on isPublished instead |
| `/leases` | `tenant` | `landlord` | a lease is visible from both ends — own-scoped callers match on `tenant`, organizational callers on `landlord` |
| `/maintenance-requests` | `raisedBy` | `assignedVendor` | the member who raised the work order (`raisedBy`) and the vendor it was assigned to (`assignedVendor`) each see it; nobody else own-scoped does |
| `/rides` | `rider` | `driver` | both sides of the trip see it — own-scoped callers match on `rider`, organizational callers on `driver` |
| `/payments` | `payer` | `payee` | a ledger row is visible to whoever paid (`payer`) and whoever was paid (`payee`), which is why one collection can serve rent, fares, payouts and ad spend |
| `/notifications` | `recipient` | — | a member sees only the notifications addressed to their own account id |
| `/fac-codes` | — | — | not owned by anyone — a code generation belongs to the institution. Only Zone A reaches the collection, so there is nothing to narrow |
| `/documents` | `owner` | `assignedTo` | a holder sees only documents they submitted (`owner`); a reviewer additionally sees what is assigned to them (`assignedTo`) |
| `/payout-batches` | — | — | not owned by anyone — a payout batch belongs to the platform. Back Office sees every batch and no member role reaches the collection at all, so there is nothing to narrow |
| `/commercial-clients` | `user` | `_id` | a client contact sees only their own client record (matched on `user` or on the record's own id) |

---

## Endpoints by module

### stats

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/stats/properties` | D · Member | `analytics:read`<br>`property:readOwn`<br>`property:read` | scoped | — | _all except_ RC DR RI AD ME SE CU BU PU |
| `GET` | `/api/v1/stats/payments` | D · Member | `analytics:read`<br>`payment:readOwn`<br>`payment:read` | scoped | — | _all except_ SE BU PU |
| `GET` | `/api/v1/stats/maintenance` | D · Member | `analytics:read`<br>`maintenanceRequest:readOwn`<br>`maintenanceRequest:read` | scoped | — | _all except_ DR RI AD ME SE CU BU PU |
| `GET` | `/api/v1/stats/applications` | D · Member | `analytics:read`<br>`application:readOwn`<br>`application:read` | scoped | — | FN EX BO CO LL TE |
| `GET` | `/api/v1/stats/ususu` | D · Member | `analytics:read`<br>`ususuLedger:readOwn`<br>`ususuLedger:read` | scoped | — | FN EX BO CO TE |

**Notes**

- **`GET /api/v1/stats/properties`** — Scoped to the caller from the token, never from a parameter: a landlord gets their own portfolio, a coordinator their region, Back Office everything. Occupancy is of lettable properties — an off-market unit is not a vacancy.
- **`GET /api/v1/stats/payments`** — Reliability is of *settled* instalments; dividing by every row would drag it down each time one fell due. `succeeded` is the ledger’s word for settled — `paid` belongs to the marketplace order lifecycle.
- **`GET /api/v1/stats/maintenance`** — Ten statuses into four buckets, and `stalled` is reported rather than hidden so the buckets sum to the total.
- **`GET /api/v1/stats/applications`** — A landlord sees applications on their own properties.
- **`GET /api/v1/stats/ususu`** — Reports `totalMembers`, not `totalGroups`: the ledger records contributions per person and there is no group entity to count.


### evidence

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `POST` | `/api/v1/references/request` | D · Member | `reference:create` | — | body: `requestReferenceSchema` | FN BO CO |
| `POST` | `/api/v1/references/respond` | D · Member | `reference:update` | — | body: `respondToReferenceSchema` | FN BO CO |
| `GET` | `/api/v1/references/:subjectId` | D · Member | `reference:readOwn`<br>`reference:read` | scoped | — | FN BO CO TE |
| `POST` | `/api/v1/disputes/open` | D · Member | `dispute:create` | — | body: `openDisputeSchema` | FN BO CO |
| `POST` | `/api/v1/dispute/:disputeId/resolve` | D · Member | `dispute:approve` | scoped | body: `resolveMemberDisputeSchema` | FN BO |
| `GET` | `/api/v1/disputes/:subjectId` | D · Member | `dispute:readOwn`<br>`dispute:read` | scoped | — | FN BO CO TE |
| `POST` | `/api/v1/ususu/group/create` | D · Member | `ususuLedger:create` | — | body: `createUsusuGroupSchema` | FN BO CO |
| `POST` | `/api/v1/ususu/group/add-member` | D · Member | `ususuLedger:create` | — | body: `groupMemberSchema` | FN BO CO |
| `POST` | `/api/v1/ususu/group/remove-member` | D · Member | `ususuLedger:create` | — | body: `groupMemberSchema` | FN BO CO |
| `POST` | `/api/v1/ususu/group/contribute` | D · Member | `ususuLedger:create` | — | body: `groupContributionSchema` | FN BO CO |
| `POST` | `/api/v1/ususu/group/miss` | D · Member | `ususuLedger:create` | — | body: `groupMissSchema` | FN BO CO |
| `GET` | `/api/v1/ususu/group/user/:userId` | D · Member | _auth only_ | scoped | — | _all except_ PU |
| `GET` | `/api/v1/ususu/group/:groupId` | D · Member | _auth only_ | scoped | — | _all except_ PU |
| `GET` | `/api/v1/ususu/group/:groupId/summary` | D · Member | _auth only_ | scoped | — | _all except_ PU |
| `POST` | `/api/v1/ususu/contribute` | D · Member | `ususuLedger:create` | — | body: `ususuContributionSchema` | FN BO CO |
| `POST` | `/api/v1/ususu/miss` | D · Member | `ususuLedger:create` | — | body: `ususuMissSchema` | FN BO CO |
| `GET` | `/api/v1/ususu/:subjectId` | D · Member | `ususuLedger:readOwn`<br>`ususuLedger:read` | scoped | — | FN BO CO TE |

**Notes**

- **`POST /api/v1/references/request`** — LRMC asks; the subject cannot request their own, because then they choose the referee.
- **`POST /api/v1/references/respond`** — Nobody scores their own. A referee who will not score is a decline, not a zero.
- **`GET /api/v1/references/:subjectId`** — Your own, or anybody’s if you are staff. A landlord sees the assessment, not the referee comments behind it.
- **`POST /api/v1/disputes/open`** — Severity 1–3, set when opened. An open dispute blocks a tenancy recommendation whatever its grade.
- **`POST /api/v1/dispute/:disputeId/resolve`** — Not by its subject: an open dispute blocks them, and closing your own block is not a thing.
- **`POST /api/v1/ususu/group/create`** — Coordinators and LRMC only — an ordinary member cannot open a circle on the platform. Always lands in `forming`; a circle created already `active` would be a claim that people have agreed to put money in. The steward is added to their own register from the first second, so "who is in this" and "who is answerable for this" cannot drift apart. `status`, `groupHealth` and any streak are refused by the strict schema: all three are derived from the ledger and none is stored.
- **`POST /api/v1/ususu/group/add-member`** — The steward who runs the circle, or LRMC. Not an ordinary member: a circle where anybody can add anybody is one where a disagreement is settled by whoever reaches their phone first. A closed circle refuses — its register is history, and adding somebody to a finished round would credit them with contributions they never made.
- **`POST /api/v1/ususu/group/remove-member`** — REMOVING A MEMBER NEVER DELETES THEIR CONTRIBUTIONS. Somebody who paid into a circle for a year and then left has a year of evidence; the register changes and the append-only ledger does not. The steward cannot be removed from their own circle — close it instead, because there is no succession and a circle with no keeper is a register nobody can manage.
- **`POST /api/v1/ususu/group/contribute`** — NOBODY RECORDS THEIR OWN CONTRIBUTION. Same rule as every other kind of evidence: a contribution somebody wrote down about themselves is a claim, not a record, and it is the one claim nobody else can check. Without it the fastest route to a high Ususu score is to open a circle and pay yourself on paper. `period` is required and shaped YYYY-MM — it is what a streak is counted over and what makes a duplicate detectable. A second entry for the same member, circle and period is a 409 for a person to resolve, never silently accepted. Recording the first contribution moves a `forming` circle to `active`.
- **`POST /api/v1/ususu/group/miss`** — Resets that member's streak, because a streak is consecutive contributions counting back from the latest period and a miss ends the run. Costs the circle 5 points of group health. Same self-recording rule as a contribution — and it matters more here, because a member who could record their own misses could also decline to.
- **`GET /api/v1/ususu/group/user/:userId`** — A person reads their own; Back Office, HQ and the founder read anyone's. A COORDINATOR READS NOBODY ELSE'S — this is narrower than a coordinator's reach anywhere else on the platform, deliberately. A savings circle is a private financial arrangement between named people, and stewarding one in Serrekunda is no reason to read the register of one in Basse.
- **`GET /api/v1/ususu/group/:groupId`** — The steward, the members, and LRMC. Anybody else is refused rather than answered with an empty object.
- **`GET /api/v1/ususu/group/:groupId/summary`** — Computed over the whole ledger, never a page — a group health over twenty rows reads as a group health over a history. `groupHealth` is 100 minus five per miss, floored at zero, and is NULL when nobody has contributed yet: a circle formed on Tuesday is not in perfect health and is not in bad health, it has no health to report. Streaks are counted BACKWARDS from the latest period; counting forwards returns the length of somebody's first good run, so a member who missed once in month seven and has paid for two years since would be reported with a streak of six. Money is grouped by currency and never summed.
- **`POST /api/v1/ususu/contribute`** — One line per person per period per kind. A month recorded twice would inflate a streak nobody earned.
- **`GET /api/v1/ususu/:subjectId`** — Streak and group health are computed from the ledger on read, never stored — a running total is a number somebody can correct by hand.


### security

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `POST` | `/api/v1/security/errors` | E · Public | _auth only_ | — | body: `errorReportSchema` | _all roles_ |
| `GET` | `/api/v1/security/errors` | C · Back Office | `auditLog:read`<br>`analytics:read` | — | — | FN EX BO |
| `GET` | `/api/v1/security/anomalies` | C · Back Office | `auditLog:read`<br>`analytics:read` | — | — | FN EX BO |

**Notes**

- **`POST /api/v1/security/errors`** — UNAUTHENTICATED ON PURPOSE. The most valuable report is the one from a page that broke before the member could sign in, and requiring a token would discard exactly those. NOTHING ON THIS ROUTE CAN ACT AGAINST A MEMBER — no block, no lock, no throttle that removes the application. Past a per-browser storage bound the report is dropped and the session is entirely unaffected; the reply is still 201, because telling a client it is being dropped invites a retry and a page in a render loop needs no encouragement. The reply carries nothing about the outcome: an intake that echoed its own grading would be a way to discover the thresholds. `severity` is derived from `kind` and cannot be supplied — a client that could set it could page a coordinator at will. URLs are reduced to path templates and every free-text field is redacted before storage, because an error log that quietly becomes a second copy of the tenant database is what every naive implementation produces.
- **`GET /api/v1/security/errors`** — Append-only: there is no update route and no delete route, because an error log somebody can edit is one nobody can rely on and the first thing anybody wants to do with an embarrassing entry is tidy it away. Rows expire after 90 days by TTL index — a retention decision, not a storage one, since these carry fragments of what members were doing. Each row carries a plain-English summary computed on read rather than stored, so a change to the wording reaches old rows.
- **`GET /api/v1/security/anomalies`** — Read-only, and the only way to see the pipeline. Counts are held IN MEMORY PER PROCESS: with two C4 servers a threshold is effectively halved per node, so the signals are conservative — the failure direction is a missed alert, never a false one. That is said in the reply itself so a reader comparing against a log knows why the numbers are low rather than concluding the pipeline is broken. The ceiling is `escalate`; nothing here locks, blocks or throttles anybody.


### viewing

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `POST` | `/api/v1/viewings` | D · Member | `viewing:create` | — | body: `requestViewingSchema` | FN BO TE |
| `GET` | `/api/v1/viewings` | D · Member | `viewing:readOwn`<br>`viewing:read` | scoped | query: `viewingQuerySchema` | FN BO CO LL TE |
| `GET` | `/api/v1/viewing/:viewingId` | D · Member | `viewing:readOwn`<br>`viewing:read` | scoped | — | FN BO CO LL TE |
| `PATCH` | `/api/v1/viewing/:viewingId` | D · Member | `viewing:updateOwn` | scoped | body: `updateViewingSchema` | FN BO CO TE |
| `POST` | `/api/v1/viewing/:viewingId/confirm` | D · Member | `viewing:approve` | scoped | body: `viewingDecisionSchema` | FN BO CO |
| `POST` | `/api/v1/viewing/:viewingId/decline` | D · Member | `viewing:approve` | scoped | body: `viewingDecisionSchema` | FN BO CO |
| `POST` | `/api/v1/viewing/:viewingId/cancel` | D · Member | `viewing:readOwn` | scoped | body: `viewingDecisionSchema` | FN BO CO LL TE |
| `POST` | `/api/v1/viewing/:viewingId/complete` | D · Member | `viewing:update` | scoped | body: `viewingOutcomeSchema` | FN BO CO |
| `POST` | `/api/v1/viewing/:viewingId/no-show` | D · Member | `viewing:update` | scoped | body: `viewingOutcomeSchema` | FN BO CO |

**Notes**

- **`POST /api/v1/viewings`** — Refuses a slot outside viewing hours, inside the notice window, or beyond the booking horizon — see `viewingRules.slotProblem`. Also refuses a second live request on the same property.
- **`GET /api/v1/viewings`** — A tenant sees their own, a landlord sees those on their properties, a coordinator sees their region, Back Office sees all.
- **`PATCH /api/v1/viewing/:viewingId`** — The tenant’s own words only. Status moves through the action routes.
- **`POST /api/v1/viewing/:viewingId/cancel`** — No permission gate: `viewingRules.mayAct` is what stops a landlord cancelling on a tenant’s behalf, which would leave a record reading as though the tenant lost interest.
- **`POST /api/v1/viewing/:viewingId/complete`** — Refused before the slot has passed. An outcome recorded early is a prediction.
- **`POST /api/v1/viewing/:viewingId/no-show`** — Refused before the slot has passed, and it lands on a tenant’s record where it counts at application time.


### application

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `POST` | `/api/v1/applications` | D · Member | `application:create` | — | body: `createApplicationSchema` | FN BO TE |
| `GET` | `/api/v1/applications` | D · Member | `application:readOwn`<br>`application:read` | scoped | query: `applicationQuerySchema` | FN BO CO LL TE |
| `GET` | `/api/v1/application/:applicationId` | D · Member | `application:readOwn`<br>`application:read` | scoped | — | FN BO CO LL TE |
| `PATCH` | `/api/v1/application/:applicationId` | D · Member | `application:updateOwn` | scoped | body: `updateApplicationSchema` | FN BO CO TE |
| `POST` | `/api/v1/application/:applicationId/assess` | D · Member | `application:update` | scoped | — | FN BO CO |
| `POST` | `/api/v1/application/:applicationId/review` | D · Member | `application:update` | scoped | — | FN BO CO |
| `POST` | `/api/v1/application/:applicationId/request-information` | D · Member | `application:update` | scoped | body: `requestFromApplicantSchema` | FN BO CO |
| `POST` | `/api/v1/application/:applicationId/approve` | D · Member | `application:approve` | scoped | body: `decideApplicationSchema` | FN BO CO |
| `POST` | `/api/v1/application/:applicationId/reject` | D · Member | `application:approve` | scoped | body: `decideApplicationSchema` | FN BO CO |
| `POST` | `/api/v1/application/:applicationId/withdraw` | D · Member | `application:readOwn` | scoped | — | FN BO CO LL TE |
| `POST` | `/api/v1/application/:applicationId/lease` | D · Member | `lease:create` | scoped | — | FN BO CO LL |

**Notes**

- **`POST /api/v1/applications`** — Scored on submission by `eligibility.assessApplication`, which recommends and never decides. One live application per person per property.
- **`GET /api/v1/applications`** — A landlord sees who applied for their property and what LRMC made of them; they do not decide.
- **`PATCH /api/v1/application/:applicationId`** — Re-scored on change. Refused once the application has been decided.
- **`POST /api/v1/application/:applicationId/assess`** — The stored assessment is a snapshot of what the decider saw, not a live view — this is how it is deliberately refreshed.
- **`POST /api/v1/application/:applicationId/approve`** — A landlord cannot: LRMC carries the tenancy, holds the deposit and answers for the decision. A reason is required for an approval, not only for a refusal.
- **`POST /api/v1/application/:applicationId/withdraw`** — Only the applicant. LRMC does not withdraw on somebody’s behalf — it rejects, which is a different word with a different record.
- **`POST /api/v1/application/:applicationId/lease`** — Only from `approved`. The lease itself is created through `POST /leases`.


### marketplace

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/listings` | D · Member | `listing:read` | — | query: `listingQuery` | FN EX BO ME SE CU BU |
| `POST` | `/api/v1/listings` | D · Member | `listing:create` | — | body: `createListingSchema` | FN BO ME SE |
| `GET` | `/api/v1/listings/me` | D · Member | `listing:read` | self | — | FN EX BO ME SE CU BU |
| `GET` | `/api/v1/listing/:listingId` | D · Member | `listing:read` | — | — | FN EX BO ME SE CU BU |
| `PATCH` | `/api/v1/listing/:listingId` | D · Member | `listing:update` | scoped | body: `updateListingSchema` | FN BO ME SE |
| `POST` | `/api/v1/listing/:listingId/publish` | D · Member | `listing:update` | scoped | — | FN BO ME SE |
| `POST` | `/api/v1/listing/:listingId/unpublish` | D · Member | `listing:update` | scoped | — | FN BO ME SE |
| `POST` | `/api/v1/listing/:listingId/suspend` | C · Back Office | `listing:review`<br>`listing:update` | — | body: `suspendListingSchema` | FN BO |
| `GET` | `/api/v1/orders` | D · Member | `order:read` | scoped | query: `orderQuery` | FN EX BO ME SE CU BU |
| `POST` | `/api/v1/orders` | D · Member | `order:create` | — | body: `placeOrderSchema` | FN BO CU BU |
| `GET` | `/api/v1/order/:orderId` | D · Member | `order:read` | scoped | — | FN EX BO ME SE CU BU |
| `POST` | `/api/v1/order/:orderId/pay` | D · Member | `order:updateOwn`<br>`order:update` | scoped | body: `payOrderSchema` | FN BO ME SE CU BU |
| `POST` | `/api/v1/order/:orderId/accept` | D · Member | `order:update` | scoped | — | FN BO ME SE |
| `POST` | `/api/v1/order/:orderId/fulfil` | D · Member | `order:update` | scoped | body: `fulfilOrderSchema` | FN BO ME SE |
| `POST` | `/api/v1/order/:orderId/confirm` | D · Member | `order:updateOwn`<br>`order:update` | scoped | — | FN BO ME SE CU BU |
| `POST` | `/api/v1/order/:orderId/cancel` | D · Member | `order:updateOwn`<br>`order:update` | scoped | body: `cancelOrderSchema` | FN BO ME SE CU BU |
| `POST` | `/api/v1/order/:orderId/dispute` | D · Member | `order:updateOwn`<br>`order:update` | scoped | body: `disputeOrderSchema` | FN BO ME SE CU BU |
| `POST` | `/api/v1/order/:orderId/resolve` | C · Back Office | `order:update` | — | body: `resolveDisputeSchema` | FN BO |
| `GET` | `/api/v1/marketplace/overview` | D · Member | `marketplace:read` | self | — | FN EX BO ME SE CU BU |

**Notes**

- **`GET /api/v1/listings`** — Defaults to published listings. A draft cannot leak into the catalogue because somebody forgot a filter.
- **`POST /api/v1/listings`** — Merchants and their sellers only. Always created as a draft — a listing goes live when `canPublish` agrees, which is a separate call.
- **`POST /api/v1/listing/:listingId/publish`** — Refuses with **every** problem at once rather than the first. An unverified merchant cannot publish at all — a marketplace listing unverified merchants owns its first fraud.
- **`GET /api/v1/orders`** — Scoped in the data layer. A merchant asking for another merchant's orders gets an empty page, not a 403 that confirms the order exists.
- **`POST /api/v1/orders`** — The client sends listing ids and quantities only. Prices are read from the listings and copied onto the lines — a client that could name its own prices would name zero.
- **`GET /api/v1/order/:orderId`** — `availableActions` is derived from the lifecycle table for this caller's side, so the client never reimplements the rules to decide which buttons to draw.
- **`POST /api/v1/order/:orderId/pay`** — Stock comes down here, not at draft — an unpaid order holding stock empties a catalogue without a single sale.
- **`POST /api/v1/order/:orderId/fulfil`** — Stamps `autoReleaseAt`. Escrow with no time limit does not protect the buyer — it strips the merchant, since a buyer holding their goods has no reason ever to confirm.
- **`POST /api/v1/order/:orderId/confirm`** — The buyer confirms; the *platform* releases. No transition anywhere lets a merchant release their own escrow.
- **`POST /api/v1/order/:orderId/cancel`** — A buyer may cancel freely for 24 hours. After that the merchant may have bought materials or turned down other work, so it needs them or Back Office.
- **`POST /api/v1/order/:orderId/dispute`** — Clears `autoReleaseAt`, so a disputed order cannot quietly pay out while Back Office is reading it.
- **`POST /api/v1/order/:orderId/resolve`** — The only human step in the marketplace. Commission is returned pro rata on a partial refund — keeping it in full would mean LRMC profits proportionally more the worse the service was.
- **`GET /api/v1/marketplace/overview`** — Answers as merchant or as customer depending on which account the caller holds.


### merchant

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/merchant/me` | D · Member | `merchantProfile:readOwn` | self | — | FN EX BO ME SE |
| `PATCH` | `/api/v1/merchant/me` | D · Member | `merchantProfile:updateOwn` | self | body: `updateMerchantSchema` | FN BO ME |
| `GET` | `/api/v1/merchants` | C · Back Office | `merchantProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/merchants` | C · Back Office | `merchantProfile:create` | — | body: `createMerchantSchema` | FN BO |
| `GET` | `/api/v1/merchant/:merchantId` | C · Back Office | `merchantProfile:read`<br>`merchantProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/merchant/:merchantId` | C · Back Office | `merchantProfile:update`<br>`merchantProfile:updateOwn` | scoped | body: `updateMerchantSchema` | FN BO |
| `PATCH` | `/api/v1/merchant/:merchantId/verify` | C · Back Office | `merchantProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/merchant/:merchantId` | C · Back Office | `merchantProfile:delete` | — | — | FN BO |
| `POST` | `/api/v1/merchant/:merchantId/restore` | C · Back Office | `merchantProfile:update` | — | — | FN BO |

**Notes**

- **`GET /api/v1/merchant/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/merchant/:merchantId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/merchant/:merchantId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### customer

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/customer/me` | D · Member | `customerProfile:readOwn` | self | — | FN EX BO CU BU |
| `PATCH` | `/api/v1/customer/me` | D · Member | `customerProfile:updateOwn` | self | body: `updateCustomerSchema` | FN BO CU |
| `GET` | `/api/v1/customers` | C · Back Office | `customerProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/customers` | C · Back Office | `customerProfile:create` | — | body: `createCustomerSchema` | FN BO |
| `GET` | `/api/v1/customer/:customerId` | C · Back Office | `customerProfile:read`<br>`customerProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/customer/:customerId` | C · Back Office | `customerProfile:update`<br>`customerProfile:updateOwn` | scoped | body: `updateCustomerSchema` | FN BO |
| `PATCH` | `/api/v1/customer/:customerId/verify` | C · Back Office | `customerProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/customer/:customerId` | C · Back Office | `customerProfile:delete` | — | — | FN BO |
| `POST` | `/api/v1/customer/:customerId/restore` | C · Back Office | `customerProfile:update` | — | — | FN BO |

**Notes**

- **`GET /api/v1/customer/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/customer/:customerId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/customer/:customerId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Platform

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1` | — | _none_ | — | — | _anyone_ |
| `GET` | `/api/v1/openapi.json` | — | _none_ | — | — | _anyone_ |
| `GET` | `/api/v1/_blueprint` | — | _auth only_ | — | query: `blueprintQuery` | _all roles_ |

**Notes**

- **`GET /api/v1/openapi.json`** — Generated from the same declaration as the routers. Point Swagger UI, Redoc or a client generator at it.
- **`GET /api/v1/_blueprint`** — What the PWA shells build their navigation and route guards from.


### Auth & RBAC

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `POST` | `/api/v1/auth/register` | — | _none_ | — | body: `registerSchema` | _anyone_ |
| `POST` | `/api/v1/auth/login` | — | _none_ | — | body: `loginSchema` | _anyone_ |
| `POST` | `/api/v1/auth/refresh` | — | _none_ | — | body: `refreshSchema` | _anyone_ |
| `POST` | `/api/v1/auth/logout` | — | _auth only_ | self | body: `logoutSchema` | _all roles_ |
| `GET` | `/api/v1/auth/me` | — | _auth only_ | self | — | _all roles_ |
| `POST` | `/api/v1/auth/change-password` | — | _auth only_ | self | body: `changePasswordSchema` | _all roles_ |
| `PATCH` | `/api/v1/auth/user/:userId/roles` | A · Founder | _auth only_ | — | body: `assignRoleSchema` | FN |
| `GET` | `/api/v1/auth/roles` | — | _none_ | — | — | _anyone_ |
| `GET` | `/api/v1/auth/resolve` | A · Founder | _auth only_ | — | query: `?roles=a,b,c` | FN |

**Notes**

- **`POST /api/v1/auth/register`** — Only the 11 self-registerable roles. Appointed roles (founder, hqExecutive, backOfficeStaff, coordinator) are granted in Zone A. Profile creation failure rolls the User back.
- **`POST /api/v1/auth/login`** — Locks the account for 15 minutes after 8 consecutive failures.
- **`POST /api/v1/auth/logout`** — Send the refresh token in the body: it carries a session id and revoking that id ends this device's session without touching any other. The access token is a stateless JWT and is NOT revoked — it expires on its own schedule (JWT_EXPIRES_IN), so signing out stops new access tokens being minted but does not kill one already issued. For a credential believed stolen, change the password. The reply says which of the two happened rather than implying more than was done; a sign-out with no token presented still succeeds, because the person asked to leave.
- **`GET /api/v1/auth/me`** — One call on app boot instead of a permission check per widget.
- **`PATCH /api/v1/auth/user/:userId/roles`** — Founder-only via `requireFounder`. Appointment is a constitutional act.
- **`GET /api/v1/auth/resolve`** — Founder-only.


### HQ zones, dashboards & audit

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/hq/zones` | — | _auth only_ | — | — | _all roles_ |
| `GET` | `/api/v1/hq/zones/:zone` | — | _auth only_ | — | — | _all roles_ |
| `GET` | `/api/v1/hq/dashboard` | B · HQ Exec | `analytics:read` | — | — | FN EX |
| `GET` | `/api/v1/hq/kpis` | B · HQ Exec | `analytics:read` | — | — | FN EX |
| `GET` | `/api/v1/hq/system-health` | B · HQ Exec | `analytics:read` | — | — | FN EX |
| `GET` | `/api/v1/hq/regions` | B · HQ Exec | `analytics:read` | — | — | FN EX |
| `GET` | `/api/v1/hq/command-center` | A · Founder | _auth only_ | — | — | FN |
| `GET` | `/api/v1/hq/audit-log` | A · Founder | `auditLog:read` | — | query: `?limit&resource&actor` | FN |

**Notes**

- **`GET /api/v1/hq/zones/:zone`** — Returns 403 ZONE_RESTRICTED if the caller may not enter the requested zone.
- **`GET /api/v1/hq/command-center`** — Founder-only.
- **`GET /api/v1/hq/audit-log`** — Zone A alone. AuditLog blocks updates and deletes at the schema level.


### Founder profile (Zone A)

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/founder/me` | A · Founder | `founderProfile:readOwn` | self | — | FN |
| `PATCH` | `/api/v1/founder/me` | A · Founder | `founderProfile:updateOwn` | self | body: `updateFounderSchema` | FN |
| `GET` | `/api/v1/founders` | A · Founder | `founderProfile:read` | scoped | query: `listQuery` | FN |
| `POST` | `/api/v1/founders` | A · Founder | `founderProfile:create` | — | body: `createFounderSchema` | FN |
| `GET` | `/api/v1/founder/:founderId` | A · Founder | `founderProfile:read`<br>`founderProfile:readOwn` | scoped | — | FN |
| `PATCH` | `/api/v1/founder/:founderId` | A · Founder | `founderProfile:update`<br>`founderProfile:updateOwn` | scoped | body: `updateFounderSchema` | FN |
| `DELETE` | `/api/v1/founder/:founderId` | A · Founder | `founderProfile:delete` | — | — | FN |
| `POST` | `/api/v1/founder/:founderId/restore` | A · Founder | `founderProfile:update` | — | — | FN |

**Notes**

- **`GET /api/v1/founder/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`DELETE /api/v1/founder/:founderId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### HQ executive profiles

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/hq-executive/me` | B · HQ Exec | `hqExecutiveProfile:readOwn` | self | — | FN EX |
| `PATCH` | `/api/v1/hq-executive/me` | B · HQ Exec | `hqExecutiveProfile:updateOwn` | self | body: `updateHQExecutiveSchema` | FN EX |
| `GET` | `/api/v1/hq-executives` | A · Founder | `hqExecutiveProfile:read` | scoped | query: `listQuery` | FN |
| `POST` | `/api/v1/hq-executives` | A · Founder | `hqExecutiveProfile:create` | — | body: `createHQExecutiveSchema` | FN |
| `GET` | `/api/v1/hq-executive/:executiveId` | A · Founder | `hqExecutiveProfile:read`<br>`hqExecutiveProfile:readOwn` | scoped | — | FN |
| `PATCH` | `/api/v1/hq-executive/:executiveId` | A · Founder | `hqExecutiveProfile:update`<br>`hqExecutiveProfile:updateOwn` | scoped | body: `updateHQExecutiveSchema` | FN |
| `DELETE` | `/api/v1/hq-executive/:executiveId` | A · Founder | `hqExecutiveProfile:delete` | — | — | FN |
| `POST` | `/api/v1/hq-executive/:executiveId/restore` | A · Founder | `hqExecutiveProfile:update` | — | — | FN |

**Notes**

- **`GET /api/v1/hq-executive/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`DELETE /api/v1/hq-executive/:executiveId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Back office staff records

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/staff-member/me` | D · Member | `backOfficeStaffProfile:readOwn` | self | — | FN EX BO |
| `PATCH` | `/api/v1/staff-member/me` | D · Member | `backOfficeStaffProfile:updateOwn` | self | body: `updateBackOfficeStaffSchema` | FN BO |
| `GET` | `/api/v1/staff-members` | C · Back Office | `backOfficeStaffProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/staff-members` | C · Back Office | `backOfficeStaffProfile:create` | — | body: `createBackOfficeStaffSchema` | FN BO |
| `GET` | `/api/v1/staff-member/:staffId` | C · Back Office | `backOfficeStaffProfile:read`<br>`backOfficeStaffProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/staff-member/:staffId` | C · Back Office | `backOfficeStaffProfile:update`<br>`backOfficeStaffProfile:updateOwn` | scoped | body: `updateBackOfficeStaffSchema` | FN BO |
| `PATCH` | `/api/v1/staff-member/:staffId/verify` | C · Back Office | `backOfficeStaffProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/staff-member/:staffId` | C · Back Office | `backOfficeStaffProfile:delete` | — | — | FN BO |
| `POST` | `/api/v1/staff-member/:staffId/restore` | C · Back Office | `backOfficeStaffProfile:update` | — | — | FN BO |

**Notes**

- **`GET /api/v1/staff-member/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/staff-member/:staffId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/staff-member/:staffId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Landlords

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/landlord/me` | D · Member | `landlordProfile:readOwn` | self | — | FN EX BO CO LL |
| `PATCH` | `/api/v1/landlord/me` | D · Member | `landlordProfile:updateOwn` | self | body: `updateLandlordSchema` | FN BO LL |
| `GET` | `/api/v1/landlords` | C · Back Office | `landlordProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/landlords` | C · Back Office | `landlordProfile:create` | — | body: `createLandlordSchema` | FN BO |
| `GET` | `/api/v1/landlord/:landlordId` | C · Back Office | `landlordProfile:read`<br>`landlordProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/landlord/:landlordId` | C · Back Office | `landlordProfile:update`<br>`landlordProfile:updateOwn` | scoped | body: `updateLandlordSchema` | FN BO |
| `PATCH` | `/api/v1/landlord/:landlordId/verify` | C · Back Office | `landlordProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/landlord/:landlordId` | C · Back Office | `landlordProfile:delete` | — | — | FN |
| `POST` | `/api/v1/landlord/:landlordId/restore` | C · Back Office | `landlordProfile:update` | — | — | FN BO |

**Notes**

- **`GET /api/v1/landlord/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/landlord/:landlordId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/landlord/:landlordId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Tenants

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/tenant/me` | D · Member | `tenantProfile:readOwn` | self | — | FN EX BO CO LL TE |
| `PATCH` | `/api/v1/tenant/me` | D · Member | `tenantProfile:updateOwn` | self | body: `updateTenantSchema` | FN BO TE |
| `GET` | `/api/v1/tenants` | C · Back Office | `tenantProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/tenants` | C · Back Office | `tenantProfile:create` | — | body: `createTenantSchema` | FN BO |
| `GET` | `/api/v1/tenant/:tenantId` | C · Back Office | `tenantProfile:read`<br>`tenantProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/tenant/:tenantId` | C · Back Office | `tenantProfile:update`<br>`tenantProfile:updateOwn` | scoped | body: `updateTenantSchema` | FN BO |
| `PATCH` | `/api/v1/tenant/:tenantId/verify` | C · Back Office | `tenantProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/tenant/:tenantId` | C · Back Office | `tenantProfile:delete` | — | — | FN |
| `POST` | `/api/v1/tenant/:tenantId/restore` | C · Back Office | `tenantProfile:update` | — | — | FN BO |

**Notes**

- **`GET /api/v1/tenant/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/tenant/:tenantId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/tenant/:tenantId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Coordinators

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `PATCH` | `/api/v1/coordinator/:coordinatorId/assign-properties` | C · Back Office | `coordinatorProfile:assign`<br>`coordinatorProfile:update` | — | body: `assignPropertiesSchema` | FN BO |
| `GET` | `/api/v1/coordinator/me` | D · Member | `coordinatorProfile:readOwn` | self | — | FN EX BO CO AH HO RE |
| `PATCH` | `/api/v1/coordinator/me` | D · Member | `coordinatorProfile:updateOwn` | self | body: `updateCoordinatorSchema` | FN BO CO |
| `GET` | `/api/v1/coordinators` | C · Back Office | `coordinatorProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/coordinators` | C · Back Office | `coordinatorProfile:create` | — | body: `createCoordinatorSchema` | FN BO |
| `GET` | `/api/v1/coordinator/:coordinatorId` | C · Back Office | `coordinatorProfile:read`<br>`coordinatorProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/coordinator/:coordinatorId` | C · Back Office | `coordinatorProfile:update`<br>`coordinatorProfile:updateOwn` | scoped | body: `updateCoordinatorSchema` | FN BO |
| `PATCH` | `/api/v1/coordinator/:coordinatorId/verify` | C · Back Office | `coordinatorProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/coordinator/:coordinatorId` | C · Back Office | `coordinatorProfile:delete` | — | — | FN BO |
| `POST` | `/api/v1/coordinator/:coordinatorId/restore` | C · Back Office | `coordinatorProfile:update` | — | — | FN BO |

**Notes**

- **`GET /api/v1/coordinator/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/coordinator/:coordinatorId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/coordinator/:coordinatorId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Vendors

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/vendor/me` | D · Member | `vendorProfile:readOwn` | self | — | _all except_ TE DR RI AD ME SE CU BU PU |
| `PATCH` | `/api/v1/vendor/me` | D · Member | `vendorProfile:updateOwn` | self | body: `updateVendorSchema` | FN BO VE |
| `GET` | `/api/v1/vendors` | C · Back Office | `vendorProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/vendors` | C · Back Office | `vendorProfile:create` | — | body: `createVendorSchema` | FN BO |
| `GET` | `/api/v1/vendor/:vendorId` | C · Back Office | `vendorProfile:read`<br>`vendorProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/vendor/:vendorId` | C · Back Office | `vendorProfile:update`<br>`vendorProfile:updateOwn` | scoped | body: `updateVendorSchema` | FN BO |
| `PATCH` | `/api/v1/vendor/:vendorId/verify` | C · Back Office | `vendorProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/vendor/:vendorId` | C · Back Office | `vendorProfile:delete` | — | — | FN BO |
| `POST` | `/api/v1/vendor/:vendorId/restore` | C · Back Office | `vendorProfile:update` | — | — | FN BO |

**Notes**

- **`GET /api/v1/vendor/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/vendor/:vendorId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/vendor/:vendorId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Properties

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/properties/public` | E · Public | _auth only_ | — | query: `publicPropertyQuery` | _all roles_ |
| `GET` | `/api/v1/properties` | D · Member | `property:read`<br>`property:readOwn` | scoped | query: `listQuery` | _all except_ RC DR RI AD ME SE CU BU PU |
| `POST` | `/api/v1/properties` | D · Member | `property:create` | — | body: `createPropertySchema` | FN LL AH HO RE |
| `GET` | `/api/v1/property/:propertyId` | D · Member | `property:read`<br>`property:readOwn` | scoped | — | _all except_ RC DR RI AD ME SE CU BU PU |
| `PATCH` | `/api/v1/property/:propertyId` | D · Member | `property:update`<br>`property:updateOwn` | scoped | body: `updatePropertySchema` | FN BO CO LL AH HO RE |
| `DELETE` | `/api/v1/property/:propertyId` | D · Member | `property:delete` | scoped | — | FN |

**Notes**

- **`GET /api/v1/properties/public`** — Explicit projection, not a select:false blacklist — a public endpoint should name what it reveals. Only listedPublicly && active && not occupied.
- **`POST /api/v1/properties`** — Polymorphic owner: ownerKind ∈ {LandlordProfile, AirbnbHostProfile, HotelProfile, ResortProfile}.


### Airbnb hosts

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/airbnb-host/me` | D · Member | `airbnbHostProfile:readOwn` | self | — | FN EX BO AH |
| `PATCH` | `/api/v1/airbnb-host/me` | D · Member | `airbnbHostProfile:updateOwn` | self | body: `updateAirbnbHostSchema` | FN BO AH |
| `GET` | `/api/v1/airbnb-hosts` | C · Back Office | `airbnbHostProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/airbnb-hosts` | C · Back Office | `airbnbHostProfile:create` | — | body: `createAirbnbHostSchema` | FN BO |
| `GET` | `/api/v1/airbnb-host/:hostId` | C · Back Office | `airbnbHostProfile:read`<br>`airbnbHostProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/airbnb-host/:hostId` | C · Back Office | `airbnbHostProfile:update`<br>`airbnbHostProfile:updateOwn` | scoped | body: `updateAirbnbHostSchema` | FN BO |
| `PATCH` | `/api/v1/airbnb-host/:hostId/verify` | C · Back Office | `airbnbHostProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/airbnb-host/:hostId` | C · Back Office | `airbnbHostProfile:delete` | — | — | FN |
| `POST` | `/api/v1/airbnb-host/:hostId/restore` | C · Back Office | `airbnbHostProfile:update` | — | — | FN BO |

**Notes**

- **`GET /api/v1/airbnb-host/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/airbnb-host/:hostId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/airbnb-host/:hostId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Hotels

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/hotel/me` | D · Member | `hotelProfile:readOwn` | self | — | FN EX BO HO |
| `PATCH` | `/api/v1/hotel/me` | D · Member | `hotelProfile:updateOwn` | self | body: `updateHotelSchema` | FN BO HO |
| `GET` | `/api/v1/hotels` | C · Back Office | `hotelProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/hotels` | C · Back Office | `hotelProfile:create` | — | body: `createHotelSchema` | FN BO |
| `GET` | `/api/v1/hotel/:hotelId` | C · Back Office | `hotelProfile:read`<br>`hotelProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/hotel/:hotelId` | C · Back Office | `hotelProfile:update`<br>`hotelProfile:updateOwn` | scoped | body: `updateHotelSchema` | FN BO |
| `PATCH` | `/api/v1/hotel/:hotelId/verify` | C · Back Office | `hotelProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/hotel/:hotelId` | C · Back Office | `hotelProfile:delete` | — | — | FN |
| `POST` | `/api/v1/hotel/:hotelId/restore` | C · Back Office | `hotelProfile:update` | — | — | FN BO |

**Notes**

- **`GET /api/v1/hotel/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/hotel/:hotelId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/hotel/:hotelId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Resorts

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/resort/me` | D · Member | `resortProfile:readOwn` | self | — | FN EX BO RE |
| `PATCH` | `/api/v1/resort/me` | D · Member | `resortProfile:updateOwn` | self | body: `updateResortSchema` | FN BO RE |
| `GET` | `/api/v1/resorts` | C · Back Office | `resortProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/resorts` | C · Back Office | `resortProfile:create` | — | body: `createResortSchema` | FN BO |
| `GET` | `/api/v1/resort/:resortId` | C · Back Office | `resortProfile:read`<br>`resortProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/resort/:resortId` | C · Back Office | `resortProfile:update`<br>`resortProfile:updateOwn` | scoped | body: `updateResortSchema` | FN BO |
| `PATCH` | `/api/v1/resort/:resortId/verify` | C · Back Office | `resortProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/resort/:resortId` | C · Back Office | `resortProfile:delete` | — | — | FN |
| `POST` | `/api/v1/resort/:resortId/restore` | C · Back Office | `resortProfile:update` | — | — | FN BO |

**Notes**

- **`GET /api/v1/resort/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/resort/:resortId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/resort/:resortId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Rental car companies

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `POST` | `/api/v1/rental-car-company/:companyId/fleet` | D · Member | `rentalCarCompanyProfile:updateOwn`<br>`rentalCarCompanyProfile:update` | scoped | body: `fleetVehicleInput` | FN BO RC |
| `GET` | `/api/v1/rental-car-company/:companyId/utilization` | D · Member | `rentalCarCompanyProfile:readOwn`<br>`rentalCarCompanyProfile:read` | scoped | — | FN EX BO RC |
| `GET` | `/api/v1/rental-car-company/me` | D · Member | `rentalCarCompanyProfile:readOwn` | self | — | FN EX BO RC |
| `PATCH` | `/api/v1/rental-car-company/me` | D · Member | `rentalCarCompanyProfile:updateOwn` | self | body: `updateRentalCarCompanySchema` | FN BO RC |
| `GET` | `/api/v1/rental-car-companies` | C · Back Office | `rentalCarCompanyProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/rental-car-companies` | C · Back Office | `rentalCarCompanyProfile:create` | — | body: `createRentalCarCompanySchema` | FN BO |
| `GET` | `/api/v1/rental-car-company/:companyId` | C · Back Office | `rentalCarCompanyProfile:read`<br>`rentalCarCompanyProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/rental-car-company/:companyId` | C · Back Office | `rentalCarCompanyProfile:update`<br>`rentalCarCompanyProfile:updateOwn` | scoped | body: `updateRentalCarCompanySchema` | FN BO |
| `PATCH` | `/api/v1/rental-car-company/:companyId/verify` | C · Back Office | `rentalCarCompanyProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/rental-car-company/:companyId` | C · Back Office | `rentalCarCompanyProfile:delete` | — | — | FN |
| `POST` | `/api/v1/rental-car-company/:companyId/restore` | C · Back Office | `rentalCarCompanyProfile:update` | — | — | FN BO |

**Notes**

- **`POST /api/v1/rental-car-company/:companyId/fleet`** — $push, so two concurrent additions do not clobber each other.
- **`GET /api/v1/rental-car-company/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/rental-car-company/:companyId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/rental-car-company/:companyId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Drivers (Ususu)

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `PATCH` | `/api/v1/driver/me/online` | D · Member | `driverProfile:updateOwn` | self | body: `onlineStatusSchema` | FN BO DR |
| `GET` | `/api/v1/drivers/verification-queue` | C · Back Office | `driverProfile:verify` | — | — | FN BO |
| `GET` | `/api/v1/driver/me` | D · Member | `driverProfile:readOwn` | self | — | FN EX BO RC DR RI |
| `PATCH` | `/api/v1/driver/me` | D · Member | `driverProfile:updateOwn` | self | body: `updateDriverSchema` | FN BO DR |
| `GET` | `/api/v1/drivers` | C · Back Office | `driverProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/drivers` | C · Back Office | `driverProfile:create` | — | body: `createDriverSchema` | FN |
| `GET` | `/api/v1/driver/:driverId` | C · Back Office | `driverProfile:read`<br>`driverProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/driver/:driverId` | C · Back Office | `driverProfile:update`<br>`driverProfile:updateOwn` | scoped | body: `updateDriverSchema` | FN BO |
| `PATCH` | `/api/v1/driver/:driverId/verify` | C · Back Office | `driverProfile:verify` | — | body: `verificationBody` | FN BO |
| `DELETE` | `/api/v1/driver/:driverId` | C · Back Office | `driverProfile:delete` | — | — | FN |
| `POST` | `/api/v1/driver/:driverId/restore` | C · Back Office | `driverProfile:update` | — | — | FN BO |

**Notes**

- **`PATCH /api/v1/driver/me/online`** — Also gated by `requireAction("goOnline")`. Refuses unless verificationStatus is verified.
- **`GET /api/v1/drivers/verification-queue`** — Registered before /:id so the literal segment is not swallowed by the id route.
- **`GET /api/v1/driver/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/driver/:driverId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/driver/:driverId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Riders (Ususu)

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/rider/me` | D · Member | `riderProfile:readOwn` | self | — | FN EX BO DR RI |
| `PATCH` | `/api/v1/rider/me` | D · Member | `riderProfile:updateOwn` | self | body: `updateRiderSchema` | FN RI |
| `GET` | `/api/v1/riders` | C · Back Office | `riderProfile:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/riders` | C · Back Office | `riderProfile:create` | — | body: `createRiderSchema` | FN |
| `GET` | `/api/v1/rider/:riderId` | C · Back Office | `riderProfile:read`<br>`riderProfile:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/rider/:riderId` | C · Back Office | `riderProfile:update`<br>`riderProfile:updateOwn` | scoped | body: `updateRiderSchema` | FN |
| `DELETE` | `/api/v1/rider/:riderId` | C · Back Office | `riderProfile:delete` | — | — | FN |
| `POST` | `/api/v1/rider/:riderId/restore` | C · Back Office | `riderProfile:update` | — | — | FN |

**Notes**

- **`GET /api/v1/rider/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`DELETE /api/v1/rider/:riderId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Advertiser accounts

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/advertiser/me` | D · Member | `advertiserProfile:readOwn` | self | — | FN EX AD |
| `PATCH` | `/api/v1/advertiser/me` | D · Member | `advertiserProfile:updateOwn` | self | body: `updateAdvertiserSchema` | FN AD |
| `GET` | `/api/v1/advertisers` | C · Back Office | `advertiserProfile:read` | scoped | query: `listQuery` | FN EX |
| `POST` | `/api/v1/advertisers` | C · Back Office | `advertiserProfile:create` | — | body: `createAdvertiserSchema` | FN |
| `GET` | `/api/v1/advertiser/:advertiserId` | C · Back Office | `advertiserProfile:read`<br>`advertiserProfile:readOwn` | scoped | — | FN EX |
| `PATCH` | `/api/v1/advertiser/:advertiserId` | C · Back Office | `advertiserProfile:update`<br>`advertiserProfile:updateOwn` | scoped | body: `updateAdvertiserSchema` | FN |
| `PATCH` | `/api/v1/advertiser/:advertiserId/verify` | C · Back Office | `advertiserProfile:verify` | — | body: `verificationBody` | FN |
| `DELETE` | `/api/v1/advertiser/:advertiserId` | C · Back Office | `advertiserProfile:delete` | — | — | FN |
| `POST` | `/api/v1/advertiser/:advertiserId/restore` | C · Back Office | `advertiserProfile:update` | — | — | FN |

**Notes**

- **`GET /api/v1/advertiser/me`** — Record resolved from the token, never from the URL. Declared before the `:id` route — otherwise Express parses `me` as an id.
- **`PATCH /api/v1/advertiser/:advertiserId/verify`** — Back Office act. `verified` stamps verifiedAt/verifiedBy; `rejected` requires a note.
- **`DELETE /api/v1/advertiser/:advertiserId`** — Sets deletedAt and status=archived. Nothing is removed from the collection.


### Advertising: serving, lifecycle & policy

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/ads/serve` | — | _auth only_ | — | query: `serveQuerySchema` | _all roles_ |
| `POST` | `/api/v1/ads/track/impression` | — | _auth only_ | — | body: `trackSchema` | _all roles_ |
| `POST` | `/api/v1/ads/track/click` | — | _auth only_ | — | body: `trackSchema` | _all roles_ |
| `GET` | `/api/v1/ads/reports` | D · Member | `adReport:read`<br>`adReport:readOwn` | scoped | query: `reportQuerySchema` | FN EX AD |
| `GET` | `/api/v1/ads` | D · Member | `ad:read`<br>`ad:readOwn` | scoped | query: `listQuery` | FN EX AD |
| `POST` | `/api/v1/ads` | D · Member | `ad:create` | — | body: `createAdSchema` | FN AD |
| `GET` | `/api/v1/ad/:adId` | D · Member | `ad:read`<br>`ad:readOwn` | scoped | — | FN EX AD |
| `PATCH` | `/api/v1/ad/:adId` | D · Member | `ad:update`<br>`ad:updateOwn` | scoped | body: `updateAdSchema` | FN AD |
| `POST` | `/api/v1/ad/:adId/submit` | D · Member | `ad:updateOwn`<br>`ad:update` | scoped | — | FN AD |
| `PATCH` | `/api/v1/ad/:adId/status` | D · Member | `ad:updateOwn`<br>`ad:update` | scoped | body: `adStatusSchema` | FN AD |
| `PATCH` | `/api/v1/ad/:adId/review` | B · HQ Exec | `ad:approve` | — | body: `adReviewSchema` | FN EX |
| `DELETE` | `/api/v1/ad/:adId` | D · Member | `ad:delete`<br>`ad:updateOwn` | scoped | — | FN AD |
| `GET` | `/api/v1/ad-policy` | A · Founder | `adPolicy:read`<br>`policy:read` | — | — | FN |
| `GET` | `/api/v1/ad-policy/history` | A · Founder | _auth only_ | — | — | FN |
| `POST` | `/api/v1/ad-policy` | A · Founder | _auth only_ | — | body: `adPolicySchema` | FN |
| `GET` | `/api/v1/ad-policy/preview-rotation` | A · Founder | `adPolicy:read`<br>`policy:read` | — | query: `previewRotationQuerySchema` | FN |
| `PATCH` | `/api/v1/ad-policy/advertiser/:advertiserId/terms` | A · Founder | _auth only_ | — | body: `advertiserTermsSchema` | FN |

**Notes**

- **`GET /api/v1/ads/serve`** — Anonymous visitor and signed-in member hit the same endpoint; the engine sees a different role and zone. Cache-Control: private, no-store.
- **`POST /api/v1/ads/track/impression`** — Deduped per session inside AD_IMPRESSION_DEDUPE_WINDOW_SECONDS; a repeat returns counted:false.
- **`GET /api/v1/ads/reports`** — An advertiser's request is silently narrowed to their own campaigns regardless of the advertiserId they pass.
- **`PATCH /api/v1/ad/:adId/status`** — activate honours the Founder review requirement and refuses if the advertiser is not in good standing or the flight has ended.
- **`PATCH /api/v1/ad/:adId/review`** — Approval is an HQ act, not a Member Portal one. A rejection must carry a reason.
- **`GET /api/v1/ad-policy/history`** — Founder-only.
- **`POST /api/v1/ad-policy`** — Founder-only. Creates a new version and deactivates the previous one — policy is versioned, never edited, so an ad served last Tuesday stays explicable by the policy in force last Tuesday.
- **`PATCH /api/v1/ad-policy/advertiser/:advertiserId/terms`** — Founder-only. Commercial terms sit outside the advertiser’s own reach.


### Leases & rent

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/leases` | C · Back Office | `lease:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/leases` | C · Back Office | `lease:create` | — | body: `createLeaseSchema` | FN BO |
| `POST` | `/api/v1/leases/create` | D · Member | `lease:create` | — | body: `memberCreateLeaseSchema` | FN BO CO LL |
| `POST` | `/api/v1/leases/activate` | D · Member | `lease:update`<br>`lease:updateOwn` | — | body: `leaseActionSchema` | FN BO CO LL |
| `POST` | `/api/v1/leases/complete` | D · Member | `lease:update`<br>`lease:updateOwn` | — | body: `leaseActionSchema` | FN BO CO LL |
| `POST` | `/api/v1/leases/terminate` | D · Member | `lease:update`<br>`lease:updateOwn` | — | body: `leaseTerminateSchema` | FN BO CO LL |
| `GET` | `/api/v1/leases/user/:userId` | D · Member | `lease:read`<br>`lease:readOwn` | scoped | query: `listQuery` | FN EX BO CO LL TE |
| `GET` | `/api/v1/leases/property/:propertyId` | D · Member | `lease:read`<br>`lease:readOwn` | scoped | query: `listQuery` | FN EX BO CO LL TE |
| `GET` | `/api/v1/lease/:leaseId` | C · Back Office | `lease:read`<br>`lease:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/lease/:leaseId` | C · Back Office | `lease:update` | scoped | body: `updateLeaseSchema` | FN BO |
| `POST` | `/api/v1/lease/:leaseId/payments` | D · Member | `payment:create`<br>`rentPayment:create` | scoped | body: `recordRentPaymentSchema` | FN BO CO TE |
| `GET` | `/api/v1/lease/:leaseId/schedule` | D · Member | `lease:read`<br>`lease:readOwn` | scoped | — | FN EX BO CO LL TE |
| `POST` | `/api/v1/leases/run-rent-reminders` | C · Back Office | `lease:update`<br>`lease:read` | — | body: `runRentRemindersSchema` | FN EX BO |
| `GET` | `/api/v1/tenant/me/leases` | D · Member | `lease:readOwn`<br>`lease:read` | self | query: `listQuery` | FN EX BO CO LL TE |
| `GET` | `/api/v1/landlord/me/leases` | D · Member | `lease:readOwn`<br>`lease:read` | self | query: `listQuery` | FN EX BO CO LL TE |

**Notes**

- **`POST /api/v1/leases`** — leaseEnd must be after leaseStart. `reference` (LSE-xxxxxx) is server-assigned.
- **`POST /api/v1/leases/create`** — Always lands in `draft`; a create that could go straight to `active` would skip the one moment either party gets to look at it. The landlord is taken from the property, never from the body — a body that could name the landlord would let somebody draw up a lease over a building they have nothing to do with. `leaseEnd` is OPTIONAL: month-to-month is ordinary in The Gambia, and a required end date forces whoever writes the lease to invent one that then looks like a commitment. Nobody may name themselves as the tenant, and a landlord cannot be their own tenant — the same principle as nobody producing evidence about themselves.
- **`POST /api/v1/leases/activate`** — The landlord's act: it is their property and their commitment. A coordinator is refused with a message saying so rather than a bare 403. The actor's party is resolved from the loaded lease, never from anything the caller asserted.
- **`POST /api/v1/leases/complete`** — Terminal. A renewal is a NEW lease, not a resurrection of this one — reopening would silently rewrite the tenancy length that feeds an applicant's stability score. Stamps `closedAt`, which is when the tenancy actually stopped, as distinct from `leaseEnd`, which is when the term was meant to run out. A tenancy in arrears is still completable: refusing to close a lease because the tenant owes money would trap both parties in it.
- **`POST /api/v1/leases/terminate`** — A COORDINATOR'S ACT, NOT A LANDLORD'S. Ending a tenancy early is eviction by another name, and LRMC carries the tenancy, holds the deposit and answers for the outcome — the same principle as a landlord not approving their own applicant. A landlord attempting it is told to ask their coordinator rather than given a bare refusal. A reason is required by both the schema and the lifecycle rules: a terminated lease with no stated reason is a fact about somebody's housing that nobody has to defend.
- **`GET /api/v1/leases/user/:userId`** — Both sides at once, because the same account can be a tenant of one property and the landlord of another and that is one screen. A person always sees their own; coordinators and staff see anyone's; everybody else is REFUSED rather than answered with an empty list — "you may not see this" and "there is nothing here" are different facts.
- **`GET /api/v1/leases/property/:propertyId`** — The landlord who owns it, coordinators and staff. A tenant may read their own lease at /leases/user/:userId but NOT the succession of everybody who lived there before them — that is the previous tenants' business, not the current one's.
- **`POST /api/v1/lease/:leaseId/payments`** — Writes the ledger row and rolls the lease's totalPaid, arrearsAmount and lastPaymentAt forward in the same request; clears `inArrears` when the balance reaches zero.
- **`GET /api/v1/lease/:leaseId/schedule`** — Computed from the term and the running total — no schedule rows are stored, so a corrected rent or start date reshapes the statement rather than leaving stale instalments behind.
- **`POST /api/v1/leases/run-rent-reminders`** — Idempotent, and the scheduling is external: a platform cron calls this. `asOf` replays a day the job missed; `dryRun` reports without sending or writing. Doubles as the arrears sweep, so a lease that fell behind overnight is relabelled before anyone looks at it.


### Maintenance & work orders

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/maintenance-requests` | D · Member | `maintenanceRequest:read`<br>`maintenanceRequest:readOwn` | scoped | query: `listQuery` | _all except_ DR RI AD ME SE CU BU PU |
| `POST` | `/api/v1/maintenance-requests` | D · Member | `maintenanceRequest:create` | — | body: `createMaintenanceRequestSchema` | FN CO TE AH HO RE RC |
| `GET` | `/api/v1/maintenance-request/:requestId` | D · Member | `maintenanceRequest:read`<br>`maintenanceRequest:readOwn` | scoped | — | _all except_ DR RI AD ME SE CU BU PU |
| `PATCH` | `/api/v1/maintenance-request/:requestId` | D · Member | `maintenanceRequest:update` | scoped | body: `updateMaintenanceRequestSchema` | FN BO CO VE |
| `POST` | `/api/v1/maintenance/request` | D · Member | `maintenanceRequest:create` | — | body: `raiseMaintenanceSchema` | FN CO TE AH HO RE RC |
| `POST` | `/api/v1/maintenance/update` | D · Member | `maintenanceRequest:update`<br>`maintenanceRequest:updateOwn` | — | body: `updateMaintenanceStatusSchema` | FN BO CO VE |
| `GET` | `/api/v1/maintenance/:userId/list` | D · Member | `maintenanceRequest:read`<br>`maintenanceRequest:readOwn` | scoped | query: `listQuery` | _all except_ DR RI AD ME SE CU BU PU |
| `GET` | `/api/v1/maintenance/:userId/summary` | D · Member | `maintenanceRequest:read`<br>`maintenanceRequest:readOwn` | scoped | — | _all except_ DR RI AD ME SE CU BU PU |
| `POST` | `/api/v1/maintenance-request/:requestId/assign-vendor` | C · Back Office | `maintenanceRequest:assign`<br>`maintenanceRequest:update` | — | body: `assignVendorSchema` | FN BO |
| `GET` | `/api/v1/maintenance-request/:requestId/sla` | D · Member | `maintenanceRequest:read`<br>`maintenanceRequest:readOwn` | scoped | — | _all except_ DR RI AD ME SE CU BU PU |
| `POST` | `/api/v1/maintenance-requests/run-sla-escalation` | C · Back Office | `maintenanceRequest:update`<br>`maintenanceRequest:read` | — | body: `runSlaEscalationSchema` | FN EX BO |
| `GET` | `/api/v1/vendor/me/maintenance-queue` | D · Member | `maintenanceRequest:readOwn`<br>`maintenanceRequest:read` | self | query: `listQuery` | _all except_ DR RI AD ME SE CU BU PU |
| `GET` | `/api/v1/property/:propertyId/maintenance-history` | D · Member | `maintenanceRequest:read`<br>`maintenanceRequest:readOwn` | scoped | query: `listQuery` | _all except_ DR RI AD ME SE CU BU PU |

**Notes**

- **`POST /api/v1/maintenance/request`** — Accepts only what a person standing in front of a broken thing can supply — where, what, how bad. The SLA clock is derived from the priority and the property's standing coordinator is attached, so the request has an owner from the first second rather than waiting for triage to notice it. `slaHours`, `assignedVendor` and every cost field are refused by the strict schema rather than silently dropped: a field ignored and a field honoured look identical from a client. Photographs are storage keys, never URLs.
- **`POST /api/v1/maintenance/update`** — The request id is in the body rather than the path, which is a departure from this platform's convention and costs a readable audit trail — every update shares one route, so a reader of the log must open the entry to see which request moved. PATCH /maintenance-request/:requestId is the better route for anything programmatic. Safety does not depend on the route shape: the actor's party (raiser, vendor, staff) is resolved from the loaded row, never from anything the caller asserted. A vendor may start, pause and finish; only LRMC may cancel or verify; and the vendor who did the work can never be the one who verifies it. Cancelling or parking a request requires a reason, because whoever raised it is told what happened.
- **`GET /api/v1/maintenance/:userId/list`** — Covers three relationships at once: raised by them, assigned to them as a vendor, and against a property they own. A landlord's maintenance is the maintenance on their buildings, which is a different question from what they personally reported, so ownership is resolved through the property collection rather than assumed. Reading somebody else's needs a staff role and is refused rather than answered empty.
- **`GET /api/v1/maintenance/:userId/summary`** — Uses the same buckets as /stats/maintenance, so a tile and a summary can never disagree about what "open" means. `stalled` is reported rather than hidden so the parts sum to the total. `needsEscalation` is computed from the current state on every read and never stored — a request does not become escalated, it becomes somebody's, and a stored flag would go stale the moment a vendor picked the job up. `averageResolutionHours` is null over nothing resolved, never 0: a landlord whose first request is still open has not achieved a nought-hour turnaround.
- **`POST /api/v1/maintenance-request/:requestId/assign-vendor`** — Refuses a vendor whose verificationStatus is not `verified`, and appends to `statusHistory` so the assignment is answerable after a disputed invoice.
- **`GET /api/v1/maintenance-request/:requestId/sla`** — `dueAt` is the target; `overdueAt` adds a grace period, after which it escalates to a human. A finished request is judged against when it finished, not against now.
- **`POST /api/v1/maintenance-requests/run-sla-escalation`** — Notifies only — it never changes a request's status, because "nobody has done this work" is not a state the work order should claim on its own behalf.
- **`GET /api/v1/vendor/me/maintenance-queue`** — Completed, verified and cancelled work is filtered out — this is a queue, not a history.


### Ride dispatch (Ususu)

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/rides` | D · Member | `ride:read`<br>`ride:readOwn` | scoped | query: `listQuery` | FN EX BO DR RI |
| `POST` | `/api/v1/rides/requests` | D · Member | `ride:create` | self | body: `requestRideSchema` | FN RI |
| `GET` | `/api/v1/ride/:rideId` | D · Member | `ride:read`<br>`ride:readOwn` | scoped | — | FN EX BO DR RI |
| `PATCH` | `/api/v1/ride/:rideId` | D · Member | `ride:update` | scoped | body: `updateRideSchema` | FN DR RI |
| `POST` | `/api/v1/ride/:rideId/accept` | D · Member | `ride:update`<br>`ride:readOwn` | self | body: `acceptRideSchema` | FN EX BO DR RI |
| `POST` | `/api/v1/ride/:rideId/start` | D · Member | `ride:update` | scoped | body: `startRideSchema` | FN DR RI |
| `POST` | `/api/v1/ride/:rideId/complete` | D · Member | `ride:update` | scoped | body: `completeRideSchema` | FN DR RI |
| `POST` | `/api/v1/ride/:rideId/cancel` | D · Member | `ride:update` | scoped | body: `cancelRideSchema` | FN DR RI |
| `GET` | `/api/v1/ride/:rideId/matches` | D · Member | `ride:read`<br>`ride:update` | scoped | query: `listQuery` | FN EX BO DR RI |
| `GET` | `/api/v1/driver/me/dispatch-queue` | D · Member | `ride:readOwn`<br>`ride:read` | self | query: `listQuery` | FN EX BO DR RI |
| `GET` | `/api/v1/driver/me/rides` | D · Member | `ride:readOwn`<br>`ride:read` | self | query: `listQuery` | FN EX BO DR RI |
| `GET` | `/api/v1/rider/me/rides` | D · Member | `ride:readOwn`<br>`ride:read` | self | query: `listQuery` | FN EX BO DR RI |

**Notes**

- **`POST /api/v1/rides/requests`** — The rider is resolved from the token, never from the body. Fare and driver are the server's to decide; the ride opens in `searching`.
- **`PATCH /api/v1/ride/:rideId`** — Lifecycle changes go through the transition endpoints; this is for corrections only.
- **`POST /api/v1/ride/:rideId/accept`** — Verified drivers only. Guarded by `RIDE_TRANSITIONS` and an optimistic-concurrency filter on the current status, so two drivers cannot both claim one ride.
- **`POST /api/v1/ride/:rideId/complete`** — Splits the platform commission and creates the `Payment` in the same request — a completed ride with no ledger row is an earnings dispute.
- **`POST /api/v1/ride/:rideId/cancel`** — Resolves to `cancelledByDriver` or `cancelledByRider` from the caller's role, so the cancellation rate attaches to whoever actually cancelled.
- **`GET /api/v1/ride/:rideId/matches`** — Hard filters first (verified, active, fresh heartbeat, right vehicle, in region, within radius), then a weighted score. The rejection tally comes back too. Deterministic: ties break on driver id.
- **`GET /api/v1/driver/me/dispatch-queue`** — Verified drivers only, narrowed to the driver's own region, oldest request first.


### Payments ledger

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/payments` | C · Back Office | `payment:read` | scoped | query: `listQuery` | FN EX BO |
| `GET` | `/api/v1/payment/:paymentId` | C · Back Office | `payment:read`<br>`payment:readOwn` | scoped | — | FN EX BO |
| `GET` | `/api/v1/payments/:userId/history` | D · Member | `payment:readOwn`<br>`payment:read` | scoped | query: `listQuery` | _all except_ SE BU PU |
| `GET` | `/api/v1/payments/:userId/summary` | D · Member | `payment:readOwn`<br>`payment:read` | scoped | — | _all except_ SE BU PU |
| `POST` | `/api/v1/payments/webhooks/stripe` | E · Public | _none_ | — | — | _anyone_ |
| `POST` | `/api/v1/payments/record` | D · Member | `payment:record` | — | body: `recordPaymentSchema` | FN EX BO CO |
| `GET` | `/api/v1/tenant/me/payments` | D · Member | `payment:readOwn`<br>`payment:read` | self | query: `listQuery` | _all except_ SE BU PU |
| `GET` | `/api/v1/landlord/me/payments` | D · Member | `payment:readOwn`<br>`payment:read` | self | query: `listQuery` | _all except_ SE BU PU |
| `GET` | `/api/v1/driver/me/payments` | D · Member | `payment:readOwn`<br>`payment:read` | self | query: `listQuery` | _all except_ SE BU PU |
| `GET` | `/api/v1/advertiser/me/payments` | D · Member | `payment:readOwn`<br>`payment:read` | self | query: `listQuery` | _all except_ SE BU PU |

**Notes**

- **`GET /api/v1/payments`** — One collection for every kind of money movement — rent, deposits, fares, payouts, ad spend, vendor invoices, fees, refunds.
- **`GET /api/v1/payment/:paymentId`** — `providerReference` is `select: false` and never leaves the server on a read.
- **`GET /api/v1/payments/:userId/history`** — A person always sees their own. Back Office, HQ and the founder see anyone's. A COORDINATOR SEES ONLY THE RECEIPTS THEY WROTE THEMSELVES — recording a payment and reading a year of somebody's finances are different powers, and holding the first does not grant the second. Anyone else is refused rather than answered with an empty list: "you may not see this" and "there is nothing here" are different facts.
- **`GET /api/v1/payments/:userId/summary`** — Computed over the whole history, never a page. `onTimeRate` is (onTime / (onTime + late)) * 100 and is NULL when nothing has settled — never 0, which would tell somebody on their first day that none of their payments were on time. NOTE this is not the same figure as `paymentReliability` in an application assessment, which also counts missed instalments in the denominator; the two are labelled differently on purpose and must not be reconciled by relabelling one. `scope` and `partial` say whose rows the totals cover, so a coordinator reading their own receipts does not mistake them for the whole.
- **`POST /api/v1/payments/webhooks/stripe`** — THE ONLY THING ON THIS PLATFORM THAT MAY MOVE AN ORDER TO PAID. Unauthenticated because Stripe holds no LRMC session; the authentication is the HMAC-SHA256 signature over the RAW body, verified constant-time against STRIPE_WEBHOOK_SECRET with a 300-second replay window. `app.ts` mounts express.raw for this path alone, before the JSON parser, because a re-serialised body does not verify and the tempting fix for that is to weaken the check. Idempotent by a unique index on the event id: the event is CLAIMED before any work and stamped applied after, so a crash in between is retryable and a duplicate delivery does nothing — Stripe retries anything non-2xx for days and delivers duplicates in ordinary operation, so a handler that books income per delivery pays a merchant twice. Every settlement is reconciled against the order for subject, amount and currency, exactly — an overpayment is a support conversation, not a settlement. Answers 200 to duplicates, unhandled types and unknown orders because retrying cannot fix any of them; the only 4xx is a bad signature, which is never Stripe. Side effects (stock, notification) run AFTER the ledger row, so a failed notification can never unwind a payment.
- **`POST /api/v1/payments/record`** — The ledger is otherwise written only by the flows that cause it. This exists because The Gambia runs on cash and mobile money, and refusing to record a cash rent payment would leave a tenant who has paid on time for two years with `hasRecord: false` in their evidence — pushing the informal economy out of the scoring engine entirely. Fenced accordingly: ONLY rent and deposits (never a payout, which would mark money as sent that was never sent); NOBODY may record a payment they are party to as payer or payee; `recordedBy` comes from the token and can not be supplied; `status` is always succeeded and can not be supplied; the reference is derived from payer, subject, kind, amount and day so a double tap on a bad connection collides instead of doubling a tenant's rent — the collision is returned as a 409 for a person to resolve, never swallowed.


### Payout batches & settlement

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/payout-batches` | C · Back Office | `payout:read` | — | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/payout-batches` | C · Back Office | `payout:create` | — | body: `buildPayoutBatchSchema` | FN BO |
| `GET` | `/api/v1/payout-batch/:batchId` | C · Back Office | `payout:read` | — | — | FN EX BO |
| `GET` | `/api/v1/payout-batch/:batchId/lines` | C · Back Office | `payout:read` | — | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/payout-batch/:batchId/settle` | A · Founder | `payout:settle` | — | body: `settlePayoutBatchSchema` | FN |
| `POST` | `/api/v1/payout-batch/:batchId/cancel` | C · Back Office | `payout:update` | — | body: `cancelPayoutBatchSchema` | FN BO |

**Notes**

- **`GET /api/v1/payout-batches`** — A batch is an instruction to move money; `Payment` records money that has moved. Keeping them apart is what lets the ledger stay read-only over HTTP while payouts still have a create route.
- **`POST /api/v1/payout-batches`** — The request is a query — kind, currency, window — and the server computes the lines. Nothing a client sends becomes an amount. Rows already claimed by a live batch are excluded, so nobody is paid twice.
- **`POST /api/v1/payout-batch/:batchId/settle`** — Founder-only. Back Office assembles, a principal releases. The caller must echo the net total, and each transfer carries the line id as its idempotency key so a retried settle does not pay twice. Never reports `settled`: the rail returns `pending` and the batch moves to `settling`.
- **`POST /api/v1/payout-batch/:batchId/cancel`** — Only from `draft` or `approved`. A batch already with the rail cannot be recalled here.


### Notifications & push

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `POST` | `/api/v1/notifications/register-token` | D · Member | _auth only_ | self | body: `registerPushTokenSchema` | _all except_ PU |
| `GET` | `/api/v1/notifications/me` | D · Member | `notification:readOwn`<br>`notification:read` | self | query: `listQuery` | _all except_ PU |
| `POST` | `/api/v1/notifications/test` | B · HQ Exec | `notification:create` | — | body: `sendTestNotificationSchema` | FN EX |
| `POST` | `/api/v1/notifications/broadcast` | B · HQ Exec | `notification:create` | — | body: `broadcastNotificationSchema` | FN EX |
| `PATCH` | `/api/v1/notification/:notificationId` | D · Member | `notification:updateOwn`<br>`notification:readOwn` | self | body: `markNotificationSchema` | _all except_ PU |

**Notes**

- **`POST /api/v1/notifications/register-token`** — Upserts on the token, not on (user, device): a handset can change hands. The token is `select: false` and is stripped from the response — it is a capability to reach a phone.
- **`POST /api/v1/notifications/test`** — Founder and HQ executive only. Exists so an operator can prove the pipe works without waiting for a real rent reminder to fall due.
- **`POST /api/v1/notifications/broadcast`** — Founder and HQ executive only. Aimed at a role, never at a client-supplied recipient list. Capped, and the cap is reported rather than silently applied.
- **`PATCH /api/v1/notification/:notificationId`** — Matched on recipient as well as id, so one member cannot mark another member's mail read.


### Document Engine: verification, compliance & expiry

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/documents` | C · Back Office | `document:read` | scoped | query: `documentQuery` | FN EX BO |
| `POST` | `/api/v1/documents` | D · Member | `document:create` | — | body: `createDocumentSchema` | _all except_ EX BU PU |
| `GET` | `/api/v1/document/:documentId` | D · Member | `document:read`<br>`document:readOwn` | scoped | — | _all except_ BU PU |
| `PATCH` | `/api/v1/document/:documentId` | D · Member | `document:update`<br>`document:updateOwn` | scoped | body: `updateDocumentSchema` | _all except_ EX CO SE CU BU PU |
| `DELETE` | `/api/v1/document/:documentId` | D · Member | `document:delete` | scoped | — | FN |
| `POST` | `/api/v1/document/:documentId/submit` | D · Member | `document:create`<br>`document:updateOwn` | scoped | body: `submitDocumentSchema` | _all except_ EX BU PU |
| `POST` | `/api/v1/document/:documentId/review` | C · Back Office | `document:review`<br>`document:update` | — | body: `reviewDocumentSchema` | FN EX BO |
| `POST` | `/api/v1/document/:documentId/request-info` | C · Back Office | `document:review`<br>`document:update` | — | body: `requestInfoSchema` | FN EX BO |
| `POST` | `/api/v1/document/:documentId/verify` | C · Back Office | `document:verify`<br>`document:review` | — | body: `verifyDocumentSchema` | FN EX BO |
| `POST` | `/api/v1/document/:documentId/reject` | C · Back Office | `document:review`<br>`document:update` | — | body: `rejectDocumentSchema` | FN EX BO |
| `POST` | `/api/v1/document/:documentId/expire` | C · Back Office | `document:update`<br>`document:review` | — | body: `expireDocumentSchema` | FN EX BO |
| `POST` | `/api/v1/document/:documentId/reverify` | C · Back Office | `document:verify`<br>`document:review` | — | body: `reverifyDocumentSchema` | FN EX BO |
| `GET` | `/api/v1/document/:documentId/verification-summary` | C · Back Office | `document:read`<br>`document:readOwn` | scoped | — | FN EX BO |
| `GET` | `/api/v1/member/me/documents` | D · Member | `document:readOwn`<br>`document:read` | self | query: `documentQuery` | _all except_ BU PU |
| `GET` | `/api/v1/staff/me/document-queue` | C · Back Office | `document:review`<br>`document:read` | self | query: `documentQuery` | FN EX BO |
| `GET` | `/api/v1/hq/documents` | B · HQ Exec | `document:read` | — | query: `documentQuery` | FN EX |
| `GET` | `/api/v1/hq/documents/analytics` | B · HQ Exec | `document:read` | — | query: `documentAnalyticsQuery` | FN EX |

**Notes**

- **`POST /api/v1/documents`** — Fields are validated against the type's rules before anything is written; an unexpected field is rejected rather than dropped. The desk, the expiry date and the first score are all derived here, so a document is never queued without knowing who reviews it or when it lapses.
- **`GET /api/v1/document/:documentId`** — `storageKey` is `select: false` and never returned; a signed URL is minted on demand.
- **`PATCH /api/v1/document/:documentId`** — A verified document freezes its identity — type, holder, number, dates. Those are what somebody signed off on; letting them change afterwards would make "verified" mean only that something was verified once. Returns 409 on a locked field.
- **`DELETE /api/v1/document/:documentId`** — Refused on a verified record: evidence somebody relied on is not the holder’s to remove. Withdrawing it is an HQ act through the audit trail.
- **`POST /api/v1/document/:documentId/submit`** — The one transition the holder performs on their own document. A re-submission bumps the version so the new scan is a new storage key and the reviewer can still see what they turned down.
- **`POST /api/v1/document/:documentId/review`** — Claims it for a desk so two reviewers do not both start on it.
- **`POST /api/v1/document/:documentId/request-info`** — A reason is mandatory: asking for more without saying what is how a verification queue stalls. 422 without one.
- **`POST /api/v1/document/:documentId/verify`** — The only gated transition, gated twice: compliance must be clear of blocking failures (an advisory one may be overridden by a reviewer who has read it, a blocking one never), and the score must clear the floor. Freezes the evidence in object storage on success. A reviewer may not verify their own submission.
- **`POST /api/v1/document/:documentId/reject`** — The decision most likely to be challenged, so it is unusable without a stated reason and an audit entry naming who made it.
- **`POST /api/v1/document/:documentId/expire`** — The clock's doing rather than a person's, so no reviewer is required — but still audited. Refused while the document is in date: expiring something early would be a policy decision dressed up as bookkeeping.
- **`POST /api/v1/document/:documentId/reverify`** — Where it lands depends on the type: one flagged `reverifyOnExpiry` re-enters review, because a lapsed criminal record check is not renewed by re-uploading the same PDF. Everything else goes back to the holder for a fresh copy.
- **`GET /api/v1/document/:documentId/verification-summary`** — What a reviewer’s verify button reads. `verifiable` is the AND of all four inputs, with each shown beside it.
- **`GET /api/v1/staff/me/document-queue`** — Narrowed to the desks the caller’s role actually reviews — a coordinator should not be looking at criminal record checks — and ordered oldest first, because a verification queue sorted any other way starves its tail.
- **`GET /api/v1/hq/documents/analytics`** — The four numbers HQ actually asks for: how much is waiting, how long it has waited, how much is lapsing, and how often the answer is no.


### FAC: Founder Authorisation Code

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/fac-codes` | A · Founder | `fac:read` | — | query: `facCodeQuery` | FN |
| `POST` | `/api/v1/fac-codes` | A · Founder | `fac:create` | — | body: `issueFacCodeSchema` | FN |
| `GET` | `/api/v1/fac-code/:codeId` | A · Founder | `fac:read` | — | — | FN |
| `POST` | `/api/v1/fac-code/:codeId/revoke` | A · Founder | `fac:revoke` | — | body: `revokeFacCodeSchema` | FN |
| `GET` | `/api/v1/fac/attempts` | A · Founder | `fac:read` | — | query: `facAttemptQuery` | FN |
| `GET` | `/api/v1/fac/lockouts` | A · Founder | `fac:read` | — | — | FN |
| `POST` | `/api/v1/fac/lockout/:actorId/clear` | A · Founder | `fac:update`<br>`fac:create` | — | body: `clearLockoutSchema` | FN |
| `GET` | `/api/v1/fac/me/clearance` | B · HQ Exec | `fac:verify`<br>`fac:read` | self | — | FN EX |
| `POST` | `/api/v1/fac/verify` | B · HQ Exec | `fac:verify` | self | body: `verifyFacCodeSchema` | FN EX |
| `POST` | `/api/v1/fac/me/clearance/revoke` | B · HQ Exec | `fac:verify` | self | — | FN EX |
| `POST` | `/api/v1/fac/reset-requests` | B · HQ Exec | `fac:verify`<br>`fac:read` | — | body: `facResetRequestSchema` | FN EX |

**Notes**

- **`GET /api/v1/fac-codes`** — Metadata only. The digest is `select: false` and stripped from every serialised body.
- **`POST /api/v1/fac-codes`** — Founder-only. The plaintext is returned exactly once and is not recoverable. The body cannot supply a code — the server generates it from a CSPRNG and rejection-samples against the weakness rules. The previous generation is superseded in the same operation, and an immediate trigger (compromise, roleChange) also closes every live clearance.
- **`POST /api/v1/fac-code/:codeId/revoke`** — Founder-only. Leaves no code in force, which closes Zone A to everyone and caps governance health at 40 — the intended outcome for a suspected compromise.
- **`GET /api/v1/fac/attempts`** — Zone A: it names who tried and when. `blocked` rows record that somebody kept trying after a lockout began.
- **`GET /api/v1/fac/lockouts`** — Makes the override discoverable. A recovery path that requires already knowing a user id is a puzzle, not a recovery path.
- **`POST /api/v1/fac/lockout/:actorId/clear`** — Founder-only, and the caller must already hold a live clearance — so the override costs a second person and a second code, never less than the thing it bypasses. Nobody can clear their own lockout. Writes a `cleared` row naming who lifted it and why; the failures stay in the ledger.
- **`GET /api/v1/fac/me/clearance`** — What the console polls to decide whether to enable the form, and what to print in "attempts remaining".
- **`POST /api/v1/fac/verify`** — Zone B, not Zone A — the code is what opens Zone A, so gating this behind it would be a locked door with the key inside. A failure is 422 and never says why. A lockout is 423 with the instant it lifts, not 403: the caller is entitled and the door will open by itself.
- **`POST /api/v1/fac/me/clearance/revoke`** — A founder leaving a console should not leave it open.
- **`POST /api/v1/fac/reset-requests`** — Notifies every founder. Does not rotate anything — only a founder can issue a generation.


### Governance tiers, visibility & health

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/governance/tiers` | C · Back Office | `governance:read` | — | query: `governanceQuery` | FN EX BO |
| `GET` | `/api/v1/governance/visibility-matrix` | C · Back Office | `governance:read` | — | — | FN EX BO |
| `GET` | `/api/v1/governance/me/visibility` | D · Member | _auth only_ | self | — | _all except_ PU |
| `GET` | `/api/v1/governance/health` | B · HQ Exec | `governance:read`<br>`analytics:read` | — | — | FN EX |

**Notes**

- **`GET /api/v1/governance/tiers`** — Filtered to what the caller's own tier may see — a coordinator gets staff and membership and does not learn how many founders there are. `withheld` is reported rather than the list silently coming back short.
- **`GET /api/v1/governance/visibility-matrix`** — The console renders the same rule the server enforces, rather than a hand-copied duplicate that drifts.
- **`GET /api/v1/governance/me/visibility`** — The one call the console needs to decide whether to render the seal, show Tier 1, or draw the locked overlay. `sealEligible` and `sealVisible` are separate: a founder without a live clearance is the first and not the second.
- **`GET /api/v1/governance/health`** — Every component is computed from something the platform measures. One with no data is excluded rather than scored zero, and a missing or expired code caps the composite at 40.


### Commercial client accounts

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/commercial-clients` | C · Back Office | `commercialClient:read` | scoped | query: `listQuery` | FN EX BO |
| `POST` | `/api/v1/commercial-clients` | C · Back Office | `commercialClient:create` | — | body: `createCommercialClientSchema` | FN BO |
| `GET` | `/api/v1/commercial-client/:clientId` | C · Back Office | `commercialClient:read`<br>`commercialClient:readOwn` | scoped | — | FN EX BO |
| `PATCH` | `/api/v1/commercial-client/:clientId` | C · Back Office | `commercialClient:update` | scoped | body: `updateCommercialClientSchema` | FN BO |
| `GET` | `/api/v1/commercial-client/:clientId/properties` | C · Back Office | `commercialClient:read`<br>`commercialClient:readOwn` | scoped | query: `listQuery` | FN EX BO |
| `GET` | `/api/v1/commercial-client/:clientId/analytics` | C · Back Office | `commercialClient:read`<br>`commercialClient:readOwn` | scoped | query: `analyticsQuery` | FN EX BO |
| `GET` | `/api/v1/commercial-client/:clientId/fleet` | C · Back Office | `commercialClient:read`<br>`commercialClient:readOwn` | scoped | — | FN EX BO |
| `GET` | `/api/v1/commercial-client/:clientId/ads` | C · Back Office | `commercialClient:read`<br>`commercialClient:readOwn` | scoped | query: `listQuery` | FN EX BO |

**Notes**

- **`POST /api/v1/commercial-clients`** — The contracting entity above the operational profiles: one hospitality group can hold several hotel, resort and advertiser profiles.
- **`GET /api/v1/commercial-client/:clientId/properties`** — Rolls up `linkedProperties` and everything owned by a linked profile, so the account manager sees one portfolio rather than nine.
- **`GET /api/v1/commercial-client/:clientId/analytics`** — The composite `healthScore` averages only the dimensions the client actually has — a landlord group with no vehicles is not marked down for a fleet it does not own.


### Public Portal

| Method | Path | Zone | Permission (any of) | Own | Request | Roles |
|---|---|---|---|---|---|---|
| `GET` | `/api/v1/public/content` | E · Public | _auth only_ | — | query: `?page&limit&contentType&domain&locale` | _all roles_ |
| `GET` | `/api/v1/public/content/:slug` | E · Public | _auth only_ | — | — | _all roles_ |
| `POST` | `/api/v1/public/track` | E · Public | _auth only_ | — | body: `trackTrafficSchema` | _all roles_ |
| `GET` | `/api/v1/public/metrics` | E · Public | `publicMetrics:read` | — | query: `?days` | FN EX PU |
| `GET` | `/api/v1/public/admin/content` | E · Public | `publicContent:read` | — | query: `listQuery` | FN PU |
| `POST` | `/api/v1/public/admin/content` | E · Public | `publicContent:create` | — | body: `createContentSchema` | FN |
| `PATCH` | `/api/v1/public/admin/content/:contentId` | E · Public | `publicContent:update` | — | body: `updateContentSchema` | FN |
| `POST` | `/api/v1/public/admin/content/:contentId/publish` | E · Public | `publicContent:publish` | — | — | FN |
| `DELETE` | `/api/v1/public/admin/content/:contentId` | E · Public | `publicContent:delete` | — | — | FN |

---

## Invariants asserted by `npm run verify`

The blueprint is checked, not trusted. Every generation run is accompanied by
assertions that:

- every declared path is unique per method, and every permission string names a
  real `resource` and `action`;
- **no endpoint is unreachable** — a gated route that no role can call is a dead
  route, and dead routes hide mistakes;
- **Zone A is founder-only** and **Zone B is HQ-only**, computed from the role
  matrix rather than asserted in prose;
- **no member-facing role reaches a Back Office route**;
- every public endpoint is genuinely reachable by an anonymous `publicUser`;
- every `/me` route is `self`-scoped;
- **no literal path is shadowed by an earlier parameterised route** (currently none) —
  this is what keeps `GET /drivers/verification-queue` from being swallowed by
  `GET /drivers/:id`;
- each profile collection exposes its full surface, and declares its ownership
  wiring;
- each **operational** collection (leases, maintenance requests, rides, payments,
  commercial clients) declares a plural/singular pair with a named id parameter,
  an explicit response component on every operation — no bare `{type: object}` —
  and a `/me` view that is `self`-scoped and paginated;
- **the payments ledger is read-only over HTTP.** Money is written by the flow
  that causes it (`POST /lease/:leaseId/payments`, `POST /ride/:rideId/complete`),
  never by a client asserting that money moved;
- **the ride state machine is closed**: every transition target is a real status,
  every status is reachable from `requested`, the four terminal states lead
  nowhere, and nothing reaches `completed` except from `inProgress`.

Separately, `assertBlueprintMatchesRouters()` runs at boot outside production and
diffs this declaration against what Express actually mounted, so a route added
without a blueprint entry surfaces on the next `npm run dev`.

## Live contract

`GET /api/v1/_blueprint` returns this same data as JSON, filtered to the
endpoints the calling role can actually reach. That is what the PWA shells should
build navigation and route guards from: instead of each frontend hard-coding
"hide this unless the user is `backOfficeStaff`", it asks the server. A role
change in `config/roles.ts` then propagates to every client with no frontend
deploy. A founder may pass `?all=true` to see the unfiltered contract with the
computed role list on each endpoint.
