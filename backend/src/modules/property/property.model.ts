import { Schema, model, type Types } from 'mongoose';
import {
  CURRENCIES,
  baseSchemaOptions,
  lifecycleFields,
  locationFields,
  type LifecycleShape,
  type LocationShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';
import { OCCUPANCY_STATUSES, type OccupancyStatus } from '../../config/lifecycles.js';

export { OCCUPANCY_STATUSES };
export type { OccupancyStatus };

export const PROPERTY_TYPES = [
  'singleFamily',
  'apartment',
  'compoundHouse',
  'townhouse',
  'duplex',
  'studio',
  'shortLetUnit',
  'hotelRoom',
  'resortVilla',
  'commercialSpace',
  'land',
] as const;

export const OWNER_KINDS = [
  'LandlordProfile',
  'AirbnbHostProfile',
  'HotelProfile',
  'ResortProfile',
] as const;

/**
 * One Property collection serves residential rentals, short-lets, hotel rooms
 * and resort villas. A polymorphic owner (`ownerKind` + `owner`) keeps the
 * maintenance, inspection and coordinator machinery identical across all four
 * rather than forking it per client type.
 */
export interface IProperty extends LocationShape, LifecycleShape, TimestampShape {
  _id: Types.ObjectId;
  reference: string;
  title: string;
  propertyType: (typeof PROPERTY_TYPES)[number];
  ownerKind: (typeof OWNER_KINDS)[number];
  owner: Types.ObjectId;
  assignedCoordinator?: Types.ObjectId;
  currentTenant?: Types.ObjectId;
  digitalAddress?: string;
  bedrooms?: number;
  bathrooms?: number;
  floorAreaSqm?: number;
  furnished: boolean;
  amenities: string[];
  photos: string[];
  rentAmount?: number;
  rentCurrency: string;
  rentPeriod: 'monthly' | 'nightly' | 'yearly';
  occupancyStatus: OccupancyStatus;
  listedPublicly: boolean;
  lastInspectionAt?: Date;
  nextInspectionDue?: Date;
}

const propertySchema = new Schema<IProperty>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },
    title: { type: String, required: true, trim: true, maxlength: 240 },
    propertyType: { type: String, enum: PROPERTY_TYPES, required: true, index: true },

    ownerKind: { type: String, enum: OWNER_KINDS, required: true },
    owner: { type: Schema.Types.ObjectId, required: true, refPath: 'ownerKind', index: true },
    assignedCoordinator: { type: Schema.Types.ObjectId, ref: 'CoordinatorProfile', index: true },
    currentTenant: { type: Schema.Types.ObjectId, ref: 'TenantProfile' },

    ...locationFields,
    digitalAddress: { type: String, trim: true },

    bedrooms: { type: Number, min: 0, max: 100 },
    bathrooms: { type: Number, min: 0, max: 100 },
    floorAreaSqm: { type: Number, min: 0 },
    furnished: { type: Boolean, default: false },
    amenities: { type: [String], default: [] },
    photos: { type: [String], default: [] },

    rentAmount: { type: Number, min: 0 },
    rentCurrency: { type: String, enum: CURRENCIES, default: 'GMD' },
    rentPeriod: { type: String, enum: ['monthly', 'nightly', 'yearly'], default: 'monthly' },

    occupancyStatus: {
      type: String,
      enum: OCCUPANCY_STATUSES,
      default: 'vacant',
      index: true,
    },
    listedPublicly: { type: Boolean, default: false, index: true },
    lastInspectionAt: { type: Date },
    nextInspectionDue: { type: Date, index: true },

    ...lifecycleFields,
  },
  baseSchemaOptions('properties'),
);

propertySchema.index({ reference: 1 }, { unique: true });
propertySchema.index({ owner: 1, ownerKind: 1 });
propertySchema.index({ region: 1, city: 1, occupancyStatus: 1 });
propertySchema.index({ listedPublicly: 1, propertyType: 1, rentAmount: 1 });

/** Generate a stable human reference: LRMC-<REGION>-<6 hex>. */
propertySchema.pre('validate', function ensureReference(next) {
  if (!this.reference) {
    const regionCode = (this.region ?? 'GH').slice(0, 3).toUpperCase();
    const suffix = Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0')
      .toUpperCase();
    this.reference = `LRMC-${regionCode}-${suffix}`;
  }
  next();
});

export const Property = model<IProperty>('Property', propertySchema);
