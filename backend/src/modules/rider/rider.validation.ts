import { z } from 'zod';
import {
  contactCreate,
  emergencyCreate,
  lifecycleCreate,
  toUpdateSchema,
  zName,
  zPaymentMethod,
} from '../../shared/validationFragments.js';

const savedPlace = z.object({
  label: z.string().trim().min(1).max(60),
  address: z.string().trim().min(3).max(400),
  longitude: z.number().min(-180).max(180).optional(),
  latitude: z.number().min(-90).max(90).optional(),
});

export const createRiderSchema = z
  .object({
    fullName: zName,
    ...contactCreate,
    ...emergencyCreate,
    ...lifecycleCreate,
    preferredPaymentMethod: zPaymentMethod.optional(),
    savedPlaces: z.array(savedPlace).max(25).optional(),
  })
  .strict();

export const updateRiderSchema = toUpdateSchema(createRiderSchema);
