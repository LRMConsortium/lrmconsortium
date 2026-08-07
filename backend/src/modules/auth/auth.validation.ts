import { z } from 'zod';
import {
  zEmail,
  zName,
  zOptionalPhone,
  zPhone,
} from '../../shared/validationFragments.js';

/** Roles a person may claim for themselves. Everything else is appointed. */
// The list lives in `config/registration.ts`, which is pure — the verify
// suite must import it without pulling in Zod.
export { SELF_REGISTERABLE_ROLES, type SelfRegisterableRole } from '../../config/registration.js';
import {
  SELF_REGISTERABLE_ROLES as ROLE_LIST,
  PASSWORD_MIN_LENGTH,
  REGISTRATION_EXTRAS,
} from '../../config/registration.js';

/** Human wording for the extras, so the refusal names the thing on screen. */
const EXTRA_LABELS: Record<string, string> = {
  businessName: 'Business name',
  businessType: 'Business type',
  vehicleType: 'Vehicle type',
  serviceType: 'Service type',
};

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
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
    role: z.enum(ROLE_LIST),
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
  .strict()
  /**
   * The extras are optional *in the shape* because which ones apply depends on
   * the role, and there is one shape for thirteen roles. They are not optional
   * in fact: `REGISTRATION_EXTRAS` says what each role must declare, and this
   * is where that table is enforced.
   *
   * Without it the table would only ever have shaped the form, and a driver
   * posting directly to the API could arrive with no vehicle — which the
   * dispatch side has no way to handle and no way to have prevented.
   *
   * The issue is raised on the field itself, so the browser can put the
   * message beside the input rather than in a banner the person has to
   * translate back into "which box did I miss".
   */
  .superRefine((value, ctx) => {
    const required = REGISTRATION_EXTRAS[value.role] ?? [];
    for (const field of required) {
      const supplied = (value as Record<string, unknown>)[field];
      if (typeof supplied === 'string' && supplied.trim().length > 0) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${EXTRA_LABELS[field] ?? field} is required for ${value.role}`,
      });
    }
  });

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
