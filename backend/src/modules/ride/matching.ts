/**
 * Driver matching — pure ranking, no database.
 *
 * Two stages, deliberately separated. `isDispatchable` is a set of hard filters:
 * a driver who fails one is not a worse match, they are not a match at all, and
 * blending that into a score is how an unverified driver ends up first in the
 * list on a quiet night. `matchScore` then ranks whoever survives.
 *
 * The score is a placeholder for a real dispatch optimiser — it has no traffic
 * model and no forward-looking supply balancing — but it is a *deterministic*
 * placeholder, which means the ranking can be asserted and the interface will
 * not change when the optimiser arrives.
 */

export interface DispatchCandidate {
  id: string;
  vehicleType: string;
  verificationStatus: string;
  status: string;
  isOnline: boolean;
  region?: string;
  areasCovered?: string[];
  rating?: number;
  ratingCount?: number;
  acceptanceRate?: number;
  completedRides?: number;
  cancelledRides?: number;
  longitude?: number;
  latitude?: number;
  lastOnlineAt?: Date;
}

export interface DispatchRequest {
  vehicleType: string;
  region?: string;
  pickupLongitude?: number;
  pickupLatitude?: number;
}

/** Beyond this, a driver is not worth offering the trip to. */
export const MAX_PICKUP_RADIUS_KM = 15;

/** How long an "online" flag is trusted without a heartbeat. */
export const ONLINE_STALE_MINUTES = 15;

export const DISPATCH_REJECTIONS = [
  'notVerified',
  'notActive',
  'offline',
  'staleHeartbeat',
  'wrongVehicleType',
  'outOfRegion',
  'tooFar',
] as const;
export type DispatchRejection = (typeof DISPATCH_REJECTIONS)[number];

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance. Good enough for a city; not a routing engine. */
export function haversineKm(
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number,
): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h))) * 100) / 100;
}

export function distanceFor(
  driver: DispatchCandidate,
  ride: DispatchRequest,
): number | null {
  if (
    driver.longitude === undefined ||
    driver.latitude === undefined ||
    ride.pickupLongitude === undefined ||
    ride.pickupLatitude === undefined
  ) {
    return null;
  }
  return haversineKm(driver.longitude, driver.latitude, ride.pickupLongitude, ride.pickupLatitude);
}

/** Does the driver cover the ride's region, either as base or as a served area? */
export function coversRegion(driver: DispatchCandidate, region?: string): boolean {
  if (!region) return true;
  if (driver.region === region) return true;
  return (driver.areasCovered ?? []).includes(region);
}

/**
 * The hard filters. Returns every reason a driver is out, not just the first —
 * a dispatch screen that says "3 drivers rejected: 2 offline, 1 unverified" is
 * actionable; "no drivers found" is not.
 */
export function dispatchRejections(
  driver: DispatchCandidate,
  ride: DispatchRequest,
  asOf: Date,
): DispatchRejection[] {
  const out: DispatchRejection[] = [];
  if (driver.verificationStatus !== 'verified') out.push('notVerified');
  if (driver.status !== 'active') out.push('notActive');
  if (!driver.isOnline) out.push('offline');
  else if (
    driver.lastOnlineAt &&
    asOf.getTime() - driver.lastOnlineAt.getTime() > ONLINE_STALE_MINUTES * 60_000
  ) {
    out.push('staleHeartbeat');
  }
  if (driver.vehicleType !== ride.vehicleType) out.push('wrongVehicleType');
  if (!coversRegion(driver, ride.region)) out.push('outOfRegion');

  const km = distanceFor(driver, ride);
  if (km !== null && km > MAX_PICKUP_RADIUS_KM) out.push('tooFar');
  return out;
}

export function isDispatchable(
  driver: DispatchCandidate,
  ride: DispatchRequest,
  asOf: Date,
): boolean {
  return dispatchRejections(driver, ride, asOf).length === 0;
}

export interface MatchScore {
  driverId: string;
  score: number;
  distanceKm: number | null;
  components: {
    proximity: number;
    rating: number;
    acceptance: number;
    reliability: number;
  };
}

/** Component weights. They sum to 1, which is asserted in verify. */
export const MATCH_WEIGHTS = {
  proximity: 0.45,
  rating: 0.25,
  acceptance: 0.2,
  reliability: 0.1,
} as const;

/**
 * Rank one candidate, 0..1.
 *
 * A driver with no rating history scores neutral rather than zero — punishing a
 * new driver for having taken no trips yet is how a fleet fails to onboard.
 */
export function matchScore(
  driver: DispatchCandidate,
  ride: DispatchRequest,
): MatchScore {
  const km = distanceFor(driver, ride);
  // No coordinates is neutral, not perfect: an unknown position should not beat
  // a driver who is demonstrably two streets away.
  const proximity = km === null ? 0.5 : Math.max(0, 1 - km / MAX_PICKUP_RADIUS_KM);

  const rating = (driver.ratingCount ?? 0) > 0 ? Math.min(1, (driver.rating ?? 0) / 5) : 0.6;
  const acceptance = Math.min(1, Math.max(0, (driver.acceptanceRate ?? 100) / 100));

  const completed = driver.completedRides ?? 0;
  const cancelled = driver.cancelledRides ?? 0;
  const attempts = completed + cancelled;
  const reliability = attempts > 0 ? completed / attempts : 0.6;

  const score =
    MATCH_WEIGHTS.proximity * proximity +
    MATCH_WEIGHTS.rating * rating +
    MATCH_WEIGHTS.acceptance * acceptance +
    MATCH_WEIGHTS.reliability * reliability;

  return {
    driverId: driver.id,
    score: Math.round(score * 10000) / 10000,
    distanceKm: km,
    components: {
      proximity: Math.round(proximity * 10000) / 10000,
      rating: Math.round(rating * 10000) / 10000,
      acceptance: Math.round(acceptance * 10000) / 10000,
      reliability: Math.round(reliability * 10000) / 10000,
    },
  };
}

/**
 * Filter, score, sort. Ties break on driver id so the same input always
 * produces the same order — a dispatch list that reshuffles between two calls
 * is impossible to reason about, and impossible to test.
 */
export function rankDrivers(
  drivers: DispatchCandidate[],
  ride: DispatchRequest,
  asOf: Date,
  limit = 10,
): { matches: MatchScore[]; considered: number; rejected: Record<string, number> } {
  const rejected: Record<string, number> = {};
  const eligible: DispatchCandidate[] = [];

  for (const driver of drivers) {
    const reasons = dispatchRejections(driver, ride, asOf);
    if (reasons.length === 0) {
      eligible.push(driver);
      continue;
    }
    for (const reason of reasons) rejected[reason] = (rejected[reason] ?? 0) + 1;
  }

  const matches = eligible
    .map((d) => matchScore(d, ride))
    .sort((a, b) => (b.score - a.score) || a.driverId.localeCompare(b.driverId))
    .slice(0, Math.max(1, limit));

  return { matches, considered: drivers.length, rejected };
}
