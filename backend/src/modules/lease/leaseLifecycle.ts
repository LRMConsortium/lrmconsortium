/**
 * Leases — what may follow what, and who is allowed to make it happen.
 *
 * Pure: no Express, no Mongoose, no clock. `rentSchedule.ts` derives a lease's
 * state from its dates and its balance; this file governs the states a *person*
 * sets, and who that person may be.
 *
 * ── The spine, and the machinery around it ────────────────────────────────
 * Four transitions are chosen by somebody:
 *
 *     draft ──▶ active ──▶ completed
 *                  └────▶ terminated
 *
 * Three more statuses exist — `pendingSignature`, `inArrears`, `expiring` — and
 * none of them is *set*. `inArrears` and `expiring` are computed on every read
 * from the balance and the end date, which is why they are absent from the
 * table below as destinations: a lease does not become in arrears, it *is* in
 * arrears, and a stored flag would go stale the moment a payment landed.
 *
 * They are, however, legitimate *origins*. A tenancy that is behind on rent is
 * still a running tenancy, and it must be completable and terminable — refusing
 * to end a lease because the tenant owes money would trap both parties in it.
 *
 * ── Who may do what, and why it is not symmetrical ────────────────────────
 *
 *   **A landlord activates.** It is their property and their commitment.
 *
 *   **A landlord completes.** A tenancy that ran its term is theirs to close.
 *
 *   **A landlord may NOT terminate.** Ending a tenancy early is eviction by
 *   another name. LRMC carries the tenancy, holds the deposit and answers for
 *   the outcome, so a coordinator does it — the same principle as a landlord
 *   not approving their own applicant. A landlord who wants a tenancy ended
 *   asks; they do not press a button.
 *
 *   **A tenant changes nothing.** They can read their lease and they can
 *   dispute it, and both of those are elsewhere. A lifecycle a tenant could
 *   move is one where "I ended my own lease" and "my landlord ended it" are
 *   indistinguishable afterwards.
 *
 * ── Everything terminal needs a reason, and an author ─────────────────────
 * A terminated lease with no stated reason is a fact about somebody's housing
 * that nobody has to defend. Both terminal transitions record who and why.
 */

import { EMPTY_TENANCY, STABLE_TENANCY_MONTHS, type TenancyEvidence } from '../../config/evidence.js';
export { STABLE_TENANCY_MONTHS };
import {
  LEASE_STATUSES,
  RUNNING_LEASE_STATUSES,
  CLOSED_LEASE_STATUSES,
  type LeaseStatus,
} from '../../config/lifecycles.js';

export { LEASE_STATUSES, RUNNING_LEASE_STATUSES, CLOSED_LEASE_STATUSES };
export type { LeaseStatus };

/**
 * Where each status may go, when a person moves it.
 *
 * Absence is the rule. Six statuses is thirty ordered pairs; written as
 * conditionals somebody eventually adds one that lets `terminated` become
 * `active`, and nothing fails — a tenancy that was ended reappears in a rent
 * run a month later, chasing money from somebody who moved out.
 */
export const LEASE_TRANSITIONS: Record<LeaseStatus, readonly LeaseStatus[]> = {
  /** Being written. Nothing binding, so it can be abandoned outright. */
  draft: ['pendingSignature', 'active', 'terminated'],
  /** Sent to both parties. Signing makes it active; nobody signing kills it. */
  pendingSignature: ['active', 'terminated'],
  /** Running. */
  active: ['completed', 'terminated'],
  /* Behind on rent, and inside the notice window, are both still *running*.
   * They are derived states, so nothing transitions *to* them — but a tenancy
   * in either must still be closeable, or arrears would trap both parties in a
   * lease neither can leave. */
  inArrears: ['completed', 'terminated'],
  expiring: ['completed', 'terminated'],
  /** Ran its term. Terminal — a renewal is a new lease, not a resurrection. */
  completed: [],
  /** Ended early. Terminal. */
  terminated: [],
};

export function canTransitionLease(from: string, to: string): boolean {
  const allowed = LEASE_TRANSITIONS[from as LeaseStatus];
  return Array.isArray(allowed) && (allowed as readonly string[]).includes(to);
}

export function isRunningLease(status: string): boolean {
  return (RUNNING_LEASE_STATUSES as readonly string[]).includes(status);
}

export function isClosedLease(status: string): boolean {
  return (CLOSED_LEASE_STATUSES as readonly string[]).includes(status);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Who
 * ────────────────────────────────────────────────────────────────────────── */

export interface LeaseActor {
  userId: string;
  roles: string[];
}

/** Roles that may act on any lease, anywhere. */
export const LEASE_WIDE_ROLES = ['founder', 'hqExecutive', 'backOfficeStaff'] as const;

/** The party a person is, relative to one lease. */
export type LeaseParty = 'landlord' | 'tenant' | 'coordinator' | 'staff' | 'none';

/**
 * Which party this actor is.
 *
 * Staff wins, then coordinator, then the two principals. A coordinator who
 * happens to own the property acts as a coordinator, because the wider hand is
 * the one they opened the page for and the narrower one would be a surprise.
 */
export function partyFor(
  actor: LeaseActor | null | undefined,
  lease: { landlordUser?: string | null; tenantUser?: string | null; coordinatorUser?: string | null },
): LeaseParty {
  if (!actor || typeof actor.userId !== 'string' || !actor.userId) return 'none';
  if (!Array.isArray(actor.roles)) return 'none';

  if ((LEASE_WIDE_ROLES as readonly string[]).some((r) => actor.roles.includes(r))) return 'staff';
  /* A coordinator supervises the tenancy whether or not this particular lease
   * names them. Naming is how a *specific* coordinator is reached; the role is
   * what makes them able to act. */
  if (actor.roles.includes('coordinator')) return 'coordinator';
  if (lease.landlordUser && lease.landlordUser === actor.userId) return 'landlord';
  if (lease.tenantUser && lease.tenantUser === actor.userId) return 'tenant';
  return 'none';
}

/**
 * Which transitions each party may make.
 *
 * As data, so "may a landlord terminate" is answered by reading six lines
 * rather than by tracing three handlers. The answer is no.
 */
export const TRANSITIONS_BY_PARTY: Record<LeaseParty, readonly LeaseStatus[]> = {
  /** Their property, their commitment, their tenancy to close. Not to end. */
  landlord: ['pendingSignature', 'active', 'completed'],
  /** Ending a tenancy early is LRMC's to do, because LRMC answers for it. */
  coordinator: ['terminated', 'completed'],
  /** Somebody has to be able to unstick anything. */
  staff: [...LEASE_STATUSES],
  /** Reading and disputing. Both are elsewhere. */
  tenant: [],
  none: [],
};

/** Transitions nobody may make without saying why. */
export const REASON_REQUIRED: readonly LeaseStatus[] = ['terminated'];

export const LEASE_LABELS: Record<LeaseStatus, string> = {
  draft: 'a draft',
  pendingSignature: 'awaiting signature',
  active: 'active',
  inArrears: 'in arrears',
  expiring: 'expiring',
  completed: 'completed',
  terminated: 'terminated',
};

function labelFor(status: string): string {
  return LEASE_LABELS[status as LeaseStatus] ?? status;
}

export interface LeaseAttempt {
  from: string;
  to: string;
  reason?: string | null;
}

/**
 * Everything wrong with a lifecycle change, as a list.
 *
 * A list rather than a first-failure throw, for the same reason as everywhere
 * else on this platform: one problem per round trip is how a form stops being
 * filled in on a phone.
 */
export function transitionProblems(
  actor: LeaseActor | null | undefined,
  lease: {
    status: string;
    landlordUser?: string | null;
    tenantUser?: string | null;
    coordinatorUser?: string | null;
  },
  attempt: LeaseAttempt,
): { field: string; code: string; message: string }[] {
  const out: { field: string; code: string; message: string }[] = [];
  const add = (field: string, code: string, message: string) =>
    out.push({ field, code, message });

  const party = partyFor(actor, lease);
  if (party === 'none') {
    add('status', 'not-a-party',
      'Only the landlord, a coordinator or LRMC may change a lease.');
    return out;
  }

  if (!(LEASE_STATUSES as readonly string[]).includes(attempt.to)) {
    add('status', 'unknown-status', `"${attempt.to}" is not a lease status.`);
    return out;
  }

  if (attempt.from === attempt.to) {
    add('status', 'no-change', 'That is already the status.');
    return out;
  }

  if (!canTransitionLease(attempt.from, attempt.to)) {
    add('status', 'not-reachable',
      `A lease that is ${labelFor(attempt.from)} cannot become ${labelFor(attempt.to)}.`);
  }

  const permitted = TRANSITIONS_BY_PARTY[party] ?? [];
  if (!(permitted as readonly string[]).includes(attempt.to)) {
    add('status', 'not-yours', explainRefusal(party, attempt.to));
  }

  /* A terminated lease with no stated reason is a fact about somebody's
   * housing that nobody has to defend. */
  if (REASON_REQUIRED.includes(attempt.to as LeaseStatus)
      && !String(attempt.reason ?? '').trim()) {
    add('reason', 'reason-required',
      'Say why this tenancy is ending. The tenant is told, and a bare termination is not answerable.');
  }

  return out;
}

/**
 * Why a party was refused, in words that say what to do instead.
 *
 * A bare "not permitted" sends a landlord to support. "Ask your coordinator"
 * sends them to the person who can actually help.
 */
function explainRefusal(party: LeaseParty, to: string): string {
  if (party === 'tenant') {
    return 'A tenant cannot change a lease. If something is wrong with it, open a dispute.';
  }
  if (party === 'landlord' && to === 'terminated') {
    return 'Ending a tenancy early is LRMC\'s decision, not the landlord\'s. Ask your coordinator to terminate it.';
  }
  if (party === 'coordinator' && (to === 'active' || to === 'pendingSignature')) {
    return 'A lease is activated by the landlord whose property it is.';
  }
  return 'That change is not yours to make.';
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Creating one
 * ────────────────────────────────────────────────────────────────────────── */

export interface LeaseDraft {
  property?: string | null;
  tenant?: string | null;
  landlord?: string | null;
  monthlyRent?: number | null;
  leaseStart?: Date | string | null;
  leaseEnd?: Date | string | null;
}

/** The largest rent anybody may enter without Back Office. A typo control. */
export const MAX_MONTHLY_RENT = 5_000_000;

/**
 * Everything wrong with a new lease.
 *
 * The date rules are the interesting ones. An end before a start is a typo; an
 * end *equal* to a start is a zero-day tenancy, which is not a tenancy; and a
 * missing end is a month-to-month agreement, which is ordinary here and must
 * not be refused.
 */
export function creationProblems(
  actor: LeaseActor | null | undefined,
  draft: LeaseDraft,
): { field: string; code: string; message: string }[] {
  const out: { field: string; code: string; message: string }[] = [];
  const add = (field: string, code: string, message: string) =>
    out.push({ field, code, message });

  if (!actor || typeof actor.userId !== 'string' || !actor.userId
      || !Array.isArray(actor.roles)) {
    add('actor', 'unidentified', 'A lease needs a named author.');
    return out;
  }

  if (!mayCreate(actor)) {
    add('actor', 'not-permitted', 'Only a landlord, a coordinator or LRMC may draw up a lease.');
  }

  if (!draft.property) add('property', 'required', 'Say which property.');
  if (!draft.tenant) add('tenant', 'required', 'Say who the tenant is.');

  /* A lease where one person is both sides is not a tenancy. It is also how
   * somebody would manufacture a rental history for themselves — the same
   * principle as nobody producing evidence about themselves. */
  if (draft.tenant && draft.landlord && draft.tenant === draft.landlord) {
    add('tenant', 'self-tenancy', 'A landlord cannot be their own tenant.');
  }
  if (draft.tenant && draft.tenant === actor.userId && !isStaff(actor)) {
    add('tenant', 'self-tenancy', 'You cannot draw up a lease naming yourself as the tenant.');
  }

  const rent = Number(draft.monthlyRent);
  if (!Number.isFinite(rent) || rent <= 0) {
    add('monthlyRent', 'required', 'Enter the monthly rent.');
  } else if (rent > MAX_MONTHLY_RENT) {
    add('monthlyRent', 'too-large',
      `A rent above ${MAX_MONTHLY_RENT.toLocaleString('en-GB')} needs Back Office to enter it.`);
  }

  const start = toTime(draft.leaseStart);
  if (!draft.leaseStart) {
    add('leaseStart', 'required', 'Say when the tenancy starts.');
  } else if (start === null) {
    add('leaseStart', 'unreadable', 'That start date could not be read.');
  }

  if (draft.leaseEnd) {
    const end = toTime(draft.leaseEnd);
    if (end === null) {
      add('leaseEnd', 'unreadable', 'That end date could not be read.');
    } else if (start !== null && end <= start) {
      add('leaseEnd', 'before-start',
        'The tenancy has to end after it starts. Leave the end date empty for a month-to-month agreement.');
    }
  }

  return out;
}

export function mayCreate(actor: LeaseActor | null | undefined): boolean {
  if (!actor || !Array.isArray(actor.roles)) return false;
  return actor.roles.includes('landlord')
    || actor.roles.includes('coordinator')
    || isStaff(actor);
}

function isStaff(actor: LeaseActor): boolean {
  return (LEASE_WIDE_ROLES as readonly string[]).some((r) => actor.roles.includes(r));
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Reading
 * ────────────────────────────────────────────────────────────────────────── */

export type LeaseScope =
  /** Every lease. */
  | 'all'
  /** Only leases this person is a party to. */
  | 'own'
  /** Nothing. */
  | 'none';

/**
 * How much of somebody's lease history another may see.
 *
 * A person always sees their own — as tenant *or* as landlord, because the same
 * account can be both. Staff and coordinators see everything, because
 * supervising a tenancy means being able to read it. Anybody else sees nothing,
 * and is refused rather than answered empty: "you may not see this" and "there
 * is nothing here" are different facts, and returning the second for the first
 * teaches a caller something about a person that is not theirs to learn.
 */
export function leaseScope(
  actor: LeaseActor | null | undefined,
  subjectId: string | null | undefined,
): LeaseScope {
  if (!actor || typeof actor.userId !== 'string' || !actor.userId) return 'none';
  if (!Array.isArray(actor.roles)) return 'none';
  if (!subjectId) return 'none';

  if (isStaff(actor) || actor.roles.includes('coordinator')) return 'all';
  if (actor.userId === subjectId) return 'own';
  return 'none';
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Tenancy stability — what a lease history says about a person
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * A lease as the scorer needs to read it.
 *
 * Deliberately small. The scoring engine does not need the rent, the deposit or
 * the document; it needs to know how long this person has held a tenancy and
 * how those tenancies ended.
 */
export interface LeaseRecord {
  status: string;
  leaseStart?: Date | string | null;
  leaseEnd?: Date | string | null;
  /** Set when the lease actually stopped, which is not always `leaseEnd`. */
  closedAt?: Date | string | null;
}

/* The shape lives in `config/evidence.ts` with the other four, so the bundle
 * has one definition and `withDefaults` cannot miss a field. This file produces
 * it; that file says what it is. */
export type { TenancyEvidence };
export { EMPTY_TENANCY };

/**
 * Turn a lease history into evidence.
 *
 * ── `hasRecord: false` for somebody with no leases ────────────────────────
 * The most important line here, and the same rule as every other evidence
 * gatherer. Somebody who has never rented through LRMC is not a bad tenant;
 * they are a new one, and most people applying for their first LRMC tenancy
 * will be exactly that. Scoring a zero here would decline a person for not
 * having been a customer before, which is both unfair and the fastest way to
 * make sure LRMC never grows.
 *
 * ── A terminated tenancy is not automatically a mark against ──────────────
 * It is counted and reported, never scored downward on its own. Tenancies end
 * early for a great many reasons — a landlord selling, a job moving, a
 * building failing an inspection — and only a few of them are about the tenant.
 * `terminatedCount` is here so a person reviewing an application can ask; it is
 * not here so the arithmetic can decide.
 *
 * ── A running lease counts toward months housed ───────────────────────────
 * Measured to `asOf`, so somebody two years into a tenancy is credited with two
 * years rather than with nothing until they leave.
 */
export function tenancyEvidenceFrom(
  rows: LeaseRecord[],
  asOf: Date = new Date(),
): TenancyEvidence {
  const list = Array.isArray(rows) ? rows : [];
  /* Drafts are not tenancies. Somebody with three abandoned drafts and no
   * tenancy has never been housed by LRMC, and counting them would be
   * manufacturing a history out of paperwork. */
  const real = list.filter((r) => r.status !== 'draft' && r.status !== 'pendingSignature');

  if (!real.length) return { ...EMPTY_TENANCY };

  let monthsHoused = 0;
  let longest = 0;
  let completed = 0;
  let terminated = 0;
  let active = false;

  for (const row of real) {
    if (row.status === 'completed') completed += 1;
    if (row.status === 'terminated') terminated += 1;
    if (isRunningLease(row.status)) active = true;

    const months = tenancyMonths(row, asOf);
    monthsHoused += months;
    if (months > longest) longest = months;
  }

  return {
    leaseCount: real.length,
    completedCount: completed,
    terminatedCount: terminated,
    hasActiveLease: active,
    monthsHoused,
    longestTenancyMonths: longest,
    hasRecord: true,
  };
}

/**
 * How long one tenancy lasted, in whole months.
 *
 * The end is whichever came first of: when it actually closed, when its term
 * ran out, or now. A lease that was terminated in March does not go on
 * accruing months because its stated end date is December.
 */
export function tenancyMonths(row: LeaseRecord, asOf: Date = new Date()): number {
  const start = toTime(row.leaseStart);
  if (start === null) return 0;

  const candidates = [toTime(row.closedAt), asOf.getTime()];
  if (row.leaseEnd) candidates.push(toTime(row.leaseEnd));
  const end = Math.min(...candidates.filter((n): n is number => n !== null));

  if (end <= start) return 0;
  /* Whole months, floored. A tenancy of six weeks is one month of evidence,
   * not two — rounding up would let a string of short lets look like stability. */
  return Math.floor((end - start) / (30.44 * 86_400_000));
}

/**
 * Tenancy stability, 0–100, or `null` when LRMC has no record.
 *
 * `null`, not `0`. The scorer reads a null as `unknown`, which holds an
 * application at review rather than declining it — the property this whole
 * engine is built around. A zero would say "we looked and they are unstable",
 * which is a statement about the person; a null says "we have not looked",
 * which is a statement about LRMC.
 *
 * Built from the *longest* tenancy rather than the total, because that is what
 * stability means. Six separate one-month lets is not a year of stability.
 */
export function tenancyStabilityFrom(evidence: TenancyEvidence): number | null {
  if (!evidence || !evidence.hasRecord) return null;
  const months = Math.max(0, evidence.longestTenancyMonths);
  const base = Math.min(100, Math.round((months / STABLE_TENANCY_MONTHS) * 100));
  /* A tenancy running right now is worth a little more than the same length
   * finished two years ago, because it is current evidence rather than
   * historical. Capped, so this can never be the difference on its own. */
  const bonus = evidence.hasActiveLease ? 10 : 0;
  return Math.min(100, base + bonus);
}
