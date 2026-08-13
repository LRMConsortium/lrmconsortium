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
export const CURRENCIES = ['GMD', 'GHS', 'USD', 'EUR', 'GBP', 'NGN', 'XOF'] as const;

export type Currency = (typeof CURRENCIES)[number];

/** What the platform stores and prints unless told otherwise. */
export const LAUNCH_CURRENCY: Currency = 'GMD';

/* ─────────────────────────────────────────────────────────────────────────
 * Where LRMC actually is
 *
 * These are here, beside `LAUNCH_CURRENCY`, because they are the same fact.
 * They were not, for four weeks: the currency said GMD while every profile
 * schema defaulted `residenceCountry` to `'Ghana'` and every footer said
 * "Accra, Ghana". A tenant registering in Banjul was recorded as resident in
 * another country, and nothing in the codebase was in a position to notice,
 * because the country was a literal in nine places and the currency was a
 * constant in one.
 *
 * One place, imported everywhere, asserted in `verify.ts`.
 * ──────────────────────────────────────────────────────────────────────── */

/** The country LRMC operates in, and the default on every profile. */
export const LAUNCH_COUNTRY = 'The Gambia';

/** The city LRMC operates from. */
export const LAUNCH_CITY = 'Banjul';

/** The two together, as every footer and address line writes them. */
export const LAUNCH_LOCATION = `${LAUNCH_CITY}, ${LAUNCH_COUNTRY}`;

/**
 * The dialling code for a local number.
 *
 * Used to *format* and to suggest, never to restrict: `PHONE_REGEX` stays
 * broad on purpose. LRMC exists partly so somebody in London can let property
 * at home, and a landlord abroad has a foreign number.
 */
export const LAUNCH_DIALLING_CODE = '+220';

/* ─────────────────────────────────────────────────────────────────────────
 * What LRMC charges
 *
 * A percentage that lives only in HTML is a percentage the ledger cannot agree
 * with — and these disagreed: `ledger.ts` was already splitting 15% off every
 * fare while the pricing page said "to confirm". The page now reads both of
 * these out of this file at build time, and `verify.ts` fails if the two ever
 * part company. A fee published on the marketing site and a different fee
 * taken from somebody's rent is not a formatting bug.
 * ──────────────────────────────────────────────────────────────────────── */

/** LRMC's share of rent collected, as a percentage. */
export const MANAGEMENT_FEE_PERCENT = 10;

/** Ususu's share of each fare, as a percentage. */
export const RIDE_COMMISSION_PERCENT = 15;

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
