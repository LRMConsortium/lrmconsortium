import { defineProfileModule } from '../../shared/moduleFactory.js';
import { HQExecutiveProfile, type IHQExecutiveProfile } from './hqExecutive.model.js';
import {
  createHQExecutiveSchema,
  updateHQExecutiveSchema,
} from './hqExecutive.validation.js';

export const hqExecutiveModule = defineProfileModule<IHQExecutiveProfile>({
  collectionPath: 'hq-executives',
  itemPath: 'hq-executive',
  idParam: 'executiveId',
  resource: 'hqExecutiveProfile',
  // Appointing an executive is a Founder act; the record itself lives in Zone B.
  adminZone: 'FOUNDER_COMMAND_CENTER',
  memberZone: 'HQ_EXECUTIVE',
  model: HQExecutiveProfile,
  verifiable: false,
  createSchema: createHQExecutiveSchema,
  updateSchema: updateHQExecutiveSchema,
  serviceOptions: {
    label: 'HQ executive profile',
    searchableFields: ['fullName', 'email', 'executiveTitle'],
    filterableFields: ['status', 'region'],
    ownerPath: 'user',
  },
});

export { HQExecutiveProfile };
export type { IHQExecutiveProfile };
export * from './hqExecutive.validation.js';
