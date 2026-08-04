import { defineProfileModule } from '../../shared/moduleFactory.js';
import { FounderProfile, type IFounderProfile } from './founder.model.js';
import { createFounderSchema, updateFounderSchema } from './founder.validation.js';

export const founderModule = defineProfileModule<IFounderProfile>({
  collectionPath: 'founders',
  itemPath: 'founder',
  idParam: 'founderId',
  resource: 'founderProfile',
  adminZone: 'FOUNDER_COMMAND_CENTER',
  memberZone: 'FOUNDER_COMMAND_CENTER',
  model: FounderProfile,
  verifiable: false,
  createSchema: createFounderSchema,
  updateSchema: updateFounderSchema,
  serviceOptions: {
    label: 'Founder profile',
    searchableFields: ['fullName', 'email', 'founderTitle'],
    filterableFields: ['status', 'systemAccessScope'],
    ownerPath: 'user',
  },
});

export { FounderProfile };
export type { IFounderProfile };
export * from './founder.validation.js';
