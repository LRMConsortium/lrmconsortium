/**
 * The bcrypt binding for Founder Authorisation Codes.
 *
 * Separated from `facCrypto.ts` for one reason: that file imports nothing but
 * `node:crypto`, so `npm run verify` can assert the peppering with no install.
 * bcrypt is a real dependency, so everything that needs it lives here and the
 * assertion suite never has to reach for it.
 *
 * The order is not negotiable: **pepper, then bcrypt.** bcrypt alone over a
 * 10^6 space is ~64 hours of single-threaded work against a leaked dump.
 * Peppered, the dump is worthless without the application secret.
 */

import bcrypt from 'bcryptjs';
import { pepperCode } from './facCrypto.js';

/** Hash a code for storage. Never call bcrypt on a raw code. */
export async function hashCode(code: string, pepper: string, rounds = 12): Promise<string> {
  return bcrypt.hash(pepperCode(code, pepper), rounds);
}

/**
 * Verify a submitted code against a stored digest.
 *
 * `bcrypt.compare` is already constant-time with respect to the digest, so
 * peppering is the only step added. A malformed digest returns `false` rather
 * than throwing: a corrupt row should read as "wrong code", not as a 500 that
 * tells an attacker their input reached something unusual.
 */
export async function verifyCode(
  code: string,
  storedHash: string,
  pepper: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(pepperCode(code, pepper), storedHash);
  } catch {
    return false;
  }
}
