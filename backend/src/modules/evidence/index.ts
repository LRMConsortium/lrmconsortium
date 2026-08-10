/**
 * Evidence — references, disputes and the Ususu ledger.
 *
 * Three collections, one surface, because they are the same shape of problem:
 * a small record about one person that the scoring engine reads.
 *
 * **Nothing here computes a score.** These routes record what happened;
 * `evidenceRules.ts` turns records into evidence, and `eligibility.ts` turns
 * evidence into a recommendation. The split is what lets the rules be
 * asserted without a database.
 *
 * Two access rules run through all of it:
 *
 *  • **A person may read their own evidence and nobody else's.** Coordinators
 *    and Back Office see the people they are responsible for. The routers
 *    narrow on `subject` rather than trusting the caller's parameter.
 *  • **Nobody produces evidence about themselves.** A subject cannot open a
 *    dispute against themselves, score their own reference, or record their
 *    own Ususu contribution. Every one of those would be the applicant
 *    filling in their own assessment.
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
import { asyncHandler, created, ok } from '../../shared/http.js';
import { namedIdParam } from '../../shared/moduleFactory.js';
import { Dispute, Reference, UsusuEntry } from './evidence.model.js';
import {
  disputesEvidenceFrom,
  referencesEvidenceFrom,
  ususuEvidenceFrom,
} from './evidenceRules.js';
import {
  openDisputeSchema,
  requestReferenceSchema,
  resolveMemberDisputeSchema,
  respondToReferenceSchema,
  ususuContributionSchema,
  ususuMissSchema,
} from './evidence.validation.js';

const guard = [authenticate, enterZone('MEMBER_PORTAL'), auditTrail('evidence')] as const;

const references = Router();
const disputes = Router();
const ususu = Router();

type Actor = { userId: string; roles: string[] };

/** Staff and coordinators act on other people's records; nobody else does. */
function isStaff(actor: Actor): boolean {
  return actor.roles.includes('founder')
    || actor.roles.includes('backOfficeStaff')
    || actor.roles.includes('coordinator');
}

/**
 * May this caller read evidence about this subject?
 *
 * Their own, always. Anybody else's, only if they are staff. A landlord
 * deliberately cannot: they see an applicant's *assessment* on the
 * application, which is the summary LRMC stands behind, not the underlying
 * disputes and referee comments.
 */
function mayRead(actor: Actor, subject: string): boolean {
  return actor.userId === subject || isStaff(actor);
}

function subjectOf(req: { params: Record<string, string | undefined> }): string {
  return req.params.subjectId!;
}

/* ═══ References ═══════════════════════════════════════════════════════════ */

references.post(
  '/request',
  ...guard,
  requirePermission('reference:create'),
  validate({ body: requestReferenceSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as { subject: string; refereeName: string };
    const actor = req.actor!;
    // A person asking for their own reference chooses their own referee and
    // their own score. LRMC asks.
    if (body.subject === actor.userId) {
      throw ApiError.forbidden('A reference is requested by LRMC, not by its subject.');
    }
    const doc = await Reference.create({ ...body, requestedBy: actor.userId, status: 'requested' });
    return created(res, doc.toJSON());
  }),
);

references.post(
  '/respond',
  ...guard,
  requirePermission('reference:update'),
  validate({ body: respondToReferenceSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as { reference: string; score: number; comment?: string };
    const doc = await Reference.findOne({ _id: body.reference, deletedAt: null }).exec();
    if (!doc) throw ApiError.notFound('Reference');
    if (String(doc.subject) === req.actor!.userId) {
      throw ApiError.forbidden('Nobody scores their own reference.');
    }
    if (doc.status !== 'requested') {
      throw ApiError.badRequest('That reference has already been answered.');
    }
    doc.status = 'received';
    doc.score = body.score;
    doc.comment = body.comment;
    doc.respondedAt = new Date();
    await doc.save();
    return ok(res, doc.toJSON());
  }),
);

references.get(
  '/:subjectId',
  ...guard,
  validate({ params: namedIdParam('subjectId') }),
  asyncHandler(async (req, res) => {
    const subject = subjectOf(req);
    if (!mayRead(req.actor!, subject)) {
      throw ApiError.forbidden('That is not yours to read.');
    }
    const rows = await Reference.find({ subject, deletedAt: null })
      .select('status score relationship refereeName respondedAt createdAt')
      .lean()
      .exec();
    return ok(res, { subject, evidence: referencesEvidenceFrom(rows), references: rows });
  }),
);

/* ═══ Disputes ═════════════════════════════════════════════════════════════ */

disputes.post(
  '/open',
  ...guard,
  requirePermission('dispute:create'),
  validate({ body: openDisputeSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as { subject: string };
    if (body.subject === req.actor!.userId) {
      throw ApiError.badRequest('A dispute is raised against somebody, not against yourself.');
    }
    const doc = await Dispute.create({ ...body, raisedBy: req.actor!.userId, status: 'open' });
    return created(res, doc.toJSON());
  }),
);

disputes.post(
  '/:disputeId/resolve',
  ...guard,
  requirePermission('dispute:approve'),
  validate({ params: namedIdParam('disputeId'), body: resolveMemberDisputeSchema }),
  asyncHandler(async (req, res) => {
    const doc = await Dispute.findOne({ _id: req.params.disputeId, deletedAt: null }).exec();
    if (!doc) throw ApiError.notFound('Dispute');
    // An open dispute blocks a tenancy recommendation. Letting its subject
    // close it would let them clear their own block.
    if (String(doc.subject) === req.actor!.userId) {
      throw ApiError.forbidden('A dispute is not resolved by the person it is about.');
    }
    if (doc.status !== 'open') throw ApiError.badRequest('That dispute is already closed.');
    doc.status = 'resolved';
    doc.resolution = (req.body as { resolution: string }).resolution;
    doc.resolvedBy = req.actor!.userId as never;
    doc.resolvedAt = new Date();
    await doc.save();
    return ok(res, doc.toJSON());
  }),
);

disputes.get(
  '/:subjectId',
  ...guard,
  validate({ params: namedIdParam('subjectId') }),
  asyncHandler(async (req, res) => {
    const subject = subjectOf(req);
    if (!mayRead(req.actor!, subject)) throw ApiError.forbidden('That is not yours to read.');
    const rows = await Dispute.find({ subject, deletedAt: null })
      .select('kind severity status summary resolution resolvedAt createdAt')
      .lean()
      .exec();
    return ok(res, { subject, evidence: disputesEvidenceFrom(rows), disputes: rows });
  }),
);

/* ═══ Ususu ledger ═════════════════════════════════════════════════════════ */

async function appendEntry(
  req: { body: unknown; actor?: Actor },
  kind: 'contribution' | 'miss',
) {
  const body = req.body as { subject: string; period: string };
  const actor = req.actor!;
  if (body.subject === actor.userId && !isStaff(actor)) {
    throw ApiError.forbidden('Ususu entries are recorded by LRMC, not by the contributor.');
  }
  try {
    return await UsusuEntry.create({ ...body, kind, recordedBy: actor.userId });
  } catch (err) {
    // The unique index on (subject, period, kind) is what stops one month
    // being recorded twice and inflating a streak nobody earned.
    if ((err as { code?: number }).code === 11000) {
      throw ApiError.badRequest(`That ${kind} is already on the ledger for ${body.period}.`);
    }
    throw err;
  }
}

ususu.post(
  '/contribute',
  ...guard,
  requirePermission('ususuLedger:create'),
  validate({ body: ususuContributionSchema }),
  asyncHandler(async (req, res) => created(res, (await appendEntry(req, 'contribution')).toJSON())),
);

ususu.post(
  '/miss',
  ...guard,
  requirePermission('ususuLedger:create'),
  validate({ body: ususuMissSchema }),
  asyncHandler(async (req, res) => created(res, (await appendEntry(req, 'miss')).toJSON())),
);

ususu.get(
  '/:subjectId',
  ...guard,
  validate({ params: namedIdParam('subjectId') }),
  asyncHandler(async (req, res) => {
    const subject = subjectOf(req);
    if (!mayRead(req.actor!, subject)) throw ApiError.forbidden('That is not yours to read.');
    // Oldest first: `streakFrom` counts backwards from the most recent period.
    const rows = await UsusuEntry.find({ subject, deletedAt: null })
      .sort('period')
      .select('kind period amount currency createdAt')
      .lean()
      .exec();
    return ok(res, { subject, evidence: ususuEvidenceFrom(rows), entries: rows });
  }),
);

export const evidenceModule = {
  collectionPath: 'references',
  mounts: [
    { path: 'references', router: references },
    { path: 'disputes', router: disputes },
    { path: 'ususu', router: ususu },
  ],
};

export { Reference, Dispute, UsusuEntry } from './evidence.model.js';
