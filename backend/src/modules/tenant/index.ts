import { defineProfileModule } from '../../shared/moduleFactory.js';
import { TenantProfile, type ITenantProfile } from './tenant.model.js';
import { createTenantSchema, updateTenantSchema } from './tenant.validation.js';

export const tenantModule = defineProfileModule<ITenantProfile>({
  collectionPath: 'tenants',
  itemPath: 'tenant',
  idParam: 'tenantId',
  resource: 'tenantProfile',
  adminZone: 'BACK_OFFICE',
  model: TenantProfile,
  createSchema: createTenantSchema,
  updateSchema: updateTenantSchema,
  serviceOptions: {
    label: 'Tenant profile',
    searchableFields: ['fullName', 'email', 'phone', 'occupation'],
    filterableFields: ['status', 'verificationStatus', 'property', 'region', 'city'],
    ownerPath: 'user',
    populate: ['property'],
  },
});

export { TenantProfile };
export type { ITenantProfile };
export * from './tenant.validation.js';
