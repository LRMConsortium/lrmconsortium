/**
 * Maintenance SLA clock — pure, so the escalation job and the UI badge agree.
 *
 * Three instants matter: `createdAt` (the clock starts), `dueAt` (the target the
 * vendor was given), and `overdueAt` (`dueAt` plus a grace period, after which
 * the work order escalates to a human). Separating "late" from "escalate" stops
 * a job that runs every fifteen minutes from paging Back Office about a request
 * that missed its target by ninety seconds.
 */

import type { MAINTENANCE_PRIORITIES } from './maintenance.model.js';

export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const MS_PER_HOUR = 3_600_000;

/** The default clock per priority, in hours. Overridable per request. */
export const SLA_HOURS_BY_PRIORITY: Record<MaintenancePriority, number> = {
  emergency: 4,
  high: 24,
  normal: 72,
  low: 168,
};

/**
 * Grace before a missed target becomes an escalation: a quarter of the SLA,
 * floored at one hour and capped at a day. An emergency gets one hour of slack;
 * a low-priority repair gets a day, not six.
 */
export function graceHours(slaHours: number): number {
  return Math.min(24, Math.max(1, Math.round(slaHours * 0.25)));
}

/** Fraction of the SLA elapsed at which a request is flagged before it is late. */
export const AT_RISK_THRESHOLD = 0.8;

export const SLA_STATES = ['onTrack', 'atRisk', 'due', 'overdue', 'met', 'breached'] as const;
export type SlaState = (typeof SLA_STATES)[number];

export const SLA_ESCALATIONS = [
  'none',
  'notifyVendor',
  'notifyCoordinator',
  'notifyBackOffice',
  'notifyHQ',
] as const;
export type SlaEscalation = (typeof SLA_ESCALATIONS)[number];

export function slaHoursFor(priority: MaintenancePriority, override?: number): number {
  if (override !== undefined && override > 0) return override;
  return SLA_HOURS_BY_PRIORITY[priority] ?? SLA_HOURS_BY_PRIORITY.normal;
}

export interface SlaClock {
  slaHours: number;
  dueAt: Date;
  overdueAt: Date;
  elapsedHours: number;
  /** Negative once the target has passed. */
  hoursRemaining: number;
  percentElapsed: number;
  state: SlaState;
  breached: boolean;
  escalation: SlaEscalation;
}

function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / MS_PER_HOUR) * 100) / 100;
}

/**
 * Where a work order stands against its clock.
 *
 * A finished request is judged against when it *finished*, not against now:
 * a job completed inside its window stays `met` forever, however long ago it
 * was. Anything else would rewrite history every time the report is run.
 */
export function slaClockFor(
  createdAt: Date,
  priority: MaintenancePriority,
  asOf: Date,
  options: { slaHours?: number; completedAt?: Date | null } = {},
): SlaClock {
  const slaHours = slaHoursFor(priority, options.slaHours);
  const dueAt = new Date(createdAt.getTime() + slaHours * MS_PER_HOUR);
  const overdueAt = new Date(dueAt.getTime() + graceHours(slaHours) * MS_PER_HOUR);

  const measuredAt = options.completedAt ?? asOf;
  const elapsedHours = Math.max(0, hoursBetween(createdAt, measuredAt));
  const hoursRemaining = Math.round((slaHours - elapsedHours) * 100) / 100;
  const percentElapsed = slaHours > 0 ? Math.round((elapsedHours / slaHours) * 1000) / 10 : 100;

  let state: SlaState;
  if (options.completedAt) {
    state = measuredAt.getTime() <= dueAt.getTime() ? 'met' : 'breached';
  } else if (asOf.getTime() > overdueAt.getTime()) {
    state = 'overdue';
  } else if (asOf.getTime() > dueAt.getTime()) {
    state = 'due';
  } else if (percentElapsed >= AT_RISK_THRESHOLD * 100) {
    state = 'atRisk';
  } else {
    state = 'onTrack';
  }

  return {
    slaHours,
    dueAt,
    overdueAt,
    elapsedHours,
    hoursRemaining,
    percentElapsed,
    state,
    breached: state === 'overdue' || state === 'breached',
    escalation: escalationFor(state, priority),
  };
}

/**
 * Who to wake, given the state and how urgent the work is.
 *
 * An emergency that is merely at risk already goes to a coordinator; a low
 * priority job that is properly overdue only reaches Back Office. Urgency
 * shortens the ladder rather than skipping it.
 */
export function escalationFor(state: SlaState, priority: MaintenancePriority): SlaEscalation {
  if (state === 'onTrack' || state === 'met') return 'none';
  if (state === 'atRisk') return priority === 'emergency' ? 'notifyCoordinator' : 'notifyVendor';
  if (state === 'due') return priority === 'emergency' ? 'notifyBackOffice' : 'notifyCoordinator';
  // overdue / breached
  if (priority === 'emergency') return 'notifyHQ';
  if (priority === 'high') return 'notifyBackOffice';
  return 'notifyCoordinator';
}

/** Statuses that stop the clock. Everything else is still running. */
export const SLA_CLOSED_STATUSES = ['completed', 'verified', 'cancelled'] as const;

export function isSlaOpen(status: string): boolean {
  return !(SLA_CLOSED_STATUSES as readonly string[]).includes(status);
}

/**
 * Resolution hours, stamped once on completion.
 *
 * Kept here rather than inline in the handler so the number on the record and
 * the number in the report come from the same rounding.
 */
export function resolutionHours(createdAt: Date, completedAt: Date): number {
  return Math.max(0, hoursBetween(createdAt, completedAt));
}

/**
 * Which coordinator should own a request, when nobody has been named.
 *
 * The property's standing coordinator is the right answer whenever there is
 * one — they already know the building. Falls back to whoever raised it being
 * a coordinator themselves, and otherwise leaves it for Back Office to triage
 * rather than guessing.
 */
export function routeToCoordinator(input: {
  explicit?: string | null;
  propertyCoordinator?: string | null;
  raisedByKind?: string | null;
  raisedBy?: string | null;
}): { coordinator: string | null; via: 'explicit' | 'property' | 'raiser' | 'unrouted' } {
  if (input.explicit) return { coordinator: input.explicit, via: 'explicit' };
  if (input.propertyCoordinator) return { coordinator: input.propertyCoordinator, via: 'property' };
  if (input.raisedByKind === 'CoordinatorProfile' && input.raisedBy) {
    return { coordinator: input.raisedBy, via: 'raiser' };
  }
  return { coordinator: null, via: 'unrouted' };
}
