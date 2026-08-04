import { z } from 'zod';
import { VEHICLE_TYPES } from '../driver/driver.model.js';
import {
  zCurrency,
  zMoney,
  zObjectId,
  zPaymentMethod,
  zText,
} from '../../shared/validationFragments.js';

/** A rider asking for a trip. Fare and driver are the server's to decide. */
export const requestRideSchema = z
  .object({
    pickupAddress: z.string().trim().min(3).max(400),
    pickupLongitude: z.number().min(-180).max(180).optional(),
    pickupLatitude: z.number().min(-90).max(90).optional(),
    dropoffAddress: z.string().trim().min(3).max(400),
    dropoffLongitude: z.number().min(-180).max(180).optional(),
    dropoffLatitude: z.number().min(-90).max(90).optional(),
    region: zText(120).optional(),
    vehicleType: z.enum(VEHICLE_TYPES).optional(),
    paymentMethod: zPaymentMethod.optional(),
    estimatedDistanceKm: z.number().min(0).max(2000).optional(),
    estimatedDurationMin: z.number().min(0).max(1440).optional(),
    notes: zText(2000).optional(),
  })
  .strict();

export const acceptRideSchema = z
  .object({
    etaMinutes: z.number().int().min(0).max(120).optional(),
  })
  .strict();

export const startRideSchema = z
  .object({
    startedAt: z.coerce.date().optional(),
  })
  .strict();

export const completeRideSchema = z
  .object({
    finalFare: zMoney,
    currency: zCurrency.optional(),
    distanceKm: z.number().min(0).max(2000).optional(),
    durationMin: z.number().min(0).max(1440).optional(),
    notes: zText(2000).optional(),
  })
  .strict();

export const cancelRideSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const rateRideSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: zText(1000).optional(),
  })
  .strict();

export const updateRideSchema = z
  .object({
    driver: zObjectId.optional(),
    region: zText(120).optional(),
    notes: zText(2000).optional(),
    estimatedFare: zMoney.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });
