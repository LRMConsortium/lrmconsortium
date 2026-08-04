import { z } from 'zod';
import {
  zEmail,
  zName,
  zOptionalPhone,
  zPhone,
} from '../../shared/validationFragments.js';

/** Roles a person may claim for themselves. Everything else is appointed. */
export const SELF_REGISTERABLE_ROLES = [
  'tenant',
  'landlord',
  'rider',
  'driver',
  'vendor',
  'advertiser',
  'airbnbHost',
  'hotelManager',
  'resortManager',
  'rentalCarCompany',
  'publicUser',
] as const;

const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Password must contain upper case, lower case and a digit',
  });

export const registerSchema = z
  .object({
    fullName: zName,
    email: zEmail,
    phone: zPhone,
    WhatsApp: zOptionalPhone,
    password,
    role: z.enum(SELF_REGISTERABLE_ROLES),
    /** Required for organisational roles. */
    businessName: z.string().trim().min(2).max(200).optional(),
    region: z.string().trim().max(120).optional(),
    /** Ususu drivers must declare a vehicle type at signup. */
    vehicleType: z.string().trim().max(40).optional(),
    /** Vendors must declare a service type at signup. */
    serviceType: z.string().trim().max(60).optional(),
    /** Advertisers must declare a business type at signup. */
    businessType: z.string().trim().max(60).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: zEmail,
    password: z.string().min(1).max(200),
  })
  .strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(10) }).strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: password,
  })
  .strict();

export const assignRoleSchema = z
  .object({
    roles: z.array(z.string()).min(1).max(6),
    primaryRole: z.string().optional(),
    regions: z.array(z.string().trim().max(120)).max(100).optional(),
  })
  .strict();
