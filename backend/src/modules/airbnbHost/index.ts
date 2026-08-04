import { defineProfileModule } from '../../shared/moduleFactory.js';
import { AirbnbHostProfile, type IAirbnbHostProfile } from './airbnbHost.model.js';
import {
  createAirbnbHostSchema,
  updateAirbnbHostSchema,
} from './airbnbHost.validation.js';

export const airbnbHostModule = defineProfileModule<IAirbnbHostProfile>({
  collectionPath: 'airbnb-hosts',
  itemPath: 'airbnb-host',
  idParam: 'hostId',
  resource: 'airbnbHostProfile',
  adminZone: 'BACK_OFFICE',
  model: AirbnbHostProfile,
  createSchema: createAirbnbHostSchema,
  updateSchema: updateAirbnbHostSchema,
  serviceOptions: {
    label: 'Airbnb host profile',
    searchableFields: ['businessName', 'contactPerson', 'email', 'phone'],
    filterableFields: ['status', 'verificationStatus', 'serviceTier', 'region', 'city'],
    ownerPath: 'user',
    organizationPath: '_id',
    populate: ['assignedCoordinator'],
  },
});

export { AirbnbHostProfile };
export type { IAirbnbHostProfile };
export * from './airbnbHost.validation.js';
