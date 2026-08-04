import { Schema, model, type Types } from 'mongoose';
import {
  CURRENCIES,
  baseSchemaOptions,
  contactFields,
  identityFields,
  lifecycleFields,
  locationFields,
  ratingFields,
  verificationFields,
  type ContactShape,
  type IdentityShape,
  type LifecycleShape,
  type LocationShape,
  type RatingShape,
  type TimestampShape,
  type VerificationShape,
} from '../../shared/schemaFragments.js';

export const VENDOR_SERVICE_TYPES = [
  'plumbing',
  'electrical',
  'carpentry',
  'masonry',
  'painting',
  'cleaning',
  'landscaping',
  'pestControl',
  'security',
  'hvac',
  'appliance',
  'roofing',
  'generalMaintenance',
  'vehicleMaintenance',
  'other',
] as const;

/** Vendor Profile — service provider serving LRMC properties and Ususu fleets. */
export interface IVendorProfile
  extends ContactShape,
    IdentityShape,
    LocationShape,
    VerificationShape,
    LifecycleShape,
    RatingShape,
    TimestampShape {
  _id: Types.ObjectId;
  fullName: string;
  businessName: string;
  serviceType: (typeof VENDOR_SERVICE_TYPES)[number];
  secondaryServiceTypes: string[];
  areasCovered: string[];
  skills: string[];
  toolsAvailable: string[];
  serviceRates?: string;
  rateCard: { item: string; unit: string; amount: number; currency: string }[];
  completedJobs: number;
  openJobs: number;
  averageResponseHours: number;
  businessRegistrationNumber?: string;
  taxIdentificationNumber?: string;
  insured: boolean;
}

const rateCardItemSchema = new Schema(
  {
    item: { type: String, required: true, trim: true },
    unit: { type: String, required: true, trim: true, default: 'job' },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GHS' },
  },
  { _id: false },
);

const vendorProfileSchema = new Schema<IVendorProfile>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    businessName: { type: String, required: true, trim: true, maxlength: 200, index: true },
    serviceType: { type: String, enum: VENDOR_SERVICE_TYPES, required: true, index: true },
    secondaryServiceTypes: { type: [String], enum: VENDOR_SERVICE_TYPES, default: [] },
    ...contactFields,
    ...identityFields,
    ...locationFields,
    ...verificationFields,
    ...ratingFields,

    areasCovered: { type: [String], default: [], index: true },
    skills: { type: [String], default: [] },
    toolsAvailable: { type: [String], default: [] },
    serviceRates: { type: String, trim: true },
    rateCard: { type: [rateCardItemSchema], default: [] },

    completedJobs: { type: Number, min: 0, default: 0 },
    openJobs: { type: Number, min: 0, default: 0 },
    averageResponseHours: { type: Number, min: 0, default: 24 },

    businessRegistrationNumber: { type: String, trim: true },
    taxIdentificationNumber: { type: String, trim: true, select: false },
    insured: { type: Boolean, default: false },

    ...lifecycleFields,
  },
  baseSchemaOptions('vendor_profiles'),
);

vendorProfileSchema.index({ email: 1 }, { unique: true });
vendorProfileSchema.index({ serviceType: 1, areasCovered: 1, verificationStatus: 1 });
vendorProfileSchema.index({ rating: -1, completedJobs: -1 });

export const VendorProfile = model<IVendorProfile>('VendorProfile', vendorProfileSchema);
