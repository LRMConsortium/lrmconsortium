import { createHash } from 'node:crypto';

/**
 * The rotation mathematics, with no database and no Express in sight.
 *
 * Everything here is a pure function over plain objects, which is the whole
 * point: ad selection is the one part of the platform where "it looked right in
 * staging" is not good enough. These are unit-testable without a Mongo instance
 * (see `src/scripts/verify.ts`), and `adEngine.service.ts` supplies the I/O.
 */

export interface RotationCandidate {
  id: string;
  advertiserId: string;
  adCategory: string;
  rotationWeight: number;
  priorityTier: number;
  startDate: Date;
  endDate: Date;
  impressions: number;
  clicks: number;
  impressionCap?: number;
  clickCap?: number;
  budgetAmount?: number;
  spend: number;
  dayParts: number[];
  daysOfWeek: number[];
  targetRegions: string[];
  targetRoles: string[];
}

export interface RotationPolicy {
  categoryWeightMultipliers: { category: string; multiplier: number }[];
  dayPartMultipliers: { hour: number; multiplier: number }[];
  zoneSlotCounts: { zone: string; slots: number }[];
  bannedCategories: string[];
  houseAdOnlyZones: string[];
  maxAdvertiserSharePercent: number;
  pacingEnabled: boolean;
  minRotationWeight: number;
  maxRotationWeight: number;
}

/**
 * Mulberry32 seeded from a SHA-256 digest.
 *
 * Selection must be reproducible for a given (session, zone, minute) so a
 * server-rendered page and its client hydration do not disagree about which ad
 * is on screen — and so tests can assert on distributions.
 */
export function seededRandom(seed: string): () => number {
  const h = createHash('sha256').update(seed).digest();
  let a = h.readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hour-of-day multiplier from policy; 1 when the hour is not listed. */
export function dayPartMultiplier(policy: RotationPolicy, hour: number): number {
  return policy.dayPartMultipliers?.find((d) => d.hour === hour)?.multiplier ?? 1;
}

export function categoryMultiplier(policy: RotationPolicy, category: string): number {
  return policy.categoryWeightMultipliers?.find((c) => c.category === category)?.multiplier ?? 1;
}

export function slotsForZone(policy: RotationPolicy, zone: string, requested: number | undefined, fallback: number): number {
  if (requested && requested > 0) return Math.min(requested, 10);
  return policy.zoneSlotCounts?.find((z) => z.zone === zone)?.slots ?? fallback;
}

/**
 * Pacing factor: how far behind schedule is this ad?
 *
 * An ad 50% through its flight that has delivered 20% of its impression cap is
 * behind and gets boosted; one that has delivered 80% is ahead and gets damped.
 * Clamped to [0.25, 2] so pacing nudges the draw without dominating it.
 */
export function pacingFactor(
  ad: Pick<RotationCandidate, 'startDate' | 'endDate' | 'impressions' | 'impressionCap'>,
  now: Date,
): number {
  if (!ad.impressionCap || ad.impressionCap <= 0) return 1;
  const total = ad.endDate.getTime() - ad.startDate.getTime();
  if (total <= 0) return 1;
  const elapsed = Math.min(Math.max(now.getTime() - ad.startDate.getTime(), 0), total);
  const timeProgress = elapsed / total;
  if (timeProgress <= 0) return 1;
  const deliveryProgress = Math.min(ad.impressions / ad.impressionCap, 1);
  const ratio = (timeProgress - deliveryProgress) / timeProgress; // >0 behind, <0 ahead
  return Math.min(2, Math.max(0.25, 1 + ratio));
}

/** Requested weight, adjusted by tier, category, daypart and pacing. */
export function effectiveWeight(
  ad: RotationCandidate,
  policy: RotationPolicy,
  now: Date,
): number {
  const base = Math.min(
    Math.max(ad.rotationWeight, policy.minRotationWeight ?? 0),
    policy.maxRotationWeight ?? 1000,
  );
  const tierBoost = 1 + (ad.priorityTier ?? 1) * 0.25;
  const weight =
    base *
    tierBoost *
    categoryMultiplier(policy, ad.adCategory) *
    dayPartMultiplier(policy, now.getHours()) *
    (policy.pacingEnabled ? pacingFactor(ad, now) : 1);
  return Math.max(0, Math.round(weight * 1000) / 1000);
}

/**
 * Is this ad allowed to serve at this moment?
 *
 * Flight window, zone and category are already enforced by the Mongo query;
 * this covers the rules that are cheaper to evaluate in memory.
 */
export function isEligible(
  ad: RotationCandidate,
  now: Date,
  context: { region?: string; role?: string },
): boolean {
  if (ad.dayParts.length > 0 && !ad.dayParts.includes(now.getHours())) return false;
  if (ad.daysOfWeek.length > 0 && !ad.daysOfWeek.includes(now.getDay())) return false;
  if (ad.impressionCap !== undefined && ad.impressions >= ad.impressionCap) return false;
  if (ad.clickCap !== undefined && ad.clicks >= ad.clickCap) return false;
  if (ad.budgetAmount !== undefined && ad.spend >= ad.budgetAmount) return false;
  if (context.region && ad.targetRegions.length > 0 && !ad.targetRegions.includes(context.region)) {
    return false;
  }
  if (context.role && ad.targetRoles.length > 0 && !ad.targetRoles.includes(context.role)) {
    return false;
  }
  return true;
}

/**
 * Weighted draw without replacement.
 *
 * If every remaining weight is zero the draw degrades to "take them in order"
 * rather than returning nothing — an empty slot earns no revenue, and a
 * zero-weighted ad is still a legitimate ad.
 */
export function weightedSample<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  count: number,
  rng: () => number,
): T[] {
  const pool = items.map((item) => ({ item, weight: Math.max(0, weightOf(item)) }));
  const chosen: T[] = [];

  while (chosen.length < count && pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    if (total <= 0) {
      chosen.push(...pool.slice(0, count - chosen.length).map((p) => p.item));
      break;
    }
    let target = rng() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      target -= pool[i]!.weight;
      if (target <= 0) {
        index = i;
        break;
      }
    }
    chosen.push(pool[index]!.item);
    pool.splice(index, 1);
  }

  return chosen;
}

/**
 * Founder policy: no single advertiser may take more than
 * `maxAdvertiserSharePercent` of a zone's slots. Displaced slots are refilled
 * from the same weighted pool rather than left empty.
 */
export function capAdvertiserShare<T extends { id: string; advertiserId: string }>(
  picked: readonly T[],
  maxSharePercent: number,
  pool: readonly T[],
  weightOf: (item: T) => number,
  rng: () => number,
): T[] {
  if (picked.length <= 1 || maxSharePercent >= 100) return [...picked];
  const maxPerAdvertiser = Math.max(1, Math.floor((picked.length * maxSharePercent) / 100));

  const counts = new Map<string, number>();
  const kept: T[] = [];
  let displaced = 0;

  for (const ad of picked) {
    const seen = counts.get(ad.advertiserId) ?? 0;
    if (seen < maxPerAdvertiser) {
      counts.set(ad.advertiserId, seen + 1);
      kept.push(ad);
    } else {
      displaced += 1;
    }
  }

  if (displaced === 0) return kept;

  const keptIds = new Set(kept.map((a) => a.id));
  const replacements = pool.filter(
    (ad) => !keptIds.has(ad.id) && (counts.get(ad.advertiserId) ?? 0) < maxPerAdvertiser,
  );

  return [...kept, ...weightedSample(replacements, weightOf, displaced, rng)];
}

/** Click-through rate as a percentage, rounded to two decimals. */
export function clickThroughRate(clicks: number, impressions: number): number {
  return impressions > 0 ? Math.round((clicks / impressions) * 10_000) / 100 : 0;
}
