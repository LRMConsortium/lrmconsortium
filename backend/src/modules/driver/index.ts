import { defineProfileModule } from '../../shared/moduleFactory.js';
import {
  authenticate,
  auditTrail,
  enterZone,
  requireAction,
  requirePermission,
  validate,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { asyncHandler, ok } from '../../shared/http.js';
import { DriverProfile, type IDriverProfile } from './driver.model.js';
import {
  createDriverSchema,
  onlineStatusSchema,
  updateDriverSchema,
} from './driver.validation.js';

export const driverModule = defineProfileModule<IDriverProfile>({
  collectionPath: 'drivers',
  itemPath: 'driver',
  idParam: 'driverId',
  resource: 'driverProfile',
  adminZone: 'BACK_OFFICE',
  model: DriverProfile,
  createSchema: createDriverSchema,
  updateSchema: updateDriverSchema,
  serviceOptions: {
    label: 'Driver profile',
    searchableFields: ['fullName', 'email', 'phone', 'vehiclePlate'],
    filterableFields: [
      'status',
      'verificationStatus',
      'vehicleType',
      'isOnline',
      'region',
      'ownedBy',
    ],
    ownerPath: 'user',
    defaultSort: '-rating',
  },
  extend: ({ collectionRouter, itemRouter, service }) => {
    /** Driver toggles availability from the Ususu app. */
    itemRouter.patch(
      '/me/online',
      authenticate,
      enterZone('MEMBER_PORTAL'),
      requirePermission('driverProfile:updateOwn'),
      requireAction('goOnline'),
      auditTrail('driverProfile'),
      validate({ body: onlineStatusSchema }),
      asyncHandler(async (req, res) => {
        const actor = req.actor!;
        const own = await service.findOne({ user: actor.userId } as never);
        if (!own) throw ApiError.notFound('Driver profile for current user');

        const { isOnline, longitude, latitude } = req.body as {
          isOnline: boolean;
          longitude?: number;
          latitude?: number;
        };

        if (isOnline && !(own as unknown as IDriverProfile).verificationStatus.startsWith('verified')) {
          throw ApiError.forbidden('Only verified drivers may go online');
        }

        const patch: Record<string, unknown> = { isOnline };
        if (isOnline) patch.lastOnlineAt = new Date();
        if (longitude !== undefined && latitude !== undefined) {
          patch.currentLocation = { type: 'Point', coordinates: [longitude, latitude] };
        }

        const id = String((own as unknown as IDriverProfile)._id);
        const updated = await service.update(id, patch as never, actor);
        return ok(res, updated);
      }),
    );

    /** Back Office verification queue: expiring documents surface first. */
    collectionRouter.get(
      '/verification-queue',
      authenticate,
      enterZone('BACK_OFFICE'),
      requirePermission('driverProfile:verify'),
      asyncHandler(async (req, res) => {
        const in30Days = new Date(Date.now() + 30 * 86_400_000);
        const { items, meta } = await service.list(
          {
            limit: 100,
            sort: 'driverLicenseExpiry',
            filters: {},
          },
          req.actor,
        );
        const queue = items.filter((d) => {
          const doc = d as unknown as IDriverProfile;
          const pending = ['pending', 'inReview', 'unsubmitted'].includes(doc.verificationStatus);
          const expiringLicence =
            doc.driverLicenseExpiry !== undefined &&
            doc.driverLicenseExpiry !== null &&
            new Date(doc.driverLicenseExpiry) < in30Days;
          const expiringInsurance =
            doc.insuranceExpiry !== undefined &&
            doc.insuranceExpiry !== null &&
            new Date(doc.insuranceExpiry) < in30Days;
          return pending || expiringLicence || expiringInsurance;
        });
        return ok(res, { items: queue, meta: { ...meta, total: queue.length } });
      }),
    );
  },
});

export { DriverProfile, VEHICLE_TYPES } from './driver.model.js';
export type { IDriverProfile };
export * from './driver.validation.js';
