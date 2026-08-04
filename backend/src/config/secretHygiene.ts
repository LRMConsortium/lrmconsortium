/**
 * Does this "secret" actually contain any secret?
 *
 * The hole this closes is unglamorous and extremely common: somebody copies
 * `.env.example` to `.env` on the production box, fills in the database URI
 * because nothing works without it, and leaves the secrets as shipped. Every
 * length check passes. Every schema validates. The process boots happily. And
 * the signing key for every JWT on the platform is a string published in the
 * repository.
 *
 * A length rule cannot catch this, because the placeholder is long — we wrote
 * it that way on purpose so it would look like a real key. So the check has to
 * be about *content*, not size.
 *
 * Two families of rejection:
 *
 * 1. **Known placeholder wording.** Substrings that no generated secret would
 *    ever contain. `change-me`, `your-secret`, `todo`. Cheap and catches the
 *    exact failure above.
 * 2. **Structural poverty.** A value with almost no distinct characters, or one
 *    that is a single character repeated, is not a secret regardless of what it
 *    says. `aaaaaaaa…` and `00000000…` both defeat a wording list.
 *
 * Deliberately *not* an entropy estimator. A real strength model would reject
 * things a human considers fine and produce arguments at 3am during a deploy.
 * This rejects only what is unambiguously wrong, and says why.
 *
 * Pure — imports nothing at all — so `npm run verify` can exercise it with no
 * `npm install` and no environment loaded.
 */

/**
 * Wording that only ever appears in a value nobody replaced.
 *
 * Matched case-insensitively against the whole value. Keep these unambiguous:
 * a real random hex string will never contain them, and a false positive here
 * means a refusal to boot.
 */
export const PLACEHOLDER_MARKERS = [
  'change-me',
  'changeme',
  'change_me',
  'your-secret',
  'your_secret',
  'yoursecret',
  'placeholder',
  'replace-me',
  'replaceme',
  'secret-here',
  'insert-secret',
  'todo',
  'fixme',
  'example',
  'dummy',
  'xxxxxxxx',
] as const;

/** Below this, a value has too few distinct characters to be random. */
export const MIN_DISTINCT_CHARS = 8;

/**
 * Returns the placeholder marker found, or null.
 *
 * Returning the marker rather than a boolean means the boot error can quote the
 * offending fragment, which is the difference between "your secret is invalid"
 * and "your secret still says change-me".
 */
export function placeholderMarkerIn(value: string): string | null {
  const lower = value.toLowerCase();
  for (const marker of PLACEHOLDER_MARKERS) {
    if (lower.includes(marker)) return marker;
  }
  return null;
}

/**
 * Is this value structurally too poor to be a secret, whatever it says?
 */
export function hasTooLittleVariety(value: string): boolean {
  return new Set(value).size < MIN_DISTINCT_CHARS;
}

/**
 * The full check. Returns the human-readable reason it is not acceptable, or
 * null if it is.
 *
 * `name` is threaded through only so the message names the variable — an
 * operator reading a crashed boot log should not have to guess which of four
 * secrets is the problem.
 */
export function secretProblem(name: string, value: string | undefined, minLength = 32): string | null {
  if (!value) return `${name} is not set`;
  if (value.length < minLength) {
    return `${name} must be at least ${minLength} characters, got ${value.length}`;
  }
  const marker = placeholderMarkerIn(value);
  if (marker) {
    return `${name} still contains the placeholder text "${marker}" — it was never replaced`;
  }
  if (hasTooLittleVariety(value)) {
    return `${name} has fewer than ${MIN_DISTINCT_CHARS} distinct characters, so it is not a real secret`;
  }
  return null;
}

/**
 * How to make a good one. Quoted verbatim in boot errors so the fix is in the
 * same message as the failure — nobody should have to search documentation
 * while production is down.
 */
export const SECRET_GENERATION_HINT =
  "  node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\"";
