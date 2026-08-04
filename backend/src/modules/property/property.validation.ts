import { z } from 'zod';
import {
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zCurrency,
  zDate,
  zMoney,
  zObjectId,
  zPhoto,
  zStringArray,
  zText,
} from '../../shared/validationFragments.js';
import { OWNER_KINDS, PROPERTY_TYPES } from './property.model.js';

export const createPropertySchema = z
  .object({
    reference: z.string().trim().toUpperCase().max(40).optional(),
    title: z.string().trim().min(3).max(240),
    propertyType: z.enum(PROPERTY_TYPES),
    ownerKind: z.enum(OWNER_KINDS),
    owner: zObjectId,
    assignedCoordinator: zObjectId.optional(),
    currentTenant: zObjectId.optional(),
    ...locationCreate,
    ...lifecycleCreate,
    digitalAddress: zText(40).optional(),
    bedrooms: z.number().int().min(0).max(100).optional(),
    bathrooms: z.number().min(0).max(100).optional(),
    floorAreaSqm: z.number().min(0).optional(),
    furnished: z.boolean().optional(),
    amenities: zStringArray(60).optional(),
    photos: z.array(zPhoto).max(40).optional(),
    rentAmount: zMoney.optional(),
    rentCurrency: zCurrency.optional(),
    rentPeriod: z.enum(['monthly', 'nightly', 'yearly']).optional(),
    occupancyStatus: z.enum(['vacant', 'occupied', 'maintenance', 'offMarket']).optional(),
    listedPublicly: z.boolean().optional(),
    lastInspectionAt: zDate.optional(),
    nextInspectionDue: zDate.optional(),
  })
  .strict();

export const updatePropertySchema = toUpdateSchema(createPropertySchema);

export const publicPropertyQuery = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
    propertyType: z.enum(PROPERTY_TYPES).optional(),
    city: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(),
    minRent: z.coerce.number().min(0).optional(),
    maxRent: z.coerce.number().min(0).optional(),
    bedrooms: z.coerce.number().int().min(0).max(100).optional(),
    search: z.string().trim().max(120).optional(),
  })
  .strict();
