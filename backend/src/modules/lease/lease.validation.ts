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
