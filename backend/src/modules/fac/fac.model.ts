import { Schema, model, type Types } from 'mongoose';
import {
  baseSchemaOptions,
  lifecycleFields,
  type LifecycleShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';
import { ATTEMPT_RESULTS } from './attempts.js';
import { ROTATION_TRIGGERS } from './facRules.js';

export const FAC_CODE_STATUSES = ['active', 'expired', 'revoked', 'superseded'] as const;

/**
 * One generation of the Founder Authorisation Code.
 *
 * **The code itself is never stored.** `codeHash` is a bcrypt digest and is
 * `select: false` on top of that; the plaintext exists exactly twice — in the
 * response to the founder who issued it, and in whatever they write it down on.
 * There is no endpoint that returns it again, and no support procedure that
 * recovers it. Losing it means issuing a new generation, which is the correct
 * outcome.
 *
 * Generations are numbered rather than overwritten. The history of who issued
 * what and when is the point of having an audit trail at all, and a collection
 * with a single mutable row would destroy it.
 */
export interface IFacCode extends Omit<LifecycleShape, 'status'>, TimestampShape {
  _id: Types.ObjectId;
  /** Monotonic. Generation 1 is the first code ever issued. */
  generation: number;
  /** bcrypt digest. `select: false`; never leaves the server. */
  codeHash?: string;
  /** Last four... of nothing. A hint the founder chose, never part of the code. */
  label?: string;

  issuedBy: Types.ObjectId;
  issuedAt: Date;
  expiresAt: Date;
  rotationDays: number;
  trigger: (typeof ROTATION_TRIGGERS)[number];

  revokedAt?: Date;
  revokedBy?: Types.ObjectId;
  revocationReason?: string;
  supersededBy?: Types.ObjectId;

  /** Counters, for the HQ report. Never used to decide anything. */
  successfulVerifications: number;
  failedVerifications: number;

  status: (typeof FAC_CODE_STATUSES)[number];
}

const facCodeSchema = new Schema<IFacCode>(
  {
    generation: { type: Number, required: true, min: 1 },
    codeHash: { type: String, required: true, select: false },
    label: { type: String, trim: true, maxlength: 120 },

    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    issuedAt: { type: Date, required: true, index: true },
    expiresAt: { type: Date, required: true },
    rotationDays: { type: Number, required: true, min: 1 },
    trigger: { type: String, enum: ROTATION_TRIGGERS, default: 'scheduled' },

    revokedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revocationReason: { type: String, trim: true, maxlength: 1000 },
    supersededBy: { type: Schema.Types.ObjectId, ref: 'FacCode' },

    successfulVerifications: { type: Number, min: 0, default: 0 },
    failedVerifications: { type: Number, min: 0, default: 0 },

    status: { type: String, enum: FAC_CODE_STATUSES, default: 'active', index: true },
    ...lifecycleFields,
  },
  baseSchemaOptions('faccodes'),
);

facCodeSchema.index({ generation: 1 }, { unique: true });
facCodeSchema.index({ status: 1, expiresAt: -1 });

export const FacCode = model<IFacCode>('FacCode', facCodeSchema);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The attempt ledger.
 *
 * Append-only in spirit and in schema: no update or delete path exists, and the
 * router only ever inserts. Every attempt is recorded — including the ones
 * refused because a lockout was already in force, which are the ones that show
 * somebody kept trying.
 *
 * `codeGeneration` rather than a reference to the code: an attempt against a
 * since-revoked generation must remain legible after that document is archived.
 */
export interface IFacAttempt extends TimestampShape {
  _id: Types.ObjectId;
  actor: Types.ObjectId;
  actorLabel?: string;
  actorRole?: string;
  codeGeneration?: number;
  at: Date;
  result: (typeof ATTEMPT_RESULTS)[number];
  /** 1-based within the current failure streak. */
  attemptNumber: number;
  attemptsRemaining: number;
  /** Set on the failure that triggered a lockout. */
  lockedUntil?: Date;
  /**
   * On a `cleared` row: the founder who lifted the lockout, and why.
   *
   * Kept on the ledger rather than only in the audit log so that the record of
   * *who let someone back in* travels with the record of the failures it
   * cancels. Reading one without the other is how an override becomes
   * invisible.
   */
  clearedBy?: Types.ObjectId;
  clearedReason?: string;
  ipHash?: string;
  userAgent?: string;
}

const facAttemptSchema = new Schema<IFacAttempt>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorLabel: { type: String, trim: true, maxlength: 120 },
    actorRole: { type: String, trim: true },
    codeGeneration: { type: Number, min: 1 },
    at: { type: Date, required: true, index: true },
    result: { type: String, enum: ATTEMPT_RESULTS, required: true, index: true },
    attemptNumber: { type: Number, min: 1, required: true },
    attemptsRemaining: { type: Number, min: 0, required: true },
    lockedUntil: { type: Date, index: true },
    clearedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    clearedReason: { type: String, trim: true, maxlength: 500 },
    // Hashed, not stored raw: the ledger needs to correlate attempts from one
    // source without becoming a log of where founders were sitting.
    ipHash: { type: String, trim: true },
    userAgent: { type: String, trim: true, maxlength: 400 },
  },
  { ...baseSchemaOptions('facattempts'), timestamps: true },
);

facAttemptSchema.index({ actor: 1, at: -1 });

/** No path updates an attempt. Recorded once, read forever. */
facAttemptSchema.pre('findOneAndUpdate', function refuse(next) {
  next(new Error('The FAC attempt ledger is append-only'));
});
facAttemptSchema.pre('updateOne', function refuse(next) {
  next(new Error('The FAC attempt ledger is append-only'));
});

export const FacAttempt = model<IFacAttempt>('FacAttempt', facAttemptSchema);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A granted clearance.
 *
 * Stored rather than kept in the JWT deliberately. A clearance in a token
 * cannot be withdrawn — revoking a code, or a founder stepping away from a
 * console, has to take effect immediately, and that means the server has to be
 * able to delete it.
 */
export interface IFacClearance extends TimestampShape {
  _id: Types.ObjectId;
  actor: Types.ObjectId;
  codeGeneration: number;
  grantedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  lastUsedAt?: Date;
}

const facClearanceSchema = new Schema<IFacClearance>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    codeGeneration: { type: Number, required: true, min: 1 },
    grantedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    lastUsedAt: { type: Date },
  },
  { ...baseSchemaOptions('facclearances'), timestamps: true },
);

facClearanceSchema.index({ actor: 1, expiresAt: -1 });
// Mongo reclaims lapsed clearances an hour after they expire, so the collection
// cannot grow without bound and a stale row cannot be resurrected by a clock change.
facClearanceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export const FacClearance = model<IFacClearance>('FacClearance', facClearanceSchema);
