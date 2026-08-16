import { Schema, model, type Types } from 'mongoose';
import {
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

/** Tenant Profile — LRMC residential occupant. */
export interface ITenantProfile
  extends ContactShape,
    IdentityShape,
    LocationShape,
    EmergencyContactShape,
    VerificationShape,
    LifecycleShape,
    TimestampShape {
  _id: Types.ObjectId;
  fullName: string;
  occupation?: string;
  employerName?: string;
  employerContact?: string;
  monthlyIncome?: number;
  property?: Types.ObjectId;
  unitLabel?: string;
  leaseStart?: Date;
  leaseEnd?: Date;
  monthlyRent: number;
  rentCurrency: string;
  securityDeposit?: number;
  paymentMethod?: string;
  rentDueDay: number;
  complianceScore: number;
  onTimePaymentRate: number;
  engagementScore: number;
}

const tenantProfileSchema = new Schema<ITenantProfile>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...identityFields,
    ...locationFields,
    ...emergencyContactFields,
    ...verificationFields,

    occupation: { type: String, trim: true, maxlength: 160 },
    employerName: { type: String, trim: true, maxlength: 200 },
    employerContact: { type: String, trim: true },
    monthlyIncome: { type: Number, min: 0, select: false },

    property: { type: Schema.Types.ObjectId, ref: 'Property', index: true },
    unitLabel: { type: String, trim: true },
    leaseStart: { type: Date },
    leaseEnd: { type: Date, index: true },
    monthlyRent: { type: Number, min: 0, default: 0 },
    rentCurrency: { type: String, default: 'GMD' },
    securityDeposit: { type: Number, min: 0 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'mobileMoney' },
    rentDueDay: { type: Number, min: 1, max: 31, default: 1 },

    // Member Portal performance tracking (Zone D)
    complianceScore: { type: Number, min: 0, max: 100, default: 100 },
    onTimePaymentRate: { type: Number, min: 0, max: 100, default: 100 },
    engagementScore: { type: Number, min: 0, max: 100, default: 0 },

    ...lifecycleFields,
  },
  baseSchemaOptions('tenant_profiles'),
);

tenantProfileSchema.index({ email: 1 }, { unique: true });
tenantProfileSchema.index({ property: 1, status: 1 });
tenantProfileSchema.index({ leaseEnd: 1, status: 1 });

tenantProfileSchema.pre('validate', function checkLeaseWindow(next) {
  if (this.leaseStart && this.leaseEnd && this.leaseEnd <= this.leaseStart) {
    return next(new Error('leaseEnd must be after leaseStart'));
  }
  next();
});

tenantProfileSchema.virtual('leaseDaysRemaining').get(function leaseDaysRemaining() {
  if (!this.leaseEnd) return null;
  return Math.ceil((this.leaseEnd.getTime() - Date.now()) / 86_400_000);
});

export const TenantProfile = model<ITenantProfile>('TenantProfile', tenantProfileSchema);
