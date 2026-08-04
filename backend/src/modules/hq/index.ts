import { Router } from 'express';
import {
  HQ_ZONES,
  HQ_ZONE_DEFINITIONS,
  isHQZone,
  zoneLineOfSight,
} from '../../config/hqZones.js';
import { ROLE_MATRIX } from '../../config/roles.js';
import {
  authenticate,
  enterZone,
  requireFounder,
  requirePermission,
  requireClearance,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { asyncHandler, ok } from '../../shared/http.js';
import { AuditLog } from '../../models/AuditLog.js';
import { analyticsService } from './analytics.service.js';

const router = Router();

/** The five-zone map. Every frontend builds its navigation from this. */
router.get(
  '/zones',
  authenticate,
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    return ok(res, {
      zones: HQ_ZONES.map((z) => {
        const d = HQ_ZONE_DEFINITIONS[z];
        return {
          code: d.code,
          key: d.key,
          label: d.label,
          purpose: d.purpose,
          capabilities: d.capabilities,
          surfaces: d.surfaces,
          oversees: d.oversees,
          dataFirewall: d.dataFirewall,
          accessible: !actor.restrictedZones.includes(z),
        };
      }),
      yourZones: actor.allowedZones,
      restrictedZones: actor.restrictedZones,
    });
  }),
);

router.get(
  '/zones/:zone',
  authenticate,
  asyncHandler(async (req, res) => {
    const zone = req.params.zone ?? '';
    if (!isHQZone(zone)) throw ApiError.notFound(`Zone ${zone}`);
    if (req.actor!.restrictedZones.includes(zone)) throw ApiError.zoneRestricted(zone);
    return ok(res, {
      ...HQ_ZONE_DEFINITIONS[zone],
      lineOfSight: zoneLineOfSight(zone),
    });
  }),
);

// ── Zone B: HQ Executive dashboards ─────────────────────────────────────────

router.get(
  '/dashboard',
  authenticate,
  enterZone('HQ_EXECUTIVE'),
  requirePermission('analytics:read'),
  asyncHandler(async (_req, res) => {
    const [kpis, health, regions] = await Promise.all([
      analyticsService.kpiSnapshot(),
      analyticsService.systemHealth(),
      analyticsService.regionalPerformance(),
    ]);
    return ok(res, { kpis, health, regions, roleMatrix: ROLE_MATRIX });
  }),
);

router.get(
  '/kpis',
  authenticate,
  enterZone('HQ_EXECUTIVE'),
  requirePermission('analytics:read'),
  asyncHandler(async (_req, res) => ok(res, await analyticsService.kpiSnapshot())),
);

router.get(
  '/system-health',
  authenticate,
  enterZone('HQ_EXECUTIVE'),
  requirePermission('analytics:read'),
  asyncHandler(async (_req, res) => ok(res, await analyticsService.systemHealth())),
);

router.get(
  '/regions',
  authenticate,
  enterZone('HQ_EXECUTIVE'),
  requirePermission('analytics:read'),
  asyncHandler(async (_req, res) => ok(res, await analyticsService.regionalPerformance())),
);

// ── Zone A: Founder Command Center ──────────────────────────────────────────

router.get(
  '/command-center',
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance(),
  requireFounder,
  asyncHandler(async (_req, res) => {
    const [kpis, health, regions, recentAudit] = await Promise.all([
      analyticsService.kpiSnapshot(),
      analyticsService.systemHealth(),
      analyticsService.regionalPerformance(),
      AuditLog.find().sort('-createdAt').limit(50).lean().exec(),
    ]);
    return ok(res, {
      zones: HQ_ZONES.map((z) => HQ_ZONE_DEFINITIONS[z]),
      kpis,
      health,
      regions,
      recentAudit,
      roleMatrix: ROLE_MATRIX,
    });
  }),
);

/** The audit trail is Zone A's alone. */
router.get(
  '/audit-log',
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance(),
  requirePermission('auditLog:read'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit ?? 100));
    const filter: Record<string, unknown> = {};
    if (req.query.resource) filter.resource = req.query.resource;
    if (req.query.actor) filter.actor = req.query.actor;
    const entries = await AuditLog.find(filter).sort('-createdAt').limit(limit).lean().exec();
    return ok(res, entries);
  }),
);

export const hqModule = { collectionPath: 'hq', mounts: [{ path: 'hq', router }] };
export { analyticsService } from './analytics.service.js';
export type { KPISnapshot, SystemHealth } from './analytics.service.js';
