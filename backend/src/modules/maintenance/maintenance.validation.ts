import { z } from 'zod';
import { VENDOR_SERVICE_TYPES } from '../vendor/vendor.model.js';
import {
  lifecycleCreate,
  toUpdateSchema,
  zCurrency,
  zDate,
  zMoney,
  zObjectId,
  zPhoto,
  zText,
} from '../../shared/validationFragments.js';
import { MAINTENANCE_PRIORITIES, MAINTENANCE_STATUSES } from './maintenance.model.js';

const maintenanceFields = z
  .object({
    property: zObjectId,
    title: z.string().trim().min(3).max(240),
    description: zText(5000).optional(),
    serviceType: z.enum(VENDOR_SERVICE_TYPES),
    priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
    assignedVendor: zObjectId.optional(),
    assignedCoordinator: zObjectId.optional(),
    quotedAmount: zMoney.optional(),
    approvedAmount: zMoney.optional(),
    finalAmount: zMoney.optional(),
    currency: zCurrency.optional(),
    photosBefore: z.array(zPhoto).max(20).optional(),
    photosAfter: z.array(zPhoto).max(20).optional(),
    scheduledFor: zDate.optional(),
    slaHours: z.number().int().min(1).max(2160).optional(),
    tenantRating: z.number().int().min(1).max(5).optional(),
    ...lifecycleCreate,
    status: z.enum(MAINTENANCE_STATUSES).optional(),
  })
  .strict();

export const createMaintenanceRequestSchema = maintenanceFields;
export const updateMaintenanceRequestSchema = toUpdateSchema(maintenanceFields);

export const runSlaEscalationSchema = z
  .object({
    asOf: zDate.optional(),
    dryRun: z.boolean().optional(),
    limit: z.number().int().min(1).max(2000).optional(),
  })
  .strict();

export const assignVendorSchema = z
  .object({
    vendorId: zObjectId,
    scheduledFor: zDate.optional(),
    note: zText(1000).optional(),
  })
  .strict();

/* ═══════════════════════════════════════════════════════════════════════════
 * The member-portal surface
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Raising a request from inside a tenancy.
 *
 * Deliberately much smaller than `createMaintenanceRequestSchema`. A tenant
 * standing in front of a broken tap can say where, what and how bad; they
 * cannot say which vendor should hold it, what it will cost, or how many hours
 * LRMC has to respond. Every one of those is absent here and derived on the
 * server — a form that asked for them would either not be filled in or would be
 * filled in with guesses that then look like commitments.
 *
 * `.strict()`, so `slaHours: 1` or `assignedVendor: <my cousin>` is a refusal
 * rather than a silent drop. A field ignored and a field honoured look the same
 * from the client.
 */
export const raiseMaintenanceSchema = z
  .object({
    property: zObjectId,
    title: z.string().trim().min(3).max(240),
    description: zText(5000).optional(),
    serviceType: z.enum(VENDOR_SERVICE_TYPES),
    /** How urgent the person reporting it thinks it is. Triage may change it. */
    priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
    /** Photographs of the problem, by storage key. Never a URL — see the
     *  document engine: an address a client supplies is an address a client
     *  controls. */
    photosBefore: z.array(zPhoto).max(8).optional(),
  })
  .strict();

/**
 * Moving a request along.
 *
 * Three fields, and the third is the one that matters. `note` is optional here
 * because whether it is required depends on *where the request is going* —
 * cancelling and parking need an explanation, starting work does not — and that
 * is a lifecycle rule, not a shape rule. `maintenanceLifecycle.updateProblems`
 * decides, so the requirement is stated once and applies to every route that
 * moves a request rather than only to this one.
 */
export const updateMaintenanceStatusSchema = z
  .object({
    request: zObjectId,
    status: z.enum(MAINTENANCE_STATUSES),
    note: zText(1000).optional(),
  })
  .strict();
