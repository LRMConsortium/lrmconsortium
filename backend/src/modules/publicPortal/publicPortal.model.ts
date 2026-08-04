import { Schema, model, type Types } from 'mongoose';
import {
  baseSchemaOptions,
  lifecycleFields,
  type LifecycleShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';

export const CONTENT_TYPES = [
  'page',
  'article',
  'announcement',
  'faq',
  'testimonial',
  'servicePage',
  'pressRelease',
] as const;

/** Public Portal content — Zone E. Only `published` items ever leave the API. */
export interface IPublicContent extends Omit<LifecycleShape, 'status'>, TimestampShape {
  _id: Types.ObjectId;
  slug: string;
  contentType: (typeof CONTENT_TYPES)[number];
  title: string;
  excerpt?: string;
  body?: string;
  heroImage?: string;
  /** Which of the consortium's domains this content belongs to. */
  domains: string[];
  locale: string;
  tags: string[];
  publishedAt?: Date;
  isPublished: boolean;
  views: number;
  author?: Types.ObjectId;
  seoTitle?: string;
  seoDescription?: string;
  status: string;
}

const publicContentSchema = new Schema<IPublicContent>(
  {
    slug: { type: String, required: true, trim: true, lowercase: true },
    contentType: { type: String, enum: CONTENT_TYPES, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 240 },
    excerpt: { type: String, trim: true, maxlength: 600 },
    body: { type: String },
    heroImage: { type: String, trim: true },
    domains: { type: [String], default: ['lrmconsortium.com'], index: true },
    locale: { type: String, default: 'en' },
    tags: { type: [String], default: [] },
    publishedAt: { type: Date },
    isPublished: { type: Boolean, default: false, index: true },
    views: { type: Number, min: 0, default: 0 },
    author: { type: Schema.Types.ObjectId, ref: 'User' },
    seoTitle: { type: String, trim: true, maxlength: 200 },
    seoDescription: { type: String, trim: true, maxlength: 400 },
    ...lifecycleFields,
  },
  baseSchemaOptions('public_content'),
);

publicContentSchema.index({ slug: 1, locale: 1 }, { unique: true });
publicContentSchema.index({ isPublished: 1, contentType: 1, publishedAt: -1 });

// ── Traffic ─────────────────────────────────────────────────────────────────

export const CONVERSION_GOALS = [
  'contactForm',
  'tenantApplication',
  'landlordEnquiry',
  'driverApplication',
  'vendorApplication',
  'advertiserEnquiry',
  'quoteRequest',
  'newsletterSignup',
  'accountCreated',
] as const;

/**
 * Traffic and conversion events for the Public Portal. Kept in its own thin
 * collection so marketing analytics never touches member data.
 */
export interface ITrafficEvent {
  _id: Types.ObjectId;
  domain: string;
  path: string;
  referrer?: string;
  sessionId?: string;
  country?: string;
  device?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  isConversion: boolean;
  conversionGoal?: string;
  occurredAt: Date;
  createdAt: Date;
}

const trafficEventSchema = new Schema<ITrafficEvent>(
  {
    domain: { type: String, required: true, index: true },
    path: { type: String, required: true },
    referrer: { type: String },
    sessionId: { type: String, index: true },
    country: { type: String },
    device: {
      type: String,
      enum: ['mobile', 'tablet', 'desktop', 'unknown'],
      default: 'unknown',
    },
    isConversion: { type: Boolean, default: false, index: true },
    conversionGoal: { type: String, enum: CONVERSION_GOALS },
    occurredAt: { type: Date, required: true, default: () => new Date(), index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'traffic_events',
    versionKey: false,
  },
);

trafficEventSchema.index({ domain: 1, occurredAt: -1 });
trafficEventSchema.index({ isConversion: 1, conversionGoal: 1, occurredAt: -1 });

export const PublicContent = model<IPublicContent>('PublicContent', publicContentSchema);
export const TrafficEvent = model<ITrafficEvent>('TrafficEvent', trafficEventSchema);
