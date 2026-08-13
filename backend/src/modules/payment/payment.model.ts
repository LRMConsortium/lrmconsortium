import { Schema, model, type Types } from 'mongoose';
import {
  CURRENCIES,
  PAYMENT_METHODS,
  baseSchemaOptions,
  lifecycleFields,
  type LifecycleShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';

export const PAYMENT_KINDS = [
  'rent',
  'deposit',
  'ride',
  'driverPayout',
  'landlordPayout',
  'adSpend',
  'vendorInvoice',
  'managementFee',
  'refund',
] as const;

/* The vocabulary is canonical in config/lifecycles.ts, which is Mongoose-free
 * and so can be asserted against without a database. Re-exported here because
 * callers reasonably look for a collection's statuses next to its schema. */
import { PAYMENT_STATUSES } from '../../config/lifecycles.js';
export { PAYMENT_STATUSES };

/**
 * One ledger for every movement of money on the platform — rent, ride fares,
 * driver payouts, ad spend, vendor invoices.
 *
 * A single collection rather than one per service line, because the questions
 * finance actually asks ("what did this person pay or receive this month")
 * cross the boundaries. `kind` plus a polymorphic `subject` keeps them
 * distinguishable without four near-identical schemas.
 */
export interface IPayment extends Omit<LifecycleShape, 'status'>, TimestampShape {
  _id: Types.ObjectId;
  reference: string;
  kind: (typeof PAYMENT_KINDS)[number];
  /** Which collection `subject` points at. */
  subjectKind?: 'Lease' | 'Ride' | 'Ad' | 'MaintenanceRequest';
  subject?: Types.ObjectId;

  /** Who parted with the money, and who received it. Either may be the platform. */
  payer?: Types.ObjectId;
  payerKind?: string;
  payee?: Types.ObjectId;
  payeeKind?: string;

  amount: number;
  currency: (typeof CURRENCIES)[number];
  method: (typeof PAYMENT_METHODS)[number];
  /** Platform commission withheld, where applicable. */
  platformFee: number;
  netAmount: number;

  providerReference?: string;
  providerName?: string;
  /**
   * Who wrote this row down by hand, if anybody did.
   *
   * Absent on a payment the platform generated — a rent instalment from the
   * lease schedule, a fare from a completed ride. Present, and permanent, on a
   * receipt a coordinator entered for cash taken in a compound. A hand-written
   * money record with no named author is not evidence of anything, and this is
   * also what lets a coordinator read back what they recorded without being
   * given the rest of somebody's finances.
   */
  recordedBy?: Types.ObjectId;
  paidAt?: Date;
  failureReason?: string;
  receiptUrl?: string;
  notes?: string;

  status: (typeof PAYMENT_STATUSES)[number];
}

const paymentSchema = new Schema<IPayment>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },
    kind: { type: String, enum: PAYMENT_KINDS, required: true, index: true },
    subjectKind: { type: String, enum: ['Lease', 'Ride', 'Ad', 'MaintenanceRequest'] },
    subject: { type: Schema.Types.ObjectId, refPath: 'subjectKind', index: true },

    payer: { type: Schema.Types.ObjectId, index: true },
    payerKind: { type: String },
    payee: { type: Schema.Types.ObjectId, index: true },
    payeeKind: { type: String },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GMD' },
    method: { type: String, enum: PAYMENT_METHODS, default: 'mobileMoney' },
    platformFee: { type: Number, min: 0, default: 0 },
    netAmount: { type: Number, min: 0, default: 0 },

    /** Never logged, never returned — it identifies the payment instrument. */
    providerReference: { type: String, trim: true, select: false },
    providerName: { type: String, trim: true },
    recordedBy: { type: Schema.Types.ObjectId, index: true },
    paidAt: { type: Date, index: true },
    failureReason: { type: String, trim: true },
    receiptUrl: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 2000 },

    status: { type: String, enum: PAYMENT_STATUSES, default: 'pending', index: true },
    ...lifecycleFields,
  },
  baseSchemaOptions('payments'),
);

paymentSchema.index({ reference: 1 }, { unique: true });
paymentSchema.index({ kind: 1, status: 1, paidAt: -1 });
paymentSchema.index({ payer: 1, paidAt: -1 });
paymentSchema.index({ payee: 1, paidAt: -1 });

paymentSchema.pre('validate', function derive(next) {
  if (!this.reference) {
    const suffix = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
    this.reference = `PAY-${suffix}`;
  }
  if (this.netAmount === undefined || this.netAmount === 0) {
    this.netAmount = Math.max(0, (this.amount ?? 0) - (this.platformFee ?? 0));
  }
  next();
});

export const Payment = model<IPayment>('Payment', paymentSchema);
