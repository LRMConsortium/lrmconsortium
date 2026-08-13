import { Schema, model } from 'mongoose';
import { baseSchemaOptions } from '../../shared/schemaFragments.js';
import { REVOCATION_REASONS, type RevocationReason } from './revocation.js';

/**
 * Refresh tokens that must stop working.
 *
 * The rules are in `revocation.ts`, which is Mongoose-free and asserted without
 * a database. This is only the store.
 *
 * ── The collection stays small ────────────────────────────────────────────
 * Every row carries `expiresAt`, set to the revoked token's own expiry, and a
 * TTL index deletes it then. A revocation that outlives its token protects
 * nothing, and a denylist that only grows becomes the reason signing in is slow
 * two years from now. The steady-state size is "sign-outs in the last thirty
 * days", which is bounded by real human behaviour rather than by time.
 *
 * ── It is deliberately not soft-deleted ───────────────────────────────────
 * Everything else on the platform carries `lifecycleFields` and is archived
 * rather than removed, because the record of a thing having existed is part of
 * what LRMC owes people. This is the exception: the row is not a record of
 * anything a person did, it is a switch that must be off, and a soft-deleted
 * revocation is a revocation that has quietly stopped applying. The audit trail
 * of who signed out when lives in the audit log, where it belongs.
 */

export interface RevokedTokenDoc {
  /** The refresh token's `jti`. One row per token, not per user. */
  jti: string;
  /** Whose token it was, so an administrator can see whose session ended. */
  userId: string;
  reason: RevocationReason;
  /** Who ended it. Equal to `userId` for an ordinary sign-out. */
  revokedBy: string;
  /** The token's own expiry. The TTL index reads this. */
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const revokedTokenSchema = new Schema<RevokedTokenDoc>(
  {
    /* Unique, so revoking the same token twice is not an error and not a
     * duplicate row — signing out from two tabs is ordinary. */
    jti: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    reason: { type: String, enum: REVOCATION_REASONS, required: true },
    revokedBy: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  baseSchemaOptions('revokedTokens'),
);

/* Mongo deletes the row once the token it denies has expired. `expireAfterSeconds:
 * 0` means "at the time in this field", not "immediately". */
revokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RevokedToken = model<RevokedTokenDoc>('RevokedToken', revokedTokenSchema);
