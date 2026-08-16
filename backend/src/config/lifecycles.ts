/**
 * The canonical status vocabularies.
 *
 * Pure — no Express, no Mongoose. This file exists because of a bug that hid
 * for a week.
 *
 * `paymentsEvidenceFrom` filtered the ledger on `status === 'paid'`. The ledger
 * has no such status — its settled state is `succeeded`; `paid` belongs to the
 * marketplace *order* lifecycle, a different collection with a different word
 * for a similar-sounding thing. The filter matched nothing, so payments
 * evidence reported `hasRecord: false` for every applicant on the platform,
 * and the scoring engine that was declared unblocked was still blocked on a
 * quarter of its weight. The suite agreed with the bug because the test
 * fixtures had been written from the same wrong memory.
 *
 * Nothing about that was catchable by reading code. It was only catchable by
 * having one place that says what the words are, and making everything else
 * point at it. So: the enum lives here, the Mongoose schema imports it, the
 * rule modules import it, the dashboard buckets are checked against it, and
 * `verify` asserts that every status has somewhere to go. A new status added
 * to a model now fails the suite until a dashboard knows where to put it,
 * rather than quietly making a tile read low.
 *
 * Application statuses are the exception and stay in
 * `modules/application/applicationLifecycle.ts`: that file owns the transition
 * table as well as the list, and splitting them would put the two halves of
 * one rule in two places. It is already pure, so it is already importable.
 */

/* ─────────────────────────────────────────────────────────────────────────────
 * Property occupancy
 * ────────────────────────────────────────────────────────────────────────── */

export const OCCUPANCY_STATUSES = [
  /** Lettable today. */
  'vacant',
  /** Somebody lives there. */
  'occupied',
  /** Not lettable — work in progress. Not a vacancy anyone can fill. */
  'maintenance',
  /** Withdrawn by the landlord. Still LRMC's to manage, not LRMC's to let. */
  'offMarket',
] as const;

export type OccupancyStatus = (typeof OCCUPANCY_STATUSES)[number];

/* ─────────────────────────────────────────────────────────────────────────────
 * Payments
 * ────────────────────────────────────────────────────────────────────────── */

export const PAYMENT_STATUSES = [
  /** Owed. Not yet attempted. */
  'pending',
  /** Attempted, with the provider, no answer yet. */
  'processing',
  /** Money moved. **This is settled — not `paid`.** */
  'succeeded',
  /** Attempted and refused. */
  'failed',
  /** Money moved and came back. */
  'refunded',
  /** Called off before it was attempted. */
  'cancelled',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * The statuses that mean money actually moved.
 *
 * Declared as a subset of the list above and asserted to be one, so that
 * renaming `succeeded` in the model breaks the build here rather than silently
 * emptying every payment filter on the platform.
 */
export const SETTLED_PAYMENT_STATUSES: readonly PaymentStatus[] = ['succeeded'];

/** Attempted and refused. A missed instalment, as far as evidence goes. */
export const FAILED_PAYMENT_STATUSES: readonly PaymentStatus[] = ['failed'];

/**
 * Not yet evidence of anything.
 *
 * An instalment that is not due yet is neither paid nor missed, and counting
 * it as missed would make every tenant look worse on the first of the month.
 */
export const UNSETTLED_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'pending',
  'processing',
];

/* ─────────────────────────────────────────────────────────────────────────────
 * Maintenance
 * ────────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────────────
 * Leases
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The states a tenancy can be in.
 *
 * ── Four are the spine, three are the machinery ───────────────────────────
 * The brief for this module named four: `draft`, `active`, `completed`,
 * `terminated`. Those are the ones a person moves a lease between, and
 * `leaseLifecycle.ts` is the table of who may move which.
 *
 * The other three are here because deleting them would break behaviour that
 * already works, and each is *derived* rather than chosen:
 *
 *   `pendingSignature` — a draft both parties have seen but not signed. Absent,
 *       the only way to say "waiting on the tenant" is to leave it in `draft`,
 *       which is also what "nobody has finished writing it" looks like.
 *   `inArrears` — computed by `rentSchedule.lifecycleStatus` from the balance,
 *       and what the rent-reminder job drives off. Removing it would not make
 *       arrears go away; it would make them invisible.
 *   `expiring` — inside the notice window. This is what makes renewal a thing
 *       that can be offered before a tenancy lapses rather than after.
 *
 * ── `completed`, not `ended` ──────────────────────────────────────────────
 * This list previously said `ended`. Renamed to the brief's word, everywhere,
 * in one change — **not** added alongside it. Two words for one state is
 * exactly the `paid`/`succeeded` bug that hid for a week: a filter matches half
 * the rows, nothing throws, and the dashboard reads low. There is one word for
 * a tenancy that ran its course, and it is `completed`.
 */
export const LEASE_STATUSES = [
  /** Being written. Nothing is binding. */
  'draft',
  /** Both parties have it; at least one has not signed. */
  'pendingSignature',
  /** Running. */
  'active',
  /** Running, and behind on rent. Derived from the balance, not chosen. */
  'inArrears',
  /** Running, inside the notice window. Derived from the end date. */
  'expiring',
  /** Ran its full term. Terminal. */
  'completed',
  /** Ended early, by somebody, for a reason. Terminal. */
  'terminated',
] as const;

export type LeaseStatus = (typeof LEASE_STATUSES)[number];

/**
 * Statuses a person sets, as opposed to ones the rent arithmetic derives.
 *
 * `rentSchedule.lifecycleStatus` consults this: a terminated lease must not
 * quietly become `active` again because its end date has not passed yet.
 */
export const MANUAL_LEASE_STATUSES: readonly LeaseStatus[] = [
  'draft', 'pendingSignature', 'terminated', 'completed',
];

/** Statuses in which a tenancy is live and rent is owed. */
export const RUNNING_LEASE_STATUSES: readonly LeaseStatus[] = [
  'active', 'inArrears', 'expiring',
];

/** Terminal. A lease here is history, and history is not edited. */
export const CLOSED_LEASE_STATUSES: readonly LeaseStatus[] = ['completed', 'terminated'];

export const MAINTENANCE_STATUSES = [
  'open',
  'triaged',
  'assigned',
  'quoted',
  'approved',
  'inProgress',
  'onHold',
  'completed',
  'verified',
  'cancelled',
] as const;

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];
