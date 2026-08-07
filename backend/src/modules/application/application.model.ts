/**
 * Tenancy applications.
 *
 * The scoring is `eligibility.ts`; the lifecycle is `applicationLifecycle.ts`;
 * this file stores what happened.
 *
 * The one thing worth reading before the schema is `assessment`. It is a
 * **snapshot, not a view**. When a coordinator approves an application, the
 * assessment recorded on it is the one they were looking at — not whatever the
 * scorer would return today against payment history that has since moved. Six
 * months later, "why was this approved" has an answer, and it is the answer
 * that was true at the time. Recomputing on read would quietly rewrite history
 * every time somebody paid their rent.
 *
 * `decision` likewise carries the person and the reason. `applicationLifecycle`
 * refuses a decision without both; this schema gives them somewhere to live.
 */

import { Schema, model, type Types } from 'mongoose';
import {
  CURRENCIES,
  baseSchemaOptions,
  type TimestampShape,
} from '../../shared/schemaFragments.js';
import { APPLICATION_STATUSES } from './applicationLifecycle.js';
import { ELIGIBILITY_FACTORS } from './eligibility.js';

/** One factor, as it stood when the assessment was taken. */
const factorSnapshot = new Schema(
  {
    factor: { type: String, enum: ELIGIBILITY_FACTORS, required: true },
    label: { type: String, required: true },
    status: { type: String, enum: ['pass', 'concern', 'fail', 'unknown'], required: true },
    points: { type: Number, required: true, min: 0 },
    max: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
  },
  { _id: false },
);

export interface IApplication extends TimestampShape {
  _id: Types.ObjectId;

  property: Types.ObjectId;
  /** The User applying. A TenantProfile may not exist until this succeeds. */
  applicant: Types.ObjectId;
  landlord?: Types.ObjectId;
  coordinator?: Types.ObjectId;

  status: (typeof APPLICATION_STATUSES)[number];

  /** What the applicant proposed. */
  proposedRent?: number;
  currency: (typeof CURRENCIES)[number];
  proposedStart?: Date;
  termMonths?: number;
  householdSize?: number;
  message?: string;

  /** Supporting documents, by storage key. Never a URL. */
  documentKeys: string[];

  /**
   * The assessment as it stood when it was last taken. A snapshot — see the
   * note at the top of this file.
   */
  assessment?: {
    factors: {
      factor: (typeof ELIGIBILITY_FACTORS)[number];
      label: string;
      status: 'pass' | 'concern' | 'fail' | 'unknown';
      points: number;
      max: number;
      reason: string;
    }[];
    score: number;
    recommendation: 'recommend' | 'review' | 'decline';
    blockedBy: string[];
    missing: string[];
    summary: string;
    takenAt: Date;
    takenBy?: Types.ObjectId;
  };

  /** Filled only on approval or rejection, and never by the system alone. */
  decision?: {
    outcome: 'approved' | 'rejected';
    decidedBy: Types.ObjectId;
    decidedAt: Date;
    reason: string;
    /** Did the person agree with the score, or go against it? */
    againstRecommendation: boolean;
  };

  /** The lease this application produced, once Back Office issued one. */
  lease?: Types.ObjectId;

  /** What LRMC asked the applicant for, while `awaitingApplicant`. */
  outstandingRequest?: string;

  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date | null;
}

const applicationSchema = new Schema<IApplication>(
  {
    property: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    applicant: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    landlord: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    coordinator: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    status: {
      type: String,
      enum: APPLICATION_STATUSES,
      default: 'submitted',
      required: true,
      index: true,
    },

    proposedRent: { type: Number, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GMD' },
    proposedStart: { type: Date },
    termMonths: { type: Number, min: 1, max: 120 },
    householdSize: { type: Number, min: 1, max: 30 },
    message: { type: String, trim: true, maxlength: 2000 },

    documentKeys: { type: [String], default: [] },

    assessment: {
      type: new Schema(
        {
          factors: { type: [factorSnapshot], default: [] },
          score: { type: Number, required: true, min: 0, max: 100 },
          recommendation: {
            type: String,
            enum: ['recommend', 'review', 'decline'],
            required: true,
          },
          blockedBy: { type: [String], default: [] },
          missing: { type: [String], default: [] },
          summary: { type: String, required: true },
          takenAt: { type: Date, required: true },
          takenBy: { type: Schema.Types.ObjectId, ref: 'User' },
        },
        { _id: false },
      ),
      required: false,
    },

    decision: {
      type: new Schema(
        {
          outcome: { type: String, enum: ['approved', 'rejected'], required: true },
          decidedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          decidedAt: { type: Date, required: true },
          reason: { type: String, required: true, trim: true, maxlength: 2000 },
          againstRecommendation: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      required: false,
    },

    lease: { type: Schema.Types.ObjectId, ref: 'Lease' },
    outstandingRequest: { type: String, trim: true, maxlength: 600 },

    /* The audit and soft-delete fields, taken individually. The generic
     * `lifecycleFields` block cannot be spread here: it carries its own
     * `status` with the platform-wide enum, and spreading it would replace
     * this collection's states with 'draft' | 'active' | … */
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, default: null, index: true },
  },
  { ...baseSchemaOptions('applications'), timestamps: true },
);

/* A landlord asks "who has applied for this property"; a coordinator asks
 * "what is on my desk". Both are hot paths on a queue screen. */
applicationSchema.index({ property: 1, status: 1, createdAt: -1 });
applicationSchema.index({ coordinator: 1, status: 1, createdAt: -1 });
/* One person should not have two live applications on the same property. */
applicationSchema.index({ applicant: 1, property: 1, status: 1 });

export const Application = model<IApplication>('Application', applicationSchema);
