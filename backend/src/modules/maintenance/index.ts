import { Router } from 'express';
import {
  authenticate,
  auditTrail,
  enterZone,
  requireOwnership,
  requirePermission,
  validate,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { BaseService } from '../../shared/BaseService.js';
import { createCrudController } from '../../shared/BaseController.js';
import { asyncHandler, created, ok, paginated } from '../../shared/http.js';
import { aliasIdParam, listQuery, namedIdParam } from '../../shared/moduleFactory.js';
import { VendorProfile } from '../vendor/vendor.model.js';
import { CoordinatorProfile } from '../coordinator/coordinator.model.js';
import { Property } from '../property/property.model.js';
import { dispatchNotification, summariseDispatch, type DispatchOutcome } from '../notification/dispatch.js';
import { MaintenanceRequest, type IMaintenanceRequest } from './maintenance.model.js';
import {
  isSlaOpen,
  resolutionHours,
  routeToCoordinator,
  slaClockFor,
  slaHoursFor,
  type MaintenancePriority,
} from './sla.js';
import {
  assignVendorSchema,
  createMaintenanceRequestSchema,
  raiseMaintenanceSchema,
  runSlaEscalationSchema,
  updateMaintenanceRequestSchema,
  updateMaintenanceStatusSchema,
} from './maintenance.validation.js';
import {
  MAINTENANCE_WIDE_ROLES,
  shouldEscalate,
  updateProblems,
} from './maintenanceLifecycle.js';
import { MAINTENANCE_BUCKETS, mean, tally } from '../../config/statsMath.js';
import { User } from '../../models/User.js';

export const maintenanceService = new BaseService<IMaintenanceRequest>(MaintenanceRequest, {
  label: 'Maintenance request',
  searchableFields: ['reference', 'title'],
  filterableFields: [
    'status', 'priority', 'serviceType', 'property', 'assignedVendor', 'assignedCoordinator',
  ],
  ownerPath: 'raisedBy',
  organizationPath: 'assignedVendor',
  populate: ['property'],
  defaultSort: '-createdAt',
});

const controller = createCrudController(maintenanceService);

/**
 * The person behind a profile.
 *
 * `Notification.recipient` is a User; `assignedVendor` and `assignedCoordinator`
 * are profile ids. One join, done where the branch already knows which model to
 * ask.
 */
async function userBehindProfile(
  model: { findOne: (f: Record<string, unknown>) => { select: (s: string) => { lean: () => { exec: () => Promise<unknown> } } } },
  profileId: unknown,
): Promise<string | null> {
  const doc = (await model.findOne({ _id: profileId as never, deletedAt: null })
    .select('user').lean().exec()) as { user?: unknown } | null;
  return doc?.user ? String(doc.user) : null;
}

const collectionRouter = Router();
const itemRouter = Router();
const vendorScopedRouter = Router();
const propertyScopedRouter = Router();

const requestId = namedIdParam('requestId');
const aliasRequest = aliasIdParam('requestId');
const member = [authenticate, enterZone('MEMBER_PORTAL'), auditTrail('maintenanceRequest')] as const;

collectionRouter.get(
  '/',
  ...member,
  requirePermission('maintenanceRequest:read', 'maintenanceRequest:readOwn'),
  validate({ query: listQuery }),
  controller.list,
);

/**
 * Raise a work order.
 *
 * Three things are decided here rather than left for triage: the SLA clock
 * (from the priority, unless the caller overrode it), the coordinator (the
 * property's standing one, if it has one), and the first `statusHistory` entry.
 * A request that arrives with no clock and no owner is a request that sits.
 */
collectionRouter.post(
  '/',
  ...member,
  requirePermission('maintenanceRequest:create'),
  validate({ body: createMaintenanceRequestSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as Record<string, unknown>;

    const property = await Property.findOne({ _id: body.property as string, deletedAt: null })
      .select('_id assignedCoordinator occupancyStatus')
      .lean()
      .exec();
    if (!property) throw ApiError.notFound('Property');

    const priority = ((body.priority as string) ?? 'normal') as MaintenancePriority;
    const routed = routeToCoordinator({
      explicit: (body.assignedCoordinator as string | undefined) ?? null,
      propertyCoordinator: property.assignedCoordinator ? String(property.assignedCoordinator) : null,
      raisedByKind: (body.raisedByKind as string | undefined) ?? null,
      raisedBy: (body.raisedBy as string | undefined) ?? null,
    });

    const now = new Date();
    const doc = await MaintenanceRequest.create({
      ...body,
      priority,
      slaHours: slaHoursFor(priority, body.slaHours as number | undefined),
      assignedCoordinator: routed.coordinator ?? undefined,
      status: 'open',
      statusHistory: [
        { status: 'open', at: now, by: actor.userId, note: `routed:${routed.via}` },
      ],
      createdBy: actor.userId,
    });

    return created(res, doc.toObject());
  }),
);

itemRouter.get(
  '/:requestId',
  ...member,
  requirePermission('maintenanceRequest:read', 'maintenanceRequest:readOwn'),
  validate({ params: requestId }),
  aliasRequest,
  requireOwnership(maintenanceService, 'requestId'),
  controller.get,
);

/**
 * Update a work order.
 *
 * A status change is never just a field write: it appends to `statusHistory`,
 * and moving to `completed` stamps `completedAt` and the resolution hours in the
 * same operation. Letting a handler set `status` without those two would produce
 * a completed job with no completion time, which is the record an SLA report
 * cannot use.
 */
itemRouter.patch(
  '/:requestId',
  ...member,
  requirePermission('maintenanceRequest:update'),
  validate({ params: requestId, body: updateMaintenanceRequestSchema }),
  aliasRequest,
  requireOwnership(maintenanceService, 'requestId'),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as Record<string, unknown>;
    const current = await MaintenanceRequest.findOne({
      _id: req.params.requestId,
      deletedAt: null,
    }).exec();
    if (!current) throw ApiError.notFound('Maintenance request');

    const nextStatus = body.status as string | undefined;
    const now = new Date();
    const patch: Record<string, unknown> = { ...body, updatedBy: actor.userId };
    const push: Record<string, unknown> = {};

    if (nextStatus && nextStatus !== current.status) {
      if (!isSlaOpen(current.status)) {
        throw ApiError.conflict(
          `A request in status "${current.status}" is closed and cannot be reopened`,
        );
      }
      push.statusHistory = { status: nextStatus, at: now, by: actor.userId };

      if (nextStatus === 'inProgress' && !current.startedAt) patch.startedAt = now;
      if (nextStatus === 'completed') {
        patch.completedAt = now;
        patch.resolutionHours = resolutionHours(current.createdAt ?? now, now);
      }
      if (nextStatus === 'verified') patch.verifiedAt = now;
    }

    const updated = await MaintenanceRequest.findOneAndUpdate(
      { _id: current._id, status: current.status },
      { $set: patch, ...(push.statusHistory ? { $push: push } : {}) },
      { new: true, runValidators: true },
    ).exec();
    if (!updated) {
      throw ApiError.conflict('The request changed status while this update was in flight');
    }
    return ok(res, updated.toObject());
  }),
);

/**
 * Back Office or a coordinator puts a vendor on the job.
 *
 * Appends to `statusHistory` rather than only setting `status`, because the
 * question after a disputed invoice is always "who assigned this, and when".
 */
itemRouter.post(
  '/:requestId/assign-vendor',
  authenticate,
  enterZone('BACK_OFFICE'),
  auditTrail('maintenanceRequest'),
  requirePermission('maintenanceRequest:assign', 'maintenanceRequest:update'),
  validate({ params: requestId, body: assignVendorSchema }),
  aliasRequest,
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const { vendorId, scheduledFor, note } = req.body as {
      vendorId: string;
      scheduledFor?: Date;
      note?: string;
    };

    const request = await MaintenanceRequest.findOne({
      _id: req.params.requestId,
      deletedAt: null,
    })
      .select('_id status serviceType priority')
      .lean()
      .exec();
    if (!request) throw ApiError.notFound('Maintenance request');
    if (!isSlaOpen(request.status)) {
      throw ApiError.conflict(`A request in status "${request.status}" is closed`);
    }

    const vendor = await VendorProfile.findOne({ _id: vendorId, deletedAt: null })
      .select('_id user verificationStatus status serviceType secondaryServiceTypes')
      .lean()
      .exec();
    if (!vendor) throw ApiError.notFound('Vendor profile');
    if (vendor.verificationStatus !== 'verified') {
      throw ApiError.policy('Only a verified vendor can be assigned to a work order');
    }
    if (vendor.status !== 'active') {
      throw ApiError.policy(`This vendor is ${vendor.status} and cannot take new work`);
    }

    // Trade match. A verified plumber is still the wrong answer to an electrical
    // fault, and the assignment screen is where that should be caught.
    const trades = [vendor.serviceType, ...(vendor.secondaryServiceTypes ?? [])];
    if (!trades.includes(request.serviceType)) {
      throw ApiError.policy(
        `This vendor covers ${trades.join(', ')}; the request needs ${request.serviceType}`,
      );
    }

    const updated = await MaintenanceRequest.findOneAndUpdate(
      { _id: req.params.requestId, deletedAt: null },
      {
        $set: {
          assignedVendor: vendorId,
          assignedAt: new Date(),
          status: 'assigned',
          ...(scheduledFor ? { scheduledFor } : {}),
          updatedBy: actor.userId,
        },
        $push: {
          statusHistory: { status: 'assigned', at: new Date(), by: actor.userId, note },
        },
      },
      { new: true, runValidators: true },
    ).exec();

    if (!updated) throw ApiError.notFound('Maintenance request');

    // Tell the vendor. Best-effort — the assignment is already recorded, and a
    // provider outage must not roll it back.
    try {
      if (vendor.user) {
        await dispatchNotification({
          recipient: String(vendor.user),
          category: 'maintenance',
          channel: 'push',
          title: `New job assigned — ${updated.reference}`,
          body: `${updated.title} (${updated.priority}). Due within ${updated.slaHours}h.`,
          deepLink: `lrmc://maintenance/${updated.reference}`,
          subjectKind: 'MaintenanceRequest',
          subject: String(updated._id),
          createdBy: actor.userId,
        });
      }
    } catch {
      // Deliberately swallowed — see above.
    }

    return ok(res, updated.toObject());
  }),
);

/**
 * The SLA clock for one request.
 *
 * Read-only and computed on demand: `dueAt` and `overdueAt` are functions of
 * `createdAt`, the priority and the SLA hours, so changing a priority reshapes
 * the clock rather than leaving a stale stored deadline behind.
 */
itemRouter.get(
  '/:requestId/sla',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('maintenanceRequest:read', 'maintenanceRequest:readOwn'),
  validate({ params: requestId }),
  aliasRequest,
  requireOwnership(maintenanceService, 'requestId'),
  asyncHandler(async (req, res) => {
    const doc = (await MaintenanceRequest.findOne({
      _id: req.params.requestId,
      deletedAt: null,
    })
      .lean()
      .exec()) as IMaintenanceRequest | null;
    if (!doc) throw ApiError.notFound('Maintenance request');

    const clock = slaClockFor(doc.createdAt ?? new Date(), doc.priority, new Date(), {
      slaHours: doc.slaHours,
      completedAt: doc.completedAt ?? null,
    });

    return ok(res, {
      requestId: String(doc._id),
      reference: doc.reference,
      priority: doc.priority,
      status: doc.status,
      createdAt: doc.createdAt,
      completedAt: doc.completedAt ?? null,
      ...clock,
    });
  }),
);

/**
 * The SLA escalation sweep.
 *
 * Like the rent reminder run, the *schedule* is external and this is the
 * idempotent endpoint it calls. It only ever notifies — it never changes a
 * request's status, because "nobody has done this work" is not a state the work
 * order should claim on its own behalf.
 */
collectionRouter.post(
  '/run-sla-escalation',
  authenticate,
  enterZone('BACK_OFFICE'),
  auditTrail('maintenanceRequest'),
  requirePermission('maintenanceRequest:update', 'maintenanceRequest:read'),
  validate({ body: runSlaEscalationSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as { asOf?: Date; dryRun?: boolean; limit?: number };
    const asOf = body.asOf ?? new Date();
    const dryRun = body.dryRun ?? false;

    const open = (await MaintenanceRequest.find({
      deletedAt: null,
      status: { $nin: ['completed', 'verified', 'cancelled'] },
    })
      .limit(body.limit ?? 500)
      .lean()
      .exec()) as unknown as IMaintenanceRequest[];

    const byState: Record<string, number> = {};
    const byEscalation: Record<string, number> = {};
    const outcomes: DispatchOutcome[] = [];
    let breached = 0;

    for (const doc of open) {
      const clock = slaClockFor(doc.createdAt ?? asOf, doc.priority, asOf, {
        slaHours: doc.slaHours,
      });
      byState[clock.state] = (byState[clock.state] ?? 0) + 1;
      byEscalation[clock.escalation] = (byEscalation[clock.escalation] ?? 0) + 1;
      if (clock.breached) breached += 1;

      if (clock.escalation === 'none' || dryRun) continue;

      // Who to wake depends on how far the clock has run. Vendor first,
      // coordinator next, Back Office and HQ only when it is properly late.
      const recipient =
        clock.escalation === 'notifyVendor'
          ? doc.assignedVendor
          : clock.escalation === 'notifyCoordinator'
            ? (doc.assignedCoordinator ?? doc.assignedVendor)
            : doc.assignedCoordinator;
      if (!recipient) continue;

      /* `assignedVendor` and `assignedCoordinator` are profile ids;
       * `Notification.recipient` is a User. Passed through unresolved, every SLA
       * escalation LRMC has raised was addressed to an id belonging to no user —
       * written, counted as delivered, and read by nobody. Which model to ask is
       * known from the branch above. */
      const recipientUser = clock.escalation === 'notifyVendor'
        ? await userBehindProfile(VendorProfile, recipient)
        : await userBehindProfile(CoordinatorProfile, recipient);
      if (!recipientUser) continue;

      outcomes.push(
        await dispatchNotification({
          recipient: recipientUser,
          category: 'maintenance',
          channel: 'push',
          title: `SLA ${clock.state} — ${doc.reference}`,
          body: `${doc.title} (${doc.priority}) is ${clock.percentElapsed}% through its ${clock.slaHours}h window.`,
          deepLink: `lrmc://maintenance/${doc.reference}`,
          subjectKind: 'MaintenanceRequest',
          subject: String(doc._id),
          createdBy: actor.userId,
        }),
      );
    }

    return ok(res, {
      asOf,
      dryRun,
      examined: open.length,
      breached,
      byState,
      byEscalation,
      ...summariseDispatch(outcomes),
    });
  }),
);

/** A vendor's own queue — open work assigned to them, most urgent first. */
vendorScopedRouter.get(
  '/me/maintenance-queue',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('maintenanceRequest:readOwn', 'maintenanceRequest:read'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const vendor = await VendorProfile.findOne({ user: req.actor!.userId, deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    if (!vendor) throw ApiError.notFound('Vendor profile for current user');

    const { items, meta } = await maintenanceService.list({
      filters: { assignedVendor: String(vendor._id) },
      sort: '-priority -createdAt',
      limit: Number(req.query.limit ?? 50),
    });
    const open = items.filter(
      (r) => !['completed', 'verified', 'cancelled'].includes((r as IMaintenanceRequest).status),
    );
    return paginated(res, open, { ...meta, total: open.length });
  }),
);

/** Everything ever raised against one property, newest first. */
propertyScopedRouter.get(
  '/:propertyId/maintenance-history',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('maintenanceRequest:read', 'maintenanceRequest:readOwn'),
  validate({ params: namedIdParam('propertyId'), query: listQuery }),
  asyncHandler(async (req, res) => {
    const { items, meta } = await maintenanceService.list(
      {
        filters: { property: req.params.propertyId },
        includeDeleted: false,
        limit: Number(req.query.limit ?? 50),
        page: Number(req.query.page ?? 1),
      },
      req.actor,
    );
    return paginated(res, items, meta);
  }),
);

/* ═══════════════════════════════════════════════════════════════════════════
 * The member-portal surface.
 *
 * `/maintenance-requests` above is the Back Office collection: the whole
 * platform's work orders, paged and filterable. What follows is the same data
 * seen from inside a tenancy — one person's list, one person's summary, the
 * form a tenant fills in from a compound, and the status change a vendor makes
 * standing in front of the work.
 *
 * The rules live in `maintenanceLifecycle.ts` (what may follow what, and who
 * may make it) and `sla.ts` (when it is late). Neither imports Mongoose, so
 * both are asserted in a suite that runs in a second. This section resolves
 * ids and writes rows.
 *
 * ── Scope, and the shape of the mistake it avoids ─────────────────────────
 * A tenant sees requests they raised. A landlord sees requests against
 * properties they own. A vendor sees what they hold. Staff see everything.
 * `maintenanceScopeFor` is the one place that decides, and it returns a match
 * that is `null` — never `{}` — when the answer is "nothing", for the same
 * reason as the stats module: an empty object is not "no rows" to Mongo, it is
 * "no filter", and the difference is one pair of braces and everybody's
 * maintenance history.
 * ══════════════════════════════════════════════════════════════════════════ */

const memberRouter = Router();
const userIdParam = namedIdParam('userId');

/**
 * Which requests this actor may see about this person.
 *
 * `subjectId` is whose portal is being read. Reading your own is always
 * allowed; reading somebody else's needs a staff role, because a landlord
 * seeing "all maintenance raised by this tenant" would include requests against
 * properties that are none of their business.
 */
async function maintenanceScopeFor(
  actor: { userId: string; roles: string[] },
  subjectId: string,
): Promise<Record<string, unknown> | null> {
  const staff = (MAINTENANCE_WIDE_ROLES as readonly string[])
    .some((r) => actor.roles.includes(r));

  if (!staff && actor.userId !== subjectId) return null;

  const profileIds = await maintenanceProfileIds(subjectId);
  const ownership: Record<string, unknown>[] = [
    { raisedBy: { $in: profileIds } },
    { assignedVendor: { $in: profileIds } },
  ];

  /* A landlord's maintenance is the maintenance on their buildings, which is a
   * different question from what they personally raised. Resolved through the
   * properties they own rather than assumed.
   *
   * ── `owner` + `ownerKind`, not `landlord` ─────────────────────────────
   * This asked for `{ landlord: { $in: profileIds } }`. `Property` has no
   * `landlord` path — ownership is polymorphic, `ownerKind` naming the profile
   * model and `owner` holding its id, because a building can belong to a
   * landlord, a hotel or a resort.
   *
   * Mongoose is configured `strictQuery: true`, so a condition on a path the
   * schema does not have is **stripped from the query**. Not an error, not a
   * warning: removed. What ran was `Property.find({ deletedAt: null })` — every
   * building on the platform — and every one of their ids then went into the
   * `$or` above as this caller's. Any member reaching this scope read every
   * maintenance request LRMC holds.
   *
   * The same shape as the filter-allowlist defect: a restriction silently
   * dropped by a layer doing its job, failing open. `ownerKind` is pinned too,
   * so a LandlordProfile id cannot collide with a HotelProfile id. */
  const owned = await Property.find({
    owner: { $in: profileIds },
    ownerKind: 'LandlordProfile',
    deletedAt: null,
  })
    .select('_id')
    .lean()
    .exec();
  if (owned.length) ownership.push({ property: { $in: owned.map((p) => p._id) } });

  return { deletedAt: null, $or: ownership };
}

async function maintenanceProfileIds(userId: string): Promise<string[]> {
  const user = await User.findOne({ _id: userId, deletedAt: null })
    .select('profiles')
    .lean()
    .exec();
  /* The user's own id is included as well as their profiles: `raisedBy` is
   * polymorphic and older rows were written with a user id. Missing those would
   * make a tenant's own history look empty, which reads as "LRMC lost it". */
  const ids = (user?.profiles ?? []).map((p) => String(p.profileId));
  return [...ids, userId];
}

/**
 * Raise a work order from inside a tenancy.
 *
 * Distinct from `POST /maintenance-requests` above, which is the Back Office
 * route and accepts the full record. This one accepts what a person standing in
 * front of a broken thing can actually supply — where, what, how bad — and
 * fills in the rest: the SLA clock from the priority, and the property's
 * standing coordinator so the request has an owner from the first second rather
 * than sitting in a queue waiting for triage to notice it.
 */
memberRouter.post(
  '/request',
  ...member,
  requirePermission('maintenanceRequest:create'),
  validate({ body: raiseMaintenanceSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as {
      property: string; title: string; description?: string;
      serviceType: string; priority?: MaintenancePriority; photosBefore?: string[];
    };

    /* `assignedCoordinator`, not `coordinator` — and no `landlord`, which is
     * not a path on `Property` at all. Selected under the wrong names, both
     * came back undefined, so every request raised through this route was
     * created with no coordinator assigned: it went into the queue and was
     * routed to nobody. The sibling route ninety lines up had the right name
     * all along, which is what made this survive review. */
    const property = await Property.findOne({ _id: body.property, deletedAt: null })
      .select('_id assignedCoordinator')
      .lean()
      .exec();
    if (!property) throw ApiError.notFound('Property');

    const priority = body.priority ?? 'normal';
    const created_ = await MaintenanceRequest.create({
      property: property._id,
      raisedBy: actor.userId,
      raisedByKind: 'User',
      title: body.title,
      description: body.description,
      serviceType: body.serviceType,
      priority,
      photosBefore: body.photosBefore ?? [],
      slaHours: slaHoursFor(priority),
      assignedCoordinator: property.assignedCoordinator,
      status: 'open',
      /* The first history entry is written here rather than by a hook, because
       * a request whose history starts at its second state cannot be audited:
       * "who raised this and when" would be inferred from `createdAt` and a
       * guess. */
      statusHistory: [{ status: 'open', at: new Date(), by: actor.userId }],
      createdBy: actor.userId,
    });

    return created(res, created_);
  }),
);

/**
 * Move a request along.
 *
 * The id is in the body rather than the path. That is a departure from this
 * platform's convention — items live at `/maintenance-request/:requestId` — and
 * it is here because the brief asked for `POST /maintenance/update`. It is safe
 * (the id is validated as an id, and ownership is resolved from the loaded row
 * rather than from anything the caller said about it) but it does cost
 * something: the audit trail keys off the route, so every update shares one
 * path, and a reader of the log has to open the entry to see which request
 * moved. `PATCH /maintenance-request/:requestId` remains available and is the
 * better route for anything programmatic.
 */
memberRouter.post(
  '/update',
  ...member,
  requirePermission('maintenanceRequest:update', 'maintenanceRequest:updateOwn'),
  validate({ body: updateMaintenanceStatusSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as { request: string; status: string; note?: string };

    const request = await MaintenanceRequest.findOne({ _id: body.request, deletedAt: null }).exec();
    if (!request) throw ApiError.notFound('Maintenance request');

    /* Who this actor is *to this request* is resolved from the row, never from
     * anything the caller asserted. A body claiming `party: 'staff'` would be
     * the whole authorisation model in one field. */
    const vendorUser = request.assignedVendor
      ? await vendorUserId(String(request.assignedVendor))
      : null;

    const problems = updateProblems(
      { userId: actor.userId, roles: actor.roles as string[] },
      {
        status: request.status,
        raisedByUser: request.raisedBy ? String(request.raisedBy) : null,
        vendorUser,
      },
      { from: request.status, to: body.status, note: body.note },
    );
    if (problems.length) throw ApiError.validation('Request validation failed', problems);

    const now = new Date();
    request.status = body.status as typeof request.status;
    request.statusHistory.push({
      status: body.status, at: now, by: actor.userId as never, note: body.note,
    });

    if (body.status === 'inProgress' && !request.startedAt) request.startedAt = now;
    if (body.status === 'completed') {
      request.completedAt = now;
      request.resolutionHours = resolutionHours(request.createdAt, now);
    }
    if (body.status === 'verified') request.verifiedAt = now;

    await request.save();
    return ok(res, request);
  }),
);

/** The user behind a vendor profile, for deciding whose job this is. */
async function vendorUserId(vendorProfileId: string): Promise<string | null> {
  const vendor = await VendorProfile.findById(vendorProfileId).select('user').lean().exec();
  return vendor?.user ? String(vendor.user) : null;
}

memberRouter.get(
  '/:userId/list',
  ...member,
  requirePermission('maintenanceRequest:read', 'maintenanceRequest:readOwn'),
  validate({ params: userIdParam, query: listQuery }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const filters = await maintenanceScopeFor(
      { userId: actor.userId, roles: actor.roles as string[] },
      String(req.params.userId),
    );
    /* Refused, not answered empty. "You may not see this" and "there is nothing
     * to see" are different facts, and returning the second for the first
     * teaches a caller something about a person that is not theirs to learn. */
    if (!filters) throw ApiError.forbidden('You may not read this person\'s maintenance');

    /* `serverFilters`: `maintenanceScopeFor` built this, and it contains the
     * `$or` the client-filter allowlist does not list. Passed as `filters` it
     * was dropped and every request on the platform was returned. */
    const { items, meta } = await maintenanceService.list({
      serverFilters: filters as Record<string, unknown>,
      limit: Number(req.query.limit ?? 20),
      page: Number(req.query.page ?? 1),
    });
    return paginated(res, items, meta);
  }),
);

memberRouter.get(
  '/:userId/summary',
  ...member,
  requirePermission('maintenanceRequest:read', 'maintenanceRequest:readOwn'),
  validate({ params: userIdParam }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const filters = await maintenanceScopeFor(
      { userId: actor.userId, roles: actor.roles as string[] },
      String(req.params.userId),
    );
    if (!filters) throw ApiError.forbidden('You may not read this person\'s maintenance');

    /* Whole set, not a page — a summary over twenty rows reads as a summary
     * over a history, and that is the exact bug the aggregate endpoints exist
     * to remove. Five fields and `.lean()`, so it stays cheap. */
    const rows = await MaintenanceRequest.find(filters as Record<string, unknown>)
      .select('status priority slaHours createdAt completedAt statusHistory')
      .lean()
      .exec();

    const counts = tally(MAINTENANCE_BUCKETS, countRows(rows));
    const now = Date.now();

    /* Escalation is computed, never stored. A request does not *become*
     * escalated — it becomes somebody's — so this is a question asked of the
     * current state rather than a flag that can go stale. */
    const escalating = rows.filter((r) => {
      const clock = slaClockFor(
        new Date(r.createdAt as Date),
        r.priority as MaintenancePriority,
        new Date(now),
        {
          slaHours: r.slaHours as number,
          completedAt: (r.completedAt as Date | undefined) ?? null,
        },
      );
      const last = (r.statusHistory ?? []).slice(-1)[0];
      const hoursSince = last?.at
        ? (now - new Date(last.at).getTime()) / 3_600_000
        : null;
      return shouldEscalate({
        status: r.status as string,
        priority: r.priority as string,
        slaState: clock.state,
        hoursSinceStatusChange: hoursSince,
      }).escalate;
    });

    const resolved = rows
      .map((r) => r.resolutionHours as number | undefined)
      .filter((h): h is number => typeof h === 'number' && Number.isFinite(h));

    return ok(res, {
      total: rows.length,
      open: counts.open,
      inProgress: counts.inProgress,
      completed: counts.completed,
      stalled: counts.stalled,
      unclassified: counts.other,
      needsEscalation: escalating.length,
      /* `null`, not `0`, over nothing resolved. A landlord whose first request
       * is still open has not achieved a nought-hour turnaround. */
      averageResolutionHours: mean(resolved),
    });
  }),
);

function countRows(rows: { status?: unknown }[]): { _id: string | null; n: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = typeof r.status === 'string' ? r.status : null;
    const k = key ?? '__null';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => ({ _id: k === '__null' ? null : k, n }));
}

export const maintenanceModule = {
  collectionPath: 'maintenance-requests',
  itemPath: 'maintenance-request',
  idParam: 'requestId',
  resource: 'maintenanceRequest' as const,
  service: maintenanceService,
  controller,
  mounts: [
    { path: 'maintenance-requests', router: collectionRouter },
    { path: 'maintenance-request', router: itemRouter },
    { path: 'maintenance', router: memberRouter },
    { path: 'vendor', router: vendorScopedRouter },
    { path: 'property', router: propertyScopedRouter },
  ],
};

export {
  MaintenanceRequest,
  MAINTENANCE_STATUSES,
  MAINTENANCE_PRIORITIES,
} from './maintenance.model.js';
export type { IMaintenanceRequest };
export * from './maintenance.validation.js';
