import { Router } from 'express';
import {
  authenticate,
  auditTrail,
  enterZone,
  optionalAuthenticate,
  requireOwnership,
  requirePermission,
  validate,
} from '../../middleware/index.js';
import { BaseService } from '../../shared/BaseService.js';
import { createCrudController } from '../../shared/BaseController.js';
import { asyncHandler, paginated } from '../../shared/http.js';
import { listQuery, aliasIdParam, namedIdParam } from '../../shared/moduleFactory.js';
import { pageMeta } from '../../shared/http.js';
import { Property, type IProperty } from './property.model.js';
import {
  createPropertySchema,
  publicPropertyQuery,
  updatePropertySchema,
} from './property.validation.js';

export const propertyService = new BaseService<IProperty>(Property, {
  label: 'Property',
  searchableFields: ['title', 'reference', 'city', 'address'],
  filterableFields: [
    'status',
    'propertyType',
    'occupancyStatus',
    'region',
    'city',
    'owner',
    'ownerKind',
    'assignedCoordinator',
    'listedPublicly',
  ],
  ownerPath: 'owner',
  organizationPath: 'owner',
  populate: ['assignedCoordinator'],
});

const controller = createCrudController(propertyService);

/** Plural for the collection, singular for the item — the LRMC convention. */
const collectionRouter = Router();
const itemRouter = Router();

const propertyId = namedIdParam('propertyId');
const aliasProperty = aliasIdParam('propertyId');

/**
 * Public listing search — Zone E. No auth required, and the projection is
 * explicit rather than a `select: false` blacklist: a public endpoint should
 * name what it reveals.
 */
collectionRouter.get(
  '/public',
  optionalAuthenticate,
  enterZone('PUBLIC_PORTAL'),
  validate({ query: publicPropertyQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as {
      page?: number;
      limit?: number;
      propertyType?: string;
      city?: string;
      region?: string;
      minRent?: number;
      maxRent?: number;
      bedrooms?: number;
      search?: string;
      furnished?: boolean;
      amenities?: string[];
    };
    const page = q.page ?? 1;
    const limit = Math.min(50, q.limit ?? 12);

    const filter: Record<string, unknown> = {
      listedPublicly: true,
      deletedAt: null,
      status: 'active',
      occupancyStatus: { $in: ['vacant', 'offMarket'] },
    };
    if (q.propertyType) filter.propertyType = q.propertyType;
    if (q.city) filter.city = q.city;
    if (q.region) filter.region = q.region;
    if (q.bedrooms !== undefined) filter.bedrooms = { $gte: q.bedrooms };
    if (q.furnished !== undefined) filter.furnished = q.furnished;
    // `$all`, not `$in`: two ticked amenities are two requirements.
    if (q.amenities && q.amenities.length) filter.amenities = { $all: q.amenities };
    if (q.minRent !== undefined || q.maxRent !== undefined) {
      filter.rentAmount = {
        ...(q.minRent !== undefined ? { $gte: q.minRent } : {}),
        ...(q.maxRent !== undefined ? { $lte: q.maxRent } : {}),
      };
    }
    if (q.search) {
      const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { city: rx }, { address: rx }];
    }

    const projection =
      'reference title propertyType city region bedrooms bathrooms floorAreaSqm furnished amenities photos rentAmount rentCurrency rentPeriod';

    const [items, total] = await Promise.all([
      Property.find(filter, projection)
        .sort('-createdAt')
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      Property.countDocuments(filter).exec(),
    ]);

    return paginated(res, items, pageMeta(page, limit, total));
  }),
);

const member = [authenticate, enterZone('MEMBER_PORTAL'), auditTrail('property')] as const;

collectionRouter.get(
  '/',
  ...member,
  requirePermission('property:read', 'property:readOwn'),
  validate({ query: listQuery }),
  controller.list,
);

collectionRouter.post(
  '/',
  ...member,
  requirePermission('property:create'),
  validate({ body: createPropertySchema }),
  controller.create,
);

itemRouter.get(
  '/:propertyId',
  ...member,
  requirePermission('property:read', 'property:readOwn'),
  validate({ params: propertyId }),
  aliasProperty,
  requireOwnership(propertyService, 'propertyId'),
  controller.get,
);

itemRouter.patch(
  '/:propertyId',
  ...member,
  requirePermission('property:update', 'property:updateOwn'),
  validate({ params: propertyId, body: updatePropertySchema }),
  aliasProperty,
  requireOwnership(propertyService, 'propertyId'),
  controller.update,
);

itemRouter.delete(
  '/:propertyId',
  ...member,
  requirePermission('property:delete'),
  validate({ params: propertyId }),
  aliasProperty,
  requireOwnership(propertyService, 'propertyId'),
  controller.remove,
);

export const propertyModule = {
  collectionPath: 'properties',
  itemPath: 'property',
  idParam: 'propertyId',
  resource: 'property' as const,
  service: propertyService,
  controller,
  mounts: [
    { path: 'properties', router: collectionRouter },
    { path: 'property', router: itemRouter },
  ],
};

export { Property, PROPERTY_TYPES, OWNER_KINDS } from './property.model.js';
export type { IProperty };
export * from './property.validation.js';
