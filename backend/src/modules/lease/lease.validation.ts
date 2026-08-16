import { z } from 'zod';
import {
  lifecycleCreate,
  toUpdateSchema,
  zCurrency,
  zDate,
  zMoney,
  zObjectId,
  zPaymentMethod,
  zText,
} from '../../shared/validationFragments.js';
import { LEASE_STATUSES } from './lease.model.js';

const leaseFields = z
  .object({
    property: zObjectId,
    tenant: zObjectId,
    landlord: zObjectId,
    coordinator: zObjectId.optional(),
    leaseStart: zDate,
    leaseEnd: zDate,
    monthlyRent: zMoney,
    currency: zCurrency.optional(),
    paymentDayOfMonth: z.number().int().min(1).max(31).optional(),
    securityDeposit: zMoney.optional(),
    depositHeldBy: z.enum(['LRMC', 'landlord', 'escrow']).optional(),
    paymentMethod: zPaymentMethod.optional(),
    renewalOption: z.boolean().optional(),
    noticePeriodDays: z.number().int().min(0).max(365).optional(),
    documentUrl: zText(2048).optional(),
    ...lifecycleCreate,
    status: z.enum(LEASE_STATUSES).optional(),
  })
  .strict();

const windowIsSane = (v: { leaseStart?: Date; leaseEnd?: Date }): boolean =>
  !v.leaseStart || !v.leaseEnd || v.leaseEnd > v.leaseStart;

/** A lease at zero rent is a data-entry error, not a charitable tenancy. */
const rentIsPositive = (v: { monthlyRent?: number }): boolean =>
  v.monthlyRent === undefined || v.monthlyRent > 0;

export const createLeaseSchema = leaseFields
  .refine(windowIsSane, { message: 'leaseEnd must be after leaseStart', path: ['leaseEnd'] })
  .refine(rentIsPositive, { message: 'monthlyRent must be greater than zero', path: ['monthlyRent'] });

export const updateLeaseSchema = toUpdateSchema(leaseFields)
  .refine(windowIsSane, { message: 'leaseEnd must be after leaseStart', path: ['leaseEnd'] })
  .refine(rentIsPositive, { message: 'monthlyRent must be greater than zero', path: ['monthlyRent'] });

/** Recording a rent payment against a lease. */
export const recordRentPaymentSchema = z
  .object({
    amount: zMoney,
    currency: zCurrency.optional(),
    method: z
      .enum(['mobileMoney', 'bankTransfer', 'cash', 'card', 'cheque', 'crypto'])
      .optional(),
    paidAt: zDate.optional(),
    providerReference: zText(120).optional(),
    notes: zText(2000).optional(),
  })
  .strict();

/**
 * The rent reminder run.
 *
 * `asOf` exists so the job can be replayed for a date it missed, and so the
 * behaviour is testable without waiting for a calendar. `dryRun` reports what
 * would be sent and changes nothing.
 */
export const runRentRemindersSchema = z
  .object({
    asOf: zDate.optional(),
    leadDays: z.number().int().min(0).max(30).optional(),
    dryRun: z.boolean().optional(),
    limit: z.number().int().min(1).max(2000).optional(),
  })
  .strict();

/* ═══════════════════════════════════════════════════════════════════════════
 * The member-portal surface
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Drawing up a lease from inside the portal.
 *
 * Deliberately smaller than `createLeaseSchema`, which is the Back Office route
 * and accepts the full record. Note what is **absent** and cannot be supplied:
 *
 *   `landlord`   — taken from the property. A body that could name the landlord
 *                  would let somebody draw up a lease over a building they have
 *                  nothing to do with.
 *   `status`     — always `draft`. A create that could land straight in `active`
 *                  would skip the one moment either party gets to look at it.
 *   `totalPaid` /
 *   `arrears`    — rolled forward by the rent ledger, never asserted.
 *   `reference`  — derived.
 *
 * `.strict()`, so sending one is a refusal rather than a silent drop. A field
 * ignored and a field honoured look identical from a client.
 */
export const memberCreateLeaseSchema = z
  .object({
    property: zObjectId,
    /** The tenant, as a **user** id. The server joins to their profile. */
    tenant: zObjectId,
    monthlyRent: zMoney,
    currency: zCurrency.optional(),
    leaseStart: zDate,
    /**
     * Optional, and that is the point. Month-to-month is ordinary in The
     * Gambia, and a required end date forces whoever writes the lease to invent
     * one — which then looks like a commitment and eventually ends a tenancy
     * nobody meant to end.
     */
    leaseEnd: zDate.nullish(),
    paymentDayOfMonth: z.number().int().min(1).max(31).optional(),
    securityDeposit: zMoney.optional(),
  })
  .strict();

/** Activating or completing. The id, and nothing else to get wrong. */
export const leaseActionSchema = z.object({ lease: zObjectId }).strict();

/**
 * Terminating.
 *
 * `reason` is required *here* as well as in `transitionProblems`, so a caller
 * that somehow reaches the handler without the rules module still cannot end
 * somebody's tenancy anonymously. A terminated lease with no stated reason is a
 * fact about a person's housing that nobody has to defend.
 */
export const leaseTerminateSchema = z
  .object({
    lease: zObjectId,
    reason: z.string().trim().min(4).max(600),
  })
  .strict();
