/**
 * The order state machine, and who may move it.
 *
 * Written as a table rather than as conditionals scattered through the router,
 * because the interesting property of an escrow flow is not any single
 * transition — it is that the ones nobody thought of are impossible. A table
 * can be read in full and asserted exhaustively. A hundred `if` statements
 * cannot, and the transition somebody forgot is where the money goes missing.
 *
 * Pure: no Mongoose, no clock, no Express.
 */

export const ORDER_STATUSES = [
  /** Created, nothing paid. The buyer can still walk away freely. */
  'pending',
  /** Buyer has paid. **LRMC is holding the money**, not the merchant. */
  'paid',
  /** Merchant has taken the job on. */
  'accepted',
  /** Merchant says it is done or delivered. The release clock starts here. */
  'fulfilled',
  /** Buyer agrees it is done. */
  'confirmed',
  /** Money has left escrow: merchant paid, commission retained. Terminal. */
  'released',
  /** Ended before payment, or by agreement afterwards. Terminal. */
  'cancelled',
  /** Money returned to the buyer, in full or in part. Terminal. */
  'refunded',
  /** Contested. Escrow is frozen until Back Office rules. */
  'disputed',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Nothing moves out of these. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ['released', 'cancelled', 'refunded'];

/**
 * Who is allowed to make a given move.
 *
 * `system` is the scheduled auto-release, which belongs to no person — see
 * `orderMath.AUTO_RELEASE_DAYS` for why it has to exist at all.
 */
export type OrderActor = 'buyer' | 'merchant' | 'backOffice' | 'system';

export interface Transition {
  from: OrderStatus;
  to: OrderStatus;
  /** Any one of these may perform it. */
  by: readonly OrderActor[];
  /** Why this transition exists, in one line. */
  note: string;
}

/**
 * Every legal move in the marketplace, exhaustively.
 *
 * Four rules are load-bearing and each is deliberately *absent* from the table
 * rather than guarded somewhere downstream:
 *
 * 1. **A merchant can never move an order to `released`.** Releasing is the
 *    buyer confirming, Back Office ruling, or the clock expiring. A merchant
 *    who could release would simply release, and escrow would be decorative.
 *
 * 2. **Nothing reaches `paid` except through payment.** There is no
 *    `pending → accepted`; an order a merchant "accepts" before the money
 *    arrives is a merchant working for free and not knowing it.
 *
 * 3. **`disputed` is reachable from every live state and resolvable only by
 *    Back Office.** A dispute either or both parties could quietly clear is
 *    not a dispute.
 *
 * 4. **Terminal is terminal.** No row leaves `released`, `cancelled` or
 *    `refunded`. Reopening settled money is how a ledger stops reconciling.
 */
export const TRANSITIONS: readonly Transition[] = [
  { from: 'pending',   to: 'paid',      by: ['buyer', 'system'],
    note: 'Payment captured; LRMC now holds the funds.' },
  { from: 'pending',   to: 'cancelled', by: ['buyer', 'merchant', 'backOffice'],
    note: 'Nothing has been paid, so anyone may end it.' },

  { from: 'paid',      to: 'accepted',  by: ['merchant'],
    note: 'Merchant takes the order on.' },
  { from: 'paid',      to: 'cancelled', by: ['merchant', 'backOffice'],
    note: 'Merchant declines. Refund follows.' },
  { from: 'paid',      to: 'refunded',  by: ['backOffice'],
    note: 'Returned before any work began.' },
  { from: 'paid',      to: 'disputed',  by: ['buyer', 'merchant'],
    note: 'Contested before acceptance.' },

  { from: 'accepted',  to: 'fulfilled', by: ['merchant'],
    note: 'Merchant reports delivery or completion; the release clock starts.' },
  { from: 'accepted',  to: 'cancelled', by: ['backOffice'],
    note: 'Called off after acceptance — Back Office only, since both sides have committed.' },
  { from: 'accepted',  to: 'disputed',  by: ['buyer', 'merchant'],
    note: 'Contested mid-order.' },

  { from: 'fulfilled', to: 'confirmed', by: ['buyer'],
    note: 'Buyer agrees it is done.' },
  { from: 'fulfilled', to: 'released',  by: ['system'],
    note: 'Auto-release: a silent buyer must not hold a merchant\'s money for ever.' },
  { from: 'fulfilled', to: 'disputed',  by: ['buyer'],
    note: 'Buyer says it is not done, or not as described.' },

  { from: 'confirmed', to: 'released',  by: ['system', 'backOffice'],
    note: 'Escrow pays out: merchant net, commission retained.' },

  { from: 'disputed',  to: 'released',  by: ['backOffice'],
    note: 'Ruled for the merchant.' },
  { from: 'disputed',  to: 'refunded',  by: ['backOffice'],
    note: 'Ruled for the buyer.' },
  { from: 'disputed',  to: 'cancelled', by: ['backOffice'],
    note: 'Ruled void.' },
];

export interface TransitionVerdict {
  allowed: boolean;
  reason?: 'terminal' | 'noSuchTransition' | 'wrongActor';
  /** Who could have done it, when the refusal was about the actor. */
  permittedActors?: readonly OrderActor[];
}

/**
 * May this actor move this order from here to there?
 *
 * The three refusals are distinguished because they call for different
 * answers: a terminal order is finished, an impossible transition is a bug in
 * the caller, and the wrong actor is a permissions message that should name
 * who *can*.
 */
export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
): TransitionVerdict {
  if (TERMINAL_STATUSES.includes(from)) return { allowed: false, reason: 'terminal' };

  const row = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!row) return { allowed: false, reason: 'noSuchTransition' };

  if (!row.by.includes(actor)) {
    return { allowed: false, reason: 'wrongActor', permittedActors: row.by };
  }
  return { allowed: true };
}

/** Every state reachable from here, for the actor's available buttons. */
export function nextStatuses(from: OrderStatus, actor: OrderActor): OrderStatus[] {
  if (TERMINAL_STATUSES.includes(from)) return [];
  return TRANSITIONS.filter((t) => t.from === from && t.by.includes(actor)).map((t) => t.to);
}

/** Is LRMC currently holding money for this order? */
export function isEscrowHeld(status: OrderStatus): boolean {
  return ['paid', 'accepted', 'fulfilled', 'confirmed', 'disputed'].includes(status);
}

/** Is the order finished, whatever the outcome? */
export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Does reaching this state move money?
 *
 * The router uses this to decide whether a ledger row is owed. Getting it from
 * the table rather than from a condition at the call site means a new
 * money-moving state cannot be added without this answering for it.
 */
export function movesMoney(to: OrderStatus): 'capture' | 'release' | 'refund' | null {
  if (to === 'paid') return 'capture';
  if (to === 'released') return 'release';
  if (to === 'refunded') return 'refund';
  return null;
}

/** Plain-language line for the buyer's and merchant's screens. */
export function describeStatus(status: OrderStatus): string {
  switch (status) {
    case 'pending':   return 'Awaiting payment';
    case 'paid':      return 'Paid — held by LRMC until the order is complete';
    case 'accepted':  return 'Accepted by the merchant';
    case 'fulfilled': return 'Delivered — awaiting your confirmation';
    case 'confirmed': return 'Confirmed — settling with the merchant';
    case 'released':  return 'Complete — merchant settled';
    case 'cancelled': return 'Cancelled';
    case 'refunded':  return 'Refunded';
    case 'disputed':  return 'In dispute — LRMC is holding the funds';
  }
}
