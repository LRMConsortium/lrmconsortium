/**
 * Request shapes for the evidence surface.
 *
 * `.strict()` throughout, and what is absent matters: no schema here accepts a
 * `subject` on a *response*, a `status`, or a computed field. A referee cannot
 * name the person they are scoring; a person cannot resolve their own dispute
 * by posting a status; nobody sends `groupHealth`, which is derived from the
 * ledger and never stored.
 */
import { z } from 'zod';
import { DISPUTE_KINDS } from './evidence.model.js';
import { MAX_DISPUTE_SEVERITY } from '../../config/evidence.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const requestReferenceSchema = z
  .object({
    subject: objectId,
    refereeName: z.string().trim().min(2).max(160),
    refereeEmail: z.string().email().optional(),
    refereePhone: z.string().trim().max(30).optional(),
    relationship: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((v) => v.refereeEmail !== undefined || v.refereePhone !== undefined, {
    path: ['refereeEmail'],
    message: 'A referee needs an email address or a telephone number to be reachable.',
  });

export const respondToReferenceSchema = z
  .object({
    reference: objectId,
    /** 0–100. A referee who will not score is a `declined`, not a zero. */
    score: z.number().int().min(0).max(100),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();

export const openDisputeSchema = z
  .object({
    subject: objectId,
    kind: z.enum(DISPUTE_KINDS),
    severity: z.number().int().min(1).max(MAX_DISPUTE_SEVERITY),
    summary: z.string().trim().min(10).max(2000),
  })
  .strict();

export const resolveMemberDisputeSchema = z
  .object({
    resolution: z.string().trim().min(4).max(2000),
  })
  .strict();

/** `YYYY-MM`. A period is a month, and a free-form string would not dedupe. */
const period = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM');

export const ususuContributionSchema = z
  .object({
    subject: objectId,
    period,
    amount: z.number().nonnegative().finite().optional(),
    currency: z.string().trim().max(8).optional(),
    note: z.string().trim().max(600).optional(),
  })
  .strict();

export const ususuMissSchema = z
  .object({
    subject: objectId,
    period,
    note: z.string().trim().max(600).optional(),
  })
  .strict();
