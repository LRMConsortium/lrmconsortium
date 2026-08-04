import { z } from 'zod';
import { zText } from '../../shared/validationFragments.js';
import {
  FAC_CODE_LENGTH,
  FAC_ROTATION_DAYS,
  ROTATION_TRIGGERS,
} from './facRules.js';

/** Exactly six digits. Nothing is trimmed or coerced — a code with a space in it is wrong. */
export const zFacCode = z
  .string()
  .regex(new RegExp(`^\\d{${FAC_CODE_LENGTH}}$`), `must be exactly ${FAC_CODE_LENGTH} digits`);

/**
 * Issuing a code.
 *
 * The body cannot contain a code. The server generates it from a CSPRNG and
 * rejection-samples against the weakness rules — a founder allowed to *choose*
 * six digits will choose their birthday, and the weakness check would then be
 * a suggestion rather than a guarantee.
 */
export const issueFacCodeSchema = z
  .object({
    trigger: z.enum(ROTATION_TRIGGERS).optional(),
    rotationDays: z.number().int().min(1).max(365).optional(),
    label: zText(120).optional(),
    reason: zText(1000).optional(),
  })
  .strict()
  .refine((v) => v.trigger !== 'compromise' || Boolean(v.reason?.trim()), {
    message: 'a compromise rotation must say what happened',
    path: ['reason'],
  });

export const verifyFacCodeSchema = z
  .object({
    code: zFacCode,
  })
  .strict();

export const revokeFacCodeSchema = z
  .object({
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

export const facResetRequestSchema = z
  .object({
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

export const facAttemptQuery = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sort: z.string().trim().max(60).optional(),
    result: z.enum(['pass', 'fail', 'blocked', 'cleared']).optional(),
    generation: z.coerce.number().int().min(1).optional(),
  })
  .strict();

export const facCodeQuery = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sort: z.string().trim().max(60).optional(),
    status: z.enum(['active', 'expired', 'revoked', 'superseded']).optional(),
  })
  .strict();

export const governanceQuery = z
  .object({
    tier: z.enum(['founders', 'hq', 'staff', 'membership']).optional(),
  })
  .strict();

/**
 * Lifting another founder's lockout.
 *
 * The reason is required, and long enough to have to say something. An optional
 * free-text field on a security override is an optional field: it is left empty
 * every time, and six months later nobody can reconstruct why the highest
 * authority on the platform was let back in.
 */
export const clearLockoutSchema = z
  .object({
    reason: z.string().trim().min(10, 'Say why — at least a sentence').max(500),
  })
  .strict();

export const DEFAULT_ROTATION_DAYS = FAC_ROTATION_DAYS;
