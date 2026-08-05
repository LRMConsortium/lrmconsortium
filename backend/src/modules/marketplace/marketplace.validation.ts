/**
 * Request shapes for the marketplace.
 *
 * `.strict()` everywhere, so a field the client invented is a 422 rather than
 * a value silently dropped. On an order that matters more than usual: a buyer
 * who thinks they set `deliveryFee: 0` and had it ignored has a complaint, and
 * they are right to.
 *
 * Note what is **absent**: no schema here accepts `platformFee`, `merchantNet`,
 * `total`, or `status`. Every one of those is computed or transitioned by the
 * server. A client that could name its own total could name zero.
 */

import { z } from 'zod';
import { LISTING_KINDS } from './listingRules.js';
import { MAX_ORDER_QUANTITY, MAX_UNIT_PRICE } from './listingRules.js';
import { MERCHANT_CATEGORIES } from './marketplace.model.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

// ── Merchant ─────────────────────────────────────────────────────────────

export const createMerchantSchema = z
  .object({
    user: objectId,
    tradingName: z.string().trim().min(2).max(160),
    category: z.enum(MERCHANT_CATEGORIES),
    registrationNumber: z.string().trim().max(60).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().max(30).optional(),
    region: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    addressLine1: z.string().trim().max(200).optional(),
    // Only Back Office may set a negotiated rate; the router enforces that.
    commissionPercent: z.number().min(0).max(100).optional(),
  })
  .strict();

export const updateMerchantSchema = createMerchantSchema.partial().omit({ user: true }).strict();

export const merchantSellersSchema = z
  .object({ sellerIds: z.array(objectId).max(50) })
  .strict();

// ── Customer ─────────────────────────────────────────────────────────────

export const createCustomerSchema = z
  .object({
    user: objectId,
    accountName: z.string().trim().min(2).max(160),
    email: z.string().email().optional(),
    phone: z.string().trim().max(30).optional(),
    region: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    addressLine1: z.string().trim().max(200).optional(),
    buyerOrderLimit: z.number().min(0).optional(),
  })
  .strict();

export const updateCustomerSchema = createCustomerSchema.partial().omit({ user: true }).strict();

export const customerBuyersSchema = z
  .object({ buyerIds: z.array(objectId).max(50) })
  .strict();

// ── Listing ──────────────────────────────────────────────────────────────

export const createListingSchema = z
  .object({
    kind: z.enum(LISTING_KINDS),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(4000).optional(),
    unitPrice: z.number().positive().max(MAX_UNIT_PRICE),
    // Nullable rather than merely optional: a service says "no stock" out
    // loud, which reads differently from a product whose count was forgotten.
    stock: z.number().int().min(0).nullable().optional(),
    unit: z.string().trim().max(30).optional(),
    category: z.string().trim().max(60).optional(),
    imageKeys: z.array(z.string().trim().max(300)).max(12).optional(),
  })
  .strict();

export const updateListingSchema = createListingSchema.partial().strict();

export const suspendListingSchema = z
  .object({ reason: z.string().trim().min(5, 'Say why').max(500) })
  .strict();

export const listingQuery = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sort: z.string().trim().max(60).optional(),
    search: z.string().trim().max(120).optional(),
    kind: z.enum(LISTING_KINDS).optional(),
    category: z.string().trim().max(60).optional(),
    merchant: objectId.optional(),
    status: z.enum(['draft', 'pending', 'published', 'suspended', 'archived']).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
  })
  .strict();

// ── Order ────────────────────────────────────────────────────────────────

export const placeOrderSchema = z
  .object({
    merchant: objectId,
    lines: z
      .array(
        z
          .object({
            listing: objectId,
            quantity: z.number().int().min(1).max(MAX_ORDER_QUANTITY),
          })
          .strict(),
      )
      .min(1, 'An order needs at least one line')
      .max(50),
    deliveryAddress: z.string().trim().max(400).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

/**
 * Paying.
 *
 * `paymentRef` is the provider's reference, not an amount. The server already
 * knows what the order costs; letting the client restate it would mean
 * deciding which of the two numbers to believe.
 */
export const payOrderSchema = z
  .object({ paymentRef: z.string().trim().min(3).max(120) })
  .strict();

export const fulfilOrderSchema = z
  .object({ note: z.string().trim().max(500).optional() })
  .strict();

export const cancelOrderSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();

export const disputeOrderSchema = z
  .object({ reason: z.string().trim().min(10, 'Describe the problem').max(1000) })
  .strict();

/**
 * Back Office ruling on a dispute.
 *
 * A refund amount is required when ruling for the buyer and refused otherwise,
 * checked with `superRefine` so the message names the actual mistake rather
 * than saying "invalid body".
 */
export const resolveDisputeSchema = z
  .object({
    outcome: z.enum(['release', 'refund', 'cancel']),
    ruling: z.string().trim().min(10, 'Record the reasoning').max(1000),
    refundAmount: z.number().min(0).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.outcome === 'refund' && v.refundAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refundAmount'],
        message: 'A refund ruling must say how much is being returned',
      });
    }
    if (v.outcome !== 'refund' && v.refundAmount !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refundAmount'],
        message: 'Only a refund ruling carries an amount',
      });
    }
  });

export const orderQuery = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sort: z.string().trim().max(60).optional(),
    status: z.enum([
      'pending', 'paid', 'accepted', 'fulfilled', 'confirmed',
      'released', 'cancelled', 'refunded', 'disputed',
    ]).optional(),
    merchant: objectId.optional(),
    customer: objectId.optional(),
  })
  .strict();
