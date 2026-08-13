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

import { Router, type Request, type Response } from 'express';
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
  createUsusuGroupSchema,
  groupMemberSchema,
  groupContributionSchema,
  groupMissSchema,
} from './evidence.validation.js';
import {
  mayCreateGroup, mayReadGroup, isGroupStaff,
  addMemberProblems, removeMemberProblems, contributionProblems, summariseGroup,
} from './groupRules.js';
import { UsusuGroup } from './evidence.model.js';
import { LAUNCH_CURRENCY } from '../../config/currencies.js';

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

/* ═══════════════════════════════════════════════════════════════════════════
 * Ususu groups — the register
 *
 * A rotating savings circle: a handful of people put in the same amount each
 * period and one of them takes the pot. LRMC records them because keeping up
 * with one for two years demonstrates something a bank statement cannot.
 *
 * Every rule is in `groupRules.ts`, which has no Mongoose and is asserted
 * without a database. This section resolves ids and writes rows.
 *
 * ── Mounted BEFORE `/ususu/:subjectId` ────────────────────────────────────
 * Order matters here and the failure is silent. `/ususu/group/xyz` matches
 * `/ususu/:subjectId` with `subjectId = "group"` — Express takes the first
 * route that matches, so registering these second would send every group
 * request to the per-person reader, which would refuse it as a malformed id.
 * The blueprint's shadowing check catches the same class of mistake in the
 * contract; this comment is why the code is in this order.
 * ══════════════════════════════════════════════════════════════════════════ */

const groups = Router();

/** The group, or a 404. Loaded once so every rule reads the same row. */
async function loadGroup(id: unknown) {
  const group = await UsusuGroup.findOne({ _id: id as never, deletedAt: null }).exec();
  if (!group) throw ApiError.notFound('Ususu group');
  return group;
}

/** The shape the rules module expects: ids as strings, members as a list. */
function registerOf(group: { createdBy: unknown; members: unknown[]; status: string }) {
  return {
    status: group.status,
    createdBy: String(group.createdBy),
    members: (group.members ?? []).map((m) => String(m)),
  };
}

/** An actor as the rules module reads it. */
function groupActor(req: { actor?: { userId: string; roles: unknown } }) {
  return { userId: req.actor!.userId, roles: req.actor!.roles as string[] };
}

groups.post(
  '/create',
  ...guard,
  requirePermission('ususuLedger:create'),
  validate({ body: createUsusuGroupSchema }),
  asyncHandler(async (req, res) => {
    const actor = groupActor(req);
    if (!mayCreateGroup(actor)) {
      throw ApiError.forbidden('Only a coordinator or LRMC may open a savings circle.');
    }
    const body = req.body as {
      name: string; members?: string[]; contributionAmount?: number;
      currency?: string; region?: string; note?: string;
    };

    /* The steward is in their own circle from the first second. A register
     * whose keeper is not on it is one where "who is in this" and "who is
     * answerable for this" are different lists that drift. */
    const members = Array.from(new Set([...(body.members ?? []), actor.userId]));

    const group = await UsusuGroup.create({
      name: body.name,
      createdBy: actor.userId,
      members,
      /* Always `forming`. A circle that could be created already `active` would
       * skip the moment its members are gathered — and `active` is a claim that
       * people have agreed to put money in. */
      status: 'forming',
      contributionAmount: body.contributionAmount,
      currency: body.currency ?? LAUNCH_CURRENCY,
      region: body.region,
      note: body.note,
    });
    return created(res, group.toJSON());
  }),
);

groups.post(
  '/add-member',
  ...guard,
  requirePermission('ususuLedger:create'),
  validate({ body: groupMemberSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as { group: string; member: string };
    const group = await loadGroup(body.group);
    const problems = addMemberProblems(groupActor(req), registerOf(group as never), body.member);
    if (problems.length) throw ApiError.validation('Request validation failed', problems);

    group.members.push(body.member as never);
    await group.save();
    return ok(res, group.toJSON());
  }),
);

groups.post(
  '/remove-member',
  ...guard,
  requirePermission('ususuLedger:create'),
  validate({ body: groupMemberSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as { group: string; member: string };
    const group = await loadGroup(body.group);
    const problems = removeMemberProblems(groupActor(req), registerOf(group as never), body.member);
    if (problems.length) throw ApiError.validation('Request validation failed', problems);

    /* The register changes; the ledger does not. Somebody who paid into a
     * circle for a year and then left has a year of evidence, and tidying up
     * after them would erase it. The ledger is append-only and nothing here
     * touches it. */
    group.members = group.members.filter((m) => String(m) !== body.member) as never;
    await group.save();
    return ok(res, group.toJSON());
  }),
);

/** Contributing and missing differ only in what is written down. */
function recordAgainstGroup(kind: 'contribution' | 'miss') {
  return asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as {
      group: string; member: string; period: string;
      amount?: number; currency?: string; note?: string;
    };
    const group = await loadGroup(body.group);
    const problems = contributionProblems(
      groupActor(req), registerOf(group as never), body, kind,
    );
    if (problems.length) throw ApiError.validation('Request validation failed', problems);

    /* Recording the first contribution is what makes a circle active. Derived
     * from the act rather than asked for separately, because a coordinator who
     * has to remember to flip a status is a coordinator who will not. */
    if (group.status === 'forming') {
      group.status = 'active';
      await group.save();
    }

    try {
      const entry = await UsusuEntry.create({
        subject: body.member,
        group: group._id,
        kind,
        amount: kind === 'contribution' ? body.amount : undefined,
        currency: body.currency ?? group.currency ?? LAUNCH_CURRENCY,
        period: body.period,
        note: body.note,
        recordedBy: req.actor!.userId,
      });
      return created(res, entry.toJSON());
    } catch (err) {
      /* The unique index on (subject, group, period, kind). Surfaced rather
       * than swallowed: two taps on a bad connection and a genuine correction
       * look identical from here, and silently accepting either would inflate
       * a streak nobody earned. */
      if ((err as { code?: number }).code === 11000) {
        throw ApiError.conflict(
          `${body.period} is already recorded for that member in this circle.`,
        );
      }
      throw err;
    }
  });
}

groups.post('/contribute', ...guard, requirePermission('ususuLedger:create'),
  validate({ body: groupContributionSchema }), recordAgainstGroup('contribution'));

groups.post('/miss', ...guard, requirePermission('ususuLedger:create'),
  validate({ body: groupMissSchema }), recordAgainstGroup('miss'));

/**
 * One person's circles.
 *
 * Before `/:groupId`, because `/ususu/group/user/abc` would otherwise match
 * `/ususu/group/:groupId` with `groupId = "user"`.
 */
groups.get(
  '/user/:userId',
  ...guard,
  validate({ params: namedIdParam('userId') }),
  asyncHandler(async (req, res) => {
    const actor = groupActor(req);
    const subject = String(req.params.userId);

    /* A person reads their own circles. Staff read anyone's. A COORDINATOR
     * READS NOBODY ELSE'S — a savings circle is a private arrangement between
     * named people, and a coordinator who stewards one in Serrekunda has no
     * business reading the register of one in Basse. They see the circles they
     * steward, which is what the query below returns. */
    if (actor.userId !== subject && !isGroupStaff(actor)) {
      throw ApiError.forbidden('That is not yours to read.');
    }

    const rows = await UsusuGroup.find({
      deletedAt: null,
      $or: [{ members: subject }, { createdBy: subject }],
    }).sort('-createdAt').lean().exec();
    return ok(res, rows);
  }),
);

groups.get(
  '/:groupId',
  ...guard,
  validate({ params: namedIdParam('groupId') }),
  asyncHandler(async (req, res) => {
    const group = await loadGroup(req.params.groupId);
    if (!mayReadGroup(groupActor(req), registerOf(group as never))) {
      throw ApiError.forbidden('That circle is not yours to read.');
    }
    return ok(res, group.toJSON());
  }),
);

groups.get(
  '/:groupId/summary',
  ...guard,
  validate({ params: namedIdParam('groupId') }),
  asyncHandler(async (req, res) => {
    const group = await loadGroup(req.params.groupId);
    const register = registerOf(group as never);
    if (!mayReadGroup(groupActor(req), register)) {
      throw ApiError.forbidden('That circle is not yours to read.');
    }

    /* The whole ledger for this circle, not a page. A group health computed
     * over twenty rows reads as a group health over a history — the exact bug
     * the aggregate endpoints exist to remove. Four fields and `.lean()`, so a
     * three-year circle stays cheap. */
    const rows = await UsusuEntry.find({ group: group._id, deletedAt: null })
      .select('subject kind period amount currency')
      .lean()
      .exec();

    const ledger = rows.map((r) => ({
      member: String((r as { subject: unknown }).subject),
      kind: (r as { kind: 'contribution' | 'miss' }).kind,
      period: (r as { period: string }).period,
      amount: (r as { amount?: number }).amount,
      currency: (r as { currency?: string }).currency,
    }));

    return ok(res, {
      group: group.toJSON(),
      ...summariseGroup(ledger, register.members, LAUNCH_CURRENCY),
      /* Oldest first, so a page can render the history in the order it
       * happened without sorting it again and getting it wrong. */
      entries: ledger.sort((a, b) => a.period.localeCompare(b.period)),
    });
  }),
);

export const evidenceModule = {
  collectionPath: 'references',
  mounts: [
    { path: 'references', router: references },
    { path: 'disputes', router: disputes },
    /* The group router first: `/ususu/group/x` matches `/ususu/:subjectId`
     * with `subjectId = "group"`, and Express takes the first match. */
    { path: 'ususu/group', router: groups },
    { path: 'ususu', router: ususu },
  ],
};

export { Reference, Dispute, UsusuEntry } from './evidence.model.js';
