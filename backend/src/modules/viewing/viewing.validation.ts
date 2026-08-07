/**
 * Request shapes for viewings.
 *
 * `.strict()` throughout. Note what is **absent**: nothing here accepts
 * `status`, `decidedBy`, `decidedAt` or `outcomeRecordedAt`. A client that
 * could name its own status could confirm its own viewing, and a client that
 * could name `outcomeRecordedAt` could record a no-show for last Tuesday.
 *
 * `localHour` is required rather than derived. The server runs in UTC and the
 * tenant is in The Gambia — the hour a person meant when they said "three
 * o'clock" is not recoverable from a UTC instant without their offset, and
 * guessing it produces a diary nobody can read back.
 */

import { z } from 'zod';
import { VIEWING_STATUSES } from './viewingRules.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const requestViewingSchema = z
  .object({
    property: objectId,
    requestedFor: z.coerce.date(),
    localHour: z.number().int().min(0).max(23),
    alternateFor: z.coerce.date().optional(),
    alternateLocalHour: z.number().int().min(0).max(23).optional(),
    note: z.string().trim().max(600).optional(),
  })
  .strict()
  .refine(
    (v) => v.alternateFor === undefined || v.alternateLocalHour !== undefined,
    {
      path: ['alternateLocalHour'],
      message: 'An alternate slot needs the hour you meant, in your own day.',
    },
  );

/** Only the tenant's own words. Everything else moves through an action route. */
export const updateViewingSchema = z
  .object({
    note: z.string().trim().max(600).optional(),
  })
  .strict();

/** Confirming, declining, cancelling and recording an outcome. */
export const viewingDecisionSchema = z
  .object({
    reason: z.string().trim().max(600).optional(),
  })
  .strict();

export const viewingOutcomeSchema = z
  .object({
    outcomeNote: z.string().trim().max(600).optional(),
  })
  .strict();

export const viewingQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(VIEWING_STATUSES).optional(),
    property: objectId.optional(),
    /** `true` narrows to requests still on somebody's list. */
    open: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();
