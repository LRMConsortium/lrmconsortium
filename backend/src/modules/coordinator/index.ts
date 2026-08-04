import { defineProfileModule } from '../../shared/moduleFactory.js';
import { authenticate, auditTrail, enterZone, requirePermission, validate } from '../../middleware/index.js';
import { asyncHandler, ok } from '../../shared/http.js';
import { namedIdParam } from '../../shared/moduleFactory.js';
import { CoordinatorProfile, type ICoordinatorProfile } from './coordinator.model.js';
import {
  assignPropertiesSchema,
  createCoordinatorSchema,
  updateCoordinatorSchema,
} from './coordinator.validation.js';

export const coordinatorModule = defineProfileModule<ICoordinatorProfile>({
  collectionPath: 'coordinators',
  itemPath: 'coordinator',
  idParam: 'coordinatorId',
  resource: 'coordinatorProfile',
  adminZone: 'BACK_OFFICE',
  model: CoordinatorProfile,
  createSchema: createCoordinatorSchema,
  updateSchema: updateCoordinatorSchema,
  serviceOptions: {
    label: 'Coordinator profile',
    searchableFields: ['fullName', 'email', 'phone'],
    filterableFields: ['status', 'verificationStatus', 'employmentType', 'region'],
    ownerPath: 'user',
    defaultSort: '-rating',
  },
  extend: ({ itemRouter, service }) => {
    /** Back Office posts a coordinator to a set of properties. */
    itemRouter.patch(
      '/:coordinatorId/assign-properties',
      authenticate,
      enterZone('BACK_OFFICE'),
      auditTrail('coordinatorProfile'),
      requirePermission('coordinatorProfile:assign', 'coordinatorProfile:update'),
      validate({ params: namedIdParam('coordinatorId'), body: assignPropertiesSchema }),
      asyncHandler(async (req, res) => {
        const { propertyIds } = req.body as { propertyIds: string[] };
        const updated = await service.update(
          req.params.coordinatorId!,
          { assignedProperties: propertyIds } as never,
          req.actor,
        );
        return ok(res, updated);
      }),
    );
  },
});

export { CoordinatorProfile };
export type { ICoordinatorProfile };
export * from './coordinator.validation.js';
