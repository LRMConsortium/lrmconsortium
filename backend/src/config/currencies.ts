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
