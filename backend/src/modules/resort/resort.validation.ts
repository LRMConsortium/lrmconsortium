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
  zText,
} from '../../shared/validationFragments.js';
import { staffMemberInput } from '../hotel/hotel.validation.js';
import { RESORT_AMENITIES } from './resort.model.js';

export const createResortSchema = z
  .object({
    resortName: z.string().trim().min(2).max(200),
    managerName: zName,
    ...contactCreate,
    ...locationCreate,
    ...emergencyCreate,
    ...lifecycleCreate,
    villasManaged: zIdArray.optional(),
    villaCount: z.number().int().min(0).max(5000).optional(),
    amenitiesManaged: z.array(z.enum(RESORT_AMENITIES)).max(RESORT_AMENITIES.length).optional(),
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

export const updateResortSchema = toUpdateSchema(createResortSchema);
