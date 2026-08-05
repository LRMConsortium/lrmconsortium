/**
 * What an order costs, and who ends up with which part of it.
 *
 * Pure and Mongoose-free, like the rent schedule and the ride ledger, and for
 * the same reason: these are the numbers people argue about. A merchant
 * querying a settlement and the buyer querying their receipt must be looking at
 * figures produced by one function, or the difference between them is a dispute
 * nobody can close.
 *
 * Everything works through `money()` — rounding once at the point of
 * computation rather than letting float drift accumulate down a forty-line
 * order.
 */

import { commissionSplit, money, type CommissionSplit } from '../payment/ledger.js';

export { money };

/** Default LRMC commission on a marketplace order, in percent. */
export const DEFAULT_MARKETPLACE_COMMISSION_PERCENT = 8;

/**
 * How long a merchant waits for a silent buyer before the money releases
 * anyway.
 *
 * Escrow protects the buyer. Escrow with no time limit *strips* the merchant:
 * a buyer who receives their goods and simply never presses "confirm" would
 * hold the merchant's money for ever, and would have no reason to press it.
 * Seven days from fulfilment is long enough to inspect goods and short enough
 * that a trading business can plan around it.
 */
export const AUTO_RELEASE_DAYS = 7;

/** A buyer's window to cancel without the merchant's agreement. */
export const FREE_CANCELLATION_HOURS = 24;

export interface OrderLineInput {
  listingId: string;
  title: string;
  /** Minor-unit-safe price for one unit, at the moment of ordering. */
  unitPrice: number;
  quantity: number;
}

export interface OrderLine extends OrderLineInput {
  lineTotal: number;
}

export interface OrderTotals {
  lines: OrderLine[];
  lineCount: number;
  /** Sum of the lines, before anything is added. */
  subtotal: number;
  deliveryFee: number;
  /** What the buyer pays. */
  total: number;
  commissionPercent: number;
  /** LRMC's cut. */
  platformFee: number;
  /** What the merchant is owed once the order completes. */
  merchantNet: number;
  currency: string;
}

/**
 * Price an order.
 *
 * Two decisions worth stating, because both are the kind that quietly corrupt
 * a ledger if made the other way:
 *
 * **The price is copied onto the line, not referenced.** A listing whose price
 * changes next Tuesday must not retroactively change what somebody agreed to
 * pay last Friday. The caller passes the price it showed the buyer; this
 * function never looks a price up.
 *
 * **Commission is charged on the goods, not on delivery.** The delivery fee is
 * money that covers a real cost somebody incurred moving the item. Taking a
 * percentage of it means the merchant funds LRMC's cut out of their own
 * courier bill, which they will notice and resent, and they will be right to.
 */
export function priceOrder(
  input: OrderLineInput[],
  options: {
    deliveryFee?: number;
    commissionPercent?: number;
    currency?: string;
  } = {},
): OrderTotals {
  const commissionPercent = clampPercent(
    options.commissionPercent ?? DEFAULT_MARKETPLACE_COMMISSION_PERCENT,
  );
  const deliveryFee = Math.max(0, money(options.deliveryFee ?? 0));

  const lines: OrderLine[] = input.map((l) => {
    const unitPrice = Math.max(0, money(l.unitPrice));
    // Quantities are whole things. A floor rather than a round, so 2.9 widgets
    // is two widgets and never three the buyer did not ask for.
    const quantity = Math.max(0, Math.floor(l.quantity));
    return { ...l, unitPrice, quantity, lineTotal: money(unitPrice * quantity) };
  });

  const subtotal = money(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const split: CommissionSplit = commissionSplit(subtotal, commissionPercent);

  return {
    lines,
    lineCount: lines.length,
    subtotal,
    deliveryFee,
    total: money(subtotal + deliveryFee),
    commissionPercent,
    platformFee: split.platformFee,
    // The merchant keeps the delivery fee in full, on top of the net goods.
    merchantNet: money(split.net + deliveryFee),
    currency: options.currency ?? 'GHS',
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MARKETPLACE_COMMISSION_PERCENT;
  return Math.min(100, Math.max(0, value));
}

/**
 * Does the money add up?
 *
 * Called before an order is written and before escrow releases. The
 * alternative is discovering an imbalance in a month-end reconciliation, by
 * which point it has been paid out and the person it belongs to has spent it.
 */
export function totalsBalance(t: OrderTotals): boolean {
  const linesAddUp = money(t.lines.reduce((s, l) => s + l.lineTotal, 0)) === t.subtotal;
  const totalAddsUp = money(t.subtotal + t.deliveryFee) === t.total;
  const splitAddsUp = money(t.platformFee + t.merchantNet) === t.total;
  return linesAddUp && totalAddsUp && splitAddsUp;
}

/**
 * A partial refund, and what it does to LRMC's commission.
 *
 * The commission is refunded **pro rata**, not kept. Keeping the full fee on a
 * half-refunded order means LRMC profits more, proportionally, the worse the
 * merchant's service was — an incentive nobody should build on purpose.
 */
export interface RefundBreakdown {
  refundToBuyer: number;
  commissionReturned: number;
  merchantBears: number;
  isFull: boolean;
}

export function refundBreakdown(t: OrderTotals, refundAmount: number): RefundBreakdown {
  const requested = Math.max(0, money(refundAmount));
  const refund = Math.min(requested, t.total);
  const proportion = t.total > 0 ? refund / t.total : 0;

  const commissionReturned = money(t.platformFee * proportion);
  return {
    refundToBuyer: refund,
    commissionReturned,
    // The remainder comes out of what the merchant would have received.
    merchantBears: money(refund - commissionReturned),
    isFull: refund === t.total,
  };
}

/**
 * When does escrow release on its own?
 *
 * Null when there is nothing to wait for.
 */
export function autoReleaseAt(fulfilledAt: Date | null, days = AUTO_RELEASE_DAYS): Date | null {
  if (!fulfilledAt) return null;
  return new Date(fulfilledAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Has the auto-release moment passed? */
export function autoReleaseDue(
  fulfilledAt: Date | null,
  asOf: Date,
  days = AUTO_RELEASE_DAYS,
): boolean {
  const at = autoReleaseAt(fulfilledAt, days);
  return at !== null && at.getTime() <= asOf.getTime();
}

/**
 * May the buyer cancel unilaterally?
 *
 * Inside the free window, yes. After it, cancellation needs the merchant —
 * because by then they may have bought materials, booked a van, or turned down
 * other work.
 */
export function withinFreeCancellation(
  placedAt: Date,
  asOf: Date,
  hours = FREE_CANCELLATION_HOURS,
): boolean {
  return asOf.getTime() - placedAt.getTime() <= hours * 60 * 60 * 1000;
}
