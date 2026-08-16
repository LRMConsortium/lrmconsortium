/**
 * Currencies the platform recognises.
 *
 * Its own file, and pure, for one reason: `npm run verify` runs without a
 * database and therefore without importing Mongoose. Leaving this list inside
 * `schemaFragments.ts` — which defines Mongoose schemas — would mean the
 * assertions that pin the launch currency could not import it, and the most
 * consequential constant on the platform would be checked by reading source
 * text instead of by reading the value.
 *
 * **GMD leads because LRMC launches in The Gambia.** GHS stays because the
 * consortium is Ghana-registered and will trade there.
 *
 * A note on the order: nothing should depend on it. Every schema names its
 * default explicitly, so reordering this array cannot silently redenominate a
 * collection. The first position is a statement of intent, not a mechanism.
 */
import { marketFor } from './markets.js';

export const CURRENCIES = ['GMD', 'GHS', 'USD', 'EUR', 'GBP', 'NGN', 'XOF'] as const;

export type Currency = (typeof CURRENCIES)[number];

/* ═══════════════════════════════════════════════════════════════════════════
 * The active market
 *
 * These six were literal constants until the US pilot and the Gambia launch
 * became two deployments of one code line. The *shape* is unchanged on purpose
 * — one place, imported everywhere, asserted in `verify.ts` — so none of the
 * hundred call sites moved. Only the selection is configuration now, and it
 * lives in `markets.ts`.
 *
 * `LRMC_MARKET` picks the market. Production refuses to boot without an
 * explicit one, because the way this goes wrong is deploying the pilot's
 * configuration to Banjul and quoting everybody in dollars.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The market this process serves, resolved once at import. */
export const MARKET = marketFor(process.env.LRMC_MARKET ?? 'gambia');

/** What the platform stores and prints unless told otherwise. */
export const LAUNCH_CURRENCY: Currency = MARKET.currency;

/** The country LRMC operates in, and the default on every profile. */
export const LAUNCH_COUNTRY = MARKET.country;

/**
 * The city LRMC operates from.
 *
 * Empty string rather than `null` at this boundary: every consumer prints it,
 * and `marketProblems()` is what refuses the boot when it is undecided. A type
 * that could be null here would push a null check into forty call sites to
 * restate a rule already enforced once.
 */
export const LAUNCH_CITY = MARKET.city ?? '';

/** The two together, as every footer and address line writes them. */
export const LAUNCH_LOCATION = MARKET.city ? `${MARKET.city}, ${MARKET.country}` : MARKET.country;

/**
 * The dialling code for a local number.
 *
 * Used to *format* and to suggest, never to restrict: `PHONE_REGEX` stays
 * broad on purpose. LRMC exists partly so somebody in London can let property
 * at home, and a landlord abroad has a foreign number.
 */
export const LAUNCH_DIALLING_CODE = MARKET.diallingCode;

/* ─────────────────────────────────────────────────────────────────────────
 * What LRMC charges
 *
 * A percentage that lives only in HTML is a percentage the ledger cannot agree
 * with — and these disagreed: `ledger.ts` was already splitting 15% off every
 * fare while the pricing page said "to confirm". The page reads both of these
 * at build time and `verify.ts` fails if the two part company. A fee published
 * on the marketing site and a different fee taken from somebody's rent is not
 * a formatting bug.
 *
 * `-1` when the market has not decided. Deliberately not `0`: a zero fee is a
 * decision somebody should have to write down, and a market carrying `-1`
 * cannot reach production — `marketProblems()` refuses the boot.
 */

/** LRMC's share of rent collected, as a percentage. */
export const MANAGEMENT_FEE_PERCENT = MARKET.managementFeePercent ?? -1;

/** Ususu's share of each fare, as a percentage. */
export const RIDE_COMMISSION_PERCENT = MARKET.rideCommissionPercent ?? -1;

/**
 * How each currency is written, for any surface that needs the symbol rather
 * than the code.
 *
 * The Gambian Dalasi is written `D 1,000` — symbol, space, comma thousands,
 * dot decimal. Kept here so the backend and the frontend cannot disagree about
 * it; `frontend/assets/js/ui.js` mirrors this table.
 */
export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  GMD: 'D',
  GHS: 'GH₵',
  USD: '$',
  EUR: '€',
  GBP: '£',
  NGN: '₦',
  XOF: 'CFA',
};
