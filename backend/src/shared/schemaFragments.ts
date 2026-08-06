import { Schema, type SchemaDefinition, type Types } from 'mongoose';

/**
 * Reusable field groups. Every profile in the platform shares the same contact
 * and identity shape, so validation, indexing and redaction stay consistent.
 */

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** E.164-ish; permissive enough for Ghana (+233), Nigeria (+234), diaspora. */
export const PHONE_REGEX = /^\+?[0-9]{7,15}$/;

export const VERIFICATION_STATUSES = [
  'unsubmitted',
  'pending',
  'inReview',
  'verified',
  'rejected',
  'suspended',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const ID_TYPES = [
  'ghanaCard',
  'passport',
  'driversLicense',
  'votersId',
  'nationalId',
  'ssnit',
  'other',
] as const;

export const CONTACT_METHODS = ['phone', 'whatsapp', 'email', 'sms', 'inApp'] as const;

export const PAYMENT_METHODS = [
  'mobileMoney',
  'bankTransfer',
  'cash',
  'card',
  'cheque',
  'crypto',
] as const;

// The list itself lives in `config/currencies.ts`, which is pure — the verify
// suite must be able to import it without pulling in Mongoose.
export { CURRENCIES, type Currency } from '../config/currencies.js';

export const DIASPORA_STATUSES = ['resident', 'diaspora', 'returnee', 'dualBased'] as const;

/** fullName / email / phone / WhatsApp — the block every profile carries. */
export const contactFields: SchemaDefinition = {
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: [EMAIL_REGEX, 'Invalid email address'],
    index: true,
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    match: [PHONE_REGEX, 'Invalid phone number'],
  },
  WhatsApp: { type: String, trim: true, match: [PHONE_REGEX, 'Invalid WhatsApp number'] },
  preferredContactMethod: { type: String, enum: CONTACT_METHODS, default: 'whatsapp' },
  profilePhoto: { type: String, trim: true, default: '' },
};

/** National ID block. `IDNumber` is `select: false` — never leaves by accident. */
export const identityFields: SchemaDefinition = {
  IDType: { type: String, enum: ID_TYPES },
  IDNumber: { type: String, trim: true, select: false },
  IDPhoto: { type: String, trim: true, select: false },
  nationalID: { type: String, trim: true, select: false },
  nationalIDPhoto: { type: String, trim: true, select: false },
};

export const locationFields: SchemaDefinition = {
  nationality: { type: String, trim: true },
  residenceCountry: { type: String, trim: true, default: 'Ghana' },
  address: { type: String, trim: true },
  city: { type: String, trim: true },
  region: { type: String, trim: true, index: true },
  geo: {
    type: {
      type: String,
      enum: ['Point'],
      default: undefined,
    },
    coordinates: { type: [Number], default: undefined },
  },
};

export const emergencyContactFields: SchemaDefinition = {
  emergencyContactName: { type: String, trim: true },
  emergencyContactPhone: { type: String, trim: true, match: [PHONE_REGEX, 'Invalid phone number'] },
  emergencyContactRelationship: { type: String, trim: true },
};

export const verificationFields: SchemaDefinition = {
  verificationStatus: {
    type: String,
    enum: VERIFICATION_STATUSES,
    default: 'unsubmitted',
    index: true,
  },
  verifiedAt: { type: Date },
  verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  verificationNotes: { type: String, trim: true, select: false },
  rejectionReason: { type: String, trim: true },
};

/** Lifecycle every profile shares: who owns it, is it live, is it archived. */
export const lifecycleFields: SchemaDefinition = {
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  status: {
    type: String,
    enum: ['draft', 'active', 'inactive', 'suspended', 'archived'],
    default: 'active',
    index: true,
  },
  hqZone: { type: String, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  deletedAt: { type: Date, default: null, index: true },
};

export const ratingFields: SchemaDefinition = {
  rating: { type: Number, min: 0, max: 5, default: 0 },
  ratingCount: { type: Number, min: 0, default: 0 },
};

/**
 * TypeScript counterparts to the field groups above.
 *
 * Profile interfaces `extends` these rather than re-declaring `city`, `region`,
 * `verificationStatus` and friends fourteen times. That is not just brevity:
 * when a fragment gains a field, every profile that mixes it in gains the field
 * in its type too, so schema and interface cannot drift apart.
 */

export interface ContactShape {
  email: string;
  phone: string;
  WhatsApp?: string;
  preferredContactMethod?: (typeof CONTACT_METHODS)[number];
  profilePhoto?: string;
}

export interface IdentityShape {
  IDType?: (typeof ID_TYPES)[number];
  IDNumber?: string;
  IDPhoto?: string;
  nationalID?: string;
  nationalIDPhoto?: string;
}

export interface LocationShape {
  nationality?: string;
  residenceCountry?: string;
  address?: string;
  city?: string;
  region?: string;
  geo?: { type?: 'Point'; coordinates?: number[] };
}

export interface EmergencyContactShape {
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
}

export interface VerificationShape {
  verificationStatus: VerificationStatus;
  verifiedAt?: Date;
  verifiedBy?: Types.ObjectId;
  verificationNotes?: string;
  rejectionReason?: string;
}

export type LifecycleStatus = 'draft' | 'active' | 'inactive' | 'suspended' | 'archived';

export interface LifecycleShape {
  user?: Types.ObjectId;
  status: LifecycleStatus;
  hqZone?: string;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date | null;
}

export interface RatingShape {
  rating: number;
  ratingCount: number;
}

export interface TimestampShape {
  createdAt: Date;
  updatedAt: Date;
}

/** Standard options: timestamps, lean JSON, virtual `id`, no `__v`. */
export function baseSchemaOptions(collection?: string) {
  return {
    timestamps: true,
    collection,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.IDNumber;
        delete ret.nationalID;
        delete ret.passwordHash;
        // The FAC digest. `select: false` already keeps it out of a plain read;
        // this stops a `.select('+codeHash')` used for verification from ever
        // reaching a serialised body by accident.
        delete ret.codeHash;
        delete ret.verificationNotes;
        return ret;
      },
    },
    toObject: { virtuals: true },
  } as const;
}
