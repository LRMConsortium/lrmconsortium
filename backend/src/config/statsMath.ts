/**
 * Aggregate arithmetic, and the buckets a dashboard reports in.
 *
 * Pure — no Express, no Mongoose. The handlers run the aggregation; this file
 * decides what the numbers mean, which is the part worth asserting.
 *
 * Two rules run through all of it.
 *
 * **Nothing divides by an unguarded total.** `(onTime / total) * 100` returns
 * `NaN` on a landlord's first day, and `NaN` renders as "NaN%" on a tile.
 * Every rate here returns `null` when there is nothing to measure, and a tile
 * showing `—` is honest where `0%` is a lie.
 *
 * **Every status lands in exactly one bucket.** Maintenance has ten states and
 * a dashboard shows three; if `cancelled` and `onHold` quietly vanish, the
 * three numbers do not add up to the total and the first person to notice
 * stops trusting the whole screen. The buckets below are exhaustive, and the
 * suite fails if a new status is added to a model without being placed.
 *
 * The `satisfies` clauses below are the first half of that guarantee: a bucket
 * naming a status no model has is a compile error. `unplaced()` is the second
 * half — a status no bucket names is a suite failure. Between them a dashboard
 * cannot quietly disagree with the database about which states exist.
 */

import type {
  LeaseStatus,
  MaintenanceStatus,
  OccupancyStatus,
  PaymentStatus,
} from './lifecycles.js';
import type { ApplicationStatus } from '../modules/application/applicationLifecycle.js';

/**
 * A percentage, or `null` when there is nothing to take a percentage of.
 *
 * Deliberately not `0`. "No payments yet" and "no payments were on time" are
 * different facts, and a landlord reading 0% reliability on their first day
 * would reasonably think something was wrong.
 */
export function rate(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total)) return null;
  if (total <= 0) return null;
  return Math.round((Math.max(0, part) / total) * 1000) / 10;
}

/** A mean, or `null` over an empty set. */
export function mean(values: number[]): number | null {
  const usable = values.filter((v) => Number.isFinite(v));
  if (!usable.length) return null;
  return Math.round((usable.reduce((s, v) => s + v, 0) / usable.length) * 10) / 10;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Buckets
 *
 * Each maps every status a model can hold onto the handful a dashboard shows.
 * `other` exists so the buckets always sum to the total: a state nobody has
 * classified yet is visible rather than silently dropped.
 * ────────────────────────────────────────────────────────────────────────── */

export const PROPERTY_BUCKETS = {
  occupied: ['occupied'],
  vacant: ['vacant'],
  /** Not lettable today, and not a vacancy anyone can fill. */
  unavailable: ['maintenance', 'offMarket'],
} as const satisfies Record<string, readonly OccupancyStatus[]>;

/**
 * Payments.
 *
 * `succeeded` is the ledger's word for settled — **not `paid`**, which is the
 * marketplace order lifecycle's word for something else entirely. Reading the
 * wrong one produces a filter that matches nothing and a dashboard of zeros
 * that looks like a quiet month.
 */
export const PAYMENT_BUCKETS = {
  settled: ['succeeded'],
  awaiting: ['pending', 'processing'],
  failed: ['failed'],
  returned: ['refunded', 'cancelled'],
} as const satisfies Record<string, readonly PaymentStatus[]>;

export const MAINTENANCE_BUCKETS = {
  open: ['open', 'triaged', 'quoted', 'approved'],
  inProgress: ['assigned', 'inProgress'],
  completed: ['completed', 'verified'],
  /** Reported rather than hidden, so the three above plus this equal the total. */
  stalled: ['onHold', 'cancelled'],
} as const satisfies Record<string, readonly MaintenanceStatus[]>;

/**
 * Leases.
 *
 * Seven statuses into four buckets. `running` deliberately gathers `active`,
 * `inArrears` and `expiring` together: all three are live tenancies, and a
 * dashboard that split them would tell a landlord they have eleven tenancies
 * when they have fourteen, because three of them happen to be behind on rent.
 * Arrears are reported separately, by the payments aggregate, where they are
 * about money rather than about occupancy.
 */
export const LEASE_BUCKETS = {
  /** Being written or waiting on a signature. Not yet a tenancy. */
  pending: ['draft', 'pendingSignature'],
  /** Live. Somebody is housed under it. */
  running: ['active', 'inArrears', 'expiring'],
  /** Ran its term. */
  completed: ['completed'],
  /** Ended early. */
  terminated: ['terminated'],
} as const satisfies Record<string, readonly LeaseStatus[]>;

export const APPLICATION_BUCKETS = {
  underReview: ['submitted', 'underReview', 'awaitingApplicant'],
  approved: ['approved', 'leaseIssued'],
  declined: ['rejected'],
  withdrawn: ['withdrawn'],
} as const satisfies Record<string, readonly ApplicationStatus[]>;

type BucketTable = Record<string, readonly string[]>;

/** Which bucket a status belongs to, or `null` if nobody has placed it. */
export function bucketFor(table: BucketTable, status: string): string | null {
  for (const [name, members] of Object.entries(table)) {
    if (members.includes(status)) return name;
  }
  return null;
}

/**
 * Every status in `all` is placed in exactly one bucket.
 *
 * Returns the unplaced ones. A model gaining a status without the dashboard
 * gaining a home for it is the failure this catches, and it is silent
 * otherwise — the tile simply reads low.
 */
export function unplaced(table: BucketTable, all: readonly string[]): string[] {
  return all.filter((s) => bucketFor(table, s) === null);
}

/** Statuses claimed by more than one bucket, which would double-count. */
export function doubleCounted(table: BucketTable): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const members of Object.values(table)) {
    for (const s of members) {
      if (seen.has(s)) twice.add(s);
      seen.add(s);
    }
  }
  return [...twice];
}

/**
 * Turn `[{ _id: 'succeeded', n: 4 }, …]` into a count per bucket.
 *
 * Every bucket is present with zero rather than absent, so a caller never has
 * to distinguish "no rows in this bucket" from "the key is missing", and the
 * JSON shape is the same whether or not there is any data.
 */
export function tally(
  table: BucketTable,
  rows: { _id: string | null; n: number }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of Object.keys(table)) out[name] = 0;
  out.other = 0;

  for (const row of rows) {
    const bucket = row._id === null ? null : bucketFor(table, row._id);
    const n = Number.isFinite(row.n) ? row.n : 0;
    if (bucket) out[bucket] = (out[bucket] ?? 0) + n;
    else out.other += n;
  }
  return out;
}

/** The total across every bucket, including anything unclassified. */
export function totalOf(counts: Record<string, number>): number {
  return Object.values(counts).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
}
