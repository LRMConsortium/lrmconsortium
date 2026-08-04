import { Router } from 'express';
import { z } from 'zod';
import {
  authenticate,
  auditTrail,
  enterZone,
  optionalAuthenticate,
  requirePermission,
  validate,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { asyncHandler, created, ok, paginated, pageMeta } from '../../shared/http.js';
import { aliasIdParam, namedIdParam } from '../../shared/moduleFactory.js';
import { BaseService } from '../../shared/BaseService.js';
import { createCrudController } from '../../shared/BaseController.js';
import {
  CONTENT_TYPES,
  CONVERSION_GOALS,
  PublicContent,
  TrafficEvent,
  type IPublicContent,
} from './publicPortal.model.js';
import { zDate, zPhoto, zStringArray, zText } from '../../shared/validationFragments.js';

const DAY_MS = 86_400_000;

export const contentService = new BaseService<IPublicContent>(PublicContent, {
  label: 'Public content',
  searchableFields: ['title', 'slug', 'excerpt'],
  filterableFields: ['contentType', 'isPublished', 'locale', 'status'],
  defaultSort: '-publishedAt',
});

const contentController = createCrudController(contentService);

const createContentSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be kebab-case'),
    contentType: z.enum(CONTENT_TYPES),
    title: z.string().trim().min(3).max(240),
    excerpt: zText(600).optional(),
    body: z.string().max(200_000).optional(),
    heroImage: zPhoto.optional(),
    domains: zStringArray(10).optional(),
    locale: z.string().trim().max(10).optional(),
    tags: zStringArray(30).optional(),
    isPublished: z.boolean().optional(),
    publishedAt: zDate.optional(),
    seoTitle: zText(200).optional(),
    seoDescription: zText(400).optional(),
  })
  .strict();

const updateContentSchema = createContentSchema.partial().strict();

const trackTrafficSchema = z
  .object({
    domain: z.string().trim().max(120),
    path: z.string().trim().max(500),
    referrer: z.string().trim().max(500).optional(),
    sessionId: z.string().trim().max(120).optional(),
    country: z.string().trim().max(60).optional(),
    device: z.enum(['mobile', 'tablet', 'desktop', 'unknown']).optional(),
    isConversion: z.boolean().optional(),
    conversionGoal: z.enum(CONVERSION_GOALS).optional(),
  })
  .strict();

const router = Router();

// ── Public reads (Zone E, no auth) ──────────────────────────────────────────

router.get(
  '/content',
  optionalAuthenticate,
  enterZone('PUBLIC_PORTAL'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(50, Number(req.query.limit ?? 12));
    const filter: Record<string, unknown> = { isPublished: true, deletedAt: null };
    if (req.query.contentType) filter.contentType = req.query.contentType;
    if (req.query.domain) filter.domains = req.query.domain;
    if (req.query.locale) filter.locale = req.query.locale;

    const [items, total] = await Promise.all([
      PublicContent.find(filter, 'slug contentType title excerpt heroImage tags publishedAt locale')
        .sort('-publishedAt')
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      PublicContent.countDocuments(filter).exec(),
    ]);
    return paginated(res, items, pageMeta(page, limit, total));
  }),
);

router.get(
  '/content/:slug',
  optionalAuthenticate,
  enterZone('PUBLIC_PORTAL'),
  asyncHandler(async (req, res) => {
    const doc = await PublicContent.findOneAndUpdate(
      { slug: req.params.slug, isPublished: true, deletedAt: null },
      { $inc: { views: 1 } },
      { new: true },
    )
      .lean()
      .exec();
    if (!doc) throw ApiError.notFound('Content');
    return ok(res, doc);
  }),
);

router.post(
  '/track',
  optionalAuthenticate,
  enterZone('PUBLIC_PORTAL'),
  validate({ body: trackTrafficSchema }),
  asyncHandler(async (req, res) => {
    await TrafficEvent.create({ ...(req.body as Record<string, unknown>), occurredAt: new Date() });
    return ok(res, { recorded: true }, 202);
  }),
);

// ── Public metrics (Zone E dashboards; readable by HQ) ───────────────────────

router.get(
  '/metrics',
  authenticate,
  enterZone('PUBLIC_PORTAL'),
  requirePermission('publicMetrics:read'),
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30)));
    const since = new Date(Date.now() - days * DAY_MS);

    const [totals, byDomain, byPath, conversions, uniqueSessions, byDevice] = await Promise.all([
      TrafficEvent.countDocuments({ occurredAt: { $gte: since } }).exec(),
      TrafficEvent.aggregate<{ _id: string; views: number }>([
        { $match: { occurredAt: { $gte: since } } },
        { $group: { _id: '$domain', views: { $sum: 1 } } },
        { $sort: { views: -1 } },
      ]).exec(),
      TrafficEvent.aggregate<{ _id: string; views: number }>([
        { $match: { occurredAt: { $gte: since } } },
        { $group: { _id: '$path', views: { $sum: 1 } } },
        { $sort: { views: -1 } },
        { $limit: 25 },
      ]).exec(),
      TrafficEvent.aggregate<{ _id: string; count: number }>([
        { $match: { occurredAt: { $gte: since }, isConversion: true } },
        { $group: { _id: '$conversionGoal', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).exec(),
      TrafficEvent.distinct('sessionId', { occurredAt: { $gte: since } }).exec(),
      TrafficEvent.aggregate<{ _id: string; count: number }>([
        { $match: { occurredAt: { $gte: since } } },
        { $group: { _id: '$device', count: { $sum: 1 } } },
      ]).exec(),
    ]);

    const totalConversions = conversions.reduce((s, c) => s + c.count, 0);
    const sessions = uniqueSessions.filter(Boolean).length;

    return ok(res, {
      windowDays: days,
      pageViews: totals,
      sessions,
      conversions: totalConversions,
      conversionRatePercent:
        sessions > 0 ? Math.round((totalConversions / sessions) * 10_000) / 100 : 0,
      byDomain: byDomain.map((d) => ({ domain: d._id, views: d.views })),
      topPaths: byPath.map((p) => ({ path: p._id, views: p.views })),
      byGoal: conversions.map((c) => ({ goal: c._id, count: c.count })),
      byDevice: byDevice.map((d) => ({ device: d._id, count: d.count })),
    });
  }),
);

// ── Content management (Back Office / HQ) ───────────────────────────────────

const managed = [authenticate, enterZone('PUBLIC_PORTAL'), auditTrail('publicContent')] as const;

router.get(
  '/admin/content',
  ...managed,
  requirePermission('publicContent:read'),
  contentController.list,
);

router.post(
  '/admin/content',
  ...managed,
  requirePermission('publicContent:create'),
  validate({ body: createContentSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (body.isPublished && !body.publishedAt) body.publishedAt = new Date();
    const doc = await contentService.create(body as never, req.actor);
    return created(res, doc);
  }),
);

router.patch(
  '/admin/content/:contentId',
  ...managed,
  requirePermission('publicContent:update'),
  validate({ params: namedIdParam('contentId'), body: updateContentSchema }),
  aliasIdParam('contentId'),
  contentController.update,
);

router.post(
  '/admin/content/:contentId/publish',
  ...managed,
  requirePermission('publicContent:publish'),
  validate({ params: namedIdParam('contentId') }),
  asyncHandler(async (req, res) => {
    const doc = await contentService.update(
      req.params.contentId!,
      { isPublished: true, publishedAt: new Date() } as never,
      req.actor,
    );
    return ok(res, doc);
  }),
);

router.delete(
  '/admin/content/:contentId',
  ...managed,
  requirePermission('publicContent:delete'),
  validate({ params: namedIdParam('contentId') }),
  aliasIdParam('contentId'),
  contentController.remove,
);

export const publicPortalModule = { collectionPath: 'public', mounts: [{ path: 'public', router }] };
export {
  PublicContent,
  TrafficEvent,
  CONTENT_TYPES,
  CONVERSION_GOALS,
} from './publicPortal.model.js';
export type { IPublicContent, ITrafficEvent } from './publicPortal.model.js';
