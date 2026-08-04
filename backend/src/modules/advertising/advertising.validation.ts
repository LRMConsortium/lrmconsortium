import { z } from 'zod';
import { AD_ZONES } from '../../config/hqZones.js';
import {
  contactCreate,
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zCurrency,
  zDate,
  zMoney,
  zName,
  zObjectId,
  zPhoto,
  zStringArray,
  zText,
  zUrl,
} from '../../shared/validationFragments.js';
import { AD_CATEGORIES, AD_PLACEMENTS } from './ad.model.js';
import { BUSINESS_TYPES } from './advertiser.model.js';

// ── Advertiser ───────────────────────────────────────────────────────────────

export const createAdvertiserSchema = z
  .object({
    advertiserName: z.string().trim().min(2).max(200),
    contactPerson: zName.optional(),
    ...contactCreate,
    ...locationCreate,
    ...lifecycleCreate,
    businessType: z.enum(BUSINESS_TYPES),
    website: zUrl.optional(),
    logo: zPhoto.optional(),
    billingCurrency: zCurrency.optional(),
  })
  .strict();

export const updateAdvertiserSchema = toUpdateSchema(createAdvertiserSchema);

/** Founder-only: commercial terms and credit sit outside the advertiser's reach. */
export const advertiserTermsSchema = z
  .object({
    creditLimit: zMoney.optional(),
    agreedCPM: zMoney.optional(),
    agreedCPC: zMoney.optional(),
    strikes: z.number().int().min(0).max(10).optional(),
    notes: zText(2000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one term to set' });

// ── Ad creative ──────────────────────────────────────────────────────────────

const adFields = z
  .object({
    advertiser: zObjectId,
    title: z.string().trim().min(3).max(200),
    adImage: z.string().trim().min(1).max(2048),
    adImageAltText: zText(300).optional(),
    adLink: zUrl,
    adCategory: z.enum(AD_CATEGORIES),
    placements: z.array(z.enum(AD_PLACEMENTS)).min(1).max(AD_PLACEMENTS.length).optional(),
    targetZones: z.array(z.enum(AD_ZONES)).min(1).optional(),
    targetRegions: zStringArray(100).optional(),
    targetRoles: zStringArray(20).optional(),
    startDate: zDate,
    endDate: zDate,
    dayParts: z.array(z.number().int().min(0).max(23)).max(24).optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    rotationWeight: z.number().min(0).max(1000).optional(),
    priorityTier: z.number().int().min(0).max(10).optional(),
    impressionCap: z.number().int().min(1).optional(),
    clickCap: z.number().int().min(1).optional(),
    dailyImpressionCap: z.number().int().min(1).optional(),
    budgetAmount: zMoney.optional(),
    budgetCurrency: zCurrency.optional(),
  })
  .strict();

const flightIsSane = (v: { startDate?: Date; endDate?: Date }): boolean =>
  !v.startDate || !v.endDate || v.endDate > v.startDate;

export const createAdSchema = adFields.refine(flightIsSane, {
  message: 'endDate must be after startDate',
  path: ['endDate'],
});

export const updateAdSchema = toUpdateSchema(adFields).refine(flightIsSane, {
  message: 'endDate must be after startDate',
  path: ['endDate'],
});

export const adReviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: zText(1000).optional(),
  })
  .strict()
  .refine((v) => v.decision === 'approve' || Boolean(v.reason), {
    message: 'A rejection must include a reason',
    path: ['reason'],
  });

export const adStatusSchema = z
  .object({ action: z.enum(['activate', 'pause', 'archive']) })
  .strict();

// ── Serving & tracking ───────────────────────────────────────────────────────

export const serveQuerySchema = z
  .object({
    zone: z.enum(AD_ZONES),
    placement: z.enum(AD_PLACEMENTS).optional(),
    category: z.enum(AD_CATEGORIES).optional(),
    region: z.string().trim().max(120).optional(),
    slots: z.coerce.number().int().min(1).max(10).optional(),
    sessionId: z.string().trim().max(120).optional(),
    exclude: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
  })
  .strict();

/**
 * Founder dry-run. Spelled out rather than derived from `serveQuerySchema` with
 * `.partial().required(...)`: a preview takes no session and excludes nothing,
 * and deriving it made the endpoint's actual contract hard to read.
 */
export const previewRotationQuerySchema = z
  .object({
    zone: z.enum(AD_ZONES),
    category: z.enum(AD_CATEGORIES).optional(),
    slots: z.coerce.number().int().min(1).max(10).optional(),
  })
  .strict();

export const trackSchema = z
  .object({
    adId: zObjectId,
    zone: z.enum(AD_ZONES),
    placement: z.enum(AD_PLACEMENTS).optional(),
    sessionId: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(),
    beacon: z.string().trim().max(64).optional(),
  })
  .strict();

export const reportQuerySchema = z
  .object({
    from: zDate.optional(),
    to: zDate.optional(),
    zone: z.enum(AD_ZONES).optional(),
    advertiserId: zObjectId.optional(),
    adId: zObjectId.optional(),
  })
  .strict();

// ── Founder ad policy ────────────────────────────────────────────────────────

export const adPolicySchema = z
  .object({
    currency: zCurrency.optional(),
    pricing: z
      .array(
        z.object({
          placement: z.enum(AD_PLACEMENTS),
          cpm: zMoney.optional(),
          cpc: zMoney.optional(),
          flatMonthly: zMoney.optional(),
        }),
      )
      .max(AD_PLACEMENTS.length)
      .optional(),
    categoryWeightMultipliers: z
      .array(
        z.object({
          category: z.enum(AD_CATEGORIES),
          multiplier: z.number().min(0).max(10),
        }),
      )
      .max(AD_CATEGORIES.length)
      .optional(),
    dayPartMultipliers: z
      .array(z.object({ hour: z.number().int().min(0).max(23), multiplier: z.number().min(0).max(10) }))
      .max(24)
      .optional(),
    zoneSlotCounts: z
      .array(z.object({ zone: z.enum(AD_ZONES), slots: z.number().int().min(0).max(20) }))
      .max(AD_ZONES.length)
      .optional(),
    bannedCategories: z.array(z.enum(AD_CATEGORIES)).optional(),
    houseAdOnlyZones: z.array(z.enum(AD_ZONES)).optional(),
    maxAdvertiserSharePercent: z.number().min(1).max(100).optional(),
    pacingEnabled: z.boolean().optional(),
    requireReviewBeforeServing: z.boolean().optional(),
    minRotationWeight: z.number().min(0).optional(),
    maxRotationWeight: z.number().min(1).optional(),
    notes: zText(4000).optional(),
    effectiveFrom: zDate.optional(),
  })
  .strict();
