import { defineProfileModule } from '../../shared/moduleFactory.js';
import { BackOfficeStaffProfile, type IBackOfficeStaffProfile } from './backOfficeStaff.model.js';
import {
  createBackOfficeStaffSchema,
  updateBackOfficeStaffSchema,
} from './backOfficeStaff.validation.js';

export const backOfficeStaffModule = defineProfileModule<IBackOfficeStaffProfile>({
  collectionPath: 'staff-members',
  itemPath: 'staff-member',
  idParam: 'staffId',
  resource: 'backOfficeStaffProfile',
  adminZone: 'BACK_OFFICE',
  model: BackOfficeStaffProfile,
  createSchema: createBackOfficeStaffSchema,
  updateSchema: updateBackOfficeStaffSchema,
  serviceOptions: {
    label: 'Back office staff profile',
    searchableFields: ['fullName', 'email', 'staffNumber', 'jobTitle'],
    filterableFields: ['status', 'department', 'employmentType', 'verificationStatus'],
    ownerPath: 'user',
  },
});

export { BackOfficeStaffProfile, BACK_OFFICE_DEPARTMENTS } from './backOfficeStaff.model.js';
export type { IBackOfficeStaffProfile };
export * from './backOfficeStaff.validation.js';
