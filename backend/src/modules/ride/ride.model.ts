import { Schema, model, type Types } from 'mongoose';
import { VEHICLE_TYPES } from '../driver/driver.model.js';
import {
  CURRENCIES,
  PAYMENT_METHODS,
  baseSchemaOptions,
  lifecycleFields,
  type LifecycleShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';
import { RIDE_STATUSES, RIDE_TRANSITIONS } from './lifecycle.js';

// The lifecycle lives in `lifecycle.ts` — pure data, no Mongoose — so it can be
// asserted without a database. Re-exported here so callers still import the
// state machine from the model they are moving through it.
export {
  RIDE_STATUSES,
  RIDE_TRANSITIONS,
  RIDE_TERMINAL_STATUSES,
  canTransition,
  reachableRideStatuses,
} from './lifecycle.js';
export type { RideStatus } from './lifecycle.js';

/**
 * One Ususu trip, from request to completion.
 *
 * The lifecycle is a strict forward march — `RIDE_TRANSITIONS` in `lifecycle.ts`
 * is the whole state machine, and the routers refuse anything not in it.
 */
export interface IRide extends Omit<LifecycleShape, 'status'>, TimestampShape {
  _id: Types.ObjectId;
  reference: string;
  rider: Types.ObjectId;
  driver?: Types.ObjectId;

  pickupAddress: string;
  pickupLongitude?: number;
  pickupLatitude?: number;
  dropoffAddress: string;
  dropoffLongitude?: number;
  dropoffLatitude?: number;
  region?: string;

  vehicleType: (typeof VEHICLE_TYPES)[number];
  estimatedDistanceKm?: number;
  estimatedDurationMin?: number;
  estimatedFare?: number;
  finalFare?: number;
  currency: (typeof CURRENCIES)[number];
  platformCommission: number;
  driverEarnings?: number;
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  payment?: Types.ObjectId;

  requestedAt: Date;
  acceptedAt?: Date;
  arrivedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;

  riderRating?: number;
  driverRating?: number;
  notes?: string;
  status: (typeof RIDE_STATUSES)[number];
}

const rideSchema = new Schema<IRide>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },
    rider: { type: Schema.Types.ObjectId, ref: 'RiderProfile', required: true, index: true },
    driver: { type: Schema.Types.ObjectId, ref: 'DriverProfile', index: true },

    pickupAddress: { type: String, required: true, trim: true, maxlength: 400 },
    pickupLongitude: { type: Number, min: -180, max: 180 },
    pickupLatitude: { type: Number, min: -90, max: 90 },
    dropoffAddress: { type: String, required: true, trim: true, maxlength: 400 },
    dropoffLongitude: { type: Number, min: -180, max: 180 },
    dropoffLatitude: { type: Number, min: -90, max: 90 },
    region: { type: String, index: true },

    vehicleType: { type: String, enum: VEHICLE_TYPES, default: 'sedan', index: true },
    estimatedDistanceKm: { type: Number, min: 0 },
    estimatedDurationMin: { type: Number, min: 0 },
    estimatedFare: { type: Number, min: 0 },
    finalFare: { type: Number, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GHS' },
    platformCommission: { type: Number, min: 0, max: 100, default: 15 },
    driverEarnings: { type: Number, min: 0 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'mobileMoney' },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment' },

    requestedAt: { type: Date, required: true, default: () => new Date(), index: true },
    acceptedAt: { type: Date },
    arrivedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true },

    riderRating: { type: Number, min: 1, max: 5 },
    driverRating: { type: Number, min: 1, max: 5 },
    notes: { type: String, trim: true, maxlength: 2000 },

    status: { type: String, enum: RIDE_STATUSES, default: 'requested', index: true },
    ...lifecycleFields,
  },
  baseSchemaOptions('rides'),
);

rideSchema.index({ reference: 1 }, { unique: true });
rideSchema.index({ status: 1, region: 1, requestedAt: 1 });
rideSchema.index({ rider: 1, requestedAt: -1 });
rideSchema.index({ driver: 1, requestedAt: -1 });

rideSchema.pre('validate', function seed(next) {
  if (!this.reference) {
    const suffix = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
    this.reference = `RID-${suffix}`;
  }
  next();
});

rideSchema.virtual('isTerminal').get(function isTerminal() {
  return (RIDE_TRANSITIONS[this.status]?.length ?? 0) === 0;
});

export const Ride = model<IRide>('Ride', rideSchema);
