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
  zStringArray,
  zText,
} from '../../shared/validationFragments.js';
import { BACK_OFFICE_DEPARTMENTS } from './backOfficeStaff.model.js';

export const createBackOfficeStaffSchema = z
  .object({
    fullName: zName,
    ...contactCreate,
    ...identityCreate,
    ...locationCreate,
    ...emergencyCreate,
    ...lifecycleCreate,
    staffNumber: z.string().trim().toUpperCase().min(3).max(24),
    department: z.enum(BACK_OFFICE_DEPARTMENTS),
    jobTitle: zText(120),
    employmentType: z.enum(['fullTime', 'partTime', 'contract', 'intern']).optional(),
    hireDate: zDate.optional(),
    exitDate: zDate.optional(),
    reportsTo: zObjectId.optional(),
    desksCovered: zStringArray(40).optional(),
    regionsServed: zStringArray(100).optional(),
  })
  .strict();

export const updateBackOfficeStaffSchema = toUpdateSchema(createBackOfficeStaffSchema);
