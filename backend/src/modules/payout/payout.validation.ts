import { z } from 'zod';
import { zCurrency, zDate, zText } from '../../shared/validationFragments.js';
import { PAYOUT_KINDS } from '../payment/ledger.js';

/**
 * Building a batch is a *query*, not a list of lines.
 *
 * The client says "driver payouts, GHS, for last week"; the server reads the
 * ledger and computes the lines. A client that could post its own line amounts
 * could pay itself, which is why the request body has no `lines` field.
 */
export const buildPayoutBatchSchema = z
  .object({
    kind: z.enum(PAYOUT_KINDS),
    currency: zCurrency.optional(),
    periodStart: zDate.optional(),
    periodEnd: zDate.optional(),
    /** Cap on ledger rows examined, so a first-ever run cannot sweep everything. */
    maxRows: z.number().int().min(1).max(5000).optional(),
    notes: zText(2000).optional(),
  })
  .strict()
  .refine(
    (v) => !v.periodStart || !v.periodEnd || v.periodEnd >= v.periodStart,
    { message: 'periodEnd must be on or after periodStart', path: ['periodEnd'] },
  );

export const settlePayoutBatchSchema = z
  .object({
    /** Refuses unless it matches the stored total — guards a stale approval screen. */
    confirmNet: z.number().nonnegative().finite(),
    notes: zText(2000).optional(),
  })
  .strict();

export const cancelPayoutBatchSchema = z
  .object({
    reason: zText(1000),
  })
  .strict();
