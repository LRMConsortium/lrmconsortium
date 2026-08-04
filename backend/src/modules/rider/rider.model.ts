import { Schema, model, type Types } from 'mongoose';
import {
  PAYMENT_METHODS,
  baseSchemaOptions,
  contactFields,
  emergencyContactFields,
  lifecycleFields,
  ratingFields,
  type ContactShape,
  type EmergencyContactShape,
  type LifecycleShape,
  type RatingShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';

/**
 * Rider Profile (Ususu) — deliberately the lightest profile in the platform.
 * Signup friction is the enemy of a rideshare marketplace, so no ID is required
 * and `verificationStatus` is absent by design.
 */
export interface IRiderProfile
  extends ContactShape,
    EmergencyContactShape,
    LifecycleShape,
    RatingShape,
    TimestampShape {
  _id: Types.ObjectId;
  fullName: string;
  preferredPaymentMethod: (typeof PAYMENT_METHODS)[number];
  savedPlaces: { label: string; address: string; longitude?: number; latitude?: number }[];
  rideHistory: Types.ObjectId[];
  completedRides: number;
  cancelledRides: number;
}

const savedPlaceSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 60 },
    address: { type: String, required: true, trim: true, maxlength: 400 },
    longitude: { type: Number, min: -180, max: 180 },
    latitude: { type: Number, min: -90, max: 90 },
  },
  { _id: false },
);

const riderProfileSchema = new Schema<IRiderProfile>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...emergencyContactFields,
    ...ratingFields,

    preferredPaymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'mobileMoney' },
    savedPlaces: { type: [savedPlaceSchema], default: [] },
    rideHistory: [{ type: Schema.Types.ObjectId, ref: 'Ride' }],
    completedRides: { type: Number, min: 0, default: 0 },
    cancelledRides: { type: Number, min: 0, default: 0 },

    ...lifecycleFields,
  },
  baseSchemaOptions('rider_profiles'),
);

riderProfileSchema.index({ email: 1 }, { unique: true });
riderProfileSchema.index({ phone: 1 });

export const RiderProfile = model<IRiderProfile>('RiderProfile', riderProfileSchema);
