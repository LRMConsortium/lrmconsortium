import bcrypt from 'bcryptjs';
import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import { env } from '../config/env.js';
import { ROLES, type Role } from '../config/roles.js';
import { HQ_ZONES } from '../config/hqZones.js';
import {
  EMAIL_REGEX,
  PHONE_REGEX,
  VERIFICATION_STATUSES,
  baseSchemaOptions,
} from '../shared/schemaFragments.js';

/**
 * The account. One User, one credential, one or more roles.
 *
 * Profiles are deliberately separate documents: a person can be a landlord in
 * Accra and a driver on Ususu without their landlord record growing vehicle
 * fields. `profiles` maps role → profile document.
 */
export interface IUser {
  _id: Types.ObjectId;
  fullName: string;
  email: string;
  phone: string;
  WhatsApp?: string;
  passwordHash: string;
  roles: Role[];
  primaryRole: Role;
  profiles: { role: Role; profileId: Types.ObjectId; profileModel: string }[];
  organizationId?: Types.ObjectId;
  regions: string[];
  homeZone?: string;
  isVerified: boolean;
  verificationStatus: (typeof VERIFICATION_STATUSES)[number];
  status: 'pending' | 'approved' | 'active' | 'suspended' | 'archived';
  locale: string;
  timezone: string;
  lastLoginAt?: Date;
  failedLoginAttempts: number;
  lockedUntil?: Date;
  passwordChangedAt?: Date;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserMethods {
  comparePassword(candidate: string): Promise<boolean>;
  isLocked(): boolean;
  profileIdFor(role: Role): Types.ObjectId | undefined;
}

export type UserDocument = HydratedDocument<IUser, IUserMethods>;
export type UserModel = Model<IUser, Record<string, never>, IUserMethods>;

const profileLinkSchema = new Schema(
  {
    role: { type: String, enum: ROLES, required: true },
    profileId: { type: Schema.Types.ObjectId, required: true },
    profileModel: { type: String, required: true },
  },
  { _id: false },
);

const userSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [EMAIL_REGEX, 'Invalid email address'],
    },
    phone: { type: String, required: true, trim: true, match: [PHONE_REGEX, 'Invalid phone number'] },
    WhatsApp: { type: String, trim: true, match: [PHONE_REGEX, 'Invalid WhatsApp number'] },
    passwordHash: { type: String, required: true, select: false },

    roles: {
      type: [String],
      enum: ROLES,
      required: true,
      validate: {
        validator: (v: string[]) => v.length > 0,
        message: 'A user must hold at least one role',
      },
      
    },
    primaryRole: { type: String, enum: ROLES, required: true, index: true },
    profiles: { type: [profileLinkSchema], default: [] },

    organizationId: { type: Schema.Types.ObjectId },
    regions: { type: [String], default: [] },
    homeZone: { type: String, enum: HQ_ZONES },

    isVerified: { type: Boolean, default: false,},
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'unsubmitted' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'active', 'suspended', 'archived'],
      default: 'pending',
      index: true,
    },

    locale: { type: String, default: 'en-GH' },
    timezone: { type: String, default: 'Africa/Accra' },

    lastLoginAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    passwordChangedAt: { type: Date },
    deletedAt: { type: Date, default: null, index: true },
  },
  baseSchemaOptions('users'),
);

userSchema.index({ roles: 1, status: 1 });
userSchema.index({ email: 1, deletedAt: 1 });

userSchema.pre('save', function hashPassword(next) {
  if (!this.isModified('passwordHash')) return next();
  if (this.passwordHash.startsWith('$2')) return next();
  bcrypt
    .hash(this.passwordHash, env.BCRYPT_ROUNDS)
    .then((hash) => {
      this.passwordHash = hash;
      this.passwordChangedAt = new Date();
      next();
    })
    .catch(next);
});

userSchema.pre('validate', function normalizeRoles(this: UserDocument, next) {
  if (this.roles?.length && !this.roles.includes(this.primaryRole)) {
    this.primaryRole = this.roles[0]!;
  }
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate: string) {
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.methods.isLocked = function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
};

userSchema.methods.profileIdFor = function profileIdFor(role: Role) {
  return this.profiles.find((p) => p.role === role)?.profileId;
};

export const User = model<IUser, UserModel>('User', userSchema);
