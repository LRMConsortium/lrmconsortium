import { Router, type RequestHandler } from 'express';
import type { Model } from 'mongoose';
import { z, type ZodTypeAny } from 'zod';
import type { HQZone } from '../config/hqZones.js';
import type { Permission, Resource } from '../config/permissions.js';
import {
  authenticate,
  auditTrail,
  enterZone,
  requireClearance,
  requireOwnership,
  requirePermission,
  validate,
} from '../middleware/index.js';
import { BaseService, type BaseServiceOptions, type PersistedDocument } from './BaseService.js';
import { createCrudController, type CrudController } from './BaseController.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;

export const objectIdParam = z.object({
  id: z.string().regex(OBJECT_ID, 'Invalid id'),
});

/**
 * The LRMC convention uses a named id per resource — `:landlordId`, `:adId` —
 * rather than a bare `:id`. This builds the matching validator.
 */
export function namedIdParam(name: string) {
  return z.object({ [name]: z.string().regex(OBJECT_ID, 'Invalid id') });
}

/**
 * Controllers read `req.params.id`. Rather than thread a parameter name through
 * every handler, the item router aliases its named id onto `id` on the way in.
 * One line here instead of a special case in nine controller methods.
 */
export function aliasIdParam(name: string): RequestHandler {
  return (req, _res, next) => {
    const value = req.params[name];
    if (value !== undefined) req.params.id = value;
    next();
  };
}

export const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sort: z.string().optional(),
  search: z.string().max(120).optional(),
  includeDeleted: z.coerce.boolean().optional(),
  status: z.string().optional(),
  verificationStatus: z.string().optional(),
  region: z.string().optional(),
});

export const verificationBody = z.object({
  status: z.enum(['pending', 'inReview', 'verified', 'rejected', 'suspended']),
  note: z.string().max(2000).optional(),
});

export interface ProfileModuleConfig<T extends PersistedDocument> {
  /** Plural collection segment, e.g. `landlords`. */
  collectionPath: string;
  /** Singular item segment, e.g. `landlord`. */
  itemPath: string;
  /** Named id parameter, e.g. `landlordId`. */
  idParam: string;
  /** Permission resource, e.g. `landlordProfile`. */
  resource: Resource;
  /** HQ zone that owns administrative access to this collection. */
  adminZone: HQZone;
  /** HQ zone a member uses to reach their own record. */
  memberZone?: HQZone;
  model: Model<T>;
  serviceOptions: BaseServiceOptions<T>;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  /** Set false for collections nobody verifies (e.g. riders). */
  verifiable?: boolean;
  /**
   * Extra routes, mounted before the generic ones so literal segments are not
   * swallowed by the id route.
   */
  extend?: (ctx: {
    collectionRouter: Router;
    itemRouter: Router;
    service: BaseService<T>;
    controller: CrudController;
  }) => void;
}

export interface RouterMount {
  path: string;
  router: Router;
}

export interface ProfileModule<T extends PersistedDocument> {
  collectionPath: string;
  itemPath: string;
  idParam: string;
  resource: Resource;
  service: BaseService<T>;
  controller: CrudController;
  mounts: RouterMount[];
}

/**
 * Builds a fully-gated CRUD surface for one profile collection, in the LRMC
 * route convention: **plural for collections, singular for items.**
 *
 *   GET    /landlords                    list      (admin zone,  resource:read)
 *   POST   /landlords                    create    (admin zone,  resource:create)
 *   GET    /landlord/me                  own       (member zone, resource:readOwn)
 *   PATCH  /landlord/me                  own       (member zone, resource:updateOwn)
 *   GET    /landlord/:landlordId         read      (admin zone,  read + ownership)
 *   PATCH  /landlord/:landlordId         update    (admin zone,  update + ownership)
 *   PATCH  /landlord/:landlordId/verify  verify    (admin zone,  resource:verify)
 *   DELETE /landlord/:landlordId         archive   (admin zone,  resource:delete)
 *   POST   /landlord/:landlordId/restore restore   (admin zone,  resource:update)
 *
 * Two routers, two mount points. `/me` is registered before `/:xId` on the item
 * router — otherwise Express matches `me` as an id and the self-service route
 * becomes unreachable.
 */
export function defineProfileModule<T extends PersistedDocument>(
  config: ProfileModuleConfig<T>,
): ProfileModule<T> {
  const service = new BaseService<T>(config.model, config.serviceOptions);
  const controller = createCrudController(service);
  const collectionRouter = Router();
  const itemRouter = Router();

  const perm = (action: string): Permission => `${config.resource}:${action}` as Permission;
  // Zone A modules (founder, hqExecutive) pick up the presence gate here rather
  // than in each module file, so a new founder-tier profile module cannot be
  // added without it. The other zones are untouched: a back-office clerk can
  // never hold a clearance, so demanding one there would not add a factor, it
  // would delete the operation.
  const admin: RequestHandler[] = [
    authenticate,
    enterZone(config.adminZone),
    ...(config.adminZone === 'FOUNDER_COMMAND_CENTER' ? [requireClearance()] : []),
    auditTrail(config.resource),
  ];
  const memberZone = config.memberZone ?? 'MEMBER_PORTAL';
  const idSchema = namedIdParam(config.idParam);
  const alias = aliasIdParam(config.idParam);

  // ── Collection (plural) ────────────────────────────────────────────────────
  collectionRouter.get(
    '/',
    ...admin,
    requirePermission(perm('read')),
    validate({ query: listQuery }),
    controller.list,
  );

  collectionRouter.post(
    '/',
    ...admin,
    requirePermission(perm('create')),
    validate({ body: config.createSchema }),
    controller.create,
  );

  // ── Item (singular) — /me first, or `me` is parsed as an id ────────────────
  itemRouter.get(
    '/me',
    authenticate,
    enterZone(memberZone),
    requirePermission(perm('readOwn')),
    controller.me,
  );

  itemRouter.patch(
    '/me',
    authenticate,
    enterZone(memberZone),
    requirePermission(perm('updateOwn')),
    auditTrail(config.resource),
    validate({ body: config.updateSchema }),
    async (req, res, next) => {
      try {
        if (!req.actor) throw new Error('unreachable: authenticate guarantees actor');
        const own = await service.findOne({ user: req.actor.userId } as never);
        const id = String((own as { _id?: unknown } | null)?._id ?? '');
        if (!id) {
          res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: `${service.name} for current user not found` },
          });
          return;
        }
        req.params.id = id;
        return controller.update(req, res, next);
      } catch (err) {
        return next(err);
      }
    },
  );

  // Module-specific routes are registered here: after `/me`, so an extension
  // that adds a `/:id`-shaped route cannot swallow it, and before the generic
  // `/:id` surface, so an extension that adds a literal segment still wins.
  config.extend?.({ collectionRouter, itemRouter, service, controller });

  itemRouter.get(
    `/:${config.idParam}`,
    ...admin,
    requirePermission(perm('read'), perm('readOwn')),
    validate({ params: idSchema }),
    alias,
    requireOwnership(service, config.idParam),
    controller.get,
  );

  itemRouter.patch(
    `/:${config.idParam}`,
    ...admin,
    requirePermission(perm('update'), perm('updateOwn')),
    validate({ params: idSchema, body: config.updateSchema }),
    alias,
    requireOwnership(service, config.idParam),
    controller.update,
  );

  if (config.verifiable !== false) {
    itemRouter.patch(
      `/:${config.idParam}/verify`,
      ...admin,
      requirePermission(perm('verify')),
      validate({ params: idSchema, body: verificationBody }),
      alias,
      controller.verify,
    );
  }

  itemRouter.delete(
    `/:${config.idParam}`,
    ...admin,
    requirePermission(perm('delete')),
    validate({ params: idSchema }),
    alias,
    controller.remove,
  );

  itemRouter.post(
    `/:${config.idParam}/restore`,
    ...admin,
    requirePermission(perm('update')),
    validate({ params: idSchema }),
    alias,
    controller.restore,
  );

  return {
    collectionPath: config.collectionPath,
    itemPath: config.itemPath,
    idParam: config.idParam,
    resource: config.resource,
    service,
    controller,
    mounts: [
      { path: config.collectionPath, router: collectionRouter },
      { path: config.itemPath, router: itemRouter },
    ],
  };
}
