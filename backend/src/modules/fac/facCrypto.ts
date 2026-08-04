/**
 * How a Founder Authorisation Code is turned into something safe to store.
 *
 * The problem this file exists for: the FAC space is only 10^6. bcrypt at cost
 * 12 costs an attacker ~250ms per guess, which sounds like a lot until you
 * multiply — 924,553 candidates is about 64 hours single-threaded, and well
 * under an hour on a modest cluster. **A leaked database dump yields the code.**
 * bcrypt alone protects against casual exposure, not against someone holding
 * the dump.
 *
 * The fix is a *pepper*: HMAC the code with a secret that lives in the
 * environment rather than in Mongo. An attacker with the database and without
 * the application secret has nothing to attack — every candidate hashes to a
 * value they cannot compute. It costs one HMAC per verification and turns a
 * weekend of GPU time into an impossibility.
 *
 * Two implementation details that matter:
 *
 * **Hex, not raw bytes.** bcrypt treats a NUL byte as a string terminator in
 * several implementations, silently truncating the input. A hex digest cannot
 * contain one.
 *
 * **64 characters, comfortably under bcrypt's 72-byte ceiling.** bcrypt
 * discards anything past 72 bytes without complaint. SHA-256 hex is 64, so
 * every byte of the digest is actually hashed. Base64 would also fit; hex is
 * chosen for the NUL-safety above.
 *
 * This file imports nothing but `node:crypto`. The bcrypt binding lives next
 * door in `facHashing.ts`, so `npm run verify` can assert the peppering with no
 * `npm install` — which is the property that keeps the suite runnable in a
 * second.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { secretProblem } from '../../config/secretHygiene.js';

/** SHA-256 hex is 64 chars; bcrypt silently truncates past 72. */
export const PEPPERED_LENGTH = 64;
export const BCRYPT_MAX_BYTES = 72;

/** Minimum acceptable pepper length. Enforced by the env schema too. */
export const MIN_PEPPER_LENGTH = 32;

/**
 * HMAC-SHA256 the code with the server-side pepper.
 *
 * Pure apart from the crypto primitive, and deterministic — the same code and
 * pepper always produce the same digest, which is what makes verification
 * possible at all.
 */
export function pepperCode(code: string, pepper: string): string {
  if (!pepper || pepper.length < MIN_PEPPER_LENGTH) {
    throw new Error(`FAC pepper must be at least ${MIN_PEPPER_LENGTH} characters`);
  }
  return createHmac('sha256', pepper).update(code, 'utf8').digest('hex');
}

/**
 * Constant-time string comparison, for anywhere a digest is compared directly.
 *
 * Not used on the bcrypt path — `bcrypt.compare` already does this — but
 * available so that any future code path comparing two peppered digests does
 * not reach for `===` and leak a length or a prefix through timing.
 */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Is this pepper strong enough to bother having?
 *
 * Returns the reason it is not, or null. Called at boot rather than at first
 * verification, so a misconfigured deployment fails immediately instead of at
 * the moment a founder needs Zone A.
 */
export function validatePepper(pepper: string | undefined): string | null {
  // Length, placeholder wording and character variety all live in
  // `secretHygiene`, because none of those failures are specific to the FAC —
  // a JWT secret left saying "change-me" is the same bug with worse blast
  // radius, and one implementation means one place to fix it.
  return secretProblem('FAC_PEPPER', pepper, MIN_PEPPER_LENGTH);
}
