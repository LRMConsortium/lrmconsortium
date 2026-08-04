import { z } from 'zod';
import {
  contactCreate,
  emergencyCreate,
  identityCreate,
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zDate,
  zIdArray,
  zName,
  zObjectId,
  zText,
  zUrl,
} from '../../shared/validationFragments.js';

export const createAirbnbHostSchema = z
  .object({
    businessName: z.string().trim().min(2).max(200),
    contactPerson: zName,
    ...contactCreate,
    ...identityCreate,
    ...locationCreate,
    ...emergencyCreate,
    ...lifecycleCreate,
    unitsManaged: zIdArray.optional(),
    cleaningVendors: zIdArray.optional(),
    maintenanceVendors: zIdArray.optional(),
    assignedCoordinator: zObjectId.optional(),
    checkInInstructions: zText(4000).optional(),
    checkOutInstructions: zText(4000).optional(),
    turnoverWindowHours: z.number().int().min(1).max(72).optional(),
    platformListingUrls: z.array(zUrl).max(100).optional(),
    contractStart: zDate.optional(),
    contractEnd: zDate.optional(),
    serviceTier: z.enum(['basic', 'standard', 'premium']).optional(),
  })
  .strict();

export const updateAirbnbHostSchema = toUpdateSchema(createAirbnbHostSchema);
