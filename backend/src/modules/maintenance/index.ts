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
  runSlaEscalationSchema,
  updateMaintenanceRequestSchema,
} from './maintenance.validation.js';

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

      outcomes.push(
        await dispatchNotification({
          recipient: String(recipient),
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
