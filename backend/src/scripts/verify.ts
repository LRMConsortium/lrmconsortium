/**
 * Dependency-free verification of the two pieces of this platform that are pure
 * logic: the RBAC/zone matrix and the ad rotation mathematics.
 *
 * Deliberately imports nothing that touches Mongo or Express, so it runs in a
 * second with `npm run verify` — no database, no server, no fixtures. Anything
 * that needs a database belongs in an integration test instead.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACCESS_SCOPES,
  ROLES,
  ROLE_DEFINITIONS,
  effectiveScope,
  grantsForRoles,
  restrictedZonesForRoles,
  zonesForRoles,
  type Role,
} from '../config/roles.js';
import {
  ACTIONS,
  RESOURCES,
  can,
  grantsSatisfy,
  type Action,
  type Permission,
  type Resource,
} from '../config/permissions.js';
import { AD_ZONES, HQ_ZONES, HQ_ZONE_DEFINITIONS, zoneLineOfSight } from '../config/hqZones.js';
import {
  PROFILE_MODULES,
  SCOPE_TABLE,
  resolveBlueprint,
  shadowedPaths,
} from '../config/apiBlueprint.js';
import {
  DEFAULT_SERVERS,
  buildOpenApiDocument,
  danglingRefs,
  operationId,
  toOpenApiPath,
} from '../config/openapi.js';
import { COMPONENT_SCHEMAS } from '../config/openapiSchemas.js';
import {
  applyPayment,
  arrearsEscalation,
  arrearsFor,
  clampDayToMonth,
  creditBalanceFor,
  expectedToDate,
  instalmentDueDate,
  instalmentsDueBy,
  lifecycleStatus,
  money,
  nextPaymentDue,
  paymentSchedule,
  reminderFor,
  type RentTerms,
} from '../modules/lease/rentSchedule.js';
import {
  AT_RISK_THRESHOLD,
  escalationFor,
  graceHours,
  isSlaOpen,
  resolutionHours,
  routeToCoordinator,
  SLA_ESCALATIONS,
  SLA_HOURS_BY_PRIORITY,
  SLA_STATES,
  slaClockFor,
  slaHoursFor,
} from '../modules/maintenance/sla.js';
import {
  coversRegion,
  dispatchRejections,
  distanceFor,
  haversineKm,
  isDispatchable,
  MATCH_WEIGHTS,
  MAX_PICKUP_RADIUS_KM,
  matchScore,
  rankDrivers,
  type DispatchCandidate,
} from '../modules/ride/matching.js';
import {
  batchBalances,
  buildPayoutBatch,
  commissionSplit,
  DEFAULT_RIDE_COMMISSION_PERCENT,
  isPayable,
  PAYOUT_KINDS,
  PAYOUT_SOURCES,
  refundableAmount,
  summariseEarnings,
  type LedgerRow,
} from '../modules/payment/ledger.js';
import {
  campaignKpis,
  fleetKpis,
  occupancyKpis,
  percent,
  portfolioAnalytics,
  revenueKpis,
} from '../modules/commercialClient/analytics.js';
import {
  FAC_CODE_LENGTH,
  FAC_EXPIRY_WARNING_DAYS,
  FAC_LOCKOUT_HOURS,
  FAC_MAX_ATTEMPTS,
  FAC_ROTATION_DAYS,
  codeClock,
  codeEntropyBits,
  codeWeaknesses,
  describeClock,
  expectedBruteForceYears,
  generateCode,
  isAcceptableCode,
  isImmediate,
  isWellFormedCode,
  nextRotationDate,
  digitFrom,
  FAC_CLEARANCE_MINUTES,
  clearanceGate,
  describeGate,
  gateAllows,
} from '../modules/fac/facRules.js';
import {
  BCRYPT_MAX_BYTES,
  PEPPERED_LENGTH,
  digestsMatch,
  pepperCode,
  validatePepper,
} from '../modules/fac/facCrypto.js';
import {
  AUTO_RELEASE_DAYS,
  DEFAULT_MARKETPLACE_COMMISSION_PERCENT,
  autoReleaseAt,
  autoReleaseDue,
  priceOrder,
  refundBreakdown,
  totalsBalance,
  withinFreeCancellation,
} from '../modules/marketplace/orderMath.js';
import {
  ORDER_STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  canTransition as canTransitionOrder,
  describeStatus,
  isEscrowHeld,
  movesMoney,
  nextStatuses,
} from '../modules/marketplace/orderLifecycle.js';
import {
  MAX_ORDER_QUANTITY,
  MAX_UNIT_PRICE,
  autoUnpublish,
  canOrder,
  canPublish,
  stockAfterOrder,
  stockAfterRelease,
} from '../modules/marketplace/listingRules.js';
import { CURRENCIES, CURRENCY_SYMBOLS, LAUNCH_CURRENCY } from '../config/currencies.js';
import { CURRENCY } from '../config/openapiSchemas.js';
import {
  MIN_DISTINCT_CHARS,
  PLACEHOLDER_MARKERS,
  hasTooLittleVariety,
  placeholderMarkerIn,
  secretProblem,
} from '../config/secretHygiene.js';
import {
  ATTEMPT_RESULTS,
  attemptVerdict,
  clearanceState,
  consecutiveFailures,
  failureTriggersLockout,
  grantClearance,
  summariseAttempts,
  type AttemptRecord,
} from '../modules/fac/attempts.js';
import {
  GOVERNANCE_TIERS,
  TIER_DEFINITIONS,
  TIER_ORDER,
  canSeeTier,
  tierFor,
  tierOf,
  tierOverview,
  visibilityFor,
  visibilityMatrix,
} from '../modules/fac/visibility.js';
import {
  COMPONENT_WEIGHTS,
  NO_CODE_CEILING,
  governanceHealth,
  healthBand,
  type HealthSignals,
} from '../modules/fac/governanceHealth.js';
import {
  COMPLIANCE_RULES,
  DOCUMENT_FIELDS,
  DOCUMENT_RULES,
  DOCUMENT_TYPES,
  REVIEW_DESKS,
  acceptsSubjectKind,
  deskFor,
  expiryDateFor,
  isImmutableAfterVerification,
  isRestricted,
  lockedFieldsIn,
  requiresReverification,
  reviewerRolesFor,
  validateDocumentFields,
  validateField,
} from '../modules/document/documentRules.js';
import {
  ACTION_FOR_STATUS,
  DOCUMENT_STATUSES,
  DOCUMENT_TRANSITIONS,
  awaitsHolder,
  canTransition as canTransitionDoc,
  evaluateTransition,
  isLocked as isLockedDoc,
  isReviewable,
  reachableStatuses,
  requirementsFor,
  reverificationTarget,
} from '../modules/document/documentLifecycle.js';
import {
  RULE_SEVERITY,
  addressesMatch,
  complianceReport,
  evaluateRule,
  namesMatch,
  normalise,
} from '../modules/document/compliance.js';
import {
  EXPIRING_SOON_DAYS,
  EXPIRY_NOTICE_DAYS,
  daysBetween,
  describeExpiry,
  escalationFor as escalationForExpiry,
  expiryInfoFor,
  noticeDueAt,
  sweepVerdict,
} from '../modules/document/expiry.js';
import {
  AuditError,
  appendAudit,
  assertAppendOnly,
  auditSummary,
  auditTrailIsIntact,
  entryForTransition,
  lastActionBy,
  requiresReason as requiresReasonAudit,
  validateEntry,
} from '../modules/document/audit.js';
import {
  CLARITY_NEUTRAL,
  CROSS_NEUTRAL,
  MIN_SCORE_TO_VERIFY,
  SCORE_DIMENSIONS,
  SCORE_WEIGHTS,
  clarityScore,
  completenessScore,
  consistencyScore,
  crossDocumentScore,
  scoreBand,
  scoreDocument,
} from '../modules/document/scoring.js';
import {
  looksLikeToken,
  StubPushProvider,
  summarisePushResults,
  validatePushPayload,
} from '../shared/providers/push.js';
import {
  MAX_OBJECT_BYTES,
  StubStorageProvider,
  objectKeyFor,
  validatePut,
} from '../shared/providers/storage.js';
import {
  railFor,
  SETTLEMENT_HOURS,
  StubMoneyProvider,
  summariseTransfers,
  TRANSFER_RAILS,
  validateInstruction,
} from '../shared/providers/money.js';
import {
  RIDE_STATUSES,
  RIDE_TERMINAL_STATUSES,
  RIDE_TRANSITIONS,
  canTransition,
  reachableRideStatuses,
  type RideStatus,
} from '../modules/ride/lifecycle.js';
import {
  capAdvertiserShare,
  clickThroughRate,
  effectiveWeight,
  isEligible,
  pacingFactor,
  seededRandom,
  slotsForZone,
  weightedSample,
  type RotationCandidate,
  type RotationPolicy,
} from '../modules/advertising/rotation.js';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
  } else {
    failures.push(detail ? `${name} — ${detail}` : name);
  }
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

function near(name: string, actual: number, expected: number, tolerance: number): void {
  check(
    name,
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected} ±${tolerance}, got ${actual.toFixed(4)}`,
  );
}

function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}`);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Role matrix integrity');

eq('19 roles defined', ROLES.length, 19);
eq('5 HQ zones defined', HQ_ZONES.length, 5);
eq('3 ad zones defined', AD_ZONES.length, 3);

for (const role of ROLES) {
  const d = ROLE_DEFINITIONS[role];
  check(`${role}: has a definition`, d !== undefined);
  check(`${role}: declares an accessScope`, ACCESS_SCOPES.includes(d.accessScope));
  check(`${role}: declares at least one permission`, d.permissions.length > 0);
  check(`${role}: declares at least one allowed action`, d.allowedActions.length > 0);

  // allowedZones and restrictedZones must partition the five zones exactly.
  const union = new Set([...d.allowedZones, ...d.restrictedZones]);
  eq(`${role}: zones partition covers all 5`, union.size, HQ_ZONES.length);
  const overlap = d.allowedZones.filter((z) => d.restrictedZones.includes(z));
  eq(`${role}: allowed and restricted zones are disjoint`, overlap.length, 0);

  // Every permission must be a real resource:action pair (or a wildcard).
  for (const p of d.permissions) {
    const [resource, action] = p.split(':');
    const okResource = resource === '*' || RESOURCES.includes(resource as Resource);
    const okAction = action === '*' || ACTIONS.includes(action as Action);
    check(`${role}: permission "${p}" uses a known resource`, okResource);
    check(`${role}: permission "${p}" uses a known action`, okAction);
  }

  // A role that requires verification must have a profile to verify.
  if (d.requiresVerification) {
    check(`${role}: verifiable roles have a profile model`, d.profileModel !== null);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('Permission matcher');

const founderGrants = grantsForRoles(['founder']);
check('founder wildcard covers policy:create', can(founderGrants, 'policy:create'));
check('founder wildcard covers adPolicy:update', can(founderGrants, 'adPolicy:update'));
check('founder wildcard covers auditLog:read', can(founderGrants, 'auditLog:read'));

const tenantGrants = grantsForRoles(['tenant']);
check('tenant may read own profile', can(tenantGrants, 'tenantProfile:readOwn'));
check('tenant may NOT read all tenant profiles', !can(tenantGrants, 'tenantProfile:read'));
check('tenant may NOT read landlord profiles', !can(tenantGrants, 'landlordProfile:read'));
check('tenant may NOT author policy', !can(tenantGrants, 'policy:create'));
check('tenant may create a maintenance request', can(tenantGrants, 'maintenanceRequest:create'));
check('tenant may pay rent', can(tenantGrants, 'rentPayment:create'));
check('tenant may NOT read the whole rent ledger', !can(tenantGrants, 'rentPayment:read'));

const backOffice = grantsForRoles(['backOfficeStaff']);
check('back office may verify drivers', can(backOffice, 'driverProfile:verify'));
check('back office may onboard hotels', can(backOffice, 'hotelProfile:create'));
check('back office may manage vendors (resource wildcard)', can(backOffice, 'vendorProfile:delete'));
check('back office may NOT author policy', !can(backOffice, 'policy:create'));
check('back office may NOT set ad pricing', !can(backOffice, 'adPolicy:update'));
check('back office may NOT read the audit log', !can(backOffice, 'auditLog:read'));

const coordinator = grantsForRoles(['coordinator']);
check('coordinator may assign maintenance', can(coordinator, 'maintenanceRequest:assign'));
check('coordinator may read properties', can(coordinator, 'property:read'));
check('coordinator may NOT delete a property', !can(coordinator, 'property:delete'));
check('coordinator may NOT verify vendors', !can(coordinator, 'vendorProfile:verify'));

const advertiser = grantsForRoles(['advertiser']);
check('advertiser may create an ad', can(advertiser, 'ad:create'));
check('advertiser may read own report', can(advertiser, 'adReport:readOwn'));
check('advertiser may NOT approve their own ad', !can(advertiser, 'ad:approve'));
check('advertiser may NOT read every ad', !can(advertiser, 'ad:read'));
check('advertiser may NOT change ad policy', !can(advertiser, 'adPolicy:update'));

const hqExec = grantsForRoles(['hqExecutive']);
check('HQ executive may approve an ad', can(hqExec, 'ad:approve'));
check('HQ executive may read analytics', can(hqExec, 'analytics:read'));
check('HQ executive may NOT write policy', !can(hqExec, 'policy:create'));

const publicUser = grantsForRoles(['publicUser']);
check('public user may read public content', can(publicUser, 'publicContent:read'));
check('public user may NOT read tenant profiles', !can(publicUser, 'tenantProfile:read'));
check('public user may NOT read properties', !can(publicUser, 'property:read'));
check('public user may NOT read rent payments', !can(publicUser, 'rentPayment:read'));

// `read` implies `readOwn`, but not the reverse.
check('broad read satisfies narrow readOwn', can(['property:read'], 'property:readOwn'));
check('narrow readOwn does NOT satisfy broad read', !can(['property:readOwn'], 'property:read'));
check('resource wildcard satisfies any action', grantsSatisfy(['ad:*'], 'ad:delete'));
check('action wildcard satisfies any resource', grantsSatisfy(['*:read'], 'lease:read'));
check('unrelated grant does not satisfy', !grantsSatisfy(['ad:read'], 'lease:read'));

// ═══════════════════════════════════════════════════════════════════════════
section('Zone isolation');

const zoneExpectations: { role: Role; mustReach: string[]; mustNotReach: string[] }[] = [
  {
    role: 'founder',
    mustReach: [...HQ_ZONES],
    mustNotReach: [],
  },
  {
    role: 'hqExecutive',
    mustReach: ['HQ_EXECUTIVE', 'BACK_OFFICE', 'MEMBER_PORTAL', 'PUBLIC_PORTAL'],
    mustNotReach: ['FOUNDER_COMMAND_CENTER'],
  },
  {
    role: 'backOfficeStaff',
    mustReach: ['BACK_OFFICE', 'MEMBER_PORTAL'],
    mustNotReach: ['FOUNDER_COMMAND_CENTER', 'HQ_EXECUTIVE'],
  },
  {
    role: 'tenant',
    mustReach: ['MEMBER_PORTAL'],
    mustNotReach: ['FOUNDER_COMMAND_CENTER', 'HQ_EXECUTIVE', 'BACK_OFFICE'],
  },
  {
    role: 'coordinator',
    mustReach: ['MEMBER_PORTAL'],
    mustNotReach: ['FOUNDER_COMMAND_CENTER', 'HQ_EXECUTIVE', 'BACK_OFFICE'],
  },
  {
    role: 'driver',
    mustReach: ['MEMBER_PORTAL'],
    mustNotReach: ['FOUNDER_COMMAND_CENTER', 'HQ_EXECUTIVE', 'BACK_OFFICE'],
  },
  {
    role: 'publicUser',
    mustReach: ['PUBLIC_PORTAL'],
    mustNotReach: ['FOUNDER_COMMAND_CENTER', 'HQ_EXECUTIVE', 'BACK_OFFICE', 'MEMBER_PORTAL'],
  },
];

for (const { role, mustReach, mustNotReach } of zoneExpectations) {
  const allowed = zonesForRoles([role]);
  const restricted = restrictedZonesForRoles([role]);
  for (const z of mustReach) {
    check(`${role} reaches ${z}`, allowed.includes(z as never));
  }
  for (const z of mustNotReach) {
    check(`${role} is blocked from ${z}`, restricted.includes(z as never));
  }
}

// Zone entry permissions must be satisfiable by at least one role that is
// allowed into the zone — otherwise the zone is unreachable by construction.
for (const zone of HQ_ZONES) {
  const entry = HQ_ZONE_DEFINITIONS[zone].entryPermissions;
  if (entry.length === 0) continue;
  const reachable = ROLES.some((r) => {
    const d = ROLE_DEFINITIONS[r];
    if (!d.allowedZones.includes(zone)) return false;
    return entry.some((p) => can(grantsForRoles([r]), p as Permission));
  });
  check(`${zone}: entry permissions are satisfiable by some allowed role`, reachable);
}

// Zone E is the open front door: every role reaches it, none may administer it
// without the publicContent/publicMetrics grants.
for (const role of ROLES) {
  check(`${role} reaches the Public Portal`, zonesForRoles([role]).includes('PUBLIC_PORTAL'));
}
for (const role of ROLES) {
  if (role === 'founder' || role === 'hqExecutive' || role === 'backOfficeStaff') continue;
  const g = grantsForRoles([role]);
  check(`${role} cannot author public content`, !can(g, 'publicContent:create'));
  check(`${role} cannot publish public content`, !can(g, 'publicContent:publish'));
}
check('a tenant cannot read public traffic metrics', !can(grantsForRoles(['tenant']), 'publicMetrics:read'));
check('a public user CAN read public metrics', can(grantsForRoles(['publicUser']), 'publicMetrics:read'));

eq('founder line of sight covers every zone', zoneLineOfSight('FOUNDER_COMMAND_CENTER').length, 5);
eq('member portal sees only itself', zoneLineOfSight('MEMBER_PORTAL').length, 1);

// Multi-role users take the widest scope.
eq('tenant alone is own-scoped', effectiveScope(['tenant']), 'own');
eq('tenant + founder widens to global', effectiveScope(['tenant', 'founder']), 'global');
eq('driver + coordinator widens to regional', effectiveScope(['driver', 'coordinator']), 'regional');
eq('no roles falls back to public', effectiveScope([]), 'public');

// A landlord who is also an Ususu driver keeps both sets of grants.
const dualGrants = grantsForRoles(['landlord', 'driver']);
check('dual role keeps landlord grants', can(dualGrants, 'property:create'));
check('dual role keeps driver grants', can(dualGrants, 'earnings:readOwn'));
check('dual role gains no HQ powers', !can(dualGrants, 'policy:create'));

// ═══════════════════════════════════════════════════════════════════════════
section('Ad rotation: seeded randomness');

const rngA = seededRandom('session-1:PUBLIC_PORTAL:100');
const rngB = seededRandom('session-1:PUBLIC_PORTAL:100');
const seqA = [rngA(), rngA(), rngA()];
const seqB = [rngB(), rngB(), rngB()];
check('same seed yields identical sequence', seqA.every((v, i) => v === seqB[i]));
check('different seed yields different sequence', seededRandom('other')() !== seqA[0]);
check('values stay within [0,1)', seqA.every((v) => v >= 0 && v < 1));

// ═══════════════════════════════════════════════════════════════════════════
section('Ad rotation: weighted draw');

const basePolicy: RotationPolicy = {
  categoryWeightMultipliers: [],
  dayPartMultipliers: [],
  zoneSlotCounts: [
    { zone: 'PUBLIC_PORTAL', slots: 3 },
    { zone: 'MEMBER_PORTAL', slots: 2 },
  ],
  bannedCategories: [],
  houseAdOnlyZones: [],
  maxAdvertiserSharePercent: 100,
  pacingEnabled: false,
  minRotationWeight: 1,
  maxRotationWeight: 100,
};

function candidate(over: Partial<RotationCandidate> & { id: string }): RotationCandidate {
  return {
    advertiserId: `adv-${over.id}`,
    adCategory: 'property',
    rotationWeight: 10,
    priorityTier: 1,
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-12-31T00:00:00Z'),
    impressions: 0,
    clicks: 0,
    spend: 0,
    dayParts: [],
    daysOfWeek: [],
    targetRegions: [],
    targetRoles: [],
    ...over,
  };
}

const weighted = [
  candidate({ id: 'heavy', rotationWeight: 70 }),
  candidate({ id: 'medium', rotationWeight: 20 }),
  candidate({ id: 'light', rotationWeight: 10 }),
];
const weightMap: Record<string, number> = { heavy: 70, medium: 20, light: 10 };

const TRIALS = 30_000;
const wins: Record<string, number> = { heavy: 0, medium: 0, light: 0 };
for (let i = 0; i < TRIALS; i += 1) {
  const rng = seededRandom(`trial-${i}`);
  const [first] = weightedSample(weighted, (c) => weightMap[c.id]!, 1, rng);
  wins[first!.id] = (wins[first!.id] ?? 0) + 1;
}
near('heavy ad wins ~70% of first slots', wins.heavy! / TRIALS, 0.7, 0.02);
near('medium ad wins ~20% of first slots', wins.medium! / TRIALS, 0.2, 0.02);
near('light ad wins ~10% of first slots', wins.light! / TRIALS, 0.1, 0.02);

const drawn = weightedSample(weighted, (c) => weightMap[c.id]!, 3, seededRandom('x'));
eq('draw fills all requested slots', drawn.length, 3);
eq('draw never repeats an ad', new Set(drawn.map((d) => d.id)).size, 3);

const overdraw = weightedSample(weighted, (c) => weightMap[c.id]!, 10, seededRandom('y'));
eq('draw cannot exceed the pool', overdraw.length, 3);

const allZero = weightedSample(weighted, () => 0, 2, seededRandom('z'));
eq('zero weights still fill slots rather than serving blanks', allZero.length, 2);

eq('empty pool yields nothing', weightedSample([], () => 1, 3, seededRandom('e')).length, 0);

// ═══════════════════════════════════════════════════════════════════════════
section('Ad rotation: pacing');

const flightStart = new Date('2026-01-01T00:00:00Z');
const flightEnd = new Date('2026-01-11T00:00:00Z'); // 10-day flight
const midFlight = new Date('2026-01-06T00:00:00Z'); // 50% elapsed

const behind = pacingFactor(
  { startDate: flightStart, endDate: flightEnd, impressions: 200, impressionCap: 1000 },
  midFlight,
);
const onPace = pacingFactor(
  { startDate: flightStart, endDate: flightEnd, impressions: 500, impressionCap: 1000 },
  midFlight,
);
const ahead = pacingFactor(
  { startDate: flightStart, endDate: flightEnd, impressions: 900, impressionCap: 1000 },
  midFlight,
);

check('an ad behind schedule is boosted', behind > 1, `got ${behind}`);
near('an ad exactly on pace is untouched', onPace, 1, 0.001);
check('an ad ahead of schedule is damped', ahead < 1, `got ${ahead}`);
check('pacing never exceeds 2x', behind <= 2);
check('pacing never drops below 0.25x', ahead >= 0.25);
eq(
  'an uncapped ad is never paced',
  pacingFactor({ startDate: flightStart, endDate: flightEnd, impressions: 5_000 }, midFlight),
  1,
);

// ═══════════════════════════════════════════════════════════════════════════
section('Ad rotation: effective weight');

const noon = new Date('2026-06-15T12:00:00');
const tieredPolicy: RotationPolicy = { ...basePolicy };

const tier1 = effectiveWeight(candidate({ id: 'a', rotationWeight: 40, priorityTier: 1 }), tieredPolicy, noon);
const tier3 = effectiveWeight(candidate({ id: 'b', rotationWeight: 40, priorityTier: 3 }), tieredPolicy, noon);
check('a higher priority tier draws more weight', tier3 > tier1, `${tier3} vs ${tier1}`);

const clampPolicy: RotationPolicy = { ...basePolicy, minRotationWeight: 5, maxRotationWeight: 50 };
const clampedHigh = effectiveWeight(
  candidate({ id: 'c', rotationWeight: 999, priorityTier: 0 }),
  clampPolicy,
  noon,
);
eq('policy clamps an over-requested weight to the maximum', clampedHigh, 50);
const clampedLow = effectiveWeight(
  candidate({ id: 'd', rotationWeight: 0, priorityTier: 0 }),
  clampPolicy,
  noon,
);
eq('policy lifts an under-requested weight to the minimum', clampedLow, 5);

const halvedCategory: RotationPolicy = {
  ...basePolicy,
  categoryWeightMultipliers: [{ category: 'houseAd', multiplier: 0.5 }],
};
const house = effectiveWeight(
  candidate({ id: 'h', adCategory: 'houseAd', rotationWeight: 40, priorityTier: 0 }),
  halvedCategory,
  noon,
);
const paid = effectiveWeight(
  candidate({ id: 'p', adCategory: 'property', rotationWeight: 40, priorityTier: 0 }),
  halvedCategory,
  noon,
);
eq('a category multiplier halves house ads', house, paid / 2);

const primetime: RotationPolicy = {
  ...basePolicy,
  dayPartMultipliers: [{ hour: 12, multiplier: 2 }],
};
eq(
  'a daypart multiplier doubles weight at that hour',
  effectiveWeight(candidate({ id: 'n', rotationWeight: 20, priorityTier: 0 }), primetime, noon),
  40,
);
eq(
  'other hours are unaffected by the daypart multiplier',
  effectiveWeight(
    candidate({ id: 'n', rotationWeight: 20, priorityTier: 0 }),
    primetime,
    new Date('2026-06-15T09:00:00'),
  ),
  20,
);

// ═══════════════════════════════════════════════════════════════════════════
section('Ad rotation: eligibility');

const nowNoonWed = new Date('2026-06-17T12:00:00'); // Wednesday, day 3
const ctx = { region: 'Greater Accra', role: 'tenant' };

check('a plain in-flight ad is eligible', isEligible(candidate({ id: '1' }), nowNoonWed, ctx));
check(
  'a daypart mismatch is excluded',
  !isEligible(candidate({ id: '2', dayParts: [6, 7, 8] }), nowNoonWed, ctx),
);
check(
  'a daypart match is included',
  isEligible(candidate({ id: '3', dayParts: [11, 12, 13] }), nowNoonWed, ctx),
);
check(
  'a day-of-week mismatch is excluded',
  !isEligible(candidate({ id: '4', daysOfWeek: [0, 6] }), nowNoonWed, ctx),
);
check(
  'an exhausted impression cap is excluded',
  !isEligible(candidate({ id: '5', impressions: 1000, impressionCap: 1000 }), nowNoonWed, ctx),
);
check(
  'an exhausted click cap is excluded',
  !isEligible(candidate({ id: '6', clicks: 50, clickCap: 50 }), nowNoonWed, ctx),
);
check(
  'an exhausted budget is excluded',
  !isEligible(candidate({ id: '7', spend: 500, budgetAmount: 500 }), nowNoonWed, ctx),
);
check(
  'a region mismatch is excluded',
  !isEligible(candidate({ id: '8', targetRegions: ['Ashanti'] }), nowNoonWed, ctx),
);
check(
  'a region match is included',
  isEligible(candidate({ id: '9', targetRegions: ['Greater Accra'] }), nowNoonWed, ctx),
);
check(
  'a role mismatch is excluded',
  !isEligible(candidate({ id: '10', targetRoles: ['driver'] }), nowNoonWed, ctx),
);
check(
  'untargeted ads serve to everyone',
  isEligible(candidate({ id: '11' }), nowNoonWed, { region: 'Volta', role: 'rider' }),
);

// ═══════════════════════════════════════════════════════════════════════════
section('Ad rotation: advertiser share cap');

const hoggedPick = [
  candidate({ id: 'x1', advertiserId: 'big' }),
  candidate({ id: 'x2', advertiserId: 'big' }),
  candidate({ id: 'x3', advertiserId: 'big' }),
  candidate({ id: 'x4', advertiserId: 'big' }),
];
const sharePool = [
  ...hoggedPick,
  candidate({ id: 'y1', advertiserId: 'small-a' }),
  candidate({ id: 'y2', advertiserId: 'small-b' }),
];

const capped = capAdvertiserShare(hoggedPick, 50, sharePool, () => 10, seededRandom('cap'));
eq('the slot count is preserved after capping', capped.length, 4);
const bigCount = capped.filter((c) => c.advertiserId === 'big').length;
eq('no advertiser exceeds its 50% share', bigCount, 2);
eq('displaced slots are refilled from other advertisers', capped.length - bigCount, 2);
eq('capping never duplicates an ad', new Set(capped.map((c) => c.id)).size, capped.length);

const uncapped = capAdvertiserShare(hoggedPick, 100, sharePool, () => 10, seededRandom('cap'));
eq('a 100% cap is a no-op', uncapped.length, 4);
eq('a 100% cap leaves the advertiser alone', uncapped.filter((c) => c.advertiserId === 'big').length, 4);

// If nobody else is available, the cap cannot invent inventory — but it must not
// return duplicates or empty entries either.
const lonely = capAdvertiserShare(hoggedPick, 25, hoggedPick, () => 10, seededRandom('lonely'));
check('capping with no alternative inventory degrades safely', lonely.length <= 4);
eq('degraded capping still has no duplicates', new Set(lonely.map((c) => c.id)).size, lonely.length);

// ═══════════════════════════════════════════════════════════════════════════
section('Ad rotation: slots and CTR');

eq('zone slot count comes from policy', slotsForZone(basePolicy, 'PUBLIC_PORTAL', undefined, 9), 3);
eq('member portal has its own slot count', slotsForZone(basePolicy, 'MEMBER_PORTAL', undefined, 9), 2);
eq('an unlisted zone falls back to the default', slotsForZone(basePolicy, 'USUSU_PORTAL', undefined, 9), 9);
eq('an explicit request overrides policy', slotsForZone(basePolicy, 'PUBLIC_PORTAL', 5, 9), 5);
eq('a request is capped at 10 slots', slotsForZone(basePolicy, 'PUBLIC_PORTAL', 99, 9), 10);

eq('CTR of 50/1000 is 5%', clickThroughRate(50, 1000), 5);
eq('CTR of 1/3 rounds to 2dp', clickThroughRate(1, 3), 33.33);
eq('CTR with no impressions is 0, not NaN', clickThroughRate(0, 0), 0);

// ═══════════════════════════════════════════════════════════════════════════
section('API blueprint');

const blueprint = resolveBlueprint();
check('the blueprint declares endpoints', blueprint.length > 100, `got ${blueprint.length}`);

// Every declaration must be well-formed.
const seen = new Set<string>();
for (const ep of blueprint) {
  const key = `${ep.method} ${ep.path}`;
  check(`${key}: declared once`, !seen.has(key));
  seen.add(key);

  check(`${key}: path starts with /`, ep.path.startsWith('/'));
  check(`${key}: has a summary`, ep.summary.length > 0);
  check(`${key}: has a response shape`, ep.responseShape.length > 0);
  check(`${key}: zone is a real HQ zone or null`, ep.zone === null || HQ_ZONES.includes(ep.zone));

  for (const p of ep.permissions) {
    const [resource, action] = p.split(':');
    check(
      `${key}: permission "${p}" is real`,
      (resource === '*' || RESOURCES.includes(resource as Resource)) &&
        (action === '*' || ACTIONS.includes(action as Action)),
    );
  }

  // A gated endpoint that nobody can reach is a dead route.
  check(`${key}: reachable by at least one role`, ep.roles.length > 0);

  // An unauthenticated endpoint must not sit behind a permission.
  if (ep.auth === 'none') {
    eq(`${key}: public endpoints carry no permission gate`, ep.permissions.length, 0);
  }

  // Anything that mutates and is not public should be audited.
  if (ep.method !== 'GET' && ep.auth === 'required' && ep.module !== 'auth') {
    check(`${key}: mutation is audited`, ep.audited === true);
  }
}

// Route ordering: no literal path may be shadowed by an earlier :id route.
const shadows = shadowedPaths();
eq('no endpoint is shadowed by an earlier parameterised route', shadows.length, 0);
for (const s of shadows) check(`shadowing: ${s}`, false);

// Zone A must be Founder-only in practice, not just by intention.
for (const ep of blueprint.filter((e) => e.zone === 'FOUNDER_COMMAND_CENTER')) {
  const nonFounder = ep.roles.filter((r) => r !== 'founder');
  eq(
    `${ep.method} ${ep.path}: Zone A is reachable by the founder alone`,
    nonFounder.length,
    0,
  );
}

// Zone B endpoints: founder and executive, nobody else.
for (const ep of blueprint.filter((e) => e.zone === 'HQ_EXECUTIVE')) {
  const unexpected = ep.roles.filter((r) => r !== 'founder' && r !== 'hqExecutive');
  eq(`${ep.method} ${ep.path}: Zone B is HQ-only`, unexpected.length, 0);
}

// No member-facing role may reach a Back Office administrative route.
const MEMBER_ROLES: Role[] = ['tenant', 'landlord', 'driver', 'rider', 'advertiser', 'vendor'];
for (const ep of blueprint.filter((e) => e.zone === 'BACK_OFFICE')) {
  const leaked = ep.roles.filter((r) => MEMBER_ROLES.includes(r));
  eq(`${ep.method} ${ep.path}: no member role reaches Back Office`, leaked.length, 0);
}

// Public endpoints must actually be reachable by an anonymous public user.
for (const ep of blueprint.filter((e) => e.zone === 'PUBLIC_PORTAL' && e.auth !== 'required')) {
  check(`${ep.method} ${ep.path}: reachable by publicUser`, ep.roles.includes('publicUser'));
}

// Every `/me` route must be self-scoped, and every :id route on an owned
// collection must be scoped — that is the ownership contract.
for (const ep of blueprint) {
  if (ep.path.endsWith('/me')) {
    eq(`${ep.method} ${ep.path}: /me is self-scoped`, ep.ownership, 'self');
  }
}

// Each profile module must expose the full surface, in the LRMC convention:
// plural for the collection, singular for the item, with a named id parameter.
for (const spec of PROFILE_MODULES) {
  const own = blueprint.filter((e) => e.module === spec.module && e.surface === 'profile');
  const expected = spec.verifiable ? 9 : 8;
  eq(`${spec.collectionPath}: exposes ${expected} endpoints`, own.length, expected);

  const coll = `/${spec.collectionPath}`;
  const item = `/${spec.itemPath}`;
  const id = `${item}/:${spec.idParam}`;

  for (const shape of [
    `GET ${coll}`,
    `POST ${coll}`,
    `GET ${item}/me`,
    `PATCH ${item}/me`,
    `GET ${id}`,
    `PATCH ${id}`,
    `DELETE ${id}`,
    `POST ${id}/restore`,
  ]) {
    check(`${spec.collectionPath}: declares ${shape}`, seen.has(shape));
  }
  if (spec.verifiable) {
    check(`${spec.collectionPath}: declares PATCH ${id}/verify`, seen.has(`PATCH ${id}/verify`));
  }

  // The convention itself: plural collection, singular item, and the item
  // segment must genuinely be the singular of the collection segment.
  check(
    `${spec.collectionPath}: collection segment is plural`,
    spec.collectionPath !== spec.itemPath && spec.collectionPath.startsWith(spec.itemPath.replace(/y$/, '')),
  );
  check(
    `${spec.collectionPath}: id parameter is named, not bare \`id\``,
    spec.idParam !== 'id' && spec.idParam.endsWith('Id'),
  );

  // No collection route may carry an id, and no item route may be a bare list.
  for (const ep of own) {
    if (ep.path.startsWith(`${coll}/`) || ep.path === coll) {
      check(`${ep.method} ${ep.path}: collection route carries no id`, !ep.path.includes(':'));
    }
  }

  const meRead = blueprint.find((e) => e.method === 'GET' && e.path === `${item}/me`)!;
  check(`${spec.collectionPath}: /me is declared`, meRead !== undefined);
  check(`${spec.collectionPath}: /me is reachable by somebody`, (meRead?.roles.length ?? 0) > 0);

  // `/me` must be declared before `/:xId`, or Express parses `me` as an id.
  const meIndex = blueprint.findIndex((e) => e.method === 'GET' && e.path === `${item}/me`);
  const idIndex = blueprint.findIndex((e) => e.method === 'GET' && e.path === id);
  check(`${spec.collectionPath}: /me is declared before the id route`, meIndex < idIndex);

  const scope = SCOPE_TABLE[spec.collectionPath];
  check(
    `${spec.collectionPath}: declares its ownership wiring`,
    scope !== undefined && scope.describes.length > 0,
  );
}

// Nothing anywhere in the contract may still use a bare `:id`.
for (const ep of blueprint) {
  check(`${ep.method} ${ep.path}: uses a named id parameter`, !ep.path.includes('/:id'));
}

// A tenant must not be able to reach any other collection's admin list.
const tenantReachable = blueprint.filter((e) => e.roles.includes('tenant')).map((e) => `${e.method} ${e.path}`);
check(
  'a tenant cannot list landlords',
  !tenantReachable.includes('GET /landlords'),
);
check('a tenant cannot list tenants', !tenantReachable.includes('GET /tenants'));
check('a tenant cannot read the audit log', !tenantReachable.includes('GET /hq/audit-log'));
check('a tenant cannot ratify ad policy', !tenantReachable.includes('POST /ad-policy'));
check('a tenant can read their own profile', tenantReachable.includes('GET /tenant/me'));
check('a tenant can submit a property enquiry search', tenantReachable.includes('GET /properties/public'));

// An advertiser must reach their own ad surface and nothing more.
const advertiserReachable = blueprint
  .filter((e) => e.roles.includes('advertiser'))
  .map((e) => `${e.method} ${e.path}`);
check('an advertiser can create an ad', advertiserReachable.includes('POST /ads'));
check('an advertiser can read their reports', advertiserReachable.includes('GET /ads/reports'));
check('an advertiser cannot review ads', !advertiserReachable.includes('PATCH /ad/:adId/review'));
check('an advertiser cannot set their own terms', !advertiserReachable.includes('PATCH /ad-policy/advertiser/:advertiserId/terms'));

// ═══════════════════════════════════════════════════════════════════════════
section('OpenAPI document');

const doc = buildOpenApiDocument() as Record<string, any>;

eq('declares OpenAPI 3.1.0', doc.openapi, '3.1.0');
check('has an info block with a title and version', Boolean(doc.info?.title && doc.info?.version));
check('declares bearer JWT security', doc.components?.securitySchemes?.bearerAuth?.bearerFormat === 'JWT');
// The domain hierarchy is part of the contract, not incidental configuration.
const EXPECTED_SERVERS = [
  ['https://api.lrmconsortium.africa/api/v1', 'LRMC HQ (Institutional Command Center)'],
  ['https://api.lrmconsortium.com/api/v1', 'LRMC Public Portal'],
  ['https://api.africalrmc.com/api/v1', 'LRMC PR & Communications'],
  ['https://api.africaususu.com/api/v1', 'Ususu Rideshare Platform'],
  ['http://localhost:3000/api/v1', 'Local Development'],
];

eq('declares 5 servers', (doc.servers as unknown[])?.length, EXPECTED_SERVERS.length);
EXPECTED_SERVERS.forEach(([url, description], i) => {
  const entry = (doc.servers as { url: string; description: string }[])?.[i];
  eq(`server ${i + 1} url`, entry?.url, url);
  eq(`server ${i + 1} description`, entry?.description, description);
});
eq(
  'the built document uses the canonical server list',
  JSON.stringify(doc.servers),
  JSON.stringify(DEFAULT_SERVERS),
);
check(
  'HQ leads the list — generators take the first entry as the default base URL',
  (doc.servers as { url: string }[])[0]?.url.includes('lrmconsortium.africa') === true,
);
check(
  'every server carries the API prefix',
  (doc.servers as { url: string }[]).every((sv) => sv.url.endsWith('/api/v1')),
);
check(
  'exactly one non-TLS server, and it is localhost',
  (doc.servers as { url: string }[]).filter((sv) => sv.url.startsWith('http://')).length === 1 &&
    (doc.servers as { url: string }[]).every(
      (sv) => sv.url.startsWith('https://') || sv.url.startsWith('http://localhost'),
    ),
);

// A dangling $ref makes the whole document useless to a code generator.
eq('no dangling $refs', danglingRefs(doc).length, 0);
for (const r of danglingRefs(doc)) check(`dangling ref: ${r}`, false);

// Every blueprint endpoint must appear, with its method, and vice versa.
const docPaths = doc.paths as Record<string, Record<string, unknown>>;
let documentedOps = 0;
for (const key of Object.keys(docPaths)) {
  documentedOps += Object.keys(docPaths[key]!).length;
  check(`${key}: path uses {braces}, not :colons`, !key.includes(':'));
  check(`${key}: path has no bare {id}`, !key.includes('{id}'));
}
eq('every blueprint endpoint is documented', documentedOps, blueprint.length);

const operationIds = new Set<string>();
for (const ep of blueprint) {
  const key = toOpenApiPath(ep.path);
  const op = docPaths[key]?.[ep.method.toLowerCase()] as Record<string, any> | undefined;
  check(`${ep.method} ${key}: present in the document`, op !== undefined);
  if (!op) continue;

  // operationIds must be unique — generators use them as function names.
  const id = operationId(ep);
  check(`${id}: operationId is unique`, !operationIds.has(id));
  operationIds.add(id);
  eq(`${ep.method} ${key}: operationId matches`, op.operationId, id);

  // The three gates must be published, and must agree with the blueprint.
  eq(`${ep.method} ${key}: x-zone matches the blueprint`, op['x-zone'], ep.zone ?? null);
  eq(`${ep.method} ${key}: x-ownership matches`, op['x-ownership'], ep.ownership);
  eq(
    `${ep.method} ${key}: x-roles matches the computed role list`,
    JSON.stringify(op['x-roles']),
    JSON.stringify(ep.roles),
  );
  eq(
    `${ep.method} ${key}: x-permissions matches`,
    JSON.stringify(op['x-permissions']),
    JSON.stringify(ep.permissions),
  );

  // Security must distinguish all three cases. An `optional` endpoint needs the
  // empty requirement object, or tooling demands a token from anonymous callers.
  if (ep.auth === 'none') {
    eq(`${ep.method} ${key}: public endpoint opts out of security`, JSON.stringify(op.security), '[]');
  } else if (ep.auth === 'optional') {
    eq(
      `${ep.method} ${key}: optional auth allows anonymous`,
      JSON.stringify(op.security),
      JSON.stringify([{}, { bearerAuth: [] }]),
    );
  } else {
    eq(
      `${ep.method} ${key}: authenticated endpoint requires bearerAuth`,
      JSON.stringify(op.security),
      JSON.stringify([{ bearerAuth: [] }]),
    );
  }

  // Every path template variable must be declared as a parameter.
  const vars = [...key.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
  const declared = ((op.parameters ?? []) as { name: string; in: string }[])
    .filter((prm) => prm.in === 'path')
    .map((prm) => prm.name);
  for (const v of vars) {
    check(`${ep.method} ${key}: declares path parameter ${v}`, declared.includes(v));
  }
  eq(`${ep.method} ${key}: no undeclared path parameters`, declared.length, vars.length);

  // Responses: a success code, plus the failures the middleware can actually
  // produce. A spec that omits 403 on a gated route teaches clients to ignore it.
  const codes = Object.keys(op.responses ?? {});
  check(`${ep.method} ${key}: declares a 2xx response`, codes.some((c) => c.startsWith('2')));
  if (ep.auth === 'required') {
    check(`${ep.method} ${key}: declares 401`, codes.includes('401'));
    check(`${ep.method} ${key}: declares 403`, codes.includes('403'));
  }
  if (ep.auth === 'optional') {
    check(`${ep.method} ${key}: optional-auth route does not claim 401`, !codes.includes('401'));
  }
  if (ep.requestBody || ep.requestQuery) {
    check(`${ep.method} ${key}: declares 422`, codes.includes('422'));
  }
  if (ep.rateLimit) check(`${ep.method} ${key}: declares 429`, codes.includes('429'));

  // A body-carrying endpoint must reference a real component schema.
  if (ep.requestBody) {
    const schemaRef = op.requestBody?.content?.['application/json']?.schema?.$ref as string | undefined;
    check(`${ep.method} ${key}: request body references a component`, Boolean(schemaRef));
    if (schemaRef) {
      const name = schemaRef.replace('#/components/schemas/', '');
      check(`${ep.method} ${key}: request schema ${name} exists`, name in COMPONENT_SCHEMAS);
    }
  }
}

// Sensitive fields must never be readable. This is the schema-level counterpart
// of `select: false` + the toJSON transform.
const NEVER_RETURNED = [
  ['IdentityFields', 'IDNumber'],
  ['IdentityFields', 'nationalID'],
  ['IdentityFields', 'IDPhoto'],
  ['Founder', 'securityNotes'],
  ['Landlord', 'payoutAccountRef'],
  ['Driver', 'driverLicenseNumber'],
  ['Driver', 'payoutAccountRef'],
  ['Vendor', 'taxIdentificationNumber'],
  ['Tenant', 'monthlyIncome'],
  ['FleetVehicle', 'vin'],
] as const;

function findProperty(schemaName: string, prop: string): Record<string, any> | undefined {
  const schema = COMPONENT_SCHEMAS[schemaName] as Record<string, any> | undefined;
  if (!schema) return undefined;
  const parts: Record<string, any>[] = schema.allOf ? schema.allOf : [schema];
  for (const part of parts) {
    const found = part?.properties?.[prop];
    if (found) return found as Record<string, any>;
  }
  return undefined;
}

for (const [schemaName, prop] of NEVER_RETURNED) {
  const found = findProperty(schemaName, prop);
  check(`${schemaName}.${prop}: declared`, found !== undefined);
  check(`${schemaName}.${prop}: marked writeOnly — never returned`, found?.writeOnly === true);
}

// Server-controlled fields must not be writable by a client.
const NEVER_WRITTEN = [
  ['Ad', 'impressions'],
  ['Ad', 'clicks'],
  ['Ad', 'status'],
  ['Ad', 'spend'],
  ['Advertiser', 'creditLimit'],
  ['Advertiser', 'agreedCPM'],
  ['VerificationFields', 'verificationStatus'],
  ['Property', 'reference'],
  ['Tenant', 'complianceScore'],
  ['RatingFields', 'rating'],
] as const;

for (const [schemaName, prop] of NEVER_WRITTEN) {
  const found = findProperty(schemaName, prop);
  check(`${schemaName}.${prop}: declared`, found !== undefined);
  check(`${schemaName}.${prop}: marked readOnly — server-controlled`, found?.readOnly === true);
}

// Every response must be enveloped, and every payload must be typed.
//
// The second half is the one that matters: a payload documented as bare
// `{type: object}` tells a client generator nothing, so it is worse than an
// honest gap — it looks documented.
for (const ep of blueprint) {
  if (ep.responseShape.startsWith('204')) continue;
  const key = toOpenApiPath(ep.path);
  const op = docPaths[key]?.[ep.method.toLowerCase()] as Record<string, any> | undefined;
  const success = Object.entries(op?.responses ?? {}).find(([c]) => c.startsWith('2'));
  const schema = (success?.[1] as any)?.content?.['application/json']?.schema;

  if (ep.enveloped === false) {
    check(
      `${ep.method} ${key}: raw payload references a component`,
      typeof schema?.$ref === 'string',
    );
  } else {
    check(
      `${ep.method} ${key}: response is enveloped in { success, data }`,
      schema?.properties?.success !== undefined,
    );
    const data = schema?.properties?.data;
    const typed =
      data === undefined ||
      typeof data.$ref === 'string' ||
      (data.type === 'array' && typeof data.items?.$ref === 'string');
    check(`${ep.method} ${key}: payload is a typed component, not a bare object`, typed);
  }
}

// Every component schema must actually describe something.
for (const [name, schema] of Object.entries(COMPONENT_SCHEMAS)) {
  const s = schema as Record<string, any>;
  const describesSomething =
    s.properties !== undefined ||
    s.allOf !== undefined ||
    s.items !== undefined ||
    s.additionalProperties !== undefined ||
    s.enum !== undefined ||
    s.const !== undefined;
  check(`schema ${name}: is not an empty object`, describesSomething);
}

// Composite payloads referenced by the modules the contract is meant to cover.
for (const name of [
  'KPISnapshot', 'SystemHealth', 'RegionalPerformance', 'ExecutiveDashboard',
  'CommandCenter', 'ZoneDirectory', 'HQZoneDetail', 'RoleCatalogue', 'ResolvedRoles',
  'BlueprintResponse', 'PlatformIndex', 'ServeAdsResponse', 'RotationPreview',
  'TrackResult', 'FleetUtilization', 'DriverVerificationQueue', 'TrafficMetrics',
  'AuthTokens', 'CurrentActor', 'User',
]) {
  check(`schema ${name}: defined`, name in COMPONENT_SCHEMAS);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Operational modules');

/**
 * The six operational surfaces are hand-mounted rather than produced by
 * `defineProfileModule`, so nothing enforces the LRMC conventions on them for
 * free. These assertions are that enforcement: the plural/singular pair, the
 * named id parameter, `/me` before `:id`, a typed payload on every operation,
 * and the money rules that make the ledger trustworthy.
 */
interface OperationalModule {
  module: string;
  collectionPath: string;
  itemPath: string;
  idParam: string;
  /** Item-scoped sub-routes beyond the bare CRUD pair. */
  actions: string[];
  /** `/me` views this module mounts under *other* modules' item segments. */
  memberViews: string[];
  /** `/me` views that belong to a reviewing desk rather than to a member. */
  staffViews?: string[];
  zone: 'BACK_OFFICE' | 'MEMBER_PORTAL';
  /**
   * True for collections that belong to the platform rather than to a member.
   * These declare `ownership: 'none'` — claiming `scoped` would assert a
   * narrowing that does not exist — and must be unreachable by every member role.
   */
  platformOwned?: boolean;
}

const OPERATIONAL_MODULES: OperationalModule[] = [
  {
    module: 'lease',
    collectionPath: 'leases',
    itemPath: 'lease',
    idParam: 'leaseId',
    actions: ['payments'],
    memberViews: ['/tenant/me/leases', '/landlord/me/leases'],
    zone: 'BACK_OFFICE',
  },
  {
    module: 'maintenance',
    collectionPath: 'maintenance-requests',
    itemPath: 'maintenance-request',
    idParam: 'requestId',
    actions: ['assign-vendor'],
    memberViews: ['/vendor/me/maintenance-queue'],
    zone: 'MEMBER_PORTAL',
  },
  {
    module: 'ride',
    collectionPath: 'rides',
    itemPath: 'ride',
    idParam: 'rideId',
    actions: ['accept', 'start', 'complete', 'cancel'],
    memberViews: ['/driver/me/dispatch-queue', '/driver/me/rides', '/rider/me/rides'],
    zone: 'MEMBER_PORTAL',
  },
  {
    module: 'payment',
    collectionPath: 'payments',
    itemPath: 'payment',
    idParam: 'paymentId',
    actions: [],
    memberViews: [
      '/tenant/me/payments',
      '/landlord/me/payments',
      '/driver/me/payments',
      '/advertiser/me/payments',
    ],
    zone: 'BACK_OFFICE',
  },
  {
    module: 'commercialClient',
    collectionPath: 'commercial-clients',
    itemPath: 'commercial-client',
    idParam: 'clientId',
    actions: ['properties', 'fleet', 'ads', 'analytics'],
    memberViews: [],
    zone: 'BACK_OFFICE',
  },
  {
    module: 'document',
    collectionPath: 'documents',
    itemPath: 'document',
    idParam: 'documentId',
    actions: [
      'submit', 'review', 'request-info', 'verify', 'reject', 'expire', 'reverify',
      'verification-summary',
    ],
    memberViews: ['/member/me/documents'],
    staffViews: ['/staff/me/document-queue'],
    zone: 'BACK_OFFICE',
  },
  {
    module: 'payout',
    collectionPath: 'payout-batches',
    itemPath: 'payout-batch',
    idParam: 'batchId',
    actions: ['settle', 'cancel', 'lines'],
    memberViews: [],
    zone: 'BACK_OFFICE',
    platformOwned: true,
  },
];

for (const spec of OPERATIONAL_MODULES) {
  const coll = `/${spec.collectionPath}`;
  const item = `/${spec.itemPath}`;
  const id = `${item}/:${spec.idParam}`;
  const own = blueprint.filter((e) => e.module === spec.module);

  check(`${spec.collectionPath}: declares endpoints`, own.length > 0);

  // Plural collection, singular item — and the item segment must genuinely be
  // the singular of the collection segment, not merely a different word.
  check(
    `${spec.collectionPath}: collection segment is the plural of the item segment`,
    spec.collectionPath === `${spec.itemPath}s` || spec.collectionPath === `${spec.itemPath}es`,
  );
  check(
    `${spec.collectionPath}: id parameter is named, not bare \`id\``,
    spec.idParam !== 'id' && spec.idParam.endsWith('Id'),
  );

  // Both halves of the pair are always readable.
  check(`${spec.collectionPath}: declares GET ${coll}`, seen.has(`GET ${coll}`));
  check(`${spec.collectionPath}: declares GET ${id}`, seen.has(`GET ${id}`));

  // Writes vary by design, and the variation is the point:
  //   payment — read-only over HTTP; money is written by the flow that causes it.
  //   payout  — built and then settled or cancelled; a batch is never edited,
  //             because an approved total that can be amended is not an approval.
  //   others  — the full CRUD pair.
  if (spec.module !== 'payment') {
    const create = spec.module === 'ride' ? `POST ${coll}/requests` : `POST ${coll}`;
    check(`${spec.collectionPath}: declares ${create}`, seen.has(create));
  }
  if (spec.module !== 'payment' && spec.module !== 'payout') {
    check(`${spec.collectionPath}: declares PATCH ${id}`, seen.has(`PATCH ${id}`));
  }
  if (spec.module === 'payout') {
    check(
      'a payout batch is immutable once built — no PATCH',
      !blueprint.some((e) => e.method === 'PATCH' && e.path.startsWith(item)),
    );
  }

  for (const action of spec.actions) {
    const declared = blueprint.some((e) => e.path === `${id}/${action}`);
    check(`${spec.collectionPath}: declares the ${action} sub-route`, declared);
  }

  for (const view of spec.memberViews) {
    const ep = blueprint.find((e) => e.method === 'GET' && e.path === view);
    check(`${spec.collectionPath}: declares ${view}`, ep !== undefined);
    eq(`${view}: is self-scoped`, ep?.ownership, 'self');
    eq(`${view}: sits in the Member Portal`, ep?.zone, 'MEMBER_PORTAL');
    check(`${view}: is paginated`, ep?.responseShape.includes('meta: PageMeta') === true);
  }

  // A staff `/me` view is still self-scoped — it is the *reviewer's* own queue —
  // but it lives behind the Back Office gate, not the member one.
  for (const view of spec.staffViews ?? []) {
    const ep = blueprint.find((e) => e.method === 'GET' && e.path === view);
    check(`${spec.collectionPath}: declares ${view}`, ep !== undefined);
    eq(`${view}: is self-scoped`, ep?.ownership, 'self');
    eq(`${view}: sits in Back Office`, ep?.zone, 'BACK_OFFICE');
    check(`${view}: is paginated`, ep?.responseShape.includes('meta: PageMeta') === true);
    for (const role of MEMBER_ROLES) {
      check(`${view}: ${role} cannot read a reviewer's queue`, !(ep?.roles ?? []).includes(role));
    }
  }

  // No collection route may carry an id, and no item route may be a bare list.
  for (const ep of own) {
    if (ep.path === coll || ep.path.startsWith(`${coll}/`)) {
      check(`${ep.method} ${ep.path}: collection route carries no id`, !ep.path.includes(':'));
    }
    if (ep.path.startsWith(`${item}/`) && !ep.path.includes('/me')) {
      check(
        `${ep.method} ${ep.path}: item route is addressed by :${spec.idParam}`,
        ep.path.startsWith(`${id}`),
      );
    }
  }

  // Every operation in these modules must name its response component
  // explicitly. Prose parsing is fine for the generic CRUD surface; a hand-
  // mounted roll-up is exactly where it silently degrades to `{type: object}`.
  for (const ep of own) {
    // A 204 has no body to type; everything else must name its component.
    if (!ep.responseShape.startsWith('204')) {
      check(
        `${ep.method} ${ep.path}: declares an explicit responseSchema`,
        typeof ep.responseSchema === 'string' && ep.responseSchema.length > 0,
      );
      check(
        `${ep.method} ${ep.path}: responseSchema resolves to a component`,
        ep.responseSchema !== undefined && ep.responseSchema in COMPONENT_SCHEMAS,
      );
    } else {
      check(
        `${ep.method} ${ep.path}: a 204 declares no response component`,
        ep.responseSchema === undefined,
      );
    }
    // These are member and back-office surfaces; none of them is anonymous.
    eq(`${ep.method} ${ep.path}: requires authentication`, ep.auth, 'required');
    check(
      `${ep.method} ${ep.path}: carries a zone gate`,
      ep.zone !== null && HQ_ZONES.includes(ep.zone),
    );
    check(`${ep.method} ${ep.path}: reachable by at least one role`, ep.roles.length > 0);
  }

  // The collection list must be ownership-narrowed, or one landlord's ledger
  // shows another's. A platform-owned collection is the exception, and earns it
  // by being unreachable to every member role rather than by being narrowed.
  const list = blueprint.find((e) => e.method === 'GET' && e.path === coll);
  if (spec.platformOwned) {
    eq(`GET ${coll}: declares no ownership narrowing it does not perform`, list?.ownership, 'none');
    for (const ep of own) {
      const leaked = ep.roles.filter((r) => MEMBER_ROLES.includes(r));
      eq(`${ep.method} ${ep.path}: no member role reaches a platform-owned route`, leaked.length, 0);
    }
  } else {
    eq(`GET ${coll}: is ownership-scoped`, list?.ownership, 'scoped');
  }
  eq(`GET ${coll}: sits in ${spec.zone}`, list?.zone, spec.zone);
  check(`GET ${coll}: is paginated`, list?.responseShape.includes('meta: PageMeta') === true);
  // Either the shared `listQuery` or a module-specific one — but a paginated
  // collection with no declared query is a collection nobody can filter.
  check(
    `GET ${coll}: takes a declared list query`,
    typeof list?.requestQuery === 'string' && /Query$/.test(list.requestQuery),
  );

  // The ownership wiring must be declared alongside the routes.
  const scope = SCOPE_TABLE[spec.collectionPath];
  check(
    `${spec.collectionPath}: declares its ownership wiring`,
    scope !== undefined && scope.describes.length > 0,
  );
  if (spec.platformOwned) {
    check(
      `${spec.collectionPath}: claims no owner field, because it has no owner`,
      scope?.ownerPath === undefined,
    );
  } else {
    check(
      `${spec.collectionPath}: names the field its scope narrows on`,
      typeof scope?.ownerPath === 'string' && scope.ownerPath.length > 0,
    );
  }
}

// Notifications are the one surface with no `:id` collection twin — the inbox is
// always the caller's own — so it is asserted on its own terms.
for (const path of ['/notifications/register-token', '/notifications/me', '/notifications/test']) {
  check(`${path}: declared`, blueprint.some((e) => e.path === path));
}
eq(
  'GET /notifications/me is self-scoped',
  blueprint.find((e) => e.path === '/notifications/me')?.ownership,
  'self',
);
eq(
  'POST /notifications/test is HQ-gated',
  blueprint.find((e) => e.path === '/notifications/test')?.zone,
  'HQ_EXECUTIVE',
);
check(
  'PATCH /notification/:notificationId is declared with a named id',
  seen.has('PATCH /notification/:notificationId'),
);
check(
  'a push token is never a readable field',
  findProperty('PushTokenRegistration', 'token')?.writeOnly === true,
);

// `/me` before `:id`, everywhere — not only on the profile surface. Express
// matches in registration order, so a `/me` declared after `/:xId` is a route
// that resolves to a lookup for a record with the literal id "me".
for (const ep of blueprint) {
  if (!/^\/[^/]+\/me(\/|$)/.test(ep.path)) continue;
  const meSegments = ep.path.split('/');
  const meIndex = blueprint.indexOf(ep);

  // A parameterised route only swallows `/me` if it could actually match it:
  // same arity, and every literal segment equal. `/coordinator/:id/assign` has
  // one segment too many to touch `/coordinator/me`.
  const shadowing = blueprint.filter((e) => {
    if (e.method !== ep.method || blueprint.indexOf(e) >= meIndex) return false;
    const segments = e.path.split('/');
    if (segments.length !== meSegments.length) return false;
    return segments.every((s, i) => s.startsWith(':') || s === meSegments[i]);
  });
  eq(
    `${ep.method} ${ep.path}: no earlier parameterised route can match it`,
    shadowing.length,
    0,
  );
  check(`${ep.method} ${ep.path}: is self-scoped`, ep.ownership === 'self');
}

// Money moves only through the flows that cause it. A client asserting "I paid"
// against the ledger directly is the whole class of bug this forbids.
const paymentWrites = blueprint.filter(
  (e) => e.module === 'payment' && e.method !== 'GET',
);
eq('the payments ledger is read-only over HTTP', paymentWrites.length, 0);

for (const path of ['/lease/:leaseId/payments', '/ride/:rideId/complete']) {
  const ep = blueprint.find((e) => e.method === 'POST' && e.path === path);
  check(`${path}: declared`, ep !== undefined);
  check(`${path}: is audited`, ep?.audited === true);
  check(
    `${path}: explains that it writes the ledger row`,
    (ep?.notes ?? '').toLowerCase().includes('ledger'),
  );
}

// Every mutation on an operational module must be audited — these are the
// records a dispute is settled from.
for (const ep of blueprint) {
  if (!OPERATIONAL_MODULES.some((m) => m.module === ep.module) && ep.module !== 'notification') {
    continue;
  }
  if (ep.method === 'GET') continue;
  check(`${ep.method} ${ep.path}: mutation is audited`, ep.audited === true);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Ride lifecycle');

eq('9 ride statuses', RIDE_STATUSES.length, 9);
eq('every status has a transition list', Object.keys(RIDE_TRANSITIONS).length, RIDE_STATUSES.length);

for (const status of RIDE_STATUSES) {
  const targets = RIDE_TRANSITIONS[status];
  check(`${status}: has a transition list`, Array.isArray(targets));
  for (const target of targets) {
    check(
      `${status} → ${target}: target is a real status`,
      RIDE_STATUSES.includes(target as RideStatus),
    );
    check(`${status} → ${target}: is not a self-loop`, target !== status);
  }
  check(`${status}: no duplicate targets`, new Set(targets).size === targets.length);
}

// Terminal states are terminal, and they are the ones a trip can actually end in.
eq('4 terminal statuses', RIDE_TERMINAL_STATUSES.length, 4);
for (const t of ['completed', 'cancelledByRider', 'cancelledByDriver', 'expired']) {
  check(`${t}: is terminal`, RIDE_TERMINAL_STATUSES.includes(t as RideStatus));
  eq(`${t}: leads nowhere`, RIDE_TRANSITIONS[t as RideStatus].length, 0);
}

// No orphans: every status must be reachable from the state a ride opens in.
const reachable = reachableRideStatuses('requested');
for (const status of RIDE_STATUSES) {
  check(`${status}: reachable from requested`, reachable.includes(status));
}

// The moves the routers actually make must be legal.
check('a searching ride can be accepted', canTransition('searching', 'accepted'));
check('an accepted ride can start', canTransition('accepted', 'inProgress'));
check('an arriving ride can start', canTransition('arriving', 'inProgress'));
check('an in-progress ride can complete', canTransition('inProgress', 'completed'));
check('a requested ride can be cancelled by the rider', canTransition('requested', 'cancelledByRider'));
check('an accepted ride can be cancelled by the driver', canTransition('accepted', 'cancelledByDriver'));

// And the moves that would corrupt earnings must not be.
check('a completed ride cannot be accepted again', !canTransition('completed', 'accepted'));
check('a completed ride cannot be re-completed', !canTransition('completed', 'completed'));
check('a cancelled ride cannot be started', !canTransition('cancelledByRider', 'inProgress'));
check('a cancelled ride cannot complete', !canTransition('cancelledByDriver', 'completed'));
check('a searching ride cannot skip straight to completed', !canTransition('searching', 'completed'));
check('an expired ride cannot be revived', !canTransition('expired', 'searching'));
check('an unknown status transitions nowhere', !canTransition('nonsense', 'accepted'));
check('no status transitions to an unknown target', !canTransition('requested', 'nonsense'));

// Only a ride that reached `completed` may carry earnings — the ledger row is
// written on that transition and nowhere else.
for (const status of RIDE_STATUSES) {
  if (status === 'completed') continue;
  check(
    `${status}: cannot reach completed without passing through inProgress`,
    status === 'inProgress' || !RIDE_TRANSITIONS[status].includes('completed'),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
section('Rent arithmetic');

/** A one-year lease at 1,000/month, billed on the 5th, starting 15 Jan 2026. */
const LEASE: RentTerms = {
  leaseStart: new Date(Date.UTC(2026, 0, 15)),
  leaseEnd: new Date(Date.UTC(2027, 0, 14)),
  monthlyRent: 1000,
  paymentDayOfMonth: 5,
  totalPaid: 0,
};
const day = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

eq('money rounds to the minor unit', money(33.333), 33.33);
eq('money does not drift on halves', money(0.1 + 0.2), 0.3);

// Month-end clamping: the 31st of a short month is that month's last day.
eq('31st of February 2026 clamps to the 28th', clampDayToMonth(2026, 1, 31), 28);
eq('29th of February 2028 survives — it is a leap year', clampDayToMonth(2028, 1, 29), 29);
eq('31st of April clamps to the 30th', clampDayToMonth(2026, 3, 31), 30);
eq('day 0 clamps up to the 1st', clampDayToMonth(2026, 0, 0), 1);

// Instalment 0 is the advance payment at lease start, never the billing day.
eq(
  'instalment 0 falls on the lease start date',
  instalmentDueDate(LEASE, 0).toISOString().slice(0, 10),
  '2026-01-15',
);
eq(
  'instalment 1 falls on the billing day of the next month',
  instalmentDueDate(LEASE, 1).toISOString().slice(0, 10),
  '2026-02-05',
);
eq(
  'instalment 12 rolls into the following year',
  instalmentDueDate(LEASE, 12).toISOString().slice(0, 10),
  '2027-01-05',
);

const LATE_BILLED: RentTerms = { ...LEASE, paymentDayOfMonth: 31 };
eq(
  'a lease billed on the 31st is due on the 28th in February',
  instalmentDueDate(LATE_BILLED, 1).toISOString().slice(0, 10),
  '2026-02-28',
);
eq(
  'and on the 31st again in March — the clamp does not stick',
  instalmentDueDate(LATE_BILLED, 2).toISOString().slice(0, 10),
  '2026-03-31',
);

eq('nothing is due before the lease starts', instalmentsDueBy(LEASE, day(2026, 1, 1)), 0);
eq('the advance payment is due on day one', instalmentsDueBy(LEASE, day(2026, 1, 15)), 1);
eq('still one instalment on the 4th of February', instalmentsDueBy(LEASE, day(2026, 2, 4)), 1);
eq('two on the 5th of February', instalmentsDueBy(LEASE, day(2026, 2, 5)), 2);
eq('thirteen by the end of the term', instalmentsDueBy(LEASE, day(2027, 1, 14)), 13);
eq('and no more after it', instalmentsDueBy(LEASE, day(2030, 1, 1)), 13);

eq('expected to date is instalments × rent', expectedToDate(LEASE, day(2026, 4, 6)), 4000);

// Arrears, credit, and the fact that they are never both non-zero.
const PART_PAID: RentTerms = { ...LEASE, totalPaid: 2500 };
eq('arrears is expected less paid', arrearsFor(PART_PAID, day(2026, 4, 6)), 1500);
eq('and credit is zero while behind', creditBalanceFor(PART_PAID, day(2026, 4, 6)), 0);

const PREPAID: RentTerms = { ...LEASE, totalPaid: 6000 };
eq('a tenant paid ahead is not in arrears', arrearsFor(PREPAID, day(2026, 4, 6)), 0);
eq('they are in credit', creditBalanceFor(PREPAID, day(2026, 4, 6)), 2000);
for (const asOf of [day(2026, 1, 20), day(2026, 6, 6), day(2026, 12, 6)]) {
  const a = arrearsFor(PART_PAID, asOf);
  const c = creditBalanceFor(PART_PAID, asOf);
  check(`arrears and credit are never both non-zero (${asOf.toISOString().slice(0, 10)})`, a === 0 || c === 0);
}

eq(
  'next due is the following billing day',
  nextPaymentDue(LEASE, day(2026, 2, 6))?.toISOString().slice(0, 10),
  '2026-03-05',
);
eq('there is no next instalment past the term', nextPaymentDue(LEASE, day(2027, 1, 14)), null);

// Lifecycle, computed from dates and balance — but never over a manual status.
eq('a paid-up lease mid-term is active', lifecycleStatus(PREPAID, day(2026, 4, 6)), 'active');
eq('an unpaid lease is inArrears', lifecycleStatus(PART_PAID, day(2026, 6, 6)), 'inArrears');
eq('a lease inside the notice window is expiring', lifecycleStatus({ ...LEASE, totalPaid: 999999 }, day(2026, 12, 20)), 'expiring');
eq('a lease past its end date has ended', lifecycleStatus(LEASE, day(2027, 2, 1)), 'ended');
eq('a terminated lease stays terminated', lifecycleStatus(LEASE, day(2026, 6, 1), 'terminated'), 'terminated');
eq('a draft lease stays draft', lifecycleStatus(LEASE, day(2026, 6, 1), 'draft'), 'draft');
eq('but an active one is recomputed', lifecycleStatus(PART_PAID, day(2026, 6, 1), 'active'), 'inArrears');

// Escalation is in months of rent, so it holds across currencies and price points.
eq('nothing owed, nothing to chase', arrearsEscalation(0, 1000), 'none');
eq('under a month is a reminder', arrearsEscalation(900, 1000), 'reminder');
eq('exactly one month is still a reminder', arrearsEscalation(1000, 1000), 'reminder');
eq('two months is a first notice', arrearsEscalation(1800, 1000), 'firstNotice');
eq('three months is a final notice', arrearsEscalation(2600, 1000), 'finalNotice');
eq('beyond three months it is a legal referral', arrearsEscalation(5000, 1000), 'legalReferral');
eq('the same thresholds hold at a different price point', arrearsEscalation(9000, 5000), 'firstNotice');

// applyPayment is the single computation both rows are written from.
const applied = applyPayment(PART_PAID, 1500, day(2026, 4, 6), 'inArrears');
eq('applying a payment adds to the total', applied.totalPaid, 4000);
eq('and clears the arrears it covers', applied.arrearsAmount, 0);
eq('which moves the lease back to active', applied.status, 'active');
eq('and drops the escalation', applied.escalation, 'none');
check('and sets the next due date', applied.nextDueDate !== null);

const partial = applyPayment(PART_PAID, 500, day(2026, 4, 6), 'inArrears');
eq('a partial payment leaves the balance behind', partial.arrearsAmount, 1000);
eq('and the lease in arrears', partial.status, 'inArrears');

// Reminders: overdue money beats an approaching instalment.
const dueSoon = reminderFor({ ...LEASE, totalPaid: 4000 }, day(2026, 4, 2), 5);
eq('a paid-up lease three days out is reminded', dueSoon.send, true);
eq('for the right reason', dueSoon.reason, 'dueSoon');
eq('and knows how many days', dueSoon.daysUntilDue, 3);

const overdueVerdict = reminderFor(PART_PAID, day(2026, 4, 2), 5);
eq('a lease in arrears is reminded', overdueVerdict.send, true);
eq('and arrears outranks dueSoon', overdueVerdict.reason, 'inArrears');

const quiet = reminderFor({ ...LEASE, totalPaid: 4000 }, day(2026, 3, 20), 5);
eq('a paid-up lease far from its due date is left alone', quiet.send, false);
eq('with no reason to send', quiet.reason, 'none');

const schedule = paymentSchedule({ ...LEASE, totalPaid: 2000 }, day(2026, 4, 6));
eq('the schedule covers the whole term', schedule.totalInstalments, 13);
eq('and is not truncated at 13 lines', schedule.truncated, false);
eq('the first two instalments are settled', schedule.entries.filter((e) => e.settled).length, 2);
check(
  'cumulative due increases monotonically',
  schedule.entries.every((e, i) => i === 0 || e.cumulativeDue > schedule.entries[i - 1]!.cumulativeDue),
);
check(
  'and every due date is inside the term',
  schedule.entries.every((e) => e.dueDate >= LEASE.leaseStart && e.dueDate <= LEASE.leaseEnd),
);

// ═══════════════════════════════════════════════════════════════════════════
section('Maintenance SLA');

eq('four priorities have a default clock', Object.keys(SLA_HOURS_BY_PRIORITY).length, 4);
check(
  'a more urgent priority always has a shorter clock',
  SLA_HOURS_BY_PRIORITY.emergency < SLA_HOURS_BY_PRIORITY.high &&
    SLA_HOURS_BY_PRIORITY.high < SLA_HOURS_BY_PRIORITY.normal &&
    SLA_HOURS_BY_PRIORITY.normal < SLA_HOURS_BY_PRIORITY.low,
);
eq('an explicit override wins', slaHoursFor('normal', 6), 6);
eq('a zero override does not', slaHoursFor('normal', 0), 72);
eq('grace is floored at an hour', graceHours(1), 1);
eq('and capped at a day', graceHours(1000), 24);
eq('otherwise it is a quarter of the clock', graceHours(24), 6);

const raised = new Date(Date.UTC(2026, 5, 1, 8, 0));
const clockAt = (hours: number, opts = {}) =>
  slaClockFor(raised, 'high', new Date(raised.getTime() + hours * 3_600_000), opts);

eq('dueAt is createdAt plus the clock', clockAt(0).dueAt.toISOString(), new Date(Date.UTC(2026, 5, 2, 8, 0)).toISOString());
eq('overdueAt adds the grace period', clockAt(0).overdueAt.toISOString(), new Date(Date.UTC(2026, 5, 2, 14, 0)).toISOString());
check('createdAt < dueAt < overdueAt, always', raised < clockAt(0).dueAt && clockAt(0).dueAt < clockAt(0).overdueAt);

eq('fresh work is on track', clockAt(1).state, 'onTrack');
eq('80% through the window it is at risk', clockAt(20).state, 'atRisk');
eq('past the target it is due', clockAt(25).state, 'due');
eq('past the grace period it is overdue', clockAt(31).state, 'overdue');
eq('and only then does it count as breached', clockAt(31).breached, true);
eq('a request merely due is not yet breached', clockAt(25).breached, false);
eq('the at-risk threshold is 80%', AT_RISK_THRESHOLD, 0.8);

// A finished request is judged against when it finished, not against now.
const metLate = slaClockFor(raised, 'high', new Date(Date.UTC(2026, 8, 1)), {
  completedAt: new Date(raised.getTime() + 10 * 3_600_000),
});
eq('a job completed inside its window stays met, however long ago', metLate.state, 'met');
eq('and is never retroactively breached', metLate.breached, false);
const missed = slaClockFor(raised, 'high', new Date(Date.UTC(2026, 8, 1)), {
  completedAt: new Date(raised.getTime() + 40 * 3_600_000),
});
eq('a job completed late is breached', missed.state, 'breached');

// Urgency shortens the escalation ladder rather than skipping it.
eq('an at-risk emergency already reaches a coordinator', escalationFor('atRisk', 'emergency'), 'notifyCoordinator');
eq('an at-risk normal job only nudges the vendor', escalationFor('atRisk', 'normal'), 'notifyVendor');
eq('an overdue emergency goes to HQ', escalationFor('overdue', 'emergency'), 'notifyHQ');
eq('an overdue high job goes to Back Office', escalationFor('overdue', 'high'), 'notifyBackOffice');
eq('an overdue low job stops at the coordinator', escalationFor('overdue', 'low'), 'notifyCoordinator');
eq('on-track work escalates to nobody', escalationFor('onTrack', 'emergency'), 'none');
eq('and met work escalates to nobody', escalationFor('met', 'emergency'), 'none');
for (const state of SLA_STATES) {
  for (const priority of ['low', 'normal', 'high', 'emergency'] as const) {
    check(
      `escalationFor(${state}, ${priority}) is a real escalation`,
      (SLA_ESCALATIONS as readonly string[]).includes(escalationFor(state, priority)),
    );
  }
}

check('open work keeps the clock running', isSlaOpen('inProgress'));
check('completed work stops it', !isSlaOpen('completed'));
check('verified work stops it', !isSlaOpen('verified'));
check('cancelled work stops it', !isSlaOpen('cancelled'));
eq('resolution hours are measured from creation', resolutionHours(raised, new Date(raised.getTime() + 5.5 * 3_600_000)), 5.5);
eq('and never go negative on a clock skew', resolutionHours(raised, new Date(raised.getTime() - 3_600_000)), 0);

eq(
  'an explicit coordinator wins',
  routeToCoordinator({ explicit: 'A', propertyCoordinator: 'B' }).coordinator,
  'A',
);
eq(
  "otherwise the property's standing coordinator takes it",
  routeToCoordinator({ propertyCoordinator: 'B' }).via,
  'property',
);
eq(
  'a coordinator who raises a job owns it',
  routeToCoordinator({ raisedByKind: 'CoordinatorProfile', raisedBy: 'C' }).coordinator,
  'C',
);
eq(
  'a tenant who raises one does not',
  routeToCoordinator({ raisedByKind: 'TenantProfile', raisedBy: 'T' }).coordinator,
  null,
);
eq('and that is reported as unrouted, not guessed', routeToCoordinator({}).via, 'unrouted');

// ═══════════════════════════════════════════════════════════════════════════
section('Driver matching');

const RIDE_REQ = { vehicleType: 'sedan', region: 'Greater Accra', pickupLongitude: -0.19, pickupLatitude: 5.6 };
const baseDriver: DispatchCandidate = {
  id: 'd1',
  vehicleType: 'sedan',
  verificationStatus: 'verified',
  status: 'active',
  isOnline: true,
  region: 'Greater Accra',
  rating: 4.5,
  ratingCount: 40,
  acceptanceRate: 90,
  completedRides: 100,
  cancelledRides: 10,
  longitude: -0.2,
  latitude: 5.6,
};
const NOW = new Date(Date.UTC(2026, 5, 1, 12, 0));

eq('the match weights sum to 1', Math.round(Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0) * 1000) / 1000, 1);

eq('a well-formed driver is dispatchable', isDispatchable(baseDriver, RIDE_REQ, NOW), true);
eq('an unverified driver is not', dispatchRejections({ ...baseDriver, verificationStatus: 'pending' }, RIDE_REQ, NOW)[0], 'notVerified');
eq('a suspended driver is not', dispatchRejections({ ...baseDriver, status: 'suspended' }, RIDE_REQ, NOW)[0], 'notActive');
eq('an offline driver is not', dispatchRejections({ ...baseDriver, isOnline: false }, RIDE_REQ, NOW)[0], 'offline');
eq(
  'a stale heartbeat counts as offline',
  dispatchRejections({ ...baseDriver, lastOnlineAt: new Date(NOW.getTime() - 60 * 60_000) }, RIDE_REQ, NOW)[0],
  'staleHeartbeat',
);
eq('the wrong vehicle class is not', dispatchRejections({ ...baseDriver, vehicleType: 'suv' }, RIDE_REQ, NOW)[0], 'wrongVehicleType');
eq('and neither is the wrong region', dispatchRejections({ ...baseDriver, region: 'Ashanti' }, RIDE_REQ, NOW)[0], 'outOfRegion');
check(
  'but a driver who covers the region as a served area is',
  isDispatchable({ ...baseDriver, region: 'Ashanti', areasCovered: ['Greater Accra'] }, RIDE_REQ, NOW),
);
check('coversRegion is permissive when the ride names no region', coversRegion(baseDriver, undefined));
eq(
  'a driver beyond the radius is rejected',
  dispatchRejections({ ...baseDriver, longitude: -1.6, latitude: 6.7 }, RIDE_REQ, NOW).includes('tooFar'),
  true,
);
eq(
  'every rejection reason is reported, not just the first',
  dispatchRejections({ ...baseDriver, isOnline: false, vehicleType: 'bus', verificationStatus: 'pending' }, RIDE_REQ, NOW).length,
  3,
);

check('haversine gives zero for the same point', haversineKm(-0.19, 5.6, -0.19, 5.6) === 0);
check('and is symmetric', haversineKm(-0.19, 5.6, -0.2, 5.62) === haversineKm(-0.2, 5.62, -0.19, 5.6));
eq('distance is null when either side has no coordinates', distanceFor({ ...baseDriver, longitude: undefined }, RIDE_REQ), null);

const scored = matchScore(baseDriver, RIDE_REQ);
check('a score is between 0 and 1', scored.score >= 0 && scored.score <= 1);
check('and every component is too', Object.values(scored.components).every((c) => c >= 0 && c <= 1));
check(
  'a nearer driver scores higher, all else equal',
  matchScore(baseDriver, RIDE_REQ).score >
    matchScore({ ...baseDriver, id: 'd2', longitude: -0.3, latitude: 5.7 }, RIDE_REQ).score,
);
check(
  'a better-rated driver scores higher, all else equal',
  matchScore(baseDriver, RIDE_REQ).score >
    matchScore({ ...baseDriver, id: 'd2', rating: 3 }, RIDE_REQ).score,
);
check(
  'a new driver with no ratings is not scored to zero',
  matchScore({ ...baseDriver, id: 'd3', rating: 0, ratingCount: 0, completedRides: 0, cancelledRides: 0 }, RIDE_REQ)
    .components.rating > 0.5,
);
eq(
  'an unknown position is neutral, not perfect',
  matchScore({ ...baseDriver, longitude: undefined, latitude: undefined }, RIDE_REQ).components.proximity,
  0.5,
);
eq('the radius is the proximity scale', MAX_PICKUP_RADIUS_KM, 15);

const pool: DispatchCandidate[] = [
  { ...baseDriver, id: 'far', longitude: -0.28, latitude: 5.65 },
  { ...baseDriver, id: 'near' },
  { ...baseDriver, id: 'offline', isOnline: false },
  { ...baseDriver, id: 'unverified', verificationStatus: 'pending' },
  { ...baseDriver, id: 'wrongCar', vehicleType: 'bus' },
];
const ranked = rankDrivers(pool, RIDE_REQ, NOW, 10);
eq('the ranker considers everyone it was handed', ranked.considered, 5);
eq('and keeps only the dispatchable', ranked.matches.length, 2);
eq('the nearest eligible driver leads', ranked.matches[0]!.driverId, 'near');
eq('rejections are counted by reason', ranked.rejected.offline, 1);
eq('including verification', ranked.rejected.notVerified, 1);
eq('and vehicle class', ranked.rejected.wrongVehicleType, 1);
check(
  'scores come back in descending order',
  ranked.matches.every((m, i) => i === 0 || m.score <= ranked.matches[i - 1]!.score),
);
eq('the limit is honoured', rankDrivers(pool, RIDE_REQ, NOW, 1).matches.length, 1);

// Determinism: identical drivers must produce a stable order, or the list
// reshuffles between two calls and nothing about dispatch can be reasoned about.
const twins: DispatchCandidate[] = ['zz', 'aa', 'mm'].map((id) => ({ ...baseDriver, id }));
eq(
  'identical candidates tie-break on driver id',
  rankDrivers(twins, RIDE_REQ, NOW).matches.map((m) => m.driverId).join(','),
  'aa,mm,zz',
);
eq(
  'and the same input twice gives the same order',
  JSON.stringify(rankDrivers(pool, RIDE_REQ, NOW).matches),
  JSON.stringify(rankDrivers(pool, RIDE_REQ, NOW).matches),
);

// ═══════════════════════════════════════════════════════════════════════════
section('Ledger: commission, payouts, refunds');

const split = commissionSplit(100, 15);
eq('a 15% fee on 100 is 15', split.platformFee, 15);
eq('and the net is the remainder', split.net, 85);
eq('the default ride commission is 15%', DEFAULT_RIDE_COMMISSION_PERCENT, 15);

// The remainder discipline: gross must always equal fee plus net, at any price.
// The values matter. A split that rounds the fee and the net *independently*
// balances at most amounts and loses a pesewa at a few — 0.15 at 50% is the
// smallest case where it shows. A loop that only tries round numbers passes an
// implementation that quietly does not balance.
for (const gross of [33.33, 0.01, 0.05, 0.15, 7.77, 12345.67, 99.99]) {
  for (const pct of [0, 7.5, 15, 33, 50, 100]) {
    const s2 = commissionSplit(gross, pct);
    check(
      `commissionSplit(${gross}, ${pct}) balances to the pesewa`,
      Math.abs(s2.gross - (s2.platformFee + s2.net)) < 0.005,
    );
  }
}
eq('a negative gross is floored at zero', commissionSplit(-5, 15).gross, 0);
eq('a commission above 100% is clamped', commissionSplit(100, 500).commissionPercent, 100);
eq('and a negative one is clamped too', commissionSplit(100, -20).commissionPercent, 0);
eq('a zero commission leaves the whole amount', commissionSplit(100, 0).net, 100);

check('every payout kind names its ledger sources', PAYOUT_KINDS.every((k) => PAYOUT_SOURCES[k].length > 0));
check(
  'a driver payout is built from ride fares',
  PAYOUT_SOURCES.driverPayout.includes('ride'),
);
check(
  'a landlord payout is built from rent, not from fares',
  PAYOUT_SOURCES.landlordPayout.includes('rent') && !PAYOUT_SOURCES.landlordPayout.includes('ride'),
);

const rows: LedgerRow[] = [
  { id: 'r1', kind: 'ride', status: 'succeeded', payee: 'drv1', payeeKind: 'DriverProfile', amount: 100, platformFee: 15, netAmount: 85, currency: 'GHS' },
  { id: 'r2', kind: 'ride', status: 'succeeded', payee: 'drv1', payeeKind: 'DriverProfile', amount: 50, platformFee: 7.5, netAmount: 42.5, currency: 'GHS' },
  { id: 'r3', kind: 'ride', status: 'succeeded', payee: 'drv2', payeeKind: 'DriverProfile', amount: 200, platformFee: 30, netAmount: 170, currency: 'GHS' },
  { id: 'r4', kind: 'ride', status: 'pending', payee: 'drv3', payeeKind: 'DriverProfile', amount: 80, platformFee: 12, netAmount: 68, currency: 'GHS' },
  { id: 'r5', kind: 'rent', status: 'succeeded', payee: 'll1', payeeKind: 'LandlordProfile', amount: 900, currency: 'GHS' },
  { id: 'r6', kind: 'ride', status: 'succeeded', payee: 'drv1', payeeKind: 'DriverProfile', amount: 60, platformFee: 9, netAmount: 51, currency: 'USD' },
  { id: 'r7', kind: 'ride', status: 'succeeded', payeeKind: 'DriverProfile', amount: 40, currency: 'GHS' },
];

const batch = buildPayoutBatch('driverPayout', rows, 'GHS');
eq('one line per payee', batch.lineCount, 2);
eq('a payee with three fares is rolled into one line', batch.lines.find((l) => l.payee === 'drv1')!.sourceIds.length, 2);
eq('and their net is summed', batch.lines.find((l) => l.payee === 'drv1')!.net, 127.5);
eq('the largest line comes first', batch.lines[0]!.payee, 'drv2');
eq('the batch total is the sum of its lines', batch.net, 297.5);
check('and the batch balances', batchBalances(batch));

const reasons = Object.fromEntries(batch.skipped.map((s) => [s.id, s.reason]));
eq('an unsettled row is skipped', reasons.r4, 'status:pending');
eq('a row of the wrong kind is skipped', reasons.r5, 'kind:rent');
eq('a row in another currency is skipped', reasons.r6, 'currency:USD');
eq('and a row with no payee is skipped', reasons.r7, 'noPayee');
eq('every skip is accounted for', batch.skipped.length, 4);

check('a settled row with a payee is payable', isPayable(rows[0]!).ok);
check('a pending row is not', !isPayable(rows[3]!).ok);
check('a payee-less row is not', !isPayable(rows[6]!).ok);

// Grouping by payee *and* currency: two currencies are two transfers.
const mixed = buildPayoutBatch('driverPayout', [rows[0]!, rows[5]!]);
eq('a payee owed in two currencies gets two lines', mixed.lineCount, 2);

eq('an empty batch is empty, not an error', buildPayoutBatch('driverPayout', []).lineCount, 0);
check('and an empty batch still balances', batchBalances(buildPayoutBatch('driverPayout', [])));

eq('a settled payment is fully refundable', refundableAmount({ amount: 100, status: 'succeeded' }), 100);
eq('less what was already refunded', refundableAmount({ amount: 100, status: 'succeeded' }, 30), 70);
eq('never below zero', refundableAmount({ amount: 100, status: 'succeeded' }, 500), 0);
eq('and nothing is refundable against money that never settled', refundableAmount({ amount: 100, status: 'failed' }), 0);

const earnings = summariseEarnings(rows, 'GHS');
eq('earnings count every settled row in the currency', earnings.count, 5);
eq('gross is summed', earnings.gross, 1290);
eq('and broken down by kind', earnings.byKind.ride!.count, 4);
eq('rent is its own bucket', earnings.byKind.rent!.count, 1);
check('every bucket sums to no more than the total', earnings.byKind.ride!.gross <= earnings.gross);

// ═══════════════════════════════════════════════════════════════════════════
section('Portfolio analytics');

eq('percent of nothing is zero, not NaN', percent(5, 0), 0);
eq('percent rounds to one decimal', percent(1, 3), 33.3);

const props = [
  { id: 'p1', occupancyStatus: 'occupied' },
  { id: 'p2', occupancyStatus: 'occupied' },
  { id: 'p3', occupancyStatus: 'vacant' },
  { id: 'p4', occupancyStatus: 'maintenance' },
  { id: 'p5', occupancyStatus: 'offMarket' },
];
const occ = occupancyKpis(props);
eq('total counts everything on file', occ.total, 5);
eq('occupiable excludes off-market stock', occ.occupiable, 4);
eq('occupancy is against the occupiable estate', occ.occupancyRate, 50);
eq('an empty estate does not divide by zero', occupancyKpis([]).occupancyRate, 0);

const rev = revenueKpis({
  properties: props,
  leases: [
    { id: 'l1', status: 'active', monthlyRent: 1000, arrearsAmount: 0 },
    { id: 'l2', status: 'inArrears', monthlyRent: 800, arrearsAmount: 800 },
    { id: 'l3', status: 'ended', monthlyRent: 500, arrearsAmount: 0 },
  ],
  ledger: [
    { kind: 'rent', status: 'succeeded', amount: 1000, netAmount: 900, currency: 'GHS', paidAt: day(2026, 6, 5) },
    { kind: 'rent', status: 'succeeded', amount: 800, netAmount: 720, currency: 'GHS', paidAt: day(2026, 5, 5) },
    { kind: 'rent', status: 'failed', amount: 999, currency: 'GHS', paidAt: day(2026, 6, 6) },
    { kind: 'adSpend', status: 'succeeded', amount: 300, currency: 'GHS', paidAt: day(2026, 6, 7) },
  ],
  fleet: [],
  ads: [],
  currency: 'GHS',
  from: day(2026, 6, 1),
  to: day(2026, 6, 30),
});
eq('rent roll counts live leases only', rev.monthlyRentRoll, 1800);
eq('collected counts only settled rows in the window', rev.collected, 1000);
eq('platform fees are gross less net', rev.platformFees, 100);
eq('arrears are summed across every lease', rev.arrears, 800);
eq('collection rate is against collected plus outstanding', rev.collectionRate, 55.6);
eq('ad spend is separated from rent', rev.adSpend, 300);

const fleet = fleetKpis([
  { availability: 'available' },
  { availability: 'rented' },
  { availability: 'rented' },
  { availability: 'maintenance' },
]);
eq('fleet size counts every vehicle', fleet.size, 4);
eq('utilisation is against vehicles in service', fleet.utilizationRate, 66.7);
eq('an empty fleet does not divide by zero', fleetKpis([]).utilizationRate, 0);

const camp = campaignKpis([
  { status: 'active', spend: 100, impressions: 1000, clicks: 50 },
  { status: 'paused', spend: 50, impressions: 500, clicks: 10 },
]);
eq('campaigns are counted', camp.campaigns, 2);
eq('active campaigns separately', camp.active, 1);
eq('and CTR is clicks over impressions', camp.clickThroughRate, 4);
eq('no impressions means no CTR, not NaN', campaignKpis([]).clickThroughRate, 0);

// The health score must not punish a client for a business line it does not run.
const landlordOnly = portfolioAnalytics({
  properties: props,
  leases: [{ id: 'l1', status: 'active', monthlyRent: 1000, arrearsAmount: 0 }],
  ledger: [{ kind: 'rent', status: 'succeeded', amount: 1000, currency: 'GHS', paidAt: day(2026, 6, 5) }],
  fleet: [],
  ads: [],
  currency: 'GHS',
});
eq('a client with no fleet is scored on occupancy and collection alone', landlordOnly.healthScore, 75);
eq('an empty client scores zero rather than NaN', portfolioAnalytics({ properties: [], leases: [], ledger: [], fleet: [], ads: [] }).healthScore, 0);
check('portfolio size spans every asset class', landlordOnly.portfolioSize === 5);



// ═══════════════════════════════════════════════════════════════════════════
section('Document rules');

eq('16 document types', DOCUMENT_TYPES.length, 16);
eq('every type has a rule', Object.keys(DOCUMENT_RULES).length, DOCUMENT_TYPES.length);

for (const type of DOCUMENT_TYPES) {
  const r = DOCUMENT_RULES[type];
  eq(`${type}: the rule names itself`, r.type, type);
  check(`${type}: has a label`, r.label.length > 0);
  check(`${type}: requires at least one field`, r.requiredFields.length > 0);
  check(
    `${type}: every required field is in the vocabulary`,
    r.requiredFields.every((f) => (DOCUMENT_FIELDS as readonly string[]).includes(f)),
  );
  check(
    `${type}: every optional field is in the vocabulary`,
    r.optionalFields.every((f) => (DOCUMENT_FIELDS as readonly string[]).includes(f)),
  );
  check(
    `${type}: no field is both required and optional`,
    r.optionalFields.every((f) => !r.requiredFields.includes(f)),
  );
  check(`${type}: names at least one subject kind`, r.subjectKinds.length > 0);
  check(`${type}: routes to a real desk`, (REVIEW_DESKS as readonly string[]).includes(r.desk));
  check(
    `${type}: any compliance rule it names is real`,
    r.compliance === null || (COMPLIANCE_RULES as readonly string[]).includes(r.compliance),
  );
  check(
    `${type}: an expiry period is positive when set`,
    r.expiryMonths === null || r.expiryMonths > 0,
  );
  check(`${type}: has a reviewing role`, reviewerRolesFor(type).length > 0);
}

// Every compliance rule must be reachable from some document type, or it is a
// rule nothing can ever trigger.
for (const rule of COMPLIANCE_RULES) {
  check(
    `compliance rule ${rule} is claimed by a document type`,
    DOCUMENT_TYPES.some((t) => DOCUMENT_RULES[t].compliance === rule),
  );
}

const NOW_DOC = new Date(Date.UTC(2026, 5, 15));
const past = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

// Field validation
eq('a good name passes', validateField('holderName', 'Kwame Mensah', NOW_DOC), null);
check('a one-character name fails', validateField('holderName', 'K', NOW_DOC) !== null);
check('an unknown field fails', validateField('favouriteColour', 'blue', NOW_DOC) !== null);
eq('an absent value is not a validation problem', validateField('holderName', undefined, NOW_DOC), null);
eq('a good document number passes', validateField('documentNumber', 'GHA-123456789-0', NOW_DOC), null);
check('a two-character number fails', validateField('documentNumber', 'AB', NOW_DOC) !== null);
check('a future issue date fails', validateField('issuedOn', past(2027, 1, 1), NOW_DOC) !== null);
eq('a past issue date passes', validateField('issuedOn', past(2024, 1, 1), NOW_DOC), null);
check('a future date of birth fails', validateField('dateOfBirth', past(2030, 1, 1), NOW_DOC) !== null);
check('a 200-year-old date of birth fails', validateField('dateOfBirth', past(1800, 1, 1), NOW_DOC) !== null);
check('a negative income fails', validateField('monthlyIncome', -5, NOW_DOC) !== null);
check('a non-numeric income fails', validateField('monthlyIncome', 'lots', NOW_DOC) !== null);
check('a lowercase currency fails', validateField('currency', 'ghs', NOW_DOC) !== null);
eq('an ISO currency passes', validateField('currency', 'GHS', NOW_DOC), null);
check('an unknown relationship fails', validateField('relationship', 'flatmate', NOW_DOC) !== null);
eq('a known relationship passes', validateField('relationship', 'child', NOW_DOC), null);
check('an unknown background outcome fails', validateField('outcome', 'probably fine', NOW_DOC) !== null);

// Whole-document validation
const goodIdentity = {
  holderName: 'Kwame Mensah',
  documentNumber: 'GHA-123456789-0',
  issuingAuthority: 'National Identification Authority',
  issuedOn: past(2022, 3, 1),
  expiresOn: past(2032, 3, 1),
};
const okDoc = validateDocumentFields('identity', goodIdentity, NOW_DOC);
eq('a complete identity document validates', okDoc.ok, true);
eq('with nothing missing', okDoc.missing.length, 0);

const incomplete = validateDocumentFields('identity', { holderName: 'Kwame Mensah' }, NOW_DOC);
eq('an incomplete one does not', incomplete.ok, false);
eq('and lists exactly what is missing', incomplete.missing.length, 4);
check('including the document number', incomplete.missing.includes('documentNumber'));

// Unexpected fields are reported, not dropped — a client sending employerName on
// a birth certificate has misunderstood something.
const stray = validateDocumentFields('birthRecord', {
  holderName: 'Ama Mensah',
  dateOfBirth: past(2018, 4, 2),
  issuingAuthority: 'Births and Deaths Registry',
  issuedOn: past(2018, 5, 1),
  employerName: 'Nowhere Ltd',
}, NOW_DOC);
eq('an unexpected field makes the document invalid', stray.ok, false);
eq('and is named', stray.unexpected[0], 'employerName');

const backwards = validateDocumentFields('identity', {
  ...goodIdentity,
  expiresOn: past(2021, 1, 1),
}, NOW_DOC);
check('expiry before issue is caught', backwards.invalid.some((p) => p.field === 'expiresOn'));

const bornAfterIssued = validateDocumentFields('birthRecord', {
  holderName: 'Ama Mensah',
  dateOfBirth: past(2020, 1, 1),
  issuingAuthority: 'Registry',
  issuedOn: past(2019, 1, 1),
}, NOW_DOC);
check('a birth after the certificate is caught', bornAfterIssued.invalid.some((p) => p.field === 'dateOfBirth'));

// Expiry derivation: the document's own date always wins over our policy.
eq(
  'a stated expiry wins over the type period',
  expiryDateFor('proofOfResidency', { issuedOn: past(2026, 1, 1), expiresOn: past(2027, 1, 1) })?.toISOString().slice(0, 10),
  '2027-01-01',
);
eq(
  'otherwise the period is imputed from the issue date',
  expiryDateFor('proofOfResidency', { issuedOn: past(2026, 1, 1) })?.toISOString().slice(0, 10),
  '2026-07-01',
);
eq('a non-expiring type stays null', expiryDateFor('birthRecord', { issuedOn: past(2018, 1, 1) }), null);
eq('with no anchor there is no expiry', expiryDateFor('proofOfResidency', {}), null);
// Month-length clamp, same discipline as the rent schedule: three months from
// 30 November is 28 February, not 2 March.
eq(
  'adding months clamps to the shorter month',
  expiryDateFor('incomeProof', { issuedOn: past(2026, 11, 30) })?.toISOString().slice(0, 10),
  '2027-02-28',
);
eq(
  'and leaves a date that needs no clamping alone',
  expiryDateFor('incomeProof', { issuedOn: past(2026, 12, 31) })?.toISOString().slice(0, 10),
  '2027-03-31',
);
eq(
  'a leap year keeps the 29th',
  expiryDateFor('incomeProof', { issuedOn: past(2027, 11, 30) })?.toISOString().slice(0, 10),
  '2028-02-29',
);

check('a verified identity cannot change its number', isImmutableAfterVerification('documentNumber'));
check('nor its holder', isImmutableAfterVerification('holderName'));
check('but notes stay editable', !isImmutableAfterVerification('notes'));
eq(
  'a patch reports exactly which keys are locked',
  lockedFieldsIn({ notes: 'x', documentNumber: 'y', title: 'z' }).join(','),
  'documentNumber',
);

check('a criminal record check must be re-verified when it lapses', requiresReverification('criminalBackground'));
check('a utility bill need not be', !requiresReverification('proofOfResidency'));
check('an identity document is restricted', isRestricted('identity'));
check('a roadworthiness certificate is not', !isRestricted('roadworthiness'));
check('a driver licence belongs to a driver profile', acceptsSubjectKind('driverLicence', 'DriverProfile'));
check('and not to a lease', !acceptsSubjectKind('driverLicence', 'Lease'));
eq('criminal checks are an HQ desk', deskFor('criminalBackground'), 'hqExecutive');
eq('residency proofs are a coordinator desk', deskFor('proofOfResidency'), 'coordinator');

// ═══════════════════════════════════════════════════════════════════════════
section('Document lifecycle');

eq('6 statuses', DOCUMENT_STATUSES.length, 6);
eq('every status has a transition list', Object.keys(DOCUMENT_TRANSITIONS).length, 6);

for (const status of DOCUMENT_STATUSES) {
  for (const target of DOCUMENT_TRANSITIONS[status]) {
    check(`${status} → ${target}: target is a real status`, DOCUMENT_STATUSES.includes(target));
    check(`${status} → ${target}: is not a self-loop`, target !== status);
  }
  check(
    `${status}: no duplicate targets`,
    new Set(DOCUMENT_TRANSITIONS[status]).size === DOCUMENT_TRANSITIONS[status].length,
  );
}

// The path that must not exist: upload straight to verified.
check('nothing goes from submitted to verified', !canTransitionDoc('submitted', 'verified'));
check('review is the only door to verified', canTransitionDoc('underReview', 'verified'));
check('a needsMoreInfo document can be resubmitted', canTransitionDoc('needsMoreInfo', 'submitted'));
check('a rejected document can be corrected and resubmitted', canTransitionDoc('rejected', 'submitted'));
check('a verified document can lapse', canTransitionDoc('verified', 'expired'));
check('and can be reopened for re-verification', canTransitionDoc('verified', 'underReview'));
check('an expired document can re-enter review', canTransitionDoc('expired', 'underReview'));
check('a rejected document cannot be verified directly', !canTransitionDoc('rejected', 'verified'));
check('an expired document cannot be verified directly', !canTransitionDoc('expired', 'verified'));
check('a verified document cannot be rejected', !canTransitionDoc('verified', 'rejected'));
check('an unknown status transitions nowhere', !canTransitionDoc('nonsense', 'verified'));
check('and nothing transitions to an unknown status', !canTransitionDoc('submitted', 'nonsense'));

const reachableDocs = reachableStatuses('submitted');
for (const status of DOCUMENT_STATUSES) {
  check(`${status}: reachable from submitted`, reachableDocs.includes(status));
}

// Obligations
eq('submitted needs no audit entry — it is the creation', requirementsFor('submitted').audit, false);
for (const status of DOCUMENT_STATUSES.filter((s) => s !== 'submitted')) {
  eq(`${status}: requires an audit entry`, requirementsFor(status).audit, true);
}
eq('needsMoreInfo requires a reason', requirementsFor('needsMoreInfo').reason, true);
eq('rejected requires a reason', requirementsFor('rejected').reason, true);
eq('verified does not', requirementsFor('verified').reason, false);
eq('expired needs no reviewer — it is the clock’s doing', requirementsFor('expired').reviewer, false);
eq('verified is the only gated transition', DOCUMENT_STATUSES.filter((s) => requirementsFor(s).gated).join(','), 'verified');

// evaluateTransition: the status codes are part of the contract.
const illegal = evaluateTransition('submitted', 'verified');
eq('an illegal move is refused', illegal.ok, false);
eq('as a state conflict', illegal.failure, 'illegalTransition');
eq('with 409, because the request was well-formed', illegal.httpStatus, 409);

const noReason = evaluateTransition('underReview', 'rejected', { actorIsReviewer: true });
eq('a rejection with no reason is refused', noReason.ok, false);
eq('as an input problem', noReason.failure, 'reasonRequired');
eq('with 422, because the request was incomplete', noReason.httpStatus, 422);
check('a blank reason does not count', !evaluateTransition('underReview', 'rejected', { reason: '   ', actorIsReviewer: true }).ok);
check('a real reason does', evaluateTransition('underReview', 'rejected', { reason: 'illegible scan', actorIsReviewer: true }).ok);

const selfReview = evaluateTransition('submitted', 'underReview', { actorIsHolder: true, actorIsReviewer: true });
eq('nobody reviews their own submission', selfReview.ok, false);
eq('which is a permission failure', selfReview.failure, 'selfReviewForbidden');
eq('with 403', selfReview.httpStatus, 403);

const notReviewer = evaluateTransition('submitted', 'underReview', { actorIsReviewer: false });
eq('a non-reviewer cannot start a review', notReviewer.failure, 'reviewerRequired');

const gated = evaluateTransition('underReview', 'verified', { actorIsReviewer: true, gatesPassed: false });
eq('a failed gate refuses verification', gated.ok, false);
eq('as a state conflict, not an input one', gated.httpStatus, 409);
check('and passes when the gates pass', evaluateTransition('underReview', 'verified', { actorIsReviewer: true, gatesPassed: true }).ok);

eq('only verified locks a document', DOCUMENT_STATUSES.filter(isLockedDoc).join(','), 'verified');
check('a submitted document is reviewable', isReviewable('submitted'));
check('an under-review document is reviewable', isReviewable('underReview'));
check('a verified one is not', !isReviewable('verified'));
check('needsMoreInfo awaits the holder', awaitsHolder('needsMoreInfo'));
check('so does rejected', awaitsHolder('rejected'));

eq('a re-verify type re-enters review', reverificationTarget(true), 'underReview');
eq('everything else goes back to the holder', reverificationTarget(false), 'submitted');
for (const status of DOCUMENT_STATUSES) {
  check(`${status}: has an audit action name`, typeof ACTION_FOR_STATUS[status] === 'string');
}


// ═══════════════════════════════════════════════════════════════════════════
section('Document compliance');

// The matchers first — every rule is built on them, so a generous or a brittle
// one would quietly change ten verdicts at once.
check('identical names match', namesMatch('Kwame Mensah', 'Kwame Mensah'));
check('case and punctuation are noise', namesMatch('KWAME A. MENSAH', 'kwame a mensah'));
check('reordering is tolerated', namesMatch('Mensah, Kwame', 'Kwame Mensah'));
check('a middle name is tolerated', namesMatch('Kwame Mensah', 'Kwame Ato Mensah'));
check('a different surname is not a match', !namesMatch('Kwame Mensah', 'Kwame Osei'));
check('a different first name is not a match', !namesMatch('Kwame Mensah', 'Akosua Mensah'));
// The trap this guards: one shared token is not a person.
check('a single shared token is not a match', !namesMatch('Kwame', 'Kwame Osei'));
check('an empty name matches nothing', !namesMatch('', 'Kwame Mensah'));

check('identical addresses match', addressesMatch('12 Ring Road East, Accra', '12 Ring Road East, Accra'));
check('a formatting difference is tolerated', addressesMatch('12 Ring Road East, Accra', '12 ring road east accra'));
check('a different street is not', !addressesMatch('12 Ring Road East, Accra', '88 Oxford Street, Osu'));
check('an empty address matches nothing', !addressesMatch('', 'anywhere'));

eq('normalise strips punctuation and case', normalise('  Kwame A. MENSAH!! '), 'kwame a mensah');

// Every rule must be exercised, and must be able to fail as well as pass —
// a rule that only ever passes is a rule that is not checking anything.
const baseDoc = { type: 'identity' as const, fields: {} as Record<string, unknown>, owner: 'u1' };

const idPass = evaluateRule('identityMatchesProfile',
  { ...baseDoc, fields: { holderName: 'Kwame Mensah', dateOfBirth: past(1990, 4, 2) } },
  { profile: { fullName: 'Kwame Mensah', dateOfBirth: past(1990, 4, 2) } });
eq('a matching identity passes', idPass.outcome, 'passed');
const idFail = evaluateRule('identityMatchesProfile',
  { ...baseDoc, fields: { holderName: 'Akosua Osei' } },
  { profile: { fullName: 'Kwame Mensah' } });
eq('a different name fails', idFail.outcome, 'failed');
const idDob = evaluateRule('identityMatchesProfile',
  { ...baseDoc, fields: { holderName: 'Kwame Mensah', dateOfBirth: past(1991, 4, 2) } },
  { profile: { fullName: 'Kwame Mensah', dateOfBirth: past(1990, 4, 2) } });
eq('a different date of birth fails', idDob.outcome, 'failed');
const idNumber = evaluateRule('identityMatchesProfile',
  { ...baseDoc, fields: { holderName: 'Kwame Mensah', documentNumber: 'GHA-999' } },
  { profile: { fullName: 'Kwame Mensah', IDNumber: 'GHA-111' } });
eq('a different ID number fails', idNumber.outcome, 'failed');
// The important one: no context means skipped, never passed.
eq('no profile in context is skipped, not passed', evaluateRule('identityMatchesProfile', baseDoc, {}).outcome, 'skipped');

eq('a matching residency passes',
  evaluateRule('residencyMatchesProperty',
    { ...baseDoc, type: 'proofOfResidency', fields: { address: '12 Ring Road East, Accra' } },
    { property: { address: '12 Ring Road East Accra' } }).outcome, 'passed');
eq('a mismatched residency fails',
  evaluateRule('residencyMatchesProperty',
    { ...baseDoc, type: 'proofOfResidency', fields: { address: '88 Oxford Street, Osu' } },
    { property: { address: '12 Ring Road East, Accra' } }).outcome, 'failed');
eq('a residency proof with no address fails',
  evaluateRule('residencyMatchesProperty',
    { ...baseDoc, type: 'proofOfResidency', fields: {} },
    { property: { address: '12 Ring Road East' } }).outcome, 'failed');

eq('a host letter from the landlord passes',
  evaluateRule('hostConfirmationMatchesLandlord',
    { ...baseDoc, type: 'hostConfirmation', fields: { counterpartyName: 'Yaa Asantewaa' } },
    { landlord: { fullName: 'Yaa Asantewaa' } }).outcome, 'passed');
eq('one from somebody else fails',
  evaluateRule('hostConfirmationMatchesLandlord',
    { ...baseDoc, type: 'hostConfirmation', fields: { counterpartyName: 'Kofi Boateng' } },
    { landlord: { fullName: 'Yaa Asantewaa' } }).outcome, 'failed');

const leaseCtx = { lease: { id: 'L1', monthlyRent: 2500, leaseStart: past(2026, 1, 15) } };
eq('an agreement matching the lease passes',
  evaluateRule('rentalAgreementMatchesLease',
    { ...baseDoc, type: 'rentalAgreement', subject: 'L1', fields: { amount: 2500, periodStart: past(2026, 1, 15) } },
    leaseCtx).outcome, 'passed');
eq('one attached to a different lease fails',
  evaluateRule('rentalAgreementMatchesLease',
    { ...baseDoc, type: 'rentalAgreement', subject: 'L2', fields: { amount: 2500 } },
    leaseCtx).outcome, 'failed');
eq('one stating a different rent fails',
  evaluateRule('rentalAgreementMatchesLease',
    { ...baseDoc, type: 'rentalAgreement', subject: 'L1', fields: { amount: 3000 } },
    leaseCtx).outcome, 'failed');
eq('a pesewa of rounding is not a discrepancy',
  evaluateRule('rentalAgreementMatchesLease',
    { ...baseDoc, type: 'rentalAgreement', subject: 'L1', fields: { amount: 2500.004 } },
    leaseCtx).outcome, 'passed');
eq('a different start date fails',
  evaluateRule('rentalAgreementMatchesLease',
    { ...baseDoc, type: 'rentalAgreement', subject: 'L1', fields: { amount: 2500, periodStart: past(2026, 2, 1) } },
    leaseCtx).outcome, 'failed');

eq('an intake matching the profile passes',
  evaluateRule('tenantIntakeMatchesProfile',
    { ...baseDoc, type: 'tenantIntake', fields: { holderName: 'Ama Owusu' } },
    { profile: { fullName: 'Ama Owusu' } }).outcome, 'passed');

eq('ownership by the client passes',
  evaluateRule('propertyOwnershipMatchesClient',
    { ...baseDoc, type: 'propertyOwnership', subjectKind: 'Property', subject: 'P1', fields: { holderName: 'Accra Hospitality Group' } },
    { commercialClient: { clientName: 'Accra Hospitality Group', linkedProperties: ['P1'] } }).outcome, 'passed');
eq('a property outside the portfolio fails',
  evaluateRule('propertyOwnershipMatchesClient',
    { ...baseDoc, type: 'propertyOwnership', subjectKind: 'Property', subject: 'P9', fields: { holderName: 'Accra Hospitality Group' } },
    { commercialClient: { clientName: 'Accra Hospitality Group', linkedProperties: ['P1'] } }).outcome, 'failed');

eq('a letter from the employer of record passes',
  evaluateRule('employmentMatchesEmployer',
    { ...baseDoc, type: 'employmentVerification', fields: { employerName: 'Ghana Commercial Bank' } },
    { employer: { name: 'Ghana Commercial Bank', verified: true } }).outcome, 'passed');
eq('an unverified employer fails',
  evaluateRule('employmentMatchesEmployer',
    { ...baseDoc, type: 'employmentVerification', fields: { employerName: 'Ghana Commercial Bank' } },
    { employer: { name: 'Ghana Commercial Bank', verified: false } }).outcome, 'failed');

eq('a certificate naming the household spouse passes',
  evaluateRule('maritalStatusMatchesHousehold',
    { ...baseDoc, type: 'maritalStatus', fields: { counterpartyName: 'Efua Mensah' } },
    { household: { spouseName: 'Efua Mensah' } }).outcome, 'passed');
eq('one naming somebody else fails',
  evaluateRule('maritalStatusMatchesHousehold',
    { ...baseDoc, type: 'maritalStatus', fields: { counterpartyName: 'Adjoa Sarpong' } },
    { household: { spouseName: 'Efua Mensah' } }).outcome, 'failed');

const depCtx = { dependent: { name: 'Ama Mensah', dateOfBirth: past(2018, 4, 2), relationship: 'child' } };
eq('a birth record matching the dependent passes',
  evaluateRule('birthRecordMatchesDependent',
    { ...baseDoc, type: 'birthRecord', fields: { holderName: 'Ama Mensah', dateOfBirth: past(2018, 4, 2), relationship: 'child' } },
    depCtx).outcome, 'passed');
eq('a different relationship fails',
  evaluateRule('birthRecordMatchesDependent',
    { ...baseDoc, type: 'birthRecord', fields: { holderName: 'Ama Mensah', dateOfBirth: past(2018, 4, 2), relationship: 'sibling' } },
    depCtx).outcome, 'failed');

// The one rule whose verdict depends on which side of Ususu the person is on.
eq('a clear check passes for a driver',
  evaluateRule('criminalBackgroundMatchesEligibility',
    { ...baseDoc, type: 'criminalBackground', fields: { outcome: 'clear' } },
    { eligibility: { role: 'driver' } }).outcome, 'passed');
eq('an adverse check disqualifies a driver',
  evaluateRule('criminalBackgroundMatchesEligibility',
    { ...baseDoc, type: 'criminalBackground', fields: { outcome: 'adverse' } },
    { eligibility: { role: 'driver' } }).outcome, 'failed');
eq('but not a rider, who carries nobody',
  evaluateRule('criminalBackgroundMatchesEligibility',
    { ...baseDoc, type: 'criminalBackground', fields: { outcome: 'adverse' } },
    { eligibility: { role: 'rider' } }).outcome, 'passed');
eq('a pending check is not a pass',
  evaluateRule('criminalBackgroundMatchesEligibility',
    { ...baseDoc, type: 'criminalBackground', fields: { outcome: 'pending' } },
    { eligibility: { role: 'driver' } }).outcome, 'failed');
eq('a suspended account cannot establish eligibility',
  evaluateRule('criminalBackgroundMatchesEligibility',
    { ...baseDoc, type: 'criminalBackground', fields: { outcome: 'clear' } },
    { eligibility: { role: 'driver', suspended: true } }).outcome, 'failed');

// Severity: blocking failures refuse verification, advisory ones do not.
for (const rule of COMPLIANCE_RULES) {
  check(`${rule}: declares a severity`, ['blocking', 'advisory'].includes(RULE_SEVERITY[rule]));
}
check('identity is blocking', RULE_SEVERITY.identityMatchesProfile === 'blocking');
check('a criminal record check is blocking', RULE_SEVERITY.criminalBackgroundMatchesEligibility === 'blocking');
check('an employment letter is advisory', RULE_SEVERITY.employmentMatchesEmployer === 'advisory');

const blockingReport = complianceReport(
  { type: 'identity', fields: { holderName: 'Akosua Osei' }, owner: 'u1' },
  { profile: { fullName: 'Kwame Mensah' } });
eq('a blocking failure is not clear', blockingReport.clear, false);
eq('and is listed', blockingReport.blocking.length, 1);
eq('with a score of zero when nothing passed', blockingReport.score, 0);

const advisoryReport = complianceReport(
  { type: 'employmentVerification', fields: { employerName: 'Somewhere Else' }, owner: 'u1' },
  { employer: { name: 'Ghana Commercial Bank', verified: true } });
eq('an advisory failure still leaves the report clear', advisoryReport.clear, true);
eq('though it is counted as failed', advisoryReport.failed, 1);

const skippedReport = complianceReport({ type: 'identity', fields: {}, owner: 'u1' }, {});
eq('a skipped check is clear', skippedReport.clear, true);
eq('but is not counted as a pass', skippedReport.passed, 0);
eq('and scores 100 only because nothing was decided', skippedReport.score, 100);

const noRule = complianceReport({ type: 'roadworthiness', fields: {}, owner: 'u1' }, {});
eq('a type with no rule has no checks', noRule.checks.length, 0);
eq('its rule is null, not fabricated', noRule.rule, null);
eq('and it is clear', noRule.clear, true);

// ═══════════════════════════════════════════════════════════════════════════
section('Document expiry');

const asOfExp = new Date(Date.UTC(2026, 5, 15, 14, 0));
const inDays = (n: number): Date => new Date(Date.UTC(2026, 5, 15 + n, 3, 0));

// Whole calendar days, not elapsed hours: two documents expiring tonight at
// 01:00 and 23:00 both expire today.
eq('days are counted by calendar date', daysBetween(asOfExp, inDays(3)), 3);
eq('the same day is zero however the clocks differ', daysBetween(asOfExp, inDays(0)), 0);
eq('and yesterday is negative one', daysBetween(asOfExp, inDays(-1)), -1);

const clockFor = (n: number) => expiryInfoFor('taxClearance', { expiresOn: inDays(n) }, asOfExp);
eq('a document a year out is valid', clockFor(200).state, 'valid');
eq('one inside the notice window is expiring soon', clockFor(45).state, 'expiringSoon');
eq('one due today says so', clockFor(0).state, 'expiresToday');
eq('and one past its date is expired', clockFor(-1).state, 'expired');
eq('which is also flagged', clockFor(-1).expired, true);
eq('a non-expiring type has no clock', expiryInfoFor('birthRecord', {}, asOfExp).state, 'noExpiry');
eq('and no escalation', expiryInfoFor('birthRecord', {}, asOfExp).escalation, 'none');

// Notice rungs fire on the exact day, not continuously.
for (const rung of EXPIRY_NOTICE_DAYS) {
  eq(`a notice is due exactly ${rung} days out`, noticeDueAt(rung), rung);
}
eq('no notice is due 45 days out', noticeDueAt(45), null);
eq('nor 2 days out', noticeDueAt(2), null);
eq('a non-expiring document is never noticed', noticeDueAt(null), null);
eq('the widest rung defines "expiring soon"', EXPIRING_SOON_DAYS, 90);

// Escalation only begins after the date. Before it, this is the holder's job.
eq('nothing escalates 45 days out', escalationForExpiry(45, false), 'none');
eq('a notice rung reaches the holder', escalationForExpiry(30, false), 'notifyHolder');
eq('the day after expiry reaches a coordinator', escalationForExpiry(-1, false), 'notifyCoordinator');
eq('a week later, Back Office', escalationForExpiry(-8, false), 'notifyBackOffice');
eq('a month later a restricted document suspends the privilege', escalationForExpiry(-31, true), 'suspendPrivilege');
eq('but an unrestricted one stops at Back Office', escalationForExpiry(-31, false), 'notifyBackOffice');
eq('a non-expiring document never escalates', escalationForExpiry(null, true), 'none');

// The sweep: only a verified document has anything left to lapse.
const lapsedVerified = sweepVerdict('taxClearance', { expiresOn: inDays(-1) }, 'verified', asOfExp);
eq('a lapsed verified document is expired by the sweep', lapsedVerified.expire, true);
eq('for the right reason', lapsedVerified.reason, 'lapsed');
const lapsedAlready = sweepVerdict('taxClearance', { expiresOn: inDays(-10) }, 'expired', asOfExp);
eq('an already-expired one is not expired twice', lapsedAlready.expire, false);
eq('though it is still reported', lapsedAlready.reason, 'stillLapsed');
eq('and it escalates', lapsedAlready.escalate, true);
const lapsedRejected = sweepVerdict('taxClearance', { expiresOn: inDays(-1) }, 'rejected', asOfExp);
eq('a rejected document has nothing left to lapse', lapsedRejected.expire, false);

const rung = sweepVerdict('taxClearance', { expiresOn: inDays(30) }, 'verified', asOfExp);
eq('a notice rung notifies without expiring', rung.notify, true);
eq('and does not escalate', rung.escalate, false);
const quietDay = sweepVerdict('taxClearance', { expiresOn: inDays(45) }, 'verified', asOfExp);
eq('an ordinary day does nothing', quietDay.notify, false);
eq('a never-expiring document is left alone entirely', sweepVerdict('birthRecord', {}, 'verified', asOfExp).reason, 'none');

check('the description reads naturally when expired', describeExpiry(clockFor(-3)).includes('3 days ago'));
check('and when due today', describeExpiry(clockFor(0)) === 'expires today');
check('and singular days are singular', describeExpiry(clockFor(1)).endsWith('1 day'));


// ═══════════════════════════════════════════════════════════════════════════
section('Document audit trail');

const t0 = new Date(Date.UTC(2026, 5, 1, 9, 0));
const at = (mins: number): Date => new Date(t0.getTime() + mins * 60_000);

eq('a well-formed entry validates', validateEntry({ at: t0, actor: 'u1', action: 'review' }), null);
check('an entry with no actor is refused', validateEntry({ at: t0, action: 'review' }) !== null);
check('an entry with no action is refused', validateEntry({ at: t0, actor: 'u1' }) !== null);
check('an unknown action is refused', validateEntry({ at: t0, actor: 'u1', action: 'shred' as never }) !== null);
check('an invalid date is refused', validateEntry({ at: new Date('nope'), actor: 'u1', action: 'review' }) !== null);
check('a zero sequence is refused', validateEntry({ at: t0, actor: 'u1', action: 'review', sequence: 0 }) !== null);

// Reason-bearing actions are exactly the ones a person will later dispute.
check('a rejection needs a reason', requiresReasonAudit('reject'));
check('a request for more info needs a reason', requiresReasonAudit('requestInfo'));
check('archiving needs a reason', requiresReasonAudit('archive'));
check('a verification does not', !requiresReasonAudit('verify'));
check('and neither does a review', !requiresReasonAudit('review'));
check('a rejection with no reason is refused', validateEntry({ at: t0, actor: 'u1', action: 'reject' }) !== null);
eq('a rejection with one is accepted', validateEntry({ at: t0, actor: 'u1', action: 'reject', reason: 'illegible' }), null);
check('a blank reason does not count', validateEntry({ at: t0, actor: 'u1', action: 'reject', reason: '  ' }) !== null);

// Sequencing is assigned by the module, never by the caller.
let trail = appendAudit([], { at: t0, actor: 'u1', action: 'create' });
eq('the first entry is sequence 1', trail[0]!.sequence, 1);
trail = appendAudit(trail, { at: at(5), actor: 'u2', action: 'review' });
trail = appendAudit(trail, { at: at(20), actor: 'u2', action: 'verify' });
eq('sequences are contiguous', trail.map((e) => e.sequence).join(','), '1,2,3');
eq('and the trail grows', trail.length, 3);
check('appending returns a new array, leaving the old one alone', appendAudit(trail, { at: at(30), actor: 'u2', action: 'expire' }).length === 4 && trail.length === 3);

// A clock that steps backwards must not make a rejection precede its review.
const skewed = appendAudit(trail, { at: at(-60), actor: 'u2', action: 'reject', reason: 'clock skew' });
check('a backwards timestamp is pulled forward, never stored as-is', skewed[3]!.at.getTime() >= trail[2]!.at.getTime());

let threw = false;
try {
  appendAudit(trail, { at: at(30), actor: 'u2', action: 'reject' });
} catch (err) {
  threw = err instanceof AuditError;
}
eq('appending an invalid entry throws rather than writing it', threw, true);

// Integrity: the three things a tampered trail gets wrong.
eq('a well-formed trail is intact', auditTrailIsIntact(trail).intact, true);
const gapped = [trail[0]!, { ...trail[2]!, sequence: 3 }];
eq('a removed entry shows as a gap', auditTrailIsIntact(gapped).intact, false);
eq('and is named', auditTrailIsIntact(gapped).failures[0]!.failure, 'sequenceGap');
const repeated = [trail[0]!, { ...trail[1]!, sequence: 1 }];
eq('a duplicated sequence shows as a repeat', auditTrailIsIntact(repeated).failures[0]!.failure, 'sequenceRepeat');
const backwardsTrail = [trail[0]!, { ...trail[1]!, at: at(-10) }];
check('a backwards timestamp is caught', auditTrailIsIntact(backwardsTrail).failures.some((f) => f.failure === 'timeWentBackwards'));

// The append-only guarantee — the reason this module exists.
const appended = appendAudit(trail, { at: at(40), actor: 'u3', action: 'expire' });
eq('a pure append is allowed', assertAppendOnly(trail, appended).ok, true);
eq('removing an entry is not', assertAppendOnly(trail, trail.slice(0, 2)).ok, false);
eq('editing a reason is not', assertAppendOnly(trail, [trail[0]!, { ...trail[1]!, reason: 'rewritten' }, trail[2]!]).ok, false);
eq('changing an actor is not', assertAppendOnly(trail, [trail[0]!, { ...trail[1]!, actor: 'someone-else' }, trail[2]!]).ok, false);
eq('changing an action is not', assertAppendOnly(trail, [trail[0]!, { ...trail[1]!, action: 'verify' }, trail[2]!]).ok, false);
eq('changing a timestamp is not', assertAppendOnly(trail, [trail[0]!, { ...trail[1]!, at: at(6) }, trail[2]!]).ok, false);
eq('reordering is not', assertAppendOnly(trail, [trail[1]!, trail[0]!, trail[2]!]).ok, false);
check('and the refusal says which entry moved', assertAppendOnly(trail, trail.slice(0, 2)).reason!.length > 0);

// Every lifecycle target must produce a legal audit entry.
for (const status of DOCUMENT_STATUSES) {
  const entry = entryForTransition({ from: 'submitted', to: status, actor: 'u1', at: t0, reason: 'because' });
  eq(`${status}: the entry names the right action`, entry.action, ACTION_FOR_STATUS[status]);
  eq(`${status}: the entry is valid`, validateEntry(entry), null);
}

eq('the last verification is findable', lastActionBy(trail, 'verify')?.sequence, 3);
eq('and an action never taken returns null', lastActionBy(trail, 'reject'), null);
const summary = auditSummary(trail);
eq('the summary counts every entry', summary.total, 3);
eq('grouped by action', summary.byAction.review, 1);
eq('naming every actor once', summary.actors.length, 2);
eq('with the first timestamp', summary.firstAt?.getTime(), t0.getTime());

// ═══════════════════════════════════════════════════════════════════════════
section('Document scoring');

eq('the weights sum to 1', Math.round(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0) * 1000) / 1000, 1);
eq('four dimensions', SCORE_DIMENSIONS.length, 4);

const fullIdentity = {
  holderName: 'Kwame Mensah',
  documentNumber: 'GHA-123456789-0',
  issuingAuthority: 'National Identification Authority',
  issuedOn: past(2022, 3, 1),
  expiresOn: past(2032, 3, 1),
};

eq('a document missing everything scores zero for completeness', completenessScore('identity', {}), 0);
// The 0.8 factor exists so an incomplete document can never reach the band
// where optional fields start counting. Four of five required fields must still
// land clearly below the ceiling, not just below 100.
eq('one required field of five scores 16, not 20', completenessScore('identity', { holderName: 'Kwame Mensah' }), 16);
eq('four of five scores 64, not 80', completenessScore('identity', {
  holderName: 'Kwame Mensah',
  documentNumber: 'GHA-123456789-0',
  issuingAuthority: 'NIA',
  issuedOn: past(2022, 3, 1),
}), 64);
check('so a document missing one field never reaches the optional band',
  completenessScore('identity', {
    holderName: 'Kwame Mensah',
    documentNumber: 'GHA-123456789-0',
    issuingAuthority: 'NIA',
    issuedOn: past(2022, 3, 1),
  }) < 80);
eq('all required fields reaches the required ceiling', completenessScore('identity', fullIdentity), 80);
eq('optional fields lift it the rest of the way',
  completenessScore('identity', { ...fullIdentity, dateOfBirth: past(1990, 1, 1), nationality: 'Ghanaian' }), 100);
// The trap: padding with optional fields must not beat answering the mandatory ones.
check('optional padding cannot outscore a complete required set',
  completenessScore('identity', { holderName: 'K Mensah', dateOfBirth: past(1990, 1, 1), nationality: 'Ghanaian' }) <
  completenessScore('identity', fullIdentity));

// Clarity is the one dimension that degrades to neutral, because the OCR that
// feeds it is stubbed — scoring an unmeasured document as illegible would block
// every upload until extraction exists.
eq('with no signals, clarity is neutral', clarityScore(), CLARITY_NEUTRAL);
eq('a confident OCR scores high', clarityScore({ ocrConfidence: 0.95 }), 95);
eq('a poor one scores low', clarityScore({ ocrConfidence: 0.2 }), 20);
check('a tiny file scores badly', clarityScore({ fileSize: 2000 }) < 20);
check('a full-size scan scores full', clarityScore({ fileSize: 5_000_000 }) === 100);
check('an unexpected mime type is penalised', clarityScore({ mimeType: 'text/plain' }) === 40);
check('a PDF is not', clarityScore({ mimeType: 'application/pdf' }) === 100);

eq('an empty document is inconsistent by definition', consistencyScore('identity', {}, NOW_DOC), 0);
check('a clean document scores high', consistencyScore('identity', fullIdentity, NOW_DOC) > 80);
check('an expiry before issue costs more than a blank field',
  consistencyScore('identity', { ...fullIdentity, expiresOn: past(2021, 1, 1) }, NOW_DOC) <
  consistencyScore('identity', fullIdentity, NOW_DOC));
check('a malformed number is penalised',
  consistencyScore('identity', { ...fullIdentity, documentNumber: 'A' }, NOW_DOC) <
  consistencyScore('identity', fullIdentity, NOW_DOC));

// Cross-document: agreement with *verified* siblings only. Two unverified
// uploads must not be able to vouch for each other.
eq('with no siblings, cross-document is neutral', crossDocumentScore(fullIdentity, []), CROSS_NEUTRAL);
// The trap: two unverified uploads must not be able to vouch for each other.
// A *disagreeing* unverified sibling is the discriminating case — if it were
// consulted, this would score 0 rather than staying neutral.
eq('a disagreeing unverified sibling is not evidence against',
  crossDocumentScore(fullIdentity, [{ type: 'incomeProof', status: 'submitted', fields: { holderName: 'Someone Else' } }]),
  CROSS_NEUTRAL);
eq('and an agreeing unverified sibling is not evidence for',
  crossDocumentScore(fullIdentity, [{ type: 'incomeProof', status: 'submitted', fields: { holderName: 'Kwame Mensah' } }]),
  CROSS_NEUTRAL);
eq('a rejected sibling counts for nothing either',
  crossDocumentScore(fullIdentity, [{ type: 'incomeProof', status: 'rejected', fields: { holderName: 'Kwame Mensah' } }]),
  CROSS_NEUTRAL);
eq('an agreeing verified sibling scores full',
  crossDocumentScore(fullIdentity, [{ type: 'incomeProof', status: 'verified', fields: { holderName: 'Kwame Mensah' } }]),
  100);
eq('a disagreeing one scores zero',
  crossDocumentScore(fullIdentity, [{ type: 'incomeProof', status: 'verified', fields: { holderName: 'Akosua Osei' } }]),
  0);

eq('poor is below 50', scoreBand(30), 'poor');
eq('fair is below 70', scoreBand(65), 'fair');
eq('good is below 85', scoreBand(80), 'good');
eq('excellent is 85 and up', scoreBand(90), 'excellent');

const strong = scoreDocument({ type: 'identity', fields: { ...fullIdentity, dateOfBirth: past(1990, 1, 1), nationality: 'Ghanaian' }, asOf: NOW_DOC, clarity: { ocrConfidence: 0.95, mimeType: 'application/pdf' } });
check('a complete, legible document clears the floor', strong.meetsVerificationFloor);
check('and scores well', strong.overall >= 85);
eq('and its band matches its score', strong.band, scoreBand(strong.overall));

const weak = scoreDocument({ type: 'identity', fields: { holderName: 'K' }, asOf: NOW_DOC, clarity: { ocrConfidence: 0.1 } });
eq('a near-empty document does not clear the floor', weak.meetsVerificationFloor, false);
check('and its overall is below the floor', weak.overall < MIN_SCORE_TO_VERIFY);
check('the weakest dimension is named so a reviewer knows what to ask for',
  (SCORE_DIMENSIONS as readonly string[]).includes(weak.weakest));

// The composite must actually be the weighted sum — a score that drifted from
// its own weights would be unexplainable to the person it refused.
const recomputed =
  strong.completeness * SCORE_WEIGHTS.completeness +
  strong.clarity * SCORE_WEIGHTS.clarity +
  strong.consistency * SCORE_WEIGHTS.consistency +
  strong.crossDocument * SCORE_WEIGHTS.crossDocument;
near('the overall is the weighted sum of its parts', strong.overall, recomputed, 0.11);

for (const d of [strong, weak]) {
  for (const dim of SCORE_DIMENSIONS) {
    check(`${dim} stays within 0..100`, d[dim] >= 0 && d[dim] <= 100);
  }
  check('and so does the overall', d.overall >= 0 && d.overall <= 100);
}


// ═══════════════════════════════════════════════════════════════════════════
section('FAC: code format & strength');

eq('a six-digit code is well formed', isWellFormedCode('418293'), true);
check('five digits is not', !isWellFormedCode('41829'));
check('seven is not', !isWellFormedCode('4182930'));
check('letters are not', !isWellFormedCode('41829a'));
check('a space is not', !isWellFormedCode('41829 '));

// The handful a human would pick are the handful an attacker tries first.
// Each case names the *specific* rule that must catch it — asserting only that
// the code is refused would pass even with that rule deleted, because several
// of these trip more than one.
const weaknessCases: [string, string][] = [
  ['000000', 'allSameDigit'],
  ['777777', 'allSameDigit'],
  ['123456', 'sequentialAscending'],
  ['456789', 'sequentialAscending'],
  ['987654', 'sequentialDescending'],
  ['121212', 'repeatedPair'],
  ['418814', 'palindrome'],
  ['199412', 'looksLikeYear'],
  ['471985', 'looksLikeYear'],
  ['150385', 'looksLikeDate'],
];
for (const [code, rule] of weaknessCases) {
  check(`${code} is caught by ${rule}`, codeWeaknesses(code).includes(rule as never));
  check(`${code} is therefore refused`, !isAcceptableCode(code));
}
// And every rule must be reachable — a rule no case exercises is a rule that
// could be deleted without any test noticing.
for (const rule of ['allSameDigit', 'sequentialAscending', 'sequentialDescending',
  'repeatedPair', 'palindrome', 'looksLikeYear', 'looksLikeDate']) {
  check(`weakness rule ${rule} is exercised by a case`,
    weaknessCases.some(([code]) => codeWeaknesses(code).includes(rule as never)));
}
check('an unremarkable code is accepted', isAcceptableCode('418293'));
eq('a malformed code reports exactly that', codeWeaknesses('12ab56')[0], 'malformed');
check('a code can trip more than one rule at once', codeWeaknesses('000000').length >= 2);

// Generation must never emit something the acceptance rule would reject.
// A seeded source proves it deterministically rather than by luck.
const seeded = seededRandom('fac-generation-2026-07-28');
for (let i = 0; i < 300; i += 1) {
  const generated = generateCode(seeded);
  check(`generated code ${i} is well formed`, isWellFormedCode(generated));
  check(`generated code ${i} is acceptable`, isAcceptableCode(generated));
}
let genThrew = false;
try {
  // A source that only ever yields 0 produces 000000, which is unacceptable —
  // the generator must give up rather than loop or return it.
  generateCode(() => 0, 5);
} catch {
  genThrew = true;
}
eq('a degenerate random source is refused, not accepted', genThrew, true);

// Honest entropy. The point of stating it is that relaxing the attempt limit
// fails this rather than quietly weakening the platform.
near('six digits is ~19.93 bits', codeEntropyBits(), 19.93, 0.01);
check('which is weak on its own', codeEntropyBits() < 24);
check('but 3 attempts per 24h buys centuries', expectedBruteForceYears() > 400);
check('and doubling the attempt limit visibly halves that', expectedBruteForceYears(6) < expectedBruteForceYears(3));
check('as does shortening the lockout', expectedBruteForceYears(3, 1) < expectedBruteForceYears(3, 24));

eq('the policy is 6 digits', FAC_CODE_LENGTH, 6);
eq('rotating every 90 days', FAC_ROTATION_DAYS, 90);
eq('with 3 attempts', FAC_MAX_ATTEMPTS, 3);
eq('and a 24-hour lockout', FAC_LOCKOUT_HOURS, 24);

// ═══════════════════════════════════════════════════════════════════════════
section('FAC: rotation clock');

const issued = new Date(Date.UTC(2026, 4, 20));
const day2 = (n: number): Date => new Date(Date.UTC(2026, 4, 20 + n, 11, 0));

eq('rotation is 90 days out', nextRotationDate(issued).toISOString().slice(0, 10), '2026-08-18');
eq('a fresh code is active', codeClock(issued, day2(1)).health, 'active');
eq('inside the warning window it is expiringSoon', codeClock(issued, day2(85)).health, 'expiringSoon');
eq('past 90 days it is expired', codeClock(issued, day2(91)).health, 'expired');
eq('and flagged', codeClock(issued, day2(91)).expired, true);
eq('the warning window is 7 days', FAC_EXPIRY_WARNING_DAYS, 7);
check('a rotation is due inside the window', codeClock(issued, day2(85)).rotationDue);
check('and not before it', !codeClock(issued, day2(40)).rotationDue);
check('the description reads naturally', describeClock(codeClock(issued, day2(89))).includes('1 day'));
check('and when expired', describeClock(codeClock(issued, day2(93))).includes('ago'));

// An immediate trigger invalidates what is already open; a scheduled one does not.
check('a compromise rotates immediately', isImmediate('compromise'));
check('so does a role change', isImmediate('roleChange'));
check('a scheduled rotation does not', !isImmediate('scheduled'));
check('nor a manual one', !isImmediate('manual'));

// ═══════════════════════════════════════════════════════════════════════════
section('FAC: attempts & lockout');

const t = (mins: number): Date => new Date(Date.UTC(2026, 6, 1, 9, 0) + mins * 60_000);
const fail = (actor: string, mins: number): AttemptRecord => ({ actor, at: t(mins), result: 'fail' });
const pass = (actor: string, mins: number): AttemptRecord => ({ actor, at: t(mins), result: 'pass' });
const blocked = (actor: string, mins: number): AttemptRecord => ({ actor, at: t(mins), result: 'blocked' });

eq('a clean slate has three attempts', attemptVerdict([], 'u1', t(0)).attemptsRemaining, 3);
eq('and would be attempt 1', attemptVerdict([], 'u1', t(0)).attemptNumber, 1);
eq('one failure leaves two', attemptVerdict([fail('u1', 1)], 'u1', t(2)).attemptsRemaining, 2);
eq('two leave one', attemptVerdict([fail('u1', 1), fail('u1', 2)], 'u1', t(3)).attemptsRemaining, 1);

const lockedOut = attemptVerdict([fail('u1', 1), fail('u1', 2), fail('u1', 3)], 'u1', t(4));
eq('three failures lock the actor out', lockedOut.allowed, false);
eq('for that reason', lockedOut.refusal, 'lockedOut');
eq('with nothing left', lockedOut.attemptsRemaining, 0);
check('and a countdown the console can render', lockedOut.lockoutSecondsRemaining > 0);
near('which is about 24 hours', lockedOut.lockoutSecondsRemaining / 3600, 24, 0.1);

// The lockout is per actor. Three failures by one attacker must not shut every
// founder out of Zone A — that would be a denial of service dressed as a control.
const otherActor = attemptVerdict([fail('u1', 1), fail('u1', 2), fail('u1', 3)], 'u2', t(4));
eq('another actor is unaffected', otherActor.allowed, true);
eq('with a full allowance', otherActor.attemptsRemaining, 3);

// Only knowing the code clears the counter.
const afterSuccess = attemptVerdict([fail('u1', 1), fail('u1', 2), pass('u1', 3), fail('u1', 4)], 'u1', t(5));
eq('a success resets the streak', afterSuccess.attemptsRemaining, 2);
eq('and the count restarts from the success', consecutiveFailures([fail('u1', 1), fail('u1', 2), pass('u1', 3)], 'u1'), 0);

// Blocked rows record persistence without extending the punishment — otherwise a
// retrying client would make the lockout permanent.
const withBlocks = attemptVerdict(
  [fail('u1', 1), fail('u1', 2), fail('u1', 3), blocked('u1', 10), blocked('u1', 20)],
  'u1', t(30));
eq('blocked attempts do not extend the lockout', Math.round(withBlocks.lockoutSecondsRemaining / 60), 24 * 60 - 27);
eq('and are not counted as failures', consecutiveFailures([fail('u1', 1), blocked('u1', 2)], 'u1'), 1);

// Once it lapses, the actor starts clean.
const lapsed = attemptVerdict([fail('u1', 1), fail('u1', 2), fail('u1', 3)], 'u1', t(60 * 25));
eq('a lapsed lockout lets the actor try again', lapsed.allowed, true);
eq('with the full allowance restored', lapsed.attemptsRemaining, 3);
eq('and the counter reset', lapsed.attemptsUsed, 0);

eq('no code in force refuses the attempt', attemptVerdict([], 'u1', t(0), { hasActiveCode: false }).refusal, 'noActiveCode');
check('the third attempt is the one that locks', failureTriggersLockout(attemptVerdict([fail('u1', 1), fail('u1', 2)], 'u1', t(3))));
check('the second is not', !failureTriggersLockout(attemptVerdict([fail('u1', 1)], 'u1', t(2))));

const attemptRoll = summariseAttempts([fail('u1', 1), pass('u2', 2), blocked('u1', 3)]);
eq('the ledger summary counts every row', attemptRoll.total, 3);
eq('by result', attemptRoll.failed, 1);
eq('and distinct actors', attemptRoll.actors, 2);

// ═══════════════════════════════════════════════════════════════════════════
section('FAC: clearance');

const granted = grantClearance(t(0));
eq('a clearance is granted live', granted.active, true);
eq('for 30 minutes', FAC_CLEARANCE_MINUTES, 30);
eq('which is what it reports', granted.secondsRemaining, 30 * 60);

// The reason this is a function of `asOf`: a clearance stored as `true` and
// never re-evaluated is a clearance that never expires.
eq('it is still live at 29 minutes', clearanceState(t(0), t(29)).active, true);
eq('and lapsed at 31', clearanceState(t(0), t(31)).active, false);
eq('with nothing remaining', clearanceState(t(0), t(31)).secondsRemaining, 0);
eq('no grant means no clearance', clearanceState(null, t(0)).active, false);
eq('and it is not even claimed as granted', clearanceState(null, t(0)).granted, false);

// ═══════════════════════════════════════════════════════════════════════════
section('Governance tiers & visibility');

eq('four tiers', GOVERNANCE_TIERS.length, 4);
eq('every tier has a definition', Object.keys(TIER_DEFINITIONS).length, 4);

// Every role must land in exactly one tier — a role in none would be invisible
// to the console, and one in two would render twice.
for (const role of ROLES) {
  const landed = TIER_ORDER.filter((tier) => (TIER_DEFINITIONS[tier].roles as string[]).includes(role));
  eq(`${role}: sits in exactly one tier`, landed.length, 1);
}
eq('and the tiers together account for all 15 roles',
  TIER_ORDER.reduce((n, t2) => n + TIER_DEFINITIONS[t2].roles.length, 0), ROLES.length);

eq('the founder is Tier 1', tierFor('founder'), 'founders');
eq('the HQ executive is Tier 2', tierFor('hqExecutive'), 'hq');
eq('back office is Tier 3', tierFor('backOfficeStaff'), 'staff');
eq('a coordinator is Tier 3', tierFor('coordinator'), 'staff');
eq('a tenant is Tier 4', tierFor('tenant'), 'membership');
eq('and so is a driver', tierFor('driver'), 'membership');
eq('the most privileged held role wins', tierOf(['tenant', 'founder']), 'founders');
eq('and order does not matter', tierOf(['founder', 'tenant']), 'founders');

// The visibility ladder: nobody sees above themselves.
for (const viewer of TIER_ORDER) {
  for (const target of TIER_ORDER) {
    const higher = TIER_DEFINITIONS[target].ordinal < TIER_DEFINITIONS[viewer].ordinal;
    if (higher) {
      check(`${viewer} cannot see ${target}`, !canSeeTier(viewer, target));
    } else {
      check(`${viewer} can see ${target}`, canSeeTier(viewer, target));
    }
  }
}

// The matrix, row by row — this is the wireframe's table, asserted.
eq('only the founder tier is seal-eligible',
  TIER_ORDER.filter((t2) => TIER_DEFINITIONS[t2].sealEligible).join(','), 'founders');
eq('founders and HQ need the code',
  TIER_ORDER.filter((t2) => TIER_DEFINITIONS[t2].facRequired).join(','), 'founders,hq');
eq('admin access descends with the tier',
  TIER_ORDER.map((t2) => TIER_DEFINITIONS[t2].adminAccess).join(','), 'full,partial,limited,none');

// The rule the whole module exists for: role is not enough.
const founderNoClearance = visibilityFor('founder', false);
eq('a founder is seal-eligible', founderNoClearance.sealEligible, true);
eq('but without a live clearance the seal is not visible', founderNoClearance.sealVisible, false);
eq('with one, it is', visibilityFor('founder', true).sealVisible, true);
eq('an HQ executive is never seal-eligible', visibilityFor('hqExecutive', true).sealEligible, false);
eq('so a clearance does not reveal it', visibilityFor('hqExecutive', true).sealVisible, false);
eq('and neither does a tenant clearance', visibilityFor('tenant', true).sealVisible, false);
eq('an unknown role falls back to membership', visibilityFor('nobody').tier, 'membership');
eq('with no admin access', visibilityFor('nobody').adminAccess, 'none');

eq('the matrix has one row per tier', visibilityMatrix().length, 4);
check('every row names its roles', visibilityMatrix().every((r) => r.roles.length > 0));

// Zones are derived from the RBAC rather than restated, so the overview cannot
// claim access the role matrix does not actually grant.
const overview = tierOverview({ founders: 3, hq: 7, staff: 18, membership: 219 });
eq('the overview carries headcounts', overview[0]!.headcount, 3);
check('the founder tier reaches Zone A', overview[0]!.zones.includes('FOUNDER_COMMAND_CENTER'));
check('the staff tier does not', !overview[2]!.zones.includes('FOUNDER_COMMAND_CENTER'));
check('and neither does membership', !overview[3]!.zones.includes('FOUNDER_COMMAND_CENTER'));
eq('a tier with no supplied count reads zero, not undefined', tierOverview()[0]!.headcount, 0);

// ═══════════════════════════════════════════════════════════════════════════
section('Governance health');

eq('the component weights sum to 1',
  Math.round(Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0) * 1000) / 1000, 1);

const liveCode = { active: true, expired: false, daysRemaining: 60, rotationDays: 90 };
const strongSignals: HealthSignals = {
  code: liveCode,
  activeLockouts: 0,
  leases: { total: 100, inArrears: 4 },
  audit: { examined: 50, intact: 50 },
  documents: { total: 80, backlog: 8 },
  members: { total: 200, verified: 190 },
};
const strongHealth = governanceHealth(strongSignals);
check('a healthy platform scores well', strongHealth.score >= 88);
eq('and bands accordingly', strongHealth.band, 'strong');
eq('with nothing capped', strongHealth.cappedBy, null);
eq('and every component measured', strongHealth.unmeasured.length, 0);

// The rule worth having: no code in force is not a healthy institution, however
// good everything else looks.
const noCode = governanceHealth({ ...strongSignals, code: null });
eq('with no code, the score is capped', noCode.score, NO_CODE_CEILING);
eq('and says what capped it', noCode.cappedBy, 'facCompliance');
eq('an expired code caps it too',
  governanceHealth({ ...strongSignals, code: { ...liveCode, expired: true } }).cappedBy, 'facCompliance');

// A component with no data is excluded, not scored zero — a consortium with no
// leases yet must not read as unhealthy because rent collection had no divisor.
const noLeases = governanceHealth({ ...strongSignals, leases: { total: 0, inArrears: 0 } });
check('rent collection is excluded when there are no leases', noLeases.unmeasured.includes('rentCollection'));
check('and the score does not suffer for it', noLeases.score >= strongHealth.score - 1);
const onlyCode = governanceHealth({ code: liveCode });
eq('a platform with only a code measures one component', onlyCode.measured.length, 1);
check('and is not dragged to zero by the four it cannot measure', onlyCode.score > 90);

// Lockouts are a governance problem, not just a security one.
check('an active lockout lowers FAC compliance',
  governanceHealth({ ...strongSignals, activeLockouts: 2 }).score < strongHealth.score);

// A code near its rotation should prompt, not fail.
const nearRotation = governanceHealth({ ...strongSignals, code: { ...liveCode, daysRemaining: 3 } });
check('a code near rotation degrades smoothly', nearRotation.score < strongHealth.score);
check('rather than falling off a cliff', nearRotation.score > 60);

eq('the weakest component is named', typeof strongHealth.weakest, 'string');
for (const c of strongHealth.components) {
  check(`${c.component}: stays within 0..100`, c.score >= 0 && c.score <= 100);
  check(`${c.component}: explains itself`, c.detail.length > 0);
}
eq('critical is below 40', healthBand(30), 'critical');
eq('degraded is below 70', healthBand(60), 'degraded');
eq('healthy is below 88', healthBand(80), 'healthy');
eq('strong is 88 and up', healthBand(95), 'strong');


// ═══════════════════════════════════════════════════════════════════════════
section('FAC: digit source & peppering');

// The digit extractor must be uniform *by construction*, not because some
// constant elsewhere happens to divide by ten.
for (let d = 0; d <= 9; d += 1) {
  eq(`digitFrom(${d}/10) is ${d}`, digitFrom(d / 10), d);
}
eq('a source returning exactly 1.0 does not yield digit 10', digitFrom(1), 9);
eq('nor does anything above it', digitFrom(1.7), 9);
eq('a negative draw clamps to 0', digitFrom(-0.4), 0);
eq('and the bottom of the range is 0', digitFrom(0), 0);
check('every draw in [0,1) yields a single digit', (() => {
  for (let i = 0; i < 10000; i += 1) {
    const d = digitFrom(i / 10000);
    if (!Number.isInteger(d) || d < 0 || d > 9) return false;
  }
  return true;
})());

// Uniformity over the whole space, exhaustively rather than by sampling: ten
// equal buckets, no bucket favoured. This is what the old divide-a-large-int
// version got right only by luck.
{
  const buckets = Array.from({ length: 10 }, () => 0);
  const N = 1_000_000;
  for (let i = 0; i < N; i += 1) buckets[digitFrom(i / N)]! += 1;
  const expected = N / 10;
  check(
    'digitFrom partitions [0,1) into ten exactly equal buckets',
    buckets.every((b) => b === expected),
  );
}

// Peppering: the property that makes a leaked database useless.
const PEPPER = 'a-thoroughly-unremarkable-but-sufficiently-long-test-pepper';
const OTHER_PEPPER = 'a-different-pepper-of-entirely-adequate-length-for-tests!';

eq('a peppered digest is SHA-256 hex', pepperCode('418293', PEPPER).length, PEPPERED_LENGTH);
check('which is hex', /^[0-9a-f]+$/.test(pepperCode('418293', PEPPER)));
check('and fits inside the bcrypt 72-byte ceiling', PEPPERED_LENGTH < BCRYPT_MAX_BYTES);
// Hex cannot contain a NUL, which several bcrypt implementations treat as a
// string terminator, silently discarding everything after it.
check('and is NUL-free by construction', /^[0-9a-f]+$/.test(pepperCode('000000', PEPPER)));

eq('peppering is deterministic', pepperCode('418293', PEPPER), pepperCode('418293', PEPPER));
check(
  'a different code gives a different digest',
  pepperCode('418293', PEPPER) !== pepperCode('418294', PEPPER),
);
// The whole point: same code, different pepper, unrelated digest.
check(
  'a different pepper gives a different digest',
  pepperCode('418293', PEPPER) !== pepperCode('418293', OTHER_PEPPER),
);

let pepperThrew = false;
try {
  pepperCode('418293', 'short');
} catch {
  pepperThrew = true;
}
eq('a weak pepper is refused rather than used', pepperThrew, true);

eq('a good pepper validates', validatePepper(PEPPER), null);
check('an absent pepper is refused', validatePepper(undefined) !== null);
check('a short pepper is refused', validatePepper('abc') !== null);
// A placeholder nobody replaced satisfies a length check and nothing else.
check(
  'a low-variety pepper is refused',
  validatePepper('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') !== null,
);

// ── Secret hygiene ────────────────────────────────────────────────────────
// The failure this guards against: `.env.example` is copied to the production
// box, the database URI is filled in because nothing works without it, and the
// signing secrets are left exactly as shipped — long enough to pass every
// length rule, and published in the repository.
{
  const SHIPPED = 'change-me-to-a-64-char-random-string';
  check('the placeholder we actually ship is long enough to pass a length rule', SHIPPED.length >= 32);
  check(
    'and has enough distinct characters to pass a variety rule',
    !hasTooLittleVariety(SHIPPED),
  );
  // Which is precisely why a length-and-variety check is not sufficient, and
  // the wording list has to exist.
  eq('so it is caught by wording instead', placeholderMarkerIn(SHIPPED), 'change-me');
  check('and rejected outright', secretProblem('JWT_SECRET', SHIPPED) !== null);
  check(
    'with a message naming the variable, not just "invalid"',
    (secretProblem('JWT_SECRET', SHIPPED) ?? '').includes('JWT_SECRET'),
  );
  check(
    'and quoting the offending fragment',
    (secretProblem('JWT_SECRET', SHIPPED) ?? '').includes('change-me'),
  );
}

// Read the shipped example file rather than trusting a copy pasted into the
// test: if somebody edits `.env.example` to a placeholder the list misses, this
// is what tells them.
{
  const example = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
  const assignments = example
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as const);
  const secretNames = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'FAC_PEPPER'];
  for (const name of secretNames) {
    const value = assignments.find(([k]) => k === name)?.[1];
    check(`.env.example defines ${name}`, typeof value === 'string' && value.length > 0);
    check(
      `and its shipped ${name} placeholder is one production refuses`,
      secretProblem(name, value) !== null,
    );
  }
}

for (const marker of PLACEHOLDER_MARKERS) {
  const value = `prefix-${marker}-suffix-padded-out-to-a-realistic-length`;
  check(`"${marker}" is caught anywhere in the value`, secretProblem('X', value) !== null);
  check(`and "${marker.toUpperCase()}" is caught case-insensitively`, secretProblem('X', value.toUpperCase()) !== null);
}

// A genuine random secret must survive all of it, or the check is unusable.
{
  const real = 'f3a91c7e05b28d64af10937c5e2b8d41c690a7f2384bd56e1097c4ab3f8d2e05';
  eq('a real 64-char hex secret passes', secretProblem('JWT_SECRET', real), null);
  eq('and passes as a pepper too', validatePepper(real), null);
  check('a base64-ish secret also passes', secretProblem('X', 'kJ8/vQ2mZx+Lp9RtYw4EbN7cHs1AiUoDgF6ea3T0=') === null);
}

eq(`fewer than ${MIN_DISTINCT_CHARS} distinct characters is the variety floor`, MIN_DISTINCT_CHARS, 8);
check('a 64-char string of one character is refused', secretProblem('X', 'z'.repeat(64)) !== null);
check('a long run of digits alone is refused', secretProblem('X', '0123012301230123012301230123012301230123') !== null);
check('a short secret is refused before anything else', (secretProblem('X', 'abc') ?? '').includes('at least'));
check('an unset secret is refused', secretProblem('X', undefined) !== null);

// env.ts must actually call this, or the file is decoration. Structural for the
// same reason as the timingSafeEqual check below — a boot-time throw has no
// unit-testable surface without loading the environment.
{
  const envSource = readFileSync(resolve(process.cwd(), 'src/config/env.ts'), 'utf8');
  check('env.ts imports the hygiene check', /from '\.\/secretHygiene\.js'/.test(envSource));
  check('and applies it to JWT_SECRET', /secretProblem\('JWT_SECRET'/.test(envSource));
  check('and to FAC_PEPPER', /secretProblem\('FAC_PEPPER'/.test(envSource));
  check('and only in production', /env\.isProduction/.test(envSource));
  check('and throws rather than warning', /throw new Error\(\s*`Refusing to start in production/.test(envSource));
}

// A *structural* check, and deliberately so. Constant-time comparison has no
// observable behaviour a unit test can see — `===` returns the same booleans.
// The only honest proxy is that the implementation actually reaches for
// `timingSafeEqual`, so that a future edit to `===` fails here rather than
// silently reintroducing a timing side-channel.
{
  const source = readFileSync(
    resolve(process.cwd(), 'src/modules/fac/facCrypto.ts'),
    'utf8',
  );
  const body = /export function digestsMatch[\s\S]*?\n}/.exec(source)?.[0] ?? '';
  check('digestsMatch is implemented, and found', body.length > 0);
  check('digestsMatch uses timingSafeEqual, not ===', /timingSafeEqual/.test(body));
  check('and does not fall back to a plain equality comparison', !/return a === b/.test(body));
  check('pepperCode uses HMAC, not a bare hash', /createHmac/.test(source));
  check('and keys the HMAC on the pepper argument', /createHmac\([^)]*pepper/.test(source));
}

check('digests compare equal to themselves', digestsMatch('abc123', 'abc123'));
check('and unequal to others', !digestsMatch('abc123', 'abc124'));
check('a length mismatch is not a match', !digestsMatch('abc', 'abcd'));

// ═══════════════════════════════════════════════════════════════════════════
section('Currency');

// LRMC launches in The Gambia. A stored default of anything else, with a UI
// that prints `D`, is money in the wrong denomination — the kind of defect
// that is invisible until somebody reconciles a bank statement.
{
  check('GMD is a recognised currency', (CURRENCIES as readonly string[]).includes('GMD'));
  check('and leads the list as the launch currency', CURRENCIES[0] === 'GMD');
  // GHS stays: the consortium is Ghana-registered and will trade there.
  check('GHS is still available', (CURRENCIES as readonly string[]).includes('GHS'));

  // Every schema default, read from the source rather than asserted one model
  // at a time — a new collection added next month is covered by this too.
  const modelSources = [
    'src/modules/lease/lease.model.ts',
    'src/modules/payment/payment.model.ts',
    'src/modules/payout/payout.model.ts',
    'src/modules/ride/ride.model.ts',
    'src/modules/property/property.model.ts',
    'src/modules/marketplace/marketplace.model.ts',
    'src/modules/advertising/ad.model.ts',
  ];
  for (const rel of modelSources) {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    const wrongDefaults = (src.match(/default: 'GHS'/g) ?? []).length;
    eq(`${rel.split('/').pop()}: no collection still defaults to GHS`, wrongDefaults, 0);
  }

  // The earnings summary carries a currency through to a driver's payout
  // screen; defaulting it wrong there means a correct number with the wrong
  // symbol beside it.
  const ledgerSrc = readFileSync(resolve(process.cwd(), 'src/modules/payment/ledger.ts'), 'utf8');
  check('the earnings summary defaults to the launch currency',
    /summariseEarnings\([^)]*currency = 'GMD'/.test(ledgerSrc));

  // And the spec agrees with the models, or a client generates the wrong enum.
  check('the OpenAPI currency enum includes GMD', CURRENCY.includes('GMD'));
  eq('and leads with it', CURRENCY[0], 'GMD');

  eq('the launch currency is named once, not guessed', LAUNCH_CURRENCY, 'GMD');
  eq('and the Dalasi is written with a D', CURRENCY_SYMBOLS.GMD, 'D');
  check('every recognised currency has a symbol',
    CURRENCIES.every((c) => typeof CURRENCY_SYMBOLS[c] === 'string' && CURRENCY_SYMBOLS[c].length > 0));

  // The frontend prints the money. If its table and this one disagree, the
  // number is right and the symbol beside it is wrong — which is worse than
  // an obvious error, because it looks fine.
  const uiSrc = readFileSync(resolve(process.cwd(), '../frontend/assets/js/ui.js'), 'utf8');
  check('the frontend agrees the Dalasi is D', /GMD:\s*'D'/.test(uiSrc));
  check('and formats in the launch currency by default', /LRMC_CURRENCY\s*=\s*'GMD'/.test(uiSrc));
}

// ═══════════════════════════════════════════════════════════════════════════
section('Marketplace: who is who');

{
  const grants = (r: Role) => ROLE_DEFINITIONS[r].permissions as readonly string[];
  const touchesMarketplace = (r: Role) =>
    grants(r).some((g) => /^(merchantProfile|customerProfile|listing|order|marketplace):/.test(g));

  // The correction that produced this section: coordinators supervise
  // *vendors* — maintenance workers dispatched against work orders on
  // properties. The marketplace is not theirs. Merchants and customers are
  // governed by the platform's own rules instead, so onboarding a merchant
  // never waits on hiring somebody in their region.
  check('a coordinator holds no marketplace grant at all', !touchesMarketplace('coordinator'));
  check('but still supervises vendors', grants('coordinator').some((g) => /^vendorProfile:/.test(g)));

  // The two are different relationships and must not drift back together.
  check('a vendor holds no marketplace grant', !touchesMarketplace('vendor'));
  check('a merchant holds no maintenance grant',
    !grants('merchant').some((g) => /^maintenanceRequest:/.test(g)));

  // Accounts versus people. The account carries the trading relationship; the
  // person carries the password. Merging them makes the first staff change a
  // data migration.
  eq('a merchant is an organisational account', ROLE_DEFINITIONS.merchant.isOrganizational, true);
  eq('a seller is a person acting for one', ROLE_DEFINITIONS.seller.isOrganizational, false);
  eq('a customer is an account', ROLE_DEFINITIONS.customer.isOrganizational, true);
  eq('a buyer is a person acting for one', ROLE_DEFINITIONS.buyer.isOrganizational, false);
  eq('a seller resolves to the merchant profile', ROLE_DEFINITIONS.seller.profileModel, 'MerchantProfile');
  eq('a buyer resolves to the customer profile', ROLE_DEFINITIONS.buyer.profileModel, 'CustomerProfile');

  // Nobody trades against themselves.
  check('a merchant cannot create orders', !grants('merchant').includes('order:create'));
  check('nor can a seller', !grants('seller').includes('order:create'));
  check('but a customer can', grants('customer').includes('order:create'));
  check('and so can a buyer', grants('buyer').includes('order:create'));
  check('a customer cannot create listings', !grants('customer').includes('listing:create'));
  check('nor can a buyer', !grants('buyer').includes('listing:create'));

  // A single member of staff must not be able to destroy the catalogue.
  check('a seller cannot delete listings', !grants('seller').includes('listing:delete'));
  check('though the merchant account can', grants('merchant').includes('listing:*'));

  // Marketplace roles live in the member portal, never in HQ.
  for (const r of ['merchant', 'seller', 'customer', 'buyer'] as const) {
    check(`${r} may enter the member portal`, ROLE_DEFINITIONS[r].allowedZones.includes('MEMBER_PORTAL'));
    check(`${r} is kept out of the Founder Command Center`,
      ROLE_DEFINITIONS[r].restrictedZones.includes('FOUNDER_COMMAND_CENTER'));
    check(`${r} is kept out of Back Office`,
      ROLE_DEFINITIONS[r].restrictedZones.includes('BACK_OFFICE'));
    check(`${r} holds no wildcard`, !grants(r).includes('*:*'));
  }

  // Back Office adjudicates; HQ watches. Neither trades.
  check('Back Office administers the marketplace', touchesMarketplace('backOfficeStaff'));
  check('HQ Executive can read it', touchesMarketplace('hqExecutive'));
  check('but HQ Executive cannot place an order', !grants('hqExecutive').includes('order:create'));
}

// ═══════════════════════════════════════════════════════════════════════════
section('Marketplace: order arithmetic');

{
  const LINES = [
    { listingId: 'L1', title: 'Ceiling fan', unitPrice: 450, quantity: 2 },
    { listingId: 'L2', title: 'Installation', unitPrice: 120, quantity: 1 },
  ];

  const t = priceOrder(LINES, { deliveryFee: 60, commissionPercent: 8 });
  eq('lines multiply out', t.lines[0]!.lineTotal, 900);
  eq('subtotal is the sum of the lines', t.subtotal, 1020);
  eq('the buyer pays subtotal plus delivery', t.total, 1080);

  // Commission is on the goods, not on the courier bill — otherwise the
  // merchant funds LRMC's cut out of their own delivery cost.
  eq('commission is charged on the goods only', t.platformFee, 81.6);
  eq('and the merchant keeps the delivery fee in full', t.merchantNet, 1080 - 81.6);
  check('the money balances', totalsBalance(t));

  // The property that matters most: fee + net === total, at every percentage,
  // with no pesewa created or destroyed by double rounding.
  let balancedEverywhere = true;
  for (const pct of [0, 1, 2.5, 7.5, 8, 12.5, 15, 33.33, 50, 99, 100]) {
    for (const price of [0.01, 0.05, 3.33, 10, 33.33, 99.99, 1000.01]) {
      const o = priceOrder([{ listingId: 'x', title: 'x', unitPrice: price, quantity: 3 }],
        { deliveryFee: 7.77, commissionPercent: pct });
      if (!totalsBalance(o)) balancedEverywhere = false;
    }
  }
  check('fee plus net equals total at every rate and price tested', balancedEverywhere);

  eq('zero commission leaves the merchant everything',
    priceOrder(LINES, { commissionPercent: 0 }).merchantNet, 1020);
  eq('and a hundred percent leaves them nothing',
    priceOrder(LINES, { commissionPercent: 100 }).merchantNet, 0);
  eq('a nonsense rate falls back to the default',
    priceOrder(LINES, { commissionPercent: Number.NaN }).commissionPercent,
    DEFAULT_MARKETPLACE_COMMISSION_PERCENT);
  eq('a negative rate is floored', priceOrder(LINES, { commissionPercent: -20 }).commissionPercent, 0);
  eq('and an absurd one is capped', priceOrder(LINES, { commissionPercent: 500 }).commissionPercent, 100);

  // Quantities are whole things. 2.9 widgets is two, never three.
  eq('a fractional quantity floors',
    priceOrder([{ listingId: 'x', title: 'x', unitPrice: 10, quantity: 2.9 }]).lines[0]!.quantity, 2);
  eq('a negative quantity is zero, not a credit',
    priceOrder([{ listingId: 'x', title: 'x', unitPrice: 10, quantity: -4 }]).subtotal, 0);
  eq('a negative price is floored at zero',
    priceOrder([{ listingId: 'x', title: 'x', unitPrice: -10, quantity: 2 }]).subtotal, 0);
  eq('an empty order totals zero', priceOrder([]).total, 0);
  eq('a negative delivery fee is refused',
    priceOrder(LINES, { deliveryFee: -50 }).deliveryFee, 0);

  // Refunds return commission pro rata. Keeping the full fee on a half-refunded
  // order would mean LRMC profits proportionally more the worse the service was.
  const half = refundBreakdown(t, 540);
  eq('a half refund returns half the commission', half.commissionReturned, 40.8);
  eq('and the merchant bears the rest', half.merchantBears, 540 - 40.8);
  check('a half refund is not marked full', !half.isFull);

  const full = refundBreakdown(t, 1080);
  eq('a full refund returns all the commission', full.commissionReturned, t.platformFee);
  check('and is marked full', full.isFull);
  eq('over-refunding is capped at the order total', refundBreakdown(t, 99999).refundToBuyer, t.total);
  eq('a negative refund is zero', refundBreakdown(t, -100).refundToBuyer, 0);
  check('every refund keeps buyer and merchant shares adding up',
    [0, 0.01, 1, 539.99, 540, 1079.99, 1080].every((amt) => {
      const r = refundBreakdown(t, amt);
      return money(r.commissionReturned + r.merchantBears) === r.refundToBuyer;
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
section('Marketplace: escrow clocks');

{
  const fulfilled = new Date(Date.UTC(2026, 7, 1, 12, 0, 0));

  eq('auto-release is seven days after fulfilment',
    autoReleaseAt(fulfilled)!.toISOString(), new Date(Date.UTC(2026, 7, 8, 12, 0, 0)).toISOString());
  eq('an unfulfilled order has no release clock', autoReleaseAt(null), null);

  check('not due the day before', !autoReleaseDue(fulfilled, new Date(Date.UTC(2026, 7, 7, 12, 0, 0))));
  check('due exactly on the boundary', autoReleaseDue(fulfilled, new Date(Date.UTC(2026, 7, 8, 12, 0, 0))));
  check('and after it', autoReleaseDue(fulfilled, new Date(Date.UTC(2026, 7, 30, 0, 0, 0))));
  check('never due when nothing was fulfilled', !autoReleaseDue(null, new Date(Date.UTC(2030, 0, 1))));

  // Escrow with no time limit does not protect the buyer — it strips the
  // merchant, since a buyer who has their goods has no reason ever to confirm.
  check('the auto-release window is finite and short', AUTO_RELEASE_DAYS > 0 && AUTO_RELEASE_DAYS <= 30);

  const placed = new Date(Date.UTC(2026, 7, 1, 12, 0, 0));
  check('a buyer may cancel freely within the window',
    withinFreeCancellation(placed, new Date(Date.UTC(2026, 7, 2, 11, 59, 0))));
  check('exactly on the boundary still counts',
    withinFreeCancellation(placed, new Date(Date.UTC(2026, 7, 2, 12, 0, 0))));
  check('but not a minute after',
    !withinFreeCancellation(placed, new Date(Date.UTC(2026, 7, 2, 12, 1, 0))));
}

// ═══════════════════════════════════════════════════════════════════════════
section('Marketplace: order lifecycle');

{
  // The four properties that make escrow mean anything. Each is asserted
  // against the whole table rather than one example, so a transition added
  // later cannot quietly break it.

  check('a merchant can never release the money to themselves',
    !TRANSITIONS.some((t) => t.to === 'released' && t.by.includes('merchant')));
  check('nor can a merchant refund on their own',
    !TRANSITIONS.some((t) => t.to === 'refunded' && t.by.includes('merchant')));

  check('nothing reaches paid except from pending',
    TRANSITIONS.filter((t) => t.to === 'paid').every((t) => t.from === 'pending'));
  check('a merchant cannot accept an unpaid order',
    !TRANSITIONS.some((t) => t.from === 'pending' && t.to === 'accepted'));

  check('nothing leaves a terminal state',
    !TRANSITIONS.some((t) => TERMINAL_STATUSES.includes(t.from)));

  check('only Back Office resolves a dispute',
    TRANSITIONS.filter((t) => t.from === 'disputed').every((t) => t.by.length === 1 && t.by[0] === 'backOffice'));
  check('and a dispute can be raised from every live state where money is held',
    (['paid', 'accepted', 'fulfilled'] as const).every((from) =>
      TRANSITIONS.some((t) => t.from === from && t.to === 'disputed')));

  // Named cases, so a failure says which rule broke rather than "a transition".
  check('buyer confirms a fulfilled order', canTransitionOrder('fulfilled', 'confirmed', 'buyer').allowed);
  check('merchant cannot confirm on the buyer\'s behalf',
    !canTransitionOrder('fulfilled', 'confirmed', 'merchant').allowed);
  eq('and is told who could', canTransitionOrder('fulfilled', 'confirmed', 'merchant').reason, 'wrongActor');
  check('the refusal names the permitted actor',
    (canTransitionOrder('fulfilled', 'confirmed', 'merchant').permittedActors ?? []).includes('buyer'));

  check('the clock may release a fulfilled order', canTransitionOrder('fulfilled', 'released', 'system').allowed);
  check('but a buyer cannot skip straight to released',
    !canTransitionOrder('fulfilled', 'released', 'buyer').allowed);
  eq('a released order is finished', canTransitionOrder('released', 'refunded', 'backOffice').reason, 'terminal');
  eq('so is a refunded one', canTransitionOrder('refunded', 'released', 'backOffice').reason, 'terminal');
  eq('an impossible move is named as such',
    canTransitionOrder('pending', 'released', 'backOffice').reason, 'noSuchTransition');

  check('a buyer may walk away from an unpaid order', canTransitionOrder('pending', 'cancelled', 'buyer').allowed);
  check('but not from an accepted one', !canTransitionOrder('accepted', 'cancelled', 'buyer').allowed);

  // Escrow accounting: which states hold money.
  for (const s of ['paid', 'accepted', 'fulfilled', 'confirmed', 'disputed'] as const) {
    check(`LRMC holds the money while ${s}`, isEscrowHeld(s));
  }
  for (const s of ['pending', 'released', 'cancelled', 'refunded'] as const) {
    check(`LRMC holds nothing while ${s}`, !isEscrowHeld(s));
  }

  eq('reaching paid captures', movesMoney('paid'), 'capture');
  eq('reaching released pays out', movesMoney('released'), 'release');
  eq('reaching refunded returns', movesMoney('refunded'), 'refund');
  eq('cancelling moves nothing by itself', movesMoney('cancelled'), null);

  check('every status has a plain-language line',
    ORDER_STATUSES.every((s) => describeStatus(s).length > 5));
  check('and none of them repeat',
    new Set(ORDER_STATUSES.map(describeStatus)).size === ORDER_STATUSES.length);

  // Every transition in the table is actually reachable — a row nobody can
  // trigger is a rule that looks enforced and is not.
  check('every declared transition is reachable by its declared actor',
    TRANSITIONS.every((t) => t.by.every((a) => canTransitionOrder(t.from, t.to, a).allowed)));
  check('and every one carries a note explaining itself',
    TRANSITIONS.every((t) => t.note.length > 10));

  check('nextStatuses offers nothing from a terminal state', nextStatuses('released', 'backOffice').length === 0);
  check('and offers the buyer exactly what the table allows',
    nextStatuses('fulfilled', 'buyer').sort().join(',') === 'confirmed,disputed');
}

// ═══════════════════════════════════════════════════════════════════════════
section('Marketplace: listings');

{
  const good = { kind: 'product' as const, status: 'draft' as const, title: 'Ceiling fan',
                 unitPrice: 450, stock: 12, merchantVerified: true };

  check('a complete product publishes', canPublish(good).publishable);
  check('a service needs no stock',
    canPublish({ ...good, kind: 'service', stock: null }).publishable);

  // Collect every problem, not the first: a merchant fixing one fault per
  // submission gives up on the third, and each round trip costs a coordinator.
  const bad = canPublish({ kind: 'product', status: 'draft', title: 'x',
                           unitPrice: 0, stock: null, merchantVerified: false });
  check('a broken listing reports every problem at once', bad.problems.length >= 4);
  check('including the short title', bad.problems.some((p) => /title/i.test(p)));
  check('including the zero price', bad.problems.some((p) => /price above zero/i.test(p)));
  check('including the missing stock', bad.problems.some((p) => /stock/i.test(p)));
  check('including the unverified merchant', bad.problems.some((p) => /not yet verified/i.test(p)));

  // The verification gate specifically — a marketplace listing unverified
  // merchants owns its first fraud.
  check('an unverified merchant cannot publish',
    !canPublish({ ...good, merchantVerified: false }).publishable);
  check('an archived listing cannot be republished',
    !canPublish({ ...good, status: 'archived' }).publishable);
  check('a price over the ceiling needs approval',
    !canPublish({ ...good, unitPrice: MAX_UNIT_PRICE + 1 }).publishable);
  check('negative stock is refused', !canPublish({ ...good, stock: -1 }).publishable);

  const live = { ...good, status: 'published' as const };
  check('a published product with stock is orderable', canOrder(live, 3).orderable);
  eq('a draft is not', canOrder(good, 1).reason, 'notPublished');
  eq('ordering more than exists is refused', canOrder(live, 13).reason, 'insufficientStock');
  eq('and the refusal says how many are left', canOrder(live, 13).available, 12);
  eq('zero stock is out of stock', canOrder({ ...live, stock: 0 }, 1).reason, 'outOfStock');
  eq('a fractional quantity is refused', canOrder(live, 1.5).reason, 'badQuantity');
  eq('zero is refused', canOrder(live, 0).reason, 'badQuantity');
  eq('and a silly quantity is capped', canOrder(live, MAX_ORDER_QUANTITY + 1).reason, 'overLimit');

  // A plumber does not run out of plumbing.
  check('a service is orderable regardless of stock',
    canOrder({ ...live, kind: 'service', stock: null }, 50).orderable);

  eq('stock falls when an order is placed', stockAfterOrder(live, 5), 7);
  eq('it floors at zero rather than going negative', stockAfterOrder(live, 99), 0);
  eq('a service has no stock to move', stockAfterOrder({ ...live, kind: 'service' }, 5), null);
  eq('stock returns on a refund', stockAfterRelease(live, 5), 17);
  // Returning stock is not merely the inverse: a refunded service must not
  // invent stock on something that never had any.
  eq('but a refunded service invents none', stockAfterRelease({ ...live, kind: 'service' }, 5), null);

  check('a product that hits zero drops out of the catalogue',
    autoUnpublish({ ...live, stock: 0 }));
  check('one with stock stays', !autoUnpublish(live));
  check('and a service never auto-unpublishes',
    !autoUnpublish({ ...live, kind: 'service', stock: null }));
}

// ═══════════════════════════════════════════════════════════════════════════
section('FAC: the Zone A gate');

// The gate's whole job is to be the difference between "this account is
// allowed" and "this human is present". Before it existed the check lived only
// in the console, which is to say it lived in the one place an attacker never
// has to visit.
eq(
  'a live clearance opens the zone',
  clearanceGate({ clearanceActive: true, hasActiveCode: true, bootstrapExempt: false }),
  'allow-cleared',
);
eq(
  'no clearance, code in force — refused, and told to enter it',
  clearanceGate({ clearanceActive: false, hasActiveCode: true, bootstrapExempt: false }),
  'deny-no-clearance',
);
eq(
  'no clearance and no code — refused, and told to issue one',
  clearanceGate({ clearanceActive: false, hasActiveCode: false, bootstrapExempt: false }),
  'deny-no-code',
);
check(
  'and those two refusals are distinguishable',
  clearanceGate({ clearanceActive: false, hasActiveCode: true, bootstrapExempt: false }) !==
    clearanceGate({ clearanceActive: false, hasActiveCode: false, bootstrapExempt: false }),
);

// Bootstrap. Both halves are load-bearing: the route flag alone would leave a
// permanent hole at the most privileged endpoint on the platform.
eq(
  'with no code issued, the issuing route is reachable',
  clearanceGate({ clearanceActive: false, hasActiveCode: false, bootstrapExempt: true }),
  'allow-bootstrap',
);
eq(
  'and the moment a code exists, that exemption is gone',
  clearanceGate({ clearanceActive: false, hasActiveCode: true, bootstrapExempt: true }),
  'deny-no-clearance',
);
eq(
  'a cleared founder on the issuing route is cleared, not bootstrapped',
  clearanceGate({ clearanceActive: true, hasActiveCode: false, bootstrapExempt: true }),
  'allow-cleared',
);
check(
  'the exemption never applies to any other route',
  (['deny-no-clearance', 'deny-no-code'] as const).includes(
    clearanceGate({
      clearanceActive: false,
      hasActiveCode: false,
      bootstrapExempt: false,
    }) as 'deny-no-clearance' | 'deny-no-code',
  ),
);

// Exhaustive: eight input combinations, and exactly the two that should let a
// request through do.
{
  let allowed = 0;
  for (const clearanceActive of [true, false]) {
    for (const hasActiveCode of [true, false]) {
      for (const bootstrapExempt of [true, false]) {
        if (gateAllows(clearanceGate({ clearanceActive, hasActiveCode, bootstrapExempt }))) {
          allowed += 1;
          check(
            'every allowed combination is either cleared or a genuine bootstrap',
            clearanceActive || (bootstrapExempt && !hasActiveCode),
          );
        }
      }
    }
  }
  // 4 with a clearance, plus the single no-code + exempt case.
  eq('exactly five of the eight combinations open the zone', allowed, 5);
}

check('gateAllows agrees with the decision names', gateAllows('allow-cleared') && gateAllows('allow-bootstrap'));
check('and refuses both denials', !gateAllows('deny-no-clearance') && !gateAllows('deny-no-code'));
{
  const decisions = ['allow-cleared', 'allow-bootstrap', 'deny-no-clearance', 'deny-no-code'] as const;
  for (const decision of decisions) {
    check(`every decision has a sentence: ${decision}`, describeGate(decision).trim().length > 0);
  }
  // Distinctness is the property that matters. Four decisions sharing one
  // sentence would satisfy any length rule and tell a founder nothing.
  eq(
    'and all four say something different',
    new Set(decisions.map(describeGate)).size,
    decisions.length,
  );
  // The two refusals ask for different actions — issue a code, versus enter
  // the one that exists — so each must name its own.
  check('the no-code refusal says to issue one', /issue/i.test(describeGate('deny-no-code')));
  check('and the no-clearance refusal says to enter one', /enter/i.test(describeGate('deny-no-clearance')));
}

// Structural, for the same reason as the timingSafeEqual assertion: middleware
// wiring has no unit-testable surface without booting Express and Mongo.
{
  const mw = readFileSync(resolve(process.cwd(), 'src/middleware/requireClearance.ts'), 'utf8');
  check('the middleware refuses rather than falling through on a lookup error', /catch \(error\)[\s\S]*?next\(error\)/.test(mw));
  check('and recomputes the clearance from its grant instant', /clearanceState\(/.test(mw));
  check('and only counts an active, unrevoked, unexpired clearance', /revokedAt: null/.test(mw) && /expiresAt: \{ \$gt: now \}/.test(mw));
  check('and logs every use of the bootstrap exemption', /allow-bootstrap[\s\S]{0,200}logger\.warn/.test(mw));

  const factory = readFileSync(resolve(process.cwd(), 'src/shared/moduleFactory.ts'), 'utf8');
  check('every Zone A profile module gets the gate automatically', /adminZone === 'FOUNDER_COMMAND_CENTER'[\s\S]{0,60}requireClearance\(\)/.test(factory));
  check('and no other zone does', !/adminZone !== 'FOUNDER_COMMAND_CENTER'[\s\S]{0,60}requireClearance/.test(factory));

  const facRouter = readFileSync(resolve(process.cwd(), 'src/modules/fac/index.ts'), 'utf8');
  check('the Zone A stack carries the gate', /const zoneA = \[[\s\S]*?requireClearance\(\)/.test(facRouter));
  check('the bootstrap stack is a separate stack', /const zoneABootstrap = \[[\s\S]*?requireClearance\(\{ bootstrap: true \}\)/.test(facRouter));
  check('and only code issuance uses it', facRouter.split('...zoneABootstrap').length - 1 === 1);
  // Verification must stay outside the gate, or the code is a locked door with
  // the key inside.
  check('Zone B is not gated on a clearance', /const zoneB = \[authenticate, enterZone\('HQ_EXECUTIVE'\), auditTrail\('fac'\)\]/.test(facRouter));

  // Every hand-written Zone A route in the codebase, not just the FAC's own.
  const zoneAFiles = ['auth', 'hq', 'payout', 'advertising'];
  for (const mod of zoneAFiles) {
    const src = readFileSync(resolve(process.cwd(), `src/modules/${mod}/index.ts`), 'utf8');
    const zoneAUses = src.split("enterZone('FOUNDER_COMMAND_CENTER')").length - 1;
    const gated = src.split('requireClearance()').length - 1;
    eq(`${mod}: every Zone A route is gated`, gated, zoneAUses);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('FAC: lockout override');

// The override exists because an institution whose highest authority can be
// shut out for a day by a typo has an availability bug, not a security control.
{
  const origin = new Date('2026-03-01T09:00:00.000Z');
  const t = (mins: number) => new Date(origin.getTime() + mins * 60_000);
  const locked: AttemptRecord[] = [
    { actor: 'f1', at: t(0), result: 'fail' },
    { actor: 'f1', at: t(1), result: 'fail' },
    { actor: 'f1', at: t(2), result: 'fail' },
  ];
  eq('three failures lock the founder out', attemptVerdict(locked, 'f1', t(3)).allowed, false);
  eq('and the refusal names the lockout', attemptVerdict(locked, 'f1', t(3)).refusal, 'lockedOut');

  const cleared: AttemptRecord[] = [...locked, { actor: 'f1', at: t(4), result: 'cleared' }];
  eq('a cleared row lets them back in', attemptVerdict(cleared, 'f1', t(5)).allowed, true);
  eq('with the full allowance restored', attemptVerdict(cleared, 'f1', t(5)).attemptsRemaining, FAC_MAX_ATTEMPTS);
  eq('and the counter reset', consecutiveFailures(cleared, 'f1'), 0);

  // The failures are set aside, not erased. An override that rewrites history
  // hides the compromise it was called in to handle.
  eq('the failures remain in the ledger', cleared.filter((a) => a.result === 'fail').length, 3);

  // A `cleared` row is not a `pass`. Someone reading the ledger has to be able
  // to tell "they got in" from "a colleague let them in".
  check(
    'and `cleared` is a recognised result in its own right',
    ATTEMPT_RESULTS.includes('cleared') &&
      ATTEMPT_RESULTS.includes('pass') &&
      new Set(ATTEMPT_RESULTS).size === ATTEMPT_RESULTS.length,
  );

  // Clearing does not grant immunity.
  const failedAgain: AttemptRecord[] = [
    ...cleared,
    { actor: 'f1', at: t(6), result: 'fail' },
    { actor: 'f1', at: t(7), result: 'fail' },
    { actor: 'f1', at: t(8), result: 'fail' },
  ];
  eq('three more failures lock them out again', attemptVerdict(failedAgain, 'f1', t(9)).allowed, false);
  eq('and the count starts from the clearing, not from zero attempts ever', consecutiveFailures(failedAgain, 'f1'), 3);

  // One founder's override must not touch anybody else.
  const twoActors: AttemptRecord[] = [
    ...locked,
    { actor: 'f2', at: t(1), result: 'fail' },
    { actor: 'f2', at: t(2), result: 'fail' },
    { actor: 'f2', at: t(3), result: 'fail' },
    { actor: 'f1', at: t(4), result: 'cleared' },
  ];
  eq('clearing f1 does not clear f2', attemptVerdict(twoActors, 'f2', t(5)).allowed, false);
  eq('and f1 is genuinely clear', attemptVerdict(twoActors, 'f1', t(5)).allowed, true);

  // A `cleared` row on its own is harmless — it is a marker, not a credential.
  eq('a lone cleared row leaves the actor able to attempt', attemptVerdict([{ actor: 'f3', at: t(0), result: 'cleared' }], 'f3', t(1)).allowed, true);
}

{
  const router = readFileSync(resolve(process.cwd(), 'src/modules/fac/index.ts'), 'utf8');
  const route = /facRouter\.post\(\s*'\/lockout\/:actorId\/clear',[\s\S]*?\n\);/.exec(router)?.[0] ?? '';
  check('the override route exists', route.length > 0);
  // It sits inside zoneA, so the founder using it has already entered their own
  // code. The override therefore costs a second person and a second code — it
  // can never be cheaper than the lockout it lifts.
  check('and is itself behind the clearance gate', /\.\.\.zoneA,/.test(route));
  check('and founder-only', /requireRole\('founder'\)/.test(route));
  check('and refuses self-service', /targetId === actor\.userId/.test(route));
  check('and demands a reason', /clearLockoutSchema/.test(route));
  check('and writes a `cleared` row, not a forged `pass`', /result: 'cleared'/.test(route));
  check('and never writes a pass row', !/result: 'pass'/.test(route));
  check('and records who lifted it', /clearedBy: actor\.userId/.test(route));
  check('and tells the person it happened to', /dispatchNotification/.test(route));

  const validation = readFileSync(resolve(process.cwd(), 'src/modules/fac/fac.validation.ts'), 'utf8');
  check('the reason is mandatory', /clearLockoutSchema[\s\S]*?reason: z\.string\(\)[\s\S]*?\.min\(10/.test(validation));
  check('and not optional anywhere', !/reason: z\.string\(\)[\s\S]{0,80}\.optional\(\)[\s\S]{0,40}\}\)\s*\.strict\(\);\s*$/.test(validation));
}

// ═══════════════════════════════════════════════════════════════════════════
/**
 * The providers are the one asynchronous surface here. Wrapped in a function
 * rather than reached for with top-level await, which this project's module
 * setting does not permit.
 */
async function verifyProviders(): Promise<void> {
section('Provider abstractions');

// These are stubs, and the assertions are about the *contract* they establish —
// the shape a real FCM or MoMo integration will have to honour. Getting these
// wrong now means every call site has to change when a vendor arrives.

eq('a valid payload passes', validatePushPayload({ title: 'Hi', body: 'There' }), null);
check('an empty title is rejected', validatePushPayload({ title: '', body: 'x' }) !== null);
check('an empty body is rejected', validatePushPayload({ title: 'x', body: '  ' }) !== null);
check('an overlong title is rejected', validatePushPayload({ title: 'x'.repeat(121), body: 'y' }) !== null);
check('a plausible token is accepted', looksLikeToken('a'.repeat(32)));
check('a short one is not', !looksLikeToken('abc'));
check('and one with whitespace is not', !looksLikeToken('abc def ghi jkl mno pqr'));

const push = new StubPushProvider();
eq('the stub names itself a stub', push.name, 'stub');
const pushOk = await push.send({ token: 'a'.repeat(32), platform: 'ios' }, { title: 'T', body: 'B' });
eq('a well-formed send succeeds', pushOk.ok, true);
eq('and is attributed to the stub, never mistaken for real delivery', pushOk.provider, 'stub');
check('with a provider message id', typeof pushOk.providerMessageId === 'string');
eq('the send is recorded', push.recorded().length, 1);

const badToken = await push.send({ token: 'x', platform: 'ios' }, { title: 'T', body: 'B' });
eq('a malformed token fails', badToken.ok, false);
eq('and says so specifically, so the token can be retired', badToken.error, 'invalidToken');
const badPayload = await push.send({ token: 'a'.repeat(32), platform: 'ios' }, { title: '', body: '' });
eq('a malformed payload fails before any vendor call', badPayload.error, 'invalidPayload');

const many = await push.sendMany(
  [{ token: 'a'.repeat(32), platform: 'ios' }, { token: 'bad', platform: 'android' }],
  { title: 'T', body: 'B' },
);
const pushSummary = summarisePushResults(many);
eq('a fan-out reports what it attempted', pushSummary.attempted, 2);
eq('what landed', pushSummary.delivered, 1);
eq('what did not', pushSummary.failed, 1);
eq('and how many tokens are dead', pushSummary.invalidTokens, 1);
push.reset();
eq('the stub can be reset between runs', push.recorded().length, 0);

const goodTransfer = {
  idempotencyKey: 'line-1',
  rail: 'mobileMoney' as const,
  amount: 85,
  currency: 'GHS',
  destinationRef: 'acct-ref-1',
};
eq('a valid instruction passes', validateInstruction(goodTransfer), null);
check('a missing idempotency key is rejected', validateInstruction({ ...goodTransfer, idempotencyKey: '' }) !== null);
check('a zero amount is rejected', validateInstruction({ ...goodTransfer, amount: 0 }) !== null);
check('a negative amount is rejected', validateInstruction({ ...goodTransfer, amount: -5 }) !== null);
check('sub-pesewa precision is rejected', validateInstruction({ ...goodTransfer, amount: 1.005 }) !== null);
check('a malformed currency is rejected', validateInstruction({ ...goodTransfer, currency: 'cedi' }) !== null);
check('a missing destination is rejected', validateInstruction({ ...goodTransfer, destinationRef: '' }) !== null);
check('an unsupported rail is rejected', validateInstruction({ ...goodTransfer, rail: 'carrierPigeon' }) !== null);
check('every rail has a settlement estimate', TRANSFER_RAILS.every((r) => SETTLEMENT_HOURS[r] !== undefined));

const bank = new StubMoneyProvider();
const first = await bank.initiateTransfer(goodTransfer);
eq('a transfer is accepted', first.ok, true);
// The rule this interface exists to enforce: money does not move synchronously.
eq('but never reported settled by the initiating call', first.status, 'pending');
eq('and is not a duplicate', first.deduplicated, false);
check('it comes back with a provider reference', typeof first.providerReference === 'string');
check('and an estimated settlement time', first.estimatedSettlement instanceof Date);

const retry = await bank.initiateTransfer(goodTransfer);
eq('the same idempotency key returns the same transfer', retry.providerReference, first.providerReference);
eq('flagged as a repeat, so a retried batch does not pay twice', retry.deduplicated, true);

const other = await bank.initiateTransfer({ ...goodTransfer, idempotencyKey: 'line-2' });
check('a different key is a different transfer', other.providerReference !== first.providerReference);

const rejected = await bank.initiateTransfer({ ...goodTransfer, idempotencyKey: 'line-3', amount: -1 });
eq('an invalid instruction fails', rejected.ok, false);
eq('with a failed status', rejected.status, 'failed');
eq('and a reason', rejected.error, 'invalidInstruction');

check('a transfer can be looked up afterwards', (await bank.getTransfer(first.providerReference!)) !== null);
eq('an unknown reference returns null, not a fabricated record', await bank.getTransfer('nope'), null);

const transferSummary = summariseTransfers([first, retry, other, rejected]);
eq('a settlement run reports what it attempted', transferSummary.attempted, 4);
eq('what the rail accepted', transferSummary.accepted, 3);
eq('what was deduplicated', transferSummary.deduplicated, 1);
eq('and what failed', transferSummary.failed, 1);

// Storage: keys, not URLs, and verified evidence is frozen.
const goodPut = { key: 'documents/abc/v1.pdf', mimeType: 'application/pdf', size: 120_000 };
eq('a valid object passes', validatePut(goodPut), null);
check('a missing key is rejected', validatePut({ ...goodPut, key: '' }) !== null);
check('a malformed key is rejected', validatePut({ ...goodPut, key: '../../etc/passwd' }) !== null);
check('a zero-byte object is rejected', validatePut({ ...goodPut, size: 0 }) !== null);
check('an oversized object is rejected', validatePut({ ...goodPut, size: MAX_OBJECT_BYTES + 1 }) !== null);
check('an executable is rejected', validatePut({ ...goodPut, mimeType: 'application/x-msdownload' }) !== null);

eq(
  'the canonical key namespaces by document and version',
  objectKeyFor('abc123', 2, 'PDF'),
  'documents/abc123/v2.pdf',
);
eq('a hostile extension is stripped', objectKeyFor('abc123', 1, '../sh'), 'documents/abc123/v1.sh');

const store = new StubStorageProvider();
const put = await store.putObject(goodPut);
eq('an object stores', put.ok, true);
eq('and is attributed to the stub', put.provider, 'stub');
const signed = await store.getSignedUrl(goodPut.key);
check('a signed URL is minted on demand', signed !== null);
check('and it expires', (signed?.expiresAt.getTime() ?? 0) > Date.now());
eq('an unknown key has no URL — no fabricated link', await store.getSignedUrl('documents/nope/v1.pdf'), null);

// The rule the interface exists for: verified evidence cannot be swapped.
await store.markImmutable(goodPut.key);
const overwrite = await store.putObject({ ...goodPut, size: 999 });
eq('a frozen key refuses an overwrite', overwrite.ok, false);
eq('with a reason a caller can act on', overwrite.error, 'immutable');
const removal = await store.deleteObject(goodPut.key);
eq('and refuses deletion', removal.ok, false);
eq('for the same reason', removal.error, 'immutable');

const scratch = await store.putObject({ key: 'documents/xyz/v1.png', mimeType: 'image/png', size: 50_000 });
eq('an unfrozen object still stores', scratch.ok, true);
eq('and can be deleted', (await store.deleteObject('documents/xyz/v1.png')).ok, true);
eq('deleting what is not there is a miss, not a crash', (await store.deleteObject('documents/gone/v1.png')).error, 'notFound');
store.reset();

eq('a mobile-money payout goes over mobile money', railFor('mobileMoney'), 'mobileMoney');
eq('a wallet payout over the wallet', railFor('wallet'), 'wallet');
eq('and an unknown method falls back to a bank transfer', railFor(undefined), 'bankTransfer');
bank.reset();

}
// ═══════════════════════════════════════════════════════════════════════════
void verifyProviders().then(() => {
console.log(`\n${'═'.repeat(66)}`);
if (failures.length === 0) {
  console.log(`✓ all ${passed} checks passed`);
} else {
  console.log(`✗ ${failures.length} of ${passed + failures.length} checks failed:\n`);
  for (const f of failures) console.log(`   • ${f}`);
}
console.log('═'.repeat(66));

process.exit(failures.length === 0 ? 0 : 1);
});
