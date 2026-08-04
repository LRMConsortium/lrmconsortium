import { Schema, model, type Types } from 'mongoose';
import {
  baseSchemaOptions,
  contactFields,
  emergencyContactFields,
  lifecycleFields,
  locationFields,
  ratingFields,
  verificationFields,
  type ContactShape,
  type EmergencyContactShape,
  type LifecycleShape,
  type LocationShape,
  type RatingShape,
  type TimestampShape,
  type VerificationShape,
} from '../../shared/schemaFragments.js';

/** Hotel Profile — commercial client. Rooms, staff, vendors, reporting cadence. */
export interface IHotelProfile
  extends ContactShape,
    LocationShape,
    EmergencyContactShape,
    VerificationShape,
    LifecycleShape,
    RatingShape,
    TimestampShape {
  _id: Types.ObjectId;
  hotelName: string;
  managerName: string;
  starRating?: number;
  roomCount: number;
  roomsManaged: Types.ObjectId[];
  staffList: { fullName: string; role: string; phone?: string }[];
  maintenanceVendors: Types.ObjectId[];
  cleaningVendors: Types.ObjectId[];
  assignedCoordinator?: Types.ObjectId;
  reportingPreferences?: string;
  reportingFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  contractStart?: Date;
  contractEnd?: Date;
  serviceTier: 'basic' | 'standard' | 'premium';
  businessRegistrationNumber?: string;
}

export const staffMemberSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    role: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, trim: true },
  },
  { _id: false },
);

const hotelProfileSchema = new Schema<IHotelProfile>(
  {
    hotelName: { type: String, required: true, trim: true, maxlength: 200, index: true },
    managerName: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...locationFields,
    ...emergencyContactFields,
    ...verificationFields,
    ...ratingFields,

    starRating: { type: Number, min: 1, max: 5 },
    roomCount: { type: Number, min: 0, default: 0 },
    roomsManaged: [{ type: Schema.Types.ObjectId, ref: 'Property' }],
    staffList: { type: [staffMemberSchema], default: [] },
    maintenanceVendors: [{ type: Schema.Types.ObjectId, ref: 'VendorProfile' }],
    cleaningVendors: [{ type: Schema.Types.ObjectId, ref: 'VendorProfile' }],
    assignedCoordinator: { type: Schema.Types.ObjectId, ref: 'CoordinatorProfile', index: true },

    reportingPreferences: { type: String, trim: true, maxlength: 2000 },
    reportingFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly'],
      default: 'monthly',
    },
    contractStart: { type: Date },
    contractEnd: { type: Date },
    serviceTier: { type: String, enum: ['basic', 'standard', 'premium'], default: 'standard' },
    businessRegistrationNumber: { type: String, trim: true },

    ...lifecycleFields,
  },
  baseSchemaOptions('hotel_profiles'),
);

hotelProfileSchema.index({ email: 1 }, { unique: true });
hotelProfileSchema.index({ verificationStatus: 1, region: 1 });

export const HotelProfile = model<IHotelProfile>('HotelProfile', hotelProfileSchema);
