import { Schema, model, type Types } from 'mongoose';
import {
  CURRENCIES,
  baseSchemaOptions,
  contactFields,
  lifecycleFields,
  locationFields,
  verificationFields,
  type ContactShape,
  type LifecycleShape,
  type LocationShape,
  type TimestampShape,
  type VerificationShape,
} from '../../shared/schemaFragments.js';

export const BUSINESS_TYPES = [
  'realEstate',
  'construction',
  'financialServices',
  'telecom',
  'retail',
  'hospitality',
  'transport',
  'automotive',
  'healthcare',
  'education',
  'agriculture',
  'government',
  'ngo',
  'other',
] as const;

/**
 * The advertiser account. Separate from the creative: one advertiser runs many
 * ads, and billing, credit and policy standing attach to the account, not the
 * image.
 */
export interface IAdvertiserProfile
  extends ContactShape,
    LocationShape,
    VerificationShape,
    LifecycleShape,
    TimestampShape {
  _id: Types.ObjectId;
  advertiserName: string;
  contactPerson?: string;
  businessType: (typeof BUSINESS_TYPES)[number];
  website?: string;
  logo?: string;
  billingCurrency: string;
  creditLimit: number;
  outstandingBalance: number;
  totalSpend: number;
  agreedCPM?: number;
  agreedCPC?: number;
  policyStandings: { strikes: number; lastStrikeAt?: Date; notes?: string };
}

const advertiserProfileSchema = new Schema<IAdvertiserProfile>(
  {
    advertiserName: { type: String, required: true, trim: true, maxlength: 200, index: true },
    contactPerson: { type: String, trim: true, maxlength: 160 },
    ...contactFields,
    ...locationFields,
    ...verificationFields,

    businessType: { type: String, enum: BUSINESS_TYPES, required: true, index: true },
    website: { type: String, trim: true },
    logo: { type: String, trim: true },

    billingCurrency: { type: String, enum: CURRENCIES, default: 'GHS' },
    creditLimit: { type: Number, min: 0, default: 0 },
    outstandingBalance: { type: Number, default: 0 },
    totalSpend: { type: Number, min: 0, default: 0 },

    // Founder-set commercial terms (Zone A owns pricing).
    agreedCPM: { type: Number, min: 0 },
    agreedCPC: { type: Number, min: 0 },

    policyStandings: {
      strikes: { type: Number, min: 0, default: 0 },
      lastStrikeAt: { type: Date },
      notes: { type: String, trim: true, select: false },
    },

    ...lifecycleFields,
  },
  baseSchemaOptions('advertiser_profiles'),
);

advertiserProfileSchema.index({ email: 1 }, { unique: true });
advertiserProfileSchema.index({ businessType: 1, verificationStatus: 1 });

/** Three strikes and the account cannot serve, whatever its ads say. */
advertiserProfileSchema.virtual('inGoodStanding').get(function inGoodStanding() {
  return (
    this.status === 'active' &&
    this.verificationStatus === 'verified' &&
    (this.policyStandings?.strikes ?? 0) < 3 &&
    (this.creditLimit === 0 || this.outstandingBalance <= this.creditLimit)
  );
});

export const AdvertiserProfile = model<IAdvertiserProfile>(
  'AdvertiserProfile',
  advertiserProfileSchema,
);
