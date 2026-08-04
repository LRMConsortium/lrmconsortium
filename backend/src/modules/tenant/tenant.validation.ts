import { z } from 'zod';
import {
  contactCreate,
  emergencyCreate,
  identityCreate,
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zCurrency,
  zDate,
  zMoney,
  zName,
  zObjectId,
  zPaymentMethod,
  zText,
} from '../../shared/validationFragments.js';

const tenantFields = z
  .object({
    fullName: zName,
    ...contactCreate,
    ...identityCreate,
    ...locationCreate,
    ...emergencyCreate,
    ...lifecycleCreate,
    occupation: zText(160).optional(),
    employerName: zText(200).optional(),
    employerContact: zText(200).optional(),
    monthlyIncome: zMoney.optional(),
    property: zObjectId.optional(),
    unitLabel: zText(60).optional(),
    leaseStart: zDate.optional(),
    leaseEnd: zDate.optional(),
    monthlyRent: zMoney.optional(),
    rentCurrency: zCurrency.optional(),
    securityDeposit: zMoney.optional(),
    paymentMethod: zPaymentMethod.optional(),
    rentDueDay: z.number().int().min(1).max(31).optional(),
  })
  .strict();

const leaseWindowIsSane = (v: { leaseStart?: Date; leaseEnd?: Date }): boolean =>
  !v.leaseStart || !v.leaseEnd || v.leaseEnd > v.leaseStart;

export const createTenantSchema = tenantFields.refine(leaseWindowIsSane, {
  message: 'leaseEnd must be after leaseStart',
  path: ['leaseEnd'],
});

export const updateTenantSchema = toUpdateSchema(tenantFields).refine(leaseWindowIsSane, {
  message: 'leaseEnd must be after leaseStart',
  path: ['leaseEnd'],
});
