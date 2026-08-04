import { Schema, model, type Types } from 'mongoose';
import {
  baseSchemaOptions,
  lifecycleFields,
  type LifecycleShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';
import { DOCUMENT_FIELDS, DOCUMENT_TYPES, type DocumentType } from './documentRules.js';
import { DOCUMENT_STATUSES } from './documentLifecycle.js';
import { AUDIT_ACTIONS } from './audit.js';

export { DOCUMENT_TYPES, DOCUMENT_STATUSES };

/**
 * One piece of evidence, and everything that has happened to it.
 *
 * Three design choices worth stating.
 *
 * **`fields` is a map, not columns.** Sixteen document types want overlapping
 * but different fields; sixteen sparse column sets would be unreadable, and a
 * seventeenth type would be a migration. The *rules* for what each type needs
 * live in `documentRules.ts`, which is where they can be asserted.
 *
 * **`audit` is embedded and append-only.** The trail is worthless if it can
 * outlive the record separately or be edited in isolation, so it travels with
 * the document and the schema refuses in-place edits.
 *
 * **The file is a storage key, never a URL.** A permanent link to a passport
 * scan in a database row is a breach waiting for a backup to leak.
 */

export interface IDocumentAuditEntry {
  sequence: number;
  at: Date;
  actor: Types.ObjectId | string;
  actorRole?: string;
  action: (typeof AUDIT_ACTIONS)[number];
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
  fieldsChanged?: string[];
}

export interface IDocumentScore {
  completeness: number;
  clarity: number;
  consistency: number;
  crossDocument: number;
  overall: number;
  band: string;
  weakest: string;
  scoredAt?: Date;
}

export interface IDocument extends Omit<LifecycleShape, 'status'>, TimestampShape {
  _id: Types.ObjectId;
  reference: string;
  type: DocumentType;
  title?: string;

  /** The account the evidence belongs to. Drives every `own` scope. */
  owner: Types.ObjectId;
  /** What it is evidence *about* — polymorphic across the platform. */
  subjectKind?: string;
  subject?: Types.ObjectId;

  fields: Record<string, unknown>;

  /** Object-storage key. `select: false` — minted into a signed URL on read. */
  storageKey?: string;
  mimeType?: string;
  fileSize?: number;
  pageCount?: number;
  ocrConfidence?: number;
  resolution?: number;
  version: number;

  desk: string;
  assignedTo?: Types.ObjectId;
  assignedAt?: Date;

  submittedAt?: Date;
  reviewStartedAt?: Date;
  verifiedAt?: Date;
  verifiedBy?: Types.ObjectId;
  rejectedAt?: Date;
  rejectionReason?: string;
  infoRequestedAt?: Date;
  infoRequestReason?: string;
  expiresOn?: Date;
  expiredAt?: Date;
  lastNoticeDay?: number;

  score?: IDocumentScore;
  complianceClear?: boolean;
  complianceCheckedAt?: Date;

  audit: IDocumentAuditEntry[];
  status: (typeof DOCUMENT_STATUSES)[number];
}

const auditEntrySchema = new Schema<IDocumentAuditEntry>(
  {
    sequence: { type: Number, required: true, min: 1 },
    at: { type: Date, required: true },
    actor: { type: Schema.Types.Mixed, required: true },
    actorRole: { type: String, trim: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    reason: { type: String, trim: true, maxlength: 2000, default: null },
    fieldsChanged: { type: [String], default: undefined },
  },
  { _id: false },
);

const scoreSchema = new Schema<IDocumentScore>(
  {
    completeness: { type: Number, min: 0, max: 100 },
    clarity: { type: Number, min: 0, max: 100 },
    consistency: { type: Number, min: 0, max: 100 },
    crossDocument: { type: Number, min: 0, max: 100 },
    overall: { type: Number, min: 0, max: 100 },
    band: { type: String },
    weakest: { type: String },
    scoredAt: { type: Date },
  },
  { _id: false },
);

const documentSchema = new Schema<IDocument>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },
    type: { type: String, enum: DOCUMENT_TYPES, required: true, index: true },
    title: { type: String, trim: true, maxlength: 240 },

    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subjectKind: { type: String, trim: true, index: true },
    subject: { type: Schema.Types.ObjectId, index: true },

    fields: {
      type: Map,
      of: Schema.Types.Mixed,
      default: () => new Map(),
      validate: {
        validator(value: Map<string, unknown>): boolean {
          // Belt-and-braces against the validation layer being bypassed by a
          // seed or a migration: only the known field vocabulary may be stored.
          return [...value.keys()].every((k) => (DOCUMENT_FIELDS as readonly string[]).includes(k));
        },
        message: 'fields contains a key outside the document field vocabulary',
      },
    },

    // The key, never a URL, and never returned by a plain read.
    storageKey: { type: String, trim: true, select: false },
    mimeType: { type: String, trim: true },
    fileSize: { type: Number, min: 0 },
    pageCount: { type: Number, min: 0 },
    ocrConfidence: { type: Number, min: 0, max: 1 },
    resolution: { type: Number, min: 0 },
    version: { type: Number, min: 1, default: 1 },

    desk: { type: String, trim: true, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    assignedAt: { type: Date },

    submittedAt: { type: Date, index: true },
    reviewStartedAt: { type: Date },
    verifiedAt: { type: Date, index: true },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, trim: true, maxlength: 2000 },
    infoRequestedAt: { type: Date },
    infoRequestReason: { type: String, trim: true, maxlength: 2000 },
    expiresOn: { type: Date, index: true },
    expiredAt: { type: Date },
    lastNoticeDay: { type: Number },

    score: { type: scoreSchema, default: undefined },
    complianceClear: { type: Boolean },
    complianceCheckedAt: { type: Date },

    audit: { type: [auditEntrySchema], default: [] },
    status: { type: String, enum: DOCUMENT_STATUSES, default: 'submitted', index: true },
    ...lifecycleFields,
  },
  baseSchemaOptions('documents'),
);

documentSchema.index({ reference: 1 }, { unique: true });
documentSchema.index({ owner: 1, type: 1, status: 1 });
documentSchema.index({ desk: 1, status: 1, submittedAt: 1 });
documentSchema.index({ status: 1, expiresOn: 1 });

documentSchema.pre('validate', function derive(next) {
  if (!this.reference) {
    const suffix = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
    this.reference = `DOC-${suffix}`;
  }
  if (!this.submittedAt) this.submittedAt = new Date();
  next();
});

/**
 * The append-only guarantee, enforced at the schema level.
 *
 * Mongoose will happily persist a spliced array. This refuses any save where an
 * existing audit entry's sequence has moved or an entry has vanished — the
 * only legal change to `audit` is a longer array with the same prefix.
 */
documentSchema.pre('save', function guardAudit(next) {
  const path = this.$__getValue?.('audit') as IDocumentAuditEntry[] | undefined;
  const entries = path ?? this.audit ?? [];
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i]!.sequence !== i + 1) {
      next(new Error('Document audit trail is append-only; an entry was removed or reordered'));
      return;
    }
  }
  next();
});

/** Days until the document lapses, or null. Cheap enough for a list badge. */
documentSchema.virtual('daysUntilExpiry').get(function daysUntilExpiry(this: IDocument) {
  if (!this.expiresOn) return null;
  return Math.round((this.expiresOn.getTime() - Date.now()) / 86_400_000);
});

documentSchema.virtual('isExpired').get(function isExpired(this: IDocument) {
  return Boolean(this.expiresOn && this.expiresOn.getTime() < Date.now());
});

documentSchema.virtual('auditCount').get(function auditCount(this: IDocument) {
  return this.audit?.length ?? 0;
});

export const DocumentRecord = model<IDocument>('Document', documentSchema);
