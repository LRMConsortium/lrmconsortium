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

export const VEHICLE_TYPES = [
  'sedan',
  'hatchback',
  'suv',
  'minivan',
  'pickup',
  'motorcycle',
  'tricycle',
  'bus',
  'luxury',
] as const;

/**
 * Driver Profile (Ususu) — verified by Back Office (Zone C).
 *
 * Licence and insurance expiry are first-class fields, not attachments: the
 * verification queue is driven off them, and an expired document flips the
 * driver out of `verified` without a human noticing late.
 */
export interface IDriverProfile
  extends ContactShape,
    IdentityShape,
    LocationShape,
    EmergencyContactShape,
    VerificationShape,
    LifecycleShape,
    RatingShape,
    TimestampShape {
  _id: Types.ObjectId;
  fullName: string;
  driverLicenseNumber?: string;
  driverLicensePhoto?: string;
  driverLicenseExpiry?: Date;
  vehicleType: (typeof VEHICLE_TYPES)[number];
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  vehicleColor?: string;
  vehiclePlate?: string;
  vehiclePhotos: string[];
  insurancePhoto?: string;
  insuranceExpiry?: Date;
  roadworthyExpiry?: Date;
  ownedBy?: Types.ObjectId;
  areasCovered: string[];
  completedRides: number;
  cancelledRides: number;
  acceptanceRate: number;
  isOnline: boolean;
  lastOnlineAt?: Date;
  currentLocation?: { type: 'Point'; coordinates: number[] };
  payoutMethod?: string;
  payoutAccountRef?: string;
}

const driverProfileSchema = new Schema<IDriverProfile>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...identityFields,
    ...locationFields,
    ...emergencyContactFields,
    ...verificationFields,
    ...ratingFields,

    driverLicenseNumber: { type: String, trim: true, select: false },
    driverLicensePhoto: { type: String, trim: true, select: false },
    driverLicenseExpiry: { type: Date, index: true },

    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true, index: true },
    vehicleMake: { type: String, trim: true },
    vehicleModel: { type: String, trim: true },
    vehicleYear: { type: Number, min: 1970, max: new Date().getFullYear() + 1 },
    vehicleColor: { type: String, trim: true },
    vehiclePlate: { type: String, trim: true, uppercase: true },
    vehiclePhotos: { type: [String], default: [] },
    insurancePhoto: { type: String, trim: true, select: false },
    insuranceExpiry: { type: Date, index: true },
    roadworthyExpiry: { type: Date },

    /** Set when the driver operates a rental car company's vehicle. */
    ownedBy: { type: Schema.Types.ObjectId, ref: 'RentalCarCompanyProfile', index: true },

    areasCovered: { type: [String], default: [], index: true },
    completedRides: { type: Number, min: 0, default: 0 },
    cancelledRides: { type: Number, min: 0, default: 0 },
    acceptanceRate: { type: Number, min: 0, max: 100, default: 100 },

    isOnline: { type: Boolean, default: false, index: true },
    lastOnlineAt: { type: Date },
    currentLocation: {
      type: { type: String, enum: ['Point'], default: undefined },
      coordinates: { type: [Number], default: undefined },
    },

    payoutMethod: { type: String, default: 'mobileMoney' },
    payoutAccountRef: { type: String, trim: true, select: false },

    ...lifecycleFields,
  },
  baseSchemaOptions('driver_profiles'),
);

driverProfileSchema.index({ email: 1 }, { unique: true });
driverProfileSchema.index({ vehiclePlate: 1 }, { unique: true, sparse: true });
driverProfileSchema.index({ isOnline: 1, areasCovered: 1, verificationStatus: 1 });
driverProfileSchema.index({ currentLocation: '2dsphere' }, { sparse: true });

/** A driver whose licence or insurance has lapsed is not dispatchable. */
driverProfileSchema.virtual('documentsCurrent').get(function documentsCurrent() {
  const now = Date.now();
  const licenceOk = !this.driverLicenseExpiry || this.driverLicenseExpiry.getTime() > now;
  const insuranceOk = !this.insuranceExpiry || this.insuranceExpiry.getTime() > now;
  return licenceOk && insuranceOk;
});

driverProfileSchema.virtual('dispatchable').get(function dispatchable() {
  const now = Date.now();
  const licenceOk = !this.driverLicenseExpiry || this.driverLicenseExpiry.getTime() > now;
  const insuranceOk = !this.insuranceExpiry || this.insuranceExpiry.getTime() > now;
  return (
    this.verificationStatus === 'verified' && this.status === 'active' && licenceOk && insuranceOk
  );
});

export const DriverProfile = model<IDriverProfile>('DriverProfile', driverProfileSchema);
