/**
 * Tenancy applications.
 *
 * **This file never decides anything.** It gathers what LRMC knows, hands it
 * to `eligibility.assessApplication` for a recommendation, and hands the
 * proposed move to `applicationLifecycle.decisionProblems` to find out whether
 * a person is allowed to make it. Both answers come back from modules with no
 * database access, which is what makes them assertable — and it is why a
 * landlord cannot approve their own applicant: not because of a condition
 * here, but because `mayDecide` says no.
 *
 * The one piece of judgement in this file is `gatherEvidence`, and it is
 * deliberately conservative: anything LRMC cannot look up is left `undefined`
 * so the scorer reports it `unknown` rather than counting a zero against
 * somebody. A tenant new to the country has no payment history with us; that
 * must not read as a bad payment history.
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
import { asyncHandler, created, ok, paginated, pageMeta } from '../../shared/http.js';
import { namedIdParam } from '../../shared/moduleFactory.js';
import { Property } from '../property/property.model.js';
import { Viewing } from '../viewing/viewing.model.js';
import { Application, type IApplication } from './application.model.js';
import {
  assessApplication,
  type Assessment,
  type EligibilityInput,
} from './eligibility.js';
import {
  canTransitionApplication,
  decisionProblems,
  describeDecisionProblem,
  isOpenApplication,
  type ApplicationActor,
  type ApplicationStatus,
} from './applicationLifecycle.js';
import {
  applicationQuerySchema,
  createApplicationSchema,
  decideApplicationSchema,
  requestFromApplicantSchema,
  updateApplicationSchema,
} from './application.validation.js';

const collectionRouter = Router();
const itemRouter = Router();
const applicationId = namedIdParam('applicationId');

const guard = [authenticate, enterZone('MEMBER_PORTAL'), auditTrail('application')] as const;

function actorFor(
  req: { actor?: { userId: string; roles: string[] } },
  doc: Pick<IApplication, 'applicant' | 'landlord'>,
): ApplicationActor | null {
  const actor = req.actor;
  if (!actor) return null;
  if (String(doc.applicant) === actor.userId) return 'applicant';
  if (doc.landlord && String(doc.landlord) === actor.userId) return 'landlord';
  if (actor.roles.includes('backOfficeStaff') || actor.roles.includes('founder')) return 'staff';
  if (actor.roles.includes('coordinator')) return 'coordinator';
  return null;
}

function scopeFor(actor: { userId: string; roles: string[] }): Record<string, unknown> {
  if (actor.roles.includes('founder') || actor.roles.includes('backOfficeStaff')) return {};
  if (actor.roles.includes('coordinator')) return { coordinator: actor.userId };
  return { $or: [{ applicant: actor.userId }, { landlord: actor.userId }] };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Evidence
 *
 * Conservative on purpose. A field LRMC cannot establish is left out, so the
 * scorer reports it `unknown` and the application is held for review rather
 * than scored down. Passing `0` here would be the difference between "we have
 * not checked" and "we checked and it was nothing".
 * ────────────────────────────────────────────────────────────────────────── */

interface EvidenceSources {
  user?: { isVerified?: boolean; verificationStatus?: string } | null;
  payments?: { onTime: number; late: number; missed: number } | null;
  ususuMonths?: number | null;
  disputes?: { open: number; resolved: number } | null;
  references?: { provided: number; cleared: number } | null;
  employmentEvidenced?: boolean | null;
}

export function gatherEvidence(
  application: Pick<IApplication, 'proposedRent'> & { monthlyIncome?: number },
  askingRent: number | undefined,
  sources: EvidenceSources,
): EligibilityInput {
  const input: EligibilityInput = {};

  if (sources.user) {
    if (sources.user.isVerified === true) input.identityVerified = true;
    else if (sources.user.verificationStatus === 'pending') input.identityPending = true;
    else if (sources.user.verificationStatus === 'unsubmitted') input.identityVerified = false;
    // Anything else — a status we do not recognise — is left undefined, which
    // reads as "not checked" rather than "failed".
  }

  const rent = application.proposedRent ?? askingRent;
  if (typeof application.monthlyIncome === 'number' && typeof rent === 'number' && rent > 0) {
    input.monthlyIncome = application.monthlyIncome;
    input.monthlyRent = rent;
    if (typeof sources.employmentEvidenced === 'boolean') {
      input.employmentEvidenced = sources.employmentEvidenced;
    }
  }

  if (sources.references) {
    input.referencesProvided = sources.references.provided;
    input.referencesCleared = sources.references.cleared;
  }

  if (sources.payments) {
    input.paymentsOnTime = sources.payments.onTime;
    input.paymentsLate = sources.payments.late;
    input.paymentsMissed = sources.payments.missed;
  }

  if (typeof sources.ususuMonths === 'number') input.ususuMonths = sources.ususuMonths;

  if (sources.disputes) {
    input.openDisputes = sources.disputes.open;
    input.resolvedDisputes = sources.disputes.resolved;
  }

  return input;
}

/**
 * Take an assessment and record it on the application.
 *
 * A **snapshot**, not a view. When a coordinator approves, the assessment on
 * the record is the one they were looking at — not what the scorer would say
 * today against payment history that has since moved. Recomputing on read
 * would rewrite history every time somebody paid their rent.
 */
async function takeAssessment(
  doc: IApplication & { save: () => Promise<unknown> },
  takenBy?: string,
): Promise<Assessment> {
  const property = await Property.findById(doc.property)
    .select('rentAmount')
    .lean()
    .exec();

  // Evidence LRMC can establish today. Sources it has no module for yet are
  // left out rather than faked — `undefined` is the honest answer, and the
  // scorer is built to say "unknown" rather than "fail".
  const attended = await Viewing.countDocuments({
    requestedBy: doc.applicant,
    status: 'completed',
    deletedAt: null,
  }).exec();

  const evidence = gatherEvidence(
    doc as IApplication & { monthlyIncome?: number },
    property?.rentAmount,
    {
      user: null,
      payments: null,
      ususuMonths: null,
      disputes: null,
      // Two cleared references is the bar; a completed viewing is not a
      // reference, so this stays out of `references` entirely.
      references: null,
      employmentEvidenced: null,
    },
  );
  void attended;

  const assessment = assessApplication(evidence);
  doc.assessment = {
    ...assessment,
    takenAt: new Date(),
    takenBy: takenBy as unknown as IApplication['assessment'] extends undefined
      ? never
      : NonNullable<IApplication['assessment']>['takenBy'],
  } as NonNullable<IApplication['assessment']>;
  await doc.save();
  return assessment;
}

// ── Apply ───────────────────────────────────────────────────────────────────

collectionRouter.post(
  '/',
  ...guard,
  requirePermission('application:create'),
  validate({ body: createApplicationSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> & { property: string };
    const actor = req.actor!;

    const property = await Property.findOne({
      _id: body.property,
      deletedAt: null,
      listedPublicly: true,
    })
      .select('_id owner ownerKind assignedCoordinator occupancyStatus rentCurrency')
      .lean()
      .exec();
    if (!property) throw ApiError.notFound('Property');
    if (property.occupancyStatus === 'occupied') {
      throw ApiError.badRequest('That property is no longer available.');
    }

    // One live application per person per property. A second is not a stronger
    // signal, it is two things for a coordinator to reconcile.
    const existing = await Application.findOne({
      applicant: actor.userId,
      property: property._id,
      status: { $in: ['submitted', 'underReview', 'awaitingApplicant', 'approved'] },
      deletedAt: null,
    })
      .select('_id status')
      .lean()
      .exec();
    if (existing) {
      throw ApiError.badRequest('You already have an application open on this property.');
    }

    const doc = await Application.create({
      ...body,
      property: property._id,
      applicant: actor.userId,
      landlord: property.ownerKind === 'LandlordProfile' ? property.owner : undefined,
      coordinator: property.assignedCoordinator,
      currency: property.rentCurrency ?? 'GMD',
      status: 'submitted',
    });

    // Scored immediately, so the applicant is not left wondering and the
    // coordinator's queue arrives already sorted by what needs a person.
    await takeAssessment(doc as unknown as IApplication & { save: () => Promise<unknown> });

    return created(res, doc.toJSON());
  }),
);

// ── Read ────────────────────────────────────────────────────────────────────

collectionRouter.get(
  '/',
  ...guard,
  validate({ query: applicationQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as {
      page?: number;
      limit?: number;
      status?: ApplicationStatus;
      property?: string;
      open?: boolean;
      recommendation?: string;
    };
    const page = q.page ?? 1;
    const limit = Math.min(100, q.limit ?? 20);

    const filter: Record<string, unknown> = { deletedAt: null, ...scopeFor(req.actor!) };
    if (q.status) filter.status = q.status;
    if (q.property) filter.property = q.property;
    if (q.recommendation) filter['assessment.recommendation'] = q.recommendation;
    if (q.open === true) filter.status = { $in: ['submitted', 'underReview', 'awaitingApplicant'] };
    if (q.open === false) {
      filter.status = { $nin: ['submitted', 'underReview', 'awaitingApplicant'] };
    }

    const [items, total] = await Promise.all([
      Application.find(filter)
        .sort('-createdAt')
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      Application.countDocuments(filter).exec(),
    ]);
    return paginated(res, items, pageMeta(page, limit, total));
  }),
);

itemRouter.get(
  '/:applicationId',
  ...guard,
  validate({ params: applicationId }),
  asyncHandler(async (req, res) => {
    const doc = await Application.findOne({ _id: req.params.applicationId, deletedAt: null })
      .lean()
      .exec();
    if (!doc) throw ApiError.notFound('Application');
    if (!actorFor(req, doc)) throw ApiError.forbidden('That application is not yours to see.');
    return ok(res, doc);
  }),
);

itemRouter.patch(
  '/:applicationId',
  ...guard,
  validate({ params: applicationId, body: updateApplicationSchema }),
  asyncHandler(async (req, res) => {
    const doc = await Application.findOne({ _id: req.params.applicationId, deletedAt: null }).exec();
    if (!doc) throw ApiError.notFound('Application');
    if (actorFor(req, doc) !== 'applicant') {
      throw ApiError.forbidden('Only the applicant may change their application.');
    }
    if (!isOpenApplication(doc.status)) {
      throw ApiError.badRequest('That application has been decided.');
    }
    Object.assign(doc, req.body as Record<string, unknown>);
    await doc.save();
    // What they changed may change the recommendation, so it is retaken.
    await takeAssessment(doc as unknown as IApplication & { save: () => Promise<unknown> });
    return ok(res, doc.toJSON());
  }),
);

/** Re-score on demand, for when the evidence has moved on. */
itemRouter.post(
  '/:applicationId/assess',
  ...guard,
  requirePermission('application:update'),
  validate({ params: applicationId }),
  asyncHandler(async (req, res) => {
    const doc = await Application.findOne({ _id: req.params.applicationId, deletedAt: null }).exec();
    if (!doc) throw ApiError.notFound('Application');
    const who = actorFor(req, doc);
    if (who !== 'coordinator' && who !== 'staff') {
      throw ApiError.forbidden('Only LRMC re-scores an application.');
    }
    const assessment = await takeAssessment(
      doc as unknown as IApplication & { save: () => Promise<unknown> },
      req.actor!.userId,
    );
    return ok(res, { assessment, application: doc.toJSON() });
  }),
);

// ── Move ────────────────────────────────────────────────────────────────────

/**
 * Every transition, through one door.
 *
 * The whole of the authorisation is `decisionProblems`, which returns *every*
 * problem rather than the first — so a caller is told once what to fix instead
 * of discovering it a refusal at a time.
 */
function moveRoute(to: ApplicationStatus) {
  return asyncHandler(async (req, res) => {
    const doc = await Application.findOne({ _id: req.params.applicationId, deletedAt: null }).exec();
    if (!doc) throw ApiError.notFound('Application');

    const who = actorFor(req, doc);
    if (!who) throw ApiError.forbidden('That application is not yours to move.');

    const body = req.body as { reason?: string; outstandingRequest?: string };
    const problems = decisionProblems({
      from: doc.status,
      to,
      actor: who,
      decidedBy: req.actor!.userId,
      reason: body.reason,
    });

    if (problems.length) {
      throw ApiError.validation(
        describeDecisionProblem(problems[0]!),
        problems.map((p) => ({ field: 'status', message: describeDecisionProblem(p), code: p })),
      );
    }

    if (to === 'approved' || to === 'rejected') {
      // Recorded so that a decision going against the score is visible later
      // without re-deriving it. Somebody overruling a `decline` is often the
      // right call; it should still be findable.
      const recommendation = doc.assessment?.recommendation;
      doc.decision = {
        outcome: to,
        decidedBy: req.actor!.userId as unknown as NonNullable<IApplication['decision']>['decidedBy'],
        decidedAt: new Date(),
        reason: body.reason!,
        againstRecommendation:
          (to === 'approved' && recommendation === 'decline') ||
          (to === 'rejected' && recommendation === 'recommend'),
      };
    }

    if (to === 'awaitingApplicant') {
      doc.outstandingRequest = body.outstandingRequest;
    }

    doc.status = to;
    await doc.save();
    return ok(res, doc.toJSON());
  });
}

itemRouter.post(
  '/:applicationId/review',
  ...guard,
  requirePermission('application:update'),
  validate({ params: applicationId }),
  moveRoute('underReview'),
);

itemRouter.post(
  '/:applicationId/request-information',
  ...guard,
  requirePermission('application:update'),
  validate({ params: applicationId, body: requestFromApplicantSchema }),
  moveRoute('awaitingApplicant'),
);

itemRouter.post(
  '/:applicationId/approve',
  ...guard,
  requirePermission('application:approve'),
  validate({ params: applicationId, body: decideApplicationSchema }),
  moveRoute('approved'),
);

itemRouter.post(
  '/:applicationId/reject',
  ...guard,
  requirePermission('application:approve'),
  validate({ params: applicationId, body: decideApplicationSchema }),
  moveRoute('rejected'),
);

// `application:readOwn`, not `:approve`: withdrawing is the applicant's own act
// and `mayDecide` is what stops anybody else performing it on their behalf. The
// grant is here so the contract does not advertise the route to every role.
itemRouter.post(
  '/:applicationId/withdraw',
  ...guard,
  requirePermission('application:readOwn'),
  validate({ params: applicationId }),
  moveRoute('withdrawn'),
);

/**
 * Mark an approved application as having produced a lease.
 *
 * The lease itself is created through `POST /leases`, which is where the
 * money, the schedule and the coordinator assignment live. This route records
 * the link, and `canTransitionApplication` is what guarantees it can only
 * happen from `approved`.
 */
itemRouter.post(
  '/:applicationId/lease',
  ...guard,
  requirePermission('lease:create'),
  validate({ params: applicationId }),
  asyncHandler(async (req, res) => {
    const doc = await Application.findOne({ _id: req.params.applicationId, deletedAt: null }).exec();
    if (!doc) throw ApiError.notFound('Application');

    const who = actorFor(req, doc);
    if (!who) throw ApiError.forbidden('That application is not yours to move.');
    if (!canTransitionApplication(doc.status, 'leaseIssued')) {
      throw ApiError.badRequest('Only an approved application becomes a lease.');
    }

    const { leaseId } = req.body as { leaseId?: string };
    if (!leaseId) throw ApiError.validation('A lease id is required.', [
      { field: 'leaseId', message: 'Create the lease first, then record it here.', code: 'required' },
    ]);

    doc.lease = leaseId as unknown as IApplication['lease'];
    doc.status = 'leaseIssued';
    await doc.save();
    return ok(res, doc.toJSON());
  }),
);

export const applicationModule = {
  collectionPath: 'applications',
  mounts: [
    { path: 'applications', router: collectionRouter },
    { path: 'application', router: itemRouter },
  ],
};

export { Application } from './application.model.js';
export type { IApplication } from './application.model.js';
