import { z } from 'zod';
import { HQ_ZONES } from '../../config/hqZones.js';
import {
  contactCreate,
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zName,
  zStringArray,
  zText,
} from '../../shared/validationFragments.js';

export const createFounderSchema = z
  .object({
    fullName: zName,
    ...contactCreate,
    ...locationCreate,
    ...lifecycleCreate,
    founderTitle: zText(120).optional(),
    bio: zText(5000).optional(),
    missionStatement: zText(3000).optional(),
    visionStatement: zText(3000).optional(),
    coreValues: zStringArray(50).optional(),
    policyAuthorityLevel: z.enum(['absolute', 'delegatedReview', 'boardRatified']).optional(),
    regionsOverseen: zStringArray(100).optional(),
    serviceLinesOverseen: zStringArray(20).optional(),
    systemAccessScope: z.enum(['global', 'regional']).optional(),
    commandZones: z.array(z.enum(HQ_ZONES)).optional(),
    successionContact: zText(200).optional(),
    securityNotes: zText(5000).optional(),
  })
  .strict();

export const updateFounderSchema = toUpdateSchema(createFounderSchema);
