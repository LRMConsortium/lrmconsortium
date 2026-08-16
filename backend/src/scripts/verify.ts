/**
 * Dependency-free verification of the two pieces of this platform that are pure
 * logic: the RBAC/zone matrix and the ad rotation mathematics.
 *
 * Deliberately imports nothing that touches Mongo or Express, so it runs in a
 * second with `npm run verify` — no database, no server, no fixtures. Anything
 * that needs a database belongs in an integration test instead.
 */

import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { PHONE_REGEX } from '../config/contact.js';
import {
  fromMinorUnits, isExpressible, SIGNATURE_TOLERANCE_SECONDS, toMinorUnits,
  verifyWebhookSignature,
} from '../shared/providers/checkout.js';
import {
  CLAIM_STALE_AFTER_MS, HANDLED_EVENT_TYPES, intakeDecision, isAcknowledgeOnly,
  maySettle, reconcile,
} from '../modules/payment/webhookEvents.js';
import {
  MARKET_IDS, MARKETS, marketFor, marketIsDeployable, marketProblems,
  type MarketDefinition,
} from '../config/markets.js';
import { resolve } from 'node:path';
/* `BaseService` is the one Mongoose-adjacent import here, and it is safe: the
 * class imports *types* from mongoose but constructs nothing, and `buildFilter`
 * never touches the model. That is what lets the filter seam be exercised in a
 * suite that has no database. */
import { BaseService, type ListParams } from '../shared/BaseService.js';
import type { AuthenticatedActor } from '../types/express.js';
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
  lineStillClaims,
  PAYMENT_KINDS,
  PAYOUT_KINDS,
  RETRYABLE_BATCH_STATUSES,
  spentSourceIds,
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
import {
  CURRENCIES, CURRENCY_SYMBOLS, LAUNCH_CURRENCY,
  LAUNCH_COUNTRY, LAUNCH_CITY, LAUNCH_LOCATION, LAUNCH_DIALLING_CODE,
  MANAGEMENT_FEE_PERCENT, RIDE_COMMISSION_PERCENT, MARKET,
} from '../config/currencies.js';
import {
  VIEWING_STATUSES, VIEWING_TRANSITIONS, canTransitionViewing, nextViewingStatuses,
  isOpenViewing, slotProblem, describeSlotProblem, canRecordOutcome, mayAct,
  MIN_NOTICE_HOURS, MAX_AHEAD_DAYS, VIEWING_OPENS_HOUR, VIEWING_CLOSES_HOUR,
  MAX_OPEN_REQUESTS_PER_TENANT,
} from '../modules/viewing/viewingRules.js';
import {
  identityEvidenceFrom, referencesEvidenceFrom, disputesEvidenceFrom,
  ususuEvidenceFrom, streakFrom, paymentsEvidenceFrom, LATE_AFTER_DAYS,
} from '../modules/evidence/evidenceRules.js';
import {
  EVIDENCE_KEYS, emptyEvidence, withDefaults, groupHealthFrom,
  paymentReliabilityFrom, GROUP_HEALTH_PENALTY_PER_MISS, MAX_DISPUTE_SEVERITY,
} from '../config/evidence.js';
import {
  inputFromEvidence, assessEvidence,
} from '../modules/application/eligibility.js';
import {
  OCCUPANCY_STATUSES, PAYMENT_STATUSES, MAINTENANCE_STATUSES,
  SETTLED_PAYMENT_STATUSES, FAILED_PAYMENT_STATUSES, UNSETTLED_PAYMENT_STATUSES,
} from '../config/lifecycles.js';
import {
  rate, mean, bucketFor, unplaced, doubleCounted, tally, totalOf,
  PROPERTY_BUCKETS, PAYMENT_BUCKETS, MAINTENANCE_BUCKETS, APPLICATION_BUCKETS,
} from '../config/statsMath.js';
import {
  scopeFor, isUnrestricted, seesEverything as statsSeesEverything,
  DENY_ALL, UNSCOPED_ROLES, REGIONAL_ROLES,
} from '../modules/stats/statsScope.js';
import {
  isRevoked, mayRevoke, revocationExpiry, signOutOutcome, REVOCATION_REASONS,
} from '../modules/auth/revocation.js';
import {
  recordingProblems, mayRecord, receiptReference, dayKey, futureDatedBy,
  historyScope, summarisePayments, onTimeRateFrom, isLate, unclassifiedStatuses,
  RECORDABLE_KINDS, RECORDABLE_METHODS, MAX_RECORDED_AMOUNT,
  /* Aliased: `evidenceRules` exports a constant of the same name, and the two
   * being equal is the assertion below — so they must stay distinguishable
   * here rather than one silently shadowing the other. */
  LATE_AFTER_DAYS as PAYMENT_LATE_AFTER_DAYS,
} from '../modules/payment/paymentRules.js';
import {
  MAINTENANCE_TRANSITIONS, canTransitionMaintenance, partyFor, updateProblems,
  shouldEscalate, ON_HOLD_ESCALATION_HOURS,
} from '../modules/maintenance/maintenanceLifecycle.js';
import {
  LEASE_TRANSITIONS, LEASE_STATUSES, canTransitionLease, transitionProblems,
  creationProblems, mayCreate, leaseScope, tenancyEvidenceFrom, tenancyStabilityFrom,
  TRANSITIONS_BY_PARTY, MAX_MONTHLY_RENT,
  /* Aliased: `maintenanceLifecycle` exports a `partyFor` too, and the two
   * answer different questions about different records. One shadowing the
   * other would make every lease party assertion silently test maintenance. */
  partyFor as leasePartyFor,
} from '../modules/lease/leaseLifecycle.js';
import { LEASE_BUCKETS } from '../config/statsMath.js';
import {
  manifestProblems, isHashed, danglingReferences, orphanedAssets,
  stillUsesCdnTailwind, paletteOf, paletteDrift,
  type AssetManifest, type ManifestEntry,
} from '../config/assetManifest.js';
import {
  ERROR_KINDS, ERROR_SEVERITIES, SEVERITY_BY_KIND, INTAKE_ACTIONS,
  intakeAction, intakeIsAdvisoryOnly, redact, redactReport, pathTemplate,
  describeForCoordinator, mayReceiveErrorEscalation, mayReadErrors,
  REPORTS_PER_SESSION_WINDOW,
} from '../modules/security/errorCollector.js';
import {
  observe, countIn, grade, keyFor, storeKey, prune,
  dueForEscalation, escalationFingerprint, pipelineIsAdvisoryOnly,
  KEY_BY_SIGNAL, RING_MINUTES, ESCALATION_COOLDOWN_MINUTES,
  type ObservationStore,
} from '../modules/security/observations.js';
import {
  vendorStatus, vendorIsSound, vendorPending, vendorIsDeployable,
  versionIsPinned, hashIsWellFormed, type VendorLock, type VendorAsset,
} from '../config/vendorAssets.js';
import {
  ABUSE_SIGNALS, ABUSE_ACTIONS, SIGNAL_DEFINITIONS, actionFor, assessAbuse,
  mayReceiveEscalation, mayReadAbuse, isAdvisoryOnly,
} from '../modules/security/abuse.js';
import {
  mayCreateGroup, mayReadGroup, mayManageGroup, relationTo,
  addMemberProblems, removeMemberProblems, contributionProblems,
  summariseGroup, canTransitionGroup, USUSU_GROUP_TRANSITIONS,
  MAX_GROUP_MEMBERS,
  /* `groupHealthFrom` and the penalty come from `config/evidence.ts`, already
   * imported above. `groupRules` re-exports them so a circle's page and an
   * applicant's assessment provably share one arithmetic — importing them
   * twice here would only shadow that. */
} from '../modules/evidence/groupRules.js';
import {
  ELIGIBILITY_FACTORS, FACTOR_WEIGHTS, FACTOR_LABELS, BLOCKING_FACTORS,
  assessApplication, RECOMMEND_AT, REVIEW_AT, INCOME_MULTIPLE_STRONG,
  type EligibilityInput,
} from '../modules/application/eligibility.js';
import {
  APPLICATION_STATUSES, APPLICATION_TRANSITIONS, canTransitionApplication,
  isOpenApplication, isDecided, requiresDecider, mayDecide, decisionProblems,
  describeDecisionProblem, DECISIONS,
} from '../modules/application/applicationLifecycle.js';
import {
  EXTRA_LABELS,
  missingExtras,
  PASSWORD_MIN_LENGTH,
  REGISTRATION_EXTRAS,
  SELF_REGISTERABLE_ROLES,
} from '../config/registration.js';
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
  //
  // One narrow exception, and it is worth stating precisely because a vague one
  // would be a hole. A collection route may carry a parameter when that
  // parameter names a *different* resource than the collection's own item, and
  // a literal segment follows it. `/payments/:userId/history` qualifies: it is
  // the payments belonging to a user, which is a sub-collection of a different
  // entity. `/payments/:paymentId` does not, and never will — that is the shape
  // the convention exists to keep out of the collection namespace, because it
  // is the one that competes with `/payments` itself.
  //
  // The real danger — one route silently swallowing another — is guarded
  // independently by the shadowing check, which is not relaxed here at all.
  const subCollectionOfOther = (path: string): boolean => {
    const segments = path.slice(coll.length + 1).split('/');
    // `/leases/:leaseId` — the shape that competes with `/leases` itself.
    if (segments.length < 2) return false;
    // The collection's own id anywhere in a collection route is still refused.
    if (segments.includes(`:${spec.idParam}`)) return false;
    // And it has to actually be a sub-collection of something, not just a
    // deeper literal path.
    return segments.some((s) => s.startsWith(':'));
  };

  for (const ep of own) {
    if (ep.path.startsWith(`${coll}/`) || ep.path === coll) {
      check(`${ep.method} ${ep.path}: collection route carries no id`,
        !ep.path.includes(':') || subCollectionOfOther(ep.path));
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
  // Same narrow exception as the profile modules above: a parameter naming a
  // *different* resource, followed by a literal, is a sub-collection rather
  // than an item — `/payments/:userId/history` is the payments belonging to a
  // user. The collection's own id (`:paymentId`) is still refused here, because
  // that is the shape that competes with `/payments` itself.
  const subCollectionOfOther = (path: string): boolean => {
    const segments = path.slice(coll.length + 1).split('/');
    // `/leases/:leaseId` — the shape that competes with `/leases` itself.
    if (segments.length < 2) return false;
    // The collection's own id anywhere in a collection route is still refused.
    if (segments.includes(`:${spec.idParam}`)) return false;
    // And it has to actually be a sub-collection of something, not just a
    // deeper literal path.
    return segments.some((s) => s.startsWith(':'));
  };

  for (const ep of own) {
    if (ep.path === coll || ep.path.startsWith(`${coll}/`)) {
      check(`${ep.method} ${ep.path}: collection route carries no id`,
        !ep.path.includes(':') || subCollectionOfOther(ep.path));
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
    /* A gateway callback answers the gateway, not a client of this API. Its
     * body is an acknowledgement Stripe reads and nobody else, so there is no
     * generated client to keep honest and no component to name. */
    if (ep.zone === 'PUBLIC_PORTAL') {
      check(`${ep.method} ${ep.path}: acknowledges rather than returning a resource`,
        ep.responseShape.includes('WebhookAck'));
    } else if (!ep.responseShape.startsWith('204')) {
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
    /* ── One narrow carve-out, and what it costs ────────────────────────
     * These are member and back-office surfaces and none of them is anonymous
     * — with one exception: a payment gateway's callback. Stripe holds no LRMC
     * session, so `auth: 'required'` is not a thing it can satisfy, and a route
     * it cannot reach settles no orders.
     *
     * The exemption is bought, not given. A PUBLIC_PORTAL route in an
     * operational module must say in the contract what stands in for
     * authentication, because a reader of the contract alone would otherwise
     * conclude the route is simply open. Anything that does not carry a
     * signature claim fails here — so a future public route cannot inherit this
     * hole by being put in the same zone. */
    if (ep.zone === 'PUBLIC_PORTAL') {
      check(`${ep.method} ${ep.path}: is anonymous only because it is a gateway callback`,
        /signature/i.test(ep.notes ?? ''),
        'a public route in an operational module must name what authenticates it');
      check(`${ep.method} ${ep.path}: and grants nothing by role`, ep.permissions.length === 0);
      continue;
    }
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

// ── The ledger has exactly one door, and it is a narrow one ────────────────
//
// Money moves through the flows that cause it. A client asserting "I paid"
// against the ledger directly is the whole class of bug this forbids, and until
// this week the rule was absolute: zero write routes on the payment module.
//
// It is now one, and the relaxation is deliberate. The Gambia runs on cash and
// mobile money. A coordinator collects rent in a compound from a tenant with no
// card; if LRMC cannot write that down, the tenant's `paymentsEvidence` reports
// `hasRecord: false` and the scoring engine treats somebody who has paid on time
// for two years as a stranger. Refusing to record cash would push the informal
// economy out of the evidence base — which is the population LRMC exists for.
//
// So: one route, and every fence around it asserted here rather than trusted to
// review. If a second write route ever appears, the first check fails and
// somebody has to come and read this comment.
const paymentWrites = blueprint.filter(
  (e) => e.module === 'payment' && e.method !== 'GET',
);
/* ── And now there are two, which is the second deliberate relaxation ──────
 * The comment above says a second write route must make this check fail so
 * somebody comes and reads it. It did. This is that reading.
 *
 * The second door is the Stripe webhook, and it exists because the first
 * version of marketplace payment had no door at all: `POST /order/:id/pay`
 * took a `paymentRef` string from the buyer and moved the order to `paid` on
 * the strength of it. Any buyer could post any string and receive goods.
 *
 * A webhook is a *narrower* door than that, not a wider one. It is
 * unauthenticated because Stripe holds no LRMC session — and the
 * authentication is the HMAC signature over the raw body, which is a stronger
 * claim than a bearer token, because it also proves the amount.
 *
 * Both doors are named here, and every fence around each is asserted below. A
 * third still fails this check. */
const WRITE_DOORS = ['/payments/record', '/payments/webhooks/stripe'];
eq('the payments ledger has exactly two write routes', paymentWrites.length, 2);
eq('and they are the two that are meant to exist',
  paymentWrites.map((e) => e.path).sort().join(','), [...WRITE_DOORS].sort().join(','));
for (const door of WRITE_DOORS) {
  const e = blueprint.find((x) => x.path === door && x.method !== 'GET');
  check(`${door} is audited`, e?.audited === true,
    'money moving with no audit entry is not answerable');
}

// ── The webhook's own fences ──
{
  const hook = blueprint.find((e) => e.path === '/payments/webhooks/stripe');
  eq('the webhook is unauthenticated, because a gateway holds no session',
    hook?.auth, 'none');
  eq('and therefore carries no permissions', (hook?.permissions ?? []).length, 0);
  eq('and lives in the public zone', hook?.zone, 'PUBLIC_PORTAL');
  /* The contract has to say what stands in for authentication here, or a
   * reader of it alone would conclude this route is simply open. */
  for (const claim of [
    /RAW body/i, /constant-time/i, /replay window|300-second/i,
    /unique index on the event id/i, /reconciled against the order/i,
    /only 4xx is a bad signature/i,
  ]) {
    check(`and its notes state: ${claim.source.slice(0, 34)}`, claim.test(hook?.notes ?? ''),
      'a reader of the contract alone must not think this route is open');
  }
}

const rec0 = blueprint.find((e) => e.path === '/payments/record');
check('the in-person receipt is still audited', rec0?.audited === true,
  'a hand-written money record with no audit entry is not answerable');
check('and behind the member gate, not the public one',
  rec0?.auth === 'required' && rec0?.zone === 'MEMBER_PORTAL');

// ── The grant, and the bug the contract found ──────────────────────────────
//
// This route was briefly gated on `payment:create` + `payment:update`. The
// generated SDK's role list is what exposed the result: `["founder",
// "backOfficeStaff", "tenant"]` — every tenant could reach the endpoint, and
// the coordinators it exists for could not, because a coordinator holds
// `rentPayment:create` and not `payment:create`.
//
// Nothing would have failed loudly. `mayRecord` refuses a tenant, so it would
// have been a 422 on a route the contract advertised to them, and a coordinator
// standing in a compound would have got a 403 with no explanation. Hence
// `payment:record`: a distinct action, because "start a payment" and "assert
// money changed hands in a room" are distinct powers.
{
  const rec = blueprint.find((e) => e.path === '/payments/record');
  eq('recording is its own grant, not create', (rec?.permissions ?? []).join(','), 'payment:record');
  const who = [...(rec?.roles ?? [])].sort();
  eq('and exactly four roles hold it', who.join(','),
    'backOfficeStaff,coordinator,founder,hqExecutive');
  // The two halves of the bug, pinned so neither can come back.
  check('a coordinator can reach it', (rec?.roles ?? []).includes('coordinator'),
    'the endpoint exists for them');
  for (const role of ['tenant', 'landlord', 'vendor', 'driver', 'merchant'] as const) {
    check(`and a ${role} cannot`, !(rec?.roles ?? []).includes(role));
  }
  // Belt and braces: the rules module must agree with the grant, so the route
  // never advertises to somebody it will then refuse.
  for (const role of ['tenant', 'landlord', 'vendor'] as const) {
    check(`the rules module also refuses a ${role}`,
      !mayRecord({ userId: 'u', roles: [role] }));
  }
  for (const role of ['coordinator', 'backOfficeStaff', 'hqExecutive', 'founder'] as const) {
    check(`and admits a ${role}`, mayRecord({ userId: 'u', roles: [role] }));
  }
}

{
  // The schema is where "narrow" is actually enforced. Read as source, because
  // a field added to it later would widen the door silently.
  const recordSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/payment/payment.validation.ts'), 'utf8');
  check('the receipt schema is strict', recordSrc.includes('.strict()'),
    'a field ignored and a field honoured look identical from a client');
  // Each of these, supplied by a caller and honoured, is a different way to
  // write an arbitrary row into the money ledger.
  for (const forbidden of ['status', 'recordedBy', 'reference', 'platformFee', 'netAmount', 'payee']) {
    check(`and cannot be given a ${forbidden}`,
      !new RegExp(`^\\s{4}${forbidden}:`, 'm').test(recordSrc));
  }

  const rules = readFileSync(
    resolve(process.cwd(), 'src/modules/payment/paymentRules.ts'), 'utf8');
  check('only rent and deposits may be recorded by hand',
    /RECORDABLE_KINDS = \['rent', 'deposit'\]/.test(rules),
    'a hand-written payout would mark money as sent that was never sent');

  const handler = readFileSync(
    resolve(process.cwd(), 'src/modules/payment/index.ts'), 'utf8');
  check('the recorder comes from the token, not the body',
    handler.includes('recordedBy: actor.userId')
    && !/recordedBy:\s*(input|body|req\.body)/.test(handler));
  check('and a duplicate receipt is surfaced rather than swallowed',
    handler.includes('ApiError.conflict'),
    'two taps on a bad connection must not double a tenant\'s rent');
}

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
eq('a lease past its end date is completed', lifecycleStatus(LEASE, day(2027, 2, 1)), 'completed');
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
  schedule.entries.every((e) =>
    e.dueDate >= LEASE.leaseStart && (!LEASE.leaseEnd || e.dueDate <= LEASE.leaseEnd)),
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
/* The ledger's default is the active market's, which is the whole point of the
 * registry: a US ride splits at 18 and a Gambian one at 15, with no branch. */
eq('the default ride commission is the active market\'s',
  DEFAULT_RIDE_COMMISSION_PERCENT, MARKET.rideCommissionPercent);
eq('and Gambia\'s is still 15%', MARKETS.gambia.rideCommissionPercent, 15);
eq('while the pilot\'s is 18%', MARKETS.unitedStates.rideCommissionPercent, 18);

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
    { id: 'l3', status: 'completed', monthlyRent: 500, arrearsAmount: 0 },
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

  /* The market refusals, checked the same structural way and for the same
   * reason: a boot-time throw has no unit-testable surface without loading the
   * environment, and `dotenv` is not installed in this sandbox so `env.ts`
   * cannot be imported here at all. The *logic* is pure and exercised above —
   * `marketProblems` and `marketFor` — so what is left to establish is that
   * `env.ts` actually calls them. Without that this file is decoration. */
  check('env.ts imports the market registry', /from '\.\/markets\.js'/.test(envSource));
  check('and refuses production without an explicit market',
    /env\.isProduction && !raw\.LRMC_MARKET/.test(envSource),
    'a silent default is how the pilot configuration reaches Banjul');
  check('and refuses a market that has not decided its terms',
    /marketProblems\(marketFor\(raw\.LRMC_MARKET\)\)/.test(envSource),
    'a fee carried over from another market is a rate nobody set');
  check('and both refusals throw', /is not ready to serve anybody/.test(envSource));
  /* Development still needs no configuration at all. A required variable for
   * `npm run dev` is a variable somebody sets wrong once and then copies. */
  check('but development still defaults, so nothing local needs configuring',
    /process\.env\.LRMC_MARKET \?\? 'gambia'/.test(
      readFileSync(resolve(process.cwd(), 'src/config/currencies.ts'), 'utf8')));
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
section('Self-registration');

{
  const open = SELF_REGISTERABLE_ROLES as readonly string[];

  // A marketplace whose buyers cannot sign up has no buyers.
  check('a customer may create their own account', open.includes('customer'));
  // Onboarding must not grow only as fast as LRMC can hire.
  check('and so may a merchant', open.includes('merchant'));

  // Sellers and buyers act *for* an account and are added by its owner.
  // Self-registration would create people who belong to nobody.
  check('a seller cannot self-register', !open.includes('seller'));
  check('nor can a buyer', !open.includes('buyer'));

  // The open door leads to a room they cannot trade in until somebody checks
  // them: an unverified merchant can list nothing.
  check('a merchant must still be verified before publishing',
    !canPublish({ kind: 'product', status: 'draft', title: 'Ceiling fan',
                  unitPrice: 450, stock: 5, merchantVerified: false }).publishable);

  for (const staff of ['founder', 'hqExecutive', 'backOfficeStaff', 'coordinator']) {
    check(`${staff} cannot self-register`, !open.includes(staff));
  }
  check('every self-registerable name is a real role',
    open.every((r) => (ROLES as readonly string[]).includes(r)));

  // The form reads REGISTRATION_EXTRAS to decide which questions to ask; the
  // API rejects a submission that omits them. If a role appears here that
  // cannot register, the form would ask a question nobody ever sees.
  check('every role with extra questions can actually register',
    Object.keys(REGISTRATION_EXTRAS).every((r) => open.includes(r)));
  eq('a driver must declare a vehicle', REGISTRATION_EXTRAS.driver?.join(','), 'vehicleType');
  eq('a vendor must declare a service', REGISTRATION_EXTRAS.vendor?.join(','), 'serviceType');
  check('a merchant must name its business', (REGISTRATION_EXTRAS.merchant ?? []).includes('businessName'));
  check('a tenant is asked nothing extra', REGISTRATION_EXTRAS.tenant === undefined);

  eq('the password floor is stated once', PASSWORD_MIN_LENGTH, 10);

  // `REGISTRATION_EXTRAS` only shaped the form until `missingExtras` was
  // written: the register schema marks every extra optional, so a driver
  // posting straight to the API could arrive with no vehicle and no error.
  // This is the rule the schema's `superRefine` calls, tested here because
  // the schema itself imports Zod and this suite runs without it.
  {
    const complete = { vehicleType: 'Minibus', businessName: 'Kairaba Trading', serviceType: 'Plumbing', businessType: 'Agency' };

    eq('a complete driver is missing nothing', missingExtras('driver', complete).length, 0);
    eq('a driver with no vehicle is refused', missingExtras('driver', {}).join(','), 'vehicleType');
    eq('a vendor with no service is refused', missingExtras('vendor', {}).join(','), 'serviceType');
    eq('an advertiser must supply both of its extras',
      missingExtras('advertiser', {}).slice().sort().join(','), 'businessName,businessType');
    eq('an advertiser half-answered is still refused',
      missingExtras('advertiser', { businessName: 'Kairaba Media' }).join(','), 'businessType');
    eq('a tenant is never blocked on an extra', missingExtras('tenant', {}).length, 0);

    // Whitespace is how a required field gets past a presence check, and a
    // vendor whose service type is three spaces is one no coordinator can
    // dispatch.
    eq('spaces are not an answer', missingExtras('vendor', { serviceType: '   ' }).join(','), 'serviceType');
    eq('nor is an empty string', missingExtras('vendor', { serviceType: '' }).join(','), 'serviceType');
    eq('nor is a number that looks like one', missingExtras('vendor', { serviceType: 42 }).join(','), 'serviceType');

    // An unknown role cannot be talked into requiring nothing *and* into
    // requiring something: it is simply not our business here — `z.enum`
    // refuses it first.
    eq('an unknown role adds no extra demands', missingExtras('nobody', {}).length, 0);

    // Every extra anyone can be asked for must have wording, or the refusal
    // names a database column at somebody who has never seen one.
    const everyExtra = [...new Set(Object.values(REGISTRATION_EXTRAS).flatMap((f) => [...(f ?? [])]))];
    check('every extra has human wording for its refusal',
      everyExtra.every((f) => typeof EXTRA_LABELS[f] === 'string' && EXTRA_LABELS[f].length > 0));
  }
}

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

  eq('the launch currency is named once, not guessed', LAUNCH_CURRENCY, MARKET.currency);
  eq('and Gambia\'s is still the dalasi', MARKETS.gambia.currency, 'GMD');
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
// ═══════════════════════════════════════════════════════════════════════════
section('Viewings: the diary');

// A viewing is the first time LRMC asks a real person to be in a real place at
// a real time. Nearly everything that goes wrong with one is a scheduling
// mistake nobody caught.
{
  const NOW = Date.UTC(2026, 7, 10, 9, 0, 0);   // fixed: the rules take a clock
  const H = 3_600_000;
  const D = 86_400_000;

  eq('six statuses, no more', VIEWING_STATUSES.length, 6);
  check('every status has a transition list',
    VIEWING_STATUSES.every((st) => Array.isArray(VIEWING_TRANSITIONS[st])));
  check('and every destination is itself a status',
    VIEWING_STATUSES.every((st) =>
      VIEWING_TRANSITIONS[st].every((to) => (VIEWING_STATUSES as readonly string[]).includes(to))));

  check('a request can be confirmed', canTransitionViewing('requested', 'confirmed'));
  check('or declined', canTransitionViewing('requested', 'declined'));
  check('or called off', canTransitionViewing('requested', 'cancelled'));

  // Enforced by absence from the table, which is why the table is a table.
  check('a declined viewing cannot be revived',
    nextViewingStatuses('declined').length === 0);
  check('a completed viewing cannot become a no-show',
    !canTransitionViewing('completed', 'noShow'));
  check('and a no-show cannot become completed',
    !canTransitionViewing('noShow', 'completed'));
  check('nothing goes back to requested',
    VIEWING_STATUSES.every((st) => !canTransitionViewing(st, 'requested')));
  check('a viewing cannot be completed without being confirmed first',
    !canTransitionViewing('requested', 'completed'));

  check('a request is open work', isOpenViewing('requested'));
  check('so is a confirmed viewing', isOpenViewing('confirmed'));
  check('a cancelled one is not', !isOpenViewing('cancelled'));
  check('nor a completed one', !isOpenViewing('completed'));

  // ── slots ──
  eq('a good slot has nothing wrong with it',
    slotProblem(NOW + 2 * D, NOW, 10), null);
  eq('yesterday is in the past', slotProblem(NOW - D, NOW, 10), 'in-the-past');
  eq('and so is a moment ago', slotProblem(NOW - 1, NOW, 10), 'in-the-past');
  eq('twenty minutes is not notice', slotProblem(NOW + 20 * 60_000, NOW, 10), 'too-soon');
  eq('exactly the minimum notice is', slotProblem(NOW + MIN_NOTICE_HOURS * H, NOW, 10), null);
  eq('a year out is a guess', slotProblem(NOW + 400 * D, NOW, 10), 'too-far-ahead');
  eq('the last bookable day is still bookable',
    slotProblem(NOW + MAX_AHEAD_DAYS * D, NOW, 10), null);

  // Three in the morning is a request nobody will honour.
  eq('03:00 is outside viewing hours', slotProblem(NOW + 2 * D, NOW, 3), 'outside-viewing-hours');
  eq('so is 22:00', slotProblem(NOW + 2 * D, NOW, 22), 'outside-viewing-hours');
  eq('opening time is inside them', slotProblem(NOW + 2 * D, NOW, VIEWING_OPENS_HOUR), null);
  // Closing is the last hour a viewing may *start* — a viewing at 18:00 has
  // somebody at the property at seven.
  eq('closing time is not',
    slotProblem(NOW + 2 * D, NOW, VIEWING_CLOSES_HOUR), 'outside-viewing-hours');
  eq('the hour before closing is',
    slotProblem(NOW + 2 * D, NOW, VIEWING_CLOSES_HOUR - 1), null);

  eq('a nonsense date is caught before anything else',
    slotProblem(Number.NaN, NOW, 10), 'not-a-time');
  eq('and a nonsense hour is caught too',
    slotProblem(NOW + 2 * D, NOW, Number.NaN), 'not-a-time');

  check('every slot problem has wording a tenant could read',
    (['in-the-past', 'too-soon', 'too-far-ahead', 'outside-viewing-hours', 'not-a-time'] as const)
      .every((pr) => describeSlotProblem(pr).length > 15 && !describeSlotProblem(pr).includes('_')));

  // ── recording what happened ──
  // A no-show recorded before the appointment is a prediction, and it lands on
  // a tenant's record where it counts against them at application time.
  check('an outcome cannot be recorded before the slot',
    !canRecordOutcome(NOW + H, NOW));
  check('but can be at the slot', canRecordOutcome(NOW, NOW));
  check('and after it', canRecordOutcome(NOW - H, NOW));

  // ── who may act ──
  check('a tenant may call off their own viewing', mayAct('tenant', 'cancelled'));
  check('a tenant may not confirm one', !mayAct('tenant', 'confirmed'));
  check('nor mark themselves attended', !mayAct('tenant', 'completed'));
  check('nor mark themselves a no-show', !mayAct('tenant', 'noShow'));
  check('a coordinator confirms', mayAct('coordinator', 'confirmed'));
  check('and records the outcome', mayAct('coordinator', 'noShow'));
  // A landlord cancelling on a tenant's behalf would leave a record reading as
  // though the tenant lost interest.
  check('a landlord cannot cancel for the tenant', !mayAct('landlord', 'cancelled'));
  check('but may decline a slot on their own property', mayAct('landlord', 'declined'));
  check('a landlord does not record attendance', !mayAct('landlord', 'completed'));

  check('the open-request cap is a small number', MAX_OPEN_REQUESTS_PER_TENANT <= 10);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Applications: scoring, which is not deciding');

{
  const STRONG: EligibilityInput = {
    identityVerified: true,
    monthlyIncome: 40_000, monthlyRent: 12_000, employmentEvidenced: true,
    referenceRequested: true, referenceReceived: true, referenceScore: 90,
    paymentsOnTime: 12, paymentsLate: 0, paymentsMissed: 0,
    contributionsMade: 8, contributionsMissed: 0, streak: 8, groupHealth: 100,
    openDisputes: 0, resolvedDisputes: 0,
    longestTenancyMonths: 24, completedTenancies: 2, terminatedTenancies: 0,
    hasActiveLease: true,
  };

  eq('seven factors', ELIGIBILITY_FACTORS.length, 7);
  eq('weighted to a hundred',
    ELIGIBILITY_FACTORS.reduce((acc, f) => acc + FACTOR_WEIGHTS[f], 0), 100);
  check('every factor has wording that never names a column',
    ELIGIBILITY_FACTORS.every((f) => FACTOR_LABELS[f] && !FACTOR_LABELS[f].includes('_')));

  const strong = assessApplication(STRONG);
  check('every factor is scored', strong.factors.length === ELIGIBILITY_FACTORS.length);
  eq('a complete, clean applicant is recommended', strong.recommendation, 'recommend');
  check('with a score above the bar', strong.score >= RECOMMEND_AT);
  eq('nothing blocking', strong.blockedBy.length, 0);
  eq('nothing missing', strong.missing.length, 0);
  check('every factor carries a reason in words',
    strong.factors.every((f) => f.reason.length > 8));
  check('and no factor scores above its weight',
    strong.factors.every((f) => f.points <= f.max && f.points >= 0));

  // ── absent evidence is not bad evidence ──
  // A tenant new to the country has no LRMC payment history. That is a reason
  // to look at them, not a reason to refuse them.
  const newcomer = assessApplication({
    ...STRONG, paymentsOnTime: undefined, paymentsLate: undefined, paymentsMissed: undefined,
  });
  eq('an unknown factor is reported unknown, not failed',
    newcomer.factors.find((f) => f.factor === 'paymentHistory')?.status, 'unknown');
  eq('and it holds the application at review rather than declining it',
    newcomer.recommendation, 'review');
  check('with the gap named', newcomer.missing.includes('paymentHistory'));
  check('and said in the summary', newcomer.summary.toLowerCase().includes('no evidence'));

  // Not using a ride service is not a mark against a tenant.
  const noUsusu = assessApplication({ ...STRONG, contributionsMade: undefined,
    contributionsMissed: undefined, streak: undefined, groupHealth: undefined });
  eq('no Ususu history is unknown, never a failure',
    noUsusu.factors.find((f) => f.factor === 'ususuContributions')?.status, 'unknown');
  check('and Ususu carries the least weight of the seven',
    ELIGIBILITY_FACTORS.every((f) => FACTOR_WEIGHTS.ususuContributions <= FACTOR_WEIGHTS[f]));

  // ── the two blocking factors ──
  eq('identity and disputes are the blocking pair', BLOCKING_FACTORS.length, 2);
  const unidentified = assessApplication({ ...STRONG, identityVerified: false });
  check('an unverified identity blocks', unidentified.blockedBy.includes('identity'));
  check('no matter how good everything else is',
    unidentified.recommendation !== 'recommend');
  const disputed = assessApplication({ ...STRONG, openDisputes: 1 });
  check('so does an open dispute', disputed.blockedBy.includes('disputes'));
  check('and it too cannot be outscored', disputed.recommendation !== 'recommend');
  check('the blocker is named in the summary',
    disputed.summary.toLowerCase().includes('open disputes'));

  // A block caps at review — never worse on its own. "We cannot yet identify
  // this person" is a reason to look, not a reason to refuse.
  eq('a block holds at review, it does not decline',
    assessApplication({ ...STRONG, identityPending: true, identityVerified: undefined }).recommendation,
    'review');

  // ── income ──
  const thin = assessApplication({ ...STRONG, monthlyIncome: 20_000 });     // 1.67x
  eq('income that cannot sustain the rent fails that factor',
    thin.factors.find((f) => f.factor === 'employment')?.status, 'fail');
  const stretched = assessApplication({ ...STRONG, monthlyIncome: 30_000 }); // 2.5x
  eq('income below the multiple LRMC looks for is a concern, not a failure',
    stretched.factors.find((f) => f.factor === 'employment')?.status, 'concern');
  const unevidenced = assessApplication({ ...STRONG, employmentEvidenced: false });
  check('a declared income nobody checked scores less than an evidenced one',
    (unevidenced.factors.find((f) => f.factor === 'employment')?.points ?? 0)
    < (strong.factors.find((f) => f.factor === 'employment')?.points ?? 0));
  eq('and the multiple LRMC looks for is stated once', INCOME_MULTIPLE_STRONG, 3);

  // ── payment history ──
  // A missed instalment is different in kind from a late one, and must not be
  // averaged away by a long run of good months.
  const missed = assessApplication({ ...STRONG, paymentsOnTime: 24, paymentsMissed: 1 });
  eq('a missed instalment fails the factor even after two clean years',
    missed.factors.find((f) => f.factor === 'paymentHistory')?.status, 'fail');
  const late = assessApplication({ ...STRONG, paymentsOnTime: 9, paymentsLate: 3 });
  eq('late payments are a concern rather than a failure',
    late.factors.find((f) => f.factor === 'paymentHistory')?.status, 'concern');
  check('and score less than a clean record',
    (late.factors.find((f) => f.factor === 'paymentHistory')?.points ?? 0)
    < (strong.factors.find((f) => f.factor === 'paymentHistory')?.points ?? 0));

  // ── the floor ──
  const nothing = assessApplication({});
  eq('an empty application scores nothing', nothing.score, 0);
  // Not `decline`. Refusing somebody LRMC has not looked at is refusing them
  // for LRMC's own inaction, and it is the exact failure this engine exists to
  // avoid. A person decides.
  eq('and goes to a person rather than being refused', nothing.recommendation, 'review');
  eq('with every factor reported unknown', nothing.missing.length, ELIGIBILITY_FACTORS.length);

  // A decline has to be earned by evidence LRMC actually holds.
  const reallyBad = assessApplication({
    identityVerified: true, monthlyIncome: 5_000, monthlyRent: 20_000,
    employmentEvidenced: true, referenceRequested: true, referenceReceived: true,
    referenceScore: 5, paymentsOnTime: 1, paymentsMissed: 11,
    contributionsMade: 0, contributionsMissed: 12, groupHealth: 40,
    openDisputes: 0, resolvedDisputes: 0,
    longestTenancyMonths: 1, completedTenancies: 0, terminatedTenancies: 3,
    hasActiveLease: false,
  });
  eq('an applicant LRMC has fully checked and cannot support is declined',
    reallyBad.recommendation, 'decline');
  eq('and nothing was left unchecked to excuse it', reallyBad.missing.length, 0);
  check('the review bar sits below the recommend bar', REVIEW_AT < RECOMMEND_AT);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Applications: deciding, which needs a person');

{
  eq('seven statuses', APPLICATION_STATUSES.length, 7);
  check('every destination is itself a status',
    APPLICATION_STATUSES.every((st) =>
      APPLICATION_TRANSITIONS[st].every((to) =>
        (APPLICATION_STATUSES as readonly string[]).includes(to))));

  // A lease commits a landlord's property to a tenant. It may only follow a
  // decision somebody signed.
  check('only an approved application can become a lease',
    APPLICATION_STATUSES.every((st) =>
      st === 'approved' || !canTransitionApplication(st, 'leaseIssued')));
  check('a refusal is final — they apply again rather than have it reversed in place',
    APPLICATION_TRANSITIONS.rejected.length === 0);
  check('and an issued lease is not undone here',
    APPLICATION_TRANSITIONS.leaseIssued.length === 0);
  check('nothing is approved without being opened first',
    !canTransitionApplication('submitted', 'approved'));
  check('nor rejected without being opened first',
    !canTransitionApplication('submitted', 'rejected'));
  check('a withdrawal cannot be undone by LRMC',
    APPLICATION_TRANSITIONS.withdrawn.length === 0);

  check('submitted work is open', isOpenApplication('submitted'));
  check('so is work waiting on the applicant', isOpenApplication('awaitingApplicant'));
  check('an approval is not open work', !isOpenApplication('approved'));
  check('an approval is a decision', isDecided('approved'));
  check('so is a rejection', isDecided('rejected'));
  check('a withdrawal is not a decision LRMC made', !isDecided('withdrawn'));

  // ── who ──
  check('only the applicant withdraws', mayDecide('applicant', 'withdrawn'));
  check('LRMC does not withdraw on their behalf', !mayDecide('staff', 'withdrawn'));
  check('a coordinator may approve', mayDecide('coordinator', 'approved'));
  check('and reject', mayDecide('coordinator', 'rejected'));
  // LRMC carries the tenancy, holds the deposit and answers for the decision.
  check('a landlord does not approve their own applicant', !mayDecide('landlord', 'approved'));
  check('nor reject one', !mayDecide('landlord', 'rejected'));
  check('an applicant cannot approve themselves', !mayDecide('applicant', 'approved'));
  check('only Back Office issues the lease', mayDecide('staff', 'leaseIssued'));
  check('a coordinator does not', !mayDecide('coordinator', 'leaseIssued'));

  // ── a decision must have an author ──
  eq('approval and rejection are the two decisions', DECISIONS.length, 2);
  check('an approval needs a decider', requiresDecider('approved'));
  // Tempting to require a reason only for a refusal — but "who let this
  // tenancy through" is asked more often than anyone expects.
  check('and so does an approval, not only a refusal', requiresDecider('rejected'));
  check('moving to review needs neither', !requiresDecider('underReview'));

  eq('a signed, reasoned approval has no problems',
    decisionProblems({
      from: 'underReview', to: 'approved', actor: 'coordinator',
      decidedBy: 'u-coord-1', reason: 'References cleared and income evidenced.',
    }).length, 0);
  check('an unsigned approval is refused',
    decisionProblems({
      from: 'underReview', to: 'approved', actor: 'coordinator', reason: 'Looks fine to me.',
    }).includes('needs-a-decider'));
  check('an approval with no reason is refused',
    decisionProblems({
      from: 'underReview', to: 'approved', actor: 'coordinator', decidedBy: 'u-coord-1',
    }).includes('needs-a-reason'));
  check('and a reason of three characters is not a reason',
    decisionProblems({
      from: 'underReview', to: 'approved', actor: 'coordinator',
      decidedBy: 'u-coord-1', reason: ' ok ',
    }).includes('needs-a-reason'));
  check('a landlord approving is not their decision',
    decisionProblems({
      from: 'underReview', to: 'approved', actor: 'landlord',
      decidedBy: 'u-ll-1', reason: 'I like them.',
    }).includes('not-your-decision'));
  check('approving straight from submitted is not a transition',
    decisionProblems({
      from: 'submitted', to: 'approved', actor: 'staff',
      decidedBy: 'u-1', reason: 'Everything checks out.',
    }).includes('not-a-transition'));

  // Every problem at once, so a caller is told once what to fix rather than
  // discovering it a refusal at a time.
  eq('all four problems are reported together',
    decisionProblems({ from: 'rejected', to: 'approved', actor: 'applicant' }).length, 4);

  check('every decision problem has wording a person could act on',
    (['not-a-transition', 'not-your-decision', 'needs-a-decider', 'needs-a-reason'] as const)
      .every((pr) => describeDecisionProblem(pr).length > 20));
}


// ═══════════════════════════════════════════════════════════════════════════
section('Evidence: zero and unknown are different facts');

// The whole engine turns on this distinction. `{ contributionsMade: 0,
// hasRecord: true }` is a person with an Ususu account who has contributed
// nothing. `{ contributionsMade: 0, hasRecord: false }` is a person who has
// never heard of Ususu. Scoring the second as the first declines a tenant for
// not using a ride service.
{
  eq('six kinds of evidence', EVIDENCE_KEYS.length, 6);

  const empty = emptyEvidence();
  check('every kind is always present, never null',
    EVIDENCE_KEYS.every((k) => empty[k] !== null && typeof empty[k] === 'object'));
  check('and every one says LRMC has not looked',
    EVIDENCE_KEYS.every((k) => (empty[k] as { hasRecord: boolean }).hasRecord === false));
  check('a partial bundle is filled in rather than left with holes',
    EVIDENCE_KEYS.every((k) =>
      withDefaults({ identityEvidence: { identityVerified: true, identityPending: false, hasRecord: true } })[k]
        !== undefined));

  // ── the bridge ──
  const unlooked = inputFromEvidence(emptyEvidence());
  eq('an unlooked-at bundle contributes nothing to the scorer',
    Object.keys(unlooked).length, 0);
  const scored = assessEvidence(emptyEvidence());
  eq('so every factor reports unknown', scored.missing.length, ELIGIBILITY_FACTORS.length);
  eq('and the application is held at review, not declined', scored.recommendation, 'review');

  // A real zero is scoreable. `hasRecord: true` with nothing in it is a
  // statement, and the scorer is allowed to act on it.
  const looked = withDefaults({
    ususuEvidence: { contributionsMade: 0, contributionsMissed: 9, streak: 0, groupHealth: 55, hasRecord: true },
  });
  const usususcore = assessEvidence(looked);
  eq('a real record of missed contributions is scored, not ignored',
    usususcore.factors.find((f) => f.factor === 'ususuContributions')?.status, 'fail');
  check('while no record at all is not',
    assessEvidence(emptyEvidence()).factors
      .find((f) => f.factor === 'ususuContributions')?.status === 'unknown');

  // ── group health ──
  eq('no misses is full health', groupHealthFrom(0), 100);
  eq('one miss costs the stated penalty', groupHealthFrom(1), 100 - GROUP_HEALTH_PENALTY_PER_MISS);
  eq('ten misses halve it', groupHealthFrom(10), 50);
  // `100 - misses * 5` goes negative at twenty-one, and a health of -15 flows
  // into a percentage on a dashboard.
  eq('twenty misses reaches zero', groupHealthFrom(20), 0);
  eq('and it never goes below zero', groupHealthFrom(500), 0);
  eq('a nonsense count is full health, not NaN', groupHealthFrom(Number.NaN), 100);

  // ── payment reliability ──
  eq('a clean record is a hundred per cent', paymentReliabilityFrom(12, 0), 100);
  eq('half late is half', paymentReliabilityFrom(6, 6), 50);
  // `onTime / (onTime + late)` divides by zero on somebody's first day, and
  // NaN travels silently through a score and onto a screen.
  eq('no history is zero, not NaN', paymentReliabilityFrom(0, 0), 0);
  check('and it is a number', Number.isFinite(paymentReliabilityFrom(0, 0)));
  // Somebody who paid three and skipped seven is not fully reliable.
  eq('missed instalments count against it too', paymentReliabilityFrom(3, 0, 7), 30);
  eq('and negatives cannot inflate it', paymentReliabilityFrom(5, -100), 100);

  eq('dispute severity tops out where the schema says', MAX_DISPUTE_SEVERITY, 3);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Scoring: the band is reachable, and reachable fairly');

{
  // The reason the weights are what they are. A verified tenant with a clean
  // rent record, a good reference and no disputes must be recommendable
  // whether or not they have ever used the ride service.
  const withoutUsusu = withDefaults({
    identityEvidence: { identityVerified: true, identityPending: false, hasRecord: true },
    referencesEvidence: { referenceRequested: true, referenceReceived: true, referenceScore: 90, hasRecord: true },
    disputesEvidence: { disputesOpen: 0, disputesResolved: 0, disputeSeverity: 0, hasRecord: true },
    paymentsEvidence: { paymentsOnTime: 12, paymentsLate: 0, paymentsMissed: 0, paymentReliability: 100, hasRecord: true },
    ususuEvidence: { contributionsMade: 0, contributionsMissed: 0, streak: 0, groupHealth: 100, hasRecord: false },
    tenancyEvidence: { leaseCount: 2, completedCount: 2, terminatedCount: 0, hasActiveLease: true,
                       monthsHoused: 30, longestTenancyMonths: 18, hasRecord: true },
  });
  const noRide = assessEvidence(withoutUsusu, { monthlyIncome: 40_000, monthlyRent: 12_000, employmentEvidenced: true });
  check('a tenant who has never used Ususu still scores well', noRide.score >= RECOMMEND_AT);
  eq('but is held at review, because one source was never checked',
    noRide.recommendation, 'review');
  /* ── The catch-22 this weight exists to avoid ─────────────────────────
   *
   * `tenancyStability` is evidence from a person's *previous LRMC tenancies*.
   * Every applicant for their first one has none — which, at launch, is every
   * applicant there is. If the weight were large enough to put `recommend` out
   * of reach without it, LRMC could structurally never recommend anybody who
   * had not already rented from LRMC.
   *
   * So: somebody with no Ususu AND no prior tenancy — the genuine newcomer —
   * must still be able to clear the bar on the evidence LRMC can actually
   * gather about a stranger. This is the same shape as the Ususu weight caught
   * in Week 1, and it is asserted rather than reasoned about. */
  const brandNew = withDefaults({
    identityEvidence: { identityVerified: true, identityPending: false, hasRecord: true },
    referencesEvidence: { referenceRequested: true, referenceReceived: true, referenceScore: 90, hasRecord: true },
    disputesEvidence: { disputesOpen: 0, disputesResolved: 0, disputeSeverity: 0, hasRecord: true },
    paymentsEvidence: { paymentsOnTime: 12, paymentsLate: 0, paymentsMissed: 0, paymentReliability: 100, hasRecord: true },
    // Both absent. Never used the ride service, never rented through LRMC.
  });
  const first = assessEvidence(brandNew, { monthlyIncome: 40_000, monthlyRent: 12_000, employmentEvidenced: true });
  check('a first-time applicant with no Ususu and no LRMC tenancy still clears the bar',
    first.score >= RECOMMEND_AT,
    `scored ${first.score}, needs ${RECOMMEND_AT}`);
  eq('though they are still held for a person to look at', first.recommendation, 'review');
  // Belt and braces on the arithmetic, so a future re-weighting cannot quietly
  // close the door: the two factors a newcomer cannot have must leave enough
  // behind to reach the bar.
  const unreachable = FACTOR_WEIGHTS.ususuContributions + FACTOR_WEIGHTS.tenancyStability;
  check('and the weights leave room for that by construction',
    100 - unreachable >= RECOMMEND_AT,
    `${100 - unreachable} reachable without Ususu or a prior tenancy, bar is ${RECOMMEND_AT}`);
  // A tenancy history must never be *required* to be housed, for the same
  // reason a rideshare account must not be.
  check('tenancy history is not a blocking factor',
    !BLOCKING_FACTORS.includes('tenancyStability'));

  eq('and the only gap named is the one that is genuinely missing',
    noRide.missing.join(','), 'ususuContributions');

  // With every source checked, including an Ususu record that simply says
  // "no account activity", the band is reachable.
  const everything = withDefaults({
    identityEvidence: { identityVerified: true, identityPending: false, hasRecord: true },
    referencesEvidence: { referenceRequested: true, referenceReceived: true, referenceScore: 90, hasRecord: true },
    disputesEvidence: { disputesOpen: 0, disputesResolved: 0, disputeSeverity: 0, hasRecord: true },
    paymentsEvidence: { paymentsOnTime: 12, paymentsLate: 0, paymentsMissed: 0, paymentReliability: 100, hasRecord: true },
    ususuEvidence: { contributionsMade: 9, contributionsMissed: 0, streak: 9, groupHealth: 100, hasRecord: true },
    tenancyEvidence: { leaseCount: 2, completedCount: 2, terminatedCount: 0, hasActiveLease: true,
                       monthsHoused: 30, longestTenancyMonths: 18, hasRecord: true },
  });
  const full = assessEvidence(everything, { monthlyIncome: 40_000, monthlyRent: 12_000, employmentEvidenced: true });
  eq('a fully-evidenced applicant is recommended', full.recommendation, 'recommend');
  check('with a score at or above the bar', full.score >= RECOMMEND_AT);
  eq('nothing missing', full.missing.length, 0);
  eq('nothing blocking', full.blockedBy.length, 0);

  // Ususu must never be the difference between recommended and refused.
  const ususuAbsent = { ...everything, ususuEvidence: { ...everything.ususuEvidence, hasRecord: false } };
  check('the whole Ususu factor is worth less than the gap to the bar',
    FACTOR_WEIGHTS.ususuContributions < 100 - RECOMMEND_AT + FACTOR_WEIGHTS.ususuContributions);
  check('so removing it cannot push a strong applicant into decline',
    assessEvidence(ususuAbsent, { monthlyIncome: 40_000, monthlyRent: 12_000, employmentEvidenced: true })
      .recommendation !== 'decline');

  // Blocking still outranks the total, which is the point of blocking.
  const unverified = { ...everything, identityEvidence: { identityVerified: false, identityPending: false, hasRecord: true } };
  const u = assessEvidence(unverified, { monthlyIncome: 40_000, monthlyRent: 12_000, employmentEvidenced: true });
  check('an unverified identity blocks however high the rest scores',
    u.recommendation !== 'recommend' && u.blockedBy.includes('identity'));
  const disputed = { ...everything, disputesEvidence: { disputesOpen: 1, disputesResolved: 0, disputeSeverity: 3, hasRecord: true } };
  const dscore = assessEvidence(disputed, { monthlyIncome: 40_000, monthlyRent: 12_000, employmentEvidenced: true });
  check('and so does an open dispute', dscore.recommendation !== 'recommend');
  check('with its grade in the reason, so a coordinator knows what they are reading',
    (dscore.factors.find((f) => f.factor === 'disputes')?.reason ?? '').includes('severe'));

  // A reference LRMC never asked for is LRMC's omission.
  const unasked = withDefaults({
    referencesEvidence: { referenceRequested: false, referenceReceived: false, referenceScore: null, hasRecord: true },
  });
  eq('a reference nobody requested is unknown, not a failure',
    assessEvidence(unasked).factors.find((f) => f.factor === 'references')?.status, 'unknown');
}


// ═══════════════════════════════════════════════════════════════════════════
section('Evidence: turning records into facts');

// This is the layer between a collection and the scorer, and every function in
// it can be wrong in a way nobody notices — because the wrong answer is still
// a plausible number.
{
  // ── identity ──
  eq('no user row is no record', identityEvidenceFrom(null).hasRecord, false);
  check('a verified user is verified',
    identityEvidenceFrom({ isVerified: true }).identityVerified);
  check('submitted-but-unreviewed is pending, not refused',
    identityEvidenceFrom({ verificationStatus: 'pending' }).identityPending);
  check('and in-review counts as pending too',
    identityEvidenceFrom({ verificationStatus: 'inReview' }).identityPending);
  check('never submitted is a real record of not verified',
    identityEvidenceFrom({ verificationStatus: 'unsubmitted' }).hasRecord
    && !identityEvidenceFrom({ verificationStatus: 'unsubmitted' }).identityVerified);
  // A status this function has not been taught about means the code is behind
  // the data. Answering "not verified" would refuse somebody over a
  // deployment ordering problem.
  eq('a status LRMC does not recognise is no record, not a failure',
    identityEvidenceFrom({ verificationStatus: 'somethingNew' }).hasRecord, false);

  // ── references ──
  eq('no reference rows is no record', referencesEvidenceFrom([]).hasRecord, false);
  const asked = referencesEvidenceFrom([{ status: 'requested' }]);
  check('a request with no reply is recorded as requested', asked.referenceRequested);
  check('and not as received', !asked.referenceReceived);
  eq('with no score yet', asked.referenceScore, null);
  // Averaging punishes an applicant for a referee who never answered, and
  // silence says nothing about the person asked about.
  eq('the best reply is taken, not the average',
    referencesEvidenceFrom([
      { status: 'received', score: 90 },
      { status: 'declined' },
      { status: 'requested' },
    ]).referenceScore, 90);
  eq('and two replies take the better one',
    referencesEvidenceFrom([
      { status: 'received', score: 40 }, { status: 'received', score: 85 },
    ]).referenceScore, 85);

  // ── disputes ──
  eq('no dispute rows is no record', disputesEvidenceFrom([]).hasRecord, false);
  const d = disputesEvidenceFrom([
    { status: 'open', severity: 1 },
    { status: 'open', severity: 1 },
    { status: 'open', severity: 1 },
    { status: 'resolved', severity: 3 },
  ]);
  eq('open disputes are counted', d.disputesOpen, 3);
  eq('and resolved ones separately', d.disputesResolved, 1);
  // Three minor disputes are not one severe dispute. Summing would make
  // somebody with several small unresolved matters look dangerous.
  eq('severity is the worst open one, not the sum', d.disputeSeverity, 1);
  eq('a resolved severe one does not raise current severity', d.disputeSeverity, 1);
  eq('the worst open one is what shows',
    disputesEvidenceFrom([{ status: 'open', severity: 1 }, { status: 'open', severity: 3 }])
      .disputeSeverity, 3);

  // ── ususu ──
  eq('an empty ledger is no record', ususuEvidenceFrom([]).hasRecord, false);
  // Rows arrive oldest first. Counting forwards returns the first run somebody
  // ever managed — six months two years ago, then nothing.
  eq('the streak counts backwards from the most recent period',
    streakFrom([
      { kind: 'contribution', period: '2026-01' },
      { kind: 'contribution', period: '2026-02' },
      { kind: 'miss', period: '2026-03' },
      { kind: 'contribution', period: '2026-04' },
    ]), 1);
  eq('an unbroken run is the whole run',
    streakFrom([
      { kind: 'contribution', period: '2026-01' },
      { kind: 'contribution', period: '2026-02' },
    ]), 2);
  eq('a miss most recently is a streak of nothing',
    streakFrom([{ kind: 'contribution', period: '2026-01' }, { kind: 'miss', period: '2026-02' }]), 0);
  const u = ususuEvidenceFrom([
    { kind: 'contribution', period: '2026-01' },
    { kind: 'miss', period: '2026-02' },
    { kind: 'contribution', period: '2026-03' },
  ]);
  eq('contributions are counted', u.contributionsMade, 2);
  eq('and misses', u.contributionsMissed, 1);
  eq('group health follows the misses', u.groupHealth, 95);
  check('and a ledger that exists says so', u.hasRecord);

  // ── payments ──
  eq('no payment rows is no record', paymentsEvidenceFrom([]).hasRecord, false);
  const DAY = 86_400_000;
  const due = new Date('2026-06-01T00:00:00Z');
  const onTime = new Date(due.getTime() + DAY);
  const late = new Date(due.getTime() + (LATE_AFTER_DAYS + 2) * DAY);
  const pay = paymentsEvidenceFrom([
    { status: 'succeeded', dueDate: due, paidAt: onTime },
    { status: 'succeeded', dueDate: due, paidAt: late },
    { status: 'failed' },
  ]);
  eq('a payment inside the grace period is on time', pay.paymentsOnTime, 1);
  eq('one outside it is late', pay.paymentsLate, 1);
  eq('and a failure is missed', pay.paymentsMissed, 1);
  eq('reliability is the share paid on time', pay.paymentReliability, 33);
  // A gap in LRMC's own data is not the tenant's lateness.
  eq('a payment with no due date on record cannot be late',
    paymentsEvidenceFrom([{ status: 'succeeded', paidAt: onTime }]).paymentsLate, 0);
  eq('and is counted on time instead',
    paymentsEvidenceFrom([{ status: 'succeeded', paidAt: onTime }]).paymentsOnTime, 1);
  // An instalment that is not yet due is not evidence of anything, and
  // counting it as missed would make every tenant look worse on the first.
  eq('a pending instalment is not counted as missed',
    paymentsEvidenceFrom([
      { status: 'succeeded', dueDate: due, paidAt: onTime }, { status: 'pending' },
    ]).paymentsMissed, 0);
  eq('nor does it drag reliability down',
    paymentsEvidenceFrom([
      { status: 'succeeded', dueDate: due, paidAt: onTime }, { status: 'pending' },
    ]).paymentReliability, 100);
  eq('and pending alone is still no record',
    paymentsEvidenceFrom([{ status: 'pending' }]).hasRecord, false);
}


// ═══════════════════════════════════════════════════════════════════════════
section('Lifecycles: one vocabulary, and everything points at it');

// This section exists because of the `paid`/`succeeded` bug. `paymentsEvidenceFrom`
// filtered the ledger on a status the ledger does not have, so payments evidence
// came back `hasRecord: false` for every applicant on the platform — a quarter of
// the scoring weight, silently absent, for a week. Nothing threw. The tile read
// zero and zero is a plausible number.
//
// What follows is the shape of check that would have caught it: not "does the
// filter work" but "is the word the filter uses a word the model can produce".
{
  const settled = SETTLED_PAYMENT_STATUSES as readonly string[];
  const failed = FAILED_PAYMENT_STATUSES as readonly string[];
  const unsettled = UNSETTLED_PAYMENT_STATUSES as readonly string[];
  const all = PAYMENT_STATUSES as readonly string[];

  check('the ledger has no status called "paid"', !all.includes('paid'),
    'that word belongs to the marketplace order lifecycle');
  check('settled is a real ledger status', settled.every((s) => all.includes(s)),
    settled.filter((s) => !all.includes(s)).join(', '));
  check('so is failed', failed.every((s) => all.includes(s)));
  check('so is unsettled', unsettled.every((s) => all.includes(s)));

  // A status in two of these would be counted twice by anything reading them.
  const overlap = settled.filter((s) => failed.includes(s) || unsettled.includes(s));
  check('and no status is in two of the three', overlap.length === 0, overlap.join(', '));

  // The classification is total: every ledger status is settled, failed,
  // unsettled, or explicitly neither (money that came back).
  const classified = [...settled, ...failed, ...unsettled, 'refunded', 'cancelled'];
  const orphan = all.filter((s) => !classified.includes(s));
  check('every ledger status is accounted for by the evidence rules',
    orphan.length === 0, orphan.join(', '));

  // Belt and braces on the specific regression: the filter matches a row the
  // schema could actually have written.
  eq('a succeeded row is settled evidence',
    paymentsEvidenceFrom([{ status: 'succeeded', paidAt: new Date() }]).hasRecord, true);
  eq('and the old wrong word now finds nothing, loudly',
    paymentsEvidenceFrom([{ status: 'paid', paidAt: new Date() }]).hasRecord, false);
}

// ── The dashboard's buckets are exhaustive over the models' statuses ────────
//
// A model gaining a status without a bucket to hold it is invisible: the tiles
// simply add up to less than the total, and a low number looks like a quiet
// month rather than a missing case.
{
  const cases: { name: string; table: Record<string, readonly string[]>; all: readonly string[] }[] = [
    { name: 'property', table: PROPERTY_BUCKETS, all: OCCUPANCY_STATUSES },
    { name: 'payment', table: PAYMENT_BUCKETS, all: PAYMENT_STATUSES },
    { name: 'maintenance', table: MAINTENANCE_BUCKETS, all: MAINTENANCE_STATUSES },
    { name: 'application', table: APPLICATION_BUCKETS, all: APPLICATION_STATUSES },
  ];

  for (const c of cases) {
    const missing = unplaced(c.table, c.all);
    check(`every ${c.name} status has a bucket`, missing.length === 0, missing.join(', '));

    const twice = doubleCounted(c.table);
    check(`and no ${c.name} status is in two`, twice.length === 0, twice.join(', '));

    // The reverse direction: a bucket naming a status the model cannot produce
    // is a tile that will always read zero. TypeScript's `satisfies` catches
    // this at compile time; asserted here too so the check survives a cast.
    const invented = Object.values(c.table).flat().filter((s) => !c.all.includes(s));
    check(`and no ${c.name} bucket invents a status`, invented.length === 0, invented.join(', '));

    // Exhaustive plus disjoint means the parts sum to the whole, which is the
    // property a reader actually relies on.
    const rows = c.all.map((s) => ({ _id: s as string | null, n: 1 }));
    const counts = tally(c.table, rows);
    eq(`${c.name} buckets sum to the row count`, totalOf(counts), c.all.length);
    eq(`and nothing lands in "other"`, counts.other, 0);
  }

  // `other` is not decoration. A row whose status predates a rename still has
  // to appear somewhere, or the total on screen contradicts the total in the
  // database.
  const stray = tally(PAYMENT_BUCKETS, [{ _id: 'somethingNew', n: 3 }, { _id: null, n: 2 }]);
  eq('an unrecognised status is reported, not dropped', stray.other, 5);
  eq('and the total still holds', totalOf(stray), 5);
  eq('every bucket key is present even at zero',
    Object.keys(PAYMENT_BUCKETS).every((k) => stray[k] === 0), true);

  eq('bucketFor names the bucket', bucketFor(PAYMENT_BUCKETS, 'processing'), 'awaiting');
  eq('and returns null rather than guessing', bucketFor(PAYMENT_BUCKETS, 'nonsense'), null);
}

// ── The drift detectors themselves detect drift ─────────────────────────────
//
// Everything above asks `unplaced()` and `doubleCounted()` whether the real
// tables are sound, and they answer "yes". A version of either that always
// answered "yes" would pass every one of those checks — the guard would be
// gone and the suite would still be green, which is the worst failure mode a
// test can have. So: hand each one a table that is definitely broken and
// require it to say so.
{
  const short = { a: ['x'], b: ['y'] };
  eq('unplaced finds the status nobody placed',
    unplaced(short, ['x', 'y', 'z']).join(','), 'z');
  eq('and finds all of them', unplaced(short, ['p', 'q']).length, 2);
  eq('and finds nothing when the table is complete', unplaced(short, ['x', 'y']).length, 0);
  eq('an empty table places nothing', unplaced({}, ['x']).join(','), 'x');

  const overlapping = { a: ['x', 'y'], b: ['y', 'z'], c: ['z'] };
  eq('doubleCounted finds every status claimed twice',
    doubleCounted(overlapping).sort().join(','), 'y,z');
  eq('and finds nothing in a disjoint table', doubleCounted(short).length, 0);
  // Within one bucket a repeat is harmless for counting but still a mistake
  // worth surfacing, and reporting it costs nothing.
  eq('a status repeated inside one bucket is reported too',
    doubleCounted({ a: ['x', 'x'] }).join(','), 'x');
}

// ── Rates are null over nothing, never zero and never NaN ──────────────────
{
  eq('a rate over nothing is null, not zero', rate(0, 0), null);
  eq('a rate of nothing over something is zero', rate(0, 10), 0);
  eq('a negative total is null', rate(1, -5), null);
  eq('NaN in is null out', rate(NaN, 10), null);
  eq('Infinity in is null out', rate(1, Infinity), null);
  eq('a rate is a percentage to one decimal', rate(1, 3), 33.3);
  eq('and rounds rather than truncates', rate(2, 3), 66.7);
  eq('a full rate is 100', rate(7, 7), 100);
  // Guards against a caller passing a negative part and getting a negative
  // percentage onto a tile.
  eq('a negative part floors at zero', rate(-4, 10), 0);

  eq('a mean over nothing is null', mean([]), null);
  eq('a mean ignores non-numbers', mean([2, NaN, 4]), 3);
  eq('and is null if nothing survives', mean([NaN, Infinity]), null);
  eq('a mean is to one decimal', mean([1, 2]), 1.5);
  eq('a single value is itself', mean([9]), 9);
}


// ═══════════════════════════════════════════════════════════════════════════
section('Stats: whose numbers these are');

// The aggregate endpoints answer "how is my portfolio doing". The distance
// between that and "how is LRMC doing" is one `$match` stage, and an empty
// match is not "nothing" to an aggregation pipeline — it is *everything*. So
// the failure mode here is not an error, it is a landlord opening their
// dashboard and reading the institution's whole rent roll.
{
  const landlord = { userId: 'u-landlord', roles: ['landlord'] };
  const tenant = { userId: 'u-tenant', roles: ['tenant'] };
  const founder = { userId: 'u-founder', roles: ['founder'] };
  const backOffice = { userId: 'u-bo', roles: ['backOfficeStaff'] };
  const hq = { userId: 'u-hq', roles: ['hqExecutive'] };
  const coordinator = { userId: 'u-coord', roles: ['coordinator'], regions: ['banjul', 'kanifing'] };
  const roamingCoord = { userId: 'u-coord2', roles: ['coordinator'] };

  /* User-space, so the existing expectations below still read as they did.
   * The profile-space branch is asserted separately underneath. */
  const OWNED = { owner: { field: 'landlordId', space: 'user' as const }, region: 'region' };

  // ── The two privileged lists are real roles, and are disjoint ──
  // A role in both lists would take the institution-wide branch and its
  // regional scope would be dead code — a coordinator quietly promoted.
  for (const r of [...UNSCOPED_ROLES, ...REGIONAL_ROLES]) {
    check(`"${r}" is a role the platform actually has`,
      (ROLES as readonly string[]).includes(r));
  }
  const bothLists = (UNSCOPED_ROLES as readonly string[])
    .filter((r) => (REGIONAL_ROLES as readonly string[]).includes(r));
  check('no role is both institution-wide and regional', bothLists.length === 0,
    bothLists.join(', '));
  // Landlords and tenants must never be on the unscoped list. This is the
  // single assertion that stands between a member and the whole rent roll.
  for (const r of ['landlord', 'tenant', 'driver', 'rider', 'vendor']) {
    check(`"${r}" is not institution-wide`,
      !(UNSCOPED_ROLES as readonly string[]).includes(r));
    check(`and "${r}" alone never sees everything`,
      !statsSeesEverything({ userId: 'u', roles: [r] }));
  }

  // ── The institution ──
  check('the founder is unrestricted', isUnrestricted(scopeFor(founder, OWNED)));
  check('so is Back Office', isUnrestricted(scopeFor(backOffice, OWNED)));
  check('so is an HQ executive', isUnrestricted(scopeFor(hq, OWNED)));

  // ── An individual ──
  eq('a landlord is scoped to their own records',
    JSON.stringify(scopeFor(landlord, OWNED)), JSON.stringify({ landlordId: 'u-landlord' }));
  check('and is never unrestricted', !isUnrestricted(scopeFor(landlord, OWNED)));
  eq('a tenant likewise',
    JSON.stringify(scopeFor(tenant, { owner: { field: 'tenantId', space: 'user' as const } })),
    JSON.stringify({ tenantId: 'u-tenant' }));

  // The scope is the actor's own id, not something a caller supplied. Asserted
  // by construction: two different actors cannot produce the same scope.
  check('two actors never share a scope',
    JSON.stringify(scopeFor(landlord, OWNED)) !== JSON.stringify(scopeFor(tenant, OWNED)));

  // ── A region ──
  eq('a coordinator is scoped to their regions',
    JSON.stringify(scopeFor(coordinator, OWNED)),
    JSON.stringify({ region: { $in: ['banjul', 'kanifing'] } }));
  // A collection that records its supervisor directly is narrower and better.
  eq('and to themselves where the collection names a coordinator',
    JSON.stringify(scopeFor(coordinator, { owner: { field: 'landlordId', space: 'user' as const },
      coordinator: { field: 'coordinatorId', space: 'user' as const }, region: 'region' })),
    JSON.stringify({ coordinatorId: 'u-coord' }));

  // The case that makes failing closed matter. A coordinator is not a plain
  // owner, so a "no owner filter needed" reading hands them everything.
  check('a coordinator with no region sees nothing, not everything',
    !isUnrestricted(scopeFor(roamingCoord, OWNED)));
  eq('and specifically matches no document',
    JSON.stringify(scopeFor(roamingCoord, OWNED)), JSON.stringify(DENY_ALL));
  eq('an empty regions array is the same as none',
    JSON.stringify(scopeFor({ userId: 'u', roles: ['coordinator'], regions: [] }, OWNED)),
    JSON.stringify(DENY_ALL));

  // ── Everything else fails closed ──
  eq('a collection with no owner field denies rather than opens',
    JSON.stringify(scopeFor(landlord, {})), JSON.stringify(DENY_ALL));
  eq('an unknown role denies',
    JSON.stringify(scopeFor({ userId: 'u', roles: ['someNewRole'] }, {})),
    JSON.stringify(DENY_ALL));
  // No roles is not privileged — it falls through to own-records, which for
  // somebody holding nothing is an empty dashboard either way.
  eq('no roles at all is scoped to self, not to everything',
    JSON.stringify(scopeFor({ userId: 'u', roles: [] }, OWNED)),
    JSON.stringify({ landlordId: 'u' }));
  check('and is certainly not unrestricted',
    !isUnrestricted(scopeFor({ userId: 'u', roles: [] }, OWNED)));
  eq('a missing user id denies',
    JSON.stringify(scopeFor({ userId: '', roles: ['founder'] }, OWNED)),
    JSON.stringify(DENY_ALL));
  eq('a malformed roles list denies',
    JSON.stringify(scopeFor({ userId: 'u', roles: null as unknown as string[] }, OWNED)),
    JSON.stringify(DENY_ALL));

  // A privileged role arriving inside a list of ordinary ones still counts;
  // `.includes` on the wrong array would miss it.
  check('a privileged role anywhere in the list is honoured',
    isUnrestricted(scopeFor({ userId: 'u', roles: ['tenant', 'landlord', 'founder'] }, OWNED)));
  // And the reverse: an ordinary role alongside a regional one gets the
  // regional scope, which is the wider of the two they are entitled to.
  eq('a coordinator who is also a landlord is scoped regionally',
    JSON.stringify(scopeFor({ userId: 'u', roles: ['landlord', 'coordinator'], regions: ['banjul'] }, OWNED)),
    JSON.stringify({ region: { $in: ['banjul'] } }));

  // The returned scope must not alias the actor's own regions array — a
  // handler that mutated it would rewrite the token's meaning for later calls.
  const regions = ['banjul'];
  const scoped = scopeFor({ userId: 'u', roles: ['coordinator'], regions }, OWNED) as
    { region: { $in: string[] } };
  scoped.region.$in.push('everywhere');
  eq('the scope does not alias the actor\'s regions', regions.length, 1);

  // Likewise DENY_ALL and ALLOW_ALL are returned as copies, so a handler
  // spreading extra keys into one cannot widen the constant for every
  // subsequent request in the process.
  const denied = scopeFor(roamingCoord, OWNED);
  delete denied._id;
  eq('DENY_ALL is not handed out by reference', Object.keys(DENY_ALL).length, 1);

  // ── The parameter that must not exist ──
  // A `?owner=` or `?region=` would make each endpoint a directory of the
  // institution's holdings, queryable by anybody with a login, while looking
  // exactly like a feature. This reads the source rather than trusting review.
  const statsSrc = readFileSync(resolve(process.cwd(), 'src/modules/stats/index.ts'), 'utf8');
  for (const forbidden of ['req.query.owner', 'req.query.region', 'req.query.landlordId',
    'req.query.userId', 'req.query.tenantId', 'req.query.coordinatorId']) {
    check(`stats never reads ${forbidden}`, !statsSrc.includes(forbidden));
  }
  check('stats derives every scope from the token',
    statsSrc.includes('req.actor as Actor'));
  /* The rule itself must stay in `statsScope.ts`, which is Mongoose-free and
   * therefore assertable without a database. `stats/index.ts` may hold a thin
   * wrapper — it needs one, to resolve the caller's profile ids — but it must
   * not branch on roles or decide what "unrestricted" means. This checks the
   * intent rather than the old spelling: the previous version asserted that no
   * `function scopeMatch(` existed at all, which stopped being the right
   * question the moment the wrapper became necessary. */
  check('the local wrapper delegates rather than deciding',
    /return scopeFor\(actor, fields, await profileIdsFor\(actor\.userId\)\)/.test(statsSrc),
    'a second implementation of the scope rule is a second thing to get wrong');
  for (const reimplemented of ['UNSCOPED_ROLES', 'REGIONAL_ROLES', "_id: null"]) {
    check(`and does not reimplement ${reimplemented}`, !statsSrc.includes(reimplemented),
      'the rule lives in statsScope.ts because that is where it can be asserted');
  }
  // An inline `{}` where a scope belongs is the whole bug in two characters.

  // Every aggregation begins from a scope, and none is left unfiltered. Counted
  // rather than eyeballed: a sixth endpoint added without one fails here.
  const matchStages = statsSrc.match(/\$match/g) ?? [];
  const scopeCalls = statsSrc.match(/scopeMatch\(/g) ?? [];
  check('every $match in stats has a scope behind it',
    scopeCalls.length >= matchStages.length - 1,   // countByStatus holds one shared stage
    `${scopeCalls.length} scopes for ${matchStages.length} matches`);
}


// ═══════════════════════════════════════════════════════════════════════════
section('Signing out actually ends the session');

// Found by the browser-client parity check below, on its first run: the
// frontend called `POST /auth/logout` on every sign-out and the backend had no
// such route. The frontend swallowed the 404 and cleared local storage, so
// signing out looked like it worked — while the thirty-day refresh token stayed
// valid for anybody holding a copy.
//
// A control that is absent while appearing present is the worst kind to be
// missing, and nothing in 13,000 checks noticed, because every check was about
// what the backend does and this was about what the frontend asks for.
{
  const owner = { userId: 'u-owner', roles: ['tenant'] };
  const other = { userId: 'u-other', roles: ['landlord'] };
  const staff = { userId: 'u-bo', roles: ['backOfficeStaff'] };

  // ── Who may end whose session ──
  check('a person may end their own session', mayRevoke(owner, 'u-owner'));
  // A member holding a stranger's refresh token invalidating it would be a
  // denial of service dressed as a courtesy.
  check('but not a stranger\'s', !mayRevoke(other, 'u-owner'));
  check('Back Office may, as an administrative act', mayRevoke(staff, 'u-owner'));
  check('the founder may', mayRevoke({ userId: 'f', roles: ['founder'] }, 'u-owner'));
  check('a coordinator may not — they supervise vendors, not sessions',
    !mayRevoke({ userId: 'c', roles: ['coordinator'] }, 'u-owner'));
  check('an absent actor may not', !mayRevoke(null, 'u-owner'));
  check('an actor with no id may not', !mayRevoke({ userId: '', roles: ['founder'] }, 'u-owner'));
  check('and a token with no subject cannot be revoked', !mayRevoke(staff, null));
  check('a malformed roles list is not privileged',
    !mayRevoke({ userId: 'x', roles: null as unknown as string[] }, 'u-owner'));

  // ── The reasons are data, so the audit trail can tell them apart ──
  // A person signing out and staff ending their session have the same effect
  // and are very different facts.
  check('signing out is a recorded reason',
    (REVOCATION_REASONS as readonly string[]).includes('signOut'));
  check('and an administrative end is a different one',
    (REVOCATION_REASONS as readonly string[]).includes('administrative'));
  check('and the two are not the same value',
    REVOCATION_REASONS.indexOf('signOut') !== REVOCATION_REASONS.indexOf('administrative'));
  const dupReasons = (REVOCATION_REASONS as readonly string[])
    .filter((r, i, a) => a.indexOf(r) !== i);
  check('no reason is listed twice', dupReasons.length === 0, dupReasons.join(', '));
  // The store's enum is this list, so a reason added here without the schema
  // knowing would fail to save at runtime.
  const modelSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/auth/revokedToken.model.ts'), 'utf8');
  check('the store\'s enum is this list, not a copy of it',
    modelSrc.includes('enum: REVOCATION_REASONS'));
  // A revocation that outlives its token protects nothing and a denylist that
  // only grows becomes the reason signing in is slow later.
  check('and revocations are swept once their token has expired',
    /expireAfterSeconds:\s*0/.test(modelSrc) && modelSrc.includes('expiresAt'));
  check('one row per token, so signing out twice is not an error',
    /jti:.*unique:\s*true/.test(modelSrc));

  // ── The denylist answer ──
  check('a row means revoked', isRevoked({ jti: 'abc' }));
  check('no row means not revoked', !isRevoked(null));
  check('and undefined likewise', !isRevoked(undefined));

  // ── The expiry conversion, which is where this would silently rot ──
  // `exp` is seconds since the epoch. Read as milliseconds it lands in January
  // 1970, the TTL index deletes the row on its next sweep, and the revocation
  // quietly stops working — a security control that expires immediately and
  // reports nothing.
  const exp = 1_800_000_000;   // 2027-01-15, in seconds
  const when = revocationExpiry(exp);
  eq('a revocation expires with its token, in seconds not milliseconds',
    when?.getTime(), exp * 1000);
  check('and therefore lands in the future, not 1970',
    (when?.getUTCFullYear() ?? 0) > 2020, String(when?.toISOString()));
  eq('a missing expiry is null, not the epoch', revocationExpiry(undefined), null);
  eq('so is a zero', revocationExpiry(0), null);
  eq('so is a negative', revocationExpiry(-5), null);
  eq('so is NaN', revocationExpiry(NaN), null);
  eq('so is a string', revocationExpiry('1800000000' as unknown as number), null);

  // ── What the reply promises ──
  // Overstating this would be worse than the missing route: a person told they
  // are signed out everywhere, who is not, takes fewer precautions.
  const revoked = signOutOutcome(true);
  check('a sign-out that revoked says so', revoked.refreshRevoked);
  check('and reports success', revoked.signedOut);
  eq('and adds no caveat it does not need', revoked.note, undefined);

  const nothing = signOutOutcome(false);
  check('a sign-out with nothing to revoke still succeeds', nothing.signedOut);
  check('but does not claim to have revoked', !nothing.refreshRevoked);
  check('and says what remains valid', Boolean(nothing.note));
  check('naming the refresh token specifically',
    (nothing.note ?? '').includes('refresh token'));

  // ── The access token limitation is documented, not glossed ──
  const revSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/auth/revocation.ts'), 'utf8');
  check('the access-token window is written down in the rules',
    /access token is not/i.test(revSrc) && /expire/i.test(revSrc));

  const bpEntry = blueprint.find((ep) => ep.path === '/auth/logout');
  check('POST /auth/logout is in the contract', Boolean(bpEntry));
  eq('and it is authenticated', bpEntry?.auth, 'required');
  check('and its notes say the access token is not revoked',
    (bpEntry?.notes ?? '').includes('NOT revoked'),
    'a caller reading only the contract must not believe more was done than was');
  check('and point at changing the password for a stolen credential',
    /change the password/i.test(bpEntry?.notes ?? ''));

  // ── The refresh path consults the denylist ──
  // Without this read, everything above is bookkeeping: the token would still
  // be exchangeable for a fresh access token for thirty days.
  const svcSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/auth/auth.service.ts'), 'utf8');
  const refreshBody = svcSrc.slice(svcSrc.indexOf('export async function refresh'));
  const refreshOnly = refreshBody.slice(0, refreshBody.indexOf('\nexport '));
  check('refresh reads the denylist', refreshOnly.includes('RevokedToken.findOne'));
  check('and refuses a revoked token', refreshOnly.includes('isRevoked'));
  // The refusal must not confirm that a token was specifically revoked — that
  // tells whoever holds it both that the account exists and that somebody noticed.
  check('and refuses it in the same words as an expired one',
    refreshOnly.includes('Invalid or expired refresh token'));
  check('never disclosing that revocation is why',
    !/revoked'\)/.test(refreshOnly.replace(/logger[^\n]*\n/g, '')));

  // ── The token carries an id, or none of this is possible ──
  const authSrc = readFileSync(
    resolve(process.cwd(), 'src/middleware/authenticate.ts'), 'utf8');
  check('refresh tokens carry a session id', /jti:\s*randomUUID\(\)/.test(authSrc));
  // A guessable id would let somebody deny another person's session by writing
  // down ids until one matched.
  // `Math.random` appears in the comment explaining why it is not used, so the
  // check is for the *call*, not the word.
  check('and it is from node:crypto, not Math.random',
    authSrc.includes("from 'node:crypto'") && !/Math\.random\s*\(/.test(authSrc));
  check('and the expiry claim is read back out, for the TTL',
    /exp:\s*typeof claims\.exp/.test(authSrc));

  // ── The browser sends the token before clearing it ──
  // Clearing first and then calling logout with an empty body is the bug this
  // whole section is about, in a different file.
  const authJs = readFileSync(
    resolve(process.cwd(), '../frontend/assets/js/auth.js'), 'utf8');
  const signOutFn = authJs.slice(authJs.indexOf('signOut: function'));
  const signOutBody = signOutFn.slice(0, signOutFn.indexOf('\n    },'));
  const readAt = signOutBody.indexOf('load(REFRESH_KEY)');
  const clearAt = signOutBody.indexOf('store(REFRESH_KEY, null)');
  // Both must be *found*. `indexOf` returns -1 for absent, and -1 is less than
  // any real index — so an ordering check alone passes when the read is simply
  // not there, which is the exact bug being guarded against.
  check('the browser reads the refresh token during sign-out', readAt >= 0,
    'nothing reads the stored refresh token, so the server is told nothing');
  check('and sends it in the body', signOutBody.includes('refreshToken: refresh'));
  check('and clears it afterwards', clearAt >= 0);
  check('reading before clearing',
    readAt >= 0 && clearAt >= 0 && readAt < clearAt,
    'storage is cleared before the token is sent — the server learns nothing');
  check('and still clears locally even if the call fails',
    signOutBody.includes('.catch(') && signOutBody.includes('store(TOKEN_KEY, null)'));
}


// ═══════════════════════════════════════════════════════════════════════════
section('The browser client names paths the backend serves');

// `frontend/assets/js/sdk.js` is the only thing in the frontend that calls
// `fetch`, so every request the platform makes from a browser is a string
// literal in that one file. Nothing was checking those strings against the
// contract. A typo, or a path renamed on the backend, produces a 404 at the
// moment a member clicks — not at build, not in this suite, and not on any
// page nobody happened to open during review.
//
// The generated npm SDK cannot drift, because it is generated. This file is
// hand-written, which is exactly why it needs the check.
{
  const clientSrc = readFileSync(
    resolve(process.cwd(), '../frontend/assets/js/sdk.js'), 'utf8');

  // Paths appear two ways: whole (`get('/auth/me')`) and built from segments
  // (`get('/property/' + seg(id))`). Normalise both to a template the contract
  // can be searched for.
  // A whole path is one whose closing quote is *not* followed by `+`; that
  // trailing plus is what makes a call segment-built, and matching it here
  // would report every parameterised prefix as a missing endpoint.
  const literals = [...clientSrc.matchAll(/(?:get|post|patch|del|request)\(\s*'(\/[^']*)'(?!\s*\+)/g)]
    .map((m) => m[1]!);
  const built = [...clientSrc.matchAll(/'(\/[^']*\/)'\s*\+\s*seg\(/g)]
    .map((m) => m[1]!);

  const blueprintPaths = new Set(blueprint.map((ep) => ep.path));
  // A contract path with parameters, reduced to its literal prefix, so a
  // segment-built call can be matched against it.
  const prefixes = new Set(
    blueprint
      .filter((ep) => ep.path.includes(':'))
      .map((ep) => ep.path.slice(0, ep.path.indexOf(':'))),
  );

  check('the browser client makes calls at all', literals.length + built.length > 40,
    `${literals.length} whole + ${built.length} built`);

  for (const p of literals) {
    check(`browser client path ${p} is in the contract`, blueprintPaths.has(p));
  }
  for (const p of built) {
    check(`browser client path ${p}:id is in the contract`, prefixes.has(p),
      'no contract endpoint takes a parameter after this prefix');
  }

  // The stats surface specifically — the reason this section exists today. Each
  // of the five must be reachable from a page, or the tiles fall back to
  // counting a list again and the whole exercise was for nothing.
  for (const name of ['properties', 'payments', 'maintenance', 'applications', 'ususu']) {
    check(`the browser client can reach /stats/${name}`,
      literals.includes(`/stats/${name}`));
    check(`and the contract serves it`, blueprintPaths.has(`/stats/${name}`));
  }

  // And the parameter that must not exist cannot be smuggled in from the
  // browser side either: these take no query object.
  check('the browser stats bindings pass no parameters',
    !/\/stats\/\w+'\s*,\s*\w/.test(clientSrc),
    'a stats binding forwards a query object — scope must come from the token');
}


// ═══════════════════════════════════════════════════════════════════════════
section('Payments: recording money somebody handed over');

// The ledger's one write route. Everything that makes it safe is here, because
// the alternative is trusting that nobody widens it later without noticing.
{
  const coordinator = { userId: 'u-coord', roles: ['coordinator'] };
  const backOffice = { userId: 'u-bo', roles: ['backOfficeStaff'] };
  const tenant = { userId: 'u-tenant', roles: ['tenant'] };
  const landlord = { userId: 'u-landlord', roles: ['landlord'] };

  const good = {
    payer: 'u-tenant', kind: 'rent', method: 'cash', amount: 5000,
    subject: 'lease-1', paidAt: '2026-07-01T10:00:00.000Z',
  };

  eq('a coordinator recording a tenant\'s cash rent is accepted',
    recordingProblems(coordinator, good).length, 0);
  eq('and so is Back Office', recordingProblems(backOffice, good).length, 0);

  check('a tenant cannot record payments', !mayRecord(tenant));
  check('nor a landlord', !mayRecord(landlord));
  check('a coordinator can', mayRecord(coordinator));
  check('an actor with no roles array cannot',
    !mayRecord({ userId: 'x', roles: null as unknown as string[] }));

  const codesFor = (actor: unknown, input: unknown) =>
    recordingProblems(actor as never, input as never).map((p) => p.code);

  check('a tenant is refused', codesFor(tenant, good).includes('not-permitted'));
  check('an unidentified actor is refused',
    codesFor(null, good).includes('unidentified'));

  // ── The self-dealing rule ──
  // Same principle as "nobody produces evidence about themselves". A
  // coordinator writing down that they received the rent is not a record, it is
  // an assertion, and it is the one assertion nobody else can check.
  check('nobody records a payment they made',
    codesFor(coordinator, { ...good, payer: 'u-coord' }).includes('self-dealing'));
  check('nor one made to them',
    codesFor(coordinator, { ...good, payee: 'u-coord' }).includes('self-dealing'));
  eq('but a colleague\'s is fine',
    recordingProblems(coordinator, { ...good, payer: 'u-someone' }).length, 0);

  // ── Only money coming in ──
  // A hand-written payout would mark money as sent that was never sent, and the
  // recipient's own ledger would agree with the person who wrote it.
  for (const kind of ['landlordPayout', 'driverPayout', 'refund', 'adSpend', 'ride']) {
    check(`a ${kind} cannot be recorded by hand`,
      codesFor(coordinator, { ...good, kind }).includes('not-recordable'));
  }
  for (const kind of RECORDABLE_KINDS) {
    eq(`a ${kind} can`, recordingProblems(coordinator, { ...good, kind }).length, 0);
  }
  check('and a missing kind is asked for',
    codesFor(coordinator, { ...good, kind: null }).includes('required'));

  // ── The instrument ──
  check('a card payment is not recordable by hand',
    codesFor(coordinator, { ...good, method: 'card' }).includes('not-recordable'),
    'a card payment with no provider reference is a mistake or a cover for one');
  for (const method of RECORDABLE_METHODS) {
    eq(`${method} is`, recordingProblems(coordinator, { ...good, method }).length, 0);
  }

  // ── The amount ──
  check('an amount is required',
    codesFor(coordinator, { ...good, amount: null }).includes('required'));
  check('zero is not an amount',
    codesFor(coordinator, { ...good, amount: 0 }).includes('required'));
  check('nor is a negative one',
    codesFor(coordinator, { ...good, amount: -100 }).includes('required'));
  check('nor NaN', codesFor(coordinator, { ...good, amount: NaN }).includes('required'));
  // A typo control, not a security control: `1000000` for `10000` is one
  // keystroke, and a ceiling turns it into a refusal at the point of entry.
  check('a receipt above the ceiling needs Back Office',
    codesFor(coordinator, { ...good, amount: MAX_RECORDED_AMOUNT + 1 }).includes('too-large'));
  eq('and the ceiling itself is allowed',
    recordingProblems(coordinator, { ...good, amount: MAX_RECORDED_AMOUNT }).length, 0);

  // ── A payment cannot have happened tomorrow ──
  const noon = Date.parse('2026-07-01T12:00:00.000Z');
  eq('a receipt dated now is not future-dated',
    futureDatedBy('2026-07-01T12:00:00.000Z', noon), 0);
  eq('nor is one from this morning',
    futureDatedBy('2026-07-01T09:00:00.000Z', noon), 0);
  // A phone whose clock is four minutes fast is extremely common and is not
  // somebody backdating anything.
  eq('a phone clock a few minutes fast is tolerated',
    futureDatedBy('2026-07-01T12:05:00.000Z', noon), 0);
  check('but tomorrow is refused',
    futureDatedBy('2026-07-02T12:00:00.000Z', noon) > 0,
    'a receipt dated in the future is a promise, and it would sort to the top of a history');
  eq('and no date at all is not future-dated', futureDatedBy(null, noon), 0);

  // ── Idempotency ──
  // Two taps on a bad connection must not double a tenant's rent.
  const a = receiptReference(good);
  const b = receiptReference({ ...good, paidAt: '2026-07-01T10:01:30.000Z' });
  eq('a retry ninety seconds later collides with the first receipt', a, b);
  check('a different amount does not',
    receiptReference({ ...good, amount: 5001 }) !== a);
  check('nor a different payer',
    receiptReference({ ...good, payer: 'u-other' }) !== a);
  check('nor a different lease',
    receiptReference({ ...good, subject: 'lease-2' }) !== a);
  check('nor the next day',
    receiptReference({ ...good, paidAt: '2026-07-02T10:00:00.000Z' }) !== a);
  eq('the day key is the calendar day', dayKey('2026-07-01T23:30:00.000Z'), '20260701');
  eq('a missing date has its own key', dayKey(null), 'NODATE');

  // ── UTC, asserted at the source rather than by behaviour ──
  //
  // This one cannot be caught by calling the function: every machine that runs
  // this suite is set to UTC, so `getHours()` and `getUTCHours()` agree and a
  // mutation swapping them passes every behavioural test. It would still be a
  // real bug — a receipt written by a server in one zone and retried against a
  // server in another would produce two different references and double a
  // tenant's rent, which is the exact failure the reference exists to prevent.
  //
  // So the check reads the source. A test that cannot fail is worse than no
  // test, and pretending a UTC-only environment proves timezone-independence is
  // how that happens.
  {
    const rulesSrc = readFileSync(
      resolve(process.cwd(), 'src/modules/payment/paymentRules.ts'), 'utf8');
    const dayKeyBody = rulesSrc.slice(rulesSrc.indexOf('export function dayKey'));
    const body = dayKeyBody.slice(0, dayKeyBody.indexOf('\n}'));
    check('the day key reads UTC calendar fields',
      /getUTCFullYear/.test(body) && /getUTCMonth/.test(body) && /getUTCDate/.test(body));
    check('and never local ones',
      !/\.getFullYear\(|\.getMonth\(|\.getDate\(/.test(body),
      'a receipt must not change identity with the server\'s timezone');
  }

  // ── Who may read whose ──
  // The interesting line: a coordinator may WRITE a receipt and may not READ a
  // year of somebody's finances. Recording and reading are different powers.
  eq('a person sees their own history in full',
    historyScope(tenant, 'u-tenant'), 'all');
  eq('Back Office sees anyone\'s', historyScope(backOffice, 'u-tenant'), 'all');
  eq('the founder too', historyScope({ userId: 'f', roles: ['founder'] }, 'u-tenant'), 'all');
  eq('a coordinator sees only what they recorded',
    historyScope(coordinator, 'u-tenant'), 'recordedByMe');
  eq('a landlord sees nothing of a tenant\'s ledger',
    historyScope(landlord, 'u-tenant'), 'none');
  eq('a stranger sees nothing', historyScope(tenant, 'u-someone-else'), 'none');
  eq('an unidentified caller sees nothing', historyScope(null, 'u-tenant'), 'none');
  eq('and a missing subject is nothing, not everything',
    historyScope(backOffice, null), 'none');
}

// ── The summary, and the two reliability figures ───────────────────────────
{
  const due = '2026-07-01T00:00:00.000Z';
  const onTime = '2026-07-02T00:00:00.000Z';
  const veryLate = '2026-07-20T00:00:00.000Z';

  const s = summarisePayments([
    { status: 'succeeded', amount: 5000, currency: 'GMD', dueDate: due, paidAt: onTime },
    { status: 'succeeded', amount: 5000, currency: 'GMD', dueDate: due, paidAt: veryLate },
    { status: 'succeeded', amount: 5000, currency: 'GMD', dueDate: due, paidAt: onTime },
    { status: 'failed', amount: 5000 },
    { status: 'pending', amount: 5000 },
  ]);

  eq('every row is counted', s.total, 5);
  eq('settled counts only what moved', s.settled, 3);
  eq('on time is measured against the due date', s.onTime, 2);
  eq('and late is the rest of what settled', s.late, 1);
  eq('a failed attempt is counted as failed', s.failed, 1);
  eq('and an instalment not yet due is awaiting', s.awaiting, 1);
  eq('the on-time rate is of what settled', s.onTimeRate, 66.7);

  // The null. `onTime / 0` is NaN, NaN renders "NaN%", and a caller who
  // "fixed" that with a 0 would be telling somebody on their first day that
  // none of their payments were on time.
  eq('a rate over nothing settled is null', onTimeRateFrom(0, 0), null);
  eq('and over an empty ledger too', summarisePayments([]).onTimeRate, null);
  eq('but all-on-time is 100', onTimeRateFrom(4, 0), 100);
  eq('and all-late is 0, which is a real statement', onTimeRateFrom(0, 4), 0);
  eq('negative counts floor at zero', onTimeRateFrom(-1, 2), 0);
  eq('NaN in is null out', onTimeRateFrom(NaN, NaN), null);

  // Deliberately mirrors the evidence gatherer: a payment with no due date on
  // record cannot be late, because holding a gap in LRMC's own data against a
  // tenant is what this whole engine exists to avoid.
  check('a payment with no due date is not late',
    !isLate({ status: 'succeeded', paidAt: onTime }));
  check('nor one with no paid date', !isLate({ status: 'succeeded', dueDate: due }));
  check('inside the grace period is on time',
    !isLate({ status: 'succeeded', dueDate: due, paidAt: '2026-07-03T00:00:00.000Z' }));
  check('and beyond it is late',
    isLate({ status: 'succeeded', dueDate: due, paidAt: '2026-07-05T00:00:00.000Z' }));
  // Same constant, two modules, asserted equal — a payments page and an
  // assessment disagreeing about what "late" means is a tenant being told two
  // different things about the same instalment.
  eq('the grace period matches the evidence gatherer\'s',
    PAYMENT_LATE_AFTER_DAYS, LATE_AFTER_DAYS);

  // ── The two figures differ on purpose ──
  // A tenant who paid three and skipped seven is not 100% reliable, and the
  // scoring engine must not be told they are. But a payments *page* showing the
  // same person 100% "paid on time" is also correct — of what settled, all of
  // it was. The numbers are different and the labels must be too.
  eq('the display figure ignores missed instalments', onTimeRateFrom(3, 0), 100);
  eq('the evidence figure does not', paymentReliabilityFrom(3, 0, 7), 30);
  check('so the two are genuinely different numbers',
    onTimeRateFrom(3, 0) !== paymentReliabilityFrom(3, 0, 7));
  // Guarded in the contract too, so a reader of the spec alone is warned.
  const summaryEp = blueprint.find((e) => e.path === '/payments/:userId/summary');
  check('and the contract says so',
    /not the same figure as .paymentReliability/.test(summaryEp?.notes ?? ''),
    'two reliability numbers with the same label is a support ticket nobody can settle');

  // ── Currencies are never summed ──
  const multi = summarisePayments([
    { status: 'succeeded', amount: 1000, currency: 'GMD' },
    { status: 'succeeded', amount: 500, currency: 'GMD' },
    { status: 'succeeded', amount: 40, currency: 'USD' },
  ]);
  eq('settled money is grouped by currency', multi.settledByCurrency.length, 2);
  eq('the largest first', multi.settledByCurrency[0]?.currency, 'GMD');
  eq('and summed within a currency', multi.settledByCurrency[0]?.amount, 1500);
  eq('never across', multi.settledByCurrency[1]?.amount, 40);
  eq('a row with no currency falls to the launch currency',
    summarisePayments([{ status: 'succeeded', amount: 10 }]).settledByCurrency[0]?.currency, 'GMD');
  // A negative amount in the ledger would otherwise silently reduce a total.
  eq('a negative amount cannot reduce a settled total',
    summarisePayments([
      { status: 'succeeded', amount: 100 }, { status: 'succeeded', amount: -100 },
    ]).settledByCurrency[0]?.amount, 100);

  // Every ledger status must be classified, or the summary's parts stop adding
  // up to `total` and the first person to notice stops trusting the screen.
  const orphans = unclassifiedStatuses();
  check('every ledger status is classified by the summary',
    orphans.length === 0, orphans.join(', '));
}


// ═══════════════════════════════════════════════════════════════════════════
section('Maintenance: what may follow what, and who may make it');

{
  const tenant = { userId: 'u-tenant', roles: ['tenant'] };
  const vendor = { userId: 'u-vendor', roles: ['vendor'] };
  const coordinator = { userId: 'u-coord', roles: ['coordinator'] };
  const backOffice = { userId: 'u-bo', roles: ['backOfficeStaff'] };
  const stranger = { userId: 'u-nobody', roles: ['tenant'] };

  const job = { raisedByUser: 'u-tenant', vendorUser: 'u-vendor' };

  // ── The table ──
  check('every status is in the transition table',
    MAINTENANCE_STATUSES.every((s) => Array.isArray(MAINTENANCE_TRANSITIONS[s])));
  const invented = Object.values(MAINTENANCE_TRANSITIONS).flat()
    .filter((s) => !(MAINTENANCE_STATUSES as readonly string[]).includes(s));
  check('and the table names no status the model lacks',
    invented.length === 0, invented.join(', '));

  // Rule 1: verification means LRMC saying the work was done. Verifying
  // something nobody has reported finishing is a signature on an empty page.
  const intoVerified = MAINTENANCE_STATUSES
    .filter((s) => (MAINTENANCE_TRANSITIONS[s] as readonly string[]).includes('verified'));
  eq('nothing reaches verified except from completed',
    intoVerified.join(','), 'completed');

  // Rule 2 and 3: the terminal states are terminal. Reopening a verified job
  // silently rewrites its resolution time, its SLA record and the vendor's
  // completion rate.
  eq('verified is terminal', MAINTENANCE_TRANSITIONS.verified.length, 0);
  eq('and cancelled is terminal', MAINTENANCE_TRANSITIONS.cancelled.length, 0);

  // Cancellation is only available while the work has not been done. Once a
  // vendor has reported finishing, the outcomes are "LRMC agrees" (`verified`)
  // or "LRMC does not" (back to `inProgress`) — cancelling at that point would
  // erase the fact that work happened, taking it out of the vendor's completion
  // record and out of any invoice anybody could argue about.
  const cancellable = MAINTENANCE_STATUSES
    .filter((s) => (MAINTENANCE_TRANSITIONS[s] as readonly string[]).includes('cancelled'));
  check('finished work cannot be cancelled away',
    !cancellable.includes('completed') && !cancellable.includes('verified'),
    cancellable.join(', '));
  check('but anything still in flight can be',
    ['open', 'triaged', 'assigned', 'onHold'].every((s) => cancellable.includes(s as never)));

  // Rule 4: a quote has to be approved by somebody who is not the vendor who
  // wrote it, so work cannot start straight off a quote.
  check('work cannot start straight from a quote',
    !canTransitionMaintenance('quoted', 'assigned')
    && !canTransitionMaintenance('quoted', 'inProgress'));
  check('but it can once approved', canTransitionMaintenance('approved', 'assigned'));

  // Rule 5: a job parked for three weeks is re-examined, not resumed on
  // assumptions that have expired.
  eq('on hold returns only to triage or cancellation',
    [...MAINTENANCE_TRANSITIONS.onHold].sort().join(','), 'cancelled,triaged');

  check('an unknown status transitions nowhere',
    !canTransitionMaintenance('somethingNew', 'open'));
  check('and nothing transitions to an unknown one',
    !canTransitionMaintenance('open', 'somethingNew'));

  // ── Who is who ──
  eq('the tenant who raised it is the raiser', partyFor(tenant, job), 'raiser');
  eq('the assigned vendor is the vendor', partyFor(vendor, job), 'vendor');
  eq('a coordinator is staff', partyFor(coordinator, job), 'staff');
  eq('Back Office is staff', partyFor(backOffice, job), 'staff');
  eq('anybody else is nobody', partyFor(stranger, job), 'none');
  eq('an unidentified actor is nobody', partyFor(null, job), 'none');
  // A coordinator who also raised the request acts with the wider hand; the
  // narrower one would be a surprise.
  eq('staff wins over raiser',
    partyFor({ userId: 'u-coord', roles: ['coordinator'] },
      { raisedByUser: 'u-coord', vendorUser: null }), 'staff');

  const codes = (actor: unknown, req: unknown, attempt: unknown) =>
    updateProblems(actor as never, req as never, attempt as never).map((p) => p.code);

  // ── What each party may do ──
  eq('a vendor may start work',
    updateProblems(vendor, { status: 'assigned', ...job },
      { from: 'assigned', to: 'inProgress' }).length, 0);
  eq('and report finishing',
    updateProblems(vendor, { status: 'inProgress', ...job },
      { from: 'inProgress', to: 'completed' }).length, 0);
  // A vendor cancelling their own assignment removes it from every queue that
  // would have chased them for it.
  check('a vendor may not cancel the job',
    codes(vendor, { status: 'assigned', ...job },
      { from: 'assigned', to: 'cancelled', note: 'busy' }).includes('not-yours'));
  check('nor verify their own work',
    codes(vendor, { status: 'completed', ...job },
      { from: 'completed', to: 'verified' }).includes('not-yours'));

  // The belt-and-braces case: a vendor who also holds a staff role would pass
  // the party check. "I did it and I checked it" is not a check.
  check('and a vendor with a staff role still cannot verify their own work',
    codes({ userId: 'u-vendor', roles: ['coordinator'] }, { status: 'completed', ...job },
      { from: 'completed', to: 'verified' }).includes('self-verification'));
  eq('while a different person verifying it is fine',
    updateProblems(coordinator, { status: 'completed', ...job },
      { from: 'completed', to: 'verified' }).length, 0);

  check('a tenant may withdraw their own request',
    !codes(tenant, { status: 'open', ...job },
      { from: 'open', to: 'cancelled', note: 'Fixed it myself' }).includes('not-yours'));
  check('but may not mark it done',
    codes(tenant, { status: 'inProgress', ...job },
      { from: 'inProgress', to: 'completed' }).includes('not-yours'));
  check('and a stranger may do nothing at all',
    codes(stranger, { status: 'open', ...job },
      { from: 'open', to: 'cancelled', note: 'x' }).includes('not-a-party'));

  // ── Reasons ──
  // "Your request was cancelled" with nothing after it is how people stop
  // reporting things.
  check('cancelling needs a reason',
    codes(coordinator, { status: 'open', ...job },
      { from: 'open', to: 'cancelled' }).includes('reason-required'));
  check('parking needs a reason',
    codes(coordinator, { status: 'assigned', ...job },
      { from: 'assigned', to: 'onHold' }).includes('reason-required'));
  check('whitespace is not a reason',
    codes(coordinator, { status: 'open', ...job },
      { from: 'open', to: 'cancelled', note: '   ' }).includes('reason-required'));
  // Deliberately not required for ordinary work, because demanding a paragraph
  // is how a form stops being filled in on a phone in a compound.
  eq('but starting work does not',
    updateProblems(vendor, { status: 'assigned', ...job },
      { from: 'assigned', to: 'inProgress' }).length, 0);
  // Sending a job back is LRMC telling a vendor the work was not done.
  check('and reopening a completed job does',
    codes(coordinator, { status: 'completed', ...job },
      { from: 'completed', to: 'inProgress' }).includes('reason-required'));

  check('a no-op change is refused rather than written',
    codes(coordinator, { status: 'open', ...job },
      { from: 'open', to: 'open' }).includes('no-change'));
  check('and an unreachable one is named',
    codes(coordinator, { status: 'open', ...job },
      { from: 'open', to: 'verified' }).includes('not-reachable'));

  // ── Escalation ──
  // Computed, never stored: a request does not become escalated, it becomes
  // somebody's, and a stored flag goes stale the moment a vendor picks it up.
  check('an unassigned emergency escalates',
    shouldEscalate({ status: 'open', priority: 'emergency' }).escalate);
  check('but an emergency somebody is working on does not',
    !shouldEscalate({ status: 'inProgress', priority: 'emergency' }).escalate);
  check('a breached SLA escalates',
    shouldEscalate({ status: 'assigned', priority: 'normal', slaState: 'breached' }).escalate);
  check('and an overdue one',
    shouldEscalate({ status: 'assigned', priority: 'normal', slaState: 'overdue' }).escalate);
  check('an on-track job does not',
    !shouldEscalate({ status: 'assigned', priority: 'normal', slaState: 'onTrack' }).escalate);
  check('a job parked past three days escalates',
    shouldEscalate({ status: 'onHold', priority: 'normal',
      hoursSinceStatusChange: ON_HOLD_ESCALATION_HOURS + 1 }).escalate);
  check('but one parked this morning does not',
    !shouldEscalate({ status: 'onHold', priority: 'normal', hoursSinceStatusChange: 4 }).escalate);
  // A closed request is nobody's problem, whatever its history says.
  check('a verified job never escalates',
    !shouldEscalate({ status: 'verified', priority: 'emergency', slaState: 'breached' }).escalate);
  check('nor a cancelled one',
    !shouldEscalate({ status: 'cancelled', priority: 'emergency', slaState: 'overdue' }).escalate);
  check('an escalation always says why',
    Boolean(shouldEscalate({ status: 'open', priority: 'emergency' }).reason));

  // ── The summary and the dashboard cannot disagree ──
  // Both bucket the same ten statuses. If they used different tables, a tile
  // reading 12 open and a page listing 9 would both be "right".
  const unbucketed = unplaced(MAINTENANCE_BUCKETS, MAINTENANCE_STATUSES);
  check('every maintenance status has a dashboard bucket',
    unbucketed.length === 0, unbucketed.join(', '));
  const maintSummary = blueprint.find((e) => e.path === '/maintenance/:userId/summary');
  check('and the summary says it uses the same ones',
    /same buckets as \/stats\/maintenance/.test(maintSummary?.notes ?? ''));
}


// ═══════════════════════════════════════════════════════════════════════════
section('Leases: the lifecycle, and who may move it');

{
  const landlord = { userId: 'u-landlord', roles: ['landlord'] };
  const tenant = { userId: 'u-tenant', roles: ['tenant'] };
  const coordinator = { userId: 'u-coord', roles: ['coordinator'] };
  const backOffice = { userId: 'u-bo', roles: ['backOfficeStaff'] };
  const stranger = { userId: 'u-nobody', roles: ['landlord'] };

  const lease = { landlordUser: 'u-landlord', tenantUser: 'u-tenant', coordinatorUser: 'u-coord' };
  const codes = (actor: unknown, l: unknown, attempt: unknown) =>
    transitionProblems(actor as never, l as never, attempt as never).map((p) => p.code);

  // ── The table ──
  check('every lease status is in the transition table',
    LEASE_STATUSES.every((s) => Array.isArray(LEASE_TRANSITIONS[s])));
  const invented = Object.values(LEASE_TRANSITIONS).flat()
    .filter((s) => !(LEASE_STATUSES as readonly string[]).includes(s));
  check('and the table names no status the model lacks', invented.length === 0, invented.join(', '));

  // The four the brief named, and they are the four a person actually moves.
  check('a draft can be activated', canTransitionLease('draft', 'active'));
  check('an active lease can be completed', canTransitionLease('active', 'completed'));
  check('an active lease can be terminated', canTransitionLease('active', 'terminated'));

  // Terminal means terminal. Reopening a completed lease would silently rewrite
  // the tenancy length that feeds an applicant's stability score — a renewal is
  // a new lease, not a resurrection.
  eq('a completed lease is terminal', LEASE_TRANSITIONS.completed.length, 0);
  eq('and a terminated one is terminal', LEASE_TRANSITIONS.terminated.length, 0);
  check('so a terminated lease can never become active again',
    !canTransitionLease('terminated', 'active'),
    'it would reappear in a rent run, chasing money from somebody who moved out');

  // `inArrears` and `expiring` are derived, so nothing transitions *to* them —
  // a stored flag would go stale the moment a payment landed.
  for (const derived of ['inArrears', 'expiring'] as const) {
    const into = LEASE_STATUSES
      .filter((s) => (LEASE_TRANSITIONS[s] as readonly string[]).includes(derived));
    eq(`nothing transitions to ${derived}`, into.length, 0);
    // But a tenancy in either is still running and must be closeable, or
    // arrears would trap both parties in a lease neither can leave.
    check(`though a ${derived} lease can still be completed`,
      canTransitionLease(derived, 'completed'));
    check(`and terminated`, canTransitionLease(derived, 'terminated'));
  }

  check('an unknown status transitions nowhere', !canTransitionLease('somethingNew', 'active'));
  check('and nothing transitions to an unknown one', !canTransitionLease('active', 'somethingNew'));

  // ── Who is who ──
  eq('the landlord is the landlord', leasePartyFor(landlord, lease), 'landlord');
  eq('the tenant is the tenant', leasePartyFor(tenant, lease), 'tenant');
  eq('a coordinator is a coordinator', leasePartyFor(coordinator, lease), 'coordinator');
  eq('Back Office is staff', leasePartyFor(backOffice, lease), 'staff');
  eq('another landlord is nobody', leasePartyFor(stranger, lease), 'none');
  eq('an unidentified actor is nobody', leasePartyFor(null, lease), 'none');
  eq('a malformed roles list is nobody',
    leasePartyFor({ userId: 'u', roles: null as unknown as string[] }, lease), 'none');
  // A coordinator who also owns the property acts with the wider hand.
  eq('a coordinator who is also the landlord acts as a coordinator',
    leasePartyFor({ userId: 'u-landlord', roles: ['landlord', 'coordinator'] }, lease), 'coordinator');

  // ── The asymmetry, which is the point of the module ──
  eq('a landlord activates their own lease',
    transitionProblems(landlord, { status: 'draft', ...lease },
      { from: 'draft', to: 'active' }).length, 0);
  eq('and completes it',
    transitionProblems(landlord, { status: 'active', ...lease },
      { from: 'active', to: 'completed' }).length, 0);

  // Ending a tenancy early is eviction by another name. LRMC carries the
  // tenancy, holds the deposit and answers for the outcome — the same principle
  // as a landlord not approving their own applicant.
  check('a landlord may NOT terminate',
    codes(landlord, { status: 'active', ...lease },
      { from: 'active', to: 'terminated', reason: 'Rent unpaid' }).includes('not-yours'));
  // And is told what to do instead, rather than given a bare refusal.
  const refusal = transitionProblems(landlord, { status: 'active', ...lease },
    { from: 'active', to: 'terminated', reason: 'x' })[0];
  check('and is told to ask their coordinator',
    /coordinator/i.test(refusal?.message ?? ''), refusal?.message);

  eq('a coordinator terminates',
    transitionProblems(coordinator, { status: 'active', ...lease },
      { from: 'active', to: 'terminated', reason: 'Property sold' }).length, 0);
  // Activation is the landlord's — it is their property and their commitment.
  check('but a coordinator does not activate',
    codes(coordinator, { status: 'draft', ...lease },
      { from: 'draft', to: 'active' }).includes('not-yours'));

  // ── A tenant moves nothing ──
  // A lifecycle a tenant could move is one where "I ended my own lease" and
  // "my landlord ended it" are indistinguishable afterwards.
  for (const target of ['active', 'completed', 'terminated'] as const) {
    check(`a tenant cannot set ${target}`,
      codes(tenant, { status: 'active', ...lease },
        { from: 'active', to: target, reason: 'because' }).includes('not-yours')
      || codes(tenant, { status: 'active', ...lease },
        { from: 'active', to: target, reason: 'because' }).includes('no-change'));
  }
  eq('a tenant may make no transition at all', TRANSITIONS_BY_PARTY.tenant.length, 0);
  const tenantRefusal = transitionProblems(tenant, { status: 'active', ...lease },
    { from: 'active', to: 'terminated', reason: 'x' })[0];
  check('and is pointed at a dispute instead',
    /dispute/i.test(tenantRefusal?.message ?? ''), tenantRefusal?.message);

  check('somebody who is no party at all is refused first',
    codes(stranger, { status: 'active', ...lease },
      { from: 'active', to: 'completed' }).includes('not-a-party'));

  // ── Reasons ──
  check('terminating needs a reason',
    codes(coordinator, { status: 'active', ...lease },
      { from: 'active', to: 'terminated' }).includes('reason-required'));
  check('and whitespace is not a reason',
    codes(coordinator, { status: 'active', ...lease },
      { from: 'active', to: 'terminated', reason: '   ' }).includes('reason-required'));
  // Deliberately not required to complete: a tenancy that ran its term needs no
  // explanation, and demanding one is how a form stops being filled in.
  eq('but completing does not',
    transitionProblems(landlord, { status: 'active', ...lease },
      { from: 'active', to: 'completed' }).length, 0);

  check('a no-op is refused rather than written',
    codes(landlord, { status: 'active', ...lease },
      { from: 'active', to: 'active' }).includes('no-change'));
  check('and an unreachable move is named',
    codes(backOffice, { status: 'completed', ...lease },
      { from: 'completed', to: 'active' }).includes('not-reachable'));
}

// ── Creating one ───────────────────────────────────────────────────────────
{
  const landlord = { userId: 'u-landlord', roles: ['landlord'] };
  const tenant = { userId: 'u-tenant', roles: ['tenant'] };
  const coordinator = { userId: 'u-coord', roles: ['coordinator'] };

  const good = {
    property: 'p1', tenant: 'u-tenant', landlord: 'u-landlord',
    monthlyRent: 12_000, leaseStart: '2026-09-01T00:00:00.000Z',
    leaseEnd: '2027-08-31T00:00:00.000Z',
  };
  const codes = (actor: unknown, draft: unknown) =>
    creationProblems(actor as never, draft as never).map((p) => p.code);

  eq('a landlord may draw up a lease', creationProblems(landlord, good).length, 0);
  eq('so may a coordinator', creationProblems(coordinator, good).length, 0);
  check('a tenant may not', codes(tenant, good).includes('not-permitted'));
  check('nor an unidentified caller', codes(null, good).includes('unidentified'));
  check('a tenant is not a creator', !mayCreate(tenant));
  check('a landlord is', mayCreate(landlord));

  // ── Nobody manufactures a tenancy history for themselves ──
  // The same principle as nobody producing evidence about themselves. Without
  // this, the fastest route to a perfect stability score is to be a landlord.
  /* Checked through a *third party*, deliberately. Asserting it as the landlord
   * themselves would also trip the "nobody names themselves" rule below, and
   * either check alone would satisfy the assertion — so removing one of them
   * would pass. This is a coordinator drawing up a lease where the tenant and
   * the landlord are the same stranger. */
  check('a landlord cannot be their own tenant',
    codes(coordinator, { ...good, tenant: 'u-someone', landlord: 'u-someone' })
      .includes('self-tenancy'));
  check('and nobody names themselves as the tenant',
    codes(coordinator, { ...good, tenant: 'u-coord', landlord: 'u-other' })
      .includes('self-tenancy'));

  check('a property is required', codes(landlord, { ...good, property: null }).includes('required'));
  check('a tenant is required', codes(landlord, { ...good, tenant: null }).includes('required'));

  check('rent is required', codes(landlord, { ...good, monthlyRent: null }).includes('required'));
  check('zero rent is not a rent', codes(landlord, { ...good, monthlyRent: 0 }).includes('required'));
  check('nor a negative one', codes(landlord, { ...good, monthlyRent: -5 }).includes('required'));
  check('a rent above the ceiling needs Back Office',
    codes(landlord, { ...good, monthlyRent: MAX_MONTHLY_RENT + 1 }).includes('too-large'));

  // ── Dates ──
  check('a start date is required', codes(landlord, { ...good, leaseStart: null }).includes('required'));
  check('an end before the start is refused',
    codes(landlord, { ...good, leaseEnd: '2026-08-01T00:00:00.000Z' }).includes('before-start'));
  check('and an end equal to the start is refused too',
    codes(landlord, { ...good, leaseEnd: good.leaseStart }).includes('before-start'),
    'a zero-day tenancy is not a tenancy');
  // Month-to-month is ordinary here. A required end date forces whoever writes
  // the lease to invent one, which then looks like a commitment.
  eq('but an absent end date is a month-to-month tenancy, not an error',
    creationProblems(landlord, { ...good, leaseEnd: null }).length, 0);
  eq('and undefined likewise',
    creationProblems(landlord, { ...good, leaseEnd: undefined }).length, 0);
  check('an unreadable date is named as unreadable',
    codes(landlord, { ...good, leaseStart: 'not a date' }).includes('unreadable'));
}

// ── Reading ────────────────────────────────────────────────────────────────
{
  const landlord = { userId: 'u-landlord', roles: ['landlord'] };
  const tenant = { userId: 'u-tenant', roles: ['tenant'] };
  const coordinator = { userId: 'u-coord', roles: ['coordinator'] };
  const backOffice = { userId: 'u-bo', roles: ['backOfficeStaff'] };

  eq('a person reads their own tenancies', leaseScope(tenant, 'u-tenant'), 'own');
  eq('a landlord reads their own', leaseScope(landlord, 'u-landlord'), 'own');
  eq('a coordinator reads anyone\'s', leaseScope(coordinator, 'u-tenant'), 'all');
  eq('so does Back Office', leaseScope(backOffice, 'u-tenant'), 'all');
  // Refused rather than answered empty: "you may not see this" and "there is
  // nothing here" are different facts.
  eq('a landlord may not read a stranger\'s tenancy history',
    leaseScope(landlord, 'u-tenant'), 'none');
  eq('an unidentified caller reads nothing', leaseScope(null, 'u-tenant'), 'none');
  eq('and a missing subject is nothing, not everything',
    leaseScope(backOffice, null), 'none');
}

// ── Tenancy history as evidence ────────────────────────────────────────────
//
// The fairness rules that apply to every other evidence type apply here, and
// one of them matters more here than anywhere: every applicant for their first
// LRMC tenancy has no history, and at launch that is every applicant there is.
{
  const asOf = new Date('2027-01-01T00:00:00.000Z');
  const start = (m: number) => new Date(Date.UTC(2026, m - 1, 1)).toISOString();

  // ── No record is unknown, never a zero ──
  const none = tenancyEvidenceFrom([], asOf);
  check('somebody with no leases has no record', !none.hasRecord);
  eq('and no months', none.monthsHoused, 0);
  eq('stability over no record is null, not zero', tenancyStabilityFrom(none), null,
  );

  // Drafts are paperwork, not tenancies. Three abandoned drafts is not a
  // history, and counting them would manufacture one.
  const draftsOnly = tenancyEvidenceFrom(
    [{ status: 'draft', leaseStart: start(1) }, { status: 'pendingSignature', leaseStart: start(2) }],
    asOf);
  check('drafts alone are still no record', !draftsOnly.hasRecord);

  // ── A running tenancy counts to date ──
  const running = tenancyEvidenceFrom([{ status: 'active', leaseStart: start(1) }], asOf);
  check('a live tenancy is a record', running.hasRecord);
  check('and is reported as active', running.hasActiveLease);
  eq('measured to today, not to its end', running.longestTenancyMonths, 11);
  check('so somebody two years in is credited with two years',
    (tenancyStabilityFrom(running) ?? 0) > 80);

  // ── The longest, not the total ──
  // Six one-month lets and one six-month tenancy are both "six months housed",
  // and only one of them is stability.
  const scattered = tenancyEvidenceFrom([
    { status: 'completed', leaseStart: start(1), closedAt: start(2) },
    { status: 'completed', leaseStart: start(3), closedAt: start(4) },
    { status: 'completed', leaseStart: start(5), closedAt: start(6) },
  ], asOf);
  const settled = tenancyEvidenceFrom([
    { status: 'completed', leaseStart: start(1), closedAt: start(4) },
  ], asOf);
  eq('three short lets total three months', scattered.monthsHoused, 3);
  eq('and the longest of them is one', scattered.longestTenancyMonths, 1);
  check('so a scattered record scores below a settled one of the same length',
    (tenancyStabilityFrom(scattered) ?? 0) < (tenancyStabilityFrom(settled) ?? 0));

  // ── A terminated tenancy stops accruing when it stopped ──
  // Its `leaseEnd` is still in the future; measuring from that would credit
  // somebody with months they did not live there.
  const cutShort = tenancyEvidenceFrom([{
    status: 'terminated', leaseStart: start(1), leaseEnd: start(12), closedAt: start(3),
  }], asOf);
  eq('a terminated tenancy is measured to when it actually stopped',
    cutShort.longestTenancyMonths, 1);
  eq('and is counted as terminated', cutShort.terminatedCount, 1);
  // Reported, not punished. Tenancies end early for many reasons and only some
  // are about the tenant; LRMC's records cannot tell which, so the arithmetic
  // must not pretend to.
  check('a termination is not scored to zero',
    (tenancyStabilityFrom(cutShort) ?? 0) > 0);

  // ── The scoring factor ──
  const factors = assessApplication({
    longestTenancyMonths: 24, completedTenancies: 2, terminatedTenancies: 0, hasActiveLease: true,
  }).factors;
  const stability = factors.find((f) => f.factor === 'tenancyStability');
  eq('a long clean tenancy passes', stability?.status, 'pass');
  const noneFactor = assessApplication({}).factors
    .find((f) => f.factor === 'tenancyStability');
  eq('and no history at all is unknown, never a failure', noneFactor?.status, 'unknown');
  eq('scoring nothing', noneFactor?.points, 0);
  const shakyFactor = assessApplication({
    longestTenancyMonths: 6, terminatedTenancies: 1,
  }).factors.find((f) => f.factor === 'tenancyStability');
  eq('a terminated tenancy is a concern a person looks at, not a failure',
    shakyFactor?.status, 'concern');

  // Capped at its weight like every other factor.
  const huge = assessApplication({ longestTenancyMonths: 600, hasActiveLease: true }).factors
    .find((f) => f.factor === 'tenancyStability');
  check('and a very long tenancy cannot score above its weight',
    (huge?.points ?? 0) <= FACTOR_WEIGHTS.tenancyStability);
  check('stability itself is capped at 100',
    (tenancyStabilityFrom({ ...none, hasRecord: true, longestTenancyMonths: 600, hasActiveLease: true }) ?? 0) <= 100);
}

// ── Stats and buckets ──────────────────────────────────────────────────────
{
  const unbucketed = unplaced(LEASE_BUCKETS, LEASE_STATUSES);
  check('every lease status has a dashboard bucket', unbucketed.length === 0, unbucketed.join(', '));
  const twice = doubleCounted(LEASE_BUCKETS);
  check('and none is in two', twice.length === 0, twice.join(', '));
  // A live tenancy is a live tenancy whether or not the rent is late. Splitting
  // them would tell a landlord they have eleven when they have fourteen.
  eq('arrears and expiry are still running tenancies',
    [...LEASE_BUCKETS.running].sort().join(','), 'active,expiring,inArrears');
  const counts = tally(LEASE_BUCKETS, LEASE_STATUSES.map((s) => ({ _id: s as string | null, n: 1 })));
  eq('the buckets sum to the status count', totalOf(counts), LEASE_STATUSES.length);
  eq('and nothing lands in other', counts.other, 0);

  // The three aggregates the brief asked leases to feed.
  const propStats = blueprint.find((e) => e.path === '/stats/properties');
  const appStats = blueprint.find((e) => e.path === '/stats/applications');
  for (const [name, ep] of [['properties', propStats], ['applications', appStats]] as const) {
    check(`/stats/${name} is still declared`, ep !== undefined);
  }
  const statsSrc = readFileSync(resolve(process.cwd(), 'src/modules/stats/index.ts'), 'utf8');
  check('the property aggregate counts tenancies', statsSrc.includes('activeLeases'));
  check('the payments aggregate does too',
    (statsSrc.match(/activeLeases/g) ?? []).length >= 2);
  check('and the applications aggregate reports conversion',
    statsSrc.includes('conversionRate'));
  // Every lease aggregation goes through the same scope rule as the rest.
  const leaseAggregations = (statsSrc.match(/countByStatus\(Lease/g) ?? []).length;
  const scopedLease = (statsSrc.match(/countByStatus\(Lease, await scopeMatch\(/g) ?? []).length;
  eq('every lease aggregation is scoped from the token',
    scopedLease, leaseAggregations);
}

// ── The contract says the asymmetry out loud ───────────────────────────────
{
  const terminate = blueprint.find((e) => e.path === '/leases/terminate');
  check('POST /leases/terminate is declared', terminate !== undefined);
  check('and is audited', terminate?.audited === true);
  check('and its notes say it is not the landlord\'s',
    /coordinator/i.test(terminate?.notes ?? '') && /not a landlord/i.test(terminate?.notes ?? ''),
    'a reader of the contract alone must not think a landlord can evict');

  for (const path of ['/leases/create', '/leases/activate', '/leases/complete']) {
    const ep = blueprint.find((e) => e.path === path);
    check(`POST ${path} is declared`, ep !== undefined);
    check(`and ${path} is audited`, ep?.audited === true);
    check(`and ${path} sits in the member portal`, ep?.zone === 'MEMBER_PORTAL');
  }
  for (const path of ['/leases/user/:userId', '/leases/property/:propertyId']) {
    const ep = blueprint.find((e) => e.path === path);
    check(`GET ${path} is declared`, ep !== undefined);
    check(`and ${path} is paginated`, ep?.responseShape.includes('meta: PageMeta') === true);
  }

  // The grant a landlord needs to activate and complete their own tenancies.
  // Without it the route would advertise to them and then refuse — a 403 with
  // no explanation, on the two acts the module exists for.
  const activate = blueprint.find((e) => e.path === '/leases/activate');
  check('a landlord can reach activate', (activate?.roles ?? []).includes('landlord'));
  check('and a coordinator can reach terminate',
    (terminate?.roles ?? []).includes('coordinator'));
  check('but a tenant reaches neither',
    !(activate?.roles ?? []).includes('tenant')
    && !(terminate?.roles ?? []).includes('tenant'));

  // The handler must not reimplement the rules it is supposed to be calling.
  const leaseSrc = readFileSync(resolve(process.cwd(), 'src/modules/lease/index.ts'), 'utf8');
  check('the lifecycle handler calls the rules module',
    leaseSrc.includes('transitionProblems('));
  check('and resolves the actor\'s party from the loaded lease, not the body',
    leaseSrc.includes('partiesOf(lease)') && !/req\.body[^\n]*party/.test(leaseSrc));
  check('and the landlord comes from the property, never the body',
    !/landlord:\s*body\./.test(leaseSrc),
    'a body that could name the landlord would let somebody lease out a stranger\'s building');
  check('a created lease always starts as a draft',
    /status:\s*'draft'/.test(leaseSrc));
}


// ═══════════════════════════════════════════════════════════════════════════
section('Ususu groups: the register, and what it is worth');

// A rotating savings circle. LRMC records them because keeping up with one for
// two years demonstrates something a bank statement cannot — and the whole
// value of that evidence rests on nobody being able to write it about
// themselves.
{
  const coordinator = { userId: 'u-coord', roles: ['coordinator'] };
  const otherCoord = { userId: 'u-coord2', roles: ['coordinator'] };
  const member = { userId: 'u-member', roles: ['tenant'] };
  const outsider = { userId: 'u-out', roles: ['tenant'] };
  const backOffice = { userId: 'u-bo', roles: ['backOfficeStaff'] };

  const circle = {
    status: 'active',
    createdBy: 'u-coord',
    members: ['u-coord', 'u-member', 'u-second'],
  };

  // ── Who opens one ──
  check('a coordinator may open a circle', mayCreateGroup(coordinator));
  check('so may Back Office', mayCreateGroup(backOffice));
  check('an ordinary member may not', !mayCreateGroup(member));
  check('nor an unidentified caller', !mayCreateGroup(null));
  check('nor a malformed actor',
    !mayCreateGroup({ userId: 'u', roles: null as unknown as string[] }));

  // ── Who is what ──
  eq('the creator is the steward', relationTo(coordinator, circle), 'steward');
  eq('somebody on the register is a member', relationTo(member, circle), 'member');
  eq('Back Office is staff', relationTo(backOffice, circle), 'staff');
  eq('anybody else is nobody', relationTo(outsider, circle), 'none');
  eq('an unidentified actor is nobody', relationTo(null, circle), 'none');

  // ── The scope rule the brief called for, which is narrower than usual ──
  // A savings circle is a private financial arrangement between named people.
  // A coordinator who stewards one in Serrekunda has no business reading the
  // register of one in Basse — and coordinators see almost everything else on
  // this platform, so this is the line that is easy to get wrong.
  check('the steward reads their circle', mayReadGroup(coordinator, circle));
  check('a member reads theirs', mayReadGroup(member, circle));
  check('Back Office reads any', mayReadGroup(backOffice, circle));
  check('AN UNRELATED COORDINATOR READS NOTHING', !mayReadGroup(otherCoord, circle),
    'a coordinator seeing every circle is the thing the brief asked to prevent');
  check('and an outsider reads nothing', !mayReadGroup(outsider, circle));

  // ── Who keeps the register ──
  check('the steward manages the register', mayManageGroup(coordinator, circle));
  check('Back Office may too', mayManageGroup(backOffice, circle));
  // A circle where anybody can remove anybody is one where a disagreement is
  // settled by whoever reaches their phone first.
  check('but an ordinary member may not', !mayManageGroup(member, circle));
  check('nor an unrelated coordinator', !mayManageGroup(otherCoord, circle));

  const codes = (fn: unknown, ...args: unknown[]) =>
    (fn as (...a: unknown[]) => { code: string }[])(...args).map((p) => p.code);

  // ── Adding ──
  eq('the steward adds somebody',
    addMemberProblems(coordinator, circle, 'u-new').length, 0);
  check('a member cannot',
    codes(addMemberProblems, member, circle, 'u-new').includes('not-permitted'));
  check('adding somebody already in is refused',
    codes(addMemberProblems, coordinator, circle, 'u-member').includes('already-a-member'),
    'a duplicated member would be counted twice in group health');
  check('and a nameless add is refused',
    codes(addMemberProblems, coordinator, circle, null).includes('required'));
  const full = { ...circle, members: Array.from({ length: MAX_GROUP_MEMBERS }, (_, i) => `u${i}`) };
  check('a full circle refuses another',
    codes(addMemberProblems, coordinator, full, 'u-new').includes('group-full'));
  // A closed circle's register is history, and adding somebody to a finished
  // round would credit them with contributions they never made.
  check('a closed circle refuses additions',
    codes(addMemberProblems, coordinator, { ...circle, status: 'closed' }, 'u-new')
      .includes('group-closed'));

  // ── Removing ──
  eq('the steward removes somebody',
    removeMemberProblems(coordinator, circle, 'u-member').length, 0);
  check('removing a non-member is refused',
    codes(removeMemberProblems, coordinator, circle, 'u-out').includes('not-a-member'));
  // There is no succession here yet, and a circle with no keeper is a register
  // nobody can manage.
  check('the steward cannot be removed from their own circle',
    codes(removeMemberProblems, coordinator, circle, 'u-coord').includes('is-the-steward'));

  // ── The rule the whole thing rests on ──
  // A contribution somebody wrote down about themselves is a claim, not a
  // record. Without this, the fastest route to a high Ususu score is to open a
  // circle and pay yourself on paper.
  const good = { member: 'u-member', period: '2026-08', amount: 500 };
  eq('the steward records a member\'s contribution',
    contributionProblems(coordinator, circle, good).length, 0);
  check('NOBODY RECORDS THEIR OWN',
    codes(contributionProblems, coordinator, circle, { ...good, member: 'u-coord' })
      .includes('self-recording'));
  check('and it matters more for a miss than a contribution',
    codes(contributionProblems, coordinator, circle, { member: 'u-coord', period: '2026-08' }, 'miss')
      .includes('self-recording'),
    'a member who could record their own misses could also decline to');
  check('a member cannot record at all',
    codes(contributionProblems, member, circle, good).includes('not-permitted'));
  check('somebody not in the circle cannot be recorded against it',
    codes(contributionProblems, coordinator, circle, { ...good, member: 'u-out' })
      .includes('not-a-member'));
  check('a closed circle takes nothing more',
    codes(contributionProblems, coordinator, { ...circle, status: 'closed' }, good)
      .includes('group-closed'));

  // ── The period ──
  // What a streak is counted over, and what makes a duplicate detectable.
  check('a period is required',
    codes(contributionProblems, coordinator, circle, { ...good, period: null })
      .includes('required'));
  check('and must be a year and month',
    codes(contributionProblems, coordinator, circle, { ...good, period: 'August' })
      .includes('malformed'));
  check('a thirteenth month is refused',
    codes(contributionProblems, coordinator, circle, { ...good, period: '2026-13' })
      .includes('malformed'));
  check('an amount is required for a contribution',
    codes(contributionProblems, coordinator, circle, { ...good, amount: 0 })
      .includes('required'));
  // A miss has no amount, because nothing was contributed.
  eq('but not for a miss',
    contributionProblems(coordinator, circle, { member: 'u-member', period: '2026-08' }, 'miss').length, 0);

  // ── Lifecycle ──
  check('a forming circle becomes active', canTransitionGroup('forming', 'active'));
  check('an active circle can be paused', canTransitionGroup('active', 'paused'));
  check('and a paused one resumed', canTransitionGroup('paused', 'active'));
  eq('a closed circle is terminal', USUSU_GROUP_TRANSITIONS.closed.length, 0);
  check('so a closed circle cannot reopen', !canTransitionGroup('closed', 'active'),
    'a reopened circle would silently rewrite everybody\'s streak');
  check('an unknown status transitions nowhere', !canTransitionGroup('nonsense', 'active'));
}

// ── Health, streaks and money ──────────────────────────────────────────────
{
  const members = ['a', 'b', 'c'];
  const row = (member: string, kind: 'contribution' | 'miss', period: string, amount?: number) =>
    ({ member, kind, period, amount, currency: 'GMD' });

  // ── Null over nothing ──
  // A circle formed on Tuesday is not in perfect health and is not in bad
  // health. It has no health to report.
  const fresh = summariseGroup([], members);
  eq('a circle with no contributions has no health to report', fresh.groupHealth, null);
  check('and says it has no activity', !fresh.hasActivity);
  eq('but its members are still counted', fresh.memberCount, 3);
  eq('and every member has a real streak of zero', fresh.streaks.a, 0);

  // ── The arithmetic the brief specified ──
  const clean = summariseGroup([row('a', 'contribution', '2026-01', 500)], members);
  eq('a circle with no misses is in full health', clean.groupHealth, 100);
  const oneMiss = summariseGroup(
    [row('a', 'contribution', '2026-01', 500), row('b', 'miss', '2026-01')], members);
  eq('each miss costs five points', oneMiss.groupHealth, 95);
  eq('and the penalty is the one the scorer uses', GROUP_HEALTH_PENALTY_PER_MISS, 5);
  // Floored, so a circle in real trouble does not report a negative percentage
  // that then flows into a score.
  const disaster = summariseGroup(
    [row('a', 'contribution', '2026-01', 1), ...Array.from({ length: 30 },
      (_, i) => row('b', 'miss', `2026-${String((i % 12) + 1).padStart(2, '0')}`))], members);
  eq('and health floors at zero rather than going negative', disaster.groupHealth, 0);

  // ── Streaks count backwards ──
  // Counting forwards returns the length of somebody's FIRST good run, so a
  // member who missed once in month seven and has paid ever since would be
  // reported with a streak of six.
  const patchy = summariseGroup([
    row('a', 'contribution', '2026-01', 100),
    row('a', 'contribution', '2026-02', 100),
    row('a', 'miss', '2026-03'),
    row('a', 'contribution', '2026-04', 100),
    row('a', 'contribution', '2026-05', 100),
    row('a', 'contribution', '2026-06', 100),
  ], members);
  eq('a streak counts back from the latest period, stopping at the miss',
    patchy.streaks.a, 3);
  // A contribution recorded late — which happens constantly, because a
  // coordinator writes up a week of collections on Friday — must not be read as
  // the most recent one.
  const outOfOrder = summariseGroup([
    row('a', 'contribution', '2026-06', 100),
    row('a', 'miss', '2026-03'),
    row('a', 'contribution', '2026-05', 100),
    row('a', 'contribution', '2026-04', 100),
  ], members);
  eq('and entries recorded out of order are sorted by period first',
    outOfOrder.streaks.a, 3);
  const broken = summariseGroup([
    row('a', 'contribution', '2026-01', 100), row('a', 'miss', '2026-02'),
  ], members);
  eq('a miss in the latest period is a streak of zero', broken.streaks.a, 0);

  // ── Money is never summed across currencies ──
  const multi = summariseGroup([
    { member: 'a', kind: 'contribution', period: '2026-01', amount: 1000, currency: 'GMD' },
    { member: 'b', kind: 'contribution', period: '2026-01', amount: 500, currency: 'GMD' },
    { member: 'c', kind: 'contribution', period: '2026-01', amount: 40, currency: 'USD' },
  ], members);
  eq('contributions are grouped by currency', multi.contributedByCurrency.length, 2);
  eq('summed within one', multi.contributedByCurrency[0]?.amount, 1500);
  eq('and never across', multi.contributedByCurrency[1]?.amount, 40);
  // A miss has no amount and must not be counted as a contribution of nothing.
  eq('a miss adds nothing to the money',
    summariseGroup([row('a', 'miss', '2026-01')], members).contributedByCurrency.length, 0);

  // ── The evidence bundle reads the same ledger ──
  // A circle's page and an applicant's assessment must not disagree about what
  // a miss costs, so both go through `groupHealthFrom`.
  eq('the group page and the scorer use the same health arithmetic',
    summariseGroup([row('a', 'contribution', '2026-01', 1), row('b', 'miss', '2026-02')], members).groupHealth,
    groupHealthFrom(1));
  // And the evidence gatherer still reports `hasRecord: false` for somebody in
  // no circle at all — never a zero, which would decline a tenant for not
  // saving in a circle.
  check('somebody in no circle is unknown, not a zero',
    !ususuEvidenceFrom([]).hasRecord);
}


// ═══════════════════════════════════════════════════════════════════════════
section('Error capture: nothing here may stop somebody paying their rent');

// An error pipeline is exactly the kind of subsystem that grows a circuit
// breaker — "this client reports a lot of faults, stop serving it" — and the
// client reporting a lot of faults is overwhelmingly a member on a bad
// connection whose page half-loaded. Throttling them would take the platform
// away from the person it exists for, at the moment it had already failed them.
{
  check('nothing on the intake can block, throttle, lock, ban or suspend',
    intakeIsAdvisoryOnly());
  eq('the complete set of outcomes',
    [...INTAKE_ACTIONS].sort().join(','), 'escalate,ignore,record');

  // Every kind has a severity, and only one reaches a person unprompted.
  for (const kind of ERROR_KINDS) {
    check(`${kind} has a severity`,
      (ERROR_SEVERITIES as readonly string[]).includes(SEVERITY_BY_KIND[kind]));
  }
  const blocking = ERROR_KINDS.filter((k) => SEVERITY_BY_KIND[k] === 'blocking');
  eq('and only a dead path is blocking', blocking.join(','), 'deadPath',
  );
  // On the connections LRMC serves, a failed request is ordinary. An alert on
  // each one buries everything else.
  eq('a network failure is noise, not an incident',
    SEVERITY_BY_KIND.networkFailure, 'noise');

  const ok = { kind: 'uncaught', message: 'x is not a function' };
  eq('an ordinary fault is filed', intakeAction(ok), 'record');
  eq('a dead control reaches a person',
    intakeAction({ kind: 'deadPath', message: 'nothing happened', control: 'Menu' }), 'escalate');
  eq('a malformed report is dropped, not refused',
    intakeAction({ kind: 'nonsense', message: 'x' } as never), 'ignore');
  eq('and one with no message likewise', intakeAction({ kind: 'uncaught' }), 'ignore');

  // The storage bound. Past it the report is dropped and the member's session
  // is entirely unaffected — that distinction is the whole point.
  eq('past the storage bound a report is dropped',
    intakeAction({ ...ok, seenThisWindow: REPORTS_PER_SESSION_WINDOW }), 'ignore');
  eq('one below it is still filed',
    intakeAction({ ...ok, seenThisWindow: REPORTS_PER_SESSION_WINDOW - 1 }), 'record');
  // Read as source: the handler must answer 201 rather than 429 on the bound,
  // because telling a looping client it is being dropped invites a retry — and
  // because a 4xx here would be the application refusing a member.
  const src = readFileSync(resolve(process.cwd(), 'src/modules/security/index.ts'), 'utf8');
  const ignoreBranch = src.slice(src.indexOf("if (action === 'ignore')"), src.indexOf("if (action === 'ignore')") + 200);
  check('a dropped report still answers 201',
    ignoreBranch.includes('created(res'),
    'a 4xx here would be the platform refusing a member for reporting a fault');
  check('the intake never rate-limits the member',
    !/authRateLimit|globalRateLimit/.test(src),
    'the client reporting many faults is a member whose page is broken');
  check('and there is no update or delete route on the log',
    !/router\.(patch|put|delete)\(/.test(src),
    'an error log somebody can edit is one nobody can rely on');

  // ── Keeping people out of the error log ──
  // Every naive implementation turns the error log into a second copy of the
  // tenant database. This is the layer that catches the ordinary case.
  eq('an email is redacted', redact('failed for awa@example.gm'), 'failed for [redacted]');
  eq('a phone number is redacted', redact('called +2207712345'), 'called [redacted]');
  eq('a record id is redacted', redact(`lease ${'a1b2c3d4e5f6a7b8c9d0e1f2'}`), 'lease [redacted]');
  check('a token is redacted', redact('Bearer eyJhbG.eyJzdWI.sig').includes('[redacted]'));
  check('a card number is redacted', redact('4111 1111 1111 1111').includes('[redacted]'));
  eq('and ordinary text survives', redact('x is not a function'), 'x is not a function');
  eq('null is empty, not the string null', redact(null), '');

  // A query string on this platform is where somebody's name goes, so it is
  // dropped entirely rather than filtered.
  eq('a URL becomes a path template',
    pathTemplate('https://lrmconsortium.com/members/lease/a1b2c3d4e5f6a7b8c9d0e1f2/payments?tenant=Awa+Ceesay'),
    '/members/lease/:id/payments');
  eq('numeric segments are templated too', pathTemplate('/members/page/42'), '/members/page/:n');
  eq('a uuid likewise',
    pathTemplate('/x/550e8400-e29b-41d4-a716-446655440000'), '/x/:id');
  eq('a relative URL works', pathTemplate('/members/ususu?q=awa'), '/members/ususu');
  eq('a fragment is dropped', pathTemplate('/members/ususu#section'), '/members/ususu');
  eq('and nothing is "unknown"', pathTemplate(null), 'unknown');
  check('no query string survives templating',
    !pathTemplate('/x?tenant=Awa').includes('Awa'));

  const stored = redactReport({
    kind: 'deadPath', message: 'nothing happened for awa@example.gm',
    url: '/members/lease/a1b2c3d4e5f6a7b8c9d0e1f2/pay?who=Awa',
    control: 'Record contribution', stack: 'at pay (/x.js:1)',
  });
  eq('a stored report carries a template, not a URL', stored.path, '/members/lease/:id/pay');
  check('and a redacted message', stored.message.includes('[redacted]'));
  eq('with the severity derived, not supplied', stored.severity, 'blocking');

  // What a coordinator reads. Never a stack — they are being asked whether a
  // member is stuck, not to debug, and a stack is noise they learn to skip.
  const said = describeForCoordinator(stored);
  check('a coordinator is told what a member experienced', /tapped|not responding/.test(said));
  check('and never shown a stack trace', !said.includes('at pay'));
  check('nor a database column', !/_id|deletedAt|\$/.test(said));

  // ── Who hears ──
  check('a coordinator is told about a dead control',
    mayReceiveErrorEscalation({ roles: ['coordinator'] }));
  check('so is Back Office', mayReceiveErrorEscalation({ roles: ['backOfficeStaff'] }));
  // Zone A is for decisions only the founder can make.
  check('the founder is not paged by browser faults',
    !mayReceiveErrorEscalation({ roles: ['founder'] }));
  check('but can read the log', mayReadErrors({ roles: ['founder'] }));
  check('a tenant reads nothing', !mayReadErrors({ roles: ['tenant'] }));
  check('nor a landlord', !mayReadErrors({ roles: ['landlord'] }));

  // ── The contract says the constraint out loud ──
  const intakeEp = blueprint.find((e) => e.path === '/security/errors' && e.method === 'POST');
  check('POST /security/errors is declared', intakeEp !== undefined);
  eq('and is unauthenticated on purpose', intakeEp?.auth, 'optional');
  eq('in the public zone', intakeEp?.zone, 'PUBLIC_PORTAL');
  check('and its notes say nothing on it can act against a member',
    /act against a member/i.test(intakeEp?.notes ?? ''),
    'a reader of the contract alone must not think this route can throttle anybody');
  check('and that a dropped report still answers 201',
    /still 201|is still 201/i.test(intakeEp?.notes ?? ''));

  // ── The sensor itself ──
  // Everything above is the server end of this pipeline. The browser end is
  // `assets/js/error-capture.js`, and until now nothing asserted anything about
  // it at all — which is the worst file on the platform to leave unasserted,
  // because a fault in the thing that reports faults is the one fault nobody
  // ever hears about. Read as source: it runs in a browser, so `verify.ts`
  // cannot execute it, but every invariant below is a line somebody could
  // delete without any suite noticing.
  const capture = readFileSync(
    resolve(process.cwd(), '../frontend/assets/js/error-capture.js'), 'utf8');

  // The wrapper reads the request's target in the *wrapper*. Written inside the
  // rejection handler instead — as it was — `arguments` is the handler's own,
  // one element, the error; the guard then asks an error message whether it is
  // the reporting endpoint and is told no every time. The loop it exists to
  // prevent would have been live exactly on the connections bad enough to cause
  // it, and nowhere else, which is why nobody would have reproduced it.
  check('the fetch wrapper reads its target before calling through',
    /var target = '';[\s\S]{0,500}original\.apply/.test(capture));
  check('and the report-endpoint guard reads that target',
    /if \(target\.indexOf\('\/security\/errors'\) === -1\)/.test(capture));
  check('no guard in this file reads arguments[0] from inside a promise handler',
    !/function \(err\)[\s\S]{0,500}arguments\[0\]/.test(capture),
    'inside a handler `arguments` is the handler\'s own, and the guard silently never fires');

  // A watcher that breaks the request it watches is worse than no watcher.
  check('the wrapper keeps fetch\'s receiver',
    /original\.apply\(this \|\| global,/.test(capture),
    'a bare `var f = fetch` hands us undefined, and a native fetch without its window throws');
  check('a failed request is re-thrown, so the caller still sees it',
    /throw err;/.test(capture));
  eq('and the pending counter is decremented on both paths',
    (capture.match(/__lrmcPendingRequests -= 1/g) ?? []).length, 2);

  // The governing rule of the whole subsystem, in the one file that runs on a
  // member's phone.
  check('reporting a failure cannot itself fail loudly',
    /\.catch\(function \(\) \{\}\)/.test(capture));
  check('nothing in the sensor blocks a control',
    !/preventDefault|stopPropagation|return false/.test(capture),
    'the diagnostic must never become the fault');
  check('a submit button is exempt from the dead-path watcher',
    /el\.type === 'submit'/.test(capture),
    'a form reports its own failures, and a slow save is not a dead control');
  check('and the number of reports a browser may send is bounded',
    /MAX_REPORTS = \d+/.test(capture) && /sent >= MAX_REPORTS/.test(capture),
    'a page in a render loop must not become a page hammering LRMC');

  // Every page behind a session carries it. Named rather than walked, for the
  // same reason as the chrome sweep below: a new page has to be added here
  // deliberately, where a walk would cover it and prove nothing.
  const PORTAL_PAGES = ['index', 'properties', 'payments', 'maintenance',
    'leases', 'ususu', 'applications', 'dashboard'];
  const unwatched = PORTAL_PAGES.filter((p) => {
    try {
      return !readFileSync(
        resolve(process.cwd(), `../frontend/members/${p}.html`), 'utf8')
        .includes('/assets/js/error-capture.js');
    } catch { return true; }
  });
  check('every member page carries the sensor', unwatched.length === 0, unwatched.join(', '));
}


// ═══════════════════════════════════════════════════════════════════════════
section('The observation pipeline: counting without a database');

// Week 4 shipped thresholds and assertions with nothing feeding them, which is
// a smoke alarm wired to no sensor. This is the sensor.
{
  const t0 = Date.parse('2026-08-10T12:00:00.000Z');
  const min = (n: number) => t0 + n * 60_000;
  const fresh = () => new Map() as ObservationStore;

  // ── Keys ──
  // Credential stuffing is one address trying many accounts; keying it by
  // account would mean it never fires, because the attacker has no account.
  eq('credential stuffing is keyed by address', KEY_BY_SIGNAL.credentialStuffing, 'address');
  eq('enumeration is keyed by the account doing it', KEY_BY_SIGNAL.enumeration, 'subject');
  eq('an address-keyed event files under the address',
    keyFor({ signal: 'credentialStuffing', address: '1.2.3.4', subject: 'u1', at: t0 }), '1.2.3.4');
  eq('and falls back when the preferred handle is absent',
    keyFor({ signal: 'credentialStuffing', subject: 'u1', at: t0 }), 'u1');
  // Merging every anonymous caller into one bucket would make them collectively
  // look like a single very suspicious client.
  eq('an event with neither handle is dropped',
    keyFor({ signal: 'credentialStuffing', at: t0 }), null);

  // ── Counting ──
  let store = fresh();
  for (let i = 0; i < 5; i += 1) {
    observe(store, { signal: 'credentialStuffing', address: '1.2.3.4', at: min(0) });
  }
  eq('events accumulate', countIn(store, 'credentialStuffing', '1.2.3.4', min(0)), 5);
  eq('a different key is counted separately',
    countIn(store, 'credentialStuffing', '5.6.7.8', min(0)), 0);
  eq('and a different signal likewise',
    countIn(store, 'enumeration', '1.2.3.4', min(0)), 0);

  // The window. `credentialStuffing` is fifteen minutes.
  observe(store, { signal: 'credentialStuffing', address: '1.2.3.4', at: min(14) });
  eq('an event inside the window counts',
    countIn(store, 'credentialStuffing', '1.2.3.4', min(14)), 6);
  // Sixteen minutes later the first five are outside it.
  eq('and events outside it do not',
    countIn(store, 'credentialStuffing', '1.2.3.4', min(16)), 1);

  // The ring is one longer than the widest window, so the current partial
  // minute never displaces a whole one.
  check('the ring is longer than the widest window',
    RING_MINUTES > Math.max(...Object.values(SIGNAL_DEFINITIONS).map((d) => d.windowMinutes)));

  // Coming all the way round must overwrite, not accumulate — this is the one
  // place an off-by-one silently doubles a count.
  store = fresh();
  observe(store, { signal: 'enumeration', subject: 'u1', at: min(0) });
  observe(store, { signal: 'enumeration', subject: 'u1', at: min(RING_MINUTES) });
  eq('a bucket the ring has come round to is overwritten, not added to',
    countIn(store, 'enumeration', 'u1', min(RING_MINUTES)), 1);

  eq('a weight counts for more than one',
    countIn(observe(fresh(), { signal: 'impossibleTravel', subject: 'u1', at: t0, weight: 4 }),
      'impossibleTravel', 'u1', t0), 4);
  eq('a zero weight records nothing',
    countIn(observe(fresh(), { signal: 'enumeration', subject: 'u1', at: t0, weight: 0 }),
      'enumeration', 'u1', t0), 0);
  eq('an unreadable time is dropped',
    countIn(observe(fresh(), { signal: 'enumeration', subject: 'u1', at: NaN }),
      'enumeration', 'u1', t0), 0);
  eq('and an unknown signal is dropped',
    observe(fresh(), { signal: 'nonsense' as never, subject: 'u1', at: t0 }).size, 0);

  // ── Grading ──
  store = fresh();
  for (let i = 0; i < SIGNAL_DEFINITIONS.credentialStuffing.escalateAt; i += 1) {
    observe(store, { signal: 'credentialStuffing', address: '9.9.9.9', at: min(0) });
  }
  const findings = grade(store, min(0));
  eq('a signal at its threshold produces a finding', findings.length, 1);
  eq('and it escalates', findings[0]?.action, 'escalate');
  eq('carrying the address it was keyed by', findings[0]?.address, '9.9.9.9');
  eq('and no subject, because there is none', findings[0]?.subject, null);
  // Grading is a read: it must be safe to call as often as anybody likes.
  eq('grading twice gives the same answer', grade(store, min(0)).length, 1);
  eq('a quiet store grades to nothing', grade(fresh(), min(0)).length, 0);

  // The ceiling. This file cannot raise it — the actions come from `abuse.ts`.
  check('the pipeline cannot act against anybody',
    pipelineIsAdvisoryOnly(findings.map((f) => f.action)));
  check('and no finding is anything but watch or escalate',
    grade(store, min(0)).every((f) => f.action === 'watch' || f.action === 'escalate'));

  // ── Escalation cooldown ──
  // An attack lasting an hour produces the same finding on every grade. Sixty
  // notifications about one event teaches a coordinator to ignore the channel,
  // which costs LRMC the next genuine one.
  const sent = new Map<string, number>();
  const first = dueForEscalation(findings, sent, min(0));
  eq('the first escalation goes out', first.length, 1);
  for (const f of first) sent.set(escalationFingerprint(f), min(0));
  eq('the same finding a minute later does not',
    dueForEscalation(findings, sent, min(1)).length, 0);
  eq('and still does not just before the cooldown ends',
    dueForEscalation(findings, sent, min(ESCALATION_COOLDOWN_MINUTES - 1)).length, 0);
  eq('but does once it has',
    dueForEscalation(findings, sent, min(ESCALATION_COOLDOWN_MINUTES)).length, 1);
  // A different address is a different event and must not be suppressed.
  check('a different key is a different escalation',
    escalationFingerprint({ ...findings[0]!, address: '1.1.1.1' })
      !== escalationFingerprint(findings[0]!));

  // ── Pruning ──
  // Not needed for correctness — a stale slot contributes nothing — but needed
  // for memory, because a stuffing run walks through a great many addresses.
  store = fresh();
  observe(store, { signal: 'enumeration', subject: 'old', at: min(0) });
  observe(store, { signal: 'enumeration', subject: 'new', at: min(RING_MINUTES + 5) });
  prune(store, min(RING_MINUTES + 5));
  check('a key nobody has touched is dropped', !store.has(storeKey('enumeration', 'old')));
  check('and a live one is kept', store.has(storeKey('enumeration', 'new')));

  // ── The feeds ──
  // Wired at the error handler rather than per throw site, because that is the
  // one place that sees every refusal — and "somebody remembers to wire it" is
  // not a security control.
  const handler = readFileSync(resolve(process.cwd(), 'src/middleware/errorHandler.ts'), 'utf8');
  check('failed logins feed the pipeline', /credentialStuffing/.test(handler));
  check('and refusals do', /permissionProbing/.test(handler));
  check('and the watcher can never become the fault',
    /catch \{ \/\* never let the watcher become the fault \*\/ \}/.test(handler));
  const paySrc = readFileSync(resolve(process.cwd(), 'src/modules/payment/index.ts'), 'utf8');
  check('hand-recorded payments feed it', /recordingBurst/.test(paySrc));
  check('and reading somebody else\'s ledger does', /enumeration/.test(paySrc));
}


// ═══════════════════════════════════════════════════════════════════════════
section('Vendor assets: what LRMC actually serves');

// "We self-host Alpine" is a sentence about a directory, and a directory can be
// empty, half-written, or written by somebody else. The pages fall back to a
// CDN and then to `boot.js`, so an empty vendor directory breaks nothing
// visibly — it just quietly removes the reason self-hosting was done.
{
  const lockPath = resolve(process.cwd(), '../frontend/deploy/vendor.lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as VendorLock;
  const vendorDir = resolve(process.cwd(), '../frontend/assets/vendor');

  check('the lockfile names some assets', lock.assets.length > 0);
  for (const asset of lock.assets) {
    check(`${asset.file}: is pinned to an exact version`, versionIsPinned(asset.version),
      `"${asset.version}" — \`latest\` in a lockfile is a build that changes under you`);
    check(`${asset.file}: says why it is here`, asset.why.length > 40);
    check(`${asset.file}: has a source`, Boolean(asset.url));
  }
  eq('Alpine is pinned to the version the pages name in their CDN fallback',
    lock.assets.find((a) => a.file === 'alpine.min.js')?.version, '3.14.1');

  /* `existsSync` is absent from this sandbox's trimmed `@types/node`, and a
   * read that throws answers the same question. */
  const present = (file: string) => {
    try { readFileSync(`${vendorDir}/${file}`); return true; } catch { return false; }
  };
  const hashOf = (file: string) => {
    try {
      return createHash('sha384').update(readFileSync(`${vendorDir}/${file}`)).digest('base64');
    } catch { return null; }
  };

  const reports = vendorStatus(lock, present, hashOf);
  eq('every asset is reported on', reports.length, lock.assets.length);

  // Broken is a failure. Pending is tracked debt, printed rather than hidden —
  // the same treatment `PLANNED_PAGES` gets, and for the same reason.
  const broken = reports.filter((r) => r.state === 'broken');
  check('no vendored asset is broken', broken.length === 0,
    broken.map((r) => `${r.file}: ${r.detail}`).join(' | '));
  check('and the report says so', vendorIsSound(reports));

  const pending = vendorPending(reports);
  console.log(`        (${pending.length} vendor assets still to fetch or build)`);
  for (const r of pending) console.log(`        ${r.file} — ${r.detail}`);

  // The deployability gate is deliberately stricter than soundness. A build
  // with pending assets is fine to develop against and must not reach the C4
  // servers, where it would serve pages reaching for a CDN LRMC has decided not
  // to depend on — undoing the whole exercise, silently.
  check('a build with pending assets is not deployable',
    pending.length === 0 ? vendorIsDeployable(reports) : !vendorIsDeployable(reports));

  // ── The state machine itself, driven without touching a disk ──
  const one = (over: Partial<VendorAsset>): VendorLock => ({
    assets: [{
      file: 'x.js', package: 'x', version: '1.0.0', url: 'https://example/x.js',
      sha384: null, bytes: null, why: 'a'.repeat(50), ...over,
    }],
  });
  const yes = () => true;
  const no = () => false;

  eq('absent with no hash is pending',
    vendorStatus(one({}), no, () => null)[0]?.state, 'pending');
  // Somebody fetched it once and it is gone now. That is a regression, not
  // work outstanding.
  eq('absent WITH a hash is broken',
    vendorStatus(one({ sha384: 'A'.repeat(64) }), no, () => null)[0]?.state, 'broken');
  eq('present with no hash is pending',
    vendorStatus(one({}), yes, () => 'whatever')[0]?.state, 'pending');
  eq('present and matching is verified',
    vendorStatus(one({ sha384: 'A'.repeat(64) }), yes,
      () => 'A'.repeat(64))[0]?.state, 'verified');
  // The failure that actually matters: the bytes are not the bytes somebody
  // reviewed.
  eq('present and NOT matching is broken',
    vendorStatus(one({ sha384: 'A'.repeat(64) }), yes,
      () => 'B'.repeat(64))[0]?.state, 'broken');
  eq('an unpinned version is broken whatever else is true',
    vendorStatus(one({ version: 'latest' }), yes, () => 'x')[0]?.state, 'broken');
  eq('and so is a malformed hash',
    vendorStatus(one({ sha384: 'sha384-notbase64' }), yes, () => 'x')[0]?.state, 'broken');

  check('a hex digest pasted where base64 belongs is refused',
    !hashIsWellFormed('a3f5'.repeat(24)),
    'it would compare unequal forever, which reads as tampering');
  check('and a hash carrying its own prefix is refused',
    !hashIsWellFormed('sha384-' + 'A'.repeat(64)));
  check('every version-like string that means "newest" is refused',
    ['latest', '*', '^3.14.1', '~3.4', '3.4', ''].every((v) => !versionIsPinned(v)));
  check('but a real version is accepted', versionIsPinned('3.14.1'));

  // ── The fetch script's own guards ──
  // Read as source: these are the checks that stop a captive portal's error
  // page shipping under a JavaScript filename, which is a very live risk on the
  // networks this platform is built for.
  const fetcher = readFileSync(
    resolve(process.cwd(), '../frontend/scripts/fetch-vendor-assets.sh'), 'utf8');
  check('the fetch script refuses an HTML error page', /<!doctype html/i.test(fetcher));
  check('and refuses a file too small to be a library', /-lt 1024/.test(fetcher));
  check('and fails on a hash mismatch rather than overwriting',
    /HASH MISMATCH/.test(fetcher));
  check('and only records hashes when told to explicitly',
    /--write/.test(fetcher),
    'a script that silently re-pins on every run is not a lockfile');
}


// ═══════════════════════════════════════════════════════════════════════════
section('The production build, and whether it agrees with itself');

// A build is a rewrite of every page, and a rewrite that misses one is silent:
// the page loads, most of it works, and one asset 404s — permanently, because
// a hashed deployment has no unhashed fallback.
{
  const frontendRoot = resolve(process.cwd(), '../frontend');

  // ── The manifest rules, driven without a build ──
  const entry = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
    path: '/assets/js/sdk.a1b2c3d4.js',
    integrity: `sha384-${'A'.repeat(64)}`,
    bytes: 1024,
    ...over,
  });
  const man = (assets: Record<string, ManifestEntry>): AssetManifest =>
    ({ generatedFrom: 'x', assets });

  eq('a sound manifest has no problems',
    manifestProblems(man({ 'sdk.js': entry() })).length, 0);
  eq('an empty manifest is a failed build',
    manifestProblems(man({}))[0]?.code, 'empty');
  eq('and a missing one likewise',
    manifestProblems(null)[0]?.code, 'malformed');

  // The hash is what lets nginx cache for a year without a deploy stranding
  // somebody on a slow connection.
  eq('an unhashed name is refused',
    manifestProblems(man({ 'sdk.js': entry({ path: '/assets/js/sdk.js' }) }))[0]?.code,
    'not-hashed');
  check('a hashed name is recognised', isHashed('/assets/js/portal.9f8e7d6c.js'));
  check('and a short suffix is not a hash', !isHashed('/assets/js/portal.v2.js'));
  eq('a relative path is refused',
    manifestProblems(man({ 'a.js': entry({ path: 'assets/js/a.1234abcd.js' }) }))[0]?.code,
    'relative-path');
  // A zero-byte stylesheet looks like a design problem rather than a build one,
  // and somebody will spend a day on it.
  eq('a zero-byte asset is a failed build step',
    manifestProblems(man({ 'a.js': entry({ bytes: 0 }) }))[0]?.code, 'empty-asset');
  eq('a malformed integrity is refused',
    manifestProblems(man({ 'a.js': entry({ integrity: 'sha256-short' }) }))[0]?.code,
    'bad-integrity');
  // Two names resolving to one file means one was never built and is silently
  // borrowing the other's output.
  const dup = manifestProblems(man({ 'a.js': entry(), 'b.js': entry() }));
  check('two assets resolving to one file is caught',
    dup.some((p) => p.code === 'duplicate-path'));

  // ── Dangling and orphaned ──
  const built = man({ 'sdk.js': entry({ path: '/assets/js/sdk.aaaaaaaa.js' }) });
  eq('an asset a page wants and the build lacks is caught',
    danglingReferences(built, ['/assets/js/sdk.aaaaaaaa.js', '/assets/js/gone.bbbbbbbb.js']).join(','),
    '/assets/js/gone.bbbbbbbb.js');
  // Images are copied wholesale rather than hashed and are not expected here.
  eq('an image is not treated as missing',
    danglingReferences(built, ['/assets/img/logo.png']).length, 0);
  eq('a CDN reference is not treated as missing',
    danglingReferences(built, ['https://fonts.googleapis.com/x']).length, 0);
  eq('and an asset nothing references is reported',
    orphanedAssets(built, []).join(','), '/assets/js/sdk.aaaaaaaa.js');

  // ── The Tailwind CDN, which is the whole point of the build ──
  check('the CDN script is recognised',
    stillUsesCdnTailwind('<script src="https://cdn.tailwindcss.com"></script>'));
  check('and a compiled stylesheet is not',
    !stillUsesCdnTailwind('<link rel="stylesheet" href="/assets/css/tailwind.abcd1234.css" />'));

  // ── The two palettes must agree ──
  // The pages carry an inline config for the CDN build; the CLI reads
  // `tailwind.config.js`. A compiled stylesheet built from a different palette
  // is a site that looks subtly wrong everywhere and obviously wrong nowhere.
  const cliConfig = readFileSync(`${frontendRoot}/tailwind.config.js`, 'utf8');
  const pageWithConfig = readFileSync(`${frontendRoot}/members/index.html`, 'utf8');
  const inline = pageWithConfig.slice(
    pageWithConfig.indexOf('tailwind.config'),
    pageWithConfig.indexOf('</script>', pageWithConfig.indexOf('tailwind.config')));
  const drift = paletteDrift(inline, cliConfig);
  check('the CLI palette matches the one the pages were designed against',
    drift.length === 0, drift.slice(0, 6).join(' | '));
  check('and it is not empty', Object.keys(paletteOf(cliConfig)).length > 20);

  // ── The bundler's own guards ──
  const bundler = readFileSync(`${frontendRoot}/scripts/bundle.production.sh`, 'utf8');
  // A build with pending vendor assets serves pages reaching for a CDN LRMC has
  // decided not to depend on — undoing the whole exercise, silently.
  check('the bundler refuses to build without vendored assets',
    /REFUSING/.test(bundler) && /sha384 == null/.test(bundler));
  // Half this platform's classes are in string literals in portal.js. A build
  // scanning only HTML produces a stylesheet that looks right on a static page
  // and falls apart the moment a card is rendered.
  check('and scans the JavaScript for Tailwind classes, not just the HTML',
    /--content "\$ROOT\/assets\/js\/\*\.js"/.test(bundler));
  check('and replaces the CDN compiler with a compiled stylesheet',
    /cdn\\.tailwindcss\\.com/.test(bundler));
  // `boot.js` is the file somebody debugs in the field on a bad connection.
  check('boot.js is deliberately left unminified',
    /boot\.js is deliberately NOT minified/.test(bundler));
  check('pages are rewritten with a parser-ish pass, not a regex over HTML',
    /node - "\$ROOT"/.test(bundler));
  check('and assets are pre-compressed at build time', /brotli/.test(bundler) && /gzip -9/.test(bundler));

  // ── nginx serves what the bundler produces ──
  const nginx = readFileSync(`${frontendRoot}/deploy/nginx.conf`, 'utf8');
  check('nginx serves the pre-compressed files rather than compressing per request',
    /gzip_static/.test(nginx));
  check('and hashed assets are cached for a year',
    /immutable/.test(nginx));
}


// ═══════════════════════════════════════════════════════════════════════════
section('Abuse detection, and what it is allowed to do');

// Every rule here can be wrong about a real member, and a false positive lands
// on somebody trying to pay their rent. So the ceiling is `escalate` — a signal
// in front of a person — and never a block.
{
  check('nothing here can block, lock, ban or suspend anybody', isAdvisoryOnly(),
    'a system that can lock somebody out on a heuristic eventually locks out a tenant on rent day');
  eq('the strongest action is to tell somebody',
    [...ABUSE_ACTIONS].sort().join(','), 'escalate,ignore,watch');

  // Every signal has thresholds, and watching comes before escalating.
  for (const signal of ABUSE_SIGNALS) {
    const def = SIGNAL_DEFINITIONS[signal];
    check(`${signal} has a definition`, def !== undefined);
    check(`${signal} watches before it escalates`, def.watchAt < def.escalateAt);
    check(`${signal} has a window`, def.windowMinutes > 0);
    /* At least 1. A threshold of 0 would make a request with no observations at
     * all look like an anomaly, and it is a one-character mistake away. This is
     * also what makes the count guard in `actionFor` provably redundant rather
     * than merely untested. */
    check(`${signal} watches at one or more`, def.watchAt >= 1);
    check(`${signal} explains itself in words`, def.describe(def.escalateAt).length > 12);
    // A message naming a column is a message a coordinator cannot act on.
    check(`${signal} never names a database column`, !/_id|\$|deletedAt/.test(def.describe(5)));
  }

  // `>=`, not `>`. The classic off-by-one in alerting, and it fails silent: the
  // alert simply never fires at the number somebody wrote down.
  const stuffing = SIGNAL_DEFINITIONS.credentialStuffing;
  eq('exactly at the escalation threshold escalates',
    actionFor('credentialStuffing', stuffing.escalateAt), 'escalate');
  eq('one below it watches',
    actionFor('credentialStuffing', stuffing.escalateAt - 1), 'watch');
  eq('exactly at the watch threshold watches',
    actionFor('credentialStuffing', stuffing.watchAt), 'watch');
  eq('one below that is ignored',
    actionFor('credentialStuffing', stuffing.watchAt - 1), 'ignore');
  eq('zero is ignored', actionFor('credentialStuffing', 0), 'ignore');
  eq('a negative count is ignored', actionFor('credentialStuffing', -5), 'ignore');
  eq('NaN is ignored', actionFor('credentialStuffing', NaN), 'ignore');
  eq('an unknown signal is ignored',
    actionFor('somethingNew' as never, 9999), 'ignore');

  // ── Findings ──
  const findings = assessAbuse([
    { signal: 'enumeration', count: 35, subject: 'u-1' },
    { signal: 'credentialStuffing', count: 40, address: '1.2.3.4' },
    { signal: 'permissionProbing', count: 2 },
  ]);
  eq('quiet signals are dropped entirely', findings.length, 2);
  // A list where the urgent thing is fourteenth is a list nobody reads to the
  // bottom of.
  eq('and escalations sort first', findings[0]?.action, 'escalate');
  check('every finding carries its window', findings.every((f) => f.windowMinutes > 0));
  check('and a sentence a person can read', findings.every((f) => f.summary.length > 12));
  eq('an empty observation set is an empty feed', assessAbuse([]).length, 0);
  eq('and a malformed one does not throw',
    assessAbuse(null as never).length, 0);

  // ── Who is told ──
  // The person who can resolve "this account is behaving oddly" is the
  // coordinator who knows them and can telephone them.
  check('a coordinator receives escalations',
    mayReceiveEscalation({ roles: ['coordinator'] }));
  check('so does Back Office', mayReceiveEscalation({ roles: ['backOfficeStaff'] }));
  // Zone A is for decisions only the founder can make. A queue of heuristic
  // alerts in front of somebody with no time is a queue nobody reads.
  check('the founder is NOT paged by heuristics',
    !mayReceiveEscalation({ roles: ['founder'] }));
  check('but can still read the feed', mayReadAbuse({ roles: ['founder'] }));
  check('and so can HQ', mayReadAbuse({ roles: ['hqExecutive'] }));
  check('a tenant reads nothing', !mayReadAbuse({ roles: ['tenant'] }));
  check('nor a landlord', !mayReadAbuse({ roles: ['landlord'] }));
  check('nor an unidentified caller', !mayReadAbuse(null));
}

// ── Hardening that lives in configuration ──────────────────────────────────
{
  const app = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8');
  check('the app runs behind a proxy and reads real client addresses',
    app.includes("app.set('trust proxy'"),
    'without it every request appears to come from the load balancer and per-IP limiting protects nothing');
  check('security headers are set', app.includes('helmet('));
  check('the API is rate limited', app.includes('globalRateLimit'));
  check('and the fingerprint header is off', app.includes("disable('x-powered-by')"));

  const ctx = readFileSync(resolve(process.cwd(), 'src/middleware/requestContext.ts'), 'utf8');
  check('credential endpoints have their own tighter bucket', ctx.includes('authRateLimit'));
  check('and successful sign-ins do not count against it',
    ctx.includes('skipSuccessfulRequests: true'),
    'otherwise a busy office locks itself out');
  check('every request is logged with its duration', /durationMs/.test(ctx));
  check('and with a request id, so a member can quote one', /requestId/.test(ctx));

  // The deployment configuration is a real artefact and worth checking, because
  // nothing else will notice if HSTS quietly disappears from it.
  const nginx = readFileSync(resolve(process.cwd(), '../frontend/deploy/nginx.conf'), 'utf8');
  check('HTTP redirects to HTTPS', /return 301 https:/.test(nginx));
  check('except for ACME, or the certificate silently expires',
    /acme-challenge/.test(nginx));
  check('HSTS is set', /Strict-Transport-Security/.test(nginx));
  check('for two years, with subdomains', /max-age=63072000; includeSubDomains/.test(nginx));
  // Without `always`, nginx omits these on 4xx and 5xx — exactly the responses
  // an attacker is trying to produce.
  const headerLines = nginx.split('\n').filter((l) => l.trim().startsWith('add_header'));
  check('and every security header is sent on error responses too',
    headerLines.every((l) => l.includes('always')),
    headerLines.filter((l) => !l.includes('always')).join(' | '));
  check('the API is proxied, not served as files', /proxy_pass/.test(nginx));
  check('with the scheme forwarded', /X-Forwarded-Proto/.test(nginx));
  check('auth endpoints get a tighter nginx bucket', /zone=lrmc_auth/.test(nginx));
  check('API responses are never cached by an intermediary',
    /Cache-Control "no-store"/.test(nginx),
    'a stale /auth/me from a proxy is one member seeing another\'s session');
  // A blanket SPA fallback turns every typo and dead link into a 200 serving
  // the wrong page, and hides them from monitoring.
  check('there is no catch-all SPA fallback',
    !/try_files[^;]*\/index\.html;/.test(nginx.replace(/\$uri\/index\.html/g, '')));
  check('and a missing page is a real 404', /=404/.test(nginx));
}


// ═══════════════════════════════════════════════════════════════════════════
section('Where LRMC actually is');

// This section exists because the answer was wrong for four weeks and nothing
// noticed. `LAUNCH_CURRENCY` was set to GMD on day one; every profile schema
// still defaulted `residenceCountry` to `'Ghana'`, and the footer on every page
// said "Accra, Ghana". A tenant registering in Banjul was silently recorded as
// resident in another country, and no check had ever been told otherwise.
{
  /* ── Pinned to the registry, not to Banjul ────────────────────────────
   * These read `LAUNCH_COUNTRY` and its four siblings, which are derived from
   * whichever market `LRMC_MARKET` selects. Pinning them to The Gambia meant
   * the suite could only ever be run as Banjul — so `deploy/release.sh`, which
   * runs it during the pilot's release, was verifying the wrong market's
   * pages. "Serving The Gambia" survived in the footer of every page of the
   * Casper build with the suite reporting success.
   *
   * The two questions are now asked separately: the derived constants must
   * equal the *active* market's registry entry (the wiring), and Gambia's own
   * entry is pinned to the values it has always had (the regression guard).
   * Both are stronger than the version that could only pass one way. */
  eq('LRMC launches where the active market says', LAUNCH_COUNTRY, MARKET.country);
  eq('from its city', LAUNCH_CITY, MARKET.city);
  eq('and the two are written together', LAUNCH_LOCATION, `${MARKET.city}, ${MARKET.country}`);
  eq('in its currency', LAUNCH_CURRENCY, MARKET.currency);
  eq('on its dialling code', LAUNCH_DIALLING_CODE, MARKET.diallingCode);

  /* The regression guard. Gambia's values were wrong for four weeks; these are
   * what they were corrected to, and they are asked of the registry directly
   * so they hold whichever market this build serves. */
  eq('Gambia is still The Gambia', MARKETS.gambia.country, 'The Gambia');
  eq('still from Banjul', MARKETS.gambia.city, 'Banjul');
  eq('still in dalasi', MARKETS.gambia.currency, 'GMD');
  eq('still on +220', MARKETS.gambia.diallingCode, '+220');

  // The bug itself: a default that disagreed with the launch currency.
  const fragments = readFileSync(
    resolve(process.cwd(), 'src/shared/schemaFragments.ts'), 'utf8');
  check('the country default is imported, not written',
    /residenceCountry:[^\n]*default: LAUNCH_COUNTRY/.test(fragments),
    'a literal here is a literal that can disagree with the launch currency');
  check('and no schema hard-codes Ghana as a default',
    !/default:\s*'Ghana'/.test(fragments));

  // The phone regex is deliberately NOT narrowed. LRMC exists partly to let
  // people abroad let property at home, and a landlord in London has a British
  // number.
  check('a Gambian number is accepted', PHONE_REGEX.test('+2207712345'));
  check('so is a Ghanaian one', PHONE_REGEX.test('+233241234567'));
  check('and a British one', PHONE_REGEX.test('+447700900000'));

  // ── The frontend says the same thing ──
  // Read as source, across every page, because a footer is copied and a copy
  // is where "Accra" survived four rounds of review.
  /* Every file that carries the chrome. Named rather than walked, because the
   * sandbox's trimmed `@types/node` has no `readdirSync` — and because a named
   * list fails loudly when a new shared file appears, where a walk would
   * silently cover it and prove nothing about the ones that matter.
   *
   * `verify-member-portal.py` sweeps the whole tree in the browser suite; this
   * is the backend's belt to that braces. */
  const frontendRoot = resolve(process.cwd(), '../frontend');
  const CHROME_FILES = [
    'components/footer.html', 'layouts/dashboard.html', 'layouts/auth.html',
    'layouts/base.html', 'assets/js/ui.js', 'hq/index.html',
    'marketplace/index.html', 'members/index.html', 'public/index.html',
  ];
  const stale = CHROME_FILES.filter((f) => {
    try { return /Accra/.test(readFileSync(`${frontendRoot}/${f}`, 'utf8')); }
    catch { return false; }
  });
  check('no shared chrome still says Accra', stale.length === 0, stale.join(', '));

  const footer = readFileSync(`${frontendRoot}/components/footer.html`, 'utf8');
  check('and the shared footer says Banjul', footer.includes(LAUNCH_LOCATION));

  // ── What LRMC charges ──
  // A percentage that lives only in HTML is a percentage the ledger cannot
  // agree with. These disagreed for four weeks: `ledger.ts` was already taking
  // 15% of every fare while the pricing page said "to confirm".
  // ── Two markets, two deployments, one code line ──
  // These six were literal constants until the US pilot and the Gambia launch
  // became separate deployments. The shape is unchanged — one place, imported
  // everywhere — and only the selection is configuration. The suite runs
  // unconfigured, so it sees `gambia`, and every assertion below about "the
  // launch" is an assertion about that market.
  /* Not pinned. `LRMC_MARKET` selects it, `deploy/release.sh` exports the
   * market being released, and a suite that could only run as one market is a
   * suite the other market's release cannot use. */
  check('the suite runs against a real market',
    (MARKET_IDS as readonly string[]).includes(MARKET.id), MARKET.id);
  eq('and every market is a real one', MARKET_IDS.length, 2);

  for (const id of MARKET_IDS) {
    const m = MARKETS[id];
    eq(`${id} is its own key`, m.id, id);
    check(`${id} names a currency the platform recognises`,
      (CURRENCIES as readonly string[]).includes(m.currency));
    check(`${id} writes its dialling code with a +`, m.diallingCode.startsWith('+'));
    /* No two markets may share a currency. Not a rule about money — a rule
     * about deployments: two markets on one currency is the configuration
     * mistake that looks correct in every log. */
    for (const other of MARKET_IDS) {
      if (other === id) continue;
      check(`${id} and ${other} are different countries`,
        MARKETS[other].country !== m.country);
    }
  }

  /* ── Readiness, and why this is no longer a hard failure for every market ──
   * It was: "the <id> market is ready to serve people", for every market. That
   * read as thoroughness and behaved as a trap. A market is added to this
   * registry the day somebody starts *planning* it, and its fields are decided
   * over the following weeks; a suite that fails on the first day means the
   * only way to keep it green is to type plausible values into fields nobody
   * has decided — which is the exact failure `marketProblems` exists to stop,
   * reached by the route of trying to satisfy the check about it.
   *
   * So the market this build serves must be ready — that one is a hard
   * failure, because it is what is about to be deployed — and any other
   * market's undecided fields are printed as tracked debt, the way unfetched
   * vendor assets and unconfirmed page values are. `env.ts` still refuses to
   * boot on one and `npm run preflight` still refuses to release one, so an
   * unfinished market cannot reach anybody. It just does not stop work on the
   * finished one.
   *
   * The US pilot carries this today: `regions` is null. */
  const activeProblems = marketProblems(MARKET);
  check(`the ${MARKET.id} market this build serves is ready`, activeProblems.length === 0,
    activeProblems.map((p) => `${p.field}: ${p.message}`).join('; '));

  const notReady = MARKET_IDS
    .filter((id) => id !== MARKET.id)
    .map((id) => [id, marketProblems(MARKETS[id])] as const)
    .filter(([, problems]) => problems.length > 0);
  if (notReady.length) {
    const total = notReady.reduce((n, [, p]) => n + p.length, 0);
    console.log(`        (${total} undecided field(s) in ${notReady.length} `
      + 'other market(s) — they cannot boot or be released until decided)');
    for (const [id, problems] of notReady) {
      for (const p of problems) console.log(`        ${id}.${p.field} — ${p.message}`);
    }
  }
  /* ── Contradictions, which are not the same as undecided ──────────────
   * Readiness above is soft for a market this build does not serve, because a
   * market is added to the registry before its fields are settled. A field
   * that *contradicts another field* is different: nobody is part-way through
   * deciding it, it is simply wrong, and it stays wrong until somebody looks.
   * `countryInSentence: 'the USA'` beside `country: 'United States'` survived
   * a mutation run for exactly this reason — reported as tracked debt on a
   * market the suite was not serving, and printed rather than failed.
   *
   * So these are asked of every market, always. */
  for (const id of MARKET_IDS) {
    const m = MARKETS[id];
    check(`${id}'s prose country contains its stored country`,
      m.countryInSentence.toLowerCase().includes(m.country.toLowerCase()),
      `"${m.countryInSentence}" vs "${m.country}" — the page and the profile `
      + 'would name different places');
    check(`${id}'s short name is a directory-safe token`,
      /^[a-z]{2,6}$/.test(m.shortName), m.shortName);
    check(`${id}'s port is usable and its own`,
      Number.isInteger(m.port) && m.port > 1023 && m.port < 65536
      && MARKET_IDS.filter((o) => MARKETS[o].port === m.port).length === 1,
      String(m.port));
    check(`${id}'s phone example is a grouped run of digits`,
      /^\d[\d ]*\d$/.test(m.phoneExample), m.phoneExample);
    check(`${id} names a currency the platform recognises`,
      (CURRENCIES as readonly string[]).includes(m.currency), m.currency);
  }

  /* Whatever a market has not decided, it must not have *guessed*. Every field
   * is either settled or null; a market cannot be half-ready with a plausible
   * value standing in. */
  for (const id of MARKET_IDS) {
    const m = MARKETS[id];
    check(`${id} has not borrowed another market's regions`,
      m.regions === null || m.id === 'gambia'
      || JSON.stringify(m.regions) !== JSON.stringify(MARKETS.gambia.regions),
      'a region list carried over is a form a member cannot complete honestly');
  }

  /* ── The refusal, exercised against a market built to fail ─────────────
   * This used to assert that the US pilot was incomplete, which was true and
   * was the wrong assertion: it tied the mechanism's proof to a market
   * happening to be unfinished, so the day somebody decided those three values
   * the check would fail for the best possible reason. It did, this morning.
   *
   * The mechanism is what needs proving, so it is proved against a market
   * constructed here to be missing each field in turn. That assertion is true
   * now, stays true when a third market is added, and cannot be satisfied by
   * filling anything in. */
  const undecided = (patch: Partial<MarketDefinition>): MarketDefinition =>
    ({ ...MARKETS.gambia, ...patch });

  for (const field of
    ['city', 'managementFeePercent', 'rideCommissionPercent', 'regions'] as const) {
    const problems = marketProblems(undecided({ [field]: null } as never));
    check(`a market with no ${field} is refused`, problems.some((p) => p.field === field),
      'a value carried over from another market is a rate nobody set');
    check(`  and the refusal says why`, problems.some((p) => p.field === field && p.message.length > 20));
  }
  check('a fee outside 0–100 is not a fee',
    marketProblems(undecided({ managementFeePercent: 140 })).length > 0);
  check('nor is a negative one',
    marketProblems(undecided({ rideCommissionPercent: -1 })).length > 0);
  check('a dialling code without its + is refused',
    marketProblems(undecided({ diallingCode: '220' })).length > 0);
  /* An empty list satisfies "not null" and is still a dropdown with nothing in
   * it — the shape a `.filter()` or a bad merge leaves behind. */
  check('an empty region list is refused too',
    marketProblems(undecided({ regions: [] })).some((p) => p.field === 'regions'),
    'null is caught by the need() above; [] would pass it and render nothing');
  check('a short name that is not a directory-safe token is refused',
    marketProblems(undecided({ shortName: 'US pilot' })).some((p) => p.field === 'shortName'),
    'it becomes a directory, a PM2 process name and a log filename');

  // ── The two markets genuinely differ, which is the point of the registry ──
  eq('the pilot charges its own Ususu share', MARKETS.unitedStates.rideCommissionPercent, 18);
  eq('and Banjul charges its own', MARKETS.gambia.rideCommissionPercent, 15);
  check('so a market cannot borrow the other\'s rate by accident',
    MARKETS.unitedStates.rideCommissionPercent !== MARKETS.gambia.rideCommissionPercent,
    'the first number that actually differs, and the reason this is a registry');

  // ── A market cannot be selected by accident ──
  for (const bad of ['', 'Gambia', 'us', 'GAMBIA', undefined, null]) {
    let refused = false;
    try { marketFor(bad as never); } catch { refused = true; }
    check(`"${String(bad)}" is not a market`, refused,
      'a silent default is how the pilot config reaches Banjul');
  }
  eq('and a real one resolves', marketFor('unitedStates').currency, 'USD');

  // ── The published fees are the active market's, and Gambia's are unchanged ──
  eq('the published management fee is the active market\'s',
    MANAGEMENT_FEE_PERCENT, MARKET.managementFeePercent);
  eq('and the published Ususu share is too',
    RIDE_COMMISSION_PERCENT, MARKET.rideCommissionPercent);
  eq('Gambia still charges 10% of rent', MARKETS.gambia.managementFeePercent, 10);
  eq('and Ususu still takes 15% there', MARKETS.gambia.rideCommissionPercent, 15);
  eq('which is the number the ledger actually splits on',
    DEFAULT_RIDE_COMMISSION_PERCENT, RIDE_COMMISSION_PERCENT,
    );
  const pricing = readFileSync(`${frontendRoot}/public/pricing.html`, 'utf8');
  check('the pricing page states the management fee',
    pricing.includes(`${MANAGEMENT_FEE_PERCENT}% of rent collected`));
  check('and the ride commission', pricing.includes(`${RIDE_COMMISSION_PERCENT}% of each fare`));
  /* Comments stripped first. The page's own header comment records that these
   * two figures were `data-needs-confirming` badges until LRMC decided them,
   * and a sweep for the word anywhere scores that explanation as a placeholder
   * — which pushes the next person to delete the explanation rather than the
   * placeholder. The same trap was already avoided in `stage()`, which matches
   * CDN scripts by `src` rather than by name. */
  const pricingMarkup = pricing.replace(/<!--[\s\S]*?-->/g, '');
  check('and neither is still a placeholder',
    !/data-needs-confirming/.test(pricingMarkup),
    'a price nobody has confirmed is a price nobody should publish');

  // ── What is still unconfirmed, counted rather than forgotten ──
  //
  // Seven values remain. Four are legal — liability wording, jurisdiction,
  // retention periods, the supervisory authority — and are deliberately left to
  // counsel: retention periods have statutory minimums and liability wording is
  // exactly what gets tested in a dispute, so a plausible-sounding placeholder
  // written here would be worse than a visible gap.
  //
  // The other three are the registered office and telephone. A wrong address on
  // a registered-office line is worse than a gap, because people turn up.
  //
  // Counted so the number goes down deliberately rather than by accident.
  const UNCONFIRMED_PAGES: Record<string, number> = {
    'public/about.html': 1,     // registered office
    'public/contact.html': 2,   // telephone, address
    'public/privacy.html': 3,   // lawful basis, retention, supervisory authority
    'public/terms.html': 4,     // entity, company number, liability, jurisdiction
  };
  let outstanding = 0;
  for (const [page, expected] of Object.entries(UNCONFIRMED_PAGES)) {
    const text = readFileSync(`${frontendRoot}/${page}`, 'utf8');
    const found = (text.match(/data-needs-confirming/g) ?? []).length;
    outstanding += found;
    eq(`${page}: ${expected} values still to confirm`, found, expected);
  }
  /* The number, not a guessed breakdown. It read "4 legal, 3 contact" while the
   * count was 10 — a summary that disagrees with the number beside it is how a
   * tracked figure stops being read. */
  console.log(`        (${outstanding} public-page values still unconfirmed: `
    + Object.entries(UNCONFIRMED_PAGES).map(([p, n]) => `${p.replace('public/', '')} ${n}`).join(', ')
    + ')');
  // Every one must be visible to a reader, not a silent blank. Somebody landing
  // on the terms page should be able to see that a clause is unsettled.
  for (const page of Object.keys(UNCONFIRMED_PAGES)) {
    const text = readFileSync(`${frontendRoot}/${page}`, 'utf8');
    const bare = (text.match(/data-needs-confirming/g) ?? []).length;
    const badged = (text.match(/lrmc-badge-warning[^>]*data-needs-confirming/g) ?? []).length;
    check(`${page}: every unconfirmed value is visibly flagged`, badged >= bare - 1,
      'an unconfirmed value that looks confirmed is worse than a gap');
  }
}


// ═══════════════════════════════════════════════════════════════════════════
section('Contract: no name is defined twice');

// A duplicate key in an object literal is not a runtime error — the later one
// silently wins and the earlier definition is dead. Two modules both wanted
// `ResolveDisputeRequest` (an order refund, and closing a dispute against a
// person) and the published contract described one of them under the other's
// name. Nothing at runtime could see it, so this reads the source.
{
  const schemaSrc = readFileSync(
    resolve(process.cwd(), 'src/config/openapiSchemas.ts'), 'utf8');

  const mapStart = schemaSrc.indexOf('REQUEST_SCHEMA_BY_NAME');
  const registry = schemaSrc.slice(0, mapStart);
  // Any value form: several schemas are `allOf(...)` rather than a literal.
  const topLevel = [...registry.matchAll(/^  (\w+): [\{a]/gm)].map((m) => m[1]!);
  const seenSchema = new Set<string>();
  const dupSchema = topLevel.filter((k) => (seenSchema.has(k) ? true : (seenSchema.add(k), false)));
  check('no component schema name is defined twice', dupSchema.length === 0,
    dupSchema.join(', '));

  const mapBlock = schemaSrc.slice(mapStart);
  const mapKeys = [...mapBlock.matchAll(/^  (\w+): '/gm)].map((m) => m[1]!);
  const seenMap = new Set<string>();
  const dupMap = mapKeys.filter((k) => (seenMap.has(k) ? true : (seenMap.add(k), false)));
  check('no request schema is mapped twice', dupMap.length === 0, dupMap.join(', '));

  // Not checked here: that each component actually exists. `buildOpenApiDocument`
  // already throws on an unknown schema name and reports dangling $refs, and a
  // second regex-based version of that check was wrong twice before it was
  // right once.
}

// ═══════════════════════════════════════════════════════════════════════════
section('The two filter doors: client input and server decisions');

/* The defect this exists to make impossible.
 *
 * `BaseService.buildFilter` passes `params.filters` through `filterableFields`,
 * which is right: it is an allowlist for untrusted input. Three handlers then
 * used the same parameter to hand it an *authorization* clause. `$or` is not an
 * allowlisted field on any collection, so it was dropped — silently, and open.
 * `GET /payments/:userId/history` answered with the whole platform's ledger;
 * leases and maintenance did the same for every tenancy and every work order.
 *
 * The pure rules modules were correct throughout and asserted throughout. The
 * clause was right when it left `historyFilter`. It was discarded one layer
 * later, in code that only runs against a database — which is exactly the shape
 * of thing a suite with no database cannot see.
 *
 * So the assertions below are deliberately not about payments. They are about
 * the seam, and about the source text of every call site, because the next
 * module to make this mistake has not been written yet. */
{
  /* ── The seam, exercised rather than read ──────────────────────────────
   * `buildFilter` is the one piece of this that can be run without a database:
   * it takes parameters and returns a Mongo filter, and touches the model not
   * at all. So it is probed here with a stub model rather than grepped for.
   *
   * The distinction earned itself immediately. A source assertion for
   * `ApiError.internal` passed against a mutation that had disabled the throw,
   * because the identifier was still in the file. Reading source proves what
   * somebody wrote; this proves what the code does. */
  type ProbeDoc = {
    _id?: unknown; status?: string; reference?: string; owner?: string;
    secret?: string; payer?: string; payee?: string; recordedBy?: string;
  };
  class FilterProbe extends BaseService<ProbeDoc> {
    filterFor(params: ListParams, actor?: AuthenticatedActor) {
      return this.buildFilter(params, actor) as Record<string, unknown>;
    }
  }
  const probe = new FilterProbe({} as never, {
    label: 'Probe',
    filterableFields: ['status'],
    searchableFields: ['reference'],
    ownerPath: 'owner',
  });
  const owner = { userId: 'u1', accessScope: 'own' } as unknown as AuthenticatedActor;
  const json = (v: unknown) => JSON.stringify(v);

  // ── The client door is an allowlist, and an operator is not a field ──
  const viaClient = probe.filterFor({ filters: { $or: [{ a: 1 }], status: 'active' } });
  check('an operator sent as a client filter is refused entry',
    !json(viaClient).includes('"$or"'),
    'this is correct and must stay — it is why the door is the wrong one for a server clause');
  check('and an allowlisted field still passes',
    (viaClient as { status?: unknown }).status === 'active');
  const notListed = probe.filterFor({ filters: { secret: 'x' } });
  check('a field nobody allowlisted is dropped',
    !json(notListed).includes('secret'),
    'removing the allowlist makes every field on every collection queryable from a URL');

  // ── The server door carries the clause through intact ──
  const viaServer = probe.filterFor({
    serverFilters: { $or: [{ payer: 'p1' }, { payee: 'p1' }], recordedBy: 'u9' },
  });
  check('the same clause through the server door survives',
    json(viaServer).includes('"$or"') && json(viaServer).includes('recordedBy'),
    'this is the defect: as a client filter both were dropped and the query read the collection');

  // ── Two $or clauses coexist, which a spread could never do ──
  const both = probe.filterFor({
    search: 'ref-1',
    serverFilters: { $or: [{ payer: 'p1' }] },
  }, owner);
  const clauses = (both as { $and?: Record<string, unknown>[] }).$and ?? [];
  eq('a search, an authorization clause and a scope are three clauses', clauses.length, 3);
  // Spread into one object, one of these would silently replace the other.
  eq('and each keeps its own $or',
    clauses.filter((c) => '$or' in c).length, 2);

  // ── An empty server filter is a bug, and bugs here read collections ──
  let refused = false;
  try {
    probe.filterFor({ serverFilters: {} });
  } catch { refused = true; }
  check('an empty server filter throws rather than widening', refused,
    'a handler that meant to restrict and computed nothing must fail loudly');

  // ── Deliberate "match nothing" still works ──
  const denyAll = probe.filterFor({ serverFilters: { _id: null } });
  check('and DENY_ALL is still expressible', json(denyAll).includes('"_id":null'),
    'refusing an empty object must not also refuse an explicit match-nothing');

  /* ── The sweep ──
   * Every place a filter is built from something other than the query string
   * has to go through the server door. Named files rather than a walk: the
   * trimmed `@types/node` here has no `readdirSync`, and a named list fails
   * loudly when a new module appears where a walk would cover it silently. */
  const CALL_SITES: [string, string][] = [
    ['payment', 'src/modules/payment/index.ts'],
    ['lease', 'src/modules/lease/index.ts'],
    ['maintenance', 'src/modules/maintenance/index.ts'],
    ['document', 'src/modules/document/index.ts'],
    ['marketplace', 'src/modules/marketplace/index.ts'],
    ['ride', 'src/modules/ride/index.ts'],
    ['viewing', 'src/modules/viewing/index.ts'],
    ['application', 'src/modules/application/index.ts'],
    ['evidence', 'src/modules/evidence/index.ts'],
    ['stats', 'src/modules/stats/index.ts'],
    ['payout', 'src/modules/payout/index.ts'],
    ['property', 'src/modules/property/index.ts'],
  ];

  /* A Mongo operator reaching `filters:` is the signature of the bug: `$or`,
   * `$in`, `$ne` and friends are never allowlisted field names, so anything
   * carrying one through the client door is being dropped. */
  const leaked: string[] = [];
  for (const [name, path] of CALL_SITES) {
    let src: string;
    try { src = readFileSync(resolve(process.cwd(), path), 'utf8'); } catch { continue; }
    /* `filters:` followed, within one object literal, by a top-level Mongo
     * operator key. Deliberately narrow — this looks for the shape that leaked,
     * not for every use of `$or` in the file. */
    if (/filters:\s*\{[^}]*\$(or|in|ne|nin|and|gte|lte|gt|lt)\b/.test(src)) {
      leaked.push(name);
    }
  }
  check('no module passes a Mongo operator through the client filter door',
    leaked.length === 0, leaked.join(', '));

  /* The three that leaked, named individually, so a revert shows up as three
   * failures with the endpoint in the message rather than one generic one. */
  for (const [name, path, needle] of [
    ['payments history', 'src/modules/payment/index.ts', 'serverFilters: filters'],
    ['lease history', 'src/modules/lease/index.ts', 'serverFilters: {'],
    ['maintenance history', 'src/modules/maintenance/index.ts', 'serverFilters: filters'],
  ] as [string, string, string][]) {
    const src = readFileSync(resolve(process.cwd(), path), 'utf8');
    check(`${name} sends its authorization clause through the server door`,
      src.includes(needle),
      'this endpoint returned the whole collection when the clause went through the allowlist');
  }

  /* The reviewer-desk narrowing. This one was not a dropped clause — it was a
   * restriction computed and then overwritten by the caller's own parameter on
   * the very next line, which is the same failure wearing different clothes. */
  const documentSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/document/index.ts'), 'utf8');
  check('a reviewer cannot widen their own desk allowlist with ?desk=',
    /allowedDesks\.includes\(requestedDesk\)[\s\S]{0,120}ApiError\.forbidden/.test(documentSrc),
    'the queue restriction was computed and then replaced by req.query.desk');
  check('and asking for somebody else\'s desk is refused, not silently emptied',
    /not one of your review desks/.test(documentSrc),
    'an empty queue reads as "no work waiting", which is a different answer');
}


// ═══════════════════════════════════════════════════════════════════════════
section('Rides: whose trip this is');

/* `requirePermission('ride:update')` was the only gate on `/start`, `/complete`
 * and `/cancel`. Three roles hold that grant — driver and rider among them — so
 * any Ususu member who could name a rideId could close two strangers' trip, and
 * `/complete` takes the fare from the request body.
 *
 * A permission says what kind of thing you may do. It cannot say whose. The
 * fourth gate is the one that answers that, and it was absent on three of four
 * transitions while being present on the fourth. */
{
  const rideSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/ride/index.ts'), 'utf8');

  check('the party on a ride is resolved from the ride, not from a role',
    /async function partyOn\([\s\S]{0,600}String\(ride\.driver\) === String\(driver\._id\)/.test(rideSrc),
    'holding the driver role says nothing about being *this* ride\'s driver');
  check('and both profiles are looked up, because one person can be either',
    /DriverProfile\.findOne[\s\S]{0,300}RiderProfile\.findOne/.test(rideSrc),
    'actor.profileId is one profile; a driver takes rides home like anyone else');

  check('starting a trip is the driver\'s move', /\}\), 'driver'\)/.test(rideSrc));
  check('completing it is the driver\'s move',
    /Only the driver on this ride[\s\S]{0,4000}canTransition\(ride\.status, 'completed'\)/.test(rideSrc)
    || /requireParty\(ride, actor\.userId, 'driver'\)[\s\S]{0,400}'completed'/.test(rideSrc),
    'the fare comes from the request body, so whoever may call this decides what a rider pays');
  check('either party may cancel', /requireParty\(ride, actor\.userId, 'either'\)/.test(rideSrc));

  /* Which cancellation it is comes from the ride. Read from `actor.roles`, a
   * person holding both roles who cancelled a ride they had *booked* was
   * recorded as a driver cancellation — on a stranger's driver record. */
  check('and which cancellation it is comes from the ride, not the caller\'s roles',
    /const to = party === 'driver'/.test(rideSrc));
  check('no ride decision reads roles to decide whose ride it is',
    !/actor\.roles\.includes\('driver'\) \? 'cancelledByDriver'/.test(rideSrc));

  /* A stranger gets 404, a wrong-party gets 403. The difference matters: a 403
   * on an id confirms the ride exists, and ids are walkable. */
  check('a stranger is told the ride does not exist',
    /if \(!party\) throw ApiError\.notFound\('Ride'\)/.test(rideSrc),
    'a 403 on a ride id lets somebody map the platform\'s trips by walking ids');

  // The fare's denomination is the ride's, and the field is refused rather
  // than accepted-and-ignored.
  const rideValidation = readFileSync(
    resolve(process.cwd(), 'src/modules/ride/ride.validation.ts'), 'utf8');
  check('a completing driver cannot name the currency',
    !/currency: zCurrency\.optional\(\),\n\s+distanceKm/.test(rideValidation),
    'there is no exchange rate on this platform with which to notice a re-denominated fare');
  check('and the ledger row takes the ride\'s currency',
    /currency: ride\.currency,/.test(rideSrc) && !/body\.currency/.test(rideSrc));

  // `/accept` is the one transition with no party check, because the caller is
  // claiming the ride rather than acting on one they are already on.
  check('accepting is still open to a verified driver who is not yet on the ride',
    /Only a verified driver can accept a ride/.test(rideSrc));
}


// ═══════════════════════════════════════════════════════════════════════════
section('Sessions, credentials, and the things one command can undo');

{
  // ── Refresh rotation ──
  // `refresh` read the denylist and never wrote to it, so the presented token
  // stayed valid for its full thirty days and could be redeemed without limit
  // while each redemption minted another beside it. Sign-out denies one `jti`
  // — the one presented — so any session that had ever refreshed could not be
  // ended at all.
  const authSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/auth/auth.service.ts'), 'utf8');
  const refreshBody = authSrc.slice(
    authSrc.indexOf('export async function refresh('),
    authSrc.indexOf('export async function changePassword('),
  );
  check('refresh revokes the token it consumed', /RevokedToken\.updateOne/.test(refreshBody),
    'without this a stolen refresh token is a permanent account nobody can close');
  check('and does so before issuing the replacement',
    refreshBody.indexOf('RevokedToken.updateOne') < refreshBody.indexOf('return tokensFor'),
    'revoking after issuing means a failure costs the caller both tokens');
  check('rotation is recorded as its own reason, not as a sign-out',
    /reason: 'rotated'/.test(refreshBody),
    'an audit trail saying somebody signed out forty times tells the wrong story about a browser');
  check('and "rotated" is a declared revocation reason',
    (REVOCATION_REASONS as readonly string[]).includes('rotated'));
  check('a token with no jti or no expiry is logged rather than passed over',
    /could not rotate/.test(refreshBody),
    'it means one refresh token on this platform is not single-use, which is worth knowing');

  // ── The marketplace observer branch ──
  const marketSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/marketplace/index.ts'), 'utf8');
  check('the overview refuses a caller with no marketplace account',
    /if \(!merchant && !customer\) \{[\s\S]{0,120}ApiError\.forbidden/.test(marketSrc),
    'it fell through to { deletedAt: null } and answered with the whole order book');

  /* The other half. The refusal alone would have locked every self-registered
   * merchant out permanently, because registration built them no profile — an
   * account and the profile that scopes it must not be able to exist apart. */
  for (const role of ['merchant', 'customer'] as const) {
    check(`a self-registering ${role} gets a profile`,
      new RegExp(`  ${role}: \\{[\\s\\S]{0,80}model: `).test(authSrc),
      'a role that can sign up with no profile lands in whatever branch means "unscoped"');
  }
  const selfRegisterable = readFileSync(
    resolve(process.cwd(), 'src/config/registration.ts'), 'utf8');
  const declared = [...selfRegisterable.matchAll(/^\s+'(\w+)',$/gm)].map((m) => m[1]!);
  const withoutFactory = declared.filter(
    (r) => r !== 'publicUser' && !new RegExp(`\\n  ${r}: \\{`).test(authSrc),
  );
  check('every self-registerable role has a profile factory',
    withoutFactory.length === 0, withoutFactory.join(', '));

  // ── The FAC attempt window ──
  const facSrc = readFileSync(resolve(process.cwd(), 'src/modules/fac/index.ts'), 'utf8');
  check('the lockout reads the newest attempts, not the oldest',
    /\.sort\('-at'\)/.test(facSrc),
    'ascending with a limit froze the window at 200 rows and the lockout never fired again');
  check('and reverses them into the order the arithmetic expects',
    /rows\.reverse\(\)/.test(facSrc),
    'sorting descending without reversing feeds consecutiveFailures backwards');

  // ── The seed script ──
  const seedSrc = readFileSync(resolve(process.cwd(), 'src/scripts/seed.ts'), 'utf8');
  check('seeding refuses to run in production',
    /if \(env\.isProduction\) \{[\s\S]{0,200}throw new Error/.test(seedSrc),
    'it creates a founder account and connects to whatever MONGO_URI points at');
  check('and has no default password',
    !/SEED_PASSWORD \?\?/.test(seedSrc) && /SEED_PASSWORD is required/.test(seedSrc),
    'the previous default was a literal in this file and printed to the console on completion');
  /* Both guards at module scope, so importing the file cannot arm them either. */
  check('both refusals run before anything is read or written',
    seedSrc.indexOf('env.isProduction') < seedSrc.indexOf('async function seed('),
    'a guard inside seed() is a guard an import can walk past');

  // ── The ports the two halves of the deployment agree on ──
  // Individually correct files, collectively a 502 on every API call, with
  // nothing anywhere saying why. Exactly the kind of thing a per-file suite
  // cannot see.
  //
  // This used to assert *one* upstream. Two markets makes that assertion wrong
  // in the direction that matters: it would have passed on the day somebody
  // added the pilot's block with Banjul's port in it, because one port is
  // exactly what that mistake produces.
  const envSrc = readFileSync(resolve(process.cwd(), 'src/config/env.ts'), 'utf8');
  const appPort = envSrc.match(/PORT: z\.coerce\.number\(\)\.int\(\)\.positive\(\)\.default\((\d+)\)/)?.[1];
  const nginx = readFileSync(
    resolve(process.cwd(), '../frontend/deploy/nginx.conf'), 'utf8');
  const upstreams = [...new Set(
    [...nginx.matchAll(/proxy_pass\s+http:\/\/127\.0\.0\.1:(\d+)/g)].map((m) => m[1]!),
  )];

  /* Distinct first. Two markets on one port is not a config error that shows
   * up as a warning — the second process binds, fails, and PM2 retries it ten
   * times while the first one serves both hostnames from one database. */
  const marketList = MARKET_IDS.map((id) => MARKETS[id]);
  const portsDeclared = marketList.map((m) => m.port);
  eq('every market declares its own port',
    new Set(portsDeclared).size, portsDeclared.length);

  for (const market of marketList) {
    check(`nginx proxies to ${market.id} on ${market.port}`,
      upstreams.includes(String(market.port)),
      `the registry puts ${market.id} on ${market.port}; nginx proxies to `
      + `${upstreams.join(', ')}`);
  }
  /* And the other direction. An upstream belonging to no market is a block
   * pointed at a process nothing starts. */
  const orphanUpstreams = upstreams.filter(
    (p) => !portsDeclared.includes(Number(p)));
  check('and to nothing else', orphanUpstreams.length === 0,
    `nginx proxies to ${orphanUpstreams.join(', ')}, which no market declares`);

  /* `env.ts`'s default is the market a developer gets without an env var, and
   * `marketFor` defaults to gambia. The two defaults have to be the same one. */
  eq('the PORT default is the default market\'s', appPort, String(MARKETS.gambia.port));

  const envExample = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
  check('the example file agrees too',
    new RegExp(`^PORT=${MARKETS.gambia.port}$`, 'm').test(envExample),
    'the example is what somebody copies on deployment day');

  // ── The short name, in the six places it is written by hand ──
  // `us` and `gm` name a PM2 process, a release directory, two log files, an
  // nginx root and a `case` arm in each shell script. None of those files can
  // see any other. A `case` arm that maps unitedStates to `gm` does not fail:
  // it reads Banjul's release list, finds releases, and relinks Banjul's code
  // when somebody asked to roll back Casper.
  const ecosystem = readFileSync(
    resolve(process.cwd(), '../deploy/ecosystem.config.cjs'), 'utf8');
  const releaseSh = readFileSync(resolve(process.cwd(), '../deploy/release.sh'), 'utf8');
  const rollbackSh = readFileSync(resolve(process.cwd(), '../deploy/rollback.sh'), 'utf8');

  const shortNames = marketList.map((m) => m.shortName);
  eq('every market has its own short name', new Set(shortNames).size, shortNames.length);

  for (const market of marketList) {
    const { id, shortName } = market;
    check(`PM2 names ${id} lrmc-${shortName}`,
      new RegExp(`app\\('${id}',\\s*'${shortName}'\\)`).test(ecosystem),
      'the ecosystem file is what --only refers to');
    for (const [file, src] of [
      ['release.sh', releaseSh], ['rollback.sh', rollbackSh],
    ] as [string, string][]) {
      check(`${file} maps ${id} to ${shortName}`,
        new RegExp(`${id}\\)\\s*SHORT=${shortName}\\s`).test(src),
        'a case arm pointing at the other market\'s release directory finds '
        + 'releases there and relinks them');
    }
    check(`nginx serves ${id} from its release directory`,
      nginx.includes(`root /srv/lrmc/${shortName}/current/frontend;`),
      'a root outside the release serves whatever was copied there by hand — '
      + 'the other market\'s currency, and a rollback does not undo it');
  }

  // ── The two market blocks have not drifted apart ──
  // The pilot's block is a copy of Banjul's with one number changed. The thing
  // copies do is diverge: somebody tightens a header on the block they were
  // looking at. Every header is asserted below against the *other* block rather
  // than against a list here, so a header added to one is required in both
  // without anybody remembering to add it to this file.
  const serverBlocks = nginx.split(/\nserver \{/).slice(1);
  const blockFor = new Map<string, string>();
  for (const block of serverBlocks) {
    const root = block.match(/root \/srv\/lrmc\/(\w+)\/current\/frontend;/);
    if (root) blockFor.set(root[1]!, block);
  }
  eq('each market has exactly one server block', blockFor.size, marketList.length);

  const directives = (block: string, name: string) =>
    new Set([...block.matchAll(new RegExp(`^\\s*${name}\\s+(\\S+)`, 'gm'))]
      .map((m) => m[1]!));

  const [first, ...rest] = marketList;
  for (const other of rest) {
    const a = blockFor.get(first!.shortName) ?? '';
    const b = blockFor.get(other.shortName) ?? '';
    for (const directive of ['add_header', 'proxy_set_header']) {
      const inA = directives(a, directive);
      const inB = directives(b, directive);
      const onlyA = [...inA].filter((h) => !inB.has(h));
      const onlyB = [...inB].filter((h) => !inA.has(h));
      check(`${first!.shortName} and ${other.shortName} set the same ${directive}s`,
        onlyA.length === 0 && onlyB.length === 0,
        `${first!.shortName} only: ${onlyA.join(', ') || 'none'}; `
        + `${other.shortName} only: ${onlyB.join(', ') || 'none'}`);
    }
    /* The fallback rule is the one this file's own header warns about, and it
     * is per-block. One block with a catch-all is one market where every dead
     * link is a 200. */
    for (const [name, block] of [[first!.shortName, a], [other.shortName, b]] as [string, string][]) {
      check(`${name} still has no catch-all fallback`,
        !/try_files[^;]*\/index\.html;/.test(block.replace(/\$uri\/index\.html/g, '')),
        'a blanket fallback turns every typo into a 200 serving the wrong page');
    }
  }

  // ── Indexes exist where they are load-bearing ──
  // `autoIndex: !env.isProduction` is right, and for weeks nothing then built
  // them, because the deploy pipeline the comment referred to did not exist. On
  // a production box no index existed beyond `_id` — and this codebase uses
  // unique indexes as concurrency control, not as tuning.
  /* Comments stripped from both. This codebase quotes code in its prose — it is
   * why the comments are worth reading — and a source assertion that greps the
   * whole file is really asking whether somebody *wrote about* the line, not
   * whether the line is there. Two assertions in this section passed against
   * mutations for exactly that reason before this was added. */
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const dbSrc = stripComments(
    readFileSync(resolve(process.cwd(), 'src/config/database.ts'), 'utf8'));
  const serverSrc = stripComments(
    readFileSync(resolve(process.cwd(), 'src/server.ts'), 'utf8'));
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as
    { scripts?: Record<string, string> };

  check('production still does not build indexes at boot',
    /autoIndex: !env\.isProduction/.test(dbSrc),
    'two servers racing to build indexes, on a boot a load balancer is waiting on');
  check('but something exists that does', typeof pkg.scripts?.migrate === 'string',
    'syncIndexes was exported for a deploy pipeline that was never written');
  check('and production refuses to serve traffic without them',
    /if \(env\.isProduction\) await assertIndexesBuilt\(\)/.test(serverSrc),
    'starting anyway means every uniqueness guard is silently inert');
  /* Looks, never syncs: `syncIndexes` also *drops* indexes no longer declared,
   * which is not a thing to do at boot while taking traffic. */
  check('the boot check only looks',
    !/syncIndexes/.test(serverSrc),
    'syncIndexes drops indexes no longer declared — that is a migration, not a boot step');

  // ── The release: the order is the whole design ──
  // Every one of these is a step somebody could move, and moving any of them
  // turns a refused release into a broken one. `verify` after the cutover means
  // members find the failure. `migrate` after it means the new code boots
  // against indexes it does not have — and `assertIndexesBuilt` refuses, which
  // is the *good* case. The bad case is a release that skipped step 6 entirely
  // and reports success while the service is down.
  /* Against the code, not the prose. `release.sh` opens with a numbered
   * description of these very steps in the right order, so an ordering
   * assertion that greps the whole file passes by reading the comment that
   * says what the script *should* do. That is the third time this codebase has
   * been caught asserting against its own documentation. */
  const releaseCode = releaseSh.split('\n')
    .filter((l) => !l.trimStart().startsWith('#')).join('\n');

  /* Each step is located by a pattern that must match **once**. `npm run
   * verify` appears twice — the backend's and the SDK's — and an `indexOf` on
   * it silently measures whichever comes first. A mutation that moved the
   * backend's verify past the cutover survived this suite for exactly that
   * reason: the assertion was still reading the SDK line, in its original
   * place, and passing. Ambiguity in a needle is the assertion measuring
   * something other than what it names. */
  const stepAt = (label: string, pattern: RegExp): number => {
    const hits = [...releaseCode.matchAll(new RegExp(pattern.source, 'gm'))];
    check(`release.sh names "${label}" exactly once`, hits.length === 1,
      `${hits.length} matches — an ordering assertion cannot say which one it measured`);
    return hits.length === 1 ? hits[0]!.index! : -1;
  };
  const ORDER: [string, RegExp, string][] = [
    ['preflight', /^npm run preflight -- "\$MARKET"$/,
      'configuration is read before anything is built'],
    ['build', /^npm run build$/, 'the build happens before the suites run against it'],
    ['verify', /^npm run verify$/, 'the suites run before a release is staged'],
    ['stage', /^mkdir -p "\$TARGET"$/, 'the release is staged before the database is touched'],
    ['migrate', /dist\/scripts\/migrate\.js/, 'indexes exist before the new code serves traffic'],
    ['cut over', /^ln -sfn "\$TARGET" "\$CURRENT"$/, 'the cutover is the last thing that can fail'],
    ['health', /curl [^\n]*\/healthz/, 'and health is checked after it'],
  ];
  const positions = ORDER.map(([label, pattern]) => stepAt(label, pattern));
  for (let i = 1; i < ORDER.length; i += 1) {
    const [label, , why] = ORDER[i]!;
    const [beforeLabel] = ORDER[i - 1]!;
    check(`release.sh: ${why}`,
      positions[i - 1]! >= 0 && positions[i]! > positions[i - 1]!,
      `"${beforeLabel}" must come before "${label}" in deploy/release.sh`);
  }
  const step = (needle: string) => releaseCode.indexOf(needle);

  check('release.sh verifies as the market it is releasing',
    /export LRMC_MARKET="\$MARKET"/.test(releaseCode)
    && releaseCode.indexOf('export LRMC_MARKET') < releaseCode.indexOf('npm run verify'),
    'without it the suite defaults to gambia, and the pilot\'s release checks '
    + 'Banjul\'s constants against Casper\'s pages');
  check('and builds the pages before it verifies them',
    releaseCode.indexOf('build-public-pages.py') < releaseCode.indexOf('npm run verify'),
    'verifying pages the build has not written yet checks the previous release');

  check('release.sh stops at the first failure',
    /^set -euo pipefail$/m.test(releaseSh),
    'without it a failed build is a warning and the cutover happens anyway');
  check('and rolls back by itself when health never comes',
    /healthy" -ne 1/.test(releaseSh) && /ln -sfn "\$PREVIOUS" "\$CURRENT"/.test(releaseSh),
    'a deploy script that ends at "reload" reports success while the service is down');
  check('the public pages are built for the market being released',
    /LRMC_MARKET="\$MARKET" python3 build-public-pages\.py/.test(releaseSh),
    'skipping it serves the other market\'s currency and fee from static files');
  check('and the market is written into the release',
    /echo "\$MARKET" > "\$TARGET\/MARKET"/.test(releaseSh),
    'without it nothing downstream can tell which market a release was built for');
  check('which is what rollback.sh refuses on',
    /BUILT_FOR="\$\(cat "\$TARGET\/MARKET"/.test(rollbackSh)
    && /if \[ "\$BUILT_FOR" != "\$MARKET" \]/.test(rollbackSh),
    'relinking the other market\'s release quotes Casper in dalasi');
  check('rollback.sh checks health too',
    /\/healthz/.test(rollbackSh),
    'a rollback that does not come up is a rollback nobody was told about');
  /* Positive, on prose: the one thing a rollback script must say out loud is
   * the thing it cannot do. */
  check('and says plainly that it does not undo the database',
    /does \*\*not\*\* undo the database/.test(rollbackSh),
    'a rollback script that implies the database came with it is worse than none');

  // ── PM2 holds the process to what the process asked for ──
  const shutdownMs = Number(serverSrc.match(/\}, (\d+)_?(\d*)\);/)?.[0]
    ?.replace(/\D/g, '') ?? 0);
  const killTimeout = Number(ecosystem.match(/kill_timeout: (\d+)/)?.[1] ?? 0);
  check('PM2 waits longer than the process takes to give up',
    killTimeout > shutdownMs,
    `kill_timeout ${killTimeout}ms vs a forced exit at ${shutdownMs}ms — SIGKILL `
    + 'first means in-flight requests are cut rather than drained');
  check('one instance per market, not a cluster',
    /instances: 1/.test(ecosystem) && /exec_mode: 'fork'/.test(ecosystem),
    'the rate limiter, the abuse ring buffer and the error store are in-process; '
    + 'under cluster mode each worker sees a fraction of the traffic');
  check('and PM2 gives up rather than looping on a permanent refusal',
    /max_restarts: \d+/.test(ecosystem),
    'the boot refusals are permanent — restarting will not fix a bad secret');
  check('secrets reach PM2 from a file that is not committed',
    /env_file: `\.env\.\$\{marketId\}`/.test(ecosystem)
    && !/JWT_SECRET|MONGO_URI|STRIPE_SECRET/.test(ecosystem),
    'an `env` block with a secret in it is a secret in the repository');

  // ── Preflight asks about everything a boot would refuse on ──
  // The boot refusals are correct and they arrive after the symlink has moved.
  // Preflight asks the same questions first — so anything env.ts learns to
  // refuse, preflight has to learn to ask.
  const preflightSrc = readFileSync(
    resolve(process.cwd(), 'src/scripts/preflight.ts'), 'utf8');
  for (const key of ['LRMC_MARKET', 'MONGO_URI', 'JWT_SECRET', 'FAC_PEPPER',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PORT', 'NODE_ENV']) {
    check(`preflight requires ${key}`,
      new RegExp(`'${key}'`).test(preflightSrc.slice(
        preflightSrc.indexOf('const REQUIRED'),
        preflightSrc.indexOf('function checkOne'))),
      'a variable the process refuses to boot without, discovered after the cutover');
  }
  /* The check no single process can make. Each deployment is blind to the
   * other, so a copied `.env` is silent in both. */
  for (const key of ['MONGO_URI', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'JWT_SECRET', 'FAC_PEPPER', 'PORT']) {
    check(`preflight refuses the markets sharing ${key}`,
      new RegExp(`\\['${key}',`).test(preflightSrc),
      'the second .env is always made from the first, and every one of these '
      + 'is silent when copied');
  }
  check('preflight reads configuration and changes nothing',
    !/writeFileSync|mkdirSync|rmSync|unlinkSync/.test(preflightSrc),
    'a check that repairs is a check that hides what it repaired');
  check('and release.sh runs it before it builds',
    step('npm run preflight') >= 0 && step('npm run preflight') < step('npm run build'),
    'the point of preflight is that nothing has moved yet');

  // ── Market data in files that are not generated ──
  // Three files held their own copy of The Gambia's eight regions and one held
  // `+220` as a phone placeholder. None of them knew which market they were
  // built for, so `LRMC_MARKET=unitedStates python3 build-public-pages.py`
  // succeeded and produced a registration form offering a Casper landlord a
  // choice between Banjul, Kanifing and Brikama. Nothing failed. The pages
  // looked finished. That is the whole reason this registry exists, arriving
  // from a direction it had not been pointed at.
  //
  // The builder now writes all three from `markets.ts`. These assertions are
  // what stop somebody editing one of them back by hand — the committed state
  // is the gambia build, because gambia is what the builder defaults to.
  /* Against the **active** market, not gambia. The pages on disk were built by
   * `build-public-pages.py` for whichever market `LRMC_MARKET` names, and so
   * was this suite's `MARKET`. Pinning these to gambia would have meant the US
   * pilot's release verified the Gambia market's pages — which is how "Serving
   * The Gambia" survived in the footer of every page of the Casper build while
   * the suite reported success. `deploy/release.sh` exports `LRMC_MARKET` for
   * exactly this reason. */
  const gm = MARKET;
  const gmRegions = gm.regions ?? [];
  check('the active market has regions to build from', gmRegions.length > 0);

  const regionSites: [string, RegExp][] = [
    ['../frontend/public/register.html', /var REGIONS = \[\n((?:.*\n)*?)\];/],
    ['../frontend/assets/js/properties.js', /var REGIONS = \[\n((?:.*\n)*?)\s*\];/],
  ];
  for (const [rel, pattern] of regionSites) {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    const body = src.match(pattern)?.[1] ?? '';
    const found = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    check(`${rel.split('/').pop()} lists the market's regions, in order`,
      found.length === gmRegions.length && found.every((r, i) => r === gmRegions[i]),
      `found [${found.join(', ')}]; the registry says [${gmRegions.join(', ')}]`);
  }

  const registerHtml = readFileSync(
    resolve(process.cwd(), '../frontend/public/register.html'), 'utf8');
  /* Code *and* shape. Changing only the code would give Casper `+1 000 0000`,
   * three digits short of a US number and looking deliberate rather than
   * wrong. */
  check('the phone placeholder uses the market\'s dialling code and digit grouping',
    registerHtml.includes(`placeholder="${gm.diallingCode} ${gm.phoneExample}"`),
    'a US member prompted for a +220 number, or for seven digits, is the '
    + 'registry ignored');

  /* The currency a landlord is offered first. A dropdown opening on the other
   * market's currency is Casper rent listed in dalasi by somebody who did not
   * think to change it — money, silently wrong, from a default. */
  const propertiesJs = readFileSync(
    resolve(process.cwd(), '../frontend/assets/js/properties.js'), 'utf8');
  const firstCurrency = propertiesJs
    .match(/currencies: function \(\) \{ return \[\['(\w+)'/)?.[1];
  eq('the listing currency dropdown opens on this market\'s currency',
    firstCurrency, gm.currency);

  /* And the pricing page says which currency its figures are in, using this
   * market's name and symbol. */
  const pricingHtml = readFileSync(
    resolve(process.cwd(), '../frontend/public/pricing.html'), 'utf8');
  check('the pricing page states the market\'s currency and symbol',
    pricingHtml.includes(`(${CURRENCY_SYMBOLS[gm.currency]}).`)
    && new RegExp(`All figures in [^(]+\\(\\${CURRENCY_SYMBOLS[gm.currency]}\\)`)
      .test(pricingHtml),
    'the page publishes what LRMC charges; a currency from another market makes '
    + 'every number on it a different amount');

  /* ── The sweep, which is what would have found all of the above at once ──
   * Each of these was a separate discovery: the region list, then the phone
   * placeholder, then the pricing prose, then the currency dropdown. Four
   * rounds of "and also this one", which is the signature of checking rather
   * than sweeping.
   *
   * So: no shipped page or script may name the *other* market's country, its
   * dialling code, or any of its regions, outside a comment. Comments are
   * excluded because this codebase explains itself in prose and a negative
   * assertion over prose is a trap this project has already sprung six times.
   *
   * The currency *names* are deliberately not swept — every market offers all
   * four currencies to a landlord letting property abroad, and that list is
   * correct in both. */
  const SHIPPED = [
    'public/register.html', 'public/properties.html', 'public/index.html',
    'public/pricing.html', 'public/about.html', 'public/contact.html',
    'public/terms.html', 'public/privacy.html',
    'assets/js/properties.js', 'assets/js/ui.js', 'assets/js/auth.js',
  ];
  const stripAllComments = (s: string) => s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*/gm, '');
  const otherMarkets = marketList.filter((m) => m.id !== gm.id);
  /* Read without a try/catch. The first draft of this loop had one, and it
   * swallowed a `ReferenceError` on an out-of-scope path variable — every file
   * was skipped, every assertion passed, and the sweep proved nothing while
   * reporting eleven successes. A sweep that can quietly cover nothing is
   * worse than no sweep. */
  const shippedRoot = resolve(process.cwd(), '../frontend');
  for (const file of SHIPPED) {
    const body = stripAllComments(readFileSync(`${shippedRoot}/${file}`, 'utf8'));
    /* The positive control. A sweep's whole value is that it read the file, and
     * nothing else here can tell the difference between "no leaks" and "no
     * bytes" — which is exactly how the first draft passed eleven times while
     * reading nothing. Every one of these files is thousands of characters;
     * five hundred is far below any of them and far above empty. */
    check(`${file} was actually read`, body.length > 500,
      `${body.length} characters after stripping comments — a sweep over an `
      + 'empty string reports success and proves nothing');
    const leaks: string[] = [];
    for (const other of otherMarkets) {
      for (const term of [other.country, ...(other.regions ?? [])]) {
        if (body.includes(term)) leaks.push(`${other.id}: "${term}"`);
      }
      /* A dialling code as *displayed* — the code, a space, then a digit.
       * A bare `includes('+1')` would match `i+1` in any script, and an
       * assertion that fires on arithmetic is one somebody deletes. */
      const shown = new RegExp(`\\${other.diallingCode} \\d`);
      if (shown.test(body)) leaks.push(`${other.id}: "${other.diallingCode} …"`);
    }
    check(`${file} carries no other market's places or dialling code`,
      leaks.length === 0, leaks.join(', '));
  }
  const aboutHtml = readFileSync(
    resolve(process.cwd(), '../frontend/public/about.html'), 'utf8');
  check('the about page names the market\'s country and every region',
    aboutHtml.includes(`${gm.country} is the launch market`)
    && gmRegions.every((r) => aboutHtml.includes(r)),
    'the "Where LRMC operates" paragraph is generated; a hand edit is a page '
    + 'that disagrees with the form beside it');

  /* And the builder must refuse rather than borrow. This is the assertion the
   * whole section exists for: a builder that fell back to another market's
   * list would publish a form nobody could complete, and the build would say
   * "done". */
  const builderSrc = readFileSync(
    resolve(process.cwd(), '../frontend/build-public-pages.py'), 'utf8');
  check('the page builder reads the regions from the registry',
    /regions:\\s\*\\\[/.test(builderSrc) || /regions:/.test(builderSrc),
    'a hardcoded list in the builder is a fourth copy');
  check('and stops when a market has not decided them',
    /raise SystemExit/.test(builderSrc) && /has not decided its regions/.test(builderSrc),
    'a build that succeeds with the other market\'s regions is the failure this '
    + 'registry was written to end');
  check('every in-place rewrite must match exactly once',
    /assert hits == 1/.test(builderSrc),
    'a rewrite that matches nothing leaves the old market\'s data and still '
    + 'reports success');

  // ── The template the runbook tells you to copy has to be in the repository ──
  // `.env.example.market` is un-ignored in the root `.gitignore`. That was not
  // enough: `backend/.gitignore` also says `.env.*`, a nested ignore file wins
  // for everything beneath it, and the negation was in the wrong one. The file
  // sat untracked and invisible — an ignored file does not appear in
  // `git status` — so the first person to clone this on a server would have
  // followed section 0 of the runbook to a file that was not there.
  const rootIgnore = readFileSync(resolve(process.cwd(), '../.gitignore'), 'utf8');
  const backendIgnore = readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8');
  const marketTemplate = readFileSync(
    resolve(process.cwd(), '.env.example.market'), 'utf8');
  check('the per-market env template exists', marketTemplate.length > 0);
  check('and nothing ignores it',
    /^!\.env\.example\.market$/m.test(backendIgnore),
    'the root .gitignore un-ignores it and backend/.gitignore re-ignores it; the '
    + 'nested file wins, and an ignored file is not in git status either');
  /* And the negations that matter are in both, for the same reason. */
  for (const pattern of ['!.env.example', '!.env.example.market']) {
    check(`both ignore files agree on ${pattern}`,
      rootIgnore.includes(pattern) && backendIgnore.includes(pattern),
      'a negation in the outer file is undone by a pattern in the inner one');
  }
  /* The template must not carry anything real. It is the file people copy. */
  for (const forbidden of [/sk_live_[A-Za-z0-9]{6,}/, /mongodb(\+srv)?:\/\/[^\s]*@/]) {
    check(`the template holds no ${forbidden.source.slice(0, 12)}… value`,
      !forbidden.test(marketTemplate),
      'a real key in a tracked example is a key in the git history');
  }

  // ── The runbook is read at 3am, so it is checked like code ──
  // It opens with a table of ports, process names, release directories and
  // currencies — which is the registry, copied out by hand. A runbook that is
  // wrong is worse than no runbook: it is followed. So every cell in that table
  // is asserted against `markets.ts`, and the columns are in `MARKET_IDS`
  // order, which is the order the table is written in.
  const runbook = readFileSync(resolve(process.cwd(), '../docs/RUNBOOK.md'), 'utf8');
  const row = (label: string): string[] => {
    const line = runbook.split('\n').find((l) => l.startsWith(`| ${label} |`));
    if (!line) return [];
    return line.split('|').slice(2, -1).map((c) => c.trim());
  };
  const TABLE: [string, (m: MarketDefinition) => string][] = [
    ['market id', (m) => `\`${m.id}\``],
    ['short name', (m) => `\`${m.shortName}\``],
    ['port', (m) => String(m.port)],
    ['PM2 process', (m) => `\`lrmc-${m.shortName}\``],
    ['releases', (m) => `\`/srv/lrmc/${m.shortName}/releases\``],
    ['live symlink', (m) => `\`/srv/lrmc/${m.shortName}/current\``],
    ['env file', (m) => `\`backend/.env.${m.id}\``],
    ['logs', (m) => `\`/var/log/lrmc/${m.shortName}.*.log\``],
  ];
  for (const [label, expected] of TABLE) {
    const cells = row(label);
    check(`the runbook's "${label}" row is the registry's`,
      cells.length === marketList.length
      && marketList.every((m, i) => cells[i] === expected(m)),
      `runbook says [${cells.join(' | ')}]; the registry says `
      + `[${marketList.map(expected).join(' | ')}]`);
  }
  /* Bolded in the table, so the cell is `**USD**` rather than `USD`. */
  const currencyRow = row('currency');
  check('the runbook names each market\'s currency',
    currencyRow.length === marketList.length
    && marketList.every((m, i) => (currencyRow[i] ?? '').includes(m.currency)),
    `runbook says [${currencyRow.join(' | ')}]`);
  const commissionRow = row('ride commission');
  check('and each market\'s ride commission',
    commissionRow.length === marketList.length
    && marketList.every((m, i) => (commissionRow[i] ?? '') === `${m.rideCommissionPercent}%`),
    'the 18/15 split is the reason the registry exists; a runbook that states it '
    + 'wrongly is a runbook somebody reconfigures from');

  /* The webhook endpoint an operator pastes into the Stripe dashboard. Wrong by
   * one segment and every event 404s, which looks exactly like Stripe being
   * down. */
  const appSrc = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8');
  const prefix = envSrc.match(/API_PREFIX: z\.string\(\)\.default\('([^']+)'\)/)?.[1];
  check('the runbook gives the webhook path the app actually mounts',
    typeof prefix === 'string'
    && runbook.includes(`${prefix}/payments/webhooks/stripe`)
    && appSrc.includes(`\${env.API_PREFIX}/payments/webhooks/stripe`),
    'a wrong path 404s every event and looks like Stripe being down');
  for (const type of HANDLED_EVENT_TYPES) {
    check(`the runbook tells the operator to subscribe ${type}`,
      runbook.includes(type),
      'an event the code handles and nobody subscribed is an order that never settles');
  }
}


// ═══════════════════════════════════════════════════════════════════════════
section('Phantom paths: conditions Mongoose silently deletes');

/* `mongoose.set('strictQuery', true)` strips a query condition naming a path
 * the schema does not have. Not an error, not a warning — removed.
 *
 * `maintenanceScopeFor` asked for `Property.find({ landlord: { $in: mine } })`.
 * `Property` has no `landlord`: ownership is polymorphic, `ownerKind` + `owner`,
 * because a building can belong to a landlord, a hotel or a resort. So what ran
 * was `Property.find({ deletedAt: null })` — every building on the platform —
 * and all of their ids went into the caller's ownership clause. Any member
 * reaching that scope read every maintenance request LRMC holds.
 *
 * The same shape as the filter-allowlist defect: a restriction dropped by a
 * layer doing its job, failing open. `.select()` fails the same way and more
 * quietly — it returns `_id` alone, so `property.landlord` was `undefined` and
 * every member-portal lease creation refused itself.
 *
 * This reads the schema and checks the callers against it, because a phantom
 * path is invisible by construction: there is nothing to grep for. */
{
  const modelSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/property/property.model.ts'), 'utf8');

  /* Declared paths, from the schema literal. Shared fragments are spread in
   * (`...contactFields`), so this is the schema's own fields plus a small
   * allowance for what the fragments contribute. */
  const declared = new Set(
    [...modelSrc.matchAll(/^\s{4}(\w+):\s*\{/gm)].map((m) => m[1]!),
  );
  for (const shared of ['deletedAt', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
    'region', 'city', 'address', 'status', '_id', '__v']) declared.add(shared);

  check('the Property schema was read', declared.has('owner') && declared.has('ownerKind'),
    'if this fails the parse is wrong, not the code under test');
  check('and it genuinely has no `landlord` path', !declared.has('landlord'),
    'the whole section is pointless if it does');

  const CALLERS: [string, string][] = [
    ['maintenance', 'src/modules/maintenance/index.ts'],
    ['lease', 'src/modules/lease/index.ts'],
    ['viewing', 'src/modules/viewing/index.ts'],
    ['application', 'src/modules/application/index.ts'],
    ['document', 'src/modules/document/context.service.ts'],
    ['commercialClient', 'src/modules/commercialClient/index.ts'],
    ['property', 'src/modules/property/index.ts'],
  ];

  const MONGO_OPERATORS = new Set(['in', 'nin', 'ne', 'eq', 'gt', 'gte', 'lt', 'lte',
    'or', 'and', 'nor', 'not', 'exists', 'regex', 'options', 'elemMatch', 'size', 'all',
    'type', 'expr', 'text', 'search', 'where']);

  const phantoms: string[] = [];
  for (const [name, path] of CALLERS) {
    let src: string;
    try { src = readFileSync(resolve(process.cwd(), path), 'utf8'); } catch { continue; }

    /* `Property.find({ ... })` / `.findOne({ ... })` — top-level keys only. */
    for (const call of src.matchAll(/Property\.(?:find|findOne)\(\{([^}]*)\}/g)) {
      for (const key of call[1]!.matchAll(/(?<!\$)\b(\w+):/g)) {
        /* Operators appear as nested keys and are not schema paths. Named
         * rather than inferred, so a genuinely misspelled field beside one is
         * still caught. */
        if (MONGO_OPERATORS.has(key[1]!)) continue;
        if (!declared.has(key[1]!)) phantoms.push(`${name}: query on Property.${key[1]}`);
      }
    }

    /* `.select('a b c')` on a Property read. Quieter than a bad condition: the
     * field simply comes back undefined and the code downstream refuses. */
    for (const sel of src.matchAll(/Property\.(?:find|findOne|findById)\([\s\S]{0,200}?\.select\('([^']+)'\)/g)) {
      for (const field of sel[1]!.split(/\s+/).filter(Boolean)) {
        const bare = field.replace(/^[-+]/, '');
        if (!declared.has(bare)) phantoms.push(`${name}: select of Property.${bare}`);
      }
    }
  }
  check('nobody queries or selects a path Property does not have',
    phantoms.length === 0, phantoms.join('; '));

  /* The two that bit, named so a revert reads as the endpoint it breaks. */
  const maintSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/maintenance/index.ts'), 'utf8');
  check('a landlord\'s buildings are found through `owner`, with `ownerKind` pinned',
    /owner: \{ \$in: profileIds \},\s*\n\s*ownerKind: 'LandlordProfile'/.test(maintSrc),
    'without ownerKind a LandlordProfile id could collide with a HotelProfile id');

  const leaseSrc = readFileSync(resolve(process.cwd(), 'src/modules/lease/index.ts'), 'utf8');
  check('lease creation reads the owner the schema actually has',
    /ownerKind === 'LandlordProfile' \? property\.owner : undefined/.test(leaseSrc));
  check('and the casts that hid the compile error are gone',
    !/property as \{ landlord\?: unknown \}/.test(leaseSrc),
    'the cast is what stopped TypeScript from catching this in the first place');
}


// ═══════════════════════════════════════════════════════════════════════════
section('Three id spaces, and which one each reference speaks');

/* This platform has three, and they are all correct:
 *
 *   1. **Evidence about a person** is keyed by **User** — Reference, Dispute,
 *      UsusuEntry. Deliberate, and documented in `evidence.model.ts`: evidence
 *      follows the person across every role they hold, so a dispute raised
 *      about somebody does not vanish because they were acting as a landlord
 *      that day rather than as a tenant.
 *   2. **A party in a business record** is keyed by **profile** — Lease.tenant
 *      and .landlord, Payment.payer and .payee, Maintenance.assignedVendor.
 *      One person's landlord ledger and tenant ledger are different records and
 *      must never be summed.
 *   3. **A notification recipient** is a **User**. You notify a person.
 *
 * The defect was never that one of these is wrong. It was code that spanned two
 * of them with a single value — and because a Mongo query against the wrong id
 * space returns `[]` rather than raising, the failure looked like an absence of
 * data rather than a bug. `gatherEvidence` did exactly that, and the result was
 * that **no application on the platform could ever be recommended**: every
 * applicant scored as having no payment history and no tenancy, so the engine
 * held every one of them at review. It looked like caution. It was a join. */
{
  const appSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/application/index.ts'), 'utf8');

  check('the applicant is resolved to their profiles before the ledger is read',
    /const profileIds = await profileIdsFor\(String\(subject\)\)/.test(appSrc),
    'one id cannot key both a User collection and a profile collection');
  check('payment history is read by profile',
    /Payment\.find\(\{ payer: \{ \$in: profileIds \}/.test(appSrc),
    'keyed by user id this returned [] for every applicant, scored as "no history"');
  check('tenancy history is read by profile',
    /Lease\.find\(\{ tenant: \{ \$in: profileIds \}/.test(appSrc));
  check('and the evidence collections are still read by user',
    /Reference\.find\(\{ subject: subject as never/.test(appSrc)
    && /Dispute\.find\(\{ subject: subject as never/.test(appSrc),
    'evidence about a person must follow the person, not one of their roles');

  /* ── A rule about assertions, learned the hard way four times ────────────
   * A *negative* assertion over source text — "this phrase must not appear" —
   * is a trap in this codebase, because the comments quote code and explain
   * defects by naming them. The first draft of this very check asserted that
   * the phrase "applicant is already a profile id" was gone, and it failed
   * against the fixed code: the header above quotes the false claim in order to
   * explain why it was false. Three earlier assertions passed against mutations
   * for the mirror-image reason.
   *
   * So: **positive assertions on prose, never negative ones.** What matters is
   * not that the wrong explanation is absent but that a right one is present —
   * this function spans two id spaces, and the next person to touch it needs to
   * be told so before they "simplify" it back. */
  /* Line-break tolerant: the header is wrapped prose, and an assertion that
   * depends on where a sentence happens to wrap is an assertion that fails the
   * next time somebody reflows a comment. */
  check('the header explains the id spaces it spans',
    /keyed by \*\*User[\s\S]{0,12}id\*\*/.test(appSrc)
    && /keyed by \*\*profile[\s\S]{0,12}id\*\*/.test(appSrc),
    'the next person to simplify this needs to know why it is not simple');

  // ── The schemas record which space each field speaks ──
  const PARTY_REFS: [string, string, string[]][] = [
    ['application', 'src/modules/application/application.model.ts', ['landlord', 'coordinator']],
    ['viewing', 'src/modules/viewing/viewing.model.ts', ['landlord', 'coordinator']],
  ];
  for (const [name, path, fields] of PARTY_REFS) {
    const src = readFileSync(resolve(process.cwd(), path), 'utf8');
    for (const field of fields) {
      const decl = new RegExp(`${field}: \\{[^}]*ref: '(\\w+)'`);
      const ref = src.match(decl)?.[1];
      check(`${name}.${field} is declared as the profile it actually holds`,
        ref === 'LandlordProfile' || ref === 'CoordinatorProfile',
        `declared ref: '${ref}', but it is written from a property's owner — a profile id`);
    }
  }

  /* The two that stay Users, asserted so a future sweep does not "fix" them
   * into profiles and quietly break the thing the distinction protects. */
  const appModel = readFileSync(
    resolve(process.cwd(), 'src/modules/application/application.model.ts'), 'utf8');
  check('but the applicant stays a User',
    /applicant: \{[^}]*ref: 'User'/.test(appModel),
    'evidence about a person follows the person');
  const evidenceModel = readFileSync(
    resolve(process.cwd(), 'src/modules/evidence/evidence.model.ts'), 'utf8');
  eq('and all three evidence collections stay keyed by User',
    (evidenceModel.match(/subject: \{[^}]*ref: 'User'/g) ?? []).length, 3);
  const notificationModel = readFileSync(
    resolve(process.cwd(), 'src/modules/notification/notification.model.ts'), 'utf8');
  check('a notification recipient stays a User',
    /recipient: \{[^}]*ref: 'User'/.test(notificationModel),
    'you notify a person, not a role they hold');

  // ── Every dispatch is addressed to a person ──
  // `Notification.recipient` is a User, and `GET /notifications/me` filters on
  // `recipient: actor.userId` while `dispatch.targetsFor` looks up push tokens
  // by user. A profile id passed through unresolved therefore writes the row,
  // reports it delivered, and reaches nobody — silently, because nothing about
  // a well-formed ObjectId that matches no user looks like an error.
  //
  // Three sites did exactly that: both rent notifications and every SLA
  // escalation. Every rent receipt and every overdue reminder this platform
  // has ever produced went to an id belonging to no user.
  const PROFILE_FIELDS = [
    'lease.tenant', 'lease.landlord', 'doc.assignedVendor', 'doc.assignedCoordinator',
    'request.assignedVendor', 'ride.driver', 'ride.rider', 'order.merchant', 'order.customer',
  ];
  const DISPATCHERS: [string, string][] = [
    ['lease', 'src/modules/lease/index.ts'],
    ['maintenance', 'src/modules/maintenance/index.ts'],
    ['marketplace', 'src/modules/marketplace/index.ts'],
    ['fac', 'src/modules/fac/index.ts'],
    ['notification', 'src/modules/notification/index.ts'],
    ['viewing', 'src/modules/viewing/index.ts'],
    ['application', 'src/modules/application/index.ts'],
    ['ride', 'src/modules/ride/index.ts'],
  ];
  const misaddressed: string[] = [];
  for (const [name, path] of DISPATCHERS) {
    let src: string;
    try { src = readFileSync(resolve(process.cwd(), path), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/recipient:\s*([^,\n]+)/g)) {
      const expr = m[1]!.trim();
      /* A profile-typed expression handed straight to `recipient`. Resolved
       * values (`…User`, `.user`, a variable ending `User`) are the fix. */
      if (PROFILE_FIELDS.some((f) => expr.includes(f))) {
        misaddressed.push(`${name}: recipient: ${expr}`);
      }
    }
  }
  check('no notification is addressed to a profile id',
    misaddressed.length === 0, misaddressed.join('; '));

  const leaseSrc2 = readFileSync(resolve(process.cwd(), 'src/modules/lease/index.ts'), 'utf8');
  check('rent notifications resolve the tenant to a person',
    /async function tenantUserFor/.test(leaseSrc2)
    && (leaseSrc2.match(/tenantUserFor\(lease\.tenant\)/g) ?? []).length === 2,
    'both the receipt and the reminder need it, and they are 170 lines apart');
  check('and a reminder with nobody to send it to is skipped, not sent to nothing',
    /if \(!dueUser\) continue;/.test(leaseSrc2),
    'an empty recipient writes a row and counts it delivered');

  const maintSrc2 = readFileSync(
    resolve(process.cwd(), 'src/modules/maintenance/index.ts'), 'utf8');
  check('an SLA escalation asks the model the branch already named',
    /userBehindProfile\(VendorProfile, recipient\)/.test(maintSrc2)
    && /userBehindProfile\(CoordinatorProfile, recipient\)/.test(maintSrc2),
    'vendor and coordinator are different collections; guessing one would silently drop the other');
  /* And the resolved value is the one dispatched. Calling the helper and then
   * sending the profile id anyway is a mutation that survived the first draft
   * of this section — the sweep above only knows the field names, and this site
   * holds the profile in a bare local. */
  check('and dispatches the resolved person, not the profile it started from',
    /recipient: recipientUser,/.test(maintSrc2));

  // ── The party rules compare each field against the space it holds ──
  // Nothing above covers these: they are pure functions with no side effect a
  // sweep can see, and reverting either restores a silent 403 for the one
  // person who should have access.
  for (const [name, path, ownField, ownSpace] of [
    ['application', 'src/modules/application/index.ts', 'applicant', 'user'],
    ['viewing', 'src/modules/viewing/index.ts', 'requestedBy', 'user'],
  ] as [string, string, string, string][]) {
    const src = readFileSync(resolve(process.cwd(), path), 'utf8');
    check(`${name}: the landlord is matched against the caller's profiles`,
      /doc\.landlord && profileIds\.includes\(String\(doc\.landlord\)\)/.test(src),
      'compared to actor.userId this never matched, and the landlord was refused their own property');
    check(`${name}: and ${ownField} is still matched against the ${ownSpace} id`,
      new RegExp(`String\\(doc\\.${ownField}\\) === actor\\.userId`).test(src),
      'that field holds a User, and "fixing" it to a profile would break the person it serves');
    check(`${name}: the rule stays pure, with the profiles passed in`,
      /profileIds: readonly string\[\],/.test(src),
      'a rule that fetches cannot be asserted without a database');
  }

  const appScope = readFileSync(
    resolve(process.cwd(), 'src/modules/application/index.ts'), 'utf8');
  check('the application list scope is profile-keyed where the fields are',
    /coordinator: \{ \$in: \[\.\.\.profileIds\] \}/.test(appScope)
    && /landlord: \{ \$in: \[\.\.\.profileIds\] \}/.test(appScope),
    'keyed on actor.userId, every coordinator queue was permanently empty');
  check('and still user-keyed where the field is',
    /\{ applicant: actor\.userId \}/.test(appScope));

  // ── Stats: every scoped field says which space it speaks ──
  // `scopeFor` narrowed on `actor.userId` for every field, while Property.owner,
  // Lease.landlord/tenant/coordinator and Payment.payer all hold profile ids.
  // Four of the five member stats endpoints therefore matched nothing, and
  // every member's dashboard read zero. Not an error — a match against the
  // wrong id space returns no rows, which looks exactly like having no records.
  const mine = ['p-landlord', 'p-tenant'];
  const landlordActor = { userId: 'u-1', roles: ['landlord'] };
  const coordActor = { userId: 'u-2', roles: ['coordinator'] };

  eq('a profile-keyed owner matches the caller\'s profiles',
    JSON.stringify(scopeFor(landlordActor, { owner: { field: 'landlord', space: 'profile' } }, mine)),
    JSON.stringify({ landlord: { $in: mine } }));
  eq('a user-keyed owner still matches the user',
    JSON.stringify(scopeFor(landlordActor, { owner: { field: 'subject', space: 'user' } }, mine)),
    JSON.stringify({ subject: 'u-1' }));
  eq('a profile-keyed coordinator matches the caller\'s profiles',
    JSON.stringify(scopeFor(coordActor, { coordinator: { field: 'coordinator', space: 'profile' } }, mine)),
    JSON.stringify({ coordinator: { $in: mine } }));

  /* A caller with no profile matches nothing — and `$in: []` is emphatically
   * not `{}`. This is the same distinction `DENY_ALL` exists for, arriving by a
   * different route. */
  const noProfiles = scopeFor(landlordActor, { owner: { field: 'landlord', space: 'profile' } }, []);
  check('a caller with no profile is scoped to nothing, not to everything',
    !isUnrestricted(noProfiles) && JSON.stringify(noProfiles) === JSON.stringify({ landlord: { $in: [] } }));

  // ── Each call site declares its space, and declares the right one ──
  const statsIdx = readFileSync(resolve(process.cwd(), 'src/modules/stats/index.ts'), 'utf8');
  check('every scoped field in stats declares an id space',
    !/owner: '[a-zA-Z]+'/.test(statsIdx) && !/coordinator: '[a-zA-Z]+'/.test(statsIdx),
    'a bare field name is a field whose space somebody guessed');
  /* ── The authoritative map, rather than spot-checks ────────────────────
   * A spot-check for one `field: 'landlord', space: 'profile'` passed against a
   * mutation, because three call sites share that field name and only one was
   * changed. Every declared pair is checked against the map below, so a single
   * site drifting is a failure — and a field that appears nowhere in the map is
   * one nobody has decided about, which is the state this whole section exists
   * to make impossible. */
  const SPACE_OF: Record<string, 'user' | 'profile'> = {
    // Business records: the party is a profile.
    owner: 'profile', assignedCoordinator: 'profile', landlord: 'profile',
    tenant: 'profile', coordinator: 'profile', payer: 'profile',
    // Evidence and authorship: the party is a person.
    subject: 'user',        // UsusuEntry — evidence follows the person
    raisedBy: 'user',       // polymorphic, written with the raiser's user id
    recordedBy: 'user',     // who wrote the receipt
  };
  const declared = [...statsIdx.matchAll(/field: '(\w+)', space: '(user|profile)'/g)];
  check('stats declares at least one space per scoped field', declared.length >= 8);
  const wrongSpace = declared
    .filter(([, field, space]) => SPACE_OF[field!] !== space)
    .map(([, field, space]) => `${field} declared ${space}, should be ${SPACE_OF[field!] ?? '<undecided>'}`);
  check('and every declared space matches the column it queries',
    wrongSpace.length === 0, [...new Set(wrongSpace)].join('; '));
  const missing = Object.keys(SPACE_OF)
    .filter((f) => !declared.some(([, field]) => field === f));
  check('and every field in the map is actually used',
    missing.length === 0, `${missing.join(', ')} — stale map entry, or a call site was removed`);
  /* Payment has no `coordinator` column. Naming one matched nothing, so every
   * coordinator's payment tiles read zero — and what a coordinator may
   * actually see is the receipts they wrote, which is user-keyed. */
  /* Positive, not negative. The first draft of this also asserted that
   * `coordinator: { field: 'coordinator'` appeared nowhere — and failed, because
   * Lease genuinely has that column and four call sites correctly use it. Only
   * Payment lacks one. A negative assertion over a whole file cannot express
   * "this collection, not those"; a positive one about the site that matters
   * can. Fifth time this session that lesson has come up. */
  check('payments scope a coordinator to what they recorded',
    /field: 'recordedBy', space: 'user'/.test(statsIdx),
    'Payment has no coordinator column; naming one is a dashboard of zeros');
}


// ═══════════════════════════════════════════════════════════════════════════
section('Taking money: the signature, the replay, and the amount');

/* `POST /order/:orderId/pay` accepted a `paymentRef` string from the buyer and
 * moved the order to `paid` on the strength of it. Nothing verified money had
 * arrived, nothing checked the amount, and the marketplace module imported no
 * payment provider at all. Any buyer could post any string and receive goods.
 *
 * Everything below runs without a network, a gateway account or the `stripe`
 * package, because the two things that must be right — the minor-unit
 * conversion and the signature — are arithmetic and HMAC, and writing them
 * rather than trusting a library call is what makes them assertable here. */
{
  // ── Minor units ──
  // A hard-coded `* 100` is the obvious implementation and it overcharges every
  // XOF payment by a factor of a hundred.
  eq('19.99 USD is 1999 cents', toMinorUnits(19.99, 'USD'), 1999);
  eq('and comes back whole', fromMinorUnits(1999, 'USD'), 19.99);
  eq('1000 XOF is 1000 minor units, not 100000', toMinorUnits(1000, 'XOF'), 1000);
  eq('and GMD has two places like USD', toMinorUnits(12.5, 'GMD'), 1250);
  for (const currency of CURRENCIES) {
    const back = fromMinorUnits(toMinorUnits(123.45 * (currency === 'XOF' ? 100 : 1), currency), currency);
    check(`${currency} survives a round trip`, Math.abs(back - (currency === 'XOF' ? 12345 : 123.45)) < 1e-9);
  }
  /* The float trap, named: `19.99 * 100` is 1998.9999999999998 and truncating
   * it is a cent short on every price ending in .99. */
  check('the .99 float trap is handled', toMinorUnits(19.99, 'USD') !== 1998);
  check('an inexpressible amount is refused', !isExpressible(10.005, 'USD'));
  check('but a legitimate one is not', isExpressible(10.01, 'USD'));
  check('and XOF refuses any fraction', !isExpressible(10.5, 'XOF'));

  // ── The signature ──
  // Built with the same primitive Stripe uses, so this exercises the real
  // scheme rather than a description of it.
  const secret = 'whsec_assertion';
  const body = '{"id":"evt_a","type":"payment_intent.succeeded"}';
  const ts = 1_700_000_000;
  /* The same primitive Stripe signs with, so this exercises the real scheme
   * rather than a description of it. */
  const sign = (payload: string, at: number, key: string) =>
    createHmac('sha256', key).update(`${at}.${payload}`).digest('hex');
  const good = `t=${ts},v1=${sign(body, ts, secret)}`;

  check('a genuine signature verifies',
    verifyWebhookSignature(body, good, secret, ts).ok);
  check('one byte more in the body does not',
    !verifyWebhookSignature(`${body} `, good, secret, ts).ok);
  check('nor does another secret',
    !verifyWebhookSignature(body, good, 'whsec_other', ts).ok);
  eq('a replay outside the window is refused for being stale',
    verifyWebhookSignature(body, good, secret, ts + 601).failure, 'staleTimestamp');
  check('but a slow delivery inside it is accepted',
    verifyWebhookSignature(body, good, secret, ts + 120).ok);
  eq('an absent header is refused',
    verifyWebhookSignature(body, undefined, secret, ts).failure, 'noHeader');
  eq('and an unconfigured endpoint secret refuses everything',
    verifyWebhookSignature(body, good, '', ts).failure, 'noSecret');
  /* Two `v1`s appear while a secret is being rotated and both are valid.
   * Accepting only the first breaks every rotation. */
  check('a secret rotation does not break verification',
    verifyWebhookSignature(body, `t=${ts},v1=deadbeef,v1=${sign(body, ts, secret)}`, secret, ts).ok);
  eq('the replay window is Stripe\'s own five minutes', SIGNATURE_TOLERANCE_SECONDS, 300);

  /* ── Structural, and deliberately so ──────────────────────────────────
   * Constant-time comparison has no observable behaviour a functional test can
   * reach: `===` returns exactly the same booleans for every input above, and a
   * mutation swapping one for the other passed all of them. The only honest
   * proxy is that the implementation reaches for the primitive — the same
   * reasoning, and the same compromise, as the FAC code comparison. */
  const checkoutSrc = readFileSync(
    resolve(process.cwd(), 'src/shared/providers/checkout.ts'), 'utf8');
  check('the signature comparison is constant-time',
    /timingSafeEqual\(left, right\)/.test(checkoutSrc),
    'a === on a hex digest leaks the correct signature a byte at a time');
  check('and a length mismatch still does equal work',
    /timingSafeEqual\(left, left\)/.test(checkoutSrc),
    'returning early on length is itself a timing signal');
  check('the HMAC covers the timestamp as well as the body',
    /\.update\(`\$\{timestamp\}\.`, 'utf8'\)/.test(checkoutSrc),
    'a signature over the body alone is valid forever, and a replay is free goods');
  /* No negative assertion here. The first draft checked that `JSON.stringify`
   * appeared nowhere in the file, and failed — because the header warns against
   * exactly that call by name. Sixth time this session; the rule stands.
   * Positive instead: the raw bytes reach the HMAC untouched. */
  check('the raw bytes reach the HMAC without being decoded and re-encoded',
    /\.update\(body\)/.test(checkoutSrc),
    'anything between the wire and the digest is a chance to change the bytes');

  // ── Idempotency ──
  // Stripe retries anything non-2xx for days and delivers duplicates in
  // ordinary operation. This is the main path, not the edge case.
  const applied = { eventId: 'e', appliedAt: new Date(1000), claimedAt: new Date(900) };
  const fresh = { eventId: 'e', appliedAt: null, claimedAt: new Date(1000) };
  const stale = { eventId: 'e', appliedAt: null, claimedAt: new Date(0) };

  eq('a first delivery is processed',
    intakeDecision('payment_intent.succeeded', null, 2000), 'process');
  eq('a redelivery of applied work does nothing',
    intakeDecision('payment_intent.succeeded', applied, 2000), 'alreadyApplied');
  eq('a delivery racing a live handler does nothing',
    intakeDecision('payment_intent.succeeded', fresh, 1500), 'inFlight');
  eq('but one whose handler died is retried',
    intakeDecision('payment_intent.succeeded', stale, CLAIM_STALE_AFTER_MS + 1), 'retryStale');
  eq('and an event type LRMC does not act on is ignored',
    intakeDecision('customer.created', null, 2000), 'ignoreUnhandled');

  for (const d of ['alreadyApplied', 'inFlight', 'ignoreUnhandled'] as const) {
    check(`${d} answers 200 with no work`, isAcknowledgeOnly(d));
  }
  for (const d of ['process', 'retryStale'] as const) {
    check(`${d} does the work`, !isAcknowledgeOnly(d));
  }

  // ── Reconciliation ──
  // A signed event is authentic. It is still not the authority on whether *this
  // order* is settled.
  const order = { orderId: 'o1', total: 40, currency: 'USD' as const, status: 'placed' };
  const cents = toMinorUnits(order.total, 'USD');
  const intent = { orderId: 'o1', amountMinor: cents, currency: 'USD' as const, status: 'succeeded' };

  check('a matching intent settles', maySettle(reconcile(order, intent, cents)));
  eq('an intent for another order does not',
    reconcile(order, { ...intent, orderId: 'o2' }, cents)[0]?.code, 'wrongOrder');
  /* And it says nothing else. Reporting an amount mismatch against somebody
   * else's order is a confusing way to say "this is not your payment". */
  eq('and reports only that', reconcile(order, { ...intent, orderId: 'o2' }, cents).length, 1);
  check('underpayment is refused',
    !maySettle(reconcile(order, { ...intent, amountMinor: cents - 1 }, cents)));
  check('and so is overpayment, which is a conversation not a settlement',
    !maySettle(reconcile(order, { ...intent, amountMinor: cents + 1 }, cents)));
  check('the wrong currency is refused',
    !maySettle(reconcile(order, { ...intent, currency: 'GMD' }, cents)));
  check('an unsucceeded intent is refused',
    !maySettle(reconcile(order, { ...intent, status: 'processing' }, cents)));
  check('and an order already settled is refused again',
    !maySettle(reconcile({ ...order, status: 'paid' }, intent, cents)));

  // ── The vocabulary that was missing ──
  check('an order is a payment kind', (PAYMENT_KINDS as readonly string[]).includes('order'));
  check('and a merchant payout is one too',
    (PAYMENT_KINDS as readonly string[]).includes('merchantPayout'));
  eq('a merchant is paid from orders', PAYOUT_SOURCES.merchantPayout.join(','), 'order');
  check('and the batcher has a kind for them',
    (PAYOUT_KINDS as readonly string[]).includes('merchantPayout'),
    'without this escrow held money nothing could ever pay out');

  // ── The route, and the two things a source read can still establish ──
  const appSrc = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8');
  check('the webhook path keeps its raw bytes',
    /payments\/webhooks\/stripe`,\s*\n?\s*rawBody/.test(appSrc)
    || /rawBody\)/.test(appSrc),
    'a re-serialised body does not verify, and the tempting fix is to weaken the check');
  check('and the raw parser is mounted before the JSON one',
    appSrc.indexOf('webhooks/stripe') < appSrc.indexOf("express.json({ limit: '2mb' })"),
    'mounted after, express.json consumes the stream and the bytes are gone');

  const payValidation = readFileSync(
    resolve(process.cwd(), 'src/modules/marketplace/marketplace.validation.ts'), 'utf8');
  check('asking to pay takes no client-supplied reference',
    /payOrderSchema = z\.object\(\{\}\)\.strict\(\)/.test(payValidation),
    'the field it took is the whole defect: any string moved the order to paid');

  const marketSrc2 = readFileSync(
    resolve(process.cwd(), 'src/modules/marketplace/index.ts'), 'utf8');
  const settleAt = marketSrc2.indexOf('await Payment.create({');
  const stockAt = marketSrc2.indexOf('Stock comes down when the money is committed');
  check('the ledger row is written before the side effects',
    settleAt > 0 && stockAt > settleAt,
    'a notification that throws must never unwind a payment — that is how a Stripe retry pays twice');
}

// ═══════════════════════════════════════════════════════════════════════════
section('Payout batches: a half-paid batch is not a dead end');

/* A batch where one transfer fails and the rest succeed becomes
 * `partiallySettled`. That status could not be settled again, could not be
 * cancelled, and — because it is neither `cancelled` nor `failed` — every one
 * of its lines still counted as a claim on the payments it was built from.
 *
 * So the payee whose transfer failed could not be paid by any route. Settling
 * refused the status, cancelling refused it, and a fresh batch skipped their
 * rows as already spent. Their rent needed a hand-written database update.
 *
 * The tempting fix — release the whole batch — pays the successful lines twice.
 * The claim is therefore per line, and that rule is pure, so it is exercised
 * here rather than read. */
{
  const batchOf = (...statuses: (string | undefined)[]) => ({
    lines: statuses.map((s, i) => ({
      transferStatus: s,
      sourcePayments: [`pay-${i}`],
    })),
  });

  // ── The rule, one line at a time ──
  check('a failed line releases its sources', !lineStillClaims({ transferStatus: 'failed' }));
  check('a settled line keeps them', lineStillClaims({ transferStatus: 'settled' }));
  check('so does one still processing', lineStillClaims({ transferStatus: 'processing' }));
  check('and so does one never attempted', lineStillClaims({}),
    'a line in a draft batch has not failed — it has not been tried');

  // ── The half-paid batch ──
  const half = spentSourceIds([batchOf('settled', 'failed', 'processing')]);
  check('the paid line stays claimed', half.has('pay-0'),
    'releasing it would pay that payee a second time');
  check('the failed line is released', !half.has('pay-1'),
    'this is the money that could not be paid by any route');
  check('and the in-flight line stays claimed', half.has('pay-2'),
    'its outcome is unknown, and unknown is not failed');
  eq('exactly one of the three is free', 3 - half.size, 1);

  // A batch nobody has settled yet claims everything in it.
  eq('an untouched draft claims all its lines',
    spentSourceIds([batchOf(undefined, undefined)]).size, 2);

  // ── The way out ──
  check('a partially-settled batch can be settled again',
    (RETRYABLE_BATCH_STATUSES as readonly string[]).includes('partiallySettled'),
    'without this the batch is a terminal state with no route out');
  for (const terminal of ['settling', 'settled', 'cancelled', 'failed']) {
    check(`but "${terminal}" is not retryable`,
      !(RETRYABLE_BATCH_STATUSES as readonly string[]).includes(terminal));
  }

  const payoutSrc = readFileSync(
    resolve(process.cwd(), 'src/modules/payout/index.ts'), 'utf8');
  check('the handler asks the pure rule rather than re-deriving it',
    /spentSourceIds\(claimed as never\)/.test(payoutSrc));
  check('and settling re-drives only what has not settled',
    /line\.transferStatus === 'settled'/.test(payoutSrc),
    'a retry must not re-initiate a transfer that already went');
  /* Cancelling stays refused, because some of the money has left — but the
   * refusal now names the route that actually pays the people who were missed.
   * "Cannot be cancelled" with no further advice is what sent somebody to the
   * database by hand. */
  check('and cancelling a half-paid batch says what to do instead',
    /Settle it again to retry the lines that failed/.test(payoutSrc));
}


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
