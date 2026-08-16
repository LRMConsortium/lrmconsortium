/**
 * Request shapes for tenancy applications.
 *
 * `.strict()` throughout, and what is **absent** matters more than what is
 * present. No schema here accepts `status`, `assessment`, `decision`, `score`
 * or `lease`. A client that could name its own assessment could recommend
 * itself; a client that could name its own decision would not need LRMC.
 *
 * The eligibility inputs are likewise not accepted from the applicant. An
 * applicant states their income and household; whether that income is
 * *evidenced*, what their payment history is, and whether a dispute is open
 * are things LRMC looks up, never things it is told.
 */

import { z } from 'zod';
import { APPLICATION_STATUSES } from './applicationLifecycle.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const createApplicationSchema = z
  .object({
    property: objectId,
    /** What the applicant offers. The listing's asking rent may differ. */
    proposedRent: z.number().nonnegative().finite().optional(),
    proposedStart: z.coerce.date().optional(),
    termMonths: z.number().int().min(1).max(120).optional(),
    householdSize: z.number().int().min(1).max(30).optional(),
    /** Declared, not evidenced. LRMC decides what counts as evidence. */
    monthlyIncome: z.number().nonnegative().finite().optional(),
    message: z.string().trim().max(2000).optional(),
    /** Storage keys, never URLs — the same rule the document module follows. */
    documentKeys: z.array(z.string().trim().min(1).max(400)).max(20).optional(),
  })
  .strict();

/** The applicant may improve their own submission while it is still open. */
export const updateApplicationSchema = createApplicationSchema
  .partial()
  .omit({ property: true })
  .strict();

/**
 * A decision.
 *
 * `reason` is required and floored at a length that rules out "ok". The
 * lifecycle refuses a decision without one; this stops it arriving as a space.
 */
export const decideApplicationSchema = z
  .object({
    reason: z.string().trim().min(4).max(2000),
  })
  .strict();

/** Asking the applicant for something, which moves the clock onto them. */
export const requestFromApplicantSchema = z
  .object({
    outstandingRequest: z.string().trim().min(4).max(600),
  })
  .strict();

export const applicationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(APPLICATION_STATUSES).optional(),
    property: objectId.optional(),
    open: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    recommendation: z.enum(['recommend', 'review', 'decline']).optional(),
  })
  .strict();
