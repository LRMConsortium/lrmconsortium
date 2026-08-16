/**
 * Evidence — the five things LRMC looks up about an applicant.
 *
 * Pure: no Express, no Mongoose, no clock. `npm run verify` runs it with
 * nothing installed. The modules that *gather* each kind live under
 * `modules/`; this file says what the gathered shape is and how to read it.
 *
 * ── Always an object, never null ──────────────────────────────────────────
 * Every evidence type is always returned, fully populated with zeros. A caller
 * never has to null-check, the OpenAPI schema has no optional branches, and
 * the SDK types are flat.
 *
 * ── But zero and unknown are different facts ──────────────────────────────
 * `hasRecord` is what separates them, and it is the most important field here.
 *
 *   `{ contributionsMade: 0, hasRecord: true }`
 *       LRMC looked. This person has an Ususu account and has contributed
 *       nothing. That is a real, scoreable zero.
 *
 *   `{ contributionsMade: 0, hasRecord: false }`
 *       LRMC has no Ususu record for this person at all. They may have never
 *       heard of it. Scoring that as zero would decline a tenant for not using
 *       a ride service.
 *
 * Without `hasRecord` those two are indistinguishable, and the second one is
 * the common case for anybody new to the country. `assessApplication` treats
 * `hasRecord: false` as `unknown`, which holds an application at review rather
 * than declining it — the property this whole engine is built around.
 */

/* ─────────────────────────────────────────────────────────────────────────────
 * Identity
 * ────────────────────────────────────────────────────────────────────────── */

export interface IdentityEvidence {
  identityVerified: boolean;
  /** Documents submitted, not yet reviewed. Different from refused. */
  identityPending: boolean;
  hasRecord: boolean;
}

export const EMPTY_IDENTITY: IdentityEvidence = {
  identityVerified: false,
  identityPending: false,
  hasRecord: false,
};

/* ─────────────────────────────────────────────────────────────────────────────
 * References
 * ────────────────────────────────────────────────────────────────────────── */

export interface ReferencesEvidence {
  referenceRequested: boolean;
  referenceReceived: boolean;
  /** 0–100 as scored by whoever answered, or null if nobody has. */
  referenceScore: number | null;
  hasRecord: boolean;
}

export const EMPTY_REFERENCES: ReferencesEvidence = {
  referenceRequested: false,
  referenceReceived: false,
  referenceScore: null,
  hasRecord: false,
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Disputes
 * ────────────────────────────────────────────────────────────────────────── */

/** 0 none · 1 minor · 2 serious · 3 severe. */
export const MAX_DISPUTE_SEVERITY = 3;

export interface DisputesEvidence {
  disputesOpen: number;
  disputesResolved: number;
  /** The worst open dispute, 0–3. */
  disputeSeverity: number;
  hasRecord: boolean;
}

export const EMPTY_DISPUTES: DisputesEvidence = {
  disputesOpen: 0,
  disputesResolved: 0,
  disputeSeverity: 0,
  hasRecord: false,
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Ususu
 * ────────────────────────────────────────────────────────────────────────── */

/** Each missed contribution costs this much group health. */
export const GROUP_HEALTH_PENALTY_PER_MISS = 5;

export interface UsusuEvidence {
  contributionsMade: number;
  contributionsMissed: number;
  /** Consecutive contributions without a miss. */
  streak: number;
  /** 0–100. */
  groupHealth: number;
  hasRecord: boolean;
}

export const EMPTY_USUSU: UsusuEvidence = {
  contributionsMade: 0,
  contributionsMissed: 0,
  streak: 0,
  groupHealth: 100,
  hasRecord: false,
};

/**
 * Group health from misses.
 *
 * Floored at zero. `100 - misses * 5` goes negative at twenty-one misses, and
 * a health of −15 would flow into a percentage on a dashboard and into a score
 * that could then be driven arbitrarily low by one number.
 */
export function groupHealthFrom(missed: number): number {
  if (!Number.isFinite(missed) || missed <= 0) return 100;
  return Math.max(0, 100 - Math.round(missed) * GROUP_HEALTH_PENALTY_PER_MISS);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Payments
 * ────────────────────────────────────────────────────────────────────────── */

export interface PaymentsEvidence {
  paymentsOnTime: number;
  paymentsLate: number;
  /** A missed instalment is different in kind from a late one. */
  paymentsMissed: number;
  /** 0–100. */
  paymentReliability: number;
  hasRecord: boolean;
}

export const EMPTY_PAYMENTS: PaymentsEvidence = {
  paymentsOnTime: 0,
  paymentsLate: 0,
  paymentsMissed: 0,
  paymentReliability: 0,
  hasRecord: false,
};

/**
 * Reliability as a percentage.
 *
 * `onTime / (onTime + late)` divides by zero for anybody with no history —
 * which is everybody on their first day — and `NaN` propagates silently
 * through a score and out onto a screen. No instalments means no reliability
 * to report, which is what `hasRecord: false` is for; this returns 0 and the
 * scorer never reads it.
 *
 * Missed instalments count against the denominator as well as the numerator,
 * because a person who paid three and skipped seven is not 100% reliable.
 */
export function paymentReliabilityFrom(
  onTime: number,
  late: number,
  missed = 0,
): number {
  const good = Math.max(0, onTime || 0);
  const total = good + Math.max(0, late || 0) + Math.max(0, missed || 0);
  if (total === 0) return 0;
  return Math.round((good / total) * 100);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Tenancy history
 * ────────────────────────────────────────────────────────────────────────── */

/** Months of continuous tenancy above which stability is fully credited. */
export const STABLE_TENANCY_MONTHS = 12;

export interface TenancyEvidence {
  leaseCount: number;
  completedCount: number;
  terminatedCount: number;
  hasActiveLease: boolean;
  monthsHoused: number;
  /**
   * The longest single tenancy, in months.
   *
   * Reported alongside the total because they say different things: six
   * one-month lets and one six-month tenancy are both "six months housed", and
   * only one of them is evidence of stability.
   */
  longestTenancyMonths: number;
  hasRecord: boolean;
}

/**
 * No tenancy history at all.
 *
 * `hasRecord: false` is doing the same work here as everywhere else in this
 * file, and it matters more here than almost anywhere: every applicant for
 * their first LRMC tenancy lands on this object. Reading it as a zero would
 * decline people for never having been customers, which at launch is everybody.
 */
export const EMPTY_TENANCY: TenancyEvidence = {
  leaseCount: 0,
  completedCount: 0,
  terminatedCount: 0,
  hasActiveLease: false,
  monthsHoused: 0,
  longestTenancyMonths: 0,
  hasRecord: false,
};

/* ─────────────────────────────────────────────────────────────────────────────
 * The bundle
 * ────────────────────────────────────────────────────────────────────────── */

export interface EvidenceBundle {
  identityEvidence: IdentityEvidence;
  referencesEvidence: ReferencesEvidence;
  disputesEvidence: DisputesEvidence;
  ususuEvidence: UsusuEvidence;
  paymentsEvidence: PaymentsEvidence;
  tenancyEvidence: TenancyEvidence;
}

export const EVIDENCE_KEYS = [
  'identityEvidence',
  'referencesEvidence',
  'disputesEvidence',
  'ususuEvidence',
  'paymentsEvidence',
  'tenancyEvidence',
] as const;

export type EvidenceKey = (typeof EVIDENCE_KEYS)[number];

/** Every kind present, every kind saying LRMC has not looked. */
export function emptyEvidence(): EvidenceBundle {
  return {
    identityEvidence: { ...EMPTY_IDENTITY },
    referencesEvidence: { ...EMPTY_REFERENCES },
    disputesEvidence: { ...EMPTY_DISPUTES },
    ususuEvidence: { ...EMPTY_USUSU },
    paymentsEvidence: { ...EMPTY_PAYMENTS },
    tenancyEvidence: { ...EMPTY_TENANCY },
  };
}

/**
 * Fill any gap in a partial bundle.
 *
 * A gatherer that could not reach one source returns what it has; this makes
 * the rest explicit rather than leaving `undefined` for the scorer to trip on.
 */
export function withDefaults(partial: Partial<EvidenceBundle>): EvidenceBundle {
  const base = emptyEvidence();
  return {
    identityEvidence: { ...base.identityEvidence, ...(partial.identityEvidence ?? {}) },
    referencesEvidence: { ...base.referencesEvidence, ...(partial.referencesEvidence ?? {}) },
    disputesEvidence: { ...base.disputesEvidence, ...(partial.disputesEvidence ?? {}) },
    ususuEvidence: { ...base.ususuEvidence, ...(partial.ususuEvidence ?? {}) },
    paymentsEvidence: { ...base.paymentsEvidence, ...(partial.paymentsEvidence ?? {}) },
    tenancyEvidence: { ...base.tenancyEvidence, ...(partial.tenancyEvidence ?? {}) },
  };
}
