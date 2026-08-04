/**
 * Attempt counting, lockout, and the clearance window.
 *
 * The arithmetic behind "3/3 attempts remaining" and the 24-hour lockout. Two
 * decisions here are load-bearing and easy to get wrong in a way nobody notices
 * until it is exploited:
 *
 * **Lockouts are per actor, never per code.** If three failures locked *the
 * code*, one attacker with a stolen staff login could lock every founder out of
 * Zone A on demand — a denial-of-service dressed as a security control. The
 * ledger is keyed on who tried.
 *
 * **Failures are counted since the last success, not in a rolling window.** A
 * rolling window lets an attacker sit just under the rate and guess forever.
 * Counting since the last success means the only thing that clears the counter
 * is knowing the code.
 */

import {
  FAC_CLEARANCE_MINUTES,
  FAC_LOCKOUT_HOURS,
  FAC_MAX_ATTEMPTS,
  MS_PER_HOUR,
} from './facRules.js';

/**
 * `cleared` is not an attempt. It is a marker written when one founder lifts
 * another's lockout, and it exists so the override can be honest.
 *
 * The tempting shortcut is to write a `pass` row — the counter resets and
 * everything works. But the ledger would then claim somebody entered the
 * correct code when nobody did, and the attempt ledger is the one place an
 * auditor looks to find out what actually happened. A distinct result keeps
 * "they got in" and "a colleague let them in" as different facts.
 */
export const ATTEMPT_RESULTS = ['pass', 'fail', 'blocked', 'cleared'] as const;
export type AttemptResult = (typeof ATTEMPT_RESULTS)[number];

/** One row of the attempt ledger, reduced to what the arithmetic reads. */
export interface AttemptRecord {
  actor: string;
  at: Date;
  result: AttemptResult;
}

export const ATTEMPT_REFUSALS = ['lockedOut', 'noActiveCode', 'malformed'] as const;
export type AttemptRefusal = (typeof ATTEMPT_REFUSALS)[number];

export interface AttemptVerdict {
  /** May this actor attempt at all right now? */
  allowed: boolean;
  refusal?: AttemptRefusal;
  /** 1-based, the attempt this would be. */
  attemptNumber: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  lockedUntil: Date | null;
  /** Seconds until the lockout lifts, for the console countdown. */
  lockoutSecondsRemaining: number;
}

/**
 * Consecutive failures since this actor's last success.
 *
 * `blocked` rows — attempts refused because a lockout was already in force —
 * are not counted. They record that someone kept trying, which belongs in the
 * audit trail, but counting them would extend the lockout every time a client
 * retried and make it effectively permanent.
 *
 * `cleared` rows stop the count exactly as `pass` does. That is the entire
 * mechanism of the founder override: the failures are still in the ledger and
 * still readable, they simply sit on the far side of a line somebody drew.
 */
export function consecutiveFailures(history: readonly AttemptRecord[], actor: string): number {
  const mine = history.filter((a) => a.actor === actor);
  let count = 0;
  for (let i = mine.length - 1; i >= 0; i -= 1) {
    const entry = mine[i]!;
    if (entry.result === 'pass' || entry.result === 'cleared') break;
    if (entry.result === 'fail') count += 1;
  }
  return count;
}

/** The instant a lockout lifts, given the failure that triggered it. */
export function lockoutUntil(triggeredAt: Date, lockoutHours = FAC_LOCKOUT_HOURS): Date {
  return new Date(triggeredAt.getTime() + lockoutHours * MS_PER_HOUR);
}

/**
 * Can this actor try, and what would the attempt be numbered?
 *
 * Returns everything the console needs in one object: whether to enable the
 * form, what to print in "attempts remaining", and how long the countdown has
 * left. The router turns `allowed: false` into a 423 and writes a `blocked`
 * row; nothing else needs to know the rules.
 */
export function attemptVerdict(
  history: readonly AttemptRecord[],
  actor: string,
  asOf: Date,
  options: { maxAttempts?: number; lockoutHours?: number; hasActiveCode?: boolean } = {},
): AttemptVerdict {
  const maxAttempts = options.maxAttempts ?? FAC_MAX_ATTEMPTS;
  const lockoutHours = options.lockoutHours ?? FAC_LOCKOUT_HOURS;

  const failures = consecutiveFailures(history, actor);
  const mine = history.filter((a) => a.actor === actor && a.result === 'fail');
  const lastFailure = mine[mine.length - 1]?.at ?? null;

  const locked = failures >= maxAttempts && lastFailure !== null;
  const until = locked ? lockoutUntil(lastFailure, lockoutHours) : null;
  const stillLocked = until !== null && until.getTime() > asOf.getTime();

  // The lockout has lapsed: the counter is spent, and the actor starts again.
  const effectiveFailures = locked && !stillLocked ? 0 : failures;

  const base: AttemptVerdict = {
    allowed: true,
    attemptNumber: effectiveFailures + 1,
    attemptsUsed: effectiveFailures,
    attemptsRemaining: Math.max(0, maxAttempts - effectiveFailures),
    lockedUntil: stillLocked ? until : null,
    lockoutSecondsRemaining: stillLocked
      ? Math.max(0, Math.ceil((until!.getTime() - asOf.getTime()) / 1000))
      : 0,
  };

  if (stillLocked) {
    return { ...base, allowed: false, refusal: 'lockedOut', attemptsRemaining: 0 };
  }
  if (options.hasActiveCode === false) {
    return { ...base, allowed: false, refusal: 'noActiveCode' };
  }
  return base;
}

/** Would this failure be the one that triggers the lockout? */
export function failureTriggersLockout(
  verdict: AttemptVerdict,
  maxAttempts = FAC_MAX_ATTEMPTS,
): boolean {
  return verdict.attemptNumber >= maxAttempts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clearance
// ─────────────────────────────────────────────────────────────────────────────

export interface Clearance {
  granted: boolean;
  grantedAt: Date | null;
  expiresAt: Date | null;
  secondsRemaining: number;
  /** True while the clearance is live — what Zone A should actually check. */
  active: boolean;
}

export function grantClearance(at: Date, minutes = FAC_CLEARANCE_MINUTES): Clearance {
  const expiresAt = new Date(at.getTime() + minutes * 60_000);
  return {
    granted: true,
    grantedAt: at,
    expiresAt,
    secondsRemaining: minutes * 60,
    active: true,
  };
}

/**
 * Is a previously granted clearance still good?
 *
 * The reason this is a function of `asOf` rather than a stored boolean: a
 * clearance that is written as `true` and never re-evaluated is a clearance
 * that never expires. Zone A calls this on every request.
 */
export function clearanceState(
  grantedAt: Date | null,
  asOf: Date,
  minutes = FAC_CLEARANCE_MINUTES,
): Clearance {
  if (!grantedAt) {
    return { granted: false, grantedAt: null, expiresAt: null, secondsRemaining: 0, active: false };
  }
  const expiresAt = new Date(grantedAt.getTime() + minutes * 60_000);
  const secondsRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - asOf.getTime()) / 1000));
  return {
    granted: true,
    grantedAt,
    expiresAt,
    secondsRemaining,
    active: secondsRemaining > 0,
  };
}

/** Roll the ledger up for the console's attempt table and the HQ report. */
export function summariseAttempts(history: readonly AttemptRecord[]): {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  actors: number;
  lastAt: Date | null;
} {
  return {
    total: history.length,
    passed: history.filter((a) => a.result === 'pass').length,
    failed: history.filter((a) => a.result === 'fail').length,
    blocked: history.filter((a) => a.result === 'blocked').length,
    actors: new Set(history.map((a) => a.actor)).size,
    lastAt: history[history.length - 1]?.at ?? null,
  };
}
