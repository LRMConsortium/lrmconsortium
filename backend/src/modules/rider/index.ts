import { defineProfileModule } from '../../shared/moduleFactory.js';
import { RiderProfile, type IRiderProfile } from './rider.model.js';
import { createRiderSchema, updateRiderSchema } from './rider.validation.js';

export const riderModule = defineProfileModule<IRiderProfile>({
  collectionPath: 'riders',
  itemPath: 'rider',
  idParam: 'riderId',
  resource: 'riderProfile',
  adminZone: 'BACK_OFFICE',
  model: RiderProfile,
  verifiable: false,
  createSchema: createRiderSchema,
  updateSchema: updateRiderSchema,
  serviceOptions: {
    label: 'Rider profile',
    searchableFields: ['fullName', 'email', 'phone'],
    filterableFields: ['status', 'preferredPaymentMethod'],
    ownerPath: 'user',
  },
});

export { RiderProfile };
export type { IRiderProfile };
export * from './rider.validation.js';
