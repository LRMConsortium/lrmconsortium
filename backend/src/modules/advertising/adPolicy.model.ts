import { Schema, model, type Types } from 'mongoose';
import { AD_ZONES } from '../../config/hqZones.js';
import { CURRENCIES, baseSchemaOptions } from '../../shared/schemaFragments.js';
import { AD_CATEGORIES } from './ad.model.js';

/**
 * Founder-controlled ad policy — Zone A only.
 *
 * There is exactly one active policy document at a time (`isActive`), and the
 * rotation engine reads it on every serve. Pricing, banned categories, per-zone
 * slot counts and daypart multipliers all live here so a policy change is a
 * document write, not a deploy.
 */
export interface IAdPolicy {
  _id: Types.ObjectId;
  version: number;
  isActive: boolean;
  effectiveFrom: Date;
  currency: string;

  /** Rate card, by placement. */
  pricing: { placement: string; cpm?: number; cpc?: number; flatMonthly?: number }[];
  /** Category multipliers applied to the requested rotation weight. */
  categoryWeightMultipliers: { category: string; multiplier: number }[];
  /** Hour-of-day multipliers, 0–23. Absent hours default to 1. */
  dayPartMultipliers: { hour: number; multiplier: number }[];
  /** Ads served per request, per zone. */
  zoneSlotCounts: { zone: string; slots: number }[];
  /** Categories that may never serve, whatever an advertiser pays. */
  bannedCategories: string[];
  /** Zones where only house ads may serve. */
  houseAdOnlyZones: string[];
  /** Max share of a single zone's impressions any one advertiser may take. */
  maxAdvertiserSharePercent: number;
  /** Even out delivery across the flight rather than front-loading. */
  pacingEnabled: boolean;
  /** Ads must be approved by HQ Executive or Founder before serving. */
  requireReviewBeforeServing: boolean;
  minRotationWeight: number;
  maxRotationWeight: number;
  notes?: string;
  authoredBy?: Types.ObjectId;
  ratifiedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const adPolicySchema = new Schema<IAdPolicy>(
  {
    version: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: false, index: true },
    effectiveFrom: { type: Date, required: true, default: () => new Date() },
    currency: { type: String, enum: CURRENCIES, default: 'GHS' },

    pricing: {
      type: [
        new Schema(
          {
            placement: { type: String, required: true },
            cpm: { type: Number, min: 0 },
            cpc: { type: Number, min: 0 },
            flatMonthly: { type: Number, min: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    categoryWeightMultipliers: {
      type: [
        new Schema(
          {
            category: { type: String, enum: AD_CATEGORIES, required: true },
            multiplier: { type: Number, min: 0, max: 10, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    dayPartMultipliers: {
      type: [
        new Schema(
          {
            hour: { type: Number, min: 0, max: 23, required: true },
            multiplier: { type: Number, min: 0, max: 10, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    zoneSlotCounts: {
      type: [
        new Schema(
          {
            zone: { type: String, enum: AD_ZONES, required: true },
            slots: { type: Number, min: 0, max: 20, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    bannedCategories: { type: [String], default: [] },
    houseAdOnlyZones: { type: [String], enum: AD_ZONES, default: [] },
    maxAdvertiserSharePercent: { type: Number, min: 1, max: 100, default: 40 },
    pacingEnabled: { type: Boolean, default: true },
    requireReviewBeforeServing: { type: Boolean, default: true },
    minRotationWeight: { type: Number, min: 0, default: 1 },
    maxRotationWeight: { type: Number, min: 1, default: 100 },

    notes: { type: String, trim: true, maxlength: 4000 },
    authoredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ratifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  baseSchemaOptions('ad_policies'),
);

adPolicySchema.index({ version: 1 }, { unique: true });
adPolicySchema.index({ isActive: 1, effectiveFrom: -1 });

export const AdPolicy = model<IAdPolicy>('AdPolicy', adPolicySchema);

/** Fallback used before the Founder has ratified a policy. */
export const DEFAULT_AD_POLICY: Omit<
  IAdPolicy,
  '_id' | 'createdAt' | 'updatedAt' | 'version' | 'isActive' | 'effectiveFrom'
> = {
  currency: 'GHS',
  pricing: [
    { placement: 'heroBanner', cpm: 45 },
    { placement: 'sidebar', cpm: 18 },
    { placement: 'inFeed', cpm: 25 },
    { placement: 'footer', cpm: 8 },
    { placement: 'interstitial', cpm: 60 },
    { placement: 'ususuMapCard', cpm: 30 },
    { placement: 'memberDashboardTile', cpm: 22 },
  ],
  categoryWeightMultipliers: [{ category: 'houseAd', multiplier: 0.5 }],
  dayPartMultipliers: [],
  zoneSlotCounts: [
    { zone: 'PUBLIC_PORTAL', slots: 3 },
    { zone: 'MEMBER_PORTAL', slots: 2 },
    { zone: 'USUSU_PORTAL', slots: 1 },
  ],
  bannedCategories: [],
  houseAdOnlyZones: [],
  maxAdvertiserSharePercent: 40,
  pacingEnabled: true,
  requireReviewBeforeServing: true,
  minRotationWeight: 1,
  maxRotationWeight: 100,
};
