import { Schema, model, type Types } from 'mongoose';
import { AD_ZONES } from '../../config/hqZones.js';

/**
 * Raw impression / click stream. High write volume, so it is deliberately thin
 * and never updated — reporting rolls it up with an aggregation.
 *
 * `dedupeKey` + a TTL index is how a refresh-spamming visitor stops inflating
 * an advertiser's impression count.
 */
export interface IAdEvent {
  _id: Types.ObjectId;
  ad: Types.ObjectId;
  advertiser: Types.ObjectId;
  type: 'impression' | 'click';
  zone: string;
  placement?: string;
  category: string;
  sessionId?: string;
  user?: Types.ObjectId;
  role?: string;
  region?: string;
  dedupeKey?: string;
  ip?: string;
  userAgent?: string;
  occurredAt: Date;
  /** Set on impressions once the client confirms the creative rendered. */
  viewable?: boolean;
  createdAt: Date;
}

const adEventSchema = new Schema<IAdEvent>(
  {
    ad: { type: Schema.Types.ObjectId, ref: 'Ad', required: true, index: true },
    advertiser: {
      type: Schema.Types.ObjectId,
      ref: 'AdvertiserProfile',
      required: true,
      index: true,
    },
    type: { type: String, enum: ['impression', 'click'], required: true, index: true },
    zone: { type: String, enum: AD_ZONES, required: true, index: true },
    placement: { type: String },
    category: { type: String, required: true },
    sessionId: { type: String, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    role: { type: String },
    region: { type: String },
    dedupeKey: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    occurredAt: { type: Date, required: true, default: () => new Date(), index: true },
    viewable: { type: Boolean },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'ad_events', versionKey: false },
);

adEventSchema.index({ ad: 1, type: 1, occurredAt: -1 });
adEventSchema.index({ advertiser: 1, occurredAt: -1 });
adEventSchema.index({ zone: 1, type: 1, occurredAt: -1 });

/**
 * Dedupe window. `expireAfterSeconds: 0` on a separate `dedupeExpiresAt` field
 * would be cleaner, but a partial unique index on `dedupeKey` gives us the
 * atomic "first write wins" behaviour the engine relies on.
 */
adEventSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);

export const AdEvent = model<IAdEvent>('AdEvent', adEventSchema);
