import { Schema, model, type Types } from 'mongoose';
import {
  baseSchemaOptions,
  contactFields,
  emergencyContactFields,
  identityFields,
  lifecycleFields,
  locationFields,
  verificationFields,
  type ContactShape,
  type EmergencyContactShape,
  type IdentityShape,
  type LifecycleShape,
  type LocationShape,
  type TimestampShape,
  type VerificationShape,
} from '../../shared/schemaFragments.js';

export const BACK_OFFICE_DEPARTMENTS = [
  'humanResources',
  'coordinatorOps',
  'vendorOps',
  'driverVerification',
  'commercialOnboarding',
  'financeSupport',
  'complianceRecords',
  'memberSupport',
] as const;

/** Back Office Staff Profile — Zone C. The HR record for HQ's own people. */
export interface IBackOfficeStaffProfile
  extends ContactShape,
    IdentityShape,
    LocationShape,
    EmergencyContactShape,
    VerificationShape,
    LifecycleShape,
    TimestampShape {
  _id: Types.ObjectId;
  fullName: string;
  staffNumber: string;
  department: (typeof BACK_OFFICE_DEPARTMENTS)[number];
  jobTitle: string;
  employmentType: 'fullTime' | 'partTime' | 'contract' | 'intern';
  hireDate?: Date;
  exitDate?: Date;
  reportsTo?: Types.ObjectId;
  desksCovered: string[];
  regionsServed: string[];
}

const backOfficeStaffProfileSchema = new Schema<IBackOfficeStaffProfile>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...identityFields,
    ...locationFields,
    ...emergencyContactFields,
    ...verificationFields,

    staffNumber: { type: String, required: true, trim: true, uppercase: true },
    department: { type: String, enum: BACK_OFFICE_DEPARTMENTS, required: true, index: true },
    jobTitle: { type: String, required: true, trim: true },
    employmentType: {
      type: String,
      enum: ['fullTime', 'partTime', 'contract', 'intern'],
      default: 'fullTime',
    },
    hireDate: { type: Date },
    exitDate: { type: Date },
    reportsTo: { type: Schema.Types.ObjectId, ref: 'BackOfficeStaffProfile' },
    desksCovered: { type: [String], default: [] },
    regionsServed: { type: [String], default: [], index: true },

    ...lifecycleFields,
  },
  baseSchemaOptions('back_office_staff_profiles'),
);

backOfficeStaffProfileSchema.index({ email: 1 }, { unique: true });
backOfficeStaffProfileSchema.index({ staffNumber: 1 }, { unique: true });
backOfficeStaffProfileSchema.index({ department: 1, status: 1 });

export const BackOfficeStaffProfile = model<IBackOfficeStaffProfile>(
  'BackOfficeStaffProfile',
  backOfficeStaffProfileSchema,
);
