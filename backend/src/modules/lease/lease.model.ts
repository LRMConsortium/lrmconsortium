import { Schema, model, type Types } from 'mongoose';
import {
  CURRENCIES,
  PAYMENT_METHODS,
  baseSchemaOptions,
  lifecycleFields,
  type LifecycleShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';

export const LEASE_STATUSES = [
  'draft',
  'pendingSignature',
  'active',
  'inArrears',
  'expiring',
  'ended',
  'terminated',
] as const;

/**
 * A lease binds a tenant to a property for a term, at a rent.
 *
 * Deliberately a separate collection rather than fields on the tenant profile:
 * a tenant has a *history* of leases, a property has a succession of them, and
 * the rent ledger hangs off the lease rather than off either party. The lease
 * fields already on `TenantProfile` remain as the current-tenancy summary; this
 * is the record of record.
 */
export interface ILease extends Omit<LifecycleShape, 'status'>, TimestampShape {
  _id: Types.ObjectId;
  reference: string;
  property: Types.ObjectId;
  tenant: Types.ObjectId;
  landlord: Types.ObjectId;
  coordinator?: Types.ObjectId;

  leaseStart: Date;
  leaseEnd: Date;
  monthlyRent: number;
  currency: (typeof CURRENCIES)[number];
  paymentDayOfMonth: number;
  securityDeposit?: number;
  depositHeldBy?: 'LRMC' | 'landlord' | 'escrow';

  paymentMethod?: (typeof PAYMENT_METHODS)[number];
  /** Rolled forward as payments are recorded. */
  totalPaid: number;
  arrearsAmount: number;
  lastPaymentAt?: Date;
  nextDueDate?: Date;

  renewalOption: boolean;
  noticePeriodDays: number;
  documentUrl?: string;
  signedByTenantAt?: Date;
  signedByLandlordAt?: Date;
  terminationReason?: string;

  status: (typeof LEASE_STATUSES)[number];
}

const leaseSchema = new Schema<ILease>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },
    property: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    tenant: { type: Schema.Types.ObjectId, ref: 'TenantProfile', required: true, index: true },
    landlord: { type: Schema.Types.ObjectId, ref: 'LandlordProfile', required: true, index: true },
    coordinator: { type: Schema.Types.ObjectId, ref: 'CoordinatorProfile', index: true },

    leaseStart: { type: Date, required: true },
    leaseEnd: { type: Date, required: true, index: true },
    monthlyRent: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GHS' },
    paymentDayOfMonth: { type: Number, min: 1, max: 31, default: 1 },
    securityDeposit: { type: Number, min: 0 },
    depositHeldBy: { type: String, enum: ['LRMC', 'landlord', 'escrow'], default: 'LRMC' },

    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'mobileMoney' },
    totalPaid: { type: Number, min: 0, default: 0 },
    arrearsAmount: { type: Number, min: 0, default: 0 },
    lastPaymentAt: { type: Date },
    nextDueDate: { type: Date, index: true },

    renewalOption: { type: Boolean, default: true },
    noticePeriodDays: { type: Number, min: 0, default: 30 },
    documentUrl: { type: String, trim: true },
    signedByTenantAt: { type: Date },
    signedByLandlordAt: { type: Date },
    terminationReason: { type: String, trim: true },

    status: { type: String, enum: LEASE_STATUSES, default: 'draft', index: true },
    ...lifecycleFields,
  },
  baseSchemaOptions('leases'),
);

leaseSchema.index({ reference: 1 }, { unique: true });
leaseSchema.index({ tenant: 1, status: 1 });
leaseSchema.index({ landlord: 1, status: 1 });
leaseSchema.index({ status: 1, nextDueDate: 1 });

leaseSchema.pre('validate', function ensureReferenceAndWindow(next) {
  if (this.leaseEnd && this.leaseStart && this.leaseEnd <= this.leaseStart) {
    return next(new Error('leaseEnd must be after leaseStart'));
  }
  if (!this.reference) {
    const suffix = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
    this.reference = `LSE-${suffix}`;
  }
  next();
});

leaseSchema.virtual('daysRemaining').get(function daysRemaining() {
  if (!this.leaseEnd) return null;
  return Math.ceil((this.leaseEnd.getTime() - Date.now()) / 86_400_000);
});

leaseSchema.virtual('isInArrears').get(function isInArrears() {
  return (this.arrearsAmount ?? 0) > 0;
});

export const Lease = model<ILease>('Lease', leaseSchema);
