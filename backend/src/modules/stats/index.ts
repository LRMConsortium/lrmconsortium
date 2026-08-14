/**
 * Aggregate statistics.
 *
 * These exist because every dashboard tile on the platform was counting a page
 * of list results. That is correct at ten properties and wrong at two hundred,
 * and wrong in the direction that looks fine: the number is plausible, just
 * too small. Each endpoint here runs one aggregation over the whole collection
 * and returns counts the database did, not counts a browser did.
 *
 * **Every one is scoped to the caller**, and that is the part to be careful
 * about. A landlord asking for property statistics must get their own
 * portfolio, not LRMC's; a coordinator gets their region; Back Office gets
 * everything. The scope is derived from the token here, never accepted as a
 * parameter — a `?owner=` a client could set would turn a dashboard into a
 * directory of the institution's holdings.
 *
 * The arithmetic and the status buckets live in `config/statsMath.ts`, so what
 * a number *means* is asserted without a database. This file runs pipelines
 * and shapes replies; it computes nothing.
 */

import { Router } from 'express';
import { authenticate, auditTrail, enterZone, requirePermission } from '../../middleware/index.js';
import { asyncHandler, ok } from '../../shared/http.js';
import {
  APPLICATION_BUCKETS,
  LEASE_BUCKETS,
  MAINTENANCE_BUCKETS,
  PAYMENT_BUCKETS,
  PROPERTY_BUCKETS,
  mean,
  rate,
  tally,
  totalOf,
} from '../../config/statsMath.js';
import { Property } from '../property/property.model.js';
import { Payment } from '../payment/payment.model.js';
import { MaintenanceRequest } from '../maintenance/maintenance.model.js';
import { Application } from '../application/application.model.js';
import { UsusuEntry } from '../evidence/evidence.model.js';
import { Lease } from '../lease/lease.model.js';
import { UsusuGroup } from '../evidence/evidence.model.js';
import { groupHealthFrom } from '../../config/evidence.js';
import { scopeFor, type ScopeActor, type ScopeFields } from './statsScope.js';
import { User } from '../../models/User.js';
import { LAUNCH_CURRENCY } from '../../config/currencies.js';

/**
 * The window "collected recently" means.
 *
 * Named rather than inlined as `30`, and returned in the reply, so a tile can
 * label itself from the answer instead of hard-coding a period that might
 * change here and nowhere else. A tile reading "Collected, 30 days" over a
 * figure computed across ninety is a small lie that survives for years.
 */
const COLLECTION_WINDOW_DAYS = 30;

const router = Router();
const guard = [authenticate, enterZone('MEMBER_PORTAL'), auditTrail('analytics')] as const;

/* The scope rule — the only security-relevant line in this file — lives in
 * `statsScope.ts`, which is Mongoose-free and therefore assertable without a
 * database. `scopeMatch` here is only the local name for it. */
type Actor = ScopeActor;

/**
 * The caller's profile ids — the join between this platform's two id spaces
 * for the fields that speak the profile one.
 */
async function profileIdsFor(userId: string): Promise<string[]> {
  const user = await User.findOne({ _id: userId, deletedAt: null })
    .select('profiles')
    .lean()
    .exec();
  if (!user) return [];
  return (user.profiles ?? []).map((pr) => String(pr.profileId));
}

/**
 * `scopeFor` with the caller's profiles resolved.
 *
 * The rule itself stays pure and Mongoose-free in `statsScope.ts`; this is the
 * one lookup it needs, done here so the rule can still be asserted in a suite
 * that has no database.
 */
async function scopeMatch(actor: Actor, fields: ScopeFields): Promise<Record<string, unknown>> {
  return scopeFor(actor, fields, await profileIdsFor(actor.userId));
}

/** Institution-wide, for the one place that needs it outside `scopeFor`. */
function seesEverythingHere(actor: Actor): boolean {
  return actor.roles.includes('founder')
    || actor.roles.includes('hqExecutive')
    || actor.roles.includes('backOfficeStaff');
}

/**
 * A pipeline stage, structurally.
 *
 * Mongoose's own `PipelineStage` is not exported by the installed typings, and
 * importing it fails the build. Nothing here needs the discriminated union —
 * the stages are literals a few lines below — so a stage is an object and the
 * shape of each one is checked by the driver, which is where it was always
 * going to be checked.
 */
type AggregateStage = Record<string, unknown>;

/** One `$match` then one `$group` — the whole pattern, written once. */
async function countByStatus(
  model: { aggregate: (p: AggregateStage[]) => { exec: () => Promise<unknown[]> } },
  match: Record<string, unknown>,
  field = '$status',
): Promise<{ _id: string | null; n: number }[]> {
  const rows = await model
    .aggregate([
      { $match: { deletedAt: null, ...match } },
      { $group: { _id: field, n: { $sum: 1 } } },
    ])
    .exec();
  return rows as { _id: string | null; n: number }[];
}

// ── Properties ──────────────────────────────────────────────────────────────

router.get(
  '/properties',
  ...guard,
  requirePermission('analytics:read', 'property:readOwn', 'property:read'),
  asyncHandler(async (req, res) => {
    const match = await scopeMatch(req.actor as Actor, {
      owner: { field: 'owner', space: 'profile' },
      coordinator: { field: 'assignedCoordinator', space: 'profile' },
      region: 'region',
    });
    const rows = await countByStatus(Property, match, '$occupancyStatus');
    const counts = tally(PROPERTY_BUCKETS, rows);
    const total = totalOf(counts);

    /* Tenancies against these properties.
     *
     * `occupancyStatus` on the property and a running lease are two different
     * claims, and they can disagree — a unit marked `occupied` with no live
     * lease is somebody living there without paperwork, which is exactly the
     * thing an institution needs to see rather than have averaged away. Both
     * are reported; neither is derived from the other. */
    const leaseCounts = tally(
      LEASE_BUCKETS,
      await countByStatus(Lease, await scopeMatch(req.actor as Actor, {
        owner: { field: 'landlord', space: 'profile' },
        coordinator: { field: 'coordinator', space: 'profile' },
      })),
    );

    return ok(res, {
      totalProperties: total,
      occupied: counts.occupied,
      vacant: counts.vacant,
      unavailable: counts.unavailable,
      unclassified: counts.other,
      /* Live tenancies. Compare against `occupied` — a gap either way is a
       * property whose paperwork and whose reality have come apart. */
      activeLeases: leaseCounts.running,
      leasesPending: leaseCounts.pending,
      leasesCompleted: leaseCounts.completed,
      leasesTerminated: leaseCounts.terminated,
      // Of the properties that could be occupied. Counting a property that is
      // off-market as a vacancy would make a landlord look worse than they are.
      occupancyRate: rate(counts.occupied ?? 0, (counts.occupied ?? 0) + (counts.vacant ?? 0)),
    });
  }),
);

// ── Payments ────────────────────────────────────────────────────────────────

router.get(
  '/payments',
  ...guard,
  requirePermission('analytics:read', 'payment:readOwn', 'payment:read'),
  asyncHandler(async (req, res) => {
    const match = await scopeMatch(req.actor as Actor, {
      owner: { field: 'payer', space: 'profile' },
      /* Not `coordinator` — Payment has no such column, so it matched
       * nothing and every coordinator's payment tiles read zero. What a
       * coordinator may see is the receipts they wrote. */
      coordinator: { field: 'recordedBy', space: 'user' },
    });
    const rows = await countByStatus(Payment, match);
    const counts = tally(PAYMENT_BUCKETS, rows);

    // On-time versus late needs the due date, which a status cannot answer.
    const timing = (await Payment.aggregate([
      { $match: { deletedAt: null, status: 'succeeded', ...match } },
      {
        $project: {
          late: {
            $cond: [
              { $and: ['$dueDate', '$paidAt'] },
              { $gt: [{ $subtract: ['$paidAt', '$dueDate'] }, 3 * 86_400_000] },
              // No due date on record is a gap in LRMC's data, not lateness.
              false,
            ],
          },
        },
      },
      { $group: { _id: '$late', n: { $sum: 1 } } },
    ]).exec()) as { _id: boolean; n: number }[];

    const late = timing.find((r) => r._id === true)?.n ?? 0;
    const onTime = timing.find((r) => r._id === false)?.n ?? 0;
    const settled = onTime + late;

    /* Money collected recently.
     *
     * **Grouped by currency, and deliberately not summed into one number.**
     * The ledger carries rides, rent, payouts and vendor invoices, and the
     * currency is a field on the row. `$sum: '$amount'` across the collection
     * would add dalasi to whatever else is there and produce a figure that is
     * not an amount of anything — and it would look completely ordinary on a
     * tile. There is no exchange rate anywhere in this platform and inventing
     * one here would be the wrong place for it.
     *
     * The window is closed at both ends by the database, not by filtering a
     * page of rows in a browser. */
    const leaseRunning = tally(
      LEASE_BUCKETS,
      await countByStatus(Lease, await scopeMatch(req.actor as Actor, {
        owner: { field: 'tenant', space: 'profile' },
        coordinator: { field: 'coordinator', space: 'profile' },
      })),
    ).running;

    const since = new Date(Date.now() - COLLECTION_WINDOW_DAYS * 86_400_000);
    const collected = (await Payment.aggregate([
      {
        $match: {
          deletedAt: null,
          status: 'succeeded',
          paidAt: { $gte: since },
          ...match,
        },
      },
      { $group: { _id: '$currency', amount: { $sum: '$amount' }, n: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]).exec()) as { _id: string | null; amount: number; n: number }[];

    return ok(res, {
      totalPayments: totalOf(counts),
      settled,
      onTime,
      late,
      awaiting: counts.awaiting,
      failed: counts.failed,
      // Of settled instalments. Dividing by every row would drag reliability
      // down every time an instalment fell due and had not yet been paid.
      reliability: rate(onTime, settled),
      /* Tenancies the rent is owed under. A collection rate means nothing
       * without knowing how many tenancies were running to collect from. */
      activeLeases: leaseRunning,
      collectionWindowDays: COLLECTION_WINDOW_DAYS,
      collected: collected.map((row) => ({
        currency: row._id ?? LAUNCH_CURRENCY,
        amount: Number.isFinite(row.amount) ? row.amount : 0,
        payments: row.n,
      })),
    });
  }),
);

// ── Maintenance ─────────────────────────────────────────────────────────────

router.get(
  '/maintenance',
  ...guard,
  requirePermission('analytics:read', 'maintenanceRequest:readOwn', 'maintenanceRequest:read'),
  asyncHandler(async (req, res) => {
    const match = await scopeMatch(req.actor as Actor, {
      /* `raisedBy` is polymorphic (`raisedByKind`) and is written with the
       * raiser's *user* id. `assignedCoordinator` is a CoordinatorProfile. */
      owner: { field: 'raisedBy', space: 'user' },
      coordinator: { field: 'assignedCoordinator', space: 'profile' },
      region: 'region',
    });
    const counts = tally(MAINTENANCE_BUCKETS, await countByStatus(MaintenanceRequest, match));

    return ok(res, {
      totalRequests: totalOf(counts),
      openRequests: counts.open,
      inProgress: counts.inProgress,
      completed: counts.completed,
      // Reported rather than hidden, so the buckets sum to the total. A
      // dashboard whose parts do not add up is one nobody trusts twice.
      stalled: counts.stalled,
      unclassified: counts.other,
    });
  }),
);

// ── Applications ────────────────────────────────────────────────────────────

router.get(
  '/applications',
  ...guard,
  requirePermission('analytics:read', 'application:readOwn', 'application:read'),
  asyncHandler(async (req, res) => {
    const match = await scopeMatch(req.actor as Actor, {
      owner: { field: 'landlord', space: 'profile' },
      coordinator: { field: 'coordinator', space: 'profile' },
    });
    const counts = tally(APPLICATION_BUCKETS, await countByStatus(Application, match));

    /* The end of the funnel. An approval that never became a tenancy is the
     * most useful number on this endpoint and the easiest to lose: it looks
     * like success on an applications dashboard and is a person who was told
     * yes and never moved in. */
    const leasesFromApprovals = tally(
      LEASE_BUCKETS,
      await countByStatus(Lease, await scopeMatch(req.actor as Actor, {
        owner: { field: 'landlord', space: 'profile' },
        coordinator: { field: 'coordinator', space: 'profile' },
      })),
    );
    /* Every bucket `tally` knows about is present with zero rather than
     * absent, but TypeScript reads an index signature as possibly undefined —
     * so the fallbacks are for the compiler, not for a real missing key. */
    const leasesIssued = (leasesFromApprovals.running ?? 0)
      + (leasesFromApprovals.completed ?? 0) + (leasesFromApprovals.terminated ?? 0);

    return ok(res, {
      totalApplications: totalOf(counts),
      underReview: counts.underReview,
      approved: counts.approved,
      declined: counts.declined,
      withdrawn: counts.withdrawn,
      unclassified: counts.other,
      leasesIssued,
      /* Of approvals that turned into a tenancy. `null` over no approvals —
       * never 0, which would read as "everybody we approved fell through". */
      conversionRate: rate(leasesIssued, counts.approved ?? 0),
    });
  }),
);

// ── Ususu ───────────────────────────────────────────────────────────────────

router.get(
  '/ususu',
  ...guard,
  requirePermission('analytics:read', 'ususuLedger:readOwn', 'ususuLedger:read'),
  asyncHandler(async (req, res) => {
    /* Through `scopeMatch` like every other endpoint here, and specifically
     * NOT through a hand-rolled `seesEverything(actor) || isCoordinator ? {}`,
     * which is what this line used to be. That version handed a coordinator an
     * empty match — the entire ledger, every contribution by every member of
     * the platform — because the Ususu ledger has no region field for them to
     * be narrowed to and "not an owner" was read as "unrestricted".
     *
     * `scopeMatch` denies instead. A coordinator therefore sees nothing here
     * until the ledger records a region, which is the honest answer: there is
     * no data to work out which contributions are theirs to supervise. */
    const match = await scopeMatch(req.actor as Actor, { owner: { field: 'subject', space: 'user' } });

    const rows = (await UsusuEntry.aggregate([
      { $match: { deletedAt: null, ...match } },
      {
        $group: {
          _id: '$subject',
          made: { $sum: { $cond: [{ $eq: ['$kind', 'contribution'] }, 1, 0] } },
          missed: { $sum: { $cond: [{ $eq: ['$kind', 'miss'] }, 1, 0] } },
        },
      },
    ]).exec()) as { _id: unknown; made: number; missed: number }[];

    const contributions = rows.reduce((s, r) => s + r.made, 0);
    const misses = rows.reduce((s, r) => s + r.missed, 0);

    /* Circles.
     *
     * `totalGroups` was absent from this endpoint for two weeks and reported as
     * a deliberate gap: the ledger recorded contributions per person and there
     * was no group entity, so a group count would have been a number on a
     * dashboard that nothing in the database backed. There is one now.
     *
     * Scoped the same way the register is: a person's own circles, or the ones
     * they steward. **Not every circle a coordinator can see** — they cannot
     * see every circle, which is the point of `mayReadGroup`, and a count that
     * ignored that would leak the size of the platform's savings activity to
     * anybody with a coordinator role. */
    const actor = req.actor as Actor;
    const groupMatch = seesEverythingHere(actor)
      ? { deletedAt: null }
      : { deletedAt: null, $or: [{ members: actor.userId }, { createdBy: actor.userId }] };
    const groupRows = (await UsusuGroup.aggregate([
      { $match: groupMatch },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]).exec()) as { _id: string | null; n: number }[];
    const totalGroups = groupRows.reduce((sum, r) => sum + r.n, 0);
    const activeGroups = groupRows
      .filter((r) => r._id === 'active' || r._id === 'forming' || r._id === 'paused')
      .reduce((sum, r) => sum + r.n, 0);

    return ok(res, {
      /* Both, now that there is something behind each. `totalMembers` counts
       * people with a contribution record; `totalGroups` counts registers. A
       * person in two circles is one member and two group memberships, and
       * conflating them would double-count the platform's savers. */
      totalGroups,
      activeGroups,
      totalMembers: rows.length,
      avgGroupHealth: mean(rows.map((r) => groupHealthFrom(r.missed))),
      totalContributions: contributions,
      totalMisses: misses,
    });
  }),
);

export const statsModule = {
  collectionPath: 'stats',
  mounts: [{ path: 'stats', router }],
};
