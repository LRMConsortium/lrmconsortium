import { z } from 'zod';
import { HQ_ZONES } from '../../config/hqZones.js';
import {
  contactCreate,
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zDate,
  zName,
  zObjectId,
  zStringArray,
  zText,
} from '../../shared/validationFragments.js';

export const createHQExecutiveSchema = z
  .object({
    fullName: zName,
    ...contactCreate,
    ...locationCreate,
    ...lifecycleCreate,
    executiveTitle: zText(120),
    portfolio: zStringArray(30).optional(),
    regionsOverseen: zStringArray(100).optional(),
    serviceLinesOverseen: zStringArray(20).optional(),
    zonesVisible: z.array(z.enum(HQ_ZONES)).optional(),
    reportsTo: zObjectId.optional(),
    appointedBy: zObjectId.optional(),
    appointmentDate: zDate.optional(),
    dashboardPreferences: z
      .object({
        defaultZone: z.enum(HQ_ZONES).optional(),
        pinnedKPIs: zStringArray(40).optional(),
      })
      .optional(),
  })
  .strict();

export const updateHQExecutiveSchema = toUpdateSchema(createHQExecutiveSchema);
