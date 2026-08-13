/**
 * Signing out, and what that has to mean.
 *
 * Pure — no Express, no Mongoose, no clock of its own. The store lives in
 * `revokedToken.model.ts`; the rules are here so they can be asserted without
 * a database.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * The frontend called `POST /auth/logout` on every sign-out. The backend had no
 * such route. The frontend swallowed the 404 (`.catch(function () {})`) and
 * cleared the token from local storage, so sign-out *looked* like it worked —
 * the person was returned to the login page and their session was gone from
 * that browser.
 *
 * The refresh token was not gone. It is a stateless JWT with a thirty-day life
 * and there was nowhere to record that it should stop working, so anybody
 * holding a copy — a shared machine's storage, a proxy log, a backup — could
 * exchange it for a fresh access token for a month after the owner believed
 * they had signed out. That is the entire value of signing out, and it was
 * absent while appearing present, which is the worst way for a control to be
 * missing.
 *
 * ── What is revocable and what is not ─────────────────────────────────────
 * **The refresh token is revoked.** It is long-lived, so it must be.
 *
 * **The access token is not.** It is a stateless JWT with a twelve-hour life
 * and checking a denylist on every authenticated request would put a database
 * read in front of the whole platform. Signing out therefore stops new access
 * tokens being minted; it does not kill one already issued.
 *
 * This is a real, bounded window and it is documented rather than glossed:
 * an attacker who already holds a live access token keeps it until it expires.
 * Shortening `JWT_EXPIRES_IN` shortens that window; the correct fix for a
 * *stolen* credential is `changePassword`, which is why the two are named
 * together in the endpoint's own notes. Pretending logout closes the window
 * would be worse than saying it does not.
 *
 * ── Why a denylist rather than a version counter ──────────────────────────
 * A `tokensValidFrom` timestamp on the user is one field and no collection,
 * and it revokes *every* device at once. That is a different feature — "sign
 * out everywhere" — and silently giving it to somebody who tapped sign-out on
 * their phone would log them out of the desktop they left mid-task.
 *
 * So each refresh token carries a `jti` and signing out denies that one id.
 * The store is bounded by the number of sign-outs inside one refresh window,
 * not by anything that grows forever, because each row carries the token's own
 * expiry and the database deletes it then: once the token could not be used
 * anyway, remembering that it was revoked is pointless.
 */

/**
 * Is this refresh token revoked?
 *
 * `denied` is whatever the store returned for this id — a row, or nothing.
 *
 * **Absence of a row means allowed, and that is a deliberate risk.** If the
 * store is unreachable the caller must fail closed itself rather than passing
 * `null` in here and reading "fine"; this function answers a question about
 * data it was given, not about whether the lookup worked.
 */
export function isRevoked(denied: { jti: string } | null | undefined): boolean {
  return Boolean(denied && denied.jti);
}

/**
 * When the store may forget a revocation.
 *
 * The token's own expiry, because a revocation outliving its token protects
 * nothing and a denylist that only ever grows becomes the reason the login
 * path is slow two years from now.
 *
 * `exp` is the JWT claim: seconds since the epoch, not milliseconds. Reading it
 * as milliseconds puts the expiry in January 1970, the TTL index deletes the
 * row on its next sweep, and the revocation quietly stops working — so the
 * conversion happens here, once, with a test on it.
 */
export function revocationExpiry(exp: number | null | undefined): Date | null {
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return null;
  return new Date(Math.floor(exp) * 1000);
}

/**
 * Reasons a token stops being usable, as recorded.
 *
 * Kept as data so the audit trail distinguishes a person signing out from an
 * administrator ending their session — the same effect, very different fact.
 */
export const REVOCATION_REASONS = [
  /** The holder signed out. */
  'signOut',
  /** The holder signed out of every device. */
  'signOutEverywhere',
  /** Staff or the founder ended this session. */
  'administrative',
  /** The token was used in a way that suggests it was copied. */
  'suspected',
  /**
   * The token was exchanged for a new one at `/auth/refresh`.
   *
   * Its own reason rather than reusing `signOut`, because the two are very
   * different facts and the audit trail is read by people deciding whether an
   * account was compromised. A row saying somebody signed out forty times in an
   * afternoon tells the wrong story about a browser refreshing a session.
   */
  'rotated',
] as const;

export type RevocationReason = (typeof REVOCATION_REASONS)[number];

/**
 * May this actor revoke this token?
 *
 * A person may always end their own session. Ending somebody else's is an
 * administrative act, and a member holding a stranger's refresh token being
 * able to invalidate it would be a denial-of-service dressed as a courtesy.
 */
export function mayRevoke(
  actor: { userId: string; roles: string[] } | null | undefined,
  tokenSubject: string | null | undefined,
): boolean {
  if (!actor || typeof actor.userId !== 'string' || !actor.userId) return false;
  if (!tokenSubject) return false;
  if (actor.userId === tokenSubject) return true;
  if (!Array.isArray(actor.roles)) return false;
  return actor.roles.includes('founder')
    || actor.roles.includes('hqExecutive')
    || actor.roles.includes('backOfficeStaff');
}

/**
 * What a sign-out should tell the caller.
 *
 * A sign-out that could not find a token to revoke is still a successful
 * sign-out — the person is signed out on this device either way, and returning
 * an error would strand them on a page they are trying to leave. The reply says
 * which happened so a browser can tell the difference without being blocked
 * by it, and so the audit trail records the truth rather than an assumption.
 */
export interface SignOutOutcome {
  /** Always true. The local session is gone regardless. */
  signedOut: true;
  /** Whether a refresh token was presented and is now denied. */
  refreshRevoked: boolean;
  /** Present when no token was presented, explaining the reply. */
  note?: string;
}

export function signOutOutcome(revoked: boolean): SignOutOutcome {
  if (revoked) return { signedOut: true, refreshRevoked: true };
  return {
    signedOut: true,
    refreshRevoked: false,
    note: 'No refresh token was presented, so none was revoked. Any refresh token for this session remains valid until it expires.',
  };
}
