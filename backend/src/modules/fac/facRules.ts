/**
 * The Founder Authorisation Code — format, strength, rotation.
 *
 * FAC sits *in front of* Zone A. A founder holds the role permanently; the code
 * proves they are at the keyboard right now. That distinction is the whole
 * point: a stolen session, a forgotten laptop or a coerced login all still fail
 * at the code.
 *
 * Pure and Mongoose-free, like every rule module here, so the arithmetic that
 * decides a lockout can be asserted with no database.
 *
 * ## An honest note on entropy
 *
 * Six digits is 10^6 — about **19.9 bits**. That is weak as a secret and would
 * be indefensible on its own. What makes it workable is that it is never
 * offered to an unbounded attacker: three attempts, then a 24-hour lockout,
 * per actor. `expectedBruteForceYears()` below computes what that actually
 * buys, and it is asserted in verify rather than assumed. If the attempt limit
 * or the lockout is ever relaxed, that assertion is what will notice.
 *
 * The code is a *second factor over an already-authenticated founder*, not a
 * password. It is never stored in plaintext and never returned twice.
 */

export const FAC_CODE_LENGTH = 6;
export const FAC_ROTATION_DAYS = 90;
export const FAC_MAX_ATTEMPTS = 3;
export const FAC_LOCKOUT_HOURS = 24;
/** Days before expiry at which the console starts warning. */
export const FAC_EXPIRY_WARNING_DAYS = 7;
/**
 * How long a successful verification stays good.
 *
 * Deliberately short. "Admin session initiated" must not mean "admin until you
 * log out" — an unattended console should fall back to needing the code.
 */
export const FAC_CLEARANCE_MINUTES = 30;

export const MS_PER_DAY = 86_400_000;
export const MS_PER_HOUR = 3_600_000;

export const ROTATION_TRIGGERS = [
  'scheduled',
  'roleChange',
  'manual',
  'compromise',
  'lockoutThreshold',
] as const;
export type RotationTrigger = (typeof ROTATION_TRIGGERS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Format and strength
// ─────────────────────────────────────────────────────────────────────────────

export function isWellFormedCode(code: string): boolean {
  return typeof code === 'string' && new RegExp(`^\\d{${FAC_CODE_LENGTH}}$`).test(code);
}

export const CODE_WEAKNESSES = [
  'malformed',
  'allSameDigit',
  'sequentialAscending',
  'sequentialDescending',
  'repeatedPair',
  'palindrome',
  'looksLikeYear',
  'looksLikeDate',
] as const;
export type CodeWeakness = (typeof CODE_WEAKNESSES)[number];

/**
 * Every reason this code is a poor choice, not just the first.
 *
 * With only a million possibilities, the handful a human would actually pick —
 * `123456`, `000000`, a birth year, a date — are the ones an attacker tries
 * first. Rejecting them at issuance costs nothing and removes the entire top of
 * the guess list. Reported as a list so the founder generating a code sees why.
 */
export function codeWeaknesses(code: string): CodeWeakness[] {
  if (!isWellFormedCode(code)) return ['malformed'];
  const found: CodeWeakness[] = [];
  const digits = code.split('').map(Number);

  if (new Set(digits).size === 1) found.push('allSameDigit');

  const ascending = digits.every((d, i) => i === 0 || d === (digits[i - 1]! + 1) % 10);
  const descending = digits.every((d, i) => i === 0 || d === (digits[i - 1]! + 9) % 10);
  if (ascending) found.push('sequentialAscending');
  if (descending) found.push('sequentialDescending');

  // 121212, 454545 — a two-digit pattern tripled.
  if (code.slice(0, 2) === code.slice(2, 4) && code.slice(2, 4) === code.slice(4, 6)) {
    found.push('repeatedPair');
  }

  if (code === code.split('').reverse().join('')) found.push('palindrome');

  // 19xx / 20xx in either half — birth years and anniversaries.
  if (/^(19|20)\d{2}/.test(code) || /(19|20)\d{2}$/.test(code)) found.push('looksLikeYear');

  // DDMMYY / MMDDYY shaped.
  const a = Number(code.slice(0, 2));
  const b = Number(code.slice(2, 4));
  if (a >= 1 && a <= 31 && b >= 1 && b <= 12) found.push('looksLikeDate');

  return found;
}

export function isAcceptableCode(code: string): boolean {
  return codeWeaknesses(code).length === 0;
}

/**
 * Generate an acceptable code from an injected random source.
 *
 * The source is a parameter so this stays pure and the generator is testable
 * against a seeded PRNG. Production passes a CSPRNG; nothing here should ever
 * be handed `Math.random`.
 *
 * Rejection-samples until the code passes `isAcceptableCode`, with a bounded
 * number of tries so a pathological source cannot hang the process.
 */
export function generateCode(random: () => number, maxTries = 200): string {
  for (let i = 0; i < maxTries; i += 1) {
    let code = '';
    for (let d = 0; d < FAC_CODE_LENGTH; d += 1) {
      code += digitFrom(random()).toString();
    }
    if (isAcceptableCode(code)) return code;
  }
  throw new Error('Could not generate an acceptable FAC code; the random source is suspect');
}

/**
 * One digit from one draw in [0, 1).
 *
 * The clamp is the load-bearing part. A source returning exactly 1.0 would
 * otherwise yield digit 10 and produce a seven-character "six-digit" code — so
 * it is clamped rather than trusted. `Math.max(0, …)` guards the mirror case.
 *
 * Note what this does *not* do: it never takes a modulus. The production source
 * hands over one uniform digit's worth of randomness per call (see
 * `secureRandom` in this module's router), so there is no large range being
 * folded into ten buckets and no modulo bias to reason about. An earlier
 * version divided a 20-bit integer down and happened to be unbiased only
 * because 1,000,000 divides by 10 — true, but true by luck, and silently
 * false the moment anyone changed the constant.
 */
export function digitFrom(value: number): number {
  const clamped = Math.max(0, Math.min(0.999999999, value));
  return Math.floor(clamped * 10);
}

/** Honest entropy, in bits. 6 digits is ~19.93 — see the module note. */
export function codeEntropyBits(length = FAC_CODE_LENGTH): number {
  return Math.round(length * Math.log2(10) * 100) / 100;
}

/**
 * What the attempt limit actually buys, in years.
 *
 * Expected guesses to hit a uniform 6-digit code is 10^6 / 2. At
 * `maxAttempts` per `lockoutHours`, this is the expected time to succeed by
 * brute force. Asserted in verify, so relaxing the limit fails a test rather
 * than quietly weakening the platform.
 */
export function expectedBruteForceYears(
  maxAttempts = FAC_MAX_ATTEMPTS,
  lockoutHours = FAC_LOCKOUT_HOURS,
  length = FAC_CODE_LENGTH,
): number {
  const space = 10 ** length;
  const expectedGuesses = space / 2;
  const hours = (expectedGuesses / Math.max(1, maxAttempts)) * lockoutHours;
  return Math.round((hours / 24 / 365.25) * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotation
// ─────────────────────────────────────────────────────────────────────────────

export function nextRotationDate(issuedAt: Date, rotationDays = FAC_ROTATION_DAYS): Date {
  return new Date(issuedAt.getTime() + rotationDays * MS_PER_DAY);
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole calendar days, so a code expiring at 23:00 tonight expires *today*. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);
}

export const CODE_HEALTH = ['active', 'expiringSoon', 'expired'] as const;
export type CodeHealth = (typeof CODE_HEALTH)[number];

export interface CodeClock {
  expiresAt: Date;
  daysRemaining: number;
  health: CodeHealth;
  expired: boolean;
  /** True inside the warning window; the console should be nagging by now. */
  warning: boolean;
  rotationDue: boolean;
}

export function codeClock(
  issuedAt: Date,
  asOf: Date,
  rotationDays = FAC_ROTATION_DAYS,
  warningDays = FAC_EXPIRY_WARNING_DAYS,
): CodeClock {
  const expiresAt = nextRotationDate(issuedAt, rotationDays);
  const daysRemaining = daysBetween(asOf, expiresAt);
  const expired = daysRemaining < 0;
  const warning = !expired && daysRemaining <= warningDays;

  return {
    expiresAt,
    daysRemaining,
    health: expired ? 'expired' : warning ? 'expiringSoon' : 'active',
    expired,
    warning,
    rotationDue: expired || warning,
  };
}

/**
 * Does this trigger demand an immediate rotation, or merely schedule one?
 *
 * A suspected compromise and a role change invalidate the current code *now* —
 * the person who had it may no longer be entitled to it. A scheduled rotation
 * can wait for the founder to act.
 */
export function isImmediate(trigger: RotationTrigger): boolean {
  return trigger === 'compromise' || trigger === 'roleChange' || trigger === 'lockoutThreshold';
}

/** Human-readable line for the console. */
export function describeClock(clock: CodeClock): string {
  if (clock.expired) return `expired ${-clock.daysRemaining} day${clock.daysRemaining === -1 ? '' : 's'} ago`;
  if (clock.daysRemaining === 0) return 'expires today';
  return `expires in ${clock.daysRemaining} day${clock.daysRemaining === 1 ? '' : 's'}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The Zone A gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why a request into the Founder Command Center was allowed or refused.
 *
 * Named outcomes rather than a boolean because the three "no" cases want three
 * different things from the client: type your code, issue a code first, or wait
 * out a countdown. A bare `false` forces the console to guess, and a console
 * that guesses eventually guesses wrong in front of a founder.
 */
export type ClearanceDecision =
  | 'allow-cleared'
  | 'allow-bootstrap'
  | 'deny-no-clearance'
  | 'deny-no-code';

export interface ClearanceGateInput {
  /** Does this actor hold a live, unexpired, unrevoked clearance? */
  clearanceActive: boolean;
  /** Is there a code in force to have been verified against? */
  hasActiveCode: boolean;
  /**
   * Is this the route that issues codes?
   *
   * Exactly one route sets this, and it has to: issuing the first code is
   * itself a Zone A operation, so requiring a clearance for it would mean
   * needing a code to enter the room where codes are made. The exemption is
   * scoped to that single route rather than to the zone, so an expired or
   * revoked code cannot silently reopen the whole of Zone A.
   */
  bootstrapExempt: boolean;
}

/**
 * The whole gate, as arithmetic. No database, no Express, no clock.
 *
 * Order matters and is deliberate:
 *
 * 1. **A live clearance wins immediately.** Somebody proved presence; nothing
 *    else needs asking.
 * 2. **Bootstrap next, and only with no code in force.** Both halves are
 *    required. Flagging the route alone would leave a permanent hole at the
 *    most privileged endpoint on the platform; requiring the absence of a code
 *    closes it the moment the first one is issued.
 * 3. **No code, no entry.** Everything else in Zone A refuses, and says so
 *    distinctly, because "issue a code" and "type your code" are different
 *    instructions to give a founder staring at a locked screen.
 */
export function clearanceGate(input: ClearanceGateInput): ClearanceDecision {
  if (input.clearanceActive) return 'allow-cleared';
  if (input.bootstrapExempt && !input.hasActiveCode) return 'allow-bootstrap';
  if (!input.hasActiveCode) return 'deny-no-code';
  return 'deny-no-clearance';
}

/** Does this decision let the request through? */
export function gateAllows(decision: ClearanceDecision): boolean {
  return decision === 'allow-cleared' || decision === 'allow-bootstrap';
}

/** What to tell the human. */
export function describeGate(decision: ClearanceDecision): string {
  switch (decision) {
    case 'allow-cleared':
      return 'clearance is live';
    case 'allow-bootstrap':
      return 'no code has been issued yet, so the first issuance is permitted';
    case 'deny-no-code':
      return 'no Founder Authorisation Code is in force — issue one before entering Zone A';
    case 'deny-no-clearance':
      return 'a Founder Authorisation Code must be entered before this zone will open';
  }
}
