import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { AdZone } from '../../config/hqZones.js';
import { ApiError } from '../../shared/ApiError.js';
import { Ad, type IAd } from './ad.model.js';
import { AdEvent } from './adEvent.model.js';
import { AdPolicy, DEFAULT_AD_POLICY, type IAdPolicy } from './adPolicy.model.js';
import { AdvertiserProfile } from './advertiser.model.js';
import {
  capAdvertiserShare,
  clickThroughRate,
  effectiveWeight,
  isEligible,
  pacingFactor,
  seededRandom,
  slotsForZone,
  weightedSample,
  type RotationCandidate,
  type RotationPolicy,
} from './rotation.js';

export interface ServeRequest {
  zone: AdZone;
  placement?: string;
  category?: string;
  region?: string;
  role?: string;
  slots?: number;
  sessionId?: string;
  /** Ad ids already shown in this page render, to avoid duplicates. */
  exclude?: string[];
  /** Deterministic selection for tests and for stable server-side rendering. */
  seed?: string;
  now?: Date;
}

export interface ServedAd {
  id: string;
  advertiser: string;
  advertiserName: string;
  title: string;
  adImage: string;
  adImageAltText: string;
  adLink: string;
  adCategory: string;
  placement: string;
  zone: AdZone;
  /** Weight actually used in the draw, after policy and pacing. */
  effectiveWeight: number;
  /** Opaque token the client returns with the impression/click beacon. */
  beacon: string;
}

type PolicyLike = RotationPolicy & Pick<IAdPolicy, 'requireReviewBeforeServing'>;

/** Cached active policy. The engine reads it per serve; the DB should not. */
let policyCache: { policy: PolicyLike; loadedAt: number } | null = null;
const POLICY_TTL_MS = 60_000;

export async function activePolicy(force = false): Promise<PolicyLike> {
  if (!force && policyCache && Date.now() - policyCache.loadedAt < POLICY_TTL_MS) {
    return policyCache.policy;
  }
  const doc = await AdPolicy.findOne({ isActive: true }).sort('-effectiveFrom').lean().exec();
  const policy = (doc as PolicyLike | null) ?? (DEFAULT_AD_POLICY as PolicyLike);
  policyCache = { policy, loadedAt: Date.now() };
  return policy;
}

export function invalidatePolicyCache(): void {
  policyCache = null;
}

/** Project a persisted ad into the plain shape the rotation maths expects. */
function toCandidate(ad: IAd): RotationCandidate {
  return {
    id: String(ad._id),
    advertiserId: String(ad.advertiser),
    adCategory: ad.adCategory,
    rotationWeight: ad.rotationWeight,
    priorityTier: ad.priorityTier,
    startDate: new Date(ad.startDate),
    endDate: new Date(ad.endDate),
    impressions: ad.impressions,
    clicks: ad.clicks,
    impressionCap: ad.impressionCap,
    clickCap: ad.clickCap,
    budgetAmount: ad.budgetAmount,
    spend: ad.spend,
    dayParts: ad.dayParts ?? [],
    daysOfWeek: ad.daysOfWeek ?? [],
    targetRegions: ad.targetRegions ?? [],
    targetRoles: ad.targetRoles ?? [],
  };
}

/** Signed token tying a beacon back to (ad, zone, session). */
export function makeBeacon(adId: string, zone: string, sessionId = ''): string {
  const minute = Math.floor(Date.now() / 60_000);
  return createHash('sha256')
    .update(`${adId}:${zone}:${sessionId}:${minute}:${env.JWT_SECRET}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * The rotation engine.
 *
 * Eligibility is enforced in the query (status, flight window, zone, category,
 * caps); ordering is the weighted draw. Doing eligibility in Mongo and weighting
 * in Node keeps the index simple and the weighting logic testable.
 */
export async function serveAds(request: ServeRequest): Promise<ServedAd[]> {
  const now = request.now ?? new Date();
  const policy = await activePolicy();
  const zone = request.zone;

  if (policy.bannedCategories?.length && request.category) {
    if (policy.bannedCategories.includes(request.category)) return [];
  }

  const filter: Record<string, unknown> = {
    status: 'active',
    deletedAt: null,
    targetZones: zone,
    startDate: { $lte: now },
    endDate: { $gte: now },
  };

  if (request.category) filter.adCategory = request.category;
  if (request.placement) filter.placements = request.placement;
  if (request.exclude?.length) {
    filter._id = { $nin: request.exclude.filter(Types.ObjectId.isValid).map((id) => new Types.ObjectId(id)) };
  }
  if (policy.houseAdOnlyZones?.includes(zone)) filter.adCategory = 'houseAd';
  if (policy.bannedCategories?.length) {
    filter.adCategory = filter.adCategory ?? { $nin: policy.bannedCategories };
  }

  const docs = (await Ad.find(filter).limit(400).lean().exec()) as unknown as IAd[];

  // Index the persisted docs by id so the pure layer can stay ignorant of them.
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const candidates = docs.map(toCandidate);
  const eligible = candidates.filter((c) =>
    isEligible(c, now, { region: request.region, role: request.role }),
  );

  if (eligible.length === 0) return [];

  const slots = slotsForZone(policy, zone, request.slots, env.AD_DEFAULT_SLOT_COUNT);
  const seed =
    request.seed ?? `${request.sessionId ?? 'anon'}:${zone}:${Math.floor(now.getTime() / 60_000)}`;
  const rng = seededRandom(seed);

  const weights = new Map<string, number>();
  for (const c of eligible) weights.set(c.id, effectiveWeight(c, policy, now));
  const weightOf = (c: RotationCandidate): number => weights.get(c.id) ?? 0;

  const drawn = weightedSample(eligible, weightOf, slots, rng);

  // Founder policy: no single advertiser may dominate a zone's slots.
  const picked = capAdvertiserShare(
    drawn,
    policy.maxAdvertiserSharePercent ?? 100,
    eligible,
    weightOf,
    rng,
  );

  return picked.flatMap((c) => {
    const ad = byId.get(c.id);
    if (!ad) return [];
    return [
      {
        id: c.id,
        advertiser: String(ad.advertiser),
        advertiserName: ad.advertiserName,
        title: ad.title,
        adImage: ad.adImage,
        adImageAltText: ad.adImageAltText ?? ad.title,
        adLink: ad.adLink,
        adCategory: ad.adCategory,
        placement: request.placement ?? ad.placements[0] ?? 'sidebar',
        zone,
        effectiveWeight: weights.get(c.id) ?? 0,
        beacon: makeBeacon(c.id, zone, request.sessionId),
      },
    ];
  });
}

export interface TrackInput {
  adId: string;
  zone: AdZone;
  placement?: string;
  sessionId?: string;
  userId?: string;
  role?: string;
  region?: string;
  ip?: string;
  userAgent?: string;
  beacon?: string;
}

/**
 * Records an impression. Within the dedupe window a repeat from the same session
 * is silently accepted and discarded — the caller does not need to care, and the
 * advertiser is not charged twice.
 */
export async function recordImpression(input: TrackInput): Promise<{ counted: boolean }> {
  return recordEvent('impression', input);
}

export async function recordClick(input: TrackInput): Promise<{ counted: boolean }> {
  return recordEvent('click', input);
}

async function recordEvent(
  type: 'impression' | 'click',
  input: TrackInput,
): Promise<{ counted: boolean }> {
  if (!Types.ObjectId.isValid(input.adId)) throw ApiError.badRequest('Invalid ad id');

  const ad = await Ad.findById(input.adId).select('advertiser adCategory status').lean().exec();
  if (!ad) throw ApiError.notFound('Ad');

  const window = env.AD_IMPRESSION_DEDUPE_WINDOW_SECONDS;
  const bucket = window > 0 ? Math.floor(Date.now() / (window * 1000)) : null;
  const dedupeKey =
    bucket !== null && input.sessionId
      ? `${type}:${input.adId}:${input.zone}:${input.sessionId}:${bucket}`
      : undefined;

  try {
    await AdEvent.create({
      ad: ad._id,
      advertiser: ad.advertiser,
      type,
      zone: input.zone,
      placement: input.placement,
      category: ad.adCategory,
      sessionId: input.sessionId,
      user: input.userId && Types.ObjectId.isValid(input.userId) ? input.userId : undefined,
      role: input.role,
      region: input.region,
      dedupeKey,
      ip: input.ip,
      userAgent: input.userAgent,
      occurredAt: new Date(),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return { counted: false };
    throw err;
  }

  const inc = type === 'impression' ? { impressions: 1 } : { clicks: 1 };
  const updated = await Ad.findByIdAndUpdate(
    input.adId,
    { $inc: inc },
    { new: true, projection: 'impressions clicks impressionCap clickCap status' },
  ).exec();

  // Retire the ad the moment it hits a cap, rather than on the next serve.
  if (updated) {
    const capHit =
      (updated.impressionCap !== undefined && updated.impressions >= updated.impressionCap) ||
      (updated.clickCap !== undefined && updated.clicks >= updated.clickCap);
    if (capHit && updated.status === 'active') {
      await Ad.updateOne({ _id: updated._id }, { $set: { status: 'exhausted' } }).exec();
      logger.info('Ad exhausted its cap', { adId: String(updated._id) });
    }
  }

  return { counted: true };
}

export interface AdReportRow {
  adId: string;
  title: string;
  advertiserName: string;
  category: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface AdReport {
  from: Date;
  to: Date;
  zone?: AdZone;
  totals: { impressions: number; clicks: number; ctr: number; activeAds: number };
  byAd: AdReportRow[];
  byZone: { zone: string; impressions: number; clicks: number; ctr: number }[];
  byCategory: { category: string; impressions: number; clicks: number; ctr: number }[];
}

/** Impressions, clicks and CTR, rolled up from the raw event stream. */
export async function buildReport(params: {
  from: Date;
  to: Date;
  zone?: AdZone;
  advertiserId?: string;
  adId?: string;
}): Promise<AdReport> {
  const match: Record<string, unknown> = {
    occurredAt: { $gte: params.from, $lte: params.to },
  };
  if (params.zone) match.zone = params.zone;
  if (params.advertiserId) {
    if (!Types.ObjectId.isValid(params.advertiserId)) throw ApiError.badRequest('Invalid advertiser id');
    match.advertiser = new Types.ObjectId(params.advertiserId);
  }
  if (params.adId) {
    if (!Types.ObjectId.isValid(params.adId)) throw ApiError.badRequest('Invalid ad id');
    match.ad = new Types.ObjectId(params.adId);
  }

  const countByType = (type: string) => ({
    $sum: { $cond: [{ $eq: ['$type', type] }, 1, 0] },
  });

  const [byAdRaw, byZoneRaw, byCategoryRaw, activeAds] = await Promise.all([
    AdEvent.aggregate<{
      _id: Types.ObjectId;
      impressions: number;
      clicks: number;
      ad: { title: string; advertiserName: string; adCategory: string }[];
    }>([
      { $match: match },
      { $group: { _id: '$ad', impressions: countByType('impression'), clicks: countByType('click') } },
      { $sort: { impressions: -1 } },
      { $limit: 500 },
      {
        $lookup: {
          from: 'ads',
          localField: '_id',
          foreignField: '_id',
          as: 'ad',
          pipeline: [{ $project: { title: 1, advertiserName: 1, adCategory: 1 } }],
        },
      },
    ]).exec(),

    AdEvent.aggregate<{ _id: string; impressions: number; clicks: number }>([
      { $match: match },
      { $group: { _id: '$zone', impressions: countByType('impression'), clicks: countByType('click') } },
      { $sort: { impressions: -1 } },
    ]).exec(),

    AdEvent.aggregate<{ _id: string; impressions: number; clicks: number }>([
      { $match: match },
      { $group: { _id: '$category', impressions: countByType('impression'), clicks: countByType('click') } },
      { $sort: { impressions: -1 } },
    ]).exec(),

    Ad.countDocuments({
      status: 'active',
      deletedAt: null,
      ...(params.advertiserId ? { advertiser: params.advertiserId } : {}),
    }).exec(),
  ]);

  const byAd: AdReportRow[] = byAdRaw.map((row) => ({
    adId: String(row._id),
    title: row.ad?.[0]?.title ?? '(deleted ad)',
    advertiserName: row.ad?.[0]?.advertiserName ?? '',
    category: row.ad?.[0]?.adCategory ?? '',
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: clickThroughRate(row.clicks, row.impressions),
  }));

  const totalImpressions = byAd.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = byAd.reduce((s, r) => s + r.clicks, 0);

  return {
    from: params.from,
    to: params.to,
    zone: params.zone,
    totals: {
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr: clickThroughRate(totalClicks, totalImpressions),
      activeAds,
    },
    byAd,
    byZone: byZoneRaw.map((r) => ({
      zone: r._id,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: clickThroughRate(r.clicks, r.impressions),
    })),
    byCategory: byCategoryRaw.map((r) => ({
      category: r._id,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: clickThroughRate(r.clicks, r.impressions),
    })),
  };
}

/**
 * Transition an ad to `active`. Honours the Founder's review requirement and
 * refuses to launch an ad whose advertiser is not in good standing.
 */
export async function activateAd(adId: string, actorId: string): Promise<IAd> {
  const policy = await activePolicy();
  const ad = await Ad.findById(adId).exec();
  if (!ad) throw ApiError.notFound('Ad');

  if (policy.requireReviewBeforeServing && !['approved', 'paused'].includes(ad.status)) {
    throw ApiError.policy(
      `Ad must be approved before serving (current status: ${ad.status})`,
    );
  }

  const advertiser = await AdvertiserProfile.findById(ad.advertiser).exec();
  if (!advertiser) throw ApiError.notFound('Advertiser profile');
  if (!advertiser.get('inGoodStanding')) {
    throw ApiError.policy('Advertiser account is not in good standing');
  }
  if (ad.endDate.getTime() < Date.now()) {
    throw ApiError.policy('Flight window has already ended');
  }

  ad.status = 'active';
  ad.set('updatedBy', actorId);
  await ad.save();
  return ad.toObject() as unknown as IAd;
}

export const adEngine = {
  activePolicy,
  invalidatePolicyCache,
  serveAds,
  recordImpression,
  recordClick,
  buildReport,
  activateAd,
  effectiveWeight,
  pacingFactor,
  weightedSample,
  makeBeacon,
};
