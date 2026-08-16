/**
 * What to do with a webhook that has arrived.
 *
 * Pure. Every decision about whether an event moves money is made here, so it
 * can be exercised against a replay, a partial failure and a mismatched amount
 * in a suite with no database and no network.
 *
 * ── Retries are the normal case, not the edge case ────────────────────────
 * Stripe retries any webhook it does not get a 2xx for, with backoff, for days.
 * It also delivers the same event more than once in ordinary operation. So
 * "handle a duplicate" is not defensive programming here — it is the main path,
 * and a handler that books income on every delivery pays a merchant twice for
 * one sale on a day the mail server is slow.
 *
 * That is not hypothetical: the other LRMC codebase does exactly this. Its
 * fulfilment writes the ledger and *then* sends the delivery email; a thrown
 * email means a non-2xx, and Stripe's next attempt runs the ledger write again.
 *
 * ── Why the record is written before the work, not after ──────────────────
 * There is no transaction to lean on: `d2` is unsettled and a single-node mongod
 * has none. So the sequence is: claim the event with a unique index, do the
 * work, mark it applied. Each step is honest about what it knows.
 *
 *   • Claim fails on duplicate key → somebody else has it. Answer 200.
 *   • Claimed and applied          → a genuine replay. Answer 200, do nothing.
 *   • Claimed and *not* applied, and stale → the previous attempt died between
 *     the two writes. Retry it. This is the only case where re-running the work
 *     is correct, and it is why `claimedAt` is recorded.
 *
 * The alternative — mark applied first — turns any crash into money that was
 * taken and never credited, with nothing left to say so.
 */

import type { Currency } from '../../config/currencies.js';

/** The events this platform acts on. Everything else is acknowledged and dropped. */
export const HANDLED_EVENT_TYPES = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export function isHandledEvent(type: string): type is HandledEventType {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * How long a claimed-but-unapplied event waits before another attempt may take
 * it.
 *
 * Long enough that a slow-but-alive handler is not raced by the next delivery;
 * short enough that a crash is recovered while Stripe is still retrying.
 */
export const CLAIM_STALE_AFTER_MS = 5 * 60_000;

export type IntakeDecision =
  | 'process'
  | 'alreadyApplied'
  | 'inFlight'
  | 'retryStale'
  | 'ignoreUnhandled';

export interface ClaimRecord {
  eventId: string;
  appliedAt?: Date | null;
  claimedAt?: Date | null;
}

/**
 * What this delivery is.
 *
 * `existing` is the claim row if one is already there. `null` means this
 * process just claimed it.
 */
export function intakeDecision(
  eventType: string,
  existing: ClaimRecord | null,
  now: number,
): IntakeDecision {
  if (!isHandledEvent(eventType)) return 'ignoreUnhandled';
  if (!existing) return 'process';
  if (existing.appliedAt) return 'alreadyApplied';

  const claimedAt = existing.claimedAt ? existing.claimedAt.getTime() : 0;
  /* Claimed, never applied. Either a handler is still working or one died
   * between the claim and the apply. Age is the only thing that distinguishes
   * them from here, and guessing wrong in the other direction — treating an
   * in-flight event as dead — is what produces the double-credit. */
  return now - claimedAt > CLAIM_STALE_AFTER_MS ? 'retryStale' : 'inFlight';
}

/** An intake decision that should end in a 2xx with no work done. */
export function isAcknowledgeOnly(decision: IntakeDecision): boolean {
  return decision === 'alreadyApplied'
    || decision === 'inFlight'
    || decision === 'ignoreUnhandled';
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Reconciliation
 *
 * The webhook body says what was paid. It is signed, so it is authentic — and
 * it is still not the authority on whether *this order* is now settled, because
 * an authentic event about a different order, or about the right order at the
 * wrong price, must not settle anything.
 * ══════════════════════════════════════════════════════════════════════════ */

export interface OrderExpectation {
  orderId: string;
  /** Whole units, as the order was priced. */
  total: number;
  currency: Currency;
  status: string;
}

export interface IntentFact {
  orderId?: string;
  /** Minor units, as the gateway holds them. */
  amountMinor?: number;
  currency?: Currency;
  status?: string;
}

export interface ReconcileProblem {
  code: 'wrongOrder' | 'wrongAmount' | 'wrongCurrency' | 'notSucceeded' | 'alreadySettled';
  message: string;
}

/**
 * May this intent settle this order?
 *
 * `expectedMinor` is passed in rather than computed here so the conversion
 * lives in exactly one place — `checkout.ts` — and this module stays free of
 * currency arithmetic it would then be a second opinion on.
 */
export function reconcile(
  order: OrderExpectation,
  intent: IntentFact,
  expectedMinor: number,
  settledStatuses: readonly string[] = ['paid', 'fulfilled', 'released', 'refunded'],
): ReconcileProblem[] {
  const out: ReconcileProblem[] = [];

  if (intent.orderId !== order.orderId) {
    out.push({
      code: 'wrongOrder',
      message: `This intent is for order ${intent.orderId ?? '(none)'}, not ${order.orderId}.`,
    });
    /* No point checking the money once the subject is wrong, and reporting an
     * amount mismatch against somebody else's order is a confusing way to say
     * "this is not your payment". */
    return out;
  }

  if (intent.status !== 'succeeded') {
    out.push({ code: 'notSucceeded', message: `The intent is ${intent.status ?? 'unknown'}.` });
  }
  if (intent.currency !== order.currency) {
    out.push({
      code: 'wrongCurrency',
      message: `Paid in ${intent.currency ?? '(none)'}, ordered in ${order.currency}.`,
    });
  }
  /* Exact. Not "at least" — an overpayment is a support conversation, not a
   * settlement, and silently accepting one means LRMC keeps the difference. */
  if (intent.amountMinor !== expectedMinor) {
    out.push({
      code: 'wrongAmount',
      message: `Paid ${intent.amountMinor ?? 0}, order is ${expectedMinor} (minor units).`,
    });
  }
  if (settledStatuses.includes(order.status)) {
    out.push({ code: 'alreadySettled', message: `The order is already ${order.status}.` });
  }
  return out;
}

export function maySettle(problems: ReconcileProblem[]): boolean {
  return problems.length === 0;
}
