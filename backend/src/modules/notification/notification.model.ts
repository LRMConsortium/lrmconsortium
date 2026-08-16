import { Schema, model, type Types } from 'mongoose';
import {
  baseSchemaOptions,
  lifecycleFields,
  type LifecycleShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';

export const NOTIFICATION_CHANNELS = ['inApp', 'push', 'whatsapp', 'sms', 'email'] as const;

export const NOTIFICATION_CATEGORIES = [
  'verification',
  'documentExpiry',
  'rentDue',
  'rentReceipt',
  'maintenance',
  'rideOffer',
  'rideUpdate',
  'payout',
  'adReview',
  'adBudget',
  // Marketplace: order placed, accepted, delivered, settled, disputed.
  'order',
  'policy',
  'system',
] as const;

export const PUSH_PLATFORMS = ['ios', 'android', 'web', 'expo'] as const;

/** A device registration. One row per device, deduped on the token itself. */
export interface IPushToken extends Omit<LifecycleShape, 'status'>, TimestampShape {
  _id: Types.ObjectId;
  token: string;
  platform: (typeof PUSH_PLATFORMS)[number];
  deviceId?: string;
  appVersion?: string;
  locale?: string;
  lastSeenAt?: Date;
  status: 'active' | 'stale' | 'revoked';
}

const pushTokenSchema = new Schema<IPushToken>(
  {
    /** `select: false` — a push token is a capability to reach someone's phone. */
    token: { type: String, required: true, trim: true, select: false },
    platform: { type: String, enum: PUSH_PLATFORMS, required: true },
    deviceId: { type: String, trim: true },
    appVersion: { type: String, trim: true },
    locale: { type: String, trim: true, default: 'en-GH' },
    lastSeenAt: { type: Date, default: () => new Date() },
    status: { type: String, enum: ['active', 'stale', 'revoked'], default: 'active', index: true },
    ...lifecycleFields,
  },
  baseSchemaOptions('push_tokens'),
);

pushTokenSchema.index({ token: 1 }, { unique: true });
pushTokenSchema.index({ user: 1, status: 1 });

export const PushToken = model<IPushToken>('PushToken', pushTokenSchema);

/**
 * An in-app notification.
 *
 * `channel` records how it was *delivered*, not just that it exists — in this
 * market WhatsApp reaches people that push does not, and the profile schemas
 * already default `preferredContactMethod` to WhatsApp for exactly that reason.
 */
export interface INotification extends Omit<LifecycleShape, 'status'>, TimestampShape {
  _id: Types.ObjectId;
  recipient: Types.ObjectId;
  category: (typeof NOTIFICATION_CATEGORIES)[number];
  channel: (typeof NOTIFICATION_CHANNELS)[number];
  title: string;
  body: string;
  /** Deep link, e.g. `ususu://driver/verification`. */
  deepLink?: string;
  /** What this notification is about, for click-through. */
  subjectKind?: string;
  subject?: Types.ObjectId;
  readAt?: Date;
  deliveredAt?: Date;
  failureReason?: string;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
}

const notificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true, index: true },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, default: 'inApp' },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    deepLink: { type: String, trim: true },
    subjectKind: { type: String },
    subject: { type: Schema.Types.ObjectId },
    readAt: { type: Date },
    deliveredAt: { type: Date },
    failureReason: { type: String, trim: true },
    status: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'read', 'failed'],
      default: 'queued',
      index: true,
    },
    ...lifecycleFields,
  },
  baseSchemaOptions('notifications'),
);

notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });

notificationSchema.virtual('isRead').get(function isRead() {
  return this.readAt !== undefined && this.readAt !== null;
});

export const Notification = model<INotification>('Notification', notificationSchema);
