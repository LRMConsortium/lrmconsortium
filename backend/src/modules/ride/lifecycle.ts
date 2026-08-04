/**
 * The Ususu ride state machine — pure data and two pure functions.
 *
 * Kept out of `ride.model.ts` deliberately: the model pulls in Mongoose, and the
 * lifecycle is the part of ride dispatch worth asserting without a database. The
 * machine is data rather than `if` statements scattered through handlers, which
 * is what stops a completed ride being accepted a second time.
 */

export const RIDE_STATUSES = [
  'requested',
  'searching',
  'accepted',
  'arriving',
  'inProgress',
  'completed',
  'cancelledByRider',
  'cancelledByDriver',
  'expired',
] as const;

export type RideStatus = (typeof RIDE_STATUSES)[number];

/** The only legal moves. Anything else is a 409. */
export const RIDE_TRANSITIONS: Record<RideStatus, readonly RideStatus[]> = {
  requested: ['searching', 'accepted', 'cancelledByRider', 'expired'],
  searching: ['accepted', 'cancelledByRider', 'expired'],
  accepted: ['arriving', 'inProgress', 'cancelledByRider', 'cancelledByDriver'],
  arriving: ['inProgress', 'cancelledByRider', 'cancelledByDriver'],
  inProgress: ['completed'],
  completed: [],
  cancelledByRider: [],
  cancelledByDriver: [],
  expired: [],
};

/** States a ride can never leave. */
export const RIDE_TERMINAL_STATUSES = RIDE_STATUSES.filter(
  (s) => RIDE_TRANSITIONS[s].length === 0,
);

export function canTransition(from: string, to: string): boolean {
  return (RIDE_TRANSITIONS as Record<string, readonly string[]>)[from]?.includes(to) ?? false;
}

/** Every status reachable from `requested`, breadth-first. Used to prove no state is orphaned. */
export function reachableRideStatuses(from: RideStatus = 'requested'): RideStatus[] {
  const seen = new Set<RideStatus>([from]);
  const queue: RideStatus[] = [from];
  while (queue.length > 0) {
    for (const next of RIDE_TRANSITIONS[queue.shift()!]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}
