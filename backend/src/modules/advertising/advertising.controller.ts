import type { Request, Response } from 'express';
import type { AdZone } from '../../config/hqZones.js';
import { ApiError } from '../../shared/ApiError.js';
import { asyncHandler, created, ok } from '../../shared/http.js';
import { Ad } from './ad.model.js';
import { AdPolicy } from './adPolicy.model.js';
import { AdvertiserProfile } from './advertiser.model.js';
import { adEngine } from './adEngine.service.js';
import type { BaseService } from '../../shared/BaseService.js';
import type { IAd } from './ad.model.js';

const DAY_MS = 86_400_000;

export function createAdvertisingController(adService: BaseService<IAd>) {
  return {
    // ── Public serving (Zone E / D / Ususu) ─────────────────────────────────
    serve: asyncHandler(async (req: Request, res: Response) => {
      const q = req.query as unknown as {
        zone: AdZone;
        placement?: string;
        category?: string;
        region?: string;
        slots?: number;
        sessionId?: string;
        exclude?: string[];
      };
      const ads = await adEngine.serveAds({
        zone: q.zone,
        placement: q.placement,
        category: q.category,
        region: q.region,
        slots: q.slots,
        sessionId: q.sessionId ?? req.requestId,
        exclude: q.exclude,
        role: req.actor?.primaryRole,
      });
      // Placements are personalised per session; never let a CDN cache them.
      res.setHeader('Cache-Control', 'private, no-store');
      return ok(res, { zone: q.zone, count: ads.length, ads });
    }),

    trackImpression: asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as {
        adId: string;
        zone: AdZone;
        placement?: string;
        sessionId?: string;
        region?: string;
      };
      const result = await adEngine.recordImpression({
        ...body,
        sessionId: body.sessionId ?? req.requestId,
        userId: req.actor?.userId,
        role: req.actor?.primaryRole,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return ok(res, result, 202);
    }),

    trackClick: asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as {
        adId: string;
        zone: AdZone;
        placement?: string;
        sessionId?: string;
        region?: string;
      };
      const result = await adEngine.recordClick({
        ...body,
        sessionId: body.sessionId ?? req.requestId,
        userId: req.actor?.userId,
        role: req.actor?.primaryRole,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return ok(res, result, 202);
    }),

    // ── Reporting ──────────────────────────────────────────────────────────
    report: asyncHandler(async (req: Request, res: Response) => {
      const q = req.query as unknown as {
        from?: Date;
        to?: Date;
        zone?: AdZone;
        advertiserId?: string;
        adId?: string;
      };
      const to = q.to ?? new Date();
      const from = q.from ?? new Date(to.getTime() - 30 * DAY_MS);
      if (from > to) throw ApiError.badRequest('`from` must be before `to`');

      // An advertiser may only ever see their own numbers.
      let advertiserId = q.advertiserId;
      if (req.actor?.accessScope === 'own' || req.actor?.accessScope === 'organizational') {
        const own = await AdvertiserProfile.findOne({ user: req.actor.userId }).select('_id').lean().exec();
        if (!own) throw ApiError.notFound('Advertiser profile for current user');
        advertiserId = String(own._id);
      }

      const report = await adEngine.buildReport({ from, to, zone: q.zone, advertiserId, adId: q.adId });
      return ok(res, report);
    }),

    // ── Ad lifecycle ───────────────────────────────────────────────────────
    review: asyncHandler(async (req: Request, res: Response) => {
      const actor = req.actor!;
      const { decision, reason } = req.body as { decision: 'approve' | 'reject'; reason?: string };
      const ad = await Ad.findOne({ _id: req.params.id, deletedAt: null }).exec();
      if (!ad) throw ApiError.notFound('Ad');
      if (!['pendingReview', 'draft', 'rejected'].includes(ad.status)) {
        throw ApiError.conflict(`Ad in status "${ad.status}" is not awaiting review`);
      }

      ad.status = decision === 'approve' ? 'approved' : 'rejected';
      ad.reviewedBy = actor.userId as never;
      ad.reviewedAt = new Date();
      if (decision === 'reject') ad.rejectionReason = reason;
      await ad.save();
      return ok(res, ad.toObject());
    }),

    changeStatus: asyncHandler(async (req: Request, res: Response) => {
      const actor = req.actor!;
      const { action } = req.body as { action: 'activate' | 'pause' | 'archive' };
      const id = req.params.id!;

      if (action === 'activate') {
        const ad = await adEngine.activateAd(id, actor.userId);
        return ok(res, ad);
      }

      const nextStatus = action === 'pause' ? 'paused' : 'archived';
      const updated = await adService.update(id, { status: nextStatus } as never, actor);
      return ok(res, updated);
    }),

    submitForReview: asyncHandler(async (req: Request, res: Response) => {
      const actor = req.actor!;
      const updated = await adService.update(
        req.params.id!,
        { status: 'pendingReview' } as never,
        actor,
      );
      return ok(res, updated);
    }),

    // ── Founder ad policy (Zone A) ─────────────────────────────────────────
    getPolicy: asyncHandler(async (_req: Request, res: Response) => {
      const policy = await adEngine.activePolicy(true);
      return ok(res, policy);
    }),

    policyHistory: asyncHandler(async (_req: Request, res: Response) => {
      const versions = await AdPolicy.find().sort('-version').limit(50).lean().exec();
      return ok(res, versions);
    }),

    /**
     * Publishing a policy creates a new version and deactivates the old one.
     * Policy is versioned, never edited: an ad served last Tuesday must still be
     * explicable by the policy in force last Tuesday.
     */
    publishPolicy: asyncHandler(async (req: Request, res: Response) => {
      const actor = req.actor!;
      const latest = await AdPolicy.findOne().sort('-version').select('version').lean().exec();
      const version = (latest?.version ?? 0) + 1;

      const policy = await AdPolicy.create({
        ...(req.body as Record<string, unknown>),
        version,
        isActive: true,
        effectiveFrom: (req.body as { effectiveFrom?: Date }).effectiveFrom ?? new Date(),
        authoredBy: actor.userId,
        ratifiedBy: actor.userId,
      });

      await AdPolicy.updateMany(
        { _id: { $ne: policy._id }, isActive: true },
        { $set: { isActive: false } },
      ).exec();

      adEngine.invalidatePolicyCache();
      return created(res, policy.toObject());
    }),

    setAdvertiserTerms: asyncHandler(async (req: Request, res: Response) => {
      const actor = req.actor!;
      const { creditLimit, agreedCPM, agreedCPC, strikes, notes } = req.body as {
        creditLimit?: number;
        agreedCPM?: number;
        agreedCPC?: number;
        strikes?: number;
        notes?: string;
      };
      const $set: Record<string, unknown> = { updatedBy: actor.userId };
      if (creditLimit !== undefined) $set.creditLimit = creditLimit;
      if (agreedCPM !== undefined) $set.agreedCPM = agreedCPM;
      if (agreedCPC !== undefined) $set.agreedCPC = agreedCPC;
      if (strikes !== undefined) {
        $set['policyStandings.strikes'] = strikes;
        $set['policyStandings.lastStrikeAt'] = new Date();
      }
      if (notes !== undefined) $set['policyStandings.notes'] = notes;

      const doc = await AdvertiserProfile.findOneAndUpdate(
        { _id: req.params.id, deletedAt: null },
        { $set },
        { new: true, runValidators: true },
      ).exec();
      if (!doc) throw ApiError.notFound('Advertiser profile');
      return ok(res, doc.toObject());
    }),

    /** Dry-run the rotation: what would serve right now, and why. */
    previewRotation: asyncHandler(async (req: Request, res: Response) => {
      const q = req.query as unknown as { zone: AdZone; slots?: number; category?: string };
      const [policy, ads] = await Promise.all([
        adEngine.activePolicy(),
        adEngine.serveAds({ zone: q.zone, slots: q.slots ?? 5, category: q.category, seed: 'preview' }),
      ]);
      return ok(res, {
        zone: q.zone,
        policy: {
          pacingEnabled: policy.pacingEnabled,
          maxAdvertiserSharePercent: policy.maxAdvertiserSharePercent,
          bannedCategories: policy.bannedCategories,
          houseAdOnlyZones: policy.houseAdOnlyZones,
        },
        wouldServe: ads.map((a) => ({
          id: a.id,
          title: a.title,
          advertiserName: a.advertiserName,
          category: a.adCategory,
          effectiveWeight: a.effectiveWeight,
        })),
      });
    }),
  };
}
