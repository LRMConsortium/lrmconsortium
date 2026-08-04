/**
 * Rent arithmetic — pure, UTC, and deliberately Mongoose-free.
 *
 * Every number a tenant argues about is computed here: what has fallen due,
 * what is owed, when the next instalment lands, and which side of the arrears
 * line the lease sits on. Keeping it out of the handlers means `npm run verify`
 * can assert it against worked examples with no database, and means the same
 * function answers the question for a statement, a reminder job and a UI badge
 * rather than three implementations quietly disagreeing.
 *
 * The model: rent is payable **in advance**. Instalment 0 falls due on
 * `leaseStart`; instalment *n* falls due on `paymentDayOfMonth` of the month
 * *n* months later, clamped to the length of that month — a lease billed on the
 * 31st is due on the 28th of February, not the 3rd of March.
 */

/** Only the fields the arithmetic needs. Anything lease-shaped satisfies it. */
export interface RentTerms {
  leaseStart: Date;
  leaseEnd: Date;
  monthlyRent: number;
  paymentDayOfMonth: number;
  totalPaid?: number;
}

export const LEASE_EXPIRING_WINDOW_DAYS = 60;
export const RENT_REMINDER_LEAD_DAYS = 5;
export const MS_PER_DAY = 86_400_000;

/** Statuses an operator sets by hand. The scheduler must not overwrite them. */
export const MANUAL_LEASE_STATUSES = [
  'draft',
  'pendingSignature',
  'terminated',
] as const;

export const ARREARS_ESCALATIONS = [
  'none',
  'reminder',
  'firstNotice',
  'finalNotice',
  'legalReferral',
] as const;

export type ArrearsEscalation = (typeof ARREARS_ESCALATIONS)[number];

/** Money, to the minor unit. Floating-point cents are a support ticket. */
export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function monthOrdinal(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/** The 31st of a 30-day month is the 30th. Never March 3rd. */
export function clampDayToMonth(year: number, month0: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return Math.min(Math.max(1, Math.trunc(day)), lastDay);
}

/**
 * When instalment `n` falls due. `n = 0` is the advance payment at lease start,
 * so the tenant is never in a rent-free period the ledger does not know about.
 */
export function instalmentDueDate(terms: RentTerms, n: number): Date {
  if (n <= 0) return new Date(terms.leaseStart.getTime());
  const ordinal = monthOrdinal(terms.leaseStart) + n;
  const year = Math.floor(ordinal / 12);
  const month0 = ordinal % 12;
  return new Date(Date.UTC(year, month0, clampDayToMonth(year, month0, terms.paymentDayOfMonth)));
}

/**
 * How many instalments have fallen due by `asOf`, never counting past the end
 * of the term. Month arithmetic first, then at most a couple of corrections —
 * a ten-year lease costs the same as a one-month one.
 */
export function instalmentsDueBy(terms: RentTerms, asOf: Date): number {
  if (asOf.getTime() < terms.leaseStart.getTime()) return 0;
  const horizon = new Date(Math.min(asOf.getTime(), terms.leaseEnd.getTime()));

  let n = monthOrdinal(horizon) - monthOrdinal(terms.leaseStart);
  while (n > 0 && instalmentDueDate(terms, n).getTime() > horizon.getTime()) n -= 1;
  return n + 1;
}

/** Rent that should have been received by `asOf`. */
export function expectedToDate(terms: RentTerms, asOf: Date): number {
  return money(instalmentsDueBy(terms, asOf) * terms.monthlyRent);
}

/**
 * What is owed right now. Never negative: a tenant who paid six months up front
 * is in credit, not in arrears, and the credit shows as `creditBalance`.
 */
export function arrearsFor(terms: RentTerms, asOf: Date): number {
  return money(Math.max(0, expectedToDate(terms, asOf) - (terms.totalPaid ?? 0)));
}

export function creditBalanceFor(terms: RentTerms, asOf: Date): number {
  return money(Math.max(0, (terms.totalPaid ?? 0) - expectedToDate(terms, asOf)));
}

/** The first instalment strictly after `asOf`, or null once the term is over. */
export function nextPaymentDue(terms: RentTerms, asOf: Date): Date | null {
  const dueSoFar = instalmentsDueBy(terms, asOf);
  const next = instalmentDueDate(terms, dueSoFar);
  if (next.getTime() <= asOf.getTime()) {
    const following = instalmentDueDate(terms, dueSoFar + 1);
    return following.getTime() > terms.leaseEnd.getTime() ? null : following;
  }
  return next.getTime() > terms.leaseEnd.getTime() ? null : next;
}

export function daysUntil(date: Date, asOf: Date): number {
  return Math.ceil((date.getTime() - asOf.getTime()) / MS_PER_DAY);
}

/**
 * Where the lease sits in its lifecycle, from the dates and the balance alone.
 *
 * `current` wins whenever an operator has set it by hand — a terminated lease
 * does not quietly become `active` again because its end date has not passed.
 */
export function lifecycleStatus(
  terms: RentTerms,
  asOf: Date,
  current?: string,
): 'active' | 'inArrears' | 'expiring' | 'ended' | 'draft' | 'pendingSignature' | 'terminated' {
  if (current && (MANUAL_LEASE_STATUSES as readonly string[]).includes(current)) {
    return current as 'draft' | 'pendingSignature' | 'terminated';
  }
  if (asOf.getTime() > terms.leaseEnd.getTime()) return 'ended';
  if (arrearsFor(terms, asOf) > 0) return 'inArrears';
  if (daysUntil(terms.leaseEnd, asOf) <= LEASE_EXPIRING_WINDOW_DAYS) return 'expiring';
  return 'active';
}

/**
 * How hard to push, given how far behind the tenant is.
 *
 * Expressed in months of rent rather than in currency, so the same thresholds
 * hold for a GHS 800 room and a USD 4,000 townhouse.
 */
export function arrearsEscalation(arrears: number, monthlyRent: number): ArrearsEscalation {
  if (arrears <= 0) return 'none';
  if (monthlyRent <= 0) return 'reminder';
  const months = arrears / monthlyRent;
  if (months <= 1) return 'reminder';
  if (months <= 2) return 'firstNotice';
  if (months <= 3) return 'finalNotice';
  return 'legalReferral';
}

export interface AppliedPayment {
  totalPaid: number;
  arrearsAmount: number;
  creditBalance: number;
  nextDueDate: Date | null;
  status: ReturnType<typeof lifecycleStatus>;
  escalation: ArrearsEscalation;
}

/**
 * The whole effect of one rent payment, computed in one place.
 *
 * The handler writes exactly what this returns. A payment recorded but not
 * reflected in `totalPaid` is the bug that produces disputed arrears, so the
 * two are never derived separately.
 */
export function applyPayment(terms: RentTerms, amount: number, at: Date, current?: string): AppliedPayment {
  const totalPaid = money((terms.totalPaid ?? 0) + amount);
  const settled: RentTerms = { ...terms, totalPaid };
  const arrearsAmount = arrearsFor(settled, at);
  return {
    totalPaid,
    arrearsAmount,
    creditBalance: creditBalanceFor(settled, at),
    nextDueDate: nextPaymentDue(settled, at),
    status: lifecycleStatus(settled, at, current),
    escalation: arrearsEscalation(arrearsAmount, terms.monthlyRent),
  };
}

/** The reminder decision for one lease, on one day. */
export interface ReminderVerdict {
  send: boolean;
  reason: 'dueSoon' | 'inArrears' | 'none';
  dueDate: Date | null;
  daysUntilDue: number | null;
  arrears: number;
  escalation: ArrearsEscalation;
}

/**
 * Should this lease be reminded today?
 *
 * Two triggers, in priority order: money already overdue beats an instalment
 * merely approaching, because a tenant who is behind should not receive a
 * cheerful "rent is due in five days" as their only contact.
 */
export function reminderFor(
  terms: RentTerms,
  asOf: Date,
  leadDays: number = RENT_REMINDER_LEAD_DAYS,
): ReminderVerdict {
  const arrears = arrearsFor(terms, asOf);
  const dueDate = nextPaymentDue(terms, asOf);
  const daysOut = dueDate ? daysUntil(dueDate, asOf) : null;
  const escalation = arrearsEscalation(arrears, terms.monthlyRent);

  if (arrears > 0) {
    return { send: true, reason: 'inArrears', dueDate, daysUntilDue: daysOut, arrears, escalation };
  }
  if (daysOut !== null && daysOut >= 0 && daysOut <= leadDays) {
    return { send: true, reason: 'dueSoon', dueDate, daysUntilDue: daysOut, arrears, escalation };
  }
  return { send: false, reason: 'none', dueDate, daysUntilDue: daysOut, arrears, escalation };
}

/** A statement line, for the schedule endpoint and for a PDF later. */
export interface ScheduleEntry {
  instalment: number;
  dueDate: Date;
  amount: number;
  cumulativeDue: number;
  settled: boolean;
}

/**
 * The full instalment schedule for a term, with each line marked settled or not
 * against the running total paid. Capped so a decade-long lease cannot be used
 * to make the server build a 120-element array on an unauthenticated guess —
 * the cap is reported rather than silently applied.
 */
export function paymentSchedule(
  terms: RentTerms,
  asOf: Date,
  limit = 36,
): { entries: ScheduleEntry[]; totalInstalments: number; truncated: boolean } {
  const total = instalmentsDueBy({ ...terms }, terms.leaseEnd);
  const count = Math.min(total, Math.max(1, limit));
  const paid = terms.totalPaid ?? 0;

  const entries: ScheduleEntry[] = [];
  for (let n = 0; n < count; n += 1) {
    const cumulativeDue = money((n + 1) * terms.monthlyRent);
    entries.push({
      instalment: n,
      dueDate: instalmentDueDate(terms, n),
      amount: money(terms.monthlyRent),
      cumulativeDue,
      settled: paid >= cumulativeDue,
    });
  }
  void asOf;
  return { entries, totalInstalments: total, truncated: total > count };
}
