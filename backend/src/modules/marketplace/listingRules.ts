/**
 * What a listing may be, and when it may be bought.
 *
 * Pure. The stock arithmetic in particular has to be testable without a
 * database, because overselling is the failure that produces a buyer holding a
 * receipt for a thing that does not exist.
 */

export const LISTING_KINDS = ['product', 'service'] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export const LISTING_STATUSES = ['draft', 'pending', 'published', 'suspended', 'archived'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Ceiling on a single listing's price, in major units. */
export const MAX_UNIT_PRICE = 5_000_000;
/** Most of any one line a buyer may take at once. */
export const MAX_ORDER_QUANTITY = 999;

export interface ListingShape {
  kind: ListingKind;
  status: ListingStatus;
  title: string;
  unitPrice: number;
  /** Products only. Services have no stock — they have availability. */
  stock?: number | null;
  merchantVerified: boolean;
}

export interface PublishVerdict {
  publishable: boolean;
  problems: string[];
}

/**
 * May this listing go live?
 *
 * Collects **every** problem rather than returning on the first. A merchant
 * fixing one fault per submission, four times, is a merchant who gives up on
 * the third — and each round trip is a coordinator's time too.
 */
export function canPublish(listing: ListingShape): PublishVerdict {
  const problems: string[] = [];

  if (!listing.title || listing.title.trim().length < 3) {
    problems.push('A title of at least three characters is required');
  }
  if (!(listing.unitPrice > 0)) {
    problems.push('A price above zero is required');
  }
  if (listing.unitPrice > MAX_UNIT_PRICE) {
    problems.push(`A price above ${MAX_UNIT_PRICE} needs Back Office approval`);
  }
  // The verification gate. A marketplace that lists unverified merchants is a
  // marketplace whose first fraud is LRMC's fault, not the buyer's.
  if (!listing.merchantVerified) {
    problems.push('The merchant is not yet verified');
  }
  if (listing.kind === 'product') {
    if (listing.stock === null || listing.stock === undefined) {
      problems.push('A product needs a stock count');
    } else if (listing.stock < 0) {
      problems.push('Stock cannot be negative');
    }
  }
  if (listing.status === 'archived') {
    problems.push('An archived listing cannot be published');
  }

  return { publishable: problems.length === 0, problems };
}

/** Can a buyer order this, right now, in this quantity? */
export interface OrderabilityVerdict {
  orderable: boolean;
  reason?: 'notPublished' | 'outOfStock' | 'insufficientStock' | 'badQuantity' | 'overLimit';
  /** How many are actually available, when the refusal was about stock. */
  available?: number;
}

export function canOrder(listing: ListingShape, quantity: number): OrderabilityVerdict {
  if (listing.status !== 'published') return { orderable: false, reason: 'notPublished' };

  if (!Number.isInteger(quantity) || quantity < 1) {
    return { orderable: false, reason: 'badQuantity' };
  }
  if (quantity > MAX_ORDER_QUANTITY) return { orderable: false, reason: 'overLimit' };

  // Services are not stocked. A plumber does not run out of plumbing.
  if (listing.kind === 'service') return { orderable: true };

  const stock = listing.stock ?? 0;
  if (stock <= 0) return { orderable: false, reason: 'outOfStock', available: 0 };
  if (quantity > stock) return { orderable: false, reason: 'insufficientStock', available: stock };

  return { orderable: true };
}

/**
 * Stock after an order is placed.
 *
 * Floors at zero rather than going negative. A negative stock count is a
 * number that will eventually be shown to somebody, and "-3 in stock" tells a
 * merchant nothing they can act on — the useful signal is that it hit zero,
 * which `canOrder` already refuses on.
 */
export function stockAfterOrder(listing: ListingShape, quantity: number): number | null {
  if (listing.kind === 'service') return null;
  return Math.max(0, (listing.stock ?? 0) - Math.max(0, Math.floor(quantity)));
}

/**
 * Stock after an order is cancelled or refunded.
 *
 * Returning stock is not merely the inverse of taking it: a refund on a
 * *service* must not invent stock on something that never had any.
 */
export function stockAfterRelease(listing: ListingShape, quantity: number): number | null {
  if (listing.kind === 'service') return null;
  return Math.max(0, (listing.stock ?? 0) + Math.max(0, Math.floor(quantity)));
}

/** Should this listing drop out of the catalogue on its own? */
export function autoUnpublish(listing: ListingShape): boolean {
  return listing.kind === 'product' && listing.status === 'published' && (listing.stock ?? 0) <= 0;
}
