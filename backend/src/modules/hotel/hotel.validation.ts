import { z } from 'zod';
import {
  contactCreate,
  emergencyCreate,
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zDate,
  zIdArray,
  zName,
  zObjectId,
  zOptionalPhone,
  zText,
} from '../../shared/validationFragments.js';

export const staffMemberInput = z.object({
  fullName: zName,
  role: z.string().trim().min(2).max(120),
  phone: zOptionalPhone,
});

export const createHotelSchema = z
  .object({
    hotelName: z.string().trim().min(2).max(200),
    managerName: zName,
    ...contactCreate,
    ...locationCreate,
    ...emergencyCreate,
    ...lifecycleCreate,
    starRating: z.number().int().min(1).max(5).optional(),
    roomCount: z.number().int().min(0).max(10_000).optional(),
    roomsManaged: zIdArray.optional(),
    staffList: z.array(staffMemberInput).max(2000).optional(),
    maintenanceVendors: zIdArray.optional(),
    cleaningVendors: zIdArray.optional(),
    assignedCoordinator: zObjectId.optional(),
    reportingPreferences: zText(2000).optional(),
    reportingFrequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly']).optional(),
    contractStart: zDate.optional(),
    contractEnd: zDate.optional(),
    serviceTier: z.enum(['basic', 'standard', 'premium']).optional(),
    businessRegistrationNumber: zText(80).optional(),
  })
  .strict();

export const updateHotelSchema = toUpdateSchema(createHotelSchema);
