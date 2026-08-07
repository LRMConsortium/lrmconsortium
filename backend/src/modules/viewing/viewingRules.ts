/**
 * Property viewings — the rules, with no Express and no Mongoose.
 *
 * A viewing is the first time LRMC asks a real person to be in a real place at
 * a real time. Almost everything that goes wrong with them is a scheduling
 * mistake nobody caught: a slot at three in the morning, a request made for
 * twenty minutes' time, a tenant who has booked every coordinator's afternoon,
 * a no-show recorded before the appointment had happened.
 *
 * All of that is decidable without a database, so it is decided here, and
 * `npm run verify` runs it with nothing installed.
 */

export const VIEWING_STATUSES = [
  /** The tenant has asked. Nobody has answered yet. */
  'requested',
  /** Somebody at LRMC has agreed to be there. */
  'confirmed',
  /** LRMC cannot do that slot. Carries a reason. */
  'declined',
  /** It happened. */
  'completed',
  /** The tenant called it off. */
  'cancelled',
  /** The slot passed and the tenant did not come. */
  'noShow',
] as const;

export type ViewingStatus = (typeof VIEWING_STATUSES)[number];

/**
 * Who may move a viewing, and where to.
 *
 * Four rules are enforced by *absence* from this table, which is why the table
 * is a table:
 *
 *  1. A declined viewing cannot be revived. The tenant asks again, which
 *     produces a fresh record and a fresh audit trail rather than a row whose
 *     history contradicts itself.
 *  2. A completed viewing cannot become a no-show, and a no-show cannot become
 *     completed. Both are statements about something that already happened.
 *  3. Nothing returns to `requested`. Rescheduling is a new request.
 *  4. A viewing cannot be completed without first being confirmed — LRMC
 *     cannot attend an appointment it never agreed to.
 */
export const VIEWING_TRANSITIONS: Record<ViewingStatus, readonly ViewingStatus[]> = {
  requested: ['confirmed', 'declined', 'cancelled'],
  confirmed: ['completed', 'noShow', 'cancelled'],
  declined: [],
  completed: [],
  cancelled: [],
  noShow: [],
};

export function canTransitionViewing(from: ViewingStatus, to: ViewingStatus): boolean {
  return (VIEWING_TRANSITIONS[from] ?? []).includes(to);
}

export function nextViewingStatuses(from: ViewingStatus): readonly ViewingStatus[] {
  return VIEWING_TRANSITIONS[from] ?? [];
}

/** A viewing still on somebody's list of things to do. */
export function isOpenViewing(status: ViewingStatus): boolean {
  return status === 'requested' || status === 'confirmed';
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Slots
 * ────────────────────────────────────────────────────────────────────────── */

/** Somebody has to travel to the property and be let in. */
export const MIN_NOTICE_HOURS = 2;

/** Beyond this a slot is a guess, not an appointment. */
export const MAX_AHEAD_DAYS = 30;

/** Local viewing hours. A request for 03:00 is a request nobody will honour. */
export const VIEWING_OPENS_HOUR = 8;
export const VIEWING_CLOSES_HOUR = 18;

/**
 * How many open requests one tenant may hold at once.
 *
 * Not an anti-abuse measure so much as an anti-accident one: somebody
 * enthusiastically booking every property in Serrekunda occupies coordinators
 * who then cannot serve anybody else, and will not attend most of them.
 */
export const MAX_OPEN_REQUESTS_PER_TENANT = 5;

export type SlotProblem =
  | 'in-the-past'
  | 'too-soon'
  | 'too-far-ahead'
  | 'outside-viewing-hours'
  | 'not-a-time';

export interface SlotWindow {
  minNoticeHours?: number;
  maxAheadDays?: number;
  opensHour?: number;
  closesHour?: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * What is wrong with this slot, or `null` if nothing is.
 *
 * `hourOfDay` is passed in rather than read off the Date, because the server
 * runs in UTC and the tenant is in The Gambia. Reading `getHours()` here would
 * quietly apply the server's idea of "afternoon" to somebody else's morning —
 * the caller knows the local hour and this function should not guess it.
 */
export function slotProblem(
  requestedFor: Date | number,
  now: Date | number,
  localHourOfDay: number,
  window: SlotWindow = {},
): SlotProblem | null {
  const at = requestedFor instanceof Date ? requestedFor.getTime() : requestedFor;
  const from = now instanceof Date ? now.getTime() : now;

  if (!Number.isFinite(at) || !Number.isFinite(from)) return 'not-a-time';

  const minNotice = window.minNoticeHours ?? MIN_NOTICE_HOURS;
  const maxAhead = window.maxAheadDays ?? MAX_AHEAD_DAYS;
  const opens = window.opensHour ?? VIEWING_OPENS_HOUR;
  const closes = window.closesHour ?? VIEWING_CLOSES_HOUR;

  if (at <= from) return 'in-the-past';
  if (at - from < minNotice * HOUR_MS) return 'too-soon';
  if (at - from > maxAhead * DAY_MS) return 'too-far-ahead';

  if (!Number.isFinite(localHourOfDay)) return 'not-a-time';
  // `closes` is the hour the last viewing may *start*, so 18 means no slot at
  // 18:00 — somebody would still be at the property at seven.
  if (localHourOfDay < opens || localHourOfDay >= closes) return 'outside-viewing-hours';

  return null;
}

/** Plain wording for a refused slot. The tenant reads this, not the code. */
export function describeSlotProblem(problem: SlotProblem): string {
  switch (problem) {
    case 'in-the-past':
      return 'That time has already passed.';
    case 'too-soon':
      return `Viewings need at least ${MIN_NOTICE_HOURS} hours' notice so a coordinator can be there.`;
    case 'too-far-ahead':
      return `Viewings can be booked up to ${MAX_AHEAD_DAYS} days ahead.`;
    case 'outside-viewing-hours':
      return `Viewings run between ${VIEWING_OPENS_HOUR}:00 and ${VIEWING_CLOSES_HOUR}:00.`;
    case 'not-a-time':
      return 'That is not a valid date and time.';
    default:
      return 'That slot cannot be booked.';
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Recording what happened
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * May the outcome be recorded yet?
 *
 * A no-show recorded an hour before the appointment is not an observation, it
 * is a prediction — and it lands on a tenant's record, where it counts against
 * them at application time. The same applies to marking a viewing completed
 * before it has happened.
 */
export function canRecordOutcome(
  slotAt: Date | number,
  now: Date | number,
): boolean {
  const at = slotAt instanceof Date ? slotAt.getTime() : slotAt;
  const from = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(at) || !Number.isFinite(from)) return false;
  return from >= at;
}

/** Who may take this action on a viewing. */
export type ViewingActor = 'tenant' | 'coordinator' | 'landlord' | 'staff';

/**
 * Cancelling and declining are different words for different people.
 *
 * The tenant who asked may call it off — that is a cancellation. LRMC may
 * refuse — that is a decline, and it carries a reason. A landlord cannot
 * cancel on a tenant's behalf and have the record read as though the tenant
 * lost interest.
 */
export function mayAct(actor: ViewingActor, to: ViewingStatus): boolean {
  switch (to) {
    case 'cancelled':
      return actor === 'tenant' || actor === 'staff';
    case 'confirmed':
    case 'declined':
      return actor === 'coordinator' || actor === 'landlord' || actor === 'staff';
    case 'completed':
    case 'noShow':
      return actor === 'coordinator' || actor === 'staff';
    default:
      return false;
  }
}
