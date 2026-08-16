/**
 * Payments — who may see whose, who may write one down, and what a summary means.
 *
 * Pure: no Express, no Mongoose, no clock. `npm run verify` runs it with nothing
 * installed, which is the point — these are the rules about *money*, and they
 * are the ones that must be assertable in a second rather than in a staging
 * environment somebody has to remember to check.
 *
 * ══ Recording a payment is a new power, and a narrow one ═══════════════════
 *
 * Until now the ledger was read-only over HTTP. Payments were written by the
 * flows that caused them — rent by the lease schedule, a fare by a completed
 * ride — and never by a client asserting that money moved. That rule existed
 * for a good reason and it is being relaxed deliberately, not forgotten.
 *
 * It is being relaxed because The Gambia runs on cash and mobile money. A
 * coordinator collects rent in person, in a compound, from a tenant who has no
 * card. If LRMC cannot write that down, the tenant's payment history is empty,
 * their `paymentsEvidence` reports `hasRecord: false`, and the scoring engine
 * treats a person who has paid rent on time for two years as somebody it has
 * never heard of. Refusing to record cash would push the whole informal economy
 * out of the evidence base — which is precisely the population LRMC exists for.
 *
 * So it is allowed, and it is fenced:
 *
 *   1. **Only rent and deposits.** Never a payout. A coordinator who could
 *      record `landlordPayout` could mark money as sent that was never sent,
 *      and the landlord's own ledger would agree with them.
 *   2. **Nobody records a payment they are party to.** Not as payer, not as
 *      payee. This is the same rule as "nobody produces evidence about
 *      themselves" — a coordinator writing down that they received rent, or
 *      that they paid it, is not a record, it is an assertion.
 *   3. **`recordedBy` comes from the token**, never from the body, and the row
 *      keeps it forever. A cash receipt with no named author is not evidence of
 *      anything.
 *   4. **A receipt is idempotent.** Two taps on a bad connection must not
 *      double a tenant's rent — see `receiptReference`.
 *
 * ══ Two reliability figures, and why they differ ═══════════════════════════
 *
 * This is worth reading before changing either.
 *
 *   `onTimeRate`  — of the instalments that settled, how many were on time.
 *                   `(onTime / (onTime + late)) * 100`, null over nothing.
 *                   This is what a payments page shows a tenant.
 *
 *   `paymentReliability` (in `config/evidence.ts`) — the same, but **missed
 *                   instalments count in the denominator**. A person who paid
 *                   three and skipped seven is not 100% reliable, and the
 *                   scoring engine must not be told they are.
 *
 * They are different numbers on purpose and a tenant can see both. That is a
 * support ticket waiting to happen unless they are *labelled* differently, so
 * they are: "paid on time" on a screen, "payment reliability" in an assessment.
 * Never relabel one to match the other. The right fix if they confuse somebody
 * is to show them together with the arithmetic, not to quietly make one the
 * other.
 */

import { PAYMENT_STATUSES, SETTLED_PAYMENT_STATUSES, FAILED_PAYMENT_STATUSES } from '../../config/lifecycles.js';

/* ─────────────────────────────────────────────────────────────────────────────
 * What may be recorded by hand
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Kinds a coordinator may write down as having happened.
 *
 * Money coming *in* from a member, and nothing else. Every kind that moves
 * money *out* of LRMC — `landlordPayout`, `driverPayout`, `refund` — is absent
 * deliberately: those are settled by a payout batch that reconciles against a
 * provider, and a hand-written one would be a claim that a transfer occurred
 * with nothing on the other side to check it against.
 */
export const RECORDABLE_KINDS = ['rent', 'deposit'] as const;
export type RecordableKind = (typeof RECORDABLE_KINDS)[number];

/**
 * How the money actually arrived.
 *
 * Restricted to the instruments a person hands over in a room. `card` is absent
 * because a card payment has a provider behind it, and a card payment with no
 * provider reference is either a mistake or somebody covering one.
 */
export const RECORDABLE_METHODS = ['cash', 'mobileMoney', 'bankTransfer'] as const;
export type RecordableMethod = (typeof RECORDABLE_METHODS)[number];

/**
 * The largest single receipt anybody may write by hand, in the minor unit's
 * major denomination (dalasi, not bututs).
 *
 * Not a security control — a coordinator entering two receipts defeats it — but
 * a typo control. `1000000` where `10000` was meant is one keystroke, and a
 * ceiling turns it into a refusal at the point of entry rather than a figure
 * somebody has to notice on a reconciliation three weeks later.
 */
export const MAX_RECORDED_AMOUNT = 500_000;

/* ─────────────────────────────────────────────────────────────────────────────
 * Who may record
 * ────────────────────────────────────────────────────────────────────────── */

export interface PaymentActor {
  userId: string;
  roles: string[];
}

/** Roles whose remit is the whole ledger. */
export const LEDGER_WIDE_ROLES = ['founder', 'hqExecutive', 'backOfficeStaff'] as const;

/** Roles that may write a receipt for money they took in person. */
export const RECORDING_ROLES = ['coordinator', 'backOfficeStaff', 'hqExecutive', 'founder'] as const;

export interface RecordInput {
  /** The member the money came from. */
  payer?: string | null;
  /** Whoever it is destined for — a landlord, or LRMC itself. */
  payee?: string | null;
  kind?: string | null;
  method?: string | null;
  amount?: number | null;
  currency?: string | null;
  /** The lease or request the money is against. */
  subject?: string | null;
  subjectKind?: string | null;
  /** When the money changed hands, which is not when it was typed in. */
  paidAt?: string | Date | null;
}

/**
 * Everything wrong with a recording attempt, as a list.
 *
 * A list rather than a first-failure throw, because the person entering it is
 * standing in a compound on a phone: telling them the amount is wrong, then the
 * date is wrong, then the payer is wrong, one round trip at a time, is how a
 * receipt ends up not being written at all.
 *
 * Each entry names a field so the interface can put the message beside it.
 */
export function recordingProblems(
  actor: PaymentActor | null | undefined,
  input: RecordInput,
): { field: string; code: string; message: string }[] {
  const out: { field: string; code: string; message: string }[] = [];
  const add = (field: string, code: string, message: string) =>
    out.push({ field, code, message });

  if (!actor || typeof actor.userId !== 'string' || !actor.userId
      || !Array.isArray(actor.roles)) {
    add('actor', 'unidentified', 'A recorded payment needs a named author.');
    return out;
  }

  if (!mayRecord(actor)) {
    add('actor', 'not-permitted',
      'Only a coordinator or Back Office may write down a payment taken in person.');
  }

  /* The self-dealing rule. A coordinator recording that they themselves paid or
   * received the money is not producing a record, they are producing an
   * assertion — and it is the one assertion nobody else is in a position to
   * check. Same principle as a subject not scoring their own reference. */
  if (input.payer && input.payer === actor.userId) {
    add('payer', 'self-dealing',
      'You cannot record a payment you made yourself. Ask a colleague to record it.');
  }
  if (input.payee && input.payee === actor.userId) {
    add('payee', 'self-dealing',
      'You cannot record a payment made to you. Ask a colleague to record it.');
  }

  if (!input.payer) {
    add('payer', 'required', 'Say who the money came from.');
  }

  if (!input.kind) {
    add('kind', 'required', 'Say what the payment was for.');
  } else if (!(RECORDABLE_KINDS as readonly string[]).includes(input.kind)) {
    add('kind', 'not-recordable',
      `Only ${RECORDABLE_KINDS.join(' and ')} may be recorded by hand. Payouts are settled by a batch.`);
  }

  if (input.method && !(RECORDABLE_METHODS as readonly string[]).includes(input.method)) {
    add('method', 'not-recordable',
      'Record how the money actually arrived: cash, mobile money or a bank transfer.');
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    add('amount', 'required', 'Enter the amount that changed hands.');
  } else if (amount > MAX_RECORDED_AMOUNT) {
    add('amount', 'too-large',
      `A single receipt above ${MAX_RECORDED_AMOUNT.toLocaleString('en-GB')} needs Back Office to enter it.`);
  }

  /* A receipt dated in the future is either a typo or a promise. Neither is a
   * payment, and both would sort to the top of a history and look like the
   * most recent thing that happened. */
  const paidAt = toTime(input.paidAt);
  if (input.paidAt && paidAt === null) {
    add('paidAt', 'unreadable', 'That date could not be read.');
  }

  return out;
}

export function mayRecord(actor: PaymentActor | null | undefined): boolean {
  if (!actor || !Array.isArray(actor.roles)) return false;
  return (RECORDING_ROLES as readonly string[]).some((r) => actor.roles.includes(r));
}

/**
 * A receipt dated after `now` is refused.
 *
 * Separate from `recordingProblems` because it needs a clock and that file does
 * not have one — the handler passes the time in, and the suite passes a fixed
 * one. `GRACE_MS` allows for a phone whose clock is a few minutes fast, which
 * is extremely common and is not somebody backdating anything.
 */
export const FUTURE_GRACE_MS = 10 * 60 * 1000;

export function futureDatedBy(paidAt: string | Date | null | undefined, now: number): number {
  const t = toTime(paidAt);
  if (t === null) return 0;
  return Math.max(0, t - now - FUTURE_GRACE_MS);
}

function toTime(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Idempotency
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * A stable reference for a hand-written receipt.
 *
 * Two taps on a bad connection must not double a tenant's rent. The reference
 * is derived from what makes the payment *the same payment* — who paid, what
 * for, against which lease, how much, and which day — so a retry collides with
 * the row already written and the unique index refuses it, while a genuine
 * second payment of the same amount on a different day does not.
 *
 * The day, not the timestamp: a coordinator retrying ninety seconds later has
 * typed a slightly different `paidAt`, and a reference including seconds would
 * let the retry through. Two real payments of exactly the same amount, for the
 * same lease, by the same person, on the same day are rare enough that the
 * right answer is to make somebody confirm it rather than to let a
 * double-charge through silently — the handler surfaces the collision rather
 * than swallowing it.
 */
export function receiptReference(input: {
  payer?: string | null;
  subject?: string | null;
  kind?: string | null;
  amount?: number | null;
  paidAt?: string | Date | null;
}): string {
  const day = dayKey(input.paidAt);
  const parts = [
    'RCT',
    String(input.payer ?? 'anon').slice(-8),
    String(input.subject ?? 'none').slice(-8),
    String(input.kind ?? 'x').slice(0, 4),
    String(Math.round(Number(input.amount) || 0)),
    day,
  ];
  return parts.join('-').toUpperCase();
}

/** `YYYYMMDD` in UTC, or `NODATE`. UTC so a receipt does not change identity
 *  when the server's timezone does. */
export function dayKey(value: string | Date | null | undefined): string {
  const t = toTime(value);
  if (t === null) return 'NODATE';
  const d = new Date(t);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Who may read whose history
 * ────────────────────────────────────────────────────────────────────────── */

export type HistoryScope =
  /** Every row about this person. */
  | 'all'
  /** Only the rows this actor wrote themselves. */
  | 'recordedByMe'
  /** Nothing. */
  | 'none';

/**
 * How much of one person's payment history another may see.
 *
 * **A coordinator gets `recordedByMe`, not `all`,** and that is the interesting
 * line. They may write a receipt, so they must be able to check what they
 * wrote; they have no business reading a year of somebody's finances because
 * they once took rent from them in a compound. Recording and reading are
 * different powers and this is where they are separated.
 *
 * Back Office sees everything because reconciliation is their job. A person
 * always sees their own.
 */
export function historyScope(
  actor: PaymentActor | null | undefined,
  subjectId: string | null | undefined,
): HistoryScope {
  if (!actor || typeof actor.userId !== 'string' || !actor.userId) return 'none';
  if (!Array.isArray(actor.roles)) return 'none';
  if (!subjectId) return 'none';

  if (actor.userId === subjectId) return 'all';
  if ((LEDGER_WIDE_ROLES as readonly string[]).some((r) => actor.roles.includes(r))) return 'all';
  if (actor.roles.includes('coordinator')) return 'recordedByMe';
  return 'none';
}

/* ─────────────────────────────────────────────────────────────────────────────
 * The summary
 * ────────────────────────────────────────────────────────────────────────── */

/** Days after which a settled payment counts as late rather than on time. */
export const LATE_AFTER_DAYS = 3;

export interface SummaryRow {
  status: string;
  amount?: number | null;
  currency?: string | null;
  dueDate?: Date | string | null;
  paidAt?: Date | string | null;
}

export interface PaymentSummary {
  total: number;
  settled: number;
  onTime: number;
  late: number;
  failed: number;
  awaiting: number;
  /**
   * Of what settled. `null` over nothing — see the header. Never `0`, which
   * would tell somebody with no history that they have a bad one.
   */
  onTimeRate: number | null;
  /** One entry per currency, never summed. There is no exchange rate here. */
  settledByCurrency: { currency: string; amount: number; payments: number }[];
}

/**
 * Turn ledger rows into the figures a payments page shows.
 *
 * Deliberately mirrors `evidenceRules.paymentsEvidenceFrom` in how it decides
 * on-time versus late — same constant, same "no due date on record cannot be
 * late" rule — so a tenant reading their payments page and a coordinator
 * reading their assessment are looking at the same underlying judgement about
 * each instalment, even though the two summarise it differently.
 *
 * `pending` and `processing` are counted as awaiting and excluded from every
 * rate. An instalment that is not yet due is not evidence of anything, and
 * counting it against somebody would make every tenant look worse on the first
 * of the month.
 */
export function summarisePayments(rows: SummaryRow[], launchCurrency = 'GMD'): PaymentSummary {
  const settledStatuses = SETTLED_PAYMENT_STATUSES as readonly string[];
  const failedStatuses = FAILED_PAYMENT_STATUSES as readonly string[];

  const list = Array.isArray(rows) ? rows : [];
  const settled = list.filter((r) => settledStatuses.includes(r.status));
  const failed = list.filter((r) => failedStatuses.includes(r.status));
  const awaiting = list.filter((r) => r.status === 'pending' || r.status === 'processing');

  let onTime = 0;
  let late = 0;
  for (const row of settled) {
    if (isLate(row)) late += 1;
    else onTime += 1;
  }

  const byCurrency = new Map<string, { amount: number; payments: number }>();
  for (const row of settled) {
    const key = row.currency || launchCurrency;
    const entry = byCurrency.get(key) ?? { amount: 0, payments: 0 };
    const amount = Number(row.amount);
    entry.amount += Number.isFinite(amount) ? Math.max(0, amount) : 0;
    entry.payments += 1;
    byCurrency.set(key, entry);
  }

  return {
    total: list.length,
    settled: settled.length,
    onTime,
    late,
    failed: failed.length,
    awaiting: awaiting.length,
    onTimeRate: onTimeRateFrom(onTime, late),
    settledByCurrency: [...byCurrency.entries()]
      .map(([currency, v]) => ({ currency, amount: v.amount, payments: v.payments }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/**
 * `(onTime / (onTime + late)) * 100`, or `null`.
 *
 * The null is the whole function. `onTime / 0` is `NaN`, `NaN` renders as
 * "NaN%" on a tile, and a caller who "fixed" that by returning 0 would be
 * telling a tenant on their first day that none of their payments were on
 * time — which is a statement about them rather than about LRMC's records.
 */
export function onTimeRateFrom(onTime: number, late: number): number | null {
  const good = Number.isFinite(onTime) ? Math.max(0, onTime) : 0;
  const bad = Number.isFinite(late) ? Math.max(0, late) : 0;
  const total = good + bad;
  if (total <= 0) return null;
  return Math.round((good / total) * 1000) / 10;
}

/**
 * Late, by the same rule the evidence gatherer uses.
 *
 * A payment with no due date on record cannot be late — LRMC has nothing to
 * measure lateness against, and holding a gap in LRMC's own data against a
 * tenant is the failure mode this whole engine is built to avoid.
 */
export function isLate(row: SummaryRow): boolean {
  const due = toTime(row.dueDate);
  const paid = toTime(row.paidAt);
  if (due === null || paid === null) return false;
  return paid - due > LATE_AFTER_DAYS * 86_400_000;
}

/** Every ledger status is settled, failed, awaiting, or returned. Asserted. */
export const RETURNED_PAYMENT_STATUSES = ['refunded', 'cancelled'] as const;

export function unclassifiedStatuses(): string[] {
  const known = [
    ...(SETTLED_PAYMENT_STATUSES as readonly string[]),
    ...(FAILED_PAYMENT_STATUSES as readonly string[]),
    'pending', 'processing',
    ...RETURNED_PAYMENT_STATUSES,
  ];
  return (PAYMENT_STATUSES as readonly string[]).filter((s) => !known.includes(s));
}
