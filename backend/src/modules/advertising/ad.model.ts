import { Schema, model, type Types } from 'mongoose';
import { AD_ZONES } from '../../config/hqZones.js';
import {
  CURRENCIES,
  baseSchemaOptions,
  lifecycleFields,
  type LifecycleShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';

export const AD_CATEGORIES = [
  'property',
  'construction',
  'homeServices',
  'finance',
  'insurance',
  'telecom',
  'retail',
  'travel',
  'automotive',
  'mobility',
  'hospitality',
  'health',
  'education',
  'agriculture',
  'publicNotice',
  'houseAd',
] as const;

export const AD_STATUSES = [
  'draft',
  'pendingReview',
  'approved',
  'active',
  'paused',
  'rejected',
  'expired',
  'exhausted',
  'archived',
] as const;

export const AD_PLACEMENTS = [
  'heroBanner',
  'sidebar',
  'inFeed',
  'footer',
  'interstitial',
  'ususuMapCard',
  'memberDashboardTile',
] as const;

/**
 * The creative and its serving rules.
 *
 * `rotationWeight` is the advertiser's *requested* share; what actually serves
 * is that weight adjusted by daypart, pacing and Founder policy in
 * `adEngine.service.ts`. Keeping the raw request separate from the effective
 * weight means a policy change never rewrites advertiser data.
 */
export interface IAd extends Omit<LifecycleShape, 'status'>, TimestampShape {
  _id: Types.ObjectId;
  advertiser: Types.ObjectId;
  advertiserName: string;
  title: string;
  adImage: string;
  adImageAltText?: string;
  adLink: string;
  adCategory: (typeof AD_CATEGORIES)[number];
  placements: (typeof AD_PLACEMENTS)[number][];
  targetZones: string[];
  targetRegions: string[];
  targetRoles: string[];
  startDate: Date;
  endDate: Date;
  /** Hours of the day (0–23) this ad may serve. Empty = all hours. */
  dayParts: number[];
  /** Days of week (0=Sun) this ad may serve. Empty = all days. */
  daysOfWeek: number[];
  rotationWeight: number;
  priorityTier: number;
  impressionCap?: number;
  clickCap?: number;
  dailyImpressionCap?: number;
  budgetAmount?: number;
  budgetCurrency: string;
  spend: number;
  impressions: number;
  clicks: number;
  status: (typeof AD_STATUSES)[number];
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
}

const adSchema = new Schema<IAd>(
  {
    advertiser: {
      type: Schema.Types.ObjectId,
      ref: 'AdvertiserProfile',
      required: true,
      index: true,
    },
    advertiserName: { type: String, required: true, trim: true },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    adImage: { type: String, required: true, trim: true },
    adImageAltText: { type: String, trim: true, maxlength: 300 },
    adLink: { type: String, required: true, trim: true },
    adCategory: { type: String, enum: AD_CATEGORIES, required: true, index: true },

    placements: { type: [String], enum: AD_PLACEMENTS, default: ['sidebar'] },
    targetZones: { type: [String], enum: AD_ZONES, default: ['PUBLIC_PORTAL'], index: true },
    targetRegions: { type: [String], default: [] },
    targetRoles: { type: [String], default: [] },

    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },
    dayParts: {
      type: [Number],
      default: [],
      validate: {
        validator: (v: number[]) => v.every((h) => Number.isInteger(h) && h >= 0 && h <= 23),
        message: 'dayParts must be integers 0–23',
      },
    },
    daysOfWeek: {
      type: [Number],
      default: [],
      validate: {
        validator: (v: number[]) => v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: 'daysOfWeek must be integers 0–6',
      },
    },

    rotationWeight: { type: Number, min: 0, max: 1000, default: 10 },
    /** Higher tiers are drawn from first; ties fall through to weighting. */
    priorityTier: { type: Number, min: 0, max: 10, default: 1 },

    impressionCap: { type: Number, min: 1 },
    clickCap: { type: Number, min: 1 },
    dailyImpressionCap: { type: Number, min: 1 },
    budgetAmount: { type: Number, min: 0 },
    budgetCurrency: { type: String, enum: CURRENCIES, default: 'GHS' },
    spend: { type: Number, min: 0, default: 0 },

    impressions: { type: Number, min: 0, default: 0 },
    clicks: { type: Number, min: 0, default: 0 },

    status: { type: String, enum: AD_STATUSES, default: 'draft', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, trim: true },

    ...lifecycleFields,
  },
  baseSchemaOptions('ads'),
);

// The exact shape the rotation query filters on.
adSchema.index({ status: 1, targetZones: 1, startDate: 1, endDate: 1 });
adSchema.index({ adCategory: 1, status: 1 });
adSchema.index({ advertiser: 1, status: 1 });
adSchema.index({ priorityTier: -1, rotationWeight: -1 });

adSchema.pre('validate', function checkWindow(next) {
  if (this.startDate && this.endDate && this.endDate <= this.startDate) {
    return next(new Error('endDate must be after startDate'));
  }
  next();
});

adSchema.virtual('ctr').get(function ctr() {
  return this.impressions > 0 ? Math.round((this.clicks / this.impressions) * 10_000) / 100 : 0;
});

adSchema.virtual('isLive').get(function isLive() {
  const now = Date.now();
  return (
    this.status === 'active' &&
    this.startDate.getTime() <= now &&
    this.endDate.getTime() >= now &&
    (this.impressionCap === undefined || this.impressions < this.impressionCap) &&
    (this.clickCap === undefined || this.clicks < this.clickCap)
  );
});

export const Ad = model<IAd>('Ad', adSchema);
