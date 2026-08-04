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
