/**
 * Maintenance — the lifecycle, and who is allowed to move it.
 *
 * Pure: no Express, no Mongoose, no clock. `sla.ts` decides when a request is
 * late; this file decides what may happen to it next and who may make it
 * happen.
 *
 * ── Why a table rather than a chain of `if`s ──────────────────────────────
 * Ten statuses is forty-five ordered pairs. Written as conditionals somebody
 * eventually adds one that lets `cancelled` become `inProgress`, and nothing
 * fails — the request simply reappears in a vendor's queue a month after the
 * tenant was told it was dropped. As a table, every reachable move is visible
 * in twelve lines and the unreachable ones are enforced by absence.
 *
 * ── Five rules enforced by absence from the table ─────────────────────────
 *
 *  1. **Nothing reaches `verified` except from `completed`.** Verification is
 *     LRMC saying the work was actually done; verifying something nobody has
 *     reported finishing is a signature on an empty page.
 *
 *  2. **`verified` is terminal.** Reopening a verified job is a *new* request
 *     against the same property, not a resurrection of the old one — otherwise
 *     the resolution time, the SLA record and the vendor's completion rate all
 *     silently rewrite themselves.
 *
 *  3. **`cancelled` is terminal.** A tenant told their request was dropped must
 *     not find a vendor at the door.
 *
 *  4. **Work cannot start before it is approved when there is money involved.**
 *     `quoted → assigned` is absent: a quote has to be approved by somebody who
 *     is not the vendor who wrote it.
 *
 *  5. **`onHold` returns only to where it came from.** It goes back to `triaged`
 *     — the state where somebody decides again — never straight to
 *     `inProgress`, so a job parked for three weeks is re-examined rather than
 *     resumed on assumptions that have expired.
 */

import { MAINTENANCE_STATUSES, type MaintenanceStatus } from '../../config/lifecycles.js';

export { MAINTENANCE_STATUSES };
export type { MaintenanceStatus };

/** Where each status may go. Absence is the rule; see the header. */
export const MAINTENANCE_TRANSITIONS: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  /** Raised, nobody has looked. */
  open: ['triaged', 'assigned', 'cancelled'],
  /** Somebody at LRMC has read it and set a priority. */
  triaged: ['quoted', 'assigned', 'onHold', 'cancelled'],
  /** A vendor has priced it. Needs approval before anybody starts. */
  quoted: ['approved', 'onHold', 'cancelled'],
  /** Somebody who is not the vendor approved the money. */
  approved: ['assigned', 'onHold', 'cancelled'],
  /** A vendor holds it. */
  assigned: ['inProgress', 'onHold', 'cancelled'],
  /** Work is happening. */
  inProgress: ['completed', 'onHold', 'cancelled'],
  /** Parked. Returns to triage, where somebody decides again. */
  onHold: ['triaged', 'cancelled'],
  /** The vendor says it is done. Not the same as LRMC agreeing. */
  completed: ['verified', 'inProgress'],
  /** LRMC checked. Terminal. */
  verified: [],
  /** Dropped. Terminal. */
  cancelled: [],
};

export function canTransitionMaintenance(from: string, to: string): boolean {
  const allowed = MAINTENANCE_TRANSITIONS[from as MaintenanceStatus];
  return Array.isArray(allowed) && (allowed as readonly string[]).includes(to);
}

/** Statuses where the request is still somebody's problem. */
export const OPEN_MAINTENANCE_STATUSES = [
  'open', 'triaged', 'quoted', 'approved', 'assigned', 'inProgress', 'onHold',
] as const;

export function isOpenMaintenance(status: string): boolean {
  return (OPEN_MAINTENANCE_STATUSES as readonly string[]).includes(status);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Who may move it
 * ────────────────────────────────────────────────────────────────────────── */

export interface MaintenanceActor {
  userId: string;
  roles: string[];
}

/** Roles that may act on any request. */
export const MAINTENANCE_WIDE_ROLES = [
  'founder', 'hqExecutive', 'backOfficeStaff', 'coordinator',
] as const;

/**
 * Which statuses each kind of participant may set.
 *
 * As data, so "may a vendor cancel a job" is answered by reading twelve lines
 * rather than by tracing a handler. The answer is no, and the reason is that a
 * vendor cancelling their own assignment removes it from every queue that would
 * have chased them for it.
 */
export const TRANSITIONS_BY_PARTY: Record<string, readonly MaintenanceStatus[]> = {
  /** The person who lives there. They may report and they may withdraw. */
  raiser: ['cancelled'],
  /** The vendor holding the job. They may work and they may report finishing. */
  vendor: ['inProgress', 'completed', 'onHold'],
  /** LRMC. Everything, because somebody has to be able to unstick anything. */
  staff: [...MAINTENANCE_STATUSES],
};

export type MaintenanceParty = 'raiser' | 'vendor' | 'staff' | 'none';

/**
 * Which party this actor is, for this request.
 *
 * Staff wins over the others: a coordinator who also raised the request acts
 * with the wider hand, because the narrower one would be a surprise.
 */
export function partyFor(
  actor: MaintenanceActor | null | undefined,
  request: { raisedByUser?: string | null; vendorUser?: string | null },
): MaintenanceParty {
  if (!actor || typeof actor.userId !== 'string' || !actor.userId) return 'none';
  if (!Array.isArray(actor.roles)) return 'none';
  if ((MAINTENANCE_WIDE_ROLES as readonly string[]).some((r) => actor.roles.includes(r))) {
    return 'staff';
  }
  if (request.vendorUser && request.vendorUser === actor.userId) return 'vendor';
  if (request.raisedByUser && request.raisedByUser === actor.userId) return 'raiser';
  return 'none';
}

export interface UpdateAttempt {
  from: string;
  to: string;
  note?: string | null;
}

/**
 * Everything wrong with a status change, as a list.
 *
 * A list rather than a first-failure throw, for the same reason as everywhere
 * else on this platform: the person is on a phone and one problem per round
 * trip is how a job stops being updated at all.
 */
export function updateProblems(
  actor: MaintenanceActor | null | undefined,
  request: { status: string; raisedByUser?: string | null; vendorUser?: string | null },
  attempt: UpdateAttempt,
): { field: string; code: string; message: string }[] {
  const out: { field: string; code: string; message: string }[] = [];
  const add = (field: string, code: string, message: string) =>
    out.push({ field, code, message });

  const party = partyFor(actor, request);
  if (party === 'none') {
    add('status', 'not-a-party',
      'Only the person who raised this, the vendor holding it, or LRMC may change it.');
    return out;
  }

  if (!(MAINTENANCE_STATUSES as readonly string[]).includes(attempt.to)) {
    add('status', 'unknown-status', `"${attempt.to}" is not a maintenance status.`);
    return out;
  }

  if (attempt.from === attempt.to) {
    add('status', 'no-change', 'That is already the status.');
    return out;
  }

  if (!canTransitionMaintenance(attempt.from, attempt.to)) {
    add('status', 'not-reachable',
      `A ${labelFor(attempt.from)} request cannot become ${labelFor(attempt.to)}.`);
  }

  const permitted = TRANSITIONS_BY_PARTY[party] ?? [];
  if (!(permitted as readonly string[]).includes(attempt.to)) {
    add('status', 'not-yours',
      party === 'vendor'
        ? 'A vendor may start, pause or finish a job, but not cancel or verify it.'
        : 'That change is LRMC\'s to make.');
  }

  /* A request being cancelled or parked needs a reason. Not for bureaucracy —
   * whoever raised it is told what happened, and "your request was cancelled"
   * with nothing after it is how people stop reporting things at all. */
  const note = String(attempt.note ?? '').trim();
  if (REASON_REQUIRED.includes(attempt.to as MaintenanceStatus) && !note) {
    add('note', 'reason-required',
      `Say why: a ${labelFor(attempt.to)} request is explained to whoever raised it.`);
  }

  /* Sending a job back from `completed` is LRMC telling a vendor the work was
   * not done. That needs saying, and saying to the vendor — a silent reopen is
   * how the same argument happens twice. */
  if (attempt.from === 'completed' && attempt.to === 'inProgress' && !note) {
    add('note', 'reason-required',
      'Say what was wrong with the work: the vendor is told, and a bare reopen reads as an accident.');
  }

  /* Nobody verifies their own work. The vendor branch above already refuses,
   * but a vendor who also holds a staff role would otherwise slip through — and
   * "I did it and I checked it" is not a check. */
  if (attempt.to === 'verified' && request.vendorUser && actor && request.vendorUser === actor.userId) {
    add('status', 'self-verification',
      'The vendor who did the work cannot be the one who verifies it.');
  }

  return out;
}

/**
 * Changes a person has to explain.
 *
 * Deliberately short. `inProgress` is absent — a vendor starting work is not an
 * event anybody needs a paragraph about, and demanding one is how a form stops
 * being filled in on a phone in a compound. The one reopen that *does* need a
 * reason (`completed → inProgress`) is a transition rule, not a target-status
 * rule, and is checked separately above.
 */
export const REASON_REQUIRED: readonly MaintenanceStatus[] = ['cancelled', 'onHold'];

/** Human wording for a status, for messages people actually read. */
export const MAINTENANCE_LABELS: Record<MaintenanceStatus, string> = {
  open: 'newly raised',
  triaged: 'triaged',
  quoted: 'quoted',
  approved: 'approved',
  assigned: 'assigned',
  inProgress: 'in progress',
  onHold: 'on hold',
  completed: 'completed',
  verified: 'verified',
  cancelled: 'cancelled',
};

function labelFor(status: string): string {
  return MAINTENANCE_LABELS[status as MaintenanceStatus] ?? status;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Escalation
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Should a coordinator be pulled in?
 *
 * Escalation is not a status — a request does not become "escalated", it
 * becomes *somebody's*. This answers whether that somebody needs to change,
 * and it is deliberately conservative: escalating everything is the same as
 * escalating nothing, because a queue nobody can clear is one nobody reads.
 *
 * Three grounds, and only three:
 *   • an emergency that nobody has picked up
 *   • an SLA that has been breached or is overdue
 *   • a job parked on hold past the point where "parked" means anything
 */
export const ON_HOLD_ESCALATION_HOURS = 72;

export function shouldEscalate(input: {
  status: string;
  priority: string;
  slaState?: string | null;
  hoursSinceStatusChange?: number | null;
  hasCoordinator?: boolean;
}): { escalate: boolean; reason: string | null } {
  if (!isOpenMaintenance(input.status)) return { escalate: false, reason: null };

  if (input.priority === 'emergency' && (input.status === 'open' || input.status === 'triaged')) {
    return { escalate: true, reason: 'An emergency has not been assigned to anyone.' };
  }

  if (input.slaState === 'breached' || input.slaState === 'overdue') {
    return { escalate: true, reason: 'The response time LRMC promised has passed.' };
  }

  const parked = Number(input.hoursSinceStatusChange);
  if (input.status === 'onHold' && Number.isFinite(parked) && parked >= ON_HOLD_ESCALATION_HOURS) {
    return {
      escalate: true,
      reason: `On hold for ${Math.floor(parked)} hours with nobody deciding what happens next.`,
    };
  }

  return { escalate: false, reason: null };
}
