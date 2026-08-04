import type { Model, Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { ROLE_DEFINITIONS, isRole, type Role } from '../../config/roles.js';
import { ApiError } from '../../shared/ApiError.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../middleware/authenticate.js';
import { User, type UserDocument } from '../../models/User.js';
import { AirbnbHostProfile } from '../airbnbHost/airbnbHost.model.js';
import { AdvertiserProfile } from '../advertising/advertiser.model.js';
import { DriverProfile } from '../driver/driver.model.js';
import { HotelProfile } from '../hotel/hotel.model.js';
import { LandlordProfile } from '../landlord/landlord.model.js';
import { RentalCarCompanyProfile } from '../rentalCarCompany/rentalCarCompany.model.js';
import { ResortProfile } from '../resort/resort.model.js';
import { RiderProfile } from '../rider/rider.model.js';
import { TenantProfile } from '../tenant/tenant.model.js';
import { VendorProfile } from '../vendor/vendor.model.js';

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

export interface RegisterInput {
  fullName: string;
  email: string;
  phone: string;
  WhatsApp?: string;
  password: string;
  role: Role;
  businessName?: string;
  region?: string;
  vehicleType?: string;
  serviceType?: string;
  businessType?: string;
}

interface ProfileFactory {
  model: Model<Record<string, unknown>>;
  modelName: string;
  build: (input: RegisterInput, userId: Types.ObjectId) => Record<string, unknown>;
}

/**
 * Role → profile mapping for self-registration.
 *
 * Each entry knows the minimum a signup must supply. This is the single place
 * that decides "what does a new landlord's record look like on day one", which
 * keeps registration from drifting away from the profile schemas.
 */
const PROFILE_FACTORIES: Partial<Record<Role, ProfileFactory>> = {
  tenant: {
    model: TenantProfile as unknown as Model<Record<string, unknown>>,
    modelName: 'TenantProfile',
    build: (i, userId) => ({
      fullName: i.fullName,
      email: i.email,
      phone: i.phone,
      WhatsApp: i.WhatsApp,
      region: i.region,
      user: userId,
      status: 'draft',
      verificationStatus: 'pending',
    }),
  },
  landlord: {
    model: LandlordProfile as unknown as Model<Record<string, unknown>>,
    modelName: 'LandlordProfile',
    build: (i, userId) => ({
      fullName: i.fullName,
      email: i.email,
      phone: i.phone,
      WhatsApp: i.WhatsApp,
      region: i.region,
      user: userId,
      status: 'draft',
      verificationStatus: 'pending',
    }),
  },
  rider: {
    model: RiderProfile as unknown as Model<Record<string, unknown>>,
    modelName: 'RiderProfile',
    build: (i, userId) => ({
      fullName: i.fullName,
      email: i.email,
      phone: i.phone,
      WhatsApp: i.WhatsApp,
      user: userId,
      status: 'active',
    }),
  },
  driver: {
    model: DriverProfile as unknown as Model<Record<string, unknown>>,
    modelName: 'DriverProfile',
    build: (i, userId) => ({
      fullName: i.fullName,
      email: i.email,
      phone: i.phone,
      WhatsApp: i.WhatsApp,
      vehicleType: i.vehicleType ?? 'sedan',
      region: i.region,
      user: userId,
      status: 'draft',
      verificationStatus: 'pending',
    }),
  },
  vendor: {
    model: VendorProfile as unknown as Model<Record<string, unknown>>,
    modelName: 'VendorProfile',
    build: (i, userId) => ({
      fullName: i.fullName,
      businessName: i.businessName ?? i.fullName,
      serviceType: i.serviceType ?? 'generalMaintenance',
      email: i.email,
      phone: i.phone,
      WhatsApp: i.WhatsApp,
      region: i.region,
      user: userId,
      status: 'draft',
      verificationStatus: 'pending',
    }),
  },
  advertiser: {
    model: AdvertiserProfile as unknown as Model<Record<string, unknown>>,
    modelName: 'AdvertiserProfile',
    build: (i, userId) => ({
      advertiserName: i.businessName ?? i.fullName,
      contactPerson: i.fullName,
      email: i.email,
      phone: i.phone,
      WhatsApp: i.WhatsApp,
      businessType: i.businessType ?? 'other',
      user: userId,
      status: 'draft',
      verificationStatus: 'pending',
    }),
  },
  airbnbHost: {
    model: AirbnbHostProfile as unknown as Model<Record<string, unknown>>,
    modelName: 'AirbnbHostProfile',
    build: (i, userId) => ({
      businessName: i.businessName ?? i.fullName,
      contactPerson: i.fullName,
      email: i.email,
      phone: i.phone,
      WhatsApp: i.WhatsApp,
      region: i.region,
      user: userId,
      status: 'draft',
      verificationStatus: 'pending',
    }),
  },
  hotelManager: {
    model: HotelProfile as unknown as Model<Record<string, unknown>>,
    modelName: 'HotelProfile',
    build: (i, userId) => ({
      hotelName: i.businessName ?? i.fullName,
      managerName: i.fullName,
      email: i.email,
      phone: i.phone,
      WhatsApp: i.WhatsApp,
      region: i.region,
      user: userId,
      status: 'draft',
      verificationStatus: 'pending',
    }),
  },
  resortManager: {
    model: ResortProfile as unknown as Model<Record<string, unknown>>,
    modelName: 'ResortProfile',
    build: (i, userId) => ({
      resortName: i.businessName ?? i.fullName,
      managerName: i.fullName,
      email: i.email,
      phone: i.phone,
      WhatsApp: i.WhatsApp,
      region: i.region,
      user: userId,
      status: 'draft',
      verificationStatus: 'pending',
    }),
  },
  rentalCarCompany: {
    model: RentalCarCompanyProfile as unknown as Model<Record<string, unknown>>,
    modelName: 'RentalCarCompanyProfile',
    build: (i, userId) => ({
      companyName: i.businessName ?? i.fullName,
      managerName: i.fullName,
      email: i.email,
      phone: i.phone,
      WhatsApp: i.WhatsApp,
      region: i.region,
      user: userId,
      status: 'draft',
      verificationStatus: 'pending',
    }),
  },
};

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    roles: Role[];
    primaryRole: Role;
    isVerified: boolean;
    status: string;
    profileId?: string;
    accessScope: string;
    allowedZones: string[];
    allowedActions: string[];
  };
}

function tokensFor(user: UserDocument, profileId?: string): AuthResult {
  const definition = ROLE_DEFINITIONS[user.primaryRole];
  const accessToken = signAccessToken({
    sub: String(user._id),
    email: user.email,
    roles: user.roles,
    regions: user.regions,
    profileId,
    organizationId: user.organizationId ? String(user.organizationId) : undefined,
    isVerified: user.isVerified,
  });
  return {
    accessToken,
    refreshToken: signRefreshToken(String(user._id)),
    user: {
      id: String(user._id),
      fullName: user.fullName,
      email: user.email,
      roles: user.roles,
      primaryRole: user.primaryRole,
      isVerified: user.isVerified,
      status: user.status,
      profileId,
      accessScope: definition.accessScope,
      allowedZones: definition.allowedZones,
      allowedActions: definition.allowedActions,
    },
  };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  if (!isRole(input.role)) throw ApiError.badRequest(`Unknown role: ${input.role}`);

  const existing = await User.findOne({ email: input.email }).select('_id').lean().exec();
  if (existing) throw ApiError.duplicate('email');

  const definition = ROLE_DEFINITIONS[input.role];

  const user = await User.create({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    WhatsApp: input.WhatsApp,
    passwordHash: input.password,
    roles: [input.role],
    primaryRole: input.role,
    regions: input.region ? [input.region] : [],
    status: definition.requiresVerification ? 'pending' : 'active',
    isVerified: !definition.requiresVerification,
    verificationStatus: definition.requiresVerification ? 'pending' : 'unsubmitted',
  });

  let profileId: string | undefined;
  const factory = PROFILE_FACTORIES[input.role];
  if (factory) {
    try {
      const profile = await factory.model.create(factory.build(input, user._id));
      profileId = String((profile as unknown as { _id: Types.ObjectId })._id);
      user.profiles.push({
        role: input.role,
        profileId: profile._id as Types.ObjectId,
        profileModel: factory.modelName,
      });
      await user.save();
    } catch (err) {
      // Never leave an account without its profile: roll the User back.
      await User.deleteOne({ _id: user._id }).exec();
      logger.error('Registration rolled back: profile creation failed', {
        email: input.email,
        role: input.role,
        error: String(err),
      });
      throw err;
    }
  }

  logger.info('User registered', { userId: String(user._id), role: input.role });
  return tokensFor(user, profileId);
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const user = await User.findOne({ email, deletedAt: null }).select('+passwordHash').exec();
  if (!user) throw ApiError.unauthenticated('Invalid email or password');

  if (user.isLocked()) {
    throw ApiError.forbidden('Account temporarily locked after repeated failed attempts');
  }
  if (user.status === 'suspended' || user.status === 'archived') {
    throw ApiError.forbidden(`Account is ${user.status}`);
  }

  const matches = await user.comparePassword(password);
  if (!matches) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      user.failedLoginAttempts = 0;
      logger.warn('Account locked', { userId: String(user._id) });
    }
    await user.save();
    throw ApiError.unauthenticated('Invalid email or password');
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const profileId = user.profileIdFor(user.primaryRole);
  return tokensFor(user, profileId ? String(profileId) : undefined);
}

export async function refresh(refreshToken: string): Promise<AuthResult> {
  const { sub } = verifyRefreshToken(refreshToken);
  const user = await User.findOne({ _id: sub, deletedAt: null }).exec();
  if (!user) throw ApiError.unauthenticated('Account no longer exists');
  if (user.status === 'suspended' || user.status === 'archived') {
    throw ApiError.forbidden(`Account is ${user.status}`);
  }
  const profileId = user.profileIdFor(user.primaryRole);
  return tokensFor(user, profileId ? String(profileId) : undefined);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash').exec();
  if (!user) throw ApiError.notFound('User');
  const matches = await user.comparePassword(currentPassword);
  if (!matches) throw ApiError.unauthenticated('Current password is incorrect');
  user.passwordHash = newPassword;
  await user.save();
  logger.info('Password changed', { userId });
}

/** Founder-only: grant roles beyond what a person may claim for themselves. */
export async function assignRoles(
  userId: string,
  roles: string[],
  primaryRole?: string,
  regions?: string[],
): Promise<UserDocument> {
  const valid = roles.filter(isRole);
  if (valid.length !== roles.length) {
    throw ApiError.badRequest(`Unknown role in: ${roles.join(', ')}`);
  }
  const user = await User.findById(userId).exec();
  if (!user) throw ApiError.notFound('User');

  user.roles = valid;
  user.primaryRole = primaryRole && isRole(primaryRole) ? primaryRole : valid[0]!;
  if (regions) user.regions = regions;
  await user.save();
  logger.info('Roles assigned', { userId, roles: valid });
  return user;
}

export const authService = { register, login, refresh, changePassword, assignRoles };
export { PROFILE_FACTORIES };
