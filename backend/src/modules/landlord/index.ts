import { defineProfileModule } from '../../shared/moduleFactory.js';
import { LandlordProfile, type ILandlordProfile } from './landlord.model.js';
import { createLandlordSchema, updateLandlordSchema } from './landlord.validation.js';

export const landlordModule = defineProfileModule<ILandlordProfile>({
  collectionPath: 'landlords',
  itemPath: 'landlord',
  idParam: 'landlordId',
  resource: 'landlordProfile',
  adminZone: 'BACK_OFFICE',
  model: LandlordProfile,
  createSchema: createLandlordSchema,
  updateSchema: updateLandlordSchema,
  serviceOptions: {
    label: 'Landlord profile',
    searchableFields: ['fullName', 'email', 'phone', 'city'],
    filterableFields: ['status', 'verificationStatus', 'diasporaStatus', 'region', 'city'],
    ownerPath: 'user',
    populate: ['propertiesOwned'],
  },
});

export { LandlordProfile };
export type { ILandlordProfile };
export * from './landlord.validation.js';
