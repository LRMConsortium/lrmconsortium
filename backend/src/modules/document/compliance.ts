/**
 * Cross-entity compliance — does the document agree with the records it claims
 * to be about?
 *
 * A document can be perfectly legible, correctly filled in and still wrong: a
 * tenancy agreement naming a different landlord, a residency proof for an
 * address the property is not at. Field validation cannot catch any of that,
 * because the contradiction is between the document and the rest of the
 * platform, not inside the document.
 *
 * Each rule takes an explicit context object rather than reaching for a model,
 * so the whole file stays pure and every rule is assertable against a fixture.
 * The router's job is to load the context; the rule's job is to judge it.
 */

import { COMPLIANCE_RULES, type ComplianceRuleKey, type DocumentType, complianceRuleFor } from './documentRules.js';

export { COMPLIANCE_RULES };
export type { ComplianceRuleKey };

/**
 * `blocking` failures stop verification. `advisory` ones are recorded and shown
 * to the reviewer, who may verify anyway — a middle name spelled differently is
 * worth flagging and not worth refusing.
 */
export const SEVERITIES = ['blocking', 'advisory'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CHECK_OUTCOMES = ['passed', 'failed', 'skipped'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/** The document, reduced to what the rules read. */
export interface ComplianceDocument {
  type: DocumentType;
  subjectKind?: string;
  subject?: string;
  owner?: string;
  fields: Record<string, unknown>;
}

/**
 * Everything a rule may consult. All optional: a context that cannot be loaded
 * yields `skipped`, which is honest, rather than `passed`, which is a lie.
 */
export interface ComplianceContext {
  profile?: { id?: string; fullName?: string; dateOfBirth?: Date | string; IDNumber?: string; user?: string } | null;
  property?: { id?: string; address?: string; city?: string; region?: string; owner?: string; ownerKind?: string } | null;
  landlord?: { id?: string; fullName?: string; user?: string } | null;
  lease?: {
    id?: string;
    landlord?: string;
    tenant?: string;
    property?: string;
    monthlyRent?: number;
    currency?: string;
    leaseStart?: Date;
    leaseEnd?: Date;
  } | null;
  commercialClient?: { id?: string; clientName?: string; linkedProperties?: string[] } | null;
  employer?: { name?: string; verified?: boolean } | null;
  household?: { maritalStatus?: string; spouseName?: string } | null;
  dependent?: { name?: string; dateOfBirth?: Date | string; relationship?: string } | null;
  eligibility?: { role?: 'driver' | 'rider'; verificationStatus?: string; suspended?: boolean } | null;
}

export interface ComplianceCheck {
  rule: ComplianceRuleKey;
  outcome: CheckOutcome;
  severity: Severity;
  detail: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparison helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Case, punctuation and spacing are noise; the letters are the signal. */
export function normalise(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Do two names refer to the same person?
 *
 * Deliberately generous about ordering and middle names — "Kwame A. Mensah" and
 * "Mensah, Kwame Ato" are the same human, and a matcher strict enough to reject
 * that would reject most of Ghana. It requires every token of the shorter name
 * to appear in the longer, which catches a genuinely different name while
 * tolerating the ways one name gets written down.
 */
export function namesMatch(a: unknown, b: unknown): boolean {
  const left = normalise(a).split(' ').filter(Boolean);
  const right = normalise(b).split(' ').filter(Boolean);
  if (left.length === 0 || right.length === 0) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  // A single shared token is not a match: "Kwame Mensah" and "Kwame Osei" are
  // different people.
  if (shorter.length === 1 && longer.length > 1) return false;
  return shorter.every((token) => longer.includes(token));
}

/** Addresses match when one contains the other's significant tokens. */
export function addressesMatch(a: unknown, b: unknown): boolean {
  const left = normalise(a);
  const right = normalise(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const tokens = (left.length <= right.length ? left : right).split(' ').filter((t) => t.length > 2);
  if (tokens.length === 0) return false;
  const other = left.length <= right.length ? right : left;
  const hits = tokens.filter((t) => other.includes(t)).length;
  return hits / tokens.length >= 0.6;
}

function sameId(a: unknown, b: unknown): boolean {
  return Boolean(a) && Boolean(b) && String(a) === String(b);
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function sameDay(a: unknown, b: unknown): boolean {
  const left = asDate(a);
  const right = asDate(b);
  if (!left || !right) return false;
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

const pass = (rule: ComplianceRuleKey, severity: Severity, detail: string): ComplianceCheck => ({
  rule, outcome: 'passed', severity, detail,
});
const fail = (rule: ComplianceRuleKey, severity: Severity, detail: string): ComplianceCheck => ({
  rule, outcome: 'failed', severity, detail,
});
const skip = (rule: ComplianceRuleKey, severity: Severity, detail: string): ComplianceCheck => ({
  rule, outcome: 'skipped', severity, detail,
});

/** Which rules refuse verification outright when they fail. */
export const RULE_SEVERITY: Record<ComplianceRuleKey, Severity> = {
  residencyMatchesProperty: 'blocking',
  hostConfirmationMatchesLandlord: 'blocking',
  rentalAgreementMatchesLease: 'blocking',
  tenantIntakeMatchesProfile: 'advisory',
  propertyOwnershipMatchesClient: 'blocking',
  employmentMatchesEmployer: 'advisory',
  identityMatchesProfile: 'blocking',
  maritalStatusMatchesHousehold: 'advisory',
  birthRecordMatchesDependent: 'advisory',
  criminalBackgroundMatchesEligibility: 'blocking',
};

// ─────────────────────────────────────────────────────────────────────────────
// The rules
// ─────────────────────────────────────────────────────────────────────────────

type RuleFn = (doc: ComplianceDocument, ctx: ComplianceContext) => ComplianceCheck;

const RULES: Record<ComplianceRuleKey, RuleFn> = {
  residencyMatchesProperty: (doc, ctx) => {
    const key: ComplianceRuleKey = 'residencyMatchesProperty';
    const sev = RULE_SEVERITY[key];
    if (!ctx.property) return skip(key, sev, 'no property in context');
    if (!doc.fields.address) return fail(key, sev, 'document states no address');
    return addressesMatch(doc.fields.address, ctx.property.address)
      ? pass(key, sev, 'address matches the property on file')
      : fail(key, sev, `document address does not match property address "${ctx.property.address ?? ''}"`);
  },

  hostConfirmationMatchesLandlord: (doc, ctx) => {
    const key: ComplianceRuleKey = 'hostConfirmationMatchesLandlord';
    const sev = RULE_SEVERITY[key];
    if (!ctx.landlord) return skip(key, sev, 'no landlord in context');
    return namesMatch(doc.fields.counterpartyName, ctx.landlord.fullName)
      ? pass(key, sev, 'confirming host matches the landlord of record')
      : fail(key, sev, 'the confirming host is not the landlord of record');
  },

  rentalAgreementMatchesLease: (doc, ctx) => {
    const key: ComplianceRuleKey = 'rentalAgreementMatchesLease';
    const sev = RULE_SEVERITY[key];
    if (!ctx.lease) return skip(key, sev, 'no lease in context');
    if (!sameId(doc.subject, ctx.lease.id)) {
      return fail(key, sev, 'the agreement is attached to a different lease');
    }
    const rent = Number(doc.fields.amount);
    if (Number.isFinite(rent) && ctx.lease.monthlyRent !== undefined) {
      // A pesewa of rounding is not a discrepancy; a different rent is.
      if (Math.abs(rent - ctx.lease.monthlyRent) > 0.01) {
        return fail(key, sev, `agreement states ${rent}, the lease says ${ctx.lease.monthlyRent}`);
      }
    }
    const start = asDate(doc.fields.periodStart);
    if (start && ctx.lease.leaseStart && !sameDay(start, ctx.lease.leaseStart)) {
      return fail(key, sev, 'agreement term does not start when the lease does');
    }
    return pass(key, sev, 'agreement matches the lease on file');
  },

  tenantIntakeMatchesProfile: (doc, ctx) => {
    const key: ComplianceRuleKey = 'tenantIntakeMatchesProfile';
    const sev = RULE_SEVERITY[key];
    if (!ctx.profile) return skip(key, sev, 'no tenant profile in context');
    if (!namesMatch(doc.fields.holderName, ctx.profile.fullName)) {
      return fail(key, sev, 'intake name does not match the tenant profile');
    }
    if (doc.fields.dateOfBirth && ctx.profile.dateOfBirth && !sameDay(doc.fields.dateOfBirth, ctx.profile.dateOfBirth)) {
      return fail(key, sev, 'intake date of birth does not match the tenant profile');
    }
    return pass(key, sev, 'intake matches the tenant profile');
  },

  propertyOwnershipMatchesClient: (doc, ctx) => {
    const key: ComplianceRuleKey = 'propertyOwnershipMatchesClient';
    const sev = RULE_SEVERITY[key];
    if (!ctx.commercialClient) return skip(key, sev, 'no commercial client in context');
    if (!namesMatch(doc.fields.holderName, ctx.commercialClient.clientName)) {
      return fail(key, sev, 'the titleholder is not the commercial client');
    }
    if (doc.subjectKind === 'Property' && doc.subject) {
      const linked = ctx.commercialClient.linkedProperties ?? [];
      if (linked.length > 0 && !linked.map(String).includes(String(doc.subject))) {
        return fail(key, sev, 'the property is not in this client’s portfolio');
      }
    }
    return pass(key, sev, 'ownership matches the commercial client');
  },

  employmentMatchesEmployer: (doc, ctx) => {
    const key: ComplianceRuleKey = 'employmentMatchesEmployer';
    const sev = RULE_SEVERITY[key];
    if (!ctx.employer) return skip(key, sev, 'no employer in context');
    if (!namesMatch(doc.fields.employerName, ctx.employer.name)) {
      return fail(key, sev, 'the letter is from a different employer');
    }
    return ctx.employer.verified === false
      ? fail(key, sev, 'the employer is not a verified entity')
      : pass(key, sev, 'employment matches the employer of record');
  },

  identityMatchesProfile: (doc, ctx) => {
    const key: ComplianceRuleKey = 'identityMatchesProfile';
    const sev = RULE_SEVERITY[key];
    if (!ctx.profile) return skip(key, sev, 'no profile in context');
    if (!namesMatch(doc.fields.holderName, ctx.profile.fullName)) {
      return fail(key, sev, 'the ID names a different person than the profile');
    }
    if (doc.fields.dateOfBirth && ctx.profile.dateOfBirth && !sameDay(doc.fields.dateOfBirth, ctx.profile.dateOfBirth)) {
      return fail(key, sev, 'date of birth does not match the profile');
    }
    // Where the profile already carries an ID number, a *different* one on the
    // document means one of the two records is about someone else.
    if (doc.fields.documentNumber && ctx.profile.IDNumber) {
      if (normalise(doc.fields.documentNumber) !== normalise(ctx.profile.IDNumber)) {
        return fail(key, sev, 'the ID number does not match the one on the profile');
      }
    }
    return pass(key, sev, 'identity matches the profile');
  },

  maritalStatusMatchesHousehold: (doc, ctx) => {
    const key: ComplianceRuleKey = 'maritalStatusMatchesHousehold';
    const sev = RULE_SEVERITY[key];
    if (!ctx.household) return skip(key, sev, 'no household in context');
    if (ctx.household.spouseName && !namesMatch(doc.fields.counterpartyName, ctx.household.spouseName)) {
      return fail(key, sev, 'the certificate names a different spouse than the household record');
    }
    return pass(key, sev, 'marital status matches the household record');
  },

  birthRecordMatchesDependent: (doc, ctx) => {
    const key: ComplianceRuleKey = 'birthRecordMatchesDependent';
    const sev = RULE_SEVERITY[key];
    if (!ctx.dependent) return skip(key, sev, 'no dependent in context');
    if (!namesMatch(doc.fields.holderName, ctx.dependent.name)) {
      return fail(key, sev, 'the certificate names a different child than the dependent record');
    }
    if (doc.fields.dateOfBirth && ctx.dependent.dateOfBirth && !sameDay(doc.fields.dateOfBirth, ctx.dependent.dateOfBirth)) {
      return fail(key, sev, 'date of birth does not match the dependent record');
    }
    if (doc.fields.relationship && ctx.dependent.relationship &&
        normalise(doc.fields.relationship) !== normalise(ctx.dependent.relationship)) {
      return fail(key, sev, 'stated relationship does not match the dependent record');
    }
    return pass(key, sev, 'birth record matches the dependent');
  },

  criminalBackgroundMatchesEligibility: (doc, ctx) => {
    const key: ComplianceRuleKey = 'criminalBackgroundMatchesEligibility';
    const sev = RULE_SEVERITY[key];
    if (!ctx.eligibility) return skip(key, sev, 'no driver or rider eligibility in context');
    const outcome = String(doc.fields.outcome ?? '');
    if (outcome === 'pending') return fail(key, sev, 'the background check has not concluded');
    // An adverse check is disqualifying for a driver, who carries passengers,
    // and advisory for a rider, who does not. The severity does not change; the
    // verdict does.
    if (outcome === 'adverse' && ctx.eligibility.role === 'driver') {
      return fail(key, sev, 'an adverse check disqualifies a driver from carrying passengers');
    }
    if (ctx.eligibility.suspended) {
      return fail(key, sev, 'the account is suspended; eligibility cannot be established');
    }
    return pass(key, sev, `background check is ${outcome} for a ${ctx.eligibility.role ?? 'member'}`);
  },
};

export function evaluateRule(
  key: ComplianceRuleKey,
  doc: ComplianceDocument,
  ctx: ComplianceContext,
): ComplianceCheck {
  return RULES[key](doc, ctx);
}

export interface ComplianceReport {
  type: DocumentType;
  /** The rule this document type is subject to, if any. */
  rule: ComplianceRuleKey | null;
  checks: ComplianceCheck[];
  passed: number;
  failed: number;
  skipped: number;
  /** Failed checks that refuse verification. */
  blocking: ComplianceCheck[];
  /** True when nothing blocking failed — i.e. the document may be verified. */
  clear: boolean;
  score: number;
}

/**
 * The full report for one document.
 *
 * A type with no compliance rule is `clear` with an empty check list, not a
 * fabricated pass — the report says what was actually examined. Skipped checks
 * do not count towards the score in either direction, so a missing context
 * degrades confidence rather than manufacturing it.
 */
export function complianceReport(
  doc: ComplianceDocument,
  ctx: ComplianceContext,
  extraRules: ComplianceRuleKey[] = [],
): ComplianceReport {
  const primary = complianceRuleFor(doc.type);
  const keys = [...new Set([...(primary ? [primary] : []), ...extraRules])];
  const checks = keys.map((k) => evaluateRule(k, doc, ctx));

  const passed = checks.filter((c) => c.outcome === 'passed').length;
  const failed = checks.filter((c) => c.outcome === 'failed').length;
  const skipped = checks.filter((c) => c.outcome === 'skipped').length;
  const blocking = checks.filter((c) => c.outcome === 'failed' && c.severity === 'blocking');
  const decided = passed + failed;

  return {
    type: doc.type,
    rule: primary,
    checks,
    passed,
    failed,
    skipped,
    blocking,
    clear: blocking.length === 0,
    score: decided === 0 ? 100 : Math.round((passed / decided) * 1000) / 10,
  };
}
