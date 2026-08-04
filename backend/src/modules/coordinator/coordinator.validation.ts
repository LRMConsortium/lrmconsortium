import { z } from 'zod';
import {
  contactCreate,
  identityCreate,
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zDate,
  zIdArray,
  zName,
  zStringArray,
  zText,
} from '../../shared/validationFragments.js';

const availabilityWindow = z.object({
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  from: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
  to: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
});

export const createCoordinatorSchema = z
  .object({
    fullName: zName,
    ...contactCreate,
    ...identityCreate,
    ...locationCreate,
    ...lifecycleCreate,
    areasCovered: zStringArray(100).optional(),
    assignedProperties: zIdArray.optional(),
    skills: zStringArray(60).optional(),
    languages: zStringArray(30).optional(),
    availabilitySchedule: zText(500).optional(),
    availabilityWindows: z.array(availabilityWindow).max(21).optional(),
    employmentType: z.enum(['staff', 'contract', 'volunteer']).optional(),
    startDate: zDate.optional(),
  })
  .strict();

export const updateCoordinatorSchema = toUpdateSchema(createCoordinatorSchema);

export const assignPropertiesSchema = z.object({ propertyIds: zIdArray.min(1) }).strict();
