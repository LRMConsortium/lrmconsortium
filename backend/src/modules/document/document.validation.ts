import { z } from 'zod';
import { zObjectId, zText } from '../../shared/validationFragments.js';
import { DOCUMENT_FIELDS, DOCUMENT_TYPES } from './documentRules.js';
import { DOCUMENT_STATUSES } from './documentLifecycle.js';
import { ACCEPTED_MIME_TYPES, MAX_OBJECT_BYTES } from '../../shared/providers/storage.js';

/**
 * The field bag.
 *
 * Keys are constrained to the vocabulary here; whether *this type* accepts a
 * given key is `documentRules.validateDocumentFields`' business. Two layers,
 * because the vocabulary is a schema concern and the per-type requirement is a
 * domain one — and the domain layer has to be callable without Zod anyway, so
 * that verify can assert it.
 */
const fieldKey = z.enum(DOCUMENT_FIELDS);
const fieldValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.coerce.date()]);

const fieldsSchema = z.record(fieldKey, fieldValue).refine(
  (v) => Object.keys(v).length <= 24,
  { message: 'a document carries at most 24 fields' },
);

const documentBase = z.object({
  type: z.enum(DOCUMENT_TYPES),
  title: zText(240).optional(),
  subjectKind: z.string().trim().max(60).optional(),
  subject: zObjectId.optional(),
  fields: fieldsSchema,

  // File metadata. The bytes themselves go to the storage provider directly;
  // the API only ever handles the key and the measurements.
  mimeType: z.enum(ACCEPTED_MIME_TYPES).optional(),
  fileSize: z.number().int().min(1).max(MAX_OBJECT_BYTES).optional(),
  pageCount: z.number().int().min(1).max(500).optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  resolution: z.number().int().min(1).max(20000).optional(),
  storageKey: z.string().trim().min(4).max(255).optional(),
});

export const createDocumentSchema = documentBase.strict();

/**
 * Updates cannot change the type.
 *
 * Retyping a document would silently change which fields are required, which
 * compliance rule applies and how long it lives — the audit trail would show a
 * verified `identity` that had been verified as a `roadworthiness`. A different
 * type is a different document.
 */
export const updateDocumentSchema = documentBase
  .omit({ type: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'an update must change something' });

// ── Lifecycle bodies ────────────────────────────────────────────────────────

/** Submit and re-submit carry an optional note; the fields may also be revised. */
export const submitDocumentSchema = z
  .object({
    fields: fieldsSchema.optional(),
    storageKey: z.string().trim().min(4).max(255).optional(),
    note: zText(2000).optional(),
  })
  .strict();

export const reviewDocumentSchema = z
  .object({
    note: zText(2000).optional(),
    assignTo: zObjectId.optional(),
  })
  .strict();

/** A request for more information is unusable without saying what is missing. */
export const requestInfoSchema = z
  .object({
    reason: z.string().trim().min(5).max(2000),
    missingFields: z.array(fieldKey).max(24).optional(),
  })
  .strict();

export const verifyDocumentSchema = z
  .object({
    note: zText(2000).optional(),
    /**
     * Lets a reviewer proceed past a failed *advisory* compliance check they
     * have looked at. It can never override a blocking one — that refusal is
     * the point of the severity split.
     */
    overrideAdvisory: z.boolean().optional(),
  })
  .strict();

export const rejectDocumentSchema = z
  .object({
    reason: z.string().trim().min(5).max(2000),
  })
  .strict();

export const expireDocumentSchema = z
  .object({
    reason: zText(2000).optional(),
    asOf: z.coerce.date().optional(),
  })
  .strict();

export const reverifyDocumentSchema = z
  .object({
    reason: zText(2000).optional(),
  })
  .strict();

// ── Queries ─────────────────────────────────────────────────────────────────

export const documentQuery = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sort: z.string().trim().max(60).optional(),
    search: z.string().trim().max(120).optional(),
    type: z.enum(DOCUMENT_TYPES).optional(),
    status: z.enum(DOCUMENT_STATUSES).optional(),
    desk: z.enum(['backOffice', 'coordinator', 'hqExecutive']).optional(),
    expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
  })
  .strict();

export const documentAnalyticsQuery = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    desk: z.enum(['backOffice', 'coordinator', 'hqExecutive']).optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    message: 'to must be on or after from',
    path: ['to'],
  });
