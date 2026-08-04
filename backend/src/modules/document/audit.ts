/**
 * The document audit trail — append-only, and provably so.
 *
 * The trail is the answer to "who verified this, when, and on what basis". That
 * question is asked long after the fact, usually by someone who does not trust
 * the answer, so the guarantees have to be structural rather than conventional:
 * entries are numbered, timestamps may not go backwards, and every mutation of
 * the array is checked to be a pure append before it is written.
 *
 * `assertAppendOnly` is the load-bearing function. Mongoose will happily let a
 * handler splice an entry out of the middle of an array; this is what makes
 * that a caught error rather than a silent rewrite of history.
 */

import { ACTION_FOR_STATUS, type DocumentStatus } from './documentLifecycle.js';

export const AUDIT_ACTIONS = [
  'create',
  'submit',
  'review',
  'requestInfo',
  'verify',
  'reject',
  'expire',
  'reverify',
  'amend',
  'archive',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Actions that are unusable without a stated reason. */
export const REASON_REQUIRED_ACTIONS = ['requestInfo', 'reject', 'archive'] as const;

export function requiresReason(action: string): boolean {
  return (REASON_REQUIRED_ACTIONS as readonly string[]).includes(action);
}

export interface AuditEntry {
  /** 1-based, contiguous, and never reused. */
  sequence: number;
  at: Date;
  actor: string;
  actorRole?: string;
  action: AuditAction;
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
  /** Field names touched. Values are deliberately not recorded here. */
  fieldsChanged?: string[];
}

/**
 * Is this entry usable on its own terms?
 *
 * Returns the reason it is not, or null. An entry that fails this must never be
 * appended — a trail with one meaningless row is a trail nobody trusts.
 */
export function validateEntry(entry: Partial<AuditEntry>): string | null {
  if (!entry.actor || !String(entry.actor).trim()) return 'actor is required';
  if (!entry.action) return 'action is required';
  if (!(AUDIT_ACTIONS as readonly string[]).includes(entry.action)) {
    return `unknown action "${entry.action}"`;
  }
  if (!(entry.at instanceof Date) || Number.isNaN(entry.at.getTime())) {
    return 'at must be a valid date';
  }
  if (requiresReason(entry.action) && !String(entry.reason ?? '').trim()) {
    return `action "${entry.action}" requires a reason`;
  }
  if (entry.sequence !== undefined && (!Number.isInteger(entry.sequence) || entry.sequence < 1)) {
    return 'sequence must be a positive integer';
  }
  return null;
}

export class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditError';
  }
}

/**
 * Append one entry, returning a *new* array.
 *
 * The sequence number is assigned here rather than by the caller, and the
 * timestamp is never allowed to precede the previous entry's — a clock that
 * steps backwards during a leap second must not be able to make the trail read
 * as though a rejection preceded the review that caused it.
 */
export function appendAudit(
  existing: readonly AuditEntry[],
  entry: Omit<AuditEntry, 'sequence'>,
): AuditEntry[] {
  const problem = validateEntry(entry);
  if (problem) throw new AuditError(problem);

  const last = existing[existing.length - 1];
  const at = last && entry.at.getTime() < last.at.getTime() ? new Date(last.at.getTime()) : entry.at;

  return [...existing, { ...entry, at, sequence: (last?.sequence ?? 0) + 1 }];
}

/** Build the entry for a lifecycle move, so callers cannot pick a wrong action. */
export function entryForTransition(input: {
  from: string | null;
  to: DocumentStatus;
  actor: string;
  actorRole?: string;
  reason?: string | null;
  at: Date;
}): Omit<AuditEntry, 'sequence'> {
  return {
    at: input.at,
    actor: input.actor,
    actorRole: input.actorRole,
    action: ACTION_FOR_STATUS[input.to] as AuditAction,
    fromStatus: input.from,
    toStatus: input.to,
    reason: input.reason ?? null,
  };
}

export const INTEGRITY_FAILURES = [
  'sequenceGap',
  'sequenceRepeat',
  'timeWentBackwards',
  'invalidEntry',
] as const;
export type IntegrityFailure = (typeof INTEGRITY_FAILURES)[number];

export interface IntegrityVerdict {
  intact: boolean;
  failures: { at: number; failure: IntegrityFailure; detail: string }[];
}

/**
 * Is the whole trail internally consistent?
 *
 * Checks the three things a tampered trail gets wrong: a gap where an entry was
 * removed, a repeat where one was inserted, and a timestamp that moves
 * backwards. Cheap enough to run on every read of a document's history.
 */
export function auditTrailIsIntact(entries: readonly AuditEntry[]): IntegrityVerdict {
  const failures: IntegrityVerdict['failures'] = [];

  entries.forEach((entry, index) => {
    const problem = validateEntry(entry);
    if (problem) failures.push({ at: index, failure: 'invalidEntry', detail: problem });

    const expected = index + 1;
    if (entry.sequence > expected) {
      failures.push({ at: index, failure: 'sequenceGap', detail: `expected ${expected}, got ${entry.sequence}` });
    } else if (entry.sequence < expected) {
      failures.push({ at: index, failure: 'sequenceRepeat', detail: `expected ${expected}, got ${entry.sequence}` });
    }

    const previous = entries[index - 1];
    if (previous && entry.at.getTime() < previous.at.getTime()) {
      failures.push({ at: index, failure: 'timeWentBackwards', detail: 'entry predates the one before it' });
    }
  });

  return { intact: failures.length === 0, failures };
}

/**
 * Is `after` a pure append onto `before`?
 *
 * The guarantee the whole module exists for. Every prefix entry must be
 * byte-identical; anything else — an edited reason, a removed rejection, a
 * reordered pair — is a rewrite, not an append.
 */
export function assertAppendOnly(
  before: readonly AuditEntry[],
  after: readonly AuditEntry[],
): { ok: boolean; reason?: string } {
  if (after.length < before.length) {
    return { ok: false, reason: `entries were removed (${before.length} → ${after.length})` };
  }
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i]!;
    const b = after[i]!;
    if (
      a.sequence !== b.sequence ||
      a.at.getTime() !== b.at.getTime() ||
      a.actor !== b.actor ||
      a.action !== b.action ||
      (a.reason ?? null) !== (b.reason ?? null) ||
      (a.fromStatus ?? null) !== (b.fromStatus ?? null) ||
      (a.toStatus ?? null) !== (b.toStatus ?? null)
    ) {
      return { ok: false, reason: `entry ${i + 1} was modified` };
    }
  }
  return { ok: true };
}

/** Who last did a given thing, if anyone. Used for "verified by" on a record. */
export function lastActionBy(
  entries: readonly AuditEntry[],
  action: AuditAction,
): AuditEntry | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]!.action === action) return entries[i]!;
  }
  return null;
}

/** Count of each action, for the HQ analytics roll-up. */
export function auditSummary(entries: readonly AuditEntry[]): {
  total: number;
  byAction: Record<string, number>;
  firstAt: Date | null;
  lastAt: Date | null;
  actors: string[];
} {
  const byAction: Record<string, number> = {};
  for (const e of entries) byAction[e.action] = (byAction[e.action] ?? 0) + 1;
  return {
    total: entries.length,
    byAction,
    firstAt: entries[0]?.at ?? null,
    lastAt: entries[entries.length - 1]?.at ?? null,
    actors: [...new Set(entries.map((e) => e.actor))],
  };
}
