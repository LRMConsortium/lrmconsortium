import { z } from 'zod';
import { zCurrency, zDate, zMoney, zObjectId, zText } from '../../shared/validationFragments.js';
import {
  MAX_RECORDED_AMOUNT,
  RECORDABLE_KINDS,
  RECORDABLE_METHODS,
} from './paymentRules.js';

/**
 * Writing down money that changed hands in a room.
 *
 * `.strict()`, so a field the schema does not know about is a refusal rather
 * than a silent drop. That matters more here than almost anywhere else: a
 * client sending `status: 'succeeded'` or `recordedBy: <someone else>` and
 * having it quietly ignored looks identical to having it honoured, and the
 * difference is whether the ledger can be written by whoever asks.
 *
 * Note what is **absent** and cannot be supplied:
 *
 *   `status`      — always `succeeded`. Recording a payment means the money is
 *                   already in hand; a client asserting `failed` or `pending`
 *                   would be describing something this endpoint is not for.
 *   `recordedBy`  — from the token. The author of a cash receipt is not a
 *                   field somebody fills in about themselves.
 *   `reference`   — derived, so that two taps on a bad connection collide
 *                   rather than doubling a tenant's rent.
 *   `platformFee` /
 *   `netAmount`   — derived by the model. A hand-entered fee is a way to make
 *                   the ledger stop balancing.
 *
 * The enums come from `paymentRules.ts` rather than from the model's full
 * `PAYMENT_KINDS`, which is the point: the ledger has ten kinds and exactly two
 * of them may be written by hand.
 */
export const recordPaymentSchema = z
  .object({
    /** The member the money came from, as a **user** id. The ledger indexes
     *  profiles; the server does that join so the portal can speak in users. */
    payer: zObjectId,
    /** The lease the money is against, where there is one. */
    subject: zObjectId.optional(),
    subjectKind: z.enum(['Lease', 'MaintenanceRequest']).optional(),

    kind: z.enum(RECORDABLE_KINDS),
    method: z.enum(RECORDABLE_METHODS).default('cash'),

    /* Bounded here as well as in `recordingProblems`, so a caller that skips
     * the rules module still cannot enter a million-dalasi typo. */
    amount: zMoney.refine((v) => v > 0, 'Enter the amount that changed hands')
      .refine((v) => v <= MAX_RECORDED_AMOUNT,
        `A single receipt above ${MAX_RECORDED_AMOUNT.toLocaleString('en-GB')} needs Back Office to enter it`),
    currency: zCurrency.optional(),

    /** When the money changed hands, which is not when it was typed in. */
    paidAt: zDate.optional(),
    notes: zText(2000).optional(),
  })
  .strict();

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
