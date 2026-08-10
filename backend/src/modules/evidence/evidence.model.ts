/**
 * The three collections behind the evidence LRMC gathers about an applicant.
 *
 * They live together because they are the same shape of thing — a small,
 * append-mostly record about one person that the scoring engine reads — and
 * because three modules of eighty lines each would be three sets of routes,
 * three blueprint blocks and three chances to get the scoping wrong.
 *
 * Every one of them is scoped to a subject: `subject` is the User the evidence
 * is *about*. Reading somebody else's disputes is not a thing a tenant may do,
 * and the routers narrow on this field rather than trusting a query parameter.
 */

import { Schema, model, type Types } from 'mongoose';
import { baseSchemaOptions, type TimestampShape } from '../../shared/schemaFragments.js';
import { MAX_DISPUTE_SEVERITY } from '../../config/evidence.js';

/* ── References ─────────────────────────────────────────────────────────── */

export const REFERENCE_STATUSES = ['requested', 'received', 'declined', 'expired'] as const;

export interface IReference extends TimestampShape {
  _id: Types.ObjectId;
  /** The person the reference is about. */
  subject: Types.ObjectId;
  /** Who LRMC asked. Not necessarily an LRMC account. */
  refereeName: string;
  refereeEmail?: string;
  refereePhone?: string;
  relationship?: string;
  status: (typeof REFERENCE_STATUSES)[number];
  /** 0–100, set only when a reply arrives. */
  score?: number;
  comment?: string;
  requestedBy: Types.ObjectId;
  respondedAt?: Date;
  deletedAt?: Date | null;
}

const referenceSchema = new Schema<IReference>(
  {
    subject: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refereeName: { type: String, required: true, trim: true, maxlength: 160 },
    refereeEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },
    refereePhone: { type: String, trim: true, maxlength: 30 },
    relationship: { type: String, trim: true, maxlength: 120 },
    status: { type: String, enum: REFERENCE_STATUSES, default: 'requested', required: true, index: true },
    score: { type: Number, min: 0, max: 100 },
    comment: { type: String, trim: true, maxlength: 2000 },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    respondedAt: { type: Date },
    deletedAt: { type: Date, default: null, index: true },
  },
  { ...baseSchemaOptions('references'), timestamps: true },
);
referenceSchema.index({ subject: 1, status: 1 });

export const Reference = model<IReference>('Reference', referenceSchema);

/* ── Disputes ───────────────────────────────────────────────────────────── */

export const DISPUTE_STATUSES = ['open', 'resolved', 'withdrawn'] as const;
export const DISPUTE_KINDS = ['rent', 'damage', 'conduct', 'marketplace', 'ride', 'other'] as const;

export interface IDispute extends TimestampShape {
  _id: Types.ObjectId;
  subject: Types.ObjectId;
  raisedBy: Types.ObjectId;
  kind: (typeof DISPUTE_KINDS)[number];
  /** 1 minor · 2 serious · 3 severe. Set when opened, never by the subject. */
  severity: number;
  summary: string;
  status: (typeof DISPUTE_STATUSES)[number];
  resolution?: string;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  deletedAt?: Date | null;
}

const disputeSchema = new Schema<IDispute>(
  {
    subject: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    raisedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: DISPUTE_KINDS, required: true },
    severity: { type: Number, required: true, min: 1, max: MAX_DISPUTE_SEVERITY },
    summary: { type: String, required: true, trim: true, maxlength: 2000 },
    status: { type: String, enum: DISPUTE_STATUSES, default: 'open', required: true, index: true },
    resolution: { type: String, trim: true, maxlength: 2000 },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    deletedAt: { type: Date, default: null, index: true },
  },
  { ...baseSchemaOptions('disputes'), timestamps: true },
);
disputeSchema.index({ subject: 1, status: 1, severity: -1 });

export const Dispute = model<IDispute>('Dispute', disputeSchema);

/* ── Ususu ledger ───────────────────────────────────────────────────────── */

export const USUSU_ENTRY_KINDS = ['contribution', 'miss'] as const;

/**
 * One line of the ledger, append-only.
 *
 * A running total on a member record would be a number somebody could correct
 * by hand; a ledger is a thing you can add up and disagree with. `streak` and
 * `groupHealth` are computed from these lines, never stored.
 */
export interface IUsusuEntry extends TimestampShape {
  _id: Types.ObjectId;
  subject: Types.ObjectId;
  kind: (typeof USUSU_ENTRY_KINDS)[number];
  amount?: number;
  currency?: string;
  /** The contribution period, so a duplicate for one month is detectable. */
  period: string;
  note?: string;
  recordedBy: Types.ObjectId;
  deletedAt?: Date | null;
}

const ususuEntrySchema = new Schema<IUsusuEntry>(
  {
    subject: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: USUSU_ENTRY_KINDS, required: true, index: true },
    amount: { type: Number, min: 0 },
    currency: { type: String, default: 'GMD' },
    period: { type: String, required: true, trim: true, maxlength: 20 },
    note: { type: String, trim: true, maxlength: 600 },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { ...baseSchemaOptions('ususuentries'), timestamps: true },
);
/* One line per person per period per kind: a double-recorded month would
 * inflate a streak nobody earned. */
ususuEntrySchema.index({ subject: 1, period: 1, kind: 1 }, { unique: true });
ususuEntrySchema.index({ subject: 1, createdAt: 1 });

export const UsusuEntry = model<IUsusuEntry>('UsusuEntry', ususuEntrySchema);
