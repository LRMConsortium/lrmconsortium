/**
 * How LRMC recognises an email address and a phone number.
 *
 * Pure — no Mongoose — for exactly the reason `currencies.ts` is pure: these are
 * rules worth asserting, and they lived in `schemaFragments.ts`, which defines
 * Mongoose schemas. A suite that runs without a database could not import them,
 * so the only way to check them was to read source text and hope.
 *
 * ── The phone pattern is deliberately loose ───────────────────────────────
 * It would be easy, and wrong, to narrow this to `+220`. LRMC exists partly so
 * that a Gambian working in London can let a property in Serrekunda, and that
 * landlord has a British number. A validator that refused it would refuse the
 * diaspora — which is a substantial part of who this platform is for.
 *
 * What it does refuse is anything that is not a plausible international number
 * at all: letters, punctuation, and lengths outside E.164's range.
 */

/** Deliberately not RFC 5322. A parser that accepts every legal address also
 *  accepts a great many typos, and the confirmation email is the real check. */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * E.164-ish: an optional `+` and 7–15 digits.
 *
 * Permissive enough for The Gambia (+220), Ghana (+233), Nigeria (+234) and a
 * diaspora landlord anywhere. See the note above on why it is not narrower.
 */
export const PHONE_REGEX = /^\+?[0-9]{7,15}$/;
