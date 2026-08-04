import { Router } from 'express';
import {
  adServeRateLimit,
  auditTrail,
  authenticate,
  enterZone,
  optionalAuthenticate,
  requireFounder,
  requireOwnership,
  requirePermission,
  validate,
  requireClearance,
} from '../../middleware/index.js';
import { BaseService } from '../../shared/BaseService.js';
import { createCrudController } from '../../shared/BaseController.js';
import {
  aliasIdParam,
  defineProfileModule,
  listQuery,
  namedIdParam,
} from '../../shared/moduleFactory.js';
import { Ad, type IAd } from './ad.model.js';
import { AdvertiserProfile, type IAdvertiserProfile } from './advertiser.model.js';
import { createAdvertisingController } from './advertising.controller.js';
import {
  adPolicySchema,
  adReviewSchema,
  adStatusSchema,
  advertiserTermsSchema,
  createAdSchema,
  createAdvertiserSchema,
  previewRotationQuerySchema,
  reportQuerySchema,
  serveQuerySchema,
  trackSchema,
  updateAdSchema,
  updateAdvertiserSchema,
} from './advertising.validation.js';

// ── Advertiser accounts ──────────────────────────────────────────────────────

export const advertiserModule = defineProfileModule<IAdvertiserProfile>({
  collectionPath: 'advertisers',
  itemPath: 'advertiser',
  idParam: 'advertiserId',
  resource: 'advertiserProfile',
  adminZone: 'BACK_OFFICE',
  model: AdvertiserProfile,
  createSchema: createAdvertiserSchema,
  updateSchema: updateAdvertiserSchema,
  serviceOptions: {
    label: 'Advertiser profile',
    searchableFields: ['advertiserName', 'contactPerson', 'email'],
    filterableFields: ['status', 'verificationStatus', 'businessType', 'region'],
    ownerPath: 'user',
    organizationPath: '_id',
  },
});

// ── Ads ──────────────────────────────────────────────────────────────────────

export const adService = new BaseService<IAd>(Ad, {
  label: 'Ad',
  searchableFields: ['title', 'advertiserName', 'adCategory'],
  filterableFields: ['status', 'adCategory', 'advertiser', 'targetZones'],
  ownerPath: 'user',
  organizationPath: 'advertiser',
  defaultSort: '-createdAt',
});

const adController = createCrudController(adService);
const controller = createAdvertisingController(adService);

/** Plural for the collection, singular for the item. */
const adCollectionRouter = Router();
const adItemRouter = Router();

const adId = namedIdParam('adId');
const aliasAd = aliasIdParam('adId');

/**
 * Public ad serving. `optionalAuthenticate` means an anonymous visitor on the
 * .com site and a signed-in member on the Member Portal hit the same endpoint;
 * the engine simply sees a different role and zone.
 */
adCollectionRouter.get(
  '/serve',
  adServeRateLimit,
  optionalAuthenticate,
  validate({ query: serveQuerySchema }),
  controller.serve,
);

adCollectionRouter.post(
  '/track/impression',
  adServeRateLimit,
  optionalAuthenticate,
  validate({ body: trackSchema }),
  controller.trackImpression,
);

adCollectionRouter.post(
  '/track/click',
  adServeRateLimit,
  optionalAuthenticate,
  validate({ body: trackSchema }),
  controller.trackClick,
);

/** Reporting: advertisers see their own, HQ sees everything. */
adCollectionRouter.get(
  '/reports',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('adReport:read', 'adReport:readOwn'),
  validate({ query: reportQuerySchema }),
  controller.report,
);

// ── Founder ad policy — Zone A only ─────────────────────────────────────────

const policyRouter = Router();

policyRouter.get(
  '/',
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance(),
  requirePermission('adPolicy:read', 'policy:read'),
  controller.getPolicy,
);

policyRouter.get(
  '/history',
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance(),
  requireFounder,
  controller.policyHistory,
);

policyRouter.post(
  '/',
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance(),
  requireFounder,
  auditTrail('adPolicy'),
  validate({ body: adPolicySchema }),
  controller.publishPolicy,
);

policyRouter.get(
  '/preview-rotation',
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance(),
  requirePermission('adPolicy:read', 'policy:read'),
  validate({ query: previewRotationQuerySchema }),
  controller.previewRotation,
);

policyRouter.patch(
  '/advertiser/:advertiserId/terms',
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance(),
  requireFounder,
  auditTrail('advertiserProfile'),
  validate({ params: namedIdParam('advertiserId'), body: advertiserTermsSchema }),
  controller.setAdvertiserTerms,
);

// ── Ad management (advertiser + HQ) ──────────────────────────────────────────

const managed = [authenticate, enterZone('MEMBER_PORTAL'), auditTrail('ad')] as const;

adCollectionRouter.get(
  '/',
  ...managed,
  requirePermission('ad:read', 'ad:readOwn'),
  validate({ query: listQuery }),
  adController.list,
);

adCollectionRouter.post(
  '/',
  ...managed,
  requirePermission('ad:create'),
  validate({ body: createAdSchema }),
  adController.create,
);

adItemRouter.get(
  '/:adId',
  ...managed,
  requirePermission('ad:read', 'ad:readOwn'),
  validate({ params: adId }),
  aliasAd,
  requireOwnership(adService, 'adId'),
  adController.get,
);

adItemRouter.patch(
  '/:adId',
  ...managed,
  requirePermission('ad:update', 'ad:updateOwn'),
  validate({ params: adId, body: updateAdSchema }),
  aliasAd,
  requireOwnership(adService, 'adId'),
  adController.update,
);

adItemRouter.post(
  '/:adId/submit',
  ...managed,
  requirePermission('ad:updateOwn', 'ad:update'),
  validate({ params: adId }),
  aliasAd,
  requireOwnership(adService, 'adId'),
  controller.submitForReview,
);

adItemRouter.patch(
  '/:adId/status',
  ...managed,
  requirePermission('ad:updateOwn', 'ad:update'),
  validate({ params: adId, body: adStatusSchema }),
  aliasAd,
  requireOwnership(adService, 'adId'),
  controller.changeStatus,
);

/** Approval is an HQ act, not a Member Portal one. */
adItemRouter.patch(
  '/:adId/review',
  authenticate,
  enterZone('HQ_EXECUTIVE'),
  auditTrail('ad'),
  requirePermission('ad:approve'),
  validate({ params: adId, body: adReviewSchema }),
  aliasAd,
  controller.review,
);

adItemRouter.delete(
  '/:adId',
  ...managed,
  requirePermission('ad:delete', 'ad:updateOwn'),
  validate({ params: adId }),
  aliasAd,
  requireOwnership(adService, 'adId'),
  adController.remove,
);

export const adModule = {
  collectionPath: 'ads',
  itemPath: 'ad',
  idParam: 'adId',
  resource: 'ad' as const,
  service: adService,
  controller: adController,
  mounts: [
    { path: 'ads', router: adCollectionRouter },
    { path: 'ad', router: adItemRouter },
  ],
};

export const adPolicyModule = {
  collectionPath: 'ad-policy',
  resource: 'adPolicy' as const,
  mounts: [{ path: 'ad-policy', router: policyRouter }],
};

export { Ad, AD_CATEGORIES, AD_PLACEMENTS, AD_STATUSES } from './ad.model.js';
export { AdvertiserProfile, BUSINESS_TYPES } from './advertiser.model.js';
export { AdEvent } from './adEvent.model.js';
export { AdPolicy, DEFAULT_AD_POLICY } from './adPolicy.model.js';
export { adEngine } from './adEngine.service.js';
export type { IAd } from './ad.model.js';
export type { IAdvertiserProfile } from './advertiser.model.js';
export type { IAdEvent } from './adEvent.model.js';
export type { IAdPolicy } from './adPolicy.model.js';
export * from './advertising.validation.js';
