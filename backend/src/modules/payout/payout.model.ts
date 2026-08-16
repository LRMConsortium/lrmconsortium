import { Schema, model, type Types } from 'mongoose';
import {
  CURRENCIES,
  baseSchemaOptions,
  lifecycleFields,
  type LifecycleShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';
import { PAYOUT_KINDS } from '../payment/ledger.js';

export const PAYOUT_BATCH_STATUSES = [
  'draft',
  'approved',
  'settling',
  'settled',
  'partiallySettled',
  'failed',
  'cancelled',
] as const;

/**
 * A batch of outbound transfers, built from settled ledger rows.
 *
 * Separate from `Payment` on purpose. The ledger records money that *has*
 * moved; a batch is an instruction to move some. Keeping them apart is what
 * lets `GET /payments` stay read-only over HTTP while payouts still have a
 * create route — and it means a failed transfer does not leave a phantom row
 * in the ledger implying a landlord was paid when they were not.
 *
 * `lines` are embedded rather than referenced: a batch is settled or re-run as
 * a unit, and the line totals must be exactly what was approved, frozen at
 * build time, not recomputed later from rows that may since have been refunded.
 */
export interface IPayoutLine {
  payee: Types.ObjectId;
  payeeKind: string;
  currency: (typeof CURRENCIES)[number];
  sourcePayments: Types.ObjectId[];
  gross: number;
  platformFee: number;
  net: number;
  /** Filled by the money provider when the line is settled. */
  transferStatus: 'pending' | 'processing' | 'settled' | 'failed' | 'reversed';
  providerReference?: string;
  failureReason?: string;
  settledAt?: Date;
}

export interface IPayoutBatch extends Omit<LifecycleShape, 'status'>, TimestampShape {
  _id: Types.ObjectId;
  reference: string;
  kind: (typeof PAYOUT_KINDS)[number];
  currency: (typeof CURRENCIES)[number];

  /** The ledger window this batch was built from. */
  periodStart?: Date;
  periodEnd?: Date;

  lines: IPayoutLine[];
  lineCount: number;
  gross: number;
  platformFee: number;
  net: number;

  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  settledAt?: Date;
  /** Rows the builder skipped, kept so the omission is answerable. */
  skipped: { payment?: Types.ObjectId; reason: string }[];
  notes?: string;

  status: (typeof PAYOUT_BATCH_STATUSES)[number];
}

const payoutLineSchema = new Schema<IPayoutLine>(
  {
    payee: { type: Schema.Types.ObjectId, required: true, index: true },
    payeeKind: { type: String, required: true, trim: true },
    currency: { type: String, enum: CURRENCIES, default: 'GMD' },
    sourcePayments: [{ type: Schema.Types.ObjectId, ref: 'Payment' }],
    gross: { type: Number, required: true, min: 0 },
    platformFee: { type: Number, min: 0, default: 0 },
    net: { type: Number, required: true, min: 0 },
    transferStatus: {
      type: String,
      enum: ['pending', 'processing', 'settled', 'failed', 'reversed'],
      default: 'pending',
    },
    providerReference: { type: String, trim: true },
    failureReason: { type: String, trim: true },
    settledAt: { type: Date },
  },
  { _id: true },
);

const payoutBatchSchema = new Schema<IPayoutBatch>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },
    kind: { type: String, enum: PAYOUT_KINDS, required: true, index: true },
    currency: { type: String, enum: CURRENCIES, default: 'GMD', index: true },

    periodStart: { type: Date },
    periodEnd: { type: Date, index: true },

    lines: { type: [payoutLineSchema], default: [] },
    lineCount: { type: Number, min: 0, default: 0 },
    gross: { type: Number, min: 0, default: 0 },
    platformFee: { type: Number, min: 0, default: 0 },
    net: { type: Number, min: 0, default: 0 },

    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    settledAt: { type: Date },
    skipped: [
      {
        payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
        reason: { type: String, trim: true },
        _id: false,
      },
    ],
    notes: { type: String, trim: true, maxlength: 2000 },

    status: { type: String, enum: PAYOUT_BATCH_STATUSES, default: 'draft', index: true },
    ...lifecycleFields,
  },
  baseSchemaOptions('payoutbatches'),
);

payoutBatchSchema.index({ reference: 1 }, { unique: true });
payoutBatchSchema.index({ kind: 1, status: 1, createdAt: -1 });

payoutBatchSchema.pre('validate', function derive(next) {
  if (!this.reference) {
    const suffix = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
    this.reference = `PYT-${suffix}`;
  }
  this.lineCount = this.lines?.length ?? 0;
  next();
});

/** How far through settlement the batch is, for a progress bar. */
payoutBatchSchema.virtual('settledLineCount').get(function settledLineCount(this: IPayoutBatch) {
  return this.lines.filter((l) => l.transferStatus === 'settled').length;
});

export const PayoutBatch = model<IPayoutBatch>('PayoutBatch', payoutBatchSchema);
