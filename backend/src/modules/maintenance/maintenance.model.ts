import { Schema, model, type Types } from 'mongoose';
import { VENDOR_SERVICE_TYPES } from '../vendor/vendor.model.js';
import {
  CURRENCIES,
  baseSchemaOptions,
  lifecycleFields,
  type LifecycleShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';

export const MAINTENANCE_STATUSES = [
  'open',
  'triaged',
  'assigned',
  'quoted',
  'approved',
  'inProgress',
  'onHold',
  'completed',
  'verified',
  'cancelled',
] as const;

export const MAINTENANCE_PRIORITIES = ['low', 'normal', 'high', 'emergency'] as const;

/**
 * A work order against a property.
 *
 * Raised by a tenant, a coordinator or a commercial client; triaged by Back
 * Office; assigned to a vendor; approved for spend by whoever owns the property.
 * `statusHistory` is append-only because "who moved this to approved, and when"
 * is the question that gets asked after a disputed invoice.
 */
export interface IMaintenanceRequest extends Omit<LifecycleShape, 'status'>, TimestampShape {
  _id: Types.ObjectId;
  reference: string;
  property: Types.ObjectId;
  /** Who raised it. Polymorphic — tenant, coordinator, host, hotel, resort. */
  raisedBy?: Types.ObjectId;
  raisedByKind?: string;

  title: string;
  description?: string;
  serviceType: (typeof VENDOR_SERVICE_TYPES)[number];
  priority: (typeof MAINTENANCE_PRIORITIES)[number];

  assignedVendor?: Types.ObjectId;
  assignedCoordinator?: Types.ObjectId;
  assignedAt?: Date;

  quotedAmount?: number;
  approvedAmount?: number;
  finalAmount?: number;
  currency: (typeof CURRENCIES)[number];
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;

  photosBefore: string[];
  photosAfter: string[];
  scheduledFor?: Date;
  startedAt?: Date;
  completedAt?: Date;
  verifiedAt?: Date;
  /** Hours from creation to completion, stamped on completion. */
  resolutionHours?: number;
  slaHours: number;
  tenantRating?: number;

  statusHistory: { status: string; at: Date; by?: Types.ObjectId; note?: string }[];
  status: (typeof MAINTENANCE_STATUSES)[number];
}

const statusEntrySchema = new Schema(
  {
    status: { type: String, enum: MAINTENANCE_STATUSES, required: true },
    at: { type: Date, required: true, default: () => new Date() },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false },
);

const maintenanceRequestSchema = new Schema<IMaintenanceRequest>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },
    property: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    raisedBy: { type: Schema.Types.ObjectId, index: true },
    raisedByKind: { type: String },

    title: { type: String, required: true, trim: true, maxlength: 240 },
    description: { type: String, trim: true, maxlength: 5000 },
    serviceType: { type: String, enum: VENDOR_SERVICE_TYPES, required: true, index: true },
    priority: { type: String, enum: MAINTENANCE_PRIORITIES, default: 'normal', index: true },

    assignedVendor: { type: Schema.Types.ObjectId, ref: 'VendorProfile', index: true },
    assignedCoordinator: { type: Schema.Types.ObjectId, ref: 'CoordinatorProfile' },
    assignedAt: { type: Date },

    quotedAmount: { type: Number, min: 0 },
    approvedAmount: { type: Number, min: 0 },
    finalAmount: { type: Number, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GHS' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },

    photosBefore: { type: [String], default: [] },
    photosAfter: { type: [String], default: [] },
    scheduledFor: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    verifiedAt: { type: Date },
    resolutionHours: { type: Number, min: 0 },
    slaHours: { type: Number, min: 1, default: 72 },
    tenantRating: { type: Number, min: 1, max: 5 },

    statusHistory: { type: [statusEntrySchema], default: [] },
    status: { type: String, enum: MAINTENANCE_STATUSES, default: 'open', index: true },
    ...lifecycleFields,
  },
  baseSchemaOptions('maintenance_requests'),
);

maintenanceRequestSchema.index({ reference: 1 }, { unique: true });
maintenanceRequestSchema.index({ property: 1, status: 1, createdAt: -1 });
maintenanceRequestSchema.index({ assignedVendor: 1, status: 1 });
maintenanceRequestSchema.index({ status: 1, priority: 1, createdAt: 1 });

maintenanceRequestSchema.pre('validate', function seed(next) {
  if (!this.reference) {
    const suffix = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
    this.reference = `MNT-${suffix}`;
  }
  if (this.isNew && this.statusHistory.length === 0) {
    this.statusHistory.push({ status: this.status ?? 'open', at: new Date() });
  }
  next();
});

/** An emergency past its SLA is the thing a Back Office dashboard sorts on. */
maintenanceRequestSchema.virtual('isOverdue').get(function isOverdue() {
  if (this.completedAt) return false;
  const created = (this as unknown as { createdAt?: Date }).createdAt;
  if (!created) return false;
  return Date.now() - created.getTime() > (this.slaHours ?? 72) * 3_600_000;
});

export const MaintenanceRequest = model<IMaintenanceRequest>(
  'MaintenanceRequest',
  maintenanceRequestSchema,
);
