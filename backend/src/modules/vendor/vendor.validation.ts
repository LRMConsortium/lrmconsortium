import { z } from 'zod';
import {
  contactCreate,
  identityCreate,
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zCurrency,
  zMoney,
  zName,
  zStringArray,
  zText,
} from '../../shared/validationFragments.js';
import { VENDOR_SERVICE_TYPES } from './vendor.model.js';

const rateCardItem = z.object({
  item: z.string().trim().min(1).max(160),
  unit: z.string().trim().max(40).default('job'),
  amount: zMoney,
  currency: zCurrency.default('GMD'),
});

export const createVendorSchema = z
  .object({
    fullName: zName,
    businessName: z.string().trim().min(2).max(200),
    serviceType: z.enum(VENDOR_SERVICE_TYPES),
    secondaryServiceTypes: z.array(z.enum(VENDOR_SERVICE_TYPES)).max(10).optional(),
    ...contactCreate,
    ...identityCreate,
    ...locationCreate,
    ...lifecycleCreate,
    areasCovered: zStringArray(100).optional(),
    skills: zStringArray(60).optional(),
    toolsAvailable: zStringArray(80).optional(),
    serviceRates: zText(1000).optional(),
    rateCard: z.array(rateCardItem).max(100).optional(),
    businessRegistrationNumber: zText(80).optional(),
    taxIdentificationNumber: zText(80).optional(),
    insured: z.boolean().optional(),
  })
  .strict();

export const updateVendorSchema = toUpdateSchema(createVendorSchema);
