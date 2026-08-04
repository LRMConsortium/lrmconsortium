import { z } from 'zod';
import {
  CONTACT_METHODS,
  CURRENCIES,
  DIASPORA_STATUSES,
  ID_TYPES,
  PAYMENT_METHODS,
  PHONE_REGEX,
  VERIFICATION_STATUSES,
} from './schemaFragments.js';

/** Reusable zod pieces so every profile validates its shared fields identically. */

export const zObjectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const zEmail = z.string().trim().toLowerCase().email('Invalid email address');
export const zPhone = z.string().trim().regex(PHONE_REGEX, 'Invalid phone number');
export const zOptionalPhone = zPhone.optional().or(z.literal(''));
export const zUrl = z.string().trim().url('Invalid URL');
export const zPhoto = z.string().trim().max(2048);
export const zName = z.string().trim().min(2, 'Too short').max(160);
export const zText = (max = 2000) => z.string().trim().max(max);
export const zStringArray = (max = 200) => z.array(z.string().trim().min(1)).max(max);
export const zIdArray = z.array(zObjectId).max(500);
export const zMoney = z.number().nonnegative().finite();
export const zRating = z.number().min(0).max(5);
export const zCurrency = z.enum(CURRENCIES);
export const zVerificationStatus = z.enum(VERIFICATION_STATUSES);
export const zIdType = z.enum(ID_TYPES);
export const zContactMethod = z.enum(CONTACT_METHODS);
export const zPaymentMethod = z.enum(PAYMENT_METHODS);
export const zDiasporaStatus = z.enum(DIASPORA_STATUSES);
export const zDate = z.coerce.date();
export const zLifecycleStatus = z.enum(['draft', 'active', 'inactive', 'suspended', 'archived']);

/** email / phone / WhatsApp / photo — required on create. */
export const contactCreate = {
  email: zEmail,
  phone: zPhone,
  WhatsApp: zOptionalPhone,
  preferredContactMethod: zContactMethod.optional(),
  profilePhoto: zPhoto.optional(),
};

export const identityCreate = {
  IDType: zIdType.optional(),
  IDNumber: z.string().trim().min(4).max(64).optional(),
  IDPhoto: zPhoto.optional(),
  nationalID: z.string().trim().min(4).max(64).optional(),
  nationalIDPhoto: zPhoto.optional(),
};

export const locationCreate = {
  nationality: z.string().trim().max(80).optional(),
  residenceCountry: z.string().trim().max(80).optional(),
  address: zText(400).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
};

export const emergencyCreate = {
  emergencyContactName: zName.optional(),
  emergencyContactPhone: zOptionalPhone,
  emergencyContactRelationship: z.string().trim().max(80).optional(),
};

export const lifecycleCreate = {
  user: zObjectId.optional(),
  status: zLifecycleStatus.optional(),
};

/**
 * Turns a create schema into an update schema: every field optional, and at
 * least one field present so `PATCH {}` is rejected rather than silently
 * touching `updatedAt`.
 */
export function toUpdateSchema<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.partial().strict().refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });
}
