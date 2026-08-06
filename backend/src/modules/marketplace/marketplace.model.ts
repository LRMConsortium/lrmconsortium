/**
 * Marketplace collections: merchants, customers, listings, orders.
 *
 * Four collections and one shape worth pointing at before anything else — the
 * **order line**. A line copies the listing's title and price onto itself at
 * the moment of ordering rather than referencing them. A merchant who raises
 * their price on Tuesday must not retroactively change what a buyer agreed to
 * pay on Friday, and a listing that is later archived must still be legible on
 * the receipt that sold it.
 */

import { Schema, model, type Types } from 'mongoose';
import {
  CURRENCIES,
  baseSchemaOptions,
  contactFields,
  lifecycleFields,
  locationFields,
  ratingFields,
  verificationFields,
  type ContactShape,
  type LifecycleShape,
  type LocationShape,
  type RatingShape,
  type TimestampShape,
  type VerificationShape,
} from '../../shared/schemaFragments.js';
import { LISTING_KINDS, LISTING_STATUSES } from './listingRules.js';
import { ORDER_STATUSES } from './orderLifecycle.js';
import { DEFAULT_MARKETPLACE_COMMISSION_PERCENT } from './orderMath.js';

export const MERCHANT_CATEGORIES = [
  'homeGoods',
  'buildingMaterials',
  'furnishing',
  'appliances',
  'cleaning',
  'security',
  'landscaping',
  'professionalServices',
  'logistics',
  'other',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Merchant — the trading account
// ─────────────────────────────────────────────────────────────────────────────

export interface IMerchantProfile
  extends ContactShape,
    LocationShape,
    VerificationShape,
    LifecycleShape,
    RatingShape,
    TimestampShape {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  tradingName: string;
  category: (typeof MERCHANT_CATEGORIES)[number];
  registrationNumber?: string;
  /** People who may sell for this account. */
  sellers: Types.ObjectId[];
  /**
   * LRMC's cut, per merchant.
   *
   * Held on the account rather than read from a global constant, because a
   * negotiated rate for a large merchant must not silently change when the
   * platform default moves. Absent means "use the default at time of order".
   */
  commissionPercent?: number;
  payoutAccountRef?: string;
  currency: (typeof CURRENCIES)[number];
  totalOrders: number;
  totalSales: number;
}

const merchantSchema = new Schema<IMerchantProfile>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    tradingName: { type: String, required: true, trim: true, maxlength: 160, index: true },
    category: { type: String, enum: MERCHANT_CATEGORIES, required: true, index: true },
    registrationNumber: { type: String, trim: true, maxlength: 60 },
    sellers: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
    commissionPercent: { type: Number, min: 0, max: 100 },
    // A reference held by the payment provider, never card or account digits.
    payoutAccountRef: { type: String, trim: true, maxlength: 120 },
    currency: { type: String, enum: CURRENCIES, default: 'GMD' },
    totalOrders: { type: Number, default: 0, min: 0 },
    totalSales: { type: Number, default: 0, min: 0 },
    ...contactFields,
    ...locationFields,
    ...verificationFields,
    ...lifecycleFields,
    ...ratingFields,
  },
  { ...baseSchemaOptions('merchantprofiles'), timestamps: true },
);

merchantSchema.index({ tradingName: 'text', email: 'text' });

export const MerchantProfile = model<IMerchantProfile>('MerchantProfile', merchantSchema);

// ─────────────────────────────────────────────────────────────────────────────
// Customer — the buying account
// ─────────────────────────────────────────────────────────────────────────────

export interface ICustomerProfile
  extends ContactShape,
    LocationShape,
    VerificationShape,
    LifecycleShape,
    TimestampShape {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  accountName: string;
  /** People who may purchase against this account. */
  buyers: Types.ObjectId[];
  /**
   * A ceiling on what any one buyer may spend without the account owner.
   *
   * Absent means no ceiling. Present, it is enforced at order placement — the
   * point of naming buyers separately from the account is that some of them
   * should not be able to spend without limit.
   */
  buyerOrderLimit?: number;
  currency: (typeof CURRENCIES)[number];
  totalOrders: number;
  totalSpend: number;
}

const customerSchema = new Schema<ICustomerProfile>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    accountName: { type: String, required: true, trim: true, maxlength: 160, index: true },
    buyers: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
    buyerOrderLimit: { type: Number, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GMD' },
    totalOrders: { type: Number, default: 0, min: 0 },
    totalSpend: { type: Number, default: 0, min: 0 },
    ...contactFields,
    ...locationFields,
    ...verificationFields,
    ...lifecycleFields,
  },
  { ...baseSchemaOptions('customerprofiles'), timestamps: true },
);

customerSchema.index({ accountName: 'text', email: 'text' });

export const CustomerProfile = model<ICustomerProfile>('CustomerProfile', customerSchema);

// ─────────────────────────────────────────────────────────────────────────────
// Listing — a product or a service
// ─────────────────────────────────────────────────────────────────────────────

export interface IListing extends TimestampShape {
  _id: Types.ObjectId;
  merchant: Types.ObjectId;
  createdBySeller?: Types.ObjectId;
  kind: (typeof LISTING_KINDS)[number];
  status: (typeof LISTING_STATUSES)[number];
  title: string;
  description?: string;
  unitPrice: number;
  currency: (typeof CURRENCIES)[number];
  /** Products only. Null on a service — a plumber does not run out of plumbing. */
  stock?: number | null;
  unit?: string;
  category?: string;
  imageKeys: string[];
  publishedAt?: Date;
  suspendedReason?: string;
  totalOrdered: number;
  deletedAt?: Date | null;
}

const listingSchema = new Schema<IListing>(
  {
    merchant: { type: Schema.Types.ObjectId, ref: 'MerchantProfile', required: true, index: true },
    createdBySeller: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    kind: { type: String, enum: LISTING_KINDS, required: true, index: true },
    status: { type: String, enum: LISTING_STATUSES, default: 'draft', index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 4000 },
    unitPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GMD' },
    stock: { type: Number, min: 0, default: null },
    unit: { type: String, trim: true, maxlength: 30 },
    category: { type: String, trim: true, maxlength: 60, index: true },
    // Storage keys, never URLs. A URL in the database is a URL that outlives
    // the bucket it pointed at; signed links are minted on demand.
    imageKeys: [{ type: String, trim: true, maxlength: 300 }],
    publishedAt: { type: Date },
    suspendedReason: { type: String, trim: true, maxlength: 500 },
    totalOrdered: { type: Number, default: 0, min: 0 },
    deletedAt: { type: Date, default: null, index: true },
  },
  { ...baseSchemaOptions('listings'), timestamps: true },
);

listingSchema.index({ title: 'text', description: 'text' });
listingSchema.index({ status: 1, kind: 1, category: 1 });

export const Listing = model<IListing>('Listing', listingSchema);

// ─────────────────────────────────────────────────────────────────────────────
// Order
// ─────────────────────────────────────────────────────────────────────────────

export interface IOrderLine {
  listing: Types.ObjectId;
  /** Copied at order time, deliberately. See the file header. */
  title: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface IOrderEvent {
  at: Date;
  from: string;
  to: string;
  by?: Types.ObjectId;
  actorKind: string;
  note?: string;
}

export interface IOrder extends TimestampShape {
  _id: Types.ObjectId;
  reference: string;
  merchant: Types.ObjectId;
  customer: Types.ObjectId;
  /** The person who actually placed it, within the customer account. */
  placedByBuyer?: Types.ObjectId;
  acceptedBySeller?: Types.ObjectId;
  status: (typeof ORDER_STATUSES)[number];
  lines: IOrderLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  commissionPercent: number;
  platformFee: number;
  merchantNet: number;
  currency: (typeof CURRENCIES)[number];
  deliveryAddress?: string;
  note?: string;

  placedAt?: Date;
  paidAt?: Date;
  acceptedAt?: Date;
  fulfilledAt?: Date;
  confirmedAt?: Date;
  releasedAt?: Date;
  cancelledAt?: Date;
  refundedAt?: Date;
  disputedAt?: Date;

  /** When escrow releases on its own, if the buyer stays silent. */
  autoReleaseAt?: Date | null;
  disputeReason?: string;
  disputeRuling?: string;
  refundAmount?: number;
  paymentRef?: string;
  payoutBatch?: Types.ObjectId;

  /** Append-only. Every move, who made it, and when. */
  events: IOrderEvent[];
  deletedAt?: Date | null;
}

const orderLineSchema = new Schema<IOrderLine>(
  {
    listing: { type: Schema.Types.ObjectId, ref: 'Listing', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const orderEventSchema = new Schema<IOrderEvent>(
  {
    at: { type: Date, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    actorKind: { type: String, required: true },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    reference: { type: String, required: true, unique: true, index: true },
    merchant: { type: Schema.Types.ObjectId, ref: 'MerchantProfile', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'CustomerProfile', required: true, index: true },
    placedByBuyer: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    acceptedBySeller: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending', index: true },
    lines: { type: [orderLineSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    commissionPercent: { type: Number, default: DEFAULT_MARKETPLACE_COMMISSION_PERCENT, min: 0, max: 100 },
    platformFee: { type: Number, required: true, min: 0 },
    merchantNet: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GMD' },
    deliveryAddress: { type: String, trim: true, maxlength: 400 },
    note: { type: String, trim: true, maxlength: 1000 },

    placedAt: { type: Date, index: true },
    paidAt: { type: Date },
    acceptedAt: { type: Date },
    fulfilledAt: { type: Date, index: true },
    confirmedAt: { type: Date },
    releasedAt: { type: Date },
    cancelledAt: { type: Date },
    refundedAt: { type: Date },
    disputedAt: { type: Date },

    autoReleaseAt: { type: Date, default: null, index: true },
    disputeReason: { type: String, trim: true, maxlength: 1000 },
    disputeRuling: { type: String, trim: true, maxlength: 1000 },
    refundAmount: { type: Number, min: 0 },
    paymentRef: { type: String, trim: true, maxlength: 120 },
    payoutBatch: { type: Schema.Types.ObjectId, ref: 'PayoutBatch' },

    events: { type: [orderEventSchema], default: [] },
    deletedAt: { type: Date, default: null, index: true },
  },
  { ...baseSchemaOptions('orders'), timestamps: true },
);

orderSchema.index({ merchant: 1, status: 1, createdAt: -1 });
orderSchema.index({ customer: 1, status: 1, createdAt: -1 });

export const Order = model<IOrder>('Order', orderSchema);
