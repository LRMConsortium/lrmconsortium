/**
 * Renders `docs/API-BLUEPRINT.md` from `config/apiBlueprint.ts`.
 *
 *   npm run blueprint
 *
 * The document is generated, never edited by hand — that is the only way a
 * reference this size stays true. Role access columns are computed from
 * `ROLE_DEFINITIONS`, so the tables reflect the RBAC config at generation time
 * rather than somebody's memory of it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  API_BLUEPRINT,
  PROFILE_MODULES,
  SCOPE_TABLE,
  blueprintByModule,
  profileEndpoints,
  resolveBlueprint,
  shadowedPaths,
  type ResolvedEndpoint,
} from '../config/apiBlueprint.js';
import { HQ_ZONES, HQ_ZONE_DEFINITIONS } from '../config/hqZones.js';
import { ROLES, ROLE_DEFINITIONS, type Role } from '../config/roles.js';

const OUT = resolve(process.cwd(), 'docs/API-BLUEPRINT.md');
const PREFIX = '/api/v1';

const SHORT: Record<Role, string> = {
  founder: 'FN',
  hqExecutive: 'EX',
  backOfficeStaff: 'BO',
  coordinator: 'CO',
  vendor: 'VE',
  landlord: 'LL',
  tenant: 'TE',
  airbnbHost: 'AH',
  hotelManager: 'HO',
  resortManager: 'RE',
  rentalCarCompany: 'RC',
  driver: 'DR',
  rider: 'RI',
  advertiser: 'AD',
  merchant: 'ME',
  seller: 'SE',
  customer: 'CU',
  buyer: 'BU',
  publicUser: 'PU',
};

const ZONE_SHORT: Record<string, string> = {
  FOUNDER_COMMAND_CENTER: 'A · Founder',
  HQ_EXECUTIVE: 'B · HQ Exec',
  BACK_OFFICE: 'C · Back Office',
  MEMBER_PORTAL: 'D · Member',
  PUBLIC_PORTAL: 'E · Public',
};

const OWNERSHIP_LABEL: Record<string, string> = {
  none: '—',
  scoped: 'scoped',
  self: 'self',
};

function cell(value: string | undefined): string {
  return value && value.length > 0 ? value.replace(/\|/g, '\\|') : '—';
}

function rolesCell(ep: ResolvedEndpoint): string {
  if (ep.auth === 'none') return '_anyone_';
  if (ep.roles.length === ROLES.length) return '_all roles_';
  if (ep.roles.length > 9) {
    const excluded = ROLES.filter((r) => !ep.roles.includes(r));
    return `_all except_ ${excluded.map((r) => SHORT[r]).join(' ')}`;
  }
  return ep.roles.map((r) => SHORT[r]).join(' ');
}

function endpointTable(endpoints: ResolvedEndpoint[]): string {
  const header =
    '| Method | Path | Zone | Permission (any of) | Own | Request | Roles |\n' +
    '|---|---|---|---|---|---|---|';
  const rows = endpoints.map((ep) => {
    const path = `\`${PREFIX}${ep.path === '/' ? '' : ep.path}\``;
    const zone = ep.zone ? ZONE_SHORT[ep.zone] ?? ep.zone : '—';
    const perms = ep.permissions.length
      ? ep.permissions.map((p) => `\`${p}\``).join('<br>')
      : ep.auth === 'none'
        ? '_none_'
        : '_auth only_';
    const request = cell(
      [ep.requestBody && `body: \`${ep.requestBody}\``, ep.requestQuery && `query: \`${ep.requestQuery}\``]
        .filter(Boolean)
        .join('<br>'),
    );
    return `| \`${ep.method}\` | ${path} | ${zone} | ${perms} | ${OWNERSHIP_LABEL[ep.ownership]} | ${request} | ${rolesCell(ep)} |`;
  });
  return [header, ...rows].join('\n');
}

function notesList(endpoints: ResolvedEndpoint[]): string {
  const withNotes = endpoints.filter((e) => e.notes);
  if (withNotes.length === 0) return '';
  return (
    '\n' +
    withNotes
      .map((e) => `- **\`${e.method} ${PREFIX}${e.path}\`** — ${e.notes!}`)
      .join('\n') +
    '\n'
  );
}

const resolved = resolveBlueprint();
const byModule = blueprintByModule();
const profileEndpointCount = PROFILE_MODULES.reduce(
  (n, m) => n + profileEndpoints(m).length,
  0,
);
const customCount = resolved.length - profileEndpointCount;
const shadows = shadowedPaths();

const MODULE_TITLES: Record<string, string> = {
  platform: 'Platform',
  auth: 'Auth & RBAC',
  hq: 'HQ zones, dashboards & audit',
  founder: 'Founder profile (Zone A)',
  hqExecutive: 'HQ executive profiles',
  backOfficeStaff: 'Back office staff records',
  landlord: 'Landlords',
  tenant: 'Tenants',
  coordinator: 'Coordinators',
  vendor: 'Vendors',
  property: 'Properties',
  airbnbHost: 'Airbnb hosts',
  hotel: 'Hotels',
  resort: 'Resorts',
  rentalCarCompany: 'Rental car companies',
  driver: 'Drivers (Ususu)',
  rider: 'Riders (Ususu)',
  advertiser: 'Advertiser accounts',
  advertising: 'Advertising: serving, lifecycle & policy',
  lease: 'Leases & rent',
  maintenance: 'Maintenance & work orders',
  ride: 'Ride dispatch (Ususu)',
  payment: 'Payments ledger',
  payout: 'Payout batches & settlement',
  document: 'Document Engine: verification, compliance & expiry',
  fac: 'FAC: Founder Authorisation Code',
  governance: 'Governance tiers, visibility & health',
  notification: 'Notifications & push',
  commercialClient: 'Commercial client accounts',
  publicPortal: 'Public Portal',
};

const MODULE_ORDER = [
  'platform',
  'auth',
  'hq',
  'founder',
  'hqExecutive',
  'backOfficeStaff',
  'landlord',
  'tenant',
  'coordinator',
  'vendor',
  'property',
  'airbnbHost',
  'hotel',
  'resort',
  'rentalCarCompany',
  'driver',
  'rider',
  'advertiser',
  'advertising',
  'lease',
  'maintenance',
  'ride',
  'payment',
  'payout',
  'notification',
  'document',
  'fac',
  'governance',
  'commercialClient',
  'publicPortal',
];

const ordered = [...byModule].sort(
  (a, b) => MODULE_ORDER.indexOf(a.module) - MODULE_ORDER.indexOf(b.module),
);

const lines: string[] = [];

lines.push(
  '# LRMC + Ususu — API Blueprint',
  '',
  '> **Generated file.** Produced by `npm run blueprint` from',
  '> `src/config/apiBlueprint.ts`. Do not edit by hand — edit the declaration.',
  '> The role columns are computed from `src/config/roles.ts`, so they reflect the',
  '> RBAC configuration rather than a hand-maintained table.',
  '',
  `All paths are relative to \`API_PREFIX\` (default \`${PREFIX}\`).`,
  '',
  `**${resolved.length} endpoints** — ${profileEndpointCount} from the generic profile surface across ${PROFILE_MODULES.length} collections, ${customCount} hand-mounted.`,
  '',
  '---',
  '',
  '## How to read this',
  '',
  'Every authenticated request passes three independent gates, in order:',
  '',
  '1. **Zone** — `enterZone(...)`. Is this actor allowed on this surface at all?',
  '   Checked against the role\'s `restrictedZones`, then against the zone\'s own',
  '   `entryPermissions`. Failure is `403 ZONE_RESTRICTED`.',
  '2. **Permission** — `requirePermission(...)`. Any *one* of the listed grants is',
  '   sufficient. Failure is `403 FORBIDDEN`.',
  '3. **Ownership** — `requireOwnership(service)`. For actors whose scope is `own`',
  '   or `organizational`, the record must belong to them; wider scopes pass',
  '   straight through. Failure is `403 FORBIDDEN`.',
  '',
  'The **Own** column says which ownership rule applies:',
  '',
  '| Value | Meaning |',
  '|---|---|',
  '| `—` | No narrowing. The resource is not owned by anyone. |',
  '| `scoped` | `BaseService.scopeFor()` narrows the query; `requireOwnership` guards `:id`. |',
  '| `self` | The record is resolved from the token, never from the URL. |',
  '',
  '### Response envelope',
  '',
  '```jsonc',
  '// success',
  '{ "success": true, "data": { /* … */ } }',
  '',
  '// success, paginated',
  '{ "success": true, "data": [ /* … */ ],',
  '  "meta": { "page": 1, "limit": 20, "total": 84, "totalPages": 5,',
  '            "hasNext": true, "hasPrev": false } }',
  '',
  '// failure',
  '{ "success": false,',
  '  "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed",',
  '             "details": [ { "field": "email", "message": "Invalid email address" } ] } }',
  '```',
  '',
  '`code` is one of `BAD_REQUEST` `VALIDATION_FAILED` `UNAUTHENTICATED` `FORBIDDEN`',
  '`ZONE_RESTRICTED` `NOT_FOUND` `CONFLICT` `DUPLICATE_KEY` `UNPROCESSABLE`',
  '`RATE_LIMITED` `POLICY_VIOLATION` `INTERNAL`.',
  '',
  '### Role abbreviations',
  '',
  '| | | | | |',
  '|---|---|---|---|---|',
);

for (let i = 0; i < ROLES.length; i += 5) {
  const slice = ROLES.slice(i, i + 5);
  const padded = [...slice.map((r) => `\`${SHORT[r]}\` ${r}`)];
  while (padded.length < 5) padded.push('');
  lines.push(`| ${padded.join(' | ')} |`);
}

lines.push(
  '',
  '---',
  '',
  '## The five HQ zones',
  '',
  '| | Zone | Entry requires | Owns |',
  '|---|---|---|---|',
);

for (const zone of HQ_ZONES) {
  const d = HQ_ZONE_DEFINITIONS[zone];
  const entry = d.entryPermissions.length
    ? d.entryPermissions.map((p) => `\`${p}\``).join(', ')
    : '_nothing beyond zone membership_';
  lines.push(`| **${d.code}** | ${d.label} | ${entry} | ${d.purpose} |`);
}

lines.push(
  '',
  'The Public Portal is the open surface: **every role may enter it**, because a',
  'signed-in landlord browsing the property listings is still just a visitor to the',
  'public website. Nothing leaks — Zone E\'s `dataFirewall` blocks ID numbers, rent',
  'and earnings, and administering it (content authoring, traffic metrics) is gated',
  'by `publicContent:*` / `publicMetrics:read`, which no member role holds.',
  '',
  '---',
  '',
  '## The generic profile surface',
  '',
  `\`defineProfileModule\` mounts the same routes for all ${PROFILE_MODULES.length} profile collections,`,
  'in the LRMC convention — **plural for collections, singular for items, with a**',
  '**named id parameter** — and in this registration order (`/me` before the id',
  'route, or Express parses `me` as an id):',
  '',
  '| Method | Path | Zone | Permission | Own |',
  '|---|---|---|---|---|',
  '| `GET` | `/<plural>/me` → **`/<singular>/me`** | member | `<resource>:readOwn` | self |',
  '| `PATCH` | `/<singular>/me` | member | `<resource>:updateOwn` | self |',
  '| `GET` | `/<plural>` | admin | `<resource>:read` | scoped |',
  '| `POST` | `/<plural>` | admin | `<resource>:create` | — |',
  '| `GET` | `/<singular>/:<name>Id` | admin | `<resource>:read` or `:readOwn` | scoped |',
  '| `PATCH` | `/<singular>/:<name>Id` | admin | `<resource>:update` or `:updateOwn` | scoped |',
  '| `PATCH` | `/<singular>/:<name>Id/verify` | admin | `<resource>:verify` | — |',
  '| `DELETE` | `/<singular>/:<name>Id` | admin | `<resource>:delete` | — |',
  '| `POST` | `/<singular>/:<name>Id/restore` | admin | `<resource>:update` | — |',
  '',
  'The **admin zone** is where the collection is administered; the **member zone**',
  'is where its owner reaches their own record. For most collections that is Back',
  'Office and Member Portal respectively — which is why a landlord cannot call',
  '`GET /landlords/:id` even for their own record, and uses `GET /landlords/me`',
  'instead.',
  '',
  'Two routers, two mount points: `/landlords` carries the collection verbs, and',
  '`/landlord` carries everything addressing one record. Controllers still read',
  '`req.params.id`, so the item router aliases its named id onto `id` on the way',
  'in — one line in the factory instead of a special case in nine handlers.',
  '',
  '| Collection (plural) | Item (singular) | Resource | Admin zone | Member zone | Verifiable |',
  '|---|---|---|---|---|---|',
);

for (const m of PROFILE_MODULES) {
  lines.push(
    `| \`/${m.collectionPath}\` | \`/${m.itemPath}/:${m.idParam}\` | \`${m.resource}\` | ${ZONE_SHORT[m.adminZone]} | ${ZONE_SHORT[m.memberZone]} | ${m.verifiable ? 'yes' : 'no'} |`,
  );
}

lines.push('', '---', '', '## Ownership: what `scopeFor` does per resource', '');
lines.push(
  '`BaseService.scopeFor(actor)` returns a Mongo filter fragment that is merged',
  'into *every* read. Actors with scope `global`, `regional` or `zonal` get an empty',
  'fragment (no narrowing). Actors with scope `own`, `organizational` or `public`',
  'get the clauses below, OR-ed together.',
  '',
  '| Collection | `ownerPath` | `organizationPath` | Effect |',
  '|---|---|---|---|',
);

for (const [path, scope] of Object.entries(SCOPE_TABLE)) {
  lines.push(
    `| \`/${path}\` | ${scope.ownerPath ? `\`${scope.ownerPath}\`` : '—'} | ${scope.organizationPath ? `\`${scope.organizationPath}\`` : '—'} | ${scope.describes} |`,
  );
}

lines.push(
  '',
  '---',
  '',
  '## Endpoints by module',
  '',
);

for (const group of ordered) {
  const title = MODULE_TITLES[group.module] ?? group.module;
  lines.push(`### ${title}`, '');
  lines.push(endpointTable(group.endpoints));
  const notes = notesList(group.endpoints);
  if (notes) lines.push('', '**Notes**', notes);
  lines.push('');
}

lines.push(
  '---',
  '',
  '## Invariants asserted by `npm run verify`',
  '',
  'The blueprint is checked, not trusted. Every generation run is accompanied by',
  'assertions that:',
  '',
  '- every declared path is unique per method, and every permission string names a',
  '  real `resource` and `action`;',
  '- **no endpoint is unreachable** — a gated route that no role can call is a dead',
  '  route, and dead routes hide mistakes;',
  '- **Zone A is founder-only** and **Zone B is HQ-only**, computed from the role',
  '  matrix rather than asserted in prose;',
  '- **no member-facing role reaches a Back Office route**;',
  '- every public endpoint is genuinely reachable by an anonymous `publicUser`;',
  '- every `/me` route is `self`-scoped;',
  `- **no literal path is shadowed by an earlier parameterised route** (currently ${shadows.length === 0 ? 'none' : `${shadows.length} problems!`}) —`,
  '  this is what keeps `GET /drivers/verification-queue` from being swallowed by',
  '  `GET /drivers/:id`;',
  '- each profile collection exposes its full surface, and declares its ownership',
  '  wiring;',
  '- each **operational** collection (leases, maintenance requests, rides, payments,',
  '  commercial clients) declares a plural/singular pair with a named id parameter,',
  '  an explicit response component on every operation — no bare `{type: object}` —',
  '  and a `/me` view that is `self`-scoped and paginated;',
  '- **the payments ledger is read-only over HTTP.** Money is written by the flow',
  '  that causes it (`POST /lease/:leaseId/payments`, `POST /ride/:rideId/complete`),',
  '  never by a client asserting that money moved;',
  '- **the ride state machine is closed**: every transition target is a real status,',
  '  every status is reachable from `requested`, the four terminal states lead',
  '  nowhere, and nothing reaches `completed` except from `inProgress`.',
  '',
  'Separately, `assertBlueprintMatchesRouters()` runs at boot outside production and',
  'diffs this declaration against what Express actually mounted, so a route added',
  'without a blueprint entry surfaces on the next `npm run dev`.',
  '',
  '## Live contract',
  '',
  `\`GET ${PREFIX}/_blueprint\` returns this same data as JSON, filtered to the`,
  'endpoints the calling role can actually reach. That is what the PWA shells should',
  'build navigation and route guards from: instead of each frontend hard-coding',
  '"hide this unless the user is `backOfficeStaff`", it asks the server. A role',
  'change in `config/roles.ts` then propagates to every client with no frontend',
  'deploy. A founder may pass `?all=true` to see the unfiltered contract with the',
  'computed role list on each endpoint.',
  '',
);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n'), 'utf8');

console.log(`Wrote ${OUT}`);
console.log(`  ${resolved.length} endpoints across ${ordered.length} modules`);
console.log(`  ${profileEndpointCount} generated + ${customCount} custom`);
console.log(`  shadowed paths: ${shadows.length}`);
if (shadows.length > 0) {
  for (const s of shadows) console.log(`    ! ${s}`);
  process.exit(1);
}
