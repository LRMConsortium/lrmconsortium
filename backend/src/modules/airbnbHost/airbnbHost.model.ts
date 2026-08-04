import { Schema, model, type Types } from 'mongoose';
import {
  baseSchemaOptions,
  contactFields,
  emergencyContactFields,
  identityFields,
  lifecycleFields,
  locationFields,
  ratingFields,
  verificationFields,
  type ContactShape,
  type EmergencyContactShape,
  type IdentityShape,
  type LifecycleShape,
  type LocationShape,
  type RatingShape,
  type TimestampShape,
  type VerificationShape,
} from '../../shared/schemaFragments.js';

/**
 * Airbnb Host Profile — commercial client, onboarded by Back Office (Zone C).
 *
 * The host buys turnover: cleaning and maintenance vendors are named on the
 * profile so a same-day changeover does not need a human to pick a vendor.
 */
export interface IAirbnbHostProfile
  extends ContactShape,
    IdentityShape,
    LocationShape,
    EmergencyContactShape,
    VerificationShape,
    LifecycleShape,
    RatingShape,
    TimestampShape {
  _id: Types.ObjectId;
  businessName: string;
  contactPerson: string;
  unitsManaged: Types.ObjectId[];
  cleaningVendors: Types.ObjectId[];
  maintenanceVendors: Types.ObjectId[];
  assignedCoordinator?: Types.ObjectId;
  checkInInstructions?: string;
  checkOutInstructions?: string;
  turnoverWindowHours: number;
  platformListingUrls: string[];
  contractStart?: Date;
  contractEnd?: Date;
  serviceTier: 'basic' | 'standard' | 'premium';
}

const airbnbHostProfileSchema = new Schema<IAirbnbHostProfile>(
  {
    businessName: { type: String, required: true, trim: true, maxlength: 200, index: true },
    contactPerson: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...identityFields,
    ...locationFields,
    ...emergencyContactFields,
    ...verificationFields,
    ...ratingFields,

    unitsManaged: [{ type: Schema.Types.ObjectId, ref: 'Property' }],
    cleaningVendors: [{ type: Schema.Types.ObjectId, ref: 'VendorProfile' }],
    maintenanceVendors: [{ type: Schema.Types.ObjectId, ref: 'VendorProfile' }],
    assignedCoordinator: { type: Schema.Types.ObjectId, ref: 'CoordinatorProfile', index: true },

    checkInInstructions: { type: String, trim: true, maxlength: 4000 },
    checkOutInstructions: { type: String, trim: true, maxlength: 4000 },
    turnoverWindowHours: { type: Number, min: 1, max: 72, default: 4 },
    platformListingUrls: { type: [String], default: [] },

    contractStart: { type: Date },
    contractEnd: { type: Date },
    serviceTier: { type: String, enum: ['basic', 'standard', 'premium'], default: 'standard' },

    ...lifecycleFields,
  },
  baseSchemaOptions('airbnb_host_profiles'),
);

airbnbHostProfileSchema.index({ email: 1 }, { unique: true });
airbnbHostProfileSchema.index({ verificationStatus: 1, serviceTier: 1 });

airbnbHostProfileSchema.virtual('unitCount').get(function unitCount() {
  return this.unitsManaged?.length ?? 0;
});

export const AirbnbHostProfile = model<IAirbnbHostProfile>(
  'AirbnbHostProfile',
  airbnbHostProfileSchema,
);
