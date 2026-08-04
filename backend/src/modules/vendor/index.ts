import { defineProfileModule } from '../../shared/moduleFactory.js';
import { VendorProfile, type IVendorProfile } from './vendor.model.js';
import { createVendorSchema, updateVendorSchema } from './vendor.validation.js';

export const vendorModule = defineProfileModule<IVendorProfile>({
  collectionPath: 'vendors',
  itemPath: 'vendor',
  idParam: 'vendorId',
  resource: 'vendorProfile',
  adminZone: 'BACK_OFFICE',
  model: VendorProfile,
  createSchema: createVendorSchema,
  updateSchema: updateVendorSchema,
  serviceOptions: {
    label: 'Vendor profile',
    searchableFields: ['fullName', 'businessName', 'email', 'phone'],
    filterableFields: ['status', 'verificationStatus', 'serviceType', 'region', 'insured'],
    ownerPath: 'user',
    defaultSort: '-rating',
  },
});

export { VendorProfile, VENDOR_SERVICE_TYPES } from './vendor.model.js';
export type { IVendorProfile };
export * from './vendor.validation.js';
