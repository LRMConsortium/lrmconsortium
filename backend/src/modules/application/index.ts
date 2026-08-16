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
import { User } from '../../models/User.js';
import { Payment } from '../payment/payment.model.js';
import { Lease } from '../lease/lease.model.js';
import { tenancyEvidenceFrom } from '../lease/leaseLifecycle.js';
import { Dispute, Reference, UsusuEntry } from '../evidence/evidence.model.js';
import {
  disputesEvidenceFrom,
  identityEvidenceFrom,
  paymentsEvidenceFrom,
  referencesEvidenceFrom,
  ususuEvidenceFrom,
} from '../evidence/evidenceRules.js';
import { withDefaults, type EvidenceBundle } from '../../config/evidence.js';
import { Application, type IApplication } from './application.model.js';
import { assessEvidence, type Assessment } from './eligibility.js';
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

/**
 * Which side of an application the caller is on.
 *
 * Pure, and given the caller's profile ids rather than fetching them, so the
 * rule stays assertable without a database — which is how the rest of this
 * platform's decisions are written.
 *
 * `applicant` is matched against the **user id** and `landlord` against the
 * caller's **profile ids**, because those are the two different things those
 * two fields hold. Both were compared to `actor.userId`, so `landlord` never
 * matched: a landlord was refused their own property's applications, and fell
 * through to `null` — "that application is not yours to see".
 */
function actorFor(
  req: { actor?: { userId: string; roles: string[] } },
  doc: Pick<IApplication, 'applicant' | 'landlord'>,
  profileIds: readonly string[],
): ApplicationActor | null {
  const actor = req.actor;
  if (!actor) return null;
  if (String(doc.applicant) === actor.userId) return 'applicant';
  if (doc.landlord && profileIds.includes(String(doc.landlord))) return 'landlord';
  if (actor.roles.includes('backOfficeStaff') || actor.roles.includes('founder')) return 'staff';
  if (actor.roles.includes('coordinator')) return 'coordinator';
  return null;
}

/** Resolve the caller's profiles, then ask the pure rule above. */
async function whoIs(
  req: { actor?: { userId: string; roles: string[] } },
  doc: Pick<IApplication, 'applicant' | 'landlord'>,
): Promise<ApplicationActor | null> {
  if (!req.actor) return null;
  return actorFor(req, doc, await profileIdsFor(req.actor.userId));
}

/**
 * What this caller may list.
 *
 * `coordinator` and `landlord` are profile-keyed; `applicant` is user-keyed.
 * An `$in: []` — a caller who holds the role but has no profile — matches
 * nothing, which is the right answer and is not the same as an empty filter.
 */
function scopeFor(
  actor: { userId: string; roles: string[] },
  profileIds: readonly string[],
): Record<string, unknown> {
  if (actor.roles.includes('founder') || actor.roles.includes('backOfficeStaff')) return {};
  if (actor.roles.includes('coordinator')) return { coordinator: { $in: [...profileIds] } };
  return {
    $or: [
      { applicant: actor.userId },
      { landlord: { $in: [...profileIds] } },
    ],
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Evidence
 *
 * Five lookups, one per source. Each returns a fully-populated object whose
 * `hasRecord` says truthfully whether LRMC found anything — and a source that
 * cannot be reached returns `hasRecord: false` rather than throwing, so one
 * slow collection cannot stop an application being scored at all.
 *
 * `hasRecord: false` reaches the scorer as `unknown`, which holds the
 * application at review. That is deliberate and it is the property the whole
 * engine is built around: **LRMC not having looked is never counted against
 * the person it did not look at.**
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Every profile document this user owns, as ids — the join between the two id
 * spaces. The same helper exists in `payment/index.ts` for the same reason;
 * kept local rather than shared because the two modules resolve it at different
 * points and a shared one would invite caching it, which is how a person who
 * gains a profile mid-session gets scored against the profiles they had when
 * they signed in.
 */
async function profileIdsFor(userId: string): Promise<string[]> {
  const user = await User.findOne({ _id: userId, deletedAt: null })
    .select('profiles')
    .lean()
    .exec();
  if (!user) return [];
  return (user.profiles ?? []).map((p) => String(p.profileId));
}

/**
 * Everything the scorer needs about one applicant.
 *
 * ── This platform has three id spaces, and this function spans all of them ──
 * It used to take one id and use it for all six lookups, under a comment
 * asserting "the applicant is already a profile id here". It is not, and it
 * could not have been, because the six collections do not agree:
 *
 *   • `User`, and `Reference` / `Dispute` / `UsusuEntry` are keyed by **User
 *     id**. That is deliberate and documented in `evidence.model.ts`: evidence
 *     is about a *person*, and it must follow them across every role they hold.
 *     A dispute raised about somebody should not vanish because they were
 *     acting as a landlord that day rather than as a tenant.
 *   • `Payment.payer` and `Lease.tenant` are keyed by **profile id**, because
 *     one person's landlord ledger and tenant ledger are genuinely different
 *     records and must not be summed together.
 *
 * One value cannot be both. Passed a User id — which is what `applicant` holds,
 * matching its `ref: 'User'` — the two profile-keyed lookups returned `[]` for
 * every applicant on the platform. Not an error: an empty array, which
 * `paymentsEvidenceFrom` and `tenancyEvidenceFrom` faithfully reported as "we
 * looked and found nothing".
 *
 * So every applicant scored as having no payment history and no tenancy, and
 * **no application could ever be recommended** — the engine held every one of
 * them at review, which is exactly what it is designed to do with an applicant
 * nobody has evidence about. It looked like caution. It was a join.
 *
 * The profile ids are resolved once, here, and the two spaces are kept apart.
 */
async function gatherEvidence(applicantUserId: unknown): Promise<EvidenceBundle> {
  const subject = applicantUserId;

  /* The applicant's own profiles. `$in: []` when they hold none, which matches
   * nothing — correct, and different from matching everything. */
  const profileIds = await profileIdsFor(String(subject));

  const [user, references, disputes, ususu, payments, leases] = await Promise.all([
    User.findById(subject as never).select('isVerified verificationStatus').lean().exec()
      .catch(() => null),
    Reference.find({ subject: subject as never, deletedAt: null }).select('status score').lean().exec()
      .catch(() => null),
    Dispute.find({ subject: subject as never, deletedAt: null }).select('status severity').lean().exec()
      .catch(() => null),
    UsusuEntry.find({ subject: subject as never, deletedAt: null }).sort('period').select('kind period').lean().exec()
      .catch(() => null),
    /* Profile-keyed from here down. */
    Payment.find({ payer: { $in: profileIds } as never, deletedAt: null })
      .select('status dueDate paidAt').lean().exec()
      .catch(() => null),
    Lease.find({ tenant: { $in: profileIds } as never, deletedAt: null })
      .select('status leaseStart leaseEnd closedAt').lean().exec()
      .catch(() => null),
  ]);

  return withDefaults({
    identityEvidence: identityEvidenceFrom(user as never),
    referencesEvidence: references ? referencesEvidenceFrom(references as never) : undefined,
    disputesEvidence: disputes ? disputesEvidenceFrom(disputes as never) : undefined,
    ususuEvidence: ususu ? ususuEvidenceFrom(ususu as never) : undefined,
    paymentsEvidence: payments ? paymentsEvidenceFrom(payments as never) : undefined,
    /* `undefined` on a failed lookup, not an empty array. A collection that
     * could not be reached must reach the scorer as `hasRecord: false` — the
     * whole point of this function — and `tenancyEvidenceFrom([])` would say
     * "we looked and found nothing", which is a different and worse claim. */
    tenancyEvidence: leases ? tenancyEvidenceFrom(leases as never) : undefined,
  });
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
  doc: IApplication & { save: () => Promise<unknown>; monthlyIncome?: number },
  takenBy?: string,
): Promise<Assessment> {
  const property = await Property.findById(doc.property).select('rentAmount').lean().exec();
  const evidence = await gatherEvidence(doc.applicant);

  const assessment = assessEvidence(evidence, {
    monthlyIncome: doc.monthlyIncome,
    monthlyRent: doc.proposedRent ?? property?.rentAmount,
    // Whether a declared income has been evidenced is a document check LRMC
    // does not have a module for yet. Left undefined rather than asserted
    // either way — an unevidenced income scores lower, and claiming it was
    // evidenced would be a lie in the applicant's favour.
  });

  doc.assessment = {
    ...assessment,
    evidence: evidence as unknown as Record<string, unknown>,
    takenAt: new Date(),
    takenBy: takenBy as never,
  } as unknown as NonNullable<IApplication['assessment']>;
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

    const filter: Record<string, unknown> = { deletedAt: null, ...scopeFor(req.actor!, await profileIdsFor(req.actor!.userId)) };
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
    if (!await whoIs(req, doc)) throw ApiError.forbidden('That application is not yours to see.');
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
    if (await whoIs(req, doc) !== 'applicant') {
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
    const who = await whoIs(req, doc);
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

    const who = await whoIs(req, doc);
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

    const who = await whoIs(req, doc);
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
