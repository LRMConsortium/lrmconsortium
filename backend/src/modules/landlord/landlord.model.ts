import { Schema, model, type Types } from 'mongoose';
import {
  DIASPORA_STATUSES,
  PAYMENT_METHODS,
  baseSchemaOptions,
  contactFields,
  emergencyContactFields,
  identityFields,
  lifecycleFields,
  locationFields,
  verificationFields,
  type ContactShape,
  type EmergencyContactShape,
  type IdentityShape,
  type LifecycleShape,
  type LocationShape,
  type TimestampShape,
  type VerificationShape,
} from '../../shared/schemaFragments.js';

/**
 * Landlord Profile — LRMC residential owner.
 *
 * `diasporaStatus` is load-bearing, not decorative: a diaspora landlord is the
 * core LRMC customer, and payout currency, reporting cadence and coordinator
 * escalation all branch on it.
 */
export interface ILandlordProfile
  extends ContactShape,
    IdentityShape,
    LocationShape,
    EmergencyContactShape,
    VerificationShape,
    LifecycleShape,
    TimestampShape {
  _id: Types.ObjectId;
  fullName: string;
  propertiesOwned: Types.ObjectId[];
  diasporaStatus: (typeof DIASPORA_STATUSES)[number];
  payoutMethod?: string;
  payoutAccountRef?: string;
  payoutCurrency: string;
  managementFeePercent: number;
  statementFrequency: 'monthly' | 'quarterly' | 'annually';
}

const landlordProfileSchema = new Schema<ILandlordProfile>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...identityFields,
    ...locationFields,
    ...emergencyContactFields,
    ...verificationFields,

    propertiesOwned: [{ type: Schema.Types.ObjectId, ref: 'Property' }],
    diasporaStatus: { type: String, enum: DIASPORA_STATUSES, default: 'resident', index: true },

    payoutMethod: { type: String, enum: PAYMENT_METHODS, default: 'bankTransfer' },
    payoutAccountRef: { type: String, trim: true, select: false },
    payoutCurrency: { type: String, default: 'GHS' },
    managementFeePercent: { type: Number, min: 0, max: 100, default: 10 },
    statementFrequency: {
      type: String,
      enum: ['monthly', 'quarterly', 'annually'],
      default: 'monthly',
    },

    ...lifecycleFields,
  },
  baseSchemaOptions('landlord_profiles'),
);

landlordProfileSchema.index({ email: 1 }, { unique: true });
landlordProfileSchema.index({ diasporaStatus: 1, verificationStatus: 1 });
landlordProfileSchema.index({ fullName: 'text', email: 'text' });

landlordProfileSchema.virtual('propertyCount').get(function propertyCount() {
  return this.propertiesOwned?.length ?? 0;
});

export const LandlordProfile = model<ILandlordProfile>('LandlordProfile', landlordProfileSchema);
