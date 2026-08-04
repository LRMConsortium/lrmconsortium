import { z } from 'zod';
import {
  contactCreate,
  emergencyCreate,
  identityCreate,
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zDate,
  zName,
  zObjectId,
  zPaymentMethod,
  zPhoto,
  zStringArray,
  zText,
} from '../../shared/validationFragments.js';
import { VEHICLE_TYPES } from './driver.model.js';

export const createDriverSchema = z
  .object({
    fullName: zName,
    ...contactCreate,
    ...identityCreate,
    ...locationCreate,
    ...emergencyCreate,
    ...lifecycleCreate,
    driverLicenseNumber: zText(64).optional(),
    driverLicensePhoto: zPhoto.optional(),
    driverLicenseExpiry: zDate.optional(),
    vehicleType: z.enum(VEHICLE_TYPES),
    vehicleMake: zText(80).optional(),
    vehicleModel: zText(80).optional(),
    vehicleYear: z.number().int().min(1970).max(new Date().getFullYear() + 1).optional(),
    vehicleColor: zText(40).optional(),
    vehiclePlate: z.string().trim().toUpperCase().min(3).max(16).optional(),
    vehiclePhotos: z.array(zPhoto).max(12).optional(),
    insurancePhoto: zPhoto.optional(),
    insuranceExpiry: zDate.optional(),
    roadworthyExpiry: zDate.optional(),
    ownedBy: zObjectId.optional(),
    areasCovered: zStringArray(100).optional(),
    payoutMethod: zPaymentMethod.optional(),
    payoutAccountRef: zText(120).optional(),
  })
  .strict();

export const updateDriverSchema = toUpdateSchema(createDriverSchema);

export const onlineStatusSchema = z
  .object({
    isOnline: z.boolean(),
    longitude: z.number().min(-180).max(180).optional(),
    latitude: z.number().min(-90).max(90).optional(),
  })
  .strict();
