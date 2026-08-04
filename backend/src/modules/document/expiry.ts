/**
 * Document expiry — detection, notice windows, escalation, re-verification.
 *
 * Same shape as the maintenance SLA clock, and for the same reason: the sweep
 * job, the member's badge and the compliance report must all say the same thing
 * about the same document on the same day.
 *
 * The distinction that matters here is between *lapsing* and *lapsed*. A licence
 * expiring in three weeks is not a problem yet, but it is the last moment at
 * which it is cheap to fix. Notices go out on a fixed ladder before the date,
 * and escalation only begins after it.
 */

import {
  DOCUMENT_RULES,
  expiryDateFor,
  requiresReverification,
  type DocumentType,
  type FieldBag,
} from './documentRules.js';

export const MS_PER_DAY = 86_400_000;

/**
 * Days before expiry on which a notice is sent. Descending, and each is sent
 * once: the ladder gives a holder four chances to act without becoming noise.
 */
export const EXPIRY_NOTICE_DAYS = [90, 60, 30, 14, 7, 1] as const;

/** Days after expiry at which escalation steps up. */
export const ESCALATION_AFTER_DAYS = { coordinator: 0, backOffice: 7, suspend: 30 } as const;

export const EXPIRY_STATES = ['noExpiry', 'valid', 'expiringSoon', 'expiresToday', 'expired'] as const;
export type ExpiryState = (typeof EXPIRY_STATES)[number];

export const EXPIRY_ESCALATIONS = [
  'none',
  'notifyHolder',
  'notifyCoordinator',
  'notifyBackOffice',
  'suspendPrivilege',
] as const;
export type ExpiryEscalation = (typeof EXPIRY_ESCALATIONS)[number];

/** The window in which "expiring soon" is true — the widest notice rung. */
export const EXPIRING_SOON_DAYS = EXPIRY_NOTICE_DAYS[0];

export interface ExpiryInfo {
  type: DocumentType;
  expiresOn: Date | null;
  /** Negative once the date has passed. Null when the document never expires. */
  daysRemaining: number | null;
  state: ExpiryState;
  expired: boolean;
  /** The notice rung due today, or null. */
  noticeDue: number | null;
  escalation: ExpiryEscalation;
  /** True when the type must go back through review rather than be renewed. */
  requiresReverification: boolean;
  /** How long the whole document has been lapsed, for reporting. */
  daysExpired: number | null;
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Whole days between two instants, by calendar date.
 *
 * Deliberately not `(b - a) / 86400000`: a document expiring at 23:00 tonight
 * and one expiring at 01:00 tonight both expire *today*, and a holder told
 * "expires in 0 days" versus "in 1 day" on the strength of an hour is being
 * told something arbitrary.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);
}

/**
 * The notice rung due exactly today, if any.
 *
 * Exact equality is intentional. A sweep that fires "<= 30 days" every day
 * sends thirty identical reminders and gets muted; one that fires on the rung
 * sends four over three months and gets read.
 */
export function noticeDueAt(daysRemaining: number | null): number | null {
  if (daysRemaining === null) return null;
  return (EXPIRY_NOTICE_DAYS as readonly number[]).includes(daysRemaining) ? daysRemaining : null;
}

/**
 * Who to wake, given how long a document has been lapsed.
 *
 * Nothing escalates before the date — an approaching expiry is the holder's to
 * fix, and pulling a coordinator in three weeks early trains them to ignore it.
 */
export function escalationFor(daysRemaining: number | null, restricted: boolean): ExpiryEscalation {
  if (daysRemaining === null) return 'none';
  if (daysRemaining > 0) return noticeDueAt(daysRemaining) !== null ? 'notifyHolder' : 'none';

  const daysExpired = -daysRemaining;
  if (daysExpired >= ESCALATION_AFTER_DAYS.suspend && restricted) return 'suspendPrivilege';
  if (daysExpired >= ESCALATION_AFTER_DAYS.backOffice) return 'notifyBackOffice';
  return 'notifyCoordinator';
}

export function stateFor(daysRemaining: number | null): ExpiryState {
  if (daysRemaining === null) return 'noExpiry';
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining === 0) return 'expiresToday';
  return daysRemaining <= EXPIRING_SOON_DAYS ? 'expiringSoon' : 'valid';
}

/** Everything the engine knows about one document's clock. */
export function expiryInfoFor(
  type: DocumentType,
  fields: FieldBag,
  asOf: Date,
  verifiedAt?: Date | null,
): ExpiryInfo {
  const expiresOn = expiryDateFor(type, fields, verifiedAt ?? null);
  const daysRemaining = expiresOn ? daysBetween(asOf, expiresOn) : null;
  const restricted = DOCUMENT_RULES[type].sensitivity === 'restricted';

  return {
    type,
    expiresOn,
    daysRemaining,
    state: stateFor(daysRemaining),
    expired: daysRemaining !== null && daysRemaining < 0,
    noticeDue: noticeDueAt(daysRemaining),
    escalation: escalationFor(daysRemaining, restricted),
    requiresReverification: requiresReverification(type),
    daysExpired: daysRemaining !== null && daysRemaining < 0 ? -daysRemaining : null,
  };
}

/**
 * Should the sweep act on this document today, and how?
 *
 * `expire` is only ever true for a document that is currently `verified`: a
 * rejected or already-expired record has nothing left to lapse, and moving it
 * again would write an audit entry that says nothing.
 */
export interface ExpirySweepVerdict {
  info: ExpiryInfo;
  /** Transition the document to `expired`. */
  expire: boolean;
  /** Send the holder a notice today. */
  notify: boolean;
  /** Escalate beyond the holder. */
  escalate: boolean;
  reason: 'lapsed' | 'noticeRung' | 'stillLapsed' | 'none';
}

export function sweepVerdict(
  type: DocumentType,
  fields: FieldBag,
  status: string,
  asOf: Date,
  verifiedAt?: Date | null,
): ExpirySweepVerdict {
  const info = expiryInfoFor(type, fields, asOf, verifiedAt);

  if (info.state === 'noExpiry') {
    return { info, expire: false, notify: false, escalate: false, reason: 'none' };
  }

  if (info.expired) {
    const alreadyExpired = status === 'expired';
    return {
      info,
      expire: !alreadyExpired && status === 'verified',
      notify: true,
      escalate: info.escalation !== 'none' && info.escalation !== 'notifyHolder',
      reason: alreadyExpired ? 'stillLapsed' : 'lapsed',
    };
  }

  const rung = info.noticeDue !== null;
  return {
    info,
    expire: false,
    notify: rung && status === 'verified',
    escalate: false,
    reason: rung ? 'noticeRung' : 'none',
  };
}

/** Human-readable line for a notice or a badge. */
export function describeExpiry(info: ExpiryInfo): string {
  switch (info.state) {
    case 'noExpiry':
      return 'does not expire';
    case 'expired':
      return `expired ${info.daysExpired} day${info.daysExpired === 1 ? '' : 's'} ago`;
    case 'expiresToday':
      return 'expires today';
    default:
      return `expires in ${info.daysRemaining} day${info.daysRemaining === 1 ? '' : 's'}`;
  }
}
