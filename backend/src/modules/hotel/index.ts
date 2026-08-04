import { defineProfileModule } from '../../shared/moduleFactory.js';
import { HotelProfile, type IHotelProfile } from './hotel.model.js';
import { createHotelSchema, updateHotelSchema } from './hotel.validation.js';

export const hotelModule = defineProfileModule<IHotelProfile>({
  collectionPath: 'hotels',
  itemPath: 'hotel',
  idParam: 'hotelId',
  resource: 'hotelProfile',
  adminZone: 'BACK_OFFICE',
  model: HotelProfile,
  createSchema: createHotelSchema,
  updateSchema: updateHotelSchema,
  serviceOptions: {
    label: 'Hotel profile',
    searchableFields: ['hotelName', 'managerName', 'email', 'city'],
    filterableFields: ['status', 'verificationStatus', 'serviceTier', 'region', 'city'],
    ownerPath: 'user',
    organizationPath: '_id',
    populate: ['assignedCoordinator'],
  },
});

export { HotelProfile, staffMemberSchema } from './hotel.model.js';
export type { IHotelProfile };
export * from './hotel.validation.js';
