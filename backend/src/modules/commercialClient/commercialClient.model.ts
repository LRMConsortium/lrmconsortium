import { Schema, model, type Types } from 'mongoose';
import {
  CURRENCIES,
  baseSchemaOptions,
  contactFields,
  lifecycleFields,
  locationFields,
  verificationFields,
  type ContactShape,
  type LifecycleShape,
  type LocationShape,
  type TimestampShape,
  type VerificationShape,
} from '../../shared/schemaFragments.js';

export const CLIENT_KINDS = [
  'corporateLandlord',
  'fleetOwner',
  'institutionalAdvertiser',
  'hospitalityGroup',
  'propertyDeveloper',
  'governmentAgency',
  'ngo',
] as const;

export const CONTRACT_STATUSES = [
  'prospect',
  'negotiating',
  'active',
  'renewing',
  'suspended',
  'ended',
] as const;

/**
 * The account above the account.
 *
 * A hospitality group with nine hotels, or a fleet owner with three rental car
 * companies, is one commercial relationship — one contract, one invoice, one
 * account manager — spread across several existing profiles. This is the record
 * that ties them together, and `linkedProfiles` is deliberately polymorphic so a
 * single client can hold hotels, resorts and fleets at once.
 *
 * It does not replace those profiles. Operations still happen against the hotel
 * or the fleet; this is the commercial umbrella over them.
 */
export interface ICommercialClient
  extends ContactShape,
    LocationShape,
    VerificationShape,
    Omit<LifecycleShape, 'status'>,
    TimestampShape {
  _id: Types.ObjectId;
  clientName: string;
  clientKind: (typeof CLIENT_KINDS)[number];
  registrationNumber?: string;
  taxIdentificationNumber?: string;

  primaryContactName: string;
  accountManager?: Types.ObjectId;

  /** The operational profiles this client owns. */
  linkedProfiles: { kind: string; profile: Types.ObjectId; label?: string }[];
  linkedProperties: Types.ObjectId[];
  linkedAdvertisers: Types.ObjectId[];

  contractStart?: Date;
  contractEnd?: Date;
  contractStatus: (typeof CONTRACT_STATUSES)[number];
  contractValue?: number;
  currency: (typeof CURRENCIES)[number];
  billingFrequency: 'monthly' | 'quarterly' | 'annually';
  negotiatedFeePercent?: number;
  slaHours?: number;
  notes?: string;
  status: string;
}

const linkedProfileSchema = new Schema(
  {
    kind: {
      type: String,
      required: true,
      enum: [
        'LandlordProfile',
        'AirbnbHostProfile',
        'HotelProfile',
        'ResortProfile',
        'RentalCarCompanyProfile',
        'AdvertiserProfile',
      ],
    },
    profile: { type: Schema.Types.ObjectId, required: true, refPath: 'linkedProfiles.kind' },
    label: { type: String, trim: true },
  },
  { _id: false },
);

const commercialClientSchema = new Schema<ICommercialClient>(
  {
    clientName: { type: String, required: true, trim: true, maxlength: 200, index: true },
    clientKind: { type: String, enum: CLIENT_KINDS, required: true, index: true },
    registrationNumber: { type: String, trim: true },
    taxIdentificationNumber: { type: String, trim: true, select: false },

    primaryContactName: { type: String, required: true, trim: true, maxlength: 160 },
    accountManager: { type: Schema.Types.ObjectId, ref: 'BackOfficeStaffProfile', index: true },

    ...contactFields,
    ...locationFields,
    ...verificationFields,

    linkedProfiles: { type: [linkedProfileSchema], default: [] },
    linkedProperties: [{ type: Schema.Types.ObjectId, ref: 'Property' }],
    linkedAdvertisers: [{ type: Schema.Types.ObjectId, ref: 'AdvertiserProfile' }],

    contractStart: { type: Date },
    contractEnd: { type: Date, index: true },
    contractStatus: { type: String, enum: CONTRACT_STATUSES, default: 'prospect', index: true },
    contractValue: { type: Number, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'GHS' },
    billingFrequency: {
      type: String,
      enum: ['monthly', 'quarterly', 'annually'],
      default: 'monthly',
    },
    negotiatedFeePercent: { type: Number, min: 0, max: 100 },
    slaHours: { type: Number, min: 1, default: 48 },
    notes: { type: String, trim: true, maxlength: 4000 },

    ...lifecycleFields,
  },
  baseSchemaOptions('commercial_clients'),
);

commercialClientSchema.index({ email: 1 }, { unique: true });
commercialClientSchema.index({ clientKind: 1, contractStatus: 1 });

commercialClientSchema.virtual('portfolioSize').get(function portfolioSize() {
  return (this.linkedProfiles?.length ?? 0) + (this.linkedProperties?.length ?? 0);
});

export const CommercialClient = model<ICommercialClient>(
  'CommercialClient',
  commercialClientSchema,
);
