/**
 * The LRMC Marketplace.
 *
 * Merchants list, customers order, LRMC holds the money until the order is
 * done. Four collections, and one flow that matters more than the rest — the
 * escrow path from `paid` to `released`.
 *
 * **Every decision about who may move an order lives in `orderLifecycle.ts`,
 * not here.** This file resolves who the caller is, asks the table, and does
 * the bookkeeping. That split is what makes the rules assertable without a
 * database, and it is why a merchant cannot release their own escrow: not
 * because a condition in this file forbids it, but because the transition does
 * not exist.
 *
 * Money arithmetic likewise lives in `orderMath.ts`. Nothing here computes a
 * total.
 */

import { Router } from 'express';
import {
  authenticate,
  auditTrail,
  enterZone,
  requirePermission,
  requireRole,
  validate,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { BaseService } from '../../shared/BaseService.js';
import { asyncHandler, created, ok, paginated } from '../../shared/http.js';
import { defineProfileModule, namedIdParam } from '../../shared/moduleFactory.js';
import { dispatchNotification } from '../notification/dispatch.js';
import { Payment } from '../payment/payment.model.js';
import type { Currency } from '../../config/currencies.js';
import {
  checkoutProvider,
  isExpressible,
} from '../../shared/providers/checkout.js';
import {
  CustomerProfile,
  Listing,
  MerchantProfile,
  Order,
  type ICustomerProfile,
  type IListing,
  type IMerchantProfile,
  type IOrder,
} from './marketplace.model.js';
import {
  autoUnpublish,
  canOrder,
  canPublish,
  stockAfterOrder,
  stockAfterRelease,
  type ListingShape,
} from './listingRules.js';
import {
  canTransition,
  describeStatus,
  isEscrowHeld,
  movesMoney,
  nextStatuses,
  type OrderActor,
  type OrderStatus,
} from './orderLifecycle.js';
import {
  DEFAULT_MARKETPLACE_COMMISSION_PERCENT,
  autoReleaseAt,
  priceOrder,
  refundBreakdown,
  totalsBalance,
  withinFreeCancellation,
} from './orderMath.js';
import {
  cancelOrderSchema,
  createCustomerSchema,
  createListingSchema,
  createMerchantSchema,
  customerBuyersSchema,
  disputeOrderSchema,
  fulfilOrderSchema,
  listingQuery,
  merchantSellersSchema,
  orderQuery,
  payOrderSchema,
  placeOrderSchema,
  resolveDisputeSchema,
  suspendListingSchema,
  updateCustomerSchema,
  updateListingSchema,
  updateMerchantSchema,
} from './marketplace.validation.js';

// ─────────────────────────────────────────────────────────────────────────────
// Party modules
//
// Back Office administers both. No coordinator involvement: coordinators
// supervise vendors on properties; the marketplace is governed by the
// platform's own rules — see `config/roles.ts`.
// ─────────────────────────────────────────────────────────────────────────────

export const merchantModule = defineProfileModule<IMerchantProfile>({
  collectionPath: 'merchants',
  itemPath: 'merchant',
  idParam: 'merchantId',
  resource: 'merchantProfile',
  adminZone: 'BACK_OFFICE',
  model: MerchantProfile,
  createSchema: createMerchantSchema,
  updateSchema: updateMerchantSchema,
  serviceOptions: {
    label: 'Merchant profile',
    searchableFields: ['tradingName', 'email', 'phone'],
    filterableFields: ['status', 'verificationStatus', 'category', 'region'],
    ownerPath: 'user',
    defaultSort: '-createdAt',
  },
  extend: ({ itemRouter, service }) => {
    /**
     * Who may sell for this merchant.
     *
     * The account owner manages its own staff. This is the reason Merchant and
     * Seller are separate roles: three people selling for one business need
     * three logins, and removing one on a Friday must not lock out the other
     * two.
     */
    itemRouter.patch(
      '/:merchantId/sellers',
      authenticate,
      enterZone('MEMBER_PORTAL'),
      auditTrail('merchantProfile'),
      requirePermission('merchantProfile:update', 'merchantProfile:updateOwn'),
      validate({ params: namedIdParam('merchantId'), body: merchantSellersSchema }),
      asyncHandler(async (req, res) => {
        const { sellerIds } = req.body as { sellerIds: string[] };
        const updated = await service.update(
          req.params.merchantId!,
          { sellers: sellerIds } as never,
          req.actor,
        );
        return ok(res, updated);
      }),
    );
  },
});

export const customerModule = defineProfileModule<ICustomerProfile>({
  collectionPath: 'customers',
  itemPath: 'customer',
  idParam: 'customerId',
  resource: 'customerProfile',
  adminZone: 'BACK_OFFICE',
  model: CustomerProfile,
  createSchema: createCustomerSchema,
  updateSchema: updateCustomerSchema,
  serviceOptions: {
    label: 'Customer profile',
    searchableFields: ['accountName', 'email', 'phone'],
    filterableFields: ['status', 'verificationStatus', 'region'],
    ownerPath: 'user',
    defaultSort: '-createdAt',
  },
  extend: ({ itemRouter, service }) => {
    itemRouter.patch(
      '/:customerId/buyers',
      authenticate,
      enterZone('MEMBER_PORTAL'),
      auditTrail('customerProfile'),
      requirePermission('customerProfile:update', 'customerProfile:updateOwn'),
      validate({ params: namedIdParam('customerId'), body: customerBuyersSchema }),
      asyncHandler(async (req, res) => {
        const { buyerIds } = req.body as { buyerIds: string[] };
        const updated = await service.update(
          req.params.customerId!,
          { buyers: buyerIds } as never,
          req.actor,
        );
        return ok(res, updated);
      }),
    );
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const listingsRouter = Router();
const listingRouter = Router();
const ordersRouter = Router();
const orderRouter = Router();
const marketplaceRouter = Router();

const listingService = new BaseService<IListing>(Listing, {
  label: 'Listing',
  searchableFields: ['title', 'description'],
  filterableFields: ['status', 'kind', 'category', 'merchant'],
  defaultSort: '-createdAt',
});

/** The merchant account this actor sells for, whether owner or seller. */
async function merchantFor(userId: string): Promise<IMerchantProfile | null> {
  return (await MerchantProfile.findOne({
    $or: [{ user: userId }, { sellers: userId }],
    deletedAt: null,
  })
    .lean()
    .exec()) as IMerchantProfile | null;
}

/** The customer account this actor buys against, whether owner or buyer. */
async function customerFor(userId: string): Promise<ICustomerProfile | null> {
  return (await CustomerProfile.findOne({
    $or: [{ user: userId }, { buyers: userId }],
    deletedAt: null,
  })
    .lean()
    .exec()) as ICustomerProfile | null;
}

/**
 * Which side of an order is this caller on?
 *
 * Derived from the order rather than from the caller's role alone, because
 * the same person could in principle hold both a merchant and a customer
 * account. What matters is which of them *this* order belongs to.
 *
 * Returns null when the caller is neither party and holds no adjudicating
 * grant — the caller of last resort is a 403, never a guess.
 */
async function actorSideFor(
  req: { actor?: { userId: string; roles: string[]; grants: string[] } },
  order: Pick<IOrder, 'merchant' | 'customer'>,
): Promise<OrderActor | null> {
  const actor = req.actor;
  if (!actor) return null;

  // Back Office adjudicates. Checked first: a staff member who also happened
  // to hold a customer account must still act as Back Office here.
  if (actor.roles.includes('backOfficeStaff') || actor.roles.includes('founder')) {
    return 'backOffice';
  }

  const merchant = await merchantFor(actor.userId);
  if (merchant && String(merchant._id) === String(order.merchant)) return 'merchant';

  const customer = await customerFor(actor.userId);
  if (customer && String(customer._id) === String(order.customer)) return 'buyer';

  return null;
}

function toListingShape(l: IListing, merchantVerified: boolean): ListingShape {
  return {
    kind: l.kind,
    status: l.status,
    title: l.title,
    unitPrice: l.unitPrice,
    stock: l.stock ?? null,
    merchantVerified,
  };
}

/** `ORD-2026-0000123`. Sortable, sequential, and legible on a receipt. */
async function nextReference(now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const count = await Order.countDocuments({
    reference: new RegExp(`^ORD-${year}-`),
  }).exec();
  return `ORD-${year}-${String(count + 1).padStart(7, '0')}`;
}

/**
 * Move an order, or refuse with the reason the table gave.
 *
 * Every status change on the platform goes through here, so the append-only
 * event trail cannot be forgotten by a route that changes `status` directly.
 */
async function transition(
  order: IOrder,
  to: OrderStatus,
  side: OrderActor,
  actorId: string | undefined,
  patch: Record<string, unknown>,
  note?: string,
): Promise<IOrder> {
  const verdict = canTransition(order.status, to, side);

  if (!verdict.allowed) {
    if (verdict.reason === 'terminal') {
      throw ApiError.conflict(
        `This order is ${order.status} and cannot change further`,
      );
    }
    if (verdict.reason === 'wrongActor') {
      throw ApiError.forbidden(
        `Only ${(verdict.permittedActors ?? []).join(' or ')} may do that`,
      );
    }
    throw ApiError.conflict(`An order cannot go from ${order.status} to ${to}`);
  }

  const now = new Date();
  const updated = await Order.findOneAndUpdate(
    // The status guard is the concurrency control: two clients racing to
    // accept the same order both pass the table check, and exactly one wins
    // the write. Without it, both would succeed and the second would silently
    // overwrite the first's timestamps.
    { _id: order._id, status: order.status },
    {
      $set: { status: to, ...patch },
      $push: {
        events: {
          at: now,
          from: order.status,
          to,
          by: actorId,
          actorKind: side,
          note,
        },
      },
    },
    { new: true },
  )
    .lean()
    .exec();

  if (!updated) {
    throw ApiError.conflict('The order changed while you were working on it. Reload and try again.');
  }
  return updated as IOrder;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listings
// ─────────────────────────────────────────────────────────────────────────────

/** Browse the catalogue. Any signed-in member may look. */
listingsRouter.get(
  '/',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('listing:read'),
  validate({ query: listingQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = { deletedAt: null };

    /* A buyer browsing sees published listings only. Staff and the owning
     * merchant can ask for other states explicitly. Defaulting to `published`
     * rather than to everything means a draft cannot leak into the catalogue
     * because somebody forgot a filter. */
    filter.status = q.status ?? 'published';
    if (q.kind) filter.kind = q.kind;
    if (q.category) filter.category = q.category;
    if (q.merchant) filter.merchant = q.merchant;
    if (q.search) filter.$text = { $search: q.search };
    if (q.minPrice || q.maxPrice) {
      filter.unitPrice = {
        ...(q.minPrice ? { $gte: Number(q.minPrice) } : {}),
        ...(q.maxPrice ? { $lte: Number(q.maxPrice) } : {}),
      };
    }

    const limit = Math.min(100, Number(q.limit ?? 25));
    const page = Math.max(1, Number(q.page ?? 1));

    const [items, total] = await Promise.all([
      Listing.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit).lean().exec(),
      Listing.countDocuments(filter).exec(),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return paginated(res, items, {
      page, limit, total, totalPages,
      hasNext: page < totalPages, hasPrev: page > 1,
    });
  }),
);

/** Create a listing. Merchants and their sellers only. */
listingsRouter.post(
  '/',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('listing'),
  requirePermission('listing:create'),
  validate({ body: createListingSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const merchant = await merchantFor(actor.userId);
    if (!merchant) throw ApiError.forbidden('You do not sell for a merchant account');

    const body = req.body as Record<string, unknown>;
    const doc = await Listing.create({
      ...body,
      merchant: merchant._id,
      createdBySeller: actor.userId,
      currency: merchant.currency,
      // Always draft. A listing does not go live because it was created — it
      // goes live because `canPublish` agreed, which is a separate call.
      status: 'draft',
    });
    return created(res, doc.toJSON());
  }),
);

listingRouter.get(
  '/:listingId',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('listing:read'),
  validate({ params: namedIdParam('listingId') }),
  asyncHandler(async (req, res) => {
    const doc = await Listing.findOne({ _id: req.params.listingId, deletedAt: null }).lean().exec();
    if (!doc) throw ApiError.notFound('Listing');
    return ok(res, doc);
  }),
);

listingRouter.patch(
  '/:listingId',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('listing'),
  requirePermission('listing:update'),
  validate({ params: namedIdParam('listingId'), body: updateListingSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const listing = await Listing.findOne({ _id: req.params.listingId, deletedAt: null }).lean().exec();
    if (!listing) throw ApiError.notFound('Listing');

    const merchant = await merchantFor(actor.userId);
    if (!merchant || String(merchant._id) !== String(listing.merchant)) {
      throw ApiError.forbidden('That listing belongs to another merchant');
    }

    const updated = await Listing.findByIdAndUpdate(
      listing._id,
      { $set: req.body as Record<string, unknown> },
      { new: true },
    ).lean().exec();
    return ok(res, updated);
  }),
);

/**
 * Publish.
 *
 * The eligibility rules are in `listingRules.canPublish`, which returns every
 * problem at once rather than the first — a merchant fixing one fault per
 * submission gives up on the third.
 */
listingRouter.post(
  '/:listingId/publish',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('listing'),
  requirePermission('listing:update'),
  validate({ params: namedIdParam('listingId') }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const listing = await Listing.findOne({ _id: req.params.listingId, deletedAt: null }).lean().exec();
    if (!listing) throw ApiError.notFound('Listing');

    const merchant = await merchantFor(actor.userId);
    if (!merchant || String(merchant._id) !== String(listing.merchant)) {
      throw ApiError.forbidden('That listing belongs to another merchant');
    }

    const verified = merchant.verificationStatus === 'verified';
    const verdict = canPublish(toListingShape(listing as IListing, verified));

    if (!verdict.publishable) {
      throw ApiError.validation(
        'This listing cannot be published yet',
        verdict.problems.map((message) => ({ message })),
      );
    }

    const updated = await Listing.findByIdAndUpdate(
      listing._id,
      { $set: { status: 'published', publishedAt: new Date(), suspendedReason: undefined } },
      { new: true },
    ).lean().exec();
    return ok(res, updated);
  }),
);

listingRouter.post(
  '/:listingId/unpublish',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('listing'),
  requirePermission('listing:update'),
  validate({ params: namedIdParam('listingId') }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const listing = await Listing.findOne({ _id: req.params.listingId, deletedAt: null }).lean().exec();
    if (!listing) throw ApiError.notFound('Listing');

    const merchant = await merchantFor(actor.userId);
    if (!merchant || String(merchant._id) !== String(listing.merchant)) {
      throw ApiError.forbidden('That listing belongs to another merchant');
    }

    const updated = await Listing.findByIdAndUpdate(
      listing._id,
      { $set: { status: 'draft' } },
      { new: true },
    ).lean().exec();
    return ok(res, updated);
  }),
);

/** Back Office pulls a listing down. Reason required and kept. */
listingRouter.post(
  '/:listingId/suspend',
  authenticate,
  enterZone('BACK_OFFICE'),
  auditTrail('listing'),
  requirePermission('listing:review', 'listing:update'),
  validate({ params: namedIdParam('listingId'), body: suspendListingSchema }),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as { reason: string };
    const updated = await Listing.findOneAndUpdate(
      { _id: req.params.listingId, deletedAt: null },
      { $set: { status: 'suspended', suspendedReason: reason } },
      { new: true },
    ).lean().exec();
    if (!updated) throw ApiError.notFound('Listing');
    return ok(res, updated);
  }),
);

/** The merchant account's own catalogue, in every state. */
listingsRouter.get(
  '/me',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('listing:read'),
  asyncHandler(async (req, res) => {
    const merchant = await merchantFor(req.actor!.userId);
    if (!merchant) throw ApiError.forbidden('You do not sell for a merchant account');

    const items = await Listing.find({ merchant: merchant._id, deletedAt: null })
      .sort('-createdAt').limit(200).lean().exec();

    return ok(res, {
      merchant: merchant._id,
      tradingName: merchant.tradingName,
      verified: merchant.verificationStatus === 'verified',
      counts: {
        total: items.length,
        published: items.filter((l) => l.status === 'published').length,
        draft: items.filter((l) => l.status === 'draft').length,
        suspended: items.filter((l) => l.status === 'suspended').length,
      },
      listings: items,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Place an order.
 *
 * Prices are read from the listings **now** and copied onto the lines. The
 * client sends listing ids and quantities and nothing else — a client that
 * could name its own prices would name zero.
 */
ordersRouter.post(
  '/',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('order'),
  requirePermission('order:create'),
  validate({ body: placeOrderSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as {
      merchant: string;
      lines: { listing: string; quantity: number }[];
      deliveryAddress?: string;
      note?: string;
    };

    const customer = await customerFor(actor.userId);
    if (!customer) throw ApiError.forbidden('You do not buy for a customer account');

    const merchant = await MerchantProfile.findOne({
      _id: body.merchant, deletedAt: null,
    }).lean().exec();
    if (!merchant) throw ApiError.notFound('Merchant');

    const verified = merchant.verificationStatus === 'verified';

    // Every line is checked before any is priced, so a rejected order names
    // all its problems rather than one per attempt.
    const listings = await Listing.find({
      _id: { $in: body.lines.map((l) => l.listing) },
      merchant: merchant._id,
      deletedAt: null,
    }).lean().exec();

    const byId = new Map<string, IListing>(
      (listings as unknown as IListing[]).map((l) => [String(l._id), l]),
    );
    const problems: { message: string }[] = [];

    for (const line of body.lines) {
      const listing = byId.get(line.listing);
      if (!listing) {
        problems.push({ message: `Listing ${line.listing} is not sold by this merchant` });
        continue;
      }
      const verdict = canOrder(toListingShape(listing, verified), line.quantity);
      if (!verdict.orderable) {
        problems.push({
          message:
            verdict.reason === 'insufficientStock'
              ? `${listing.title}: only ${verdict.available} left`
              : verdict.reason === 'outOfStock'
                ? `${listing.title} is out of stock`
                : `${listing.title} cannot be ordered (${verdict.reason})`,
        });
      }
    }
    if (problems.length) throw ApiError.validation('This order cannot be placed', problems);

    const totals = priceOrder(
      body.lines.map((l) => {
        const listing = byId.get(l.listing)!;
        return {
          listingId: String(listing._id),
          title: listing.title,
          unitPrice: listing.unitPrice,
          quantity: l.quantity,
        };
      }),
      {
        commissionPercent: merchant.commissionPercent ?? DEFAULT_MARKETPLACE_COMMISSION_PERCENT,
        currency: merchant.currency,
      },
    );

    // Checked before the row is written, not at month end — by which point an
    // imbalance has been paid out and spent.
    if (!totalsBalance(totals)) {
      throw ApiError.internal('Order totals did not balance and the order was not created');
    }

    // A named buyer's ceiling, if the account set one. This is the point of
    // naming buyers separately from the account.
    if (
      customer.buyerOrderLimit !== undefined &&
      String(customer.user) !== actor.userId &&
      totals.total > customer.buyerOrderLimit
    ) {
      throw ApiError.forbidden(
        `This order exceeds your limit of ${customer.buyerOrderLimit}. The account owner must place it.`,
      );
    }

    const now = new Date();
    const doc = await Order.create({
      reference: await nextReference(now),
      merchant: merchant._id,
      customer: customer._id,
      placedByBuyer: actor.userId,
      status: 'pending',
      lines: totals.lines.map((l) => ({
        listing: l.listingId,
        title: l.title,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
      })),
      subtotal: totals.subtotal,
      deliveryFee: totals.deliveryFee,
      total: totals.total,
      commissionPercent: totals.commissionPercent,
      platformFee: totals.platformFee,
      merchantNet: totals.merchantNet,
      currency: totals.currency,
      deliveryAddress: body.deliveryAddress,
      note: body.note,
      placedAt: now,
      events: [{ at: now, from: 'pending', to: 'pending', by: actor.userId, actorKind: 'buyer', note: 'Order placed' }],
    });

    return created(res, { ...doc.toJSON(), statusLabel: describeStatus('pending') });
  }),
);

ordersRouter.get(
  '/',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('order:read'),
  validate({ query: orderQuery }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const q = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = { deletedAt: null };

    /* Scope narrowed in the data layer, not by hiding buttons. A merchant
     * asking for another merchant's orders gets an empty page, not a 403 that
     * confirms the other order exists. */
    if (!actor.roles.includes('backOfficeStaff') && !actor.roles.includes('founder')
        && !actor.roles.includes('hqExecutive')) {
      const merchant = await merchantFor(actor.userId);
      const customer = await customerFor(actor.userId);
      if (merchant) filter.merchant = merchant._id;
      else if (customer) filter.customer = customer._id;
      else throw ApiError.forbidden('You have no marketplace account');
    } else {
      if (q.merchant) filter.merchant = q.merchant;
      if (q.customer) filter.customer = q.customer;
    }
    if (q.status) filter.status = q.status;

    const limit = Math.min(100, Number(q.limit ?? 25));
    const page = Math.max(1, Number(q.page ?? 1));

    const [items, total] = await Promise.all([
      Order.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit).lean().exec(),
      Order.countDocuments(filter).exec(),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return paginated(res, items, {
      page, limit, total, totalPages,
      hasNext: page < totalPages, hasPrev: page > 1,
    });
  }),
);

orderRouter.get(
  '/:orderId',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('order:read'),
  validate({ params: namedIdParam('orderId') }),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.orderId, deletedAt: null }).lean().exec();
    if (!order) throw ApiError.notFound('Order');

    const side = await actorSideFor(req, order as IOrder);
    if (!side) throw ApiError.notFound('Order');

    return ok(res, {
      ...order,
      statusLabel: describeStatus(order.status),
      escrowHeld: isEscrowHeld(order.status),
      // What this particular caller can do next, so the client does not have
      // to reimplement the table to decide which buttons to draw.
      availableActions: nextStatuses(order.status, side),
      yourSide: side,
    });
  }),
);

/* ═══════════════════════════════════════════════════════════════════════════
 * Payment
 *
 * Two halves, and the split is the whole point.
 *
 * `POST /order/:orderId/pay` **asks for an intent**. It takes no reference from
 * the caller, and it does not move the order. Previously it accepted a
 * `paymentRef` string and moved the order to `paid` on the strength of it —
 * nothing verified that money had arrived, nothing checked the amount, and the
 * module imported no payment provider at all. Any buyer could post any string
 * and receive goods.
 *
 * `settleOrderPaid` is the other half, and only the **webhook** calls it, after
 * verifying Stripe's signature over the raw body and reconciling the amount and
 * currency against the order. A client never asserts that money moved. The
 * payment module's own header has said so since week one; it was true there and
 * absent here.
 * ══════════════════════════════════════════════════════════════════════════ */

orderRouter.post(
  '/:orderId/pay',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('order'),
  requirePermission('order:updateOwn', 'order:update'),
  validate({ params: namedIdParam('orderId'), body: payOrderSchema }),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.orderId, deletedAt: null }).lean().exec();
    if (!order) throw ApiError.notFound('Order');

    const side = await actorSideFor(req, order as IOrder);
    if (side !== 'buyer') throw ApiError.forbidden('Only the buyer may pay for this order');

    if (!canTransition(order.status as OrderStatus, 'paid', 'buyer')) {
      throw ApiError.conflict(`An order in status "${order.status}" cannot be paid`);
    }

    const currency = order.currency as Currency;
    if (!isExpressible(order.total, currency)) {
      throw ApiError.validation('That total cannot be charged', [
        { field: 'total', message: `${order.total} is not expressible in ${currency}` },
      ]);
    }

    const intent = await checkoutProvider().createIntent({
      amount: order.total,
      currency,
      orderId: String(order._id),
      /* The order's own id. Stable across a double-tapped button, so the buyer
       * gets one intent rather than two charges they then have to dispute. */
      idempotencyKey: `order:${String(order._id)}`,
      description: `LRMC order ${order.reference}`,
    });

    if (!intent.ok) {
      throw ApiError.policy(intent.error ?? 'Payment could not be started.');
    }

    /* The client secret and nothing else. The order does not move here, and
     * saying so in the response is what stops a browser assuming it did. */
    return ok(res, {
      orderId: String(order._id),
      reference: order.reference,
      amount: order.total,
      currency,
      clientSecret: intent.clientSecret,
      provider: intent.provider,
      settled: false,
      note: 'The order settles when the gateway confirms payment, not when this returns.',
    });
  }),
);

/**
 * Settle an order that has genuinely been paid.
 *
 * Called **only** from the verified webhook. Every caller-supplied value is
 * absent by design: the amount, the currency and the reference all come from
 * the gateway's own object.
 *
 * Ordering matters and is the opposite of the obvious one. The order moves and
 * the ledger row is written *first*; stock and the merchant notification come
 * after. A delivery notification that throws must not roll back a payment —
 * that is exactly how the other LRMC codebase turns an ordinary Stripe retry
 * into a second payout.
 */
export async function settleOrderPaid(
  order: IOrder,
  actorId: string,
  providerReference: string,
): Promise<IOrder> {
  const now = new Date();

  const updated = await transition(order, 'paid', 'buyer', actorId,
    { paidAt: now, paymentRef: providerReference }, 'Payment captured');

  /* The ledger row for money LRMC now holds. `order` did not exist as a payment
   * kind, which is why escrow used to hold money with no record of it and the
   * payout batcher had no source it could pay a merchant from. */
  await Payment.create({
    kind: 'order',
    subjectKind: 'Order',
    subject: updated._id,
    payer: updated.customer,
    payerKind: 'CustomerProfile',
    payee: updated.merchant,
    payeeKind: 'MerchantProfile',
    amount: updated.total,
    currency: updated.currency,
    reference: providerReference,
    providerName: 'stripe',
    paidAt: now,
    status: 'succeeded',
    createdBy: actorId,
  });

  /* ── Side effects, after the money is recorded ────────────────────────── */

  // Stock comes down when the money is committed, not when the order is
  // drafted — an unpaid order holding stock is how a catalogue empties
  // without a single sale.
  for (const line of updated.lines) {
    const listing = await Listing.findById(line.listing).lean().exec();
    if (!listing) continue;
    const next = stockAfterOrder(toListingShape(listing as IListing, true), line.quantity);
    const patch: Record<string, unknown> = { $inc: { totalOrdered: line.quantity } };
    if (next !== null) {
      patch.$set = {
        stock: next,
        ...(autoUnpublish({ ...toListingShape(listing as IListing, true), stock: next })
          ? { status: 'draft' }
          : {}),
      };
    }
    await Listing.findByIdAndUpdate(line.listing, patch).exec();
  }

  try {
    const merchant = await MerchantProfile.findById(updated.merchant).select('user').lean().exec();
    if (merchant) {
      await dispatchNotification({
        recipient: String(merchant.user),
        category: 'order',
        channel: 'inApp',
        title: `New paid order ${updated.reference}`,
        body: `${updated.currency} ${updated.total} is held by LRMC pending your acceptance.`,
      });
    }
  } catch { /* best effort — never unwind a settled payment over a notification */ }

  return updated;
}

/** Merchant accepts. */
orderRouter.post(
  '/:orderId/accept',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('order'),
  requirePermission('order:update'),
  validate({ params: namedIdParam('orderId') }),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.orderId, deletedAt: null }).lean().exec();
    if (!order) throw ApiError.notFound('Order');

    const side = await actorSideFor(req, order as IOrder);
    if (side !== 'merchant') throw ApiError.forbidden('Only the merchant may accept this order');

    const updated = await transition(order as IOrder, 'accepted', 'merchant', req.actor!.userId,
      { acceptedAt: new Date(), acceptedBySeller: req.actor!.userId });
    return ok(res, { ...updated, statusLabel: describeStatus(updated.status) });
  }),
);

/**
 * Merchant marks it delivered. The release clock starts here.
 *
 * `autoReleaseAt` is stamped now rather than computed on read, so the merchant
 * can see the date they will be paid and a scheduled job has an indexed field
 * to sweep.
 */
orderRouter.post(
  '/:orderId/fulfil',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('order'),
  requirePermission('order:update'),
  validate({ params: namedIdParam('orderId'), body: fulfilOrderSchema }),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.orderId, deletedAt: null }).lean().exec();
    if (!order) throw ApiError.notFound('Order');

    const side = await actorSideFor(req, order as IOrder);
    if (side !== 'merchant') throw ApiError.forbidden('Only the merchant may fulfil this order');

    const now = new Date();
    const { note } = req.body as { note?: string };
    const updated = await transition(order as IOrder, 'fulfilled', 'merchant', req.actor!.userId,
      { fulfilledAt: now, autoReleaseAt: autoReleaseAt(now) }, note);

    try {
      const customer = await CustomerProfile.findById(updated.customer).select('user').lean().exec();
      if (customer) {
        await dispatchNotification({
          recipient: String(customer.user),
          category: 'order',
          channel: 'inApp',
          title: `Order ${updated.reference} delivered`,
          body: `Confirm receipt to settle the merchant. Funds release automatically on ${
            updated.autoReleaseAt ? new Date(updated.autoReleaseAt).toDateString() : 'the due date'
          }.`,
        });
      }
    } catch { /* best effort */ }

    return ok(res, { ...updated, statusLabel: describeStatus(updated.status) });
  }),
);

/** Buyer confirms, then escrow releases in the same request. */
orderRouter.post(
  '/:orderId/confirm',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('order'),
  requirePermission('order:updateOwn', 'order:update'),
  validate({ params: namedIdParam('orderId') }),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.orderId, deletedAt: null }).lean().exec();
    if (!order) throw ApiError.notFound('Order');

    const side = await actorSideFor(req, order as IOrder);
    if (side !== 'buyer') throw ApiError.forbidden('Only the buyer may confirm this order');

    const now = new Date();
    const confirmed = await transition(order as IOrder, 'confirmed', 'buyer', req.actor!.userId,
      { confirmedAt: now });

    // The release itself is `system`, never the buyer — the buyer's act is
    // confirmation; releasing money is the platform's.
    const released = await transition(confirmed, 'released', 'system', undefined,
      { releasedAt: now }, 'Escrow released on buyer confirmation');

    await MerchantProfile.findByIdAndUpdate(released.merchant, {
      $inc: { totalOrders: 1, totalSales: released.merchantNet },
    }).exec();
    await CustomerProfile.findByIdAndUpdate(released.customer, {
      $inc: { totalOrders: 1, totalSpend: released.total },
    }).exec();

    return ok(res, {
      ...released,
      statusLabel: describeStatus(released.status),
      escrowHeld: false,
      settlement: {
        gross: released.total,
        platformFee: released.platformFee,
        merchantNet: released.merchantNet,
      },
    });
  }),
);

orderRouter.post(
  '/:orderId/cancel',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('order'),
  requirePermission('order:updateOwn', 'order:update'),
  validate({ params: namedIdParam('orderId'), body: cancelOrderSchema }),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.orderId, deletedAt: null }).lean().exec();
    if (!order) throw ApiError.notFound('Order');

    const side = await actorSideFor(req, order as IOrder);
    if (!side) throw ApiError.notFound('Order');

    const { reason } = req.body as { reason: string };

    // A buyer's free-cancellation window. After it, the merchant may have
    // bought materials or turned down other work, so cancelling needs them.
    if (side === 'buyer' && order.status !== 'pending') {
      const placed = order.placedAt ?? order.createdAt ?? new Date();
      if (!withinFreeCancellation(new Date(placed), new Date())) {
        throw ApiError.forbidden(
          'The free cancellation window has closed. Ask the merchant to cancel, or raise a dispute.',
        );
      }
    }

    const updated = await transition(order as IOrder, 'cancelled', side, req.actor!.userId,
      { cancelledAt: new Date() }, reason);

    // Stock goes back. Not the inverse of taking it — a cancelled *service*
    // must not invent stock on something that never had any.
    for (const line of updated.lines) {
      const listing = await Listing.findById(line.listing).lean().exec();
      if (!listing) continue;
      const next = stockAfterRelease(toListingShape(listing as IListing, true), line.quantity);
      if (next !== null) await Listing.findByIdAndUpdate(line.listing, { $set: { stock: next } }).exec();
    }

    return ok(res, { ...updated, statusLabel: describeStatus(updated.status) });
  }),
);

orderRouter.post(
  '/:orderId/dispute',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('order'),
  requirePermission('order:updateOwn', 'order:update'),
  validate({ params: namedIdParam('orderId'), body: disputeOrderSchema }),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.orderId, deletedAt: null }).lean().exec();
    if (!order) throw ApiError.notFound('Order');

    const side = await actorSideFor(req, order as IOrder);
    if (side !== 'buyer' && side !== 'merchant') {
      throw ApiError.forbidden('Only the buyer or the merchant may raise a dispute');
    }

    const { reason } = req.body as { reason: string };
    const updated = await transition(order as IOrder, 'disputed', side, req.actor!.userId,
      // Clearing the auto-release clock is the point: a disputed order must
      // not quietly pay out to the merchant while Back Office is reading it.
      { disputedAt: new Date(), disputeReason: reason, autoReleaseAt: null }, reason);

    return ok(res, {
      ...updated,
      statusLabel: describeStatus(updated.status),
      escrowHeld: true,
      note: 'Funds are frozen with LRMC until Back Office rules.',
    });
  }),
);

/** Back Office rules on a dispute. Zone C, and only Back Office. */
orderRouter.post(
  '/:orderId/resolve',
  authenticate,
  enterZone('BACK_OFFICE'),
  auditTrail('order'),
  requirePermission('order:update'),
  requireRole('backOfficeStaff', 'founder'),
  validate({ params: namedIdParam('orderId'), body: resolveDisputeSchema }),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.orderId, deletedAt: null }).lean().exec();
    if (!order) throw ApiError.notFound('Order');

    const body = req.body as { outcome: 'release' | 'refund' | 'cancel'; ruling: string; refundAmount?: number };
    const now = new Date();
    const to: OrderStatus =
      body.outcome === 'release' ? 'released' : body.outcome === 'refund' ? 'refunded' : 'cancelled';

    const patch: Record<string, unknown> = { disputeRuling: body.ruling };
    if (to === 'released') patch.releasedAt = now;
    if (to === 'cancelled') patch.cancelledAt = now;

    let breakdown: ReturnType<typeof refundBreakdown> | null = null;
    if (to === 'refunded') {
      breakdown = refundBreakdown(
        {
          lines: [], lineCount: 0,
          subtotal: order.subtotal, deliveryFee: order.deliveryFee, total: order.total,
          commissionPercent: order.commissionPercent, platformFee: order.platformFee,
          merchantNet: order.merchantNet, currency: order.currency,
        },
        body.refundAmount ?? order.total,
      );
      patch.refundedAt = now;
      patch.refundAmount = breakdown.refundToBuyer;
    }

    const updated = await transition(order as IOrder, to, 'backOffice', req.actor!.userId,
      patch, body.ruling);

    return ok(res, {
      ...updated,
      statusLabel: describeStatus(updated.status),
      escrowHeld: false,
      // Commission comes back pro rata on a partial refund. Keeping it in full
      // would mean LRMC profits proportionally more the worse the service was.
      refund: breakdown,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Marketplace overview
// ─────────────────────────────────────────────────────────────────────────────

/** What the marketplace dashboard reads. Scoped to whoever is asking. */
marketplaceRouter.get(
  '/overview',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('marketplace:read'),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const merchant = await merchantFor(actor.userId);
    const customer = merchant ? null : await customerFor(actor.userId);

    /* ── Refuse, do not fall through ──────────────────────────────────────
     * This built `{ deletedAt: null }` and then answered with it — the whole
     * platform's order book, aggregated, plus ten orders in full, to anybody
     * holding `marketplace:read` and no marketplace account. `GET /orders`
     * three hundred lines up gets this right; this one did not.
     *
     * It was not a hypothetical caller either: `merchant` and `customer` are
     * self-registerable, and `PROFILE_FACTORIES` built no profile for either,
     * so every self-registered marketplace account landed here permanently. */
    if (!merchant && !customer) {
      throw ApiError.forbidden('You have no marketplace account');
    }

    const scope: Record<string, unknown> = { deletedAt: null };
    if (merchant) scope.merchant = merchant._id;
    else if (customer) scope.customer = customer._id;

    const orders = await Order.find(scope).sort('-createdAt').limit(500).lean().exec();

    const byStatus: Record<string, number> = {};
    for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

    const held = orders.filter((o) => isEscrowHeld(o.status));
    const released = orders.filter((o) => o.status === 'released');

    return ok(res, {
      side: merchant ? 'merchant' : customer ? 'customer' : 'observer',
      account: merchant
        ? { id: merchant._id, name: merchant.tradingName, verified: merchant.verificationStatus === 'verified' }
        : customer
          ? { id: customer._id, name: customer.accountName, verified: customer.verificationStatus === 'verified' }
          : null,
      orders: {
        total: orders.length,
        byStatus,
        // The number both sides actually want: what is currently tied up.
        escrowHeldCount: held.length,
        escrowHeldValue: held.reduce((s, o) => s + o.total, 0),
        settledValue: released.reduce((s, o) => s + (merchant ? o.merchantNet : o.total), 0),
        commissionPaid: merchant ? released.reduce((s, o) => s + o.platformFee, 0) : null,
      },
      awaitingAction: orders
        .filter((o) => nextStatuses(o.status, merchant ? 'merchant' : 'buyer').length > 0)
        .slice(0, 10)
        .map((o) => ({
          _id: o._id, reference: o.reference, status: o.status,
          statusLabel: describeStatus(o.status), total: o.total, currency: o.currency,
          createdAt: o.createdAt,
        })),
    });
  }),
);

export const listingModule = {
  mounts: [
    { path: 'listings', router: listingsRouter },
    { path: 'listing', router: listingRouter },
  ],
};

export const orderModule = {
  mounts: [
    { path: 'orders', router: ordersRouter },
    { path: 'order', router: orderRouter },
    { path: 'marketplace', router: marketplaceRouter },
  ],
};

export { Listing, Order, MerchantProfile, CustomerProfile };
export * from './marketplace.validation.js';
