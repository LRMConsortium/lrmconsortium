import { defineProfileModule } from '../../shared/moduleFactory.js';
import { ResortProfile, type IResortProfile } from './resort.model.js';
import { createResortSchema, updateResortSchema } from './resort.validation.js';

export const resortModule = defineProfileModule<IResortProfile>({
  collectionPath: 'resorts',
  itemPath: 'resort',
  idParam: 'resortId',
  resource: 'resortProfile',
  adminZone: 'BACK_OFFICE',
  model: ResortProfile,
  createSchema: createResortSchema,
  updateSchema: updateResortSchema,
  serviceOptions: {
    label: 'Resort profile',
    searchableFields: ['resortName', 'managerName', 'email', 'city'],
    filterableFields: ['status', 'verificationStatus', 'serviceTier', 'region', 'city'],
    ownerPath: 'user',
    organizationPath: '_id',
    populate: ['assignedCoordinator'],
  },
});

export { ResortProfile, RESORT_AMENITIES } from './resort.model.js';
export type { IResortProfile };
export * from './resort.validation.js';
