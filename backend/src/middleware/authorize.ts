import type { RequestHandler } from 'express';
import { HQ_ZONE_DEFINITIONS, type HQZone } from '../config/hqZones.js';
import { can, type Permission } from '../config/permissions.js';
import type { Role } from '../config/roles.js';
import { ApiError } from '../shared/ApiError.js';
import type { BaseService, PersistedDocument } from '../shared/BaseService.js';
import { logger } from '../config/logger.js';

/**
 * Three independent gates. A protected route usually stacks all three:
 *
 *   itemRouter.patch('/:vendorId',
 *     authenticate,
 *     enterZone('BACK_OFFICE'),
 *     requirePermission('vendorProfile:update'),
 *     requireOwnership(service, 'vendorId'),
 *     controller.update)
 */

/** Gate 1 — zone. Is this actor allowed on this surface at all? */
export function enterZone(zone: HQZone): RequestHandler {
  return (req, _res, next) => {
    if (!req.actor) return next(ApiError.unauthenticated());
    req.zone = zone;

    if (req.actor.restrictedZones.includes(zone)) {
      logger.warn('Zone denied', { userId: req.actor.userId, roles: req.actor.roles, zone });
      return next(ApiError.zoneRestricted(zone));
    }

    const entry = HQ_ZONE_DEFINITIONS[zone].entryPermissions;
    if (entry.length > 0) {
      const satisfied = entry.some((p) => can(req.actor!.grants, p as Permission));
      if (!satisfied) return next(ApiError.zoneRestricted(zone));
    }
    return next();
  };
}

/** Gate 2 — permission. Any one of the listed grants is enough. */
export function requirePermission(...required: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.actor) return next(ApiError.unauthenticated());
    const granted = required.some((p) => can(req.actor!.grants, p));
    if (!granted) {
      logger.warn('Permission denied', {
        userId: req.actor.userId,
        roles: req.actor.roles,
        required,
      });
      return next(
        ApiError.forbidden(`Missing required permission: ${required.join(' or ')}`),
      );
    }
    return next();
  };
}

/** Every listed grant must be held. */
export function requireAllPermissions(...required: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.actor) return next(ApiError.unauthenticated());
    const missing = required.filter((p) => !can(req.actor!.grants, p));
    if (missing.length > 0) {
      return next(ApiError.forbidden(`Missing required permissions: ${missing.join(', ')}`));
    }
    return next();
  };
}

/** Coarse role check. Prefer `requirePermission`; this is for role-shaped rules. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.actor) return next(ApiError.unauthenticated());
    if (req.actor.roles.some((r) => roles.includes(r))) return next();
    return next(ApiError.forbidden(`This action is restricted to: ${roles.join(', ')}`));
  };
}

/** Founder-only routes: policy, ad pricing, system-wide approval. */
export const requireFounder: RequestHandler = requireRole('founder');

/**
 * Gate 3 — ownership. For actors whose scope is `own`/`organizational`, the
 * record must actually belong to them. Wider scopes pass straight through.
 */
export function requireOwnership<T extends PersistedDocument>(
  service: BaseService<T>,
  paramName = 'id',
): RequestHandler {
  return (req, _res, next) => {
    const actor = req.actor;
    if (!actor) return next(ApiError.unauthenticated());
    if (actor.accessScope === 'global' || actor.accessScope === 'regional' || actor.accessScope === 'zonal') {
      return next();
    }
    const id = req.params[paramName];
    if (!id) return next(ApiError.badRequest(`Missing ${paramName}`));

    void service
      .isOwnedBy(id, actor)
      .then((owned) =>
        owned ? next() : next(ApiError.forbidden('This record does not belong to you')),
      )
      .catch(next);
  };
}

/** Named business operation check, mirroring `allowedActions` on each role. */
export function requireAction(action: string): RequestHandler {
  return (req, _res, next) => {
    if (!req.actor) return next(ApiError.unauthenticated());
    if (req.actor.allowedActions.includes(action)) return next();
    return next(ApiError.forbidden(`Action not permitted for your role: ${action}`));
  };
}

/** Regional confinement for coordinators and regional executives. */
export function requireRegion(paramName = 'region'): RequestHandler {
  return (req, _res, next) => {
    const actor = req.actor;
    if (!actor) return next(ApiError.unauthenticated());
    if (actor.accessScope === 'global') return next();
    const region = (req.params[paramName] ?? (req.query[paramName] as string | undefined)) ?? '';
    if (!region || actor.regions.length === 0 || actor.regions.includes(region)) return next();
    return next(ApiError.forbidden(`You are not posted to region: ${region}`));
  };
}
