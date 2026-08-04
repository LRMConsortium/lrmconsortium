import { z } from 'zod';
import {
  contactCreate,
  emergencyCreate,
  identityCreate,
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zCurrency,
  zDiasporaStatus,
  zIdArray,
  zName,
  zPaymentMethod,
  zText,
} from '../../shared/validationFragments.js';

export const createLandlordSchema = z
  .object({
    fullName: zName,
    ...contactCreate,
    ...identityCreate,
    ...locationCreate,
    ...emergencyCreate,
    ...lifecycleCreate,
    propertiesOwned: zIdArray.optional(),
    diasporaStatus: zDiasporaStatus.optional(),
    payoutMethod: zPaymentMethod.optional(),
    payoutAccountRef: zText(120).optional(),
    payoutCurrency: zCurrency.optional(),
    managementFeePercent: z.number().min(0).max(100).optional(),
    statementFrequency: z.enum(['monthly', 'quarterly', 'annually']).optional(),
  })
  .strict();

export const updateLandlordSchema = toUpdateSchema(createLandlordSchema);
