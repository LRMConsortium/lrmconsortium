import { Router, type RequestHandler } from 'express';
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
import { asyncHandler, created, noContent, ok, paginated } from '../../shared/http.js';
import { aliasIdParam, namedIdParam } from '../../shared/moduleFactory.js';
import { storageProvider } from '../../shared/providers/storage.js';
import { dispatchNotification } from '../notification/dispatch.js';
import { DocumentRecord, type IDocument } from './document.model.js';
import {
  DOCUMENT_TYPES,
  allowedFieldsFor,
  acceptsSubjectKind,
  deskFor,
  expiryDateFor,
  lockedFieldsIn,
  requiresReverification,
  reviewerRolesFor,
  validateDocumentFields,
  type DocumentType,
  type FieldBag,
} from './documentRules.js';
import {
  ACTION_FOR_STATUS,
  DOCUMENT_STATUSES,
  evaluateTransition,
  isReviewable,
  reverificationTarget,
  type DocumentStatus,
} from './documentLifecycle.js';
import { appendAudit, auditSummary, entryForTransition, type AuditEntry } from './audit.js';
import { complianceReport, type ComplianceContext } from './compliance.js';
import { expiryInfoFor } from './expiry.js';
import { MIN_SCORE_TO_VERIFY, scoreDocument, type SiblingDocument } from './scoring.js';
import { loadComplianceContext } from './context.service.js';
import {
  createDocumentSchema,
  documentAnalyticsQuery,
  documentQuery,
  expireDocumentSchema,
  rejectDocumentSchema,
  requestInfoSchema,
  reverifyDocumentSchema,
  reviewDocumentSchema,
  submitDocumentSchema,
  updateDocumentSchema,
  verifyDocumentSchema,
} from './document.validation.js';

export const documentService = new BaseService<IDocument>(DocumentRecord, {
  label: 'Document',
  searchableFields: ['reference', 'title'],
  filterableFields: ['type', 'status', 'desk', 'subjectKind', 'subject', 'owner'],
  ownerPath: 'owner',
  organizationPath: 'assignedTo',
  defaultSort: '-createdAt',
});

const controller = createCrudController(documentService);

const collectionRouter = Router();
const itemRouter = Router();
const memberRouter = Router();
const staffRouter = Router();
const hqRouter = Router();

const documentId = namedIdParam('documentId');
const aliasDocument = aliasIdParam('documentId');

const member = [authenticate, enterZone('MEMBER_PORTAL'), auditTrail('document')] as const;
const backOffice = [authenticate, enterZone('BACK_OFFICE'), auditTrail('document')] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** A Mongoose `Map` field comes back as a Map; the rules want a plain object. */
function fieldsOf(doc: IDocument): FieldBag {
  const raw = doc.fields as unknown;
  if (raw instanceof Map) return Object.fromEntries(raw) as FieldBag;
  return (raw ?? {}) as FieldBag;
}

function auditOf(doc: IDocument): AuditEntry[] {
  return (doc.audit ?? []).map((e) => ({
    sequence: e.sequence,
    at: e.at,
    actor: String(e.actor),
    actorRole: e.actorRole,
    action: e.action,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    reason: e.reason,
    fieldsChanged: e.fieldsChanged,
  }));
}

/** The holder's other documents, for the cross-document dimension. */
async function siblingsOf(doc: IDocument): Promise<SiblingDocument[]> {
  const rows = await DocumentRecord.find({
    owner: doc.owner,
    _id: { $ne: doc._id },
    deletedAt: null,
  })
    .select('type status fields')
    .limit(50)
    .lean()
    .exec();
  return rows.map((r) => ({
    type: r.type,
    status: r.status,
    fields: (r.fields ?? {}) as FieldBag,
  }));
}

async function rescore(doc: IDocument, asOf: Date): Promise<ReturnType<typeof scoreDocument>> {
  return scoreDocument({
    type: doc.type,
    fields: fieldsOf(doc),
    asOf,
    clarity: {
      fileSize: doc.fileSize,
      pageCount: doc.pageCount,
      ocrConfidence: doc.ocrConfidence,
      resolution: doc.resolution,
      mimeType: doc.mimeType,
    },
    siblings: await siblingsOf(doc),
  });
}

/** Does the caller hold a reviewing role for this document's desk? */
function actorIsReviewer(roles: readonly string[], type: DocumentType): boolean {
  if (roles.includes('founder')) return true;
  return reviewerRolesFor(type).some((r) => roles.includes(r));
}

/**
 * Every lifecycle transition, in one place.
 *
 * The three obligations — legality, reason, reviewer — are evaluated by
 * `evaluateTransition`, which also chooses the status code: 409 when the state
 * refused a well-formed request, 422 when the request itself was incomplete,
 * 403 when the caller was not entitled. The audit entry is appended here rather
 * than in each handler, because a transition that forgot to write one would be
 * a transition nobody can account for afterwards.
 */
function transition(
  to: DocumentStatus,
  options: {
    /** Extra gate evaluated before the move; return null to allow. */
    gate?: (doc: IDocument, req: Parameters<RequestHandler>[0]) => Promise<string | null>;
    mutate?: (doc: IDocument, body: Record<string, unknown>, now: Date) => Record<string, unknown>;
    reasonFrom?: (body: Record<string, unknown>) => string | undefined;
  } = {},
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const now = new Date();

    const doc = await DocumentRecord.findOne({
      _id: req.params.documentId,
      deletedAt: null,
    }).exec();
    if (!doc) throw ApiError.notFound('Document');

    const reason = options.reasonFrom?.(body) ?? (body.reason as string | undefined);
    const isHolder = String(doc.owner) === actor.userId;
    const from = doc.status;

    // A gate that fails is reported as a gate failure so the verdict carries the
    // right status code, rather than being thrown as a bare policy error.
    const gateDetail = options.gate ? await options.gate(doc, req) : null;

    const verdict = evaluateTransition(doc.status, to, {
      reason,
      actorIsHolder: to === 'submitted' ? false : isHolder,
      actorIsReviewer: actorIsReviewer(actor.roles, doc.type),
      gatesPassed: gateDetail === null,
    });

    if (!verdict.ok) {
      const message = verdict.failure === 'gateFailed' ? (gateDetail ?? verdict.message!) : verdict.message!;
      if (verdict.httpStatus === 409) throw ApiError.conflict(message);
      if (verdict.httpStatus === 403) throw ApiError.forbidden(message);
      throw ApiError.validation(message, reason ? undefined : [{ field: 'reason', message }]);
    }

    const patch = options.mutate?.(doc, body, now) ?? {};
    Object.assign(doc, patch);

    if (verdict.requirements.audit) {
      doc.audit = appendAudit(
        auditOf(doc),
        entryForTransition({
          from,
          to,
          actor: actor.userId,
          actorRole: actor.primaryRole,
          reason: reason ?? null,
          at: now,
        }),
      ) as never;
    }

    doc.status = to;
    doc.updatedBy = actor.userId as never;
    await doc.save();

    const fresh = doc.toObject() as unknown as IDocument;
    return ok(res, {
      document: fresh,
      transition: {
        from,
        to,
        action: ACTION_FOR_STATUS[to],
        at: now,
        actor: actor.userId,
        reason: reason ?? null,
        requirements: verdict.requirements,
      },
      audit: auditSummary(auditOf(fresh)),
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection
// ─────────────────────────────────────────────────────────────────────────────

collectionRouter.get(
  '/',
  ...backOffice,
  requirePermission('document:read'),
  validate({ query: documentQuery }),
  controller.list,
);

/**
 * Upload a piece of evidence.
 *
 * Fields are validated against the type's rules before anything is written —
 * a document that cannot pass its own schema should never reach a reviewer's
 * queue. The desk, the expiry date and the first score are all derived here, so
 * a document is never in the queue without knowing who reviews it or when it
 * lapses.
 */
collectionRouter.post(
  '/',
  ...member,
  requirePermission('document:create'),
  validate({ body: createDocumentSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as {
      type: DocumentType;
      subjectKind?: string;
      subject?: string;
      fields: FieldBag;
      [k: string]: unknown;
    };
    const now = new Date();

    const validation = validateDocumentFields(body.type, body.fields ?? {}, now);
    if (!validation.ok) {
      throw ApiError.validation('The document does not satisfy its type’s rules', [
        ...validation.missing.map((f) => ({ field: `fields.${f}`, message: 'is required for this type' })),
        ...validation.invalid.map((p) => ({ field: `fields.${p.field}`, message: p.message })),
        ...validation.unexpected.map((f) => ({
          field: `fields.${f}`,
          message: `not accepted on a ${body.type}; allowed: ${allowedFieldsFor(body.type).join(', ')}`,
        })),
      ]);
    }

    if (body.subjectKind && !acceptsSubjectKind(body.type, body.subjectKind)) {
      throw ApiError.policy(`A ${body.type} cannot be attached to a ${body.subjectKind}`);
    }

    const doc = await DocumentRecord.create({
      type: body.type,
      title: body.title,
      owner: actor.userId,
      subjectKind: body.subjectKind,
      subject: body.subject,
      fields: body.fields,
      mimeType: body.mimeType,
      fileSize: body.fileSize,
      pageCount: body.pageCount,
      ocrConfidence: body.ocrConfidence,
      resolution: body.resolution,
      storageKey: body.storageKey,
      version: 1,
      desk: deskFor(body.type),
      expiresOn: expiryDateFor(body.type, body.fields ?? {}, null),
      submittedAt: now,
      status: 'submitted',
      // The creation entry. `submitted` is the one transition that needs no
      // audit obligation, but the trail still starts with how the record began.
      audit: appendAudit([], {
        at: now,
        actor: actor.userId,
        actorRole: actor.primaryRole,
        action: 'create',
        fromStatus: null,
        toStatus: 'submitted',
        reason: null,
      }),
      createdBy: actor.userId,
    });

    const score = await rescore(doc.toObject() as unknown as IDocument, now);
    doc.score = { ...score, scoredAt: now } as never;
    await doc.save();

    return created(res, doc.toObject());
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Item
// ─────────────────────────────────────────────────────────────────────────────

itemRouter.get(
  '/:documentId',
  ...member,
  requirePermission('document:read', 'document:readOwn'),
  validate({ params: documentId }),
  aliasDocument,
  requireOwnership(documentService, 'documentId'),
  controller.get,
);

/**
 * Amend a document.
 *
 * A verified document freezes its identity: the type, the holder, the number,
 * the dates. Those are what somebody signed off on, and letting them change
 * afterwards would make "verified" mean only that *something* was verified once.
 * Annotations and a better scan stay editable.
 */
itemRouter.patch(
  '/:documentId',
  ...member,
  requirePermission('document:update', 'document:updateOwn'),
  validate({ params: documentId, body: updateDocumentSchema }),
  aliasDocument,
  requireOwnership(documentService, 'documentId'),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const patch = req.body as Record<string, unknown>;
    const now = new Date();

    const doc = await DocumentRecord.findOne({ _id: req.params.documentId, deletedAt: null }).exec();
    if (!doc) throw ApiError.notFound('Document');

    // Flatten the field bag so a patch touching one field is checked against
    // the same immutability list as a patch touching a top-level column.
    const proposed: Record<string, unknown> = { ...patch };
    if (patch.fields && typeof patch.fields === 'object') {
      for (const key of Object.keys(patch.fields as object)) proposed[key] = true;
      delete proposed.fields;
    }

    if (doc.status === 'verified') {
      const locked = lockedFieldsIn(proposed);
      if (locked.length > 0) {
        throw ApiError.conflict(
          `A verified document cannot change ${locked.join(', ')}. Re-verify it first.`,
        );
      }
    }

    const nextFields = patch.fields
      ? { ...fieldsOf(doc), ...(patch.fields as FieldBag) }
      : fieldsOf(doc);

    const validation = validateDocumentFields(doc.type, nextFields, now);
    if (!validation.ok && validation.invalid.length + validation.unexpected.length > 0) {
      throw ApiError.validation('The amendment does not satisfy the document’s type rules', [
        ...validation.invalid.map((p) => ({ field: `fields.${p.field}`, message: p.message })),
        ...validation.unexpected.map((f) => ({ field: `fields.${f}`, message: 'not accepted on this type' })),
      ]);
    }

    Object.assign(doc, patch, { fields: nextFields, updatedBy: actor.userId });
    doc.expiresOn = expiryDateFor(doc.type, nextFields, doc.verifiedAt ?? null) ?? undefined;
    doc.audit = appendAudit(auditOf(doc), {
      at: now,
      actor: actor.userId,
      actorRole: actor.primaryRole,
      action: 'amend',
      fromStatus: doc.status,
      toStatus: doc.status,
      reason: null,
      fieldsChanged: Object.keys(proposed),
    }) as never;

    const score = await rescore(doc.toObject() as unknown as IDocument, now);
    doc.score = { ...score, scoredAt: now } as never;
    await doc.save();

    return ok(res, doc.toObject());
  }),
);

/**
 * Archive a document.
 *
 * Soft delete, like everything else, and refused outright on a verified record:
 * evidence somebody relied on is not the holder's to remove. Withdrawing it is
 * an HQ act, through the audit trail, not a DELETE.
 */
itemRouter.delete(
  '/:documentId',
  ...member,
  requirePermission('document:delete'),
  validate({ params: documentId }),
  aliasDocument,
  requireOwnership(documentService, 'documentId'),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const doc = await DocumentRecord.findOne({ _id: req.params.documentId, deletedAt: null }).exec();
    if (!doc) throw ApiError.notFound('Document');
    if (doc.status === 'verified') {
      throw ApiError.conflict('A verified document cannot be archived; withdraw it through HQ instead');
    }

    doc.audit = appendAudit(auditOf(doc), {
      at: new Date(),
      actor: actor.userId,
      actorRole: actor.primaryRole,
      action: 'archive',
      fromStatus: doc.status,
      toStatus: doc.status,
      reason: 'archived by holder',
    }) as never;
    doc.deletedAt = new Date() as never;
    doc.updatedBy = actor.userId as never;
    await doc.save();

    return noContent(res);
  }),
);


// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * (Re)submit. The one transition a holder performs on their own document, and
 * the one that needs no reviewer — which is why `actorIsHolder` is forced false
 * for it in `transition()`.
 *
 * A re-submission after `needsMoreInfo` or `rejected` bumps the version, so the
 * storage key for the new scan is a new key and the reviewer can still see what
 * they originally turned down.
 */
itemRouter.post(
  '/:documentId/submit',
  ...member,
  requirePermission('document:create', 'document:updateOwn'),
  validate({ params: documentId, body: submitDocumentSchema }),
  aliasDocument,
  requireOwnership(documentService, 'documentId'),
  transition('submitted', {
    mutate: (doc, body, now) => {
      const revised = body.fields
        ? { ...fieldsOf(doc), ...(body.fields as FieldBag) }
        : fieldsOf(doc);
      const validation = validateDocumentFields(doc.type, revised, now);
      if (validation.missing.length > 0) {
        throw ApiError.validation('The document is still missing required fields', [
          ...validation.missing.map((f) => ({ field: `fields.${f}`, message: 'is required for this type' })),
        ]);
      }
      return {
        fields: revised,
        storageKey: (body.storageKey as string | undefined) ?? doc.storageKey,
        version: (doc.version ?? 1) + 1,
        submittedAt: now,
        expiresOn: expiryDateFor(doc.type, revised, doc.verifiedAt ?? null) ?? undefined,
        // A resubmission clears the previous refusal; leaving it would make the
        // record read as both rejected and pending at once.
        infoRequestReason: undefined,
        rejectionReason: undefined,
      };
    },
  }),
);

/** A reviewer picks it up. Claims it for a desk, so two people do not both start. */
itemRouter.post(
  '/:documentId/review',
  ...backOffice,
  requirePermission('document:review', 'document:update'),
  validate({ params: documentId, body: reviewDocumentSchema }),
  aliasDocument,
  transition('underReview', {
    mutate: (doc, body, now) => ({
      reviewStartedAt: now,
      assignedTo: (body.assignTo as string | undefined) ?? doc.assignedTo,
      assignedAt: now,
    }),
  }),
);

/** Ask the holder for what is missing. Refused without saying what. */
itemRouter.post(
  '/:documentId/request-info',
  ...backOffice,
  requirePermission('document:review', 'document:update'),
  validate({ params: documentId, body: requestInfoSchema }),
  aliasDocument,
  transition('needsMoreInfo', {
    mutate: (_doc, body, now) => ({
      infoRequestedAt: now,
      infoRequestReason: body.reason as string,
    }),
  }),
);

/**
 * Verify.
 *
 * The only gated transition, and it is gated twice. Compliance must be clear of
 * *blocking* failures — a reviewer may knowingly proceed past an advisory one
 * with `overrideAdvisory`, but a blocking failure is not theirs to waive, which
 * is the whole point of the severity split. Then the score must clear the floor:
 * below it, verification is refused however willing the reviewer, because a
 * document nobody can read is not evidence of anything.
 *
 * On success the evidence is frozen in object storage. A verified document whose
 * file could still be swapped would make the signature meaningless.
 */
itemRouter.post(
  '/:documentId/verify',
  ...backOffice,
  requirePermission('document:verify', 'document:review'),
  validate({ params: documentId, body: verifyDocumentSchema }),
  aliasDocument,
  transition('verified', {
    gate: async (doc, req) => {
      const now = new Date();
      const fields = fieldsOf(doc);

      const validation = validateDocumentFields(doc.type, fields, now);
      if (validation.missing.length > 0) {
        return `Cannot verify: missing ${validation.missing.join(', ')}`;
      }

      const ctx = await loadComplianceContext({
        type: doc.type,
        owner: String(doc.owner),
        subjectKind: doc.subjectKind,
        subject: doc.subject ? String(doc.subject) : undefined,
        fields,
      });
      const report = complianceReport(
        {
          type: doc.type,
          subjectKind: doc.subjectKind,
          subject: doc.subject ? String(doc.subject) : undefined,
          owner: String(doc.owner),
          fields,
        },
        ctx,
      );
      if (!report.clear) {
        return `Cannot verify: ${report.blocking.map((c) => c.detail).join('; ')}`;
      }
      const advisoryFailures = report.checks.filter(
        (c) => c.outcome === 'failed' && c.severity === 'advisory',
      );
      const override = Boolean((req.body as { overrideAdvisory?: boolean } | undefined)?.overrideAdvisory);
      if (advisoryFailures.length > 0 && !override) {
        return `Advisory checks failed: ${advisoryFailures
          .map((c) => c.detail)
          .join('; ')}. Re-send with overrideAdvisory to proceed.`;
      }

      const score = await rescore(doc, now);
      if (!score.meetsVerificationFloor) {
        return `Cannot verify: score ${score.overall} is below the floor of ${MIN_SCORE_TO_VERIFY} (weakest: ${score.weakest})`;
      }
      return null;
    },
    mutate: (doc, _body, now) => ({
      verifiedAt: now,
      verifiedBy: doc.assignedTo,
      complianceClear: true,
      complianceCheckedAt: now,
      expiresOn: expiryDateFor(doc.type, fieldsOf(doc), now) ?? undefined,
    }),
  }),
  // Freeze the evidence after the transition committed. Best-effort: the
  // verification is already recorded and a storage hiccup must not undo it.
  asyncHandler(async (req, _res, next) => {
    const doc = await DocumentRecord.findOne({ _id: req.params.documentId })
      .select('+storageKey')
      .lean()
      .exec();
    if (doc?.storageKey) {
      try {
        await storageProvider().markImmutable(doc.storageKey);
      } catch {
        // Deliberately swallowed — see above.
      }
    }
    return next();
  }),
);

/** Refuse it. Requires a reason and leaves an entry naming who decided. */
itemRouter.post(
  '/:documentId/reject',
  ...backOffice,
  requirePermission('document:review', 'document:update'),
  validate({ params: documentId, body: rejectDocumentSchema }),
  aliasDocument,
  transition('rejected', {
    mutate: (_doc, body, now) => ({
      rejectedAt: now,
      rejectionReason: body.reason as string,
    }),
  }),
);

/**
 * Lapse it.
 *
 * The clock's doing rather than a person's, so no reviewer is required — but it
 * is still audited, because "when did this stop counting" is a question people
 * ask. Refused while the document is still in date: expiring something early
 * would be a policy decision dressed up as bookkeeping.
 */
itemRouter.post(
  '/:documentId/expire',
  ...backOffice,
  requirePermission('document:update', 'document:review'),
  validate({ params: documentId, body: expireDocumentSchema }),
  aliasDocument,
  transition('expired', {
    gate: async (doc, req) => {
      const asOf = ((req.body as { asOf?: Date } | undefined)?.asOf) ?? new Date();
      const info = expiryInfoFor(doc.type, fieldsOf(doc), asOf, doc.verifiedAt ?? null);
      if (info.state === 'noExpiry') return 'This document type does not expire';
      if (!info.expired) return `Not yet lapsed — ${info.expiresOn?.toISOString().slice(0, 10)}`;
      return null;
    },
    mutate: (_doc, body, now) => ({
      expiredAt: ((body.asOf as Date | undefined) ?? now),
    }),
  }),
);

/**
 * Start re-verification on a lapsed or verified document.
 *
 * Where it lands depends on the type: one flagged `reverifyOnExpiry` re-enters
 * review, because a lapsed criminal record check is not renewed by re-uploading
 * the same PDF. Everything else goes back to the holder for a fresh copy first.
 */
itemRouter.post(
  '/:documentId/reverify',
  ...backOffice,
  requirePermission('document:verify', 'document:review'),
  validate({ params: documentId, body: reverifyDocumentSchema }),
  aliasDocument,
  asyncHandler(async (req, res, next) => {
    const doc = await DocumentRecord.findOne({ _id: req.params.documentId, deletedAt: null })
      .select('type')
      .lean()
      .exec();
    if (!doc) throw ApiError.notFound('Document');
    (req as unknown as { _reverifyTo: DocumentStatus })._reverifyTo = reverificationTarget(
      requiresReverification(doc.type),
    );
    return next();
  }),
  asyncHandler(async (req, res, next) => {
    const to = (req as unknown as { _reverifyTo: DocumentStatus })._reverifyTo;
    return transition(to, {
      mutate: (_doc, _body, now) => ({
        verifiedAt: undefined,
        verifiedBy: undefined,
        complianceClear: undefined,
        reviewStartedAt: to === 'underReview' ? now : undefined,
      }),
    })(req, res, next);
  }),
);

/**
 * The full picture: lifecycle, score, compliance and expiry in one read.
 *
 * Companion to the transition endpoints rather than an extra surface — a
 * reviewer deciding whether to verify needs all four, and four round trips to
 * assemble them is four chances to act on a stale one.
 */
itemRouter.get(
  '/:documentId/verification-summary',
  ...backOffice,
  requirePermission('document:read', 'document:readOwn'),
  validate({ params: documentId }),
  aliasDocument,
  requireOwnership(documentService, 'documentId'),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const doc = (await DocumentRecord.findOne({ _id: req.params.documentId, deletedAt: null })
      .lean()
      .exec()) as IDocument | null;
    if (!doc) throw ApiError.notFound('Document');

    const fields = fieldsOf(doc);
    const ctx = await loadComplianceContext({
      type: doc.type,
      owner: String(doc.owner),
      subjectKind: doc.subjectKind,
      subject: doc.subject ? String(doc.subject) : undefined,
      fields,
    });

    const compliance = complianceReport(
      {
        type: doc.type,
        subjectKind: doc.subjectKind,
        subject: doc.subject ? String(doc.subject) : undefined,
        owner: String(doc.owner),
        fields,
      },
      ctx,
    );
    const score = await rescore(doc, now);
    const expiry = expiryInfoFor(doc.type, fields, now, doc.verifiedAt ?? null);
    const trail = auditOf(doc);

    return ok(res, {
      documentId: String(doc._id),
      reference: doc.reference,
      type: doc.type,
      lifecycle: {
        status: doc.status,
        submittedAt: doc.submittedAt ?? null,
        reviewStartedAt: doc.reviewStartedAt ?? null,
        verifiedAt: doc.verifiedAt ?? null,
        rejectedAt: doc.rejectedAt ?? null,
        expiredAt: doc.expiredAt ?? null,
        reviewable: isReviewable(doc.status),
        desk: doc.desk,
      },
      score,
      compliance,
      expiry,
      audit: trail,
      auditSummary: auditSummary(trail),
      // `verifiable` is the AND of everything above — the single answer the
      // reviewer's button needs, with all four inputs shown beside it.
      verifiable:
        isReviewable(doc.status) && compliance.clear && score.meetsVerificationFloor && !expiry.expired,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Member, staff and HQ views
// ─────────────────────────────────────────────────────────────────────────────

/** The caller's own documents, with each one's clock attached. */
memberRouter.get(
  '/me/documents',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('document:readOwn', 'document:read'),
  validate({ query: documentQuery }),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const filters: Record<string, unknown> = { owner: req.actor!.userId };
    if (req.query.type) filters.type = req.query.type;
    if (req.query.status) filters.status = req.query.status;

    const { items, meta } = await documentService.list({
      filters,
      limit: Number(req.query.limit ?? 25),
      page: Number(req.query.page ?? 1),
    });

    const withExpiry = (items as unknown as IDocument[]).map((doc) => ({
      ...doc,
      expiry: expiryInfoFor(doc.type, fieldsOf(doc), now, doc.verifiedAt ?? null),
    }));
    return paginated(res, withExpiry, meta);
  }),
);

/**
 * A reviewer's queue.
 *
 * Narrowed to the desks the caller's role actually reviews — a coordinator
 * should not be looking at criminal record checks — and ordered oldest first,
 * because a verification queue sorted any other way starves its tail.
 */
staffRouter.get(
  '/me/document-queue',
  authenticate,
  enterZone('BACK_OFFICE'),
  requirePermission('document:review', 'document:read'),
  validate({ query: documentQuery }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const desks = DOCUMENT_TYPES.map(deskFor).filter((desk) => {
      if (actor.roles.includes('founder')) return true;
      if (desk === 'hqExecutive') return actor.roles.includes('hqExecutive');
      if (desk === 'coordinator') {
        return actor.roles.includes('coordinator') || actor.roles.includes('backOfficeStaff');
      }
      return actor.roles.includes('backOfficeStaff');
    });

    const filters: Record<string, unknown> = {
      status: { $in: ['submitted', 'underReview'] },
      desk: { $in: [...new Set(desks)] },
    };
    if (req.query.desk) filters.desk = req.query.desk;
    if (req.query.type) filters.type = req.query.type;

    const { items, meta } = await documentService.list({
      filters,
      sort: 'submittedAt',
      limit: Number(req.query.limit ?? 25),
      page: Number(req.query.page ?? 1),
    });
    return paginated(res, items, meta);
  }),
);

/** Every document on the platform. Zone B, read-only. */
hqRouter.get(
  '/documents',
  authenticate,
  enterZone('HQ_EXECUTIVE'),
  requirePermission('document:read'),
  validate({ query: documentQuery }),
  asyncHandler(async (req, res) => {
    const filters: Record<string, unknown> = {};
    if (req.query.type) filters.type = req.query.type;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.desk) filters.desk = req.query.desk;
    if (req.query.expiringWithinDays !== undefined) {
      const horizon = new Date(Date.now() + Number(req.query.expiringWithinDays) * 86_400_000);
      filters.expiresOn = { $ne: null, $lte: horizon };
    }

    const { items, meta } = await documentService.list({
      filters,
      limit: Number(req.query.limit ?? 25),
      page: Number(req.query.page ?? 1),
    });
    return paginated(res, items, meta);
  }),
);

/**
 * Verification throughput and backlog.
 *
 * The four numbers an HQ executive actually asks for: how much is waiting, how
 * long it has been waiting, how much is lapsing, and how often the answer is no.
 */
hqRouter.get(
  '/documents/analytics',
  authenticate,
  enterZone('HQ_EXECUTIVE'),
  requirePermission('document:read'),
  validate({ query: documentAnalyticsQuery }),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;

    const filter: Record<string, unknown> = { deletedAt: null };
    if (req.query.desk) filter.desk = req.query.desk;
    if (from || to) {
      filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    }

    const docs = (await DocumentRecord.find(filter)
      .select('type status desk submittedAt verifiedAt rejectedAt score expiresOn verifiedBy')
      .limit(5000)
      .lean()
      .exec()) as unknown as IDocument[];

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byDesk: Record<string, number> = {};
    let scoreTotal = 0;
    let scored = 0;
    let turnaroundTotal = 0;
    let turnaroundCount = 0;
    let expiringSoon = 0;
    let expired = 0;

    for (const doc of docs) {
      byStatus[doc.status] = (byStatus[doc.status] ?? 0) + 1;
      byType[doc.type] = (byType[doc.type] ?? 0) + 1;
      if (doc.desk) byDesk[doc.desk] = (byDesk[doc.desk] ?? 0) + 1;

      if (doc.score?.overall !== undefined) {
        scoreTotal += doc.score.overall;
        scored += 1;
      }
      const decided = doc.verifiedAt ?? doc.rejectedAt;
      if (decided && doc.submittedAt) {
        turnaroundTotal += (decided.getTime() - doc.submittedAt.getTime()) / 3_600_000;
        turnaroundCount += 1;
      }
      if (doc.expiresOn) {
        const days = Math.round((doc.expiresOn.getTime() - now.getTime()) / 86_400_000);
        if (days < 0) expired += 1;
        else if (days <= 90) expiringSoon += 1;
      }
    }

    const verified = byStatus.verified ?? 0;
    const rejected = byStatus.rejected ?? 0;
    const decidedTotal = verified + rejected;
    const pct = (n: number, d: number): number => (d <= 0 ? 0 : Math.round((n / d) * 1000) / 10);

    return ok(res, {
      window: { from: from ?? null, to: to ?? null },
      total: docs.length,
      byStatus,
      byType,
      byDesk,
      backlog: (byStatus.submitted ?? 0) + (byStatus.underReview ?? 0),
      awaitingHolder: (byStatus.needsMoreInfo ?? 0) + (byStatus.rejected ?? 0),
      verified,
      rejected,
      verificationRate: pct(verified, decidedTotal),
      rejectionRate: pct(rejected, decidedTotal),
      averageScore: scored === 0 ? 0 : Math.round((scoreTotal / scored) * 10) / 10,
      averageTurnaroundHours:
        turnaroundCount === 0 ? 0 : Math.round((turnaroundTotal / turnaroundCount) * 10) / 10,
      expiringSoon,
      expired,
      truncated: docs.length >= 5000,
    });
  }),
);

export const documentModule = {
  collectionPath: 'documents',
  itemPath: 'document',
  idParam: 'documentId',
  resource: 'document' as const,
  service: documentService,
  controller,
  mounts: [
    { path: 'documents', router: collectionRouter },
    { path: 'document', router: itemRouter },
    { path: 'member', router: memberRouter },
    { path: 'staff', router: staffRouter },
    { path: 'hq', router: hqRouter },
  ],
};

export { DocumentRecord, DOCUMENT_TYPES, DOCUMENT_STATUSES };
export type { IDocument };
export * from './document.validation.js';
