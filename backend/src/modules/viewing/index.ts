/**
 * Viewing requests.
 *
 * **Every decision about when a slot is acceptable and who may move a request
 * lives in `viewingRules.ts`, not here.** This file resolves who the caller
 * is, asks the table, and writes the answer down. That split is what lets the
 * rules be asserted without a database, and it is why a tenant cannot mark
 * themselves attended: not because a condition in this file forbids it, but
 * because `mayAct` says no and this file does not argue.
 */

import { Router } from 'express';
import {
  authenticate,
  auditTrail,
  enterZone,
  requirePermission,
  validate,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { User } from '../../models/User.js';
import { asyncHandler, created, ok, paginated, pageMeta } from '../../shared/http.js';
import { namedIdParam } from '../../shared/moduleFactory.js';
import { Property } from '../property/property.model.js';
import { Viewing, type IViewing } from './viewing.model.js';
import {
  MAX_OPEN_REQUESTS_PER_TENANT,
  canRecordOutcome,
  canTransitionViewing,
  describeSlotProblem,
  isOpenViewing,
  mayAct,
  slotProblem,
  type ViewingActor,
  type ViewingStatus,
} from './viewingRules.js';
import {
  requestViewingSchema,
  updateViewingSchema,
  viewingDecisionSchema,
  viewingOutcomeSchema,
  viewingQuerySchema,
} from './viewing.validation.js';

const collectionRouter = Router();
const itemRouter = Router();
const viewingId = namedIdParam('viewingId');

const guard = [authenticate, enterZone('MEMBER_PORTAL'), auditTrail('viewing')] as const;

/**
 * Which hat is this caller wearing on *this* viewing?
 *
 * Resolved per record rather than from the role alone: the same person can be
 * the landlord of one property and a prospective tenant of another, and the
 * rules table is written in terms of the relationship, not the job title.
 */
/**
 * Which side of a viewing the caller is on.
 *
 * `requestedBy` is a **User** — it records who asked, which is a person.
 * `landlord` is a **LandlordProfile id**, written from `property.owner`. Both
 * were compared to `actor.userId`, so the landlord branch never matched and
 * every landlord was refused their own property's viewings.
 *
 * Pure, and given the caller's profile ids, so the rule stays assertable
 * without a database.
 */
function actorFor(
  req: { actor?: { userId: string; roles: string[] } },
  doc: Pick<IViewing, 'requestedBy' | 'landlord'>,
  profileIds: readonly string[],
): ViewingActor | null {
  const actor = req.actor;
  if (!actor) return null;
  if (String(doc.requestedBy) === actor.userId) return 'tenant';
  if (doc.landlord && profileIds.includes(String(doc.landlord))) return 'landlord';
  if (actor.roles.includes('backOfficeStaff') || actor.roles.includes('founder')) return 'staff';
  if (actor.roles.includes('coordinator')) return 'coordinator';
  return null;
}

/** Resolve the caller's profiles, then ask the pure rule above. */
async function whoIs(
  req: { actor?: { userId: string; roles: string[] } },
  doc: Pick<IViewing, 'requestedBy' | 'landlord'>,
): Promise<ViewingActor | null> {
  if (!req.actor) return null;
  const user = await User.findOne({ _id: req.actor.userId, deletedAt: null })
    .select('profiles').lean().exec();
  const profileIds = (user?.profiles ?? []).map((pr) => String(pr.profileId));
  return actorFor(req, doc, profileIds);
}

/** What a caller is allowed to see, expressed as a query. */
function scopeFor(actor: { userId: string; roles: string[] }): Record<string, unknown> {
  if (actor.roles.includes('founder') || actor.roles.includes('backOfficeStaff')) return {};
  if (actor.roles.includes('coordinator')) return { coordinator: actor.userId };
  // A landlord sees viewings on their own properties; a tenant sees their own.
  return { $or: [{ requestedBy: actor.userId }, { landlord: actor.userId }] };
}

// ── Ask ─────────────────────────────────────────────────────────────────────

collectionRouter.post(
  '/',
  ...guard,
  requirePermission('viewing:create'),
  validate({ body: requestViewingSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      property: string;
      requestedFor: Date;
      localHour: number;
      alternateFor?: Date;
      alternateLocalHour?: number;
      note?: string;
    };
    const actor = req.actor!;
    const now = new Date();

    // The slot, before anything is written down.
    const problem = slotProblem(body.requestedFor, now, body.localHour);
    if (problem) throw ApiError.validation(describeSlotProblem(problem), [
      { field: 'requestedFor', message: describeSlotProblem(problem), code: problem },
    ]);

    if (body.alternateFor !== undefined) {
      const alt = slotProblem(body.alternateFor, now, body.alternateLocalHour ?? -1);
      if (alt) throw ApiError.validation(describeSlotProblem(alt), [
        { field: 'alternateFor', message: describeSlotProblem(alt), code: alt },
      ]);
    }

    const property = await Property.findOne({
      _id: body.property,
      deletedAt: null,
      listedPublicly: true,
    })
      .select('_id owner ownerKind assignedCoordinator occupancyStatus')
      .lean()
      .exec();
    if (!property) throw ApiError.notFound('Property');
    if (property.occupancyStatus === 'occupied') {
      throw ApiError.badRequest('That property is not available to view.');
    }

    // Somebody enthusiastically booking every property in Serrekunda occupies
    // coordinators who then cannot serve anybody else.
    const open = await Viewing.countDocuments({
      requestedBy: actor.userId,
      status: { $in: ['requested', 'confirmed'] },
      deletedAt: null,
    }).exec();
    if (open >= MAX_OPEN_REQUESTS_PER_TENANT) {
      throw ApiError.badRequest(
        `You already have ${open} viewings booked. Complete or cancel one before asking for another.`,
      );
    }

    // One live request per property per person. A second is not a stronger
    // signal, it is a duplicate in a coordinator's diary.
    const duplicate = await Viewing.findOne({
      requestedBy: actor.userId,
      property: body.property,
      status: { $in: ['requested', 'confirmed'] },
      deletedAt: null,
    })
      .select('_id')
      .lean()
      .exec();
    if (duplicate) {
      throw ApiError.badRequest('You already have a viewing booked for this property.');
    }

    const doc = await Viewing.create({
      property: property._id,
      requestedBy: actor.userId,
      landlord: property.ownerKind === 'LandlordProfile' ? property.owner : undefined,
      coordinator: property.assignedCoordinator,
      requestedFor: body.requestedFor,
      localHour: body.localHour,
      alternateFor: body.alternateFor,
      alternateLocalHour: body.alternateLocalHour,
      note: body.note,
      status: 'requested',
    });

    return created(res, doc.toJSON());
  }),
);

// ── Read ────────────────────────────────────────────────────────────────────

collectionRouter.get(
  '/',
  ...guard,
  validate({ query: viewingQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as {
      page?: number;
      limit?: number;
      status?: ViewingStatus;
      property?: string;
      open?: boolean;
      from?: Date;
      to?: Date;
    };
    const page = q.page ?? 1;
    const limit = Math.min(100, q.limit ?? 20);

    const filter: Record<string, unknown> = { deletedAt: null, ...scopeFor(req.actor!) };
    if (q.status) filter.status = q.status;
    if (q.property) filter.property = q.property;
    if (q.open === true) filter.status = { $in: ['requested', 'confirmed'] };
    if (q.open === false) filter.status = { $nin: ['requested', 'confirmed'] };
    if (q.from || q.to) {
      filter.requestedFor = {
        ...(q.from ? { $gte: q.from } : {}),
        ...(q.to ? { $lte: q.to } : {}),
      };
    }

    const [items, total] = await Promise.all([
      Viewing.find(filter)
        .sort('requestedFor')
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      Viewing.countDocuments(filter).exec(),
    ]);
    return paginated(res, items, pageMeta(page, limit, total));
  }),
);

itemRouter.get(
  '/:viewingId',
  ...guard,
  validate({ params: viewingId }),
  asyncHandler(async (req, res) => {
    const doc = await Viewing.findOne({ _id: req.params.viewingId, deletedAt: null }).lean().exec();
    if (!doc) throw ApiError.notFound('Viewing');
    if (!await whoIs(req, doc)) throw ApiError.forbidden('That viewing is not yours to see.');
    return ok(res, doc);
  }),
);

itemRouter.patch(
  '/:viewingId',
  ...guard,
  validate({ params: viewingId, body: updateViewingSchema }),
  asyncHandler(async (req, res) => {
    const doc = await Viewing.findOne({ _id: req.params.viewingId, deletedAt: null }).exec();
    if (!doc) throw ApiError.notFound('Viewing');
    if (await whoIs(req, doc) !== 'tenant') {
      throw ApiError.forbidden('Only the person who asked may change the note.');
    }
    if (!isOpenViewing(doc.status)) {
      throw ApiError.badRequest('That viewing is closed.');
    }
    doc.note = (req.body as { note?: string }).note;
    await doc.save();
    return ok(res, doc.toJSON());
  }),
);

// ── Move ────────────────────────────────────────────────────────────────────

/**
 * One handler for every transition.
 *
 * Written once, because writing it four times is how the fourth one ends up
 * missing a check. The route supplies the destination; the rules supply
 * everything else.
 */
function transitionRoute(to: ViewingStatus, opts: { outcome?: boolean } = {}) {
  return asyncHandler(async (req, res) => {
    const doc = await Viewing.findOne({ _id: req.params.viewingId, deletedAt: null }).exec();
    if (!doc) throw ApiError.notFound('Viewing');

    const who = await whoIs(req, doc);
    if (!who) throw ApiError.forbidden('That viewing is not yours to move.');

    if (!canTransitionViewing(doc.status, to)) {
      throw ApiError.badRequest(`A ${doc.status} viewing cannot become ${to}.`);
    }
    if (!mayAct(who, to)) {
      throw ApiError.forbidden(`A ${who} cannot mark a viewing ${to}.`);
    }

    // A no-show recorded an hour early is a prediction, and it lands on a
    // tenant's record where it counts against them at application time.
    if (opts.outcome && !canRecordOutcome(doc.requestedFor, new Date())) {
      throw ApiError.badRequest('That viewing has not happened yet.');
    }

    doc.status = to;
    if (opts.outcome) {
      doc.outcomeRecordedAt = new Date();
      doc.outcomeNote = (req.body as { outcomeNote?: string }).outcomeNote;
    } else {
      doc.decidedAt = new Date();
      doc.decidedBy = req.actor!.userId as unknown as IViewing['decidedBy'];
      doc.decisionReason = (req.body as { reason?: string }).reason;
    }
    await doc.save();
    return ok(res, doc.toJSON());
  });
}

itemRouter.post(
  '/:viewingId/confirm',
  ...guard,
  requirePermission('viewing:approve'),
  validate({ params: viewingId, body: viewingDecisionSchema }),
  transitionRoute('confirmed'),
);

itemRouter.post(
  '/:viewingId/decline',
  ...guard,
  requirePermission('viewing:approve'),
  validate({ params: viewingId, body: viewingDecisionSchema }),
  transitionRoute('declined'),
);

// `viewing:readOwn`, not `viewing:approve`: cancelling is the tenant's own act
// on their own request, and `mayAct` is what keeps a landlord from doing it for
// them. The grant is here only so the published contract does not advertise
// this route to every role on the platform.
itemRouter.post(
  '/:viewingId/cancel',
  ...guard,
  requirePermission('viewing:readOwn'),
  validate({ params: viewingId, body: viewingDecisionSchema }),
  transitionRoute('cancelled'),
);

itemRouter.post(
  '/:viewingId/complete',
  ...guard,
  requirePermission('viewing:update'),
  validate({ params: viewingId, body: viewingOutcomeSchema }),
  transitionRoute('completed', { outcome: true }),
);

itemRouter.post(
  '/:viewingId/no-show',
  ...guard,
  requirePermission('viewing:update'),
  validate({ params: viewingId, body: viewingOutcomeSchema }),
  transitionRoute('noShow', { outcome: true }),
);

export const viewingModule = {
  collectionPath: 'viewings',
  mounts: [
    { path: 'viewings', router: collectionRouter },
    { path: 'viewing', router: itemRouter },
  ],
};

export { Viewing } from './viewing.model.js';
export type { IViewing } from './viewing.model.js';
