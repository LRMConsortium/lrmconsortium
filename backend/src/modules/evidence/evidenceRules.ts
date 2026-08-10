/**
 * Turning records into evidence.
 *
 * Pure — no Express, no Mongoose. Each function takes the rows a collection
 * would return and produces the evidence shape the scorer reads, with
 * `hasRecord` set truthfully: **true when LRMC looked and found something to
 * say, false when there is nothing on file at all.**
 *
 * That distinction is the whole reason these are functions rather than a few
 * lines inside a route handler. `hasRecord: false` becomes `unknown` in the
 * scorer, which holds an application at review; getting it wrong here declines
 * people for LRMC's own gaps, and it would be invisible.
 */

import {
  EMPTY_DISPUTES,
  EMPTY_IDENTITY,
  EMPTY_PAYMENTS,
  EMPTY_REFERENCES,
  EMPTY_USUSU,
  groupHealthFrom,
  paymentReliabilityFrom,
  type DisputesEvidence,
  type IdentityEvidence,
  type PaymentsEvidence,
  type ReferencesEvidence,
  type UsusuEvidence,
} from '../../config/evidence.js';

/* ── Identity ───────────────────────────────────────────────────────────── */

export interface UserIdentityRow {
  isVerified?: boolean;
  verificationStatus?: string;
}

/**
 * A verification status LRMC does not recognise is not a failure.
 *
 * A row with a status nobody has taught this function about means the code is
 * behind the data, and answering "not verified" to that would refuse somebody
 * over a deployment ordering problem.
 */
export function identityEvidenceFrom(user: UserIdentityRow | null): IdentityEvidence {
  if (!user) return { ...EMPTY_IDENTITY };

  if (user.isVerified === true) {
    return { identityVerified: true, identityPending: false, hasRecord: true };
  }
  const status = user.verificationStatus;
  if (status === 'pending' || status === 'inReview') {
    return { identityVerified: false, identityPending: true, hasRecord: true };
  }
  if (status === 'unsubmitted' || status === 'rejected' || status === 'suspended') {
    return { identityVerified: false, identityPending: false, hasRecord: true };
  }
  return { ...EMPTY_IDENTITY };
}

/* ── References ─────────────────────────────────────────────────────────── */

export interface ReferenceRow {
  status: string;
  score?: number | null;
}

/**
 * The best reply LRMC has, not the average of them.
 *
 * Averaging punishes an applicant for a referee who never answered, and a
 * referee's silence says nothing about the person they were asked about.
 */
export function referencesEvidenceFrom(rows: ReferenceRow[]): ReferencesEvidence {
  if (!rows.length) return { ...EMPTY_REFERENCES };

  const received = rows.filter((r) => r.status === 'received');
  const scores = received
    .map((r) => r.score)
    .filter((v): v is number => typeof v === 'number');

  return {
    referenceRequested: true,
    referenceReceived: received.length > 0,
    referenceScore: scores.length ? Math.max(...scores) : null,
    hasRecord: true,
  };
}

/* ── Disputes ───────────────────────────────────────────────────────────── */

export interface DisputeRow {
  status: string;
  severity?: number;
}

/**
 * Severity is the worst open one, not the sum.
 *
 * Three minor disputes are not one severe dispute, and adding them up would
 * make a person with several small unresolved matters look like somebody who
 * had done something serious.
 */
export function disputesEvidenceFrom(rows: DisputeRow[]): DisputesEvidence {
  if (!rows.length) return { ...EMPTY_DISPUTES };

  const open = rows.filter((r) => r.status === 'open');
  const resolved = rows.filter((r) => r.status === 'resolved');
  const severity = open.reduce((worst, r) => Math.max(worst, r.severity ?? 1), 0);

  return {
    disputesOpen: open.length,
    disputesResolved: resolved.length,
    disputeSeverity: Math.min(3, severity),
    hasRecord: true,
  };
}

/* ── Ususu ──────────────────────────────────────────────────────────────── */

export interface UsusuRow {
  kind: string;
  period: string;
}

/**
 * The streak is counted backwards from the most recent period.
 *
 * Rows arrive oldest-first. Counting forwards would return the *first* run of
 * contributions somebody ever managed, which for a person who kept up for six
 * months two years ago and has missed every month since would report a streak
 * of six.
 */
export function streakFrom(rows: UsusuRow[]): number {
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.kind !== 'contribution') break;
    streak += 1;
  }
  return streak;
}

export function ususuEvidenceFrom(rows: UsusuRow[]): UsusuEvidence {
  if (!rows.length) return { ...EMPTY_USUSU };

  const made = rows.filter((r) => r.kind === 'contribution').length;
  const missed = rows.filter((r) => r.kind === 'miss').length;

  return {
    contributionsMade: made,
    contributionsMissed: missed,
    streak: streakFrom(rows),
    groupHealth: groupHealthFrom(missed),
    hasRecord: true,
  };
}

/* ── Payments ───────────────────────────────────────────────────────────── */

export interface PaymentRow {
  status: string;
  dueDate?: Date | string | null;
  paidAt?: Date | string | null;
}

/** Days after which a settled payment counts as late rather than on time. */
export const LATE_AFTER_DAYS = 3;

const DAY = 86_400_000;

function ms(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * On time, late, or missed.
 *
 * A payment with no due date on record cannot be late — LRMC has nothing to
 * measure lateness against — so it counts as on time rather than being held
 * against somebody for a gap in LRMC's own data.
 *
 * `pending` is excluded entirely. An instalment that is not yet due is not
 * evidence of anything, and counting it as missed would make every tenant
 * look worse on the first of the month.
 */
export function paymentsEvidenceFrom(rows: PaymentRow[]): PaymentsEvidence {
  const settled = rows.filter((r) => r.status === 'paid');
  const failed = rows.filter((r) => r.status === 'failed' || r.status === 'missed');

  if (!settled.length && !failed.length) return { ...EMPTY_PAYMENTS };

  let onTime = 0;
  let late = 0;
  for (const row of settled) {
    const due = ms(row.dueDate);
    const paid = ms(row.paidAt);
    if (due === null || paid === null) { onTime += 1; continue; }
    if (paid - due > LATE_AFTER_DAYS * DAY) late += 1;
    else onTime += 1;
  }

  return {
    paymentsOnTime: onTime,
    paymentsLate: late,
    paymentsMissed: failed.length,
    paymentReliability: paymentReliabilityFrom(onTime, late, failed.length),
    hasRecord: true,
  };
}
