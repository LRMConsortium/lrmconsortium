import { Schema, model, type Types } from 'mongoose';
import { VEHICLE_TYPES } from '../driver/driver.model.js';
import {
  CURRENCIES,
  baseSchemaOptions,
  contactFields,
  lifecycleFields,
  locationFields,
  ratingFields,
  verificationFields,
  type ContactShape,
  type LifecycleShape,
  type LocationShape,
  type RatingShape,
  type TimestampShape,
  type VerificationShape,
} from '../../shared/schemaFragments.js';

/**
 * Rental Car Company Profile — the bridge between LRMC's vendor discipline and
 * Ususu's supply. `fleet` is embedded rather than a separate collection: a
 * vehicle has no meaning outside its owning company, and utilisation reporting
 * always reads the whole fleet at once.
 */
export interface IFleetVehicle {
  plate: string;
  vehicleType: (typeof VEHICLE_TYPES)[number];
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  vin?: string;
  dailyRate?: number;
  currency?: string;
  insuranceProvider?: string;
  insuranceExpiry?: Date;
  roadworthyExpiry?: Date;
  odometerKm?: number;
  assignedDriver?: Types.ObjectId;
  availability: 'available' | 'rented' | 'maintenance' | 'retired';
}

export interface IRentalCarCompanyProfile
  extends ContactShape,
    LocationShape,
    VerificationShape,
    LifecycleShape,
    RatingShape,
    TimestampShape {
  _id: Types.ObjectId;
  companyName: string;
  managerName: string;
  fleet: IFleetVehicle[];
  insuranceProviders: string[];
  maintenanceVendors: Types.ObjectId[];
  rentalRates?: string;
  reportingPreferences?: string;
  reportingFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  businessRegistrationNumber?: string;
  serviceTier: 'basic' | 'standard' | 'premium';
  suppliesUsusu: boolean;
  contractStart?: Date;
  contractEnd?: Date;
}

const fleetVehicleSchema = new Schema<IFleetVehicle>(
  {
    plate: { type: String, required: true, trim: true, uppercase: true },
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
    make: { type: String, trim: true },
    model: { type: String, trim: true },
    year: { type: Number, min: 1970, max: new Date().getFullYear() + 1 },
    color: { type: String, trim: true },
    vin: { type: String, trim: true, select: false },
    dailyRate: { type: Number, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GMD' },
    insuranceProvider: { type: String, trim: true },
    insuranceExpiry: { type: Date },
    roadworthyExpiry: { type: Date },
    odometerKm: { type: Number, min: 0 },
    assignedDriver: { type: Schema.Types.ObjectId, ref: 'DriverProfile' },
    availability: {
      type: String,
      enum: ['available', 'rented', 'maintenance', 'retired'],
      default: 'available',
    },
  },
  { _id: true },
);

const rentalCarCompanyProfileSchema = new Schema<IRentalCarCompanyProfile>(
  {
    companyName: { type: String, required: true, trim: true, maxlength: 200, index: true },
    managerName: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...locationFields,
    ...verificationFields,
    ...ratingFields,

    fleet: { type: [fleetVehicleSchema], default: [] },
    insuranceProviders: { type: [String], default: [] },
    maintenanceVendors: [{ type: Schema.Types.ObjectId, ref: 'VendorProfile' }],
    rentalRates: { type: String, trim: true, maxlength: 2000 },

    reportingPreferences: { type: String, trim: true, maxlength: 2000 },
    reportingFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly'],
      default: 'monthly',
    },
    businessRegistrationNumber: { type: String, trim: true },
    serviceTier: { type: String, enum: ['basic', 'standard', 'premium'], default: 'standard' },
    suppliesUsusu: { type: Boolean, default: false, index: true },
    contractStart: { type: Date },
    contractEnd: { type: Date },

    ...lifecycleFields,
  },
  baseSchemaOptions('rental_car_company_profiles'),
);

rentalCarCompanyProfileSchema.index({ email: 1 }, { unique: true });
rentalCarCompanyProfileSchema.index({ 'fleet.plate': 1 });
rentalCarCompanyProfileSchema.index({ suppliesUsusu: 1, verificationStatus: 1 });

rentalCarCompanyProfileSchema.virtual('fleetSize').get(function fleetSize() {
  return this.fleet?.filter((v) => v.availability !== 'retired').length ?? 0;
});

rentalCarCompanyProfileSchema.virtual('utilizationPercent').get(function utilizationPercent() {
  const active = this.fleet?.filter((v) => v.availability !== 'retired') ?? [];
  if (active.length === 0) return 0;
  const rented = active.filter((v) => v.availability === 'rented').length;
  return Math.round((rented / active.length) * 1000) / 10;
});

export const RentalCarCompanyProfile = model<IRentalCarCompanyProfile>(
  'RentalCarCompanyProfile',
  rentalCarCompanyProfileSchema,
);
