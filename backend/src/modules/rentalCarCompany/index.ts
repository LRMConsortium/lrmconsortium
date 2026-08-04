import { defineProfileModule } from '../../shared/moduleFactory.js';
import {
  authenticate,
  auditTrail,
  enterZone,
  requirePermission,
  validate,
} from '../../middleware/index.js';
import { asyncHandler, created, ok } from '../../shared/http.js';
import { namedIdParam } from '../../shared/moduleFactory.js';
import {
  RentalCarCompanyProfile,
  type IRentalCarCompanyProfile,
} from './rentalCarCompany.model.js';
import {
  createRentalCarCompanySchema,
  fleetVehicleInput,
  updateRentalCarCompanySchema,
} from './rentalCarCompany.validation.js';

export const rentalCarCompanyModule = defineProfileModule<IRentalCarCompanyProfile>({
  collectionPath: 'rental-car-companies',
  itemPath: 'rental-car-company',
  idParam: 'companyId',
  resource: 'rentalCarCompanyProfile',
  adminZone: 'BACK_OFFICE',
  model: RentalCarCompanyProfile,
  createSchema: createRentalCarCompanySchema,
  updateSchema: updateRentalCarCompanySchema,
  serviceOptions: {
    label: 'Rental car company profile',
    searchableFields: ['companyName', 'managerName', 'email'],
    filterableFields: ['status', 'verificationStatus', 'serviceTier', 'suppliesUsusu', 'region'],
    ownerPath: 'user',
    organizationPath: '_id',
  },
  extend: ({ itemRouter }) => {
    /** Add a vehicle to the fleet without rewriting the whole array. */
    itemRouter.post(
      '/:companyId/fleet',
      authenticate,
      enterZone('MEMBER_PORTAL'),
      requirePermission('rentalCarCompanyProfile:updateOwn', 'rentalCarCompanyProfile:update'),
      auditTrail('rentalCarCompanyProfile'),
      validate({ params: namedIdParam('companyId'), body: fleetVehicleInput }),
      asyncHandler(async (req, res) => {
        const doc = await RentalCarCompanyProfile.findOneAndUpdate(
          { _id: req.params.companyId, deletedAt: null },
          { $push: { fleet: req.body }, $set: { updatedBy: req.actor?.userId } },
          { new: true, runValidators: true },
        ).exec();
        if (!doc) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Rental car company profile not found' } });
        return created(res, doc.toObject());
      }),
    );

    /** Fleet utilisation, read by HQ Executive dashboards and the company itself. */
    itemRouter.get(
      '/:companyId/utilization',
      authenticate,
      enterZone('MEMBER_PORTAL'),
      requirePermission('rentalCarCompanyProfile:readOwn', 'rentalCarCompanyProfile:read'),
      validate({ params: namedIdParam('companyId') }),
      asyncHandler(async (req, res) => {
        const doc = await RentalCarCompanyProfile.findById(req.params.companyId).exec();
        if (!doc) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Rental car company profile not found' } });
        const byStatus = doc.fleet.reduce<Record<string, number>>((acc, v) => {
          acc[v.availability] = (acc[v.availability] ?? 0) + 1;
          return acc;
        }, {});
        return ok(res, {
          companyName: doc.companyName,
          fleetSize: doc.get('fleetSize'),
          utilizationPercent: doc.get('utilizationPercent'),
          byStatus,
          suppliesUsusu: doc.suppliesUsusu,
        });
      }),
    );
  },
});

export { RentalCarCompanyProfile };
export type { IRentalCarCompanyProfile, IFleetVehicle } from './rentalCarCompany.model.js';
export * from './rentalCarCompany.validation.js';
