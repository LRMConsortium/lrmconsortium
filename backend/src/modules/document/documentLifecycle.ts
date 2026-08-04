/**
 * The verification lifecycle — a state machine, not a status field.
 *
 * Same discipline as the ride machine: the legal moves are a table, the guards
 * are declared per target, and an illegal move is a 409 rather than a silently
 * accepted write. What is different here is that most transitions carry
 * *obligations* — a reason, an audit entry, a reviewer — and those obligations
 * are declared alongside the transition rather than remembered in a handler.
 */

export const DOCUMENT_STATUSES = [
  'submitted',
  'underReview',
  'needsMoreInfo',
  'verified',
  'rejected',
  'expired',
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * The only legal moves.
 *
 * Note what is *not* here: `submitted → verified`. Nothing is verified without
 * passing through review, however trivial the document, because a one-step path
 * from upload to verified is a path somebody will automate.
 */
export const DOCUMENT_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  submitted: ['underReview', 'needsMoreInfo', 'rejected'],
  underReview: ['needsMoreInfo', 'verified', 'rejected'],
  // A holder who supplies what was asked for re-enters the queue at the top.
  needsMoreInfo: ['submitted', 'underReview', 'rejected', 'expired'],
  // Verified is not terminal: documents lapse, and re-verification reopens them.
  verified: ['expired', 'underReview'],
  // A rejection can be answered with a corrected submission.
  rejected: ['submitted'],
  expired: ['submitted', 'underReview'],
};

export function canTransition(from: string, to: string): boolean {
  return (
    (DOCUMENT_TRANSITIONS as Record<string, readonly string[]>)[from]?.includes(to) ?? false
  );
}

/** Statuses from which no forward progress is possible without the holder acting. */
export const HOLDER_ACTION_STATUSES = ['needsMoreInfo', 'rejected', 'expired'] as const;

/** The one status in which the record's identity is frozen. */
export const LOCKED_STATUSES = ['verified'] as const;

export function isLocked(status: string): boolean {
  return (LOCKED_STATUSES as readonly string[]).includes(status);
}

export function awaitsHolder(status: string): boolean {
  return (HOLDER_ACTION_STATUSES as readonly string[]).includes(status);
}

/** Statuses a reviewer's queue should show. */
export const REVIEWABLE_STATUSES = ['submitted', 'underReview'] as const;

export function isReviewable(status: string): boolean {
  return (REVIEWABLE_STATUSES as readonly string[]).includes(status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Obligations
// ─────────────────────────────────────────────────────────────────────────────

export interface TransitionRequirements {
  /** A human-readable reason must accompany the move. */
  reason: boolean;
  /**
   * An audit entry must be written. True for every transition except the
   * initial `submitted`, which *is* the creation and has nothing to record
   * against a previous state.
   */
  audit: boolean;
  /** The acting user must be a reviewer, not the document's own holder. */
  reviewer: boolean;
  /** Compliance and score gates must pass. */
  gated: boolean;
}

const REQUIREMENTS: Record<DocumentStatus, TransitionRequirements> = {
  submitted: { reason: false, audit: false, reviewer: false, gated: false },
  underReview: { reason: false, audit: true, reviewer: true, gated: false },
  // Asking for more without saying what is the single most common way a
  // verification queue stalls, so the reason is mandatory rather than advisory.
  needsMoreInfo: { reason: true, audit: true, reviewer: true, gated: false },
  verified: { reason: false, audit: true, reviewer: true, gated: true },
  // A rejection is the decision most likely to be challenged. It is unusable
  // without a stated reason and an entry naming who made it.
  rejected: { reason: true, audit: true, reviewer: true, gated: false },
  // Expiry is the clock's doing, not a person's — no reviewer, but still audited.
  expired: { reason: false, audit: true, reviewer: false, gated: false },
};

export function requirementsFor(to: DocumentStatus): TransitionRequirements {
  return REQUIREMENTS[to];
}

export const TRANSITION_FAILURES = [
  'illegalTransition',
  'reasonRequired',
  'reviewerRequired',
  'selfReviewForbidden',
  'gateFailed',
] as const;
export type TransitionFailure = (typeof TRANSITION_FAILURES)[number];

export interface TransitionInput {
  reason?: string | null;
  /** True when the caller holds a reviewing role for this document's desk. */
  actorIsReviewer?: boolean;
  /** True when the caller is the document's own holder. */
  actorIsHolder?: boolean;
  /** Set false when a compliance or score gate blocked the move. */
  gatesPassed?: boolean;
}

export interface TransitionVerdict {
  ok: boolean;
  failure?: TransitionFailure;
  message?: string;
  /** HTTP status the router should use. 409 for a state conflict, 422 for input. */
  httpStatus?: 409 | 422 | 403;
  requirements: TransitionRequirements;
}

/**
 * Everything that must be true for `from → to`, checked in one place.
 *
 * The status codes are part of the contract: an illegal move is **409** because
 * the request was well-formed and the *state* refused it, whereas a missing
 * reason is 422 because the request itself was incomplete. A client that has to
 * guess between those two cannot write a sensible retry.
 */
export function evaluateTransition(
  from: string,
  to: DocumentStatus,
  input: TransitionInput = {},
): TransitionVerdict {
  const requirements = requirementsFor(to);

  if (!canTransition(from, to)) {
    return {
      ok: false,
      failure: 'illegalTransition',
      message: `A document in status "${from}" cannot move to "${to}"`,
      httpStatus: 409,
      requirements,
    };
  }

  if (requirements.reason && !String(input.reason ?? '').trim()) {
    return {
      ok: false,
      failure: 'reasonRequired',
      message: `Moving a document to "${to}" requires a reason`,
      httpStatus: 422,
      requirements,
    };
  }

  if (requirements.reviewer) {
    if (input.actorIsHolder) {
      return {
        ok: false,
        failure: 'selfReviewForbidden',
        message: 'A document cannot be reviewed by the person who submitted it',
        httpStatus: 403,
        requirements,
      };
    }
    if (input.actorIsReviewer === false) {
      return {
        ok: false,
        failure: 'reviewerRequired',
        message: `Moving a document to "${to}" requires a reviewing role`,
        httpStatus: 403,
        requirements,
      };
    }
  }

  if (requirements.gated && input.gatesPassed === false) {
    return {
      ok: false,
      failure: 'gateFailed',
      message: 'Compliance or scoring gates did not pass',
      httpStatus: 409,
      requirements,
    };
  }

  return { ok: true, requirements };
}

/**
 * Where an expired document goes when re-verification starts.
 *
 * A type flagged `reverifyOnExpiry` re-enters review — a lapsed criminal record
 * check is not renewed by uploading the same PDF. Everything else goes back to
 * `submitted` so the holder can supply a fresh copy first.
 */
export function reverificationTarget(mustReverify: boolean): DocumentStatus {
  return mustReverify ? 'underReview' : 'submitted';
}

/** Every status reachable from `submitted`, breadth-first. Proves no orphans. */
export function reachableStatuses(from: DocumentStatus = 'submitted'): DocumentStatus[] {
  const seen = new Set<DocumentStatus>([from]);
  const queue: DocumentStatus[] = [from];
  while (queue.length > 0) {
    for (const next of DOCUMENT_TRANSITIONS[queue.shift()!]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}

/** The action name recorded in the audit trail for a move to `to`. */
export const ACTION_FOR_STATUS: Record<DocumentStatus, string> = {
  submitted: 'submit',
  underReview: 'review',
  needsMoreInfo: 'requestInfo',
  verified: 'verify',
  rejected: 'reject',
  expired: 'expire',
};
