import { Schema, model, type Types } from 'mongoose';
import { staffMemberSchema } from '../hotel/hotel.model.js';
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

export const RESORT_AMENITIES = [
  'pool',
  'spa',
  'gym',
  'restaurant',
  'bar',
  'beachAccess',
  'conferenceRooms',
  'golfCourse',
  'kidsClub',
  'waterSports',
  'shuttle',
  'generator',
  'borehole',
] as const;

/** Resort Profile — commercial client. Villas plus amenities under service. */
export interface IResortProfile
  extends ContactShape,
    LocationShape,
    EmergencyContactShape,
    VerificationShape,
    LifecycleShape,
    RatingShape,
    TimestampShape {
  _id: Types.ObjectId;
  resortName: string;
  managerName: string;
  villasManaged: Types.ObjectId[];
  villaCount: number;
  amenitiesManaged: string[];
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

const resortProfileSchema = new Schema<IResortProfile>(
  {
    resortName: { type: String, required: true, trim: true, maxlength: 200, index: true },
    managerName: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...locationFields,
    ...emergencyContactFields,
    ...verificationFields,
    ...ratingFields,

    villasManaged: [{ type: Schema.Types.ObjectId, ref: 'Property' }],
    villaCount: { type: Number, min: 0, default: 0 },
    amenitiesManaged: { type: [String], enum: RESORT_AMENITIES, default: [] },
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
    serviceTier: { type: String, enum: ['basic', 'standard', 'premium'], default: 'premium' },
    businessRegistrationNumber: { type: String, trim: true },

    ...lifecycleFields,
  },
  baseSchemaOptions('resort_profiles'),
);

resortProfileSchema.index({ email: 1 }, { unique: true });
resortProfileSchema.index({ verificationStatus: 1, region: 1 });

export const ResortProfile = model<IResortProfile>('ResortProfile', resortProfileSchema);
