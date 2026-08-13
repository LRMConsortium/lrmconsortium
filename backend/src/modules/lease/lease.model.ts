import { Schema, model, type Types } from 'mongoose';
import {
  CURRENCIES,
  PAYMENT_METHODS,
  baseSchemaOptions,
  lifecycleFields,
  type LifecycleShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';

/* Canonical in config/lifecycles.ts, which is Mongoose-free and so assertable
 * without a database. Re-exported because callers reasonably look for a
 * collection's statuses next to its schema. */
import { LEASE_STATUSES } from '../../config/lifecycles.js';
export { LEASE_STATUSES };

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
  /**
   * When the term runs out, or `null` for an open-ended tenancy.
   *
   * Nullable because month-to-month is ordinary in The Gambia and a required
   * end date would force whoever wrote the lease to invent one — which then
   * looks like a commitment, drives `expiring`, and eventually ends a tenancy
   * nobody meant to end.
   */
  leaseEnd?: Date | null;
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
  /**
   * When the tenancy actually stopped.
   *
   * Distinct from `leaseEnd`, which is when the term was *meant* to run out. A
   * lease terminated in March has a `leaseEnd` in December, and measuring
   * tenancy length from the second would credit somebody with nine months they
   * did not live there.
   */
  closedAt?: Date | null;

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
    leaseEnd: { type: Date, default: null, index: true },
    monthlyRent: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GMD' },
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
    closedAt: { type: Date, default: null, index: true },

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
  /* An open-ended lease has no end to compare against; only a *stated* end
   * that lands before the start is wrong. */
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
