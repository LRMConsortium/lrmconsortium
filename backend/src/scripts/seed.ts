/**
 * Seeds a working institution: a founder, an executive, a back-office desk, a
 * coordinator, a vendor, a landlord with a property, a tenant, a driver, a
 * rider, one of each commercial client, an advertiser with a live ad, a ratified
 * ad policy and some public content.
 *
 * Idempotent by email/slug, so it is safe to run against an existing database.
 *
 *   npm run seed
 */

import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { logger } from '../config/logger.js';
import { DEFAULT_AD_POLICY } from '../modules/advertising/adPolicy.model.js';
import {
  Ad,
  AdPolicy,
  AdvertiserProfile,
  AirbnbHostProfile,
  BackOfficeStaffProfile,
  CoordinatorProfile,
  DriverProfile,
  FounderProfile,
  HQExecutiveProfile,
  HotelProfile,
  LandlordProfile,
  Property,
  PublicContent,
  RentalCarCompanyProfile,
  ResortProfile,
  RiderProfile,
  TenantProfile,
  User,
  VendorProfile,
} from '../models/index.js';
import type { Role } from '../config/roles.js';

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
const REGION = 'Greater Accra';

interface AccountSpec {
  fullName: string;
  email: string;
  phone: string;
  role: Role;
}

/** Upsert a User without re-hashing an existing password. */
async function account(spec: AccountSpec): Promise<{ id: string; created: boolean }> {
  const existing = await User.findOne({ email: spec.email }).select('_id').lean().exec();
  if (existing) return { id: String(existing._id), created: false };

  const user = await User.create({
    fullName: spec.fullName,
    email: spec.email,
    phone: spec.phone,
    WhatsApp: spec.phone,
    passwordHash: DEFAULT_PASSWORD,
    roles: [spec.role],
    primaryRole: spec.role,
    regions: [REGION],
    status: 'active',
    isVerified: true,
    verificationStatus: 'verified',
  });
  return { id: String(user._id), created: true };
}

/** Upsert a profile by email (or another natural key) and link it to its User. */
async function profile<T extends { _id: unknown }>(
  model: { findOne: (f: Record<string, unknown>) => { lean: () => { exec: () => Promise<unknown> } }; create: (d: Record<string, unknown>) => Promise<T> },
  key: Record<string, unknown>,
  doc: Record<string, unknown>,
): Promise<string> {
  const found = (await model.findOne(key).lean().exec()) as { _id?: unknown } | null;
  if (found?._id) return String(found._id);
  const created = await model.create({ ...key, ...doc });
  return String(created._id);
}

async function linkProfile(
  userId: string,
  role: Role,
  profileId: string,
  profileModel: string,
): Promise<void> {
  await User.updateOne(
    { _id: userId, 'profiles.role': { $ne: role } },
    { $push: { profiles: { role, profileId, profileModel } } },
  ).exec();
}

async function seed(): Promise<void> {
  await connectDatabase();
  const summary: string[] = [];

  // ── Zone A: Founder ───────────────────────────────────────────────────────
  const founderUser = await account({
    fullName: 'Founder',
    email: 'founder@africalrmc.com',
    phone: '+233200000001',
    role: 'founder',
  });
  const founderProfileId = await profile(
    FounderProfile as never,
    { email: 'founder@africalrmc.com' },
    {
      fullName: 'Founder',
      phone: '+233200000001',
      founderTitle: 'Founder & Chief Custodian',
      missionStatement:
        'To manage African property and mobility with institutional discipline, so that owners at home and abroad can trust what happens on the ground.',
      visionStatement:
        'One consortium standard for rentals, hospitality and mobility across the continent.',
      coreValues: ['Accountability', 'Transparency', 'Service', 'Stewardship', 'Diaspora trust'],
      policyAuthorityLevel: 'absolute',
      regionsOverseen: [REGION, 'Ashanti', 'Central', 'Western'],
      systemAccessScope: 'global',
      user: founderUser.id,
      status: 'active',
    },
  );
  await linkProfile(founderUser.id, 'founder', founderProfileId, 'FounderProfile');
  summary.push('Zone A — founder@africalrmc.com');

  // ── Zone B: HQ Executive ──────────────────────────────────────────────────
  const execUser = await account({
    fullName: 'Ama Mensah',
    email: 'exec@africalrmc.com',
    phone: '+233200000002',
    role: 'hqExecutive',
  });
  const execProfileId = await profile(
    HQExecutiveProfile as never,
    { email: 'exec@africalrmc.com' },
    {
      fullName: 'Ama Mensah',
      phone: '+233200000002',
      executiveTitle: 'Chief Operating Executive',
      portfolio: ['Operations', 'Regional performance', 'Ad revenue'],
      regionsOverseen: [REGION, 'Ashanti'],
      reportsTo: founderProfileId,
      appointedBy: founderUser.id,
      appointmentDate: new Date(),
      user: execUser.id,
      status: 'active',
    },
  );
  await linkProfile(execUser.id, 'hqExecutive', execProfileId, 'HQExecutiveProfile');
  summary.push('Zone B — exec@africalrmc.com');

  // ── Zone C: Back Office ───────────────────────────────────────────────────
  const staffUser = await account({
    fullName: 'Kofi Boateng',
    email: 'backoffice@africalrmc.com',
    phone: '+233200000003',
    role: 'backOfficeStaff',
  });
  const staffProfileId = await profile(
    BackOfficeStaffProfile as never,
    { email: 'backoffice@africalrmc.com' },
    {
      fullName: 'Kofi Boateng',
      phone: '+233200000003',
      staffNumber: 'LRMC-BO-0001',
      department: 'driverVerification',
      jobTitle: 'Verification Officer',
      employmentType: 'fullTime',
      hireDate: new Date(),
      regionsServed: [REGION],
      verificationStatus: 'verified',
      user: staffUser.id,
      status: 'active',
    },
  );
  await linkProfile(staffUser.id, 'backOfficeStaff', staffProfileId, 'BackOfficeStaffProfile');
  summary.push('Zone C — backoffice@africalrmc.com');

  // ── Field: coordinator + vendor ───────────────────────────────────────────
  const coordUser = await account({
    fullName: 'Yaa Owusu',
    email: 'coordinator@africalrmc.com',
    phone: '+233200000004',
    role: 'coordinator',
  });
  const coordProfileId = await profile(
    CoordinatorProfile as never,
    { email: 'coordinator@africalrmc.com' },
    {
      fullName: 'Yaa Owusu',
      phone: '+233200000004',
      areasCovered: [REGION],
      region: REGION,
      skills: ['Inspections', 'Tenant relations', 'Rent collection'],
      languages: ['English', 'Twi', 'Ga'],
      employmentType: 'contract',
      verificationStatus: 'verified',
      rating: 4.6,
      ratingCount: 34,
      completedTasks: 128,
      user: coordUser.id,
      status: 'active',
    },
  );
  await linkProfile(coordUser.id, 'coordinator', coordProfileId, 'CoordinatorProfile');

  const vendorUser = await account({
    fullName: 'Emmanuel Adjei',
    email: 'vendor@africalrmc.com',
    phone: '+233200000005',
    role: 'vendor',
  });
  const vendorProfileId = await profile(
    VendorProfile as never,
    { email: 'vendor@africalrmc.com' },
    {
      fullName: 'Emmanuel Adjei',
      businessName: 'Adjei Plumbing & Works',
      serviceType: 'plumbing',
      phone: '+233200000005',
      areasCovered: [REGION],
      region: REGION,
      skills: ['Pipework', 'Water heaters', 'Pumps'],
      toolsAvailable: ['Pipe wrench set', 'Drain snake', 'Pressure tester'],
      rateCard: [
        { item: 'Call-out inspection', unit: 'visit', amount: 120, currency: 'GHS' },
        { item: 'Tap replacement', unit: 'unit', amount: 90, currency: 'GHS' },
      ],
      insured: true,
      verificationStatus: 'verified',
      rating: 4.4,
      ratingCount: 61,
      completedJobs: 210,
      user: vendorUser.id,
      status: 'active',
    },
  );
  await linkProfile(vendorUser.id, 'vendor', vendorProfileId, 'VendorProfile');
  summary.push('Field — coordinator@ / vendor@africalrmc.com');

  // ── Members: landlord + property + tenant ─────────────────────────────────
  const landlordUser = await account({
    fullName: 'Nana Asante',
    email: 'landlord@africalrmc.com',
    phone: '+447700900001',
    role: 'landlord',
  });
  const landlordProfileId = await profile(
    LandlordProfile as never,
    { email: 'landlord@africalrmc.com' },
    {
      fullName: 'Nana Asante',
      phone: '+447700900001',
      nationality: 'Ghanaian',
      residenceCountry: 'United Kingdom',
      region: REGION,
      city: 'Accra',
      diasporaStatus: 'diaspora',
      payoutMethod: 'bankTransfer',
      payoutCurrency: 'GBP',
      managementFeePercent: 12,
      statementFrequency: 'monthly',
      verificationStatus: 'verified',
      user: landlordUser.id,
      status: 'active',
    },
  );
  await linkProfile(landlordUser.id, 'landlord', landlordProfileId, 'LandlordProfile');

  const propertyId = await profile(
    Property as never,
    { reference: 'LRMC-GRE-000001' },
    {
      title: '3-bedroom townhouse, East Legon',
      propertyType: 'townhouse',
      ownerKind: 'LandlordProfile',
      owner: landlordProfileId,
      assignedCoordinator: coordProfileId,
      address: '12 Boundary Road, East Legon',
      city: 'Accra',
      region: REGION,
      bedrooms: 3,
      bathrooms: 3,
      floorAreaSqm: 180,
      furnished: true,
      amenities: ['Borehole', 'Standby generator', 'Gated', 'Parking'],
      rentAmount: 6500,
      rentCurrency: 'GHS',
      rentPeriod: 'monthly',
      occupancyStatus: 'occupied',
      listedPublicly: false,
      status: 'active',
    },
  );
  await LandlordProfile.updateOne(
    { _id: landlordProfileId, propertiesOwned: { $ne: propertyId } },
    { $push: { propertiesOwned: propertyId } },
  ).exec();

  const tenantUser = await account({
    fullName: 'Akosua Darko',
    email: 'tenant@africalrmc.com',
    phone: '+233200000006',
    role: 'tenant',
  });
  const tenantProfileId = await profile(
    TenantProfile as never,
    { email: 'tenant@africalrmc.com' },
    {
      fullName: 'Akosua Darko',
      phone: '+233200000006',
      occupation: 'Software Engineer',
      employerName: 'Accra Digital Labs',
      property: propertyId,
      unitLabel: 'Whole house',
      leaseStart: new Date('2026-01-01'),
      leaseEnd: new Date('2026-12-31'),
      monthlyRent: 6500,
      rentCurrency: 'GHS',
      securityDeposit: 13000,
      paymentMethod: 'mobileMoney',
      rentDueDay: 1,
      region: REGION,
      city: 'Accra',
      verificationStatus: 'verified',
      user: tenantUser.id,
      status: 'active',
    },
  );
  await linkProfile(tenantUser.id, 'tenant', tenantProfileId, 'TenantProfile');
  await Property.updateOne({ _id: propertyId }, { $set: { currentTenant: tenantProfileId } }).exec();
  summary.push('Members — landlord@ / tenant@africalrmc.com (1 property)');

  // ── Ususu ─────────────────────────────────────────────────────────────────
  const driverUser = await account({
    fullName: 'Ibrahim Musah',
    email: 'driver@africaususu.com',
    phone: '+233200000007',
    role: 'driver',
  });
  const driverProfileId = await profile(
    DriverProfile as never,
    { email: 'driver@africaususu.com' },
    {
      fullName: 'Ibrahim Musah',
      phone: '+233200000007',
      vehicleType: 'sedan',
      vehicleMake: 'Toyota',
      vehicleModel: 'Corolla',
      vehicleYear: 2019,
      vehicleColor: 'Silver',
      vehiclePlate: 'GR-4821-24',
      driverLicenseExpiry: new Date(Date.now() + 400 * 86_400_000),
      insuranceExpiry: new Date(Date.now() + 200 * 86_400_000),
      areasCovered: [REGION],
      region: REGION,
      verificationStatus: 'verified',
      verifiedBy: staffUser.id,
      verifiedAt: new Date(),
      rating: 4.8,
      ratingCount: 412,
      completedRides: 1_284,
      user: driverUser.id,
      status: 'active',
    },
  );
  await linkProfile(driverUser.id, 'driver', driverProfileId, 'DriverProfile');

  const riderUser = await account({
    fullName: 'Efua Sarpong',
    email: 'rider@africaususu.com',
    phone: '+233200000008',
    role: 'rider',
  });
  const riderProfileId = await profile(
    RiderProfile as never,
    { email: 'rider@africaususu.com' },
    {
      fullName: 'Efua Sarpong',
      phone: '+233200000008',
      preferredPaymentMethod: 'mobileMoney',
      savedPlaces: [
        { label: 'Home', address: 'Dansoman, Accra' },
        { label: 'Work', address: 'Airport City, Accra' },
      ],
      rating: 4.9,
      ratingCount: 88,
      completedRides: 96,
      user: riderUser.id,
      status: 'active',
    },
  );
  await linkProfile(riderUser.id, 'rider', riderProfileId, 'RiderProfile');
  summary.push('Ususu — driver@ / rider@africaususu.com');

  // ── Commercial clients ────────────────────────────────────────────────────
  const hostUser = await account({
    fullName: 'Selorm Agbo',
    email: 'host@africalrmc.com',
    phone: '+233200000009',
    role: 'airbnbHost',
  });
  const hostProfileId = await profile(
    AirbnbHostProfile as never,
    { email: 'host@africalrmc.com' },
    {
      businessName: 'Cantonments Short Stays',
      contactPerson: 'Selorm Agbo',
      phone: '+233200000009',
      cleaningVendors: [vendorProfileId],
      maintenanceVendors: [vendorProfileId],
      assignedCoordinator: coordProfileId,
      checkInInstructions: 'Self check-in via smart lock. Code sent 2 hours before arrival.',
      checkOutInstructions: 'Leave keys on the dining table; close all windows.',
      turnoverWindowHours: 4,
      serviceTier: 'premium',
      region: REGION,
      city: 'Accra',
      verificationStatus: 'verified',
      user: hostUser.id,
      status: 'active',
    },
  );
  await linkProfile(hostUser.id, 'airbnbHost', hostProfileId, 'AirbnbHostProfile');

  const hotelUser = await account({
    fullName: 'Grace Nyarko',
    email: 'hotel@africalrmc.com',
    phone: '+233200000010',
    role: 'hotelManager',
  });
  const hotelProfileId = await profile(
    HotelProfile as never,
    { email: 'hotel@africalrmc.com' },
    {
      hotelName: 'Labadi Seal Hotel',
      managerName: 'Grace Nyarko',
      phone: '+233200000010',
      address: 'Labadi Beach Road, Accra',
      city: 'Accra',
      region: REGION,
      starRating: 4,
      roomCount: 84,
      maintenanceVendors: [vendorProfileId],
      cleaningVendors: [vendorProfileId],
      assignedCoordinator: coordProfileId,
      reportingFrequency: 'weekly',
      serviceTier: 'standard',
      verificationStatus: 'verified',
      user: hotelUser.id,
      status: 'active',
    },
  );
  await linkProfile(hotelUser.id, 'hotelManager', hotelProfileId, 'HotelProfile');

  const resortUser = await account({
    fullName: 'Kwabena Antwi',
    email: 'resort@africalrmc.com',
    phone: '+233200000011',
    role: 'resortManager',
  });
  const resortProfileId = await profile(
    ResortProfile as never,
    { email: 'resort@africalrmc.com' },
    {
      resortName: 'Ada Lagoon Resort',
      managerName: 'Kwabena Antwi',
      phone: '+233200000011',
      address: 'Ada Foah, Greater Accra',
      city: 'Ada Foah',
      region: REGION,
      villaCount: 22,
      amenitiesManaged: ['pool', 'restaurant', 'beachAccess', 'waterSports', 'generator'],
      maintenanceVendors: [vendorProfileId],
      cleaningVendors: [vendorProfileId],
      reportingFrequency: 'monthly',
      serviceTier: 'premium',
      verificationStatus: 'verified',
      user: resortUser.id,
      status: 'active',
    },
  );
  await linkProfile(resortUser.id, 'resortManager', resortProfileId, 'ResortProfile');

  const fleetUser = await account({
    fullName: 'Doris Tetteh',
    email: 'fleet@africalrmc.com',
    phone: '+233200000012',
    role: 'rentalCarCompany',
  });
  const fleetProfileId = await profile(
    RentalCarCompanyProfile as never,
    { email: 'fleet@africalrmc.com' },
    {
      companyName: 'Accra Prime Car Rentals',
      managerName: 'Doris Tetteh',
      phone: '+233200000012',
      region: REGION,
      city: 'Accra',
      fleet: [
        {
          plate: 'GT-1102-23',
          vehicleType: 'suv',
          make: 'Toyota',
          model: 'RAV4',
          year: 2021,
          dailyRate: 850,
          currency: 'GHS',
          availability: 'available',
        },
        {
          plate: 'GT-1103-23',
          vehicleType: 'sedan',
          make: 'Hyundai',
          model: 'Elantra',
          year: 2020,
          dailyRate: 520,
          currency: 'GHS',
          availability: 'rented',
        },
      ],
      insuranceProviders: ['Enterprise Insurance', 'SIC Insurance'],
      maintenanceVendors: [vendorProfileId],
      suppliesUsusu: true,
      reportingFrequency: 'monthly',
      verificationStatus: 'verified',
      user: fleetUser.id,
      status: 'active',
    },
  );
  await linkProfile(fleetUser.id, 'rentalCarCompany', fleetProfileId, 'RentalCarCompanyProfile');
  summary.push('Commercial — host@ / hotel@ / resort@ / fleet@africalrmc.com');

  // ── Revenue: ad policy, advertiser, live ad ───────────────────────────────
  const existingPolicy = await AdPolicy.findOne({ isActive: true }).select('_id').lean().exec();
  if (!existingPolicy) {
    await AdPolicy.create({
      ...DEFAULT_AD_POLICY,
      version: 1,
      isActive: true,
      effectiveFrom: new Date(),
      authoredBy: founderUser.id,
      ratifiedBy: founderUser.id,
      notes: 'Founding ad policy. Rate card in GHS; review required before serving.',
    });
    summary.push('Revenue — ad policy v1 ratified');
  }

  const advertiserUser = await account({
    fullName: 'Naa Adjeley',
    email: 'advertiser@africalrmc.com',
    phone: '+233200000013',
    role: 'advertiser',
  });
  const advertiserProfileId = await profile(
    AdvertiserProfile as never,
    { email: 'advertiser@africalrmc.com' },
    {
      advertiserName: 'Gold Coast Building Supplies',
      contactPerson: 'Naa Adjeley',
      phone: '+233200000013',
      businessType: 'construction',
      billingCurrency: 'GHS',
      creditLimit: 20_000,
      agreedCPM: 40,
      verificationStatus: 'verified',
      region: REGION,
      user: advertiserUser.id,
      status: 'active',
    },
  );
  await linkProfile(advertiserUser.id, 'advertiser', advertiserProfileId, 'AdvertiserProfile');

  const existingAd = await Ad.findOne({ advertiser: advertiserProfileId }).select('_id').lean().exec();
  if (!existingAd) {
    await Ad.create({
      advertiser: advertiserProfileId,
      advertiserName: 'Gold Coast Building Supplies',
      title: 'Roofing sheets — 15% off through the rains',
      adImage: 'https://cdn.lrmconsortium.com/ads/goldcoast-roofing.jpg',
      adImageAltText: 'Stacked aluminium roofing sheets',
      adLink: 'https://example.com/goldcoast/roofing',
      adCategory: 'construction',
      placements: ['heroBanner', 'sidebar'],
      targetZones: ['PUBLIC_PORTAL', 'MEMBER_PORTAL'],
      targetRegions: [REGION],
      startDate: new Date(),
      endDate: new Date(Date.now() + 60 * 86_400_000),
      rotationWeight: 40,
      priorityTier: 2,
      impressionCap: 250_000,
      budgetAmount: 10_000,
      budgetCurrency: 'GHS',
      status: 'active',
      reviewedBy: execUser.id,
      reviewedAt: new Date(),
      user: advertiserUser.id,
    });

    // A house ad so no slot ever renders empty.
    await Ad.create({
      advertiser: advertiserProfileId,
      advertiserName: 'LRM Consortium',
      title: 'List your property with LRMC',
      adImage: 'https://cdn.lrmconsortium.com/ads/house-list-with-us.jpg',
      adLink: 'https://lrmconsortium.com/landlords',
      adCategory: 'houseAd',
      placements: ['sidebar', 'footer', 'inFeed'],
      targetZones: ['PUBLIC_PORTAL', 'MEMBER_PORTAL', 'USUSU_PORTAL'],
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 86_400_000),
      rotationWeight: 5,
      priorityTier: 0,
      status: 'active',
      user: founderUser.id,
    });
    summary.push('Revenue — advertiser@africalrmc.com + 2 live ads');
  }

  // ── Zone E: public content ────────────────────────────────────────────────
  const pages = [
    {
      slug: 'about-lrmc',
      contentType: 'page' as const,
      title: 'About the Legacy Rental Management Consortium',
      excerpt:
        'LRMC manages residential rentals, short-lets, hotels, resorts and rental fleets to one institutional standard.',
      domains: ['lrmconsortium.com', 'lrmconsortium.africa'],
    },
    {
      slug: 'ususu-rideshare',
      contentType: 'servicePage' as const,
      title: 'Ususu Rideshare',
      excerpt: 'Verified drivers, transparent fares, and earnings you can actually reconcile.',
      domains: ['africaususu.com'],
    },
    {
      slug: 'diaspora-landlords',
      contentType: 'servicePage' as const,
      title: 'For diaspora landlords',
      excerpt:
        'Coordinators on the ground, monthly statements, and a maintenance trail you can audit from anywhere.',
      domains: ['lrmconsortium.com'],
    },
  ];

  for (const page of pages) {
    await profile(PublicContent as never, { slug: page.slug, locale: 'en' }, {
      ...page,
      isPublished: true,
      publishedAt: new Date(),
      author: founderUser.id,
      status: 'active',
    });
  }
  summary.push('Zone E — 3 published pages');

  logger.info('Seed complete');
  console.log(`\nSeeded:\n${summary.map((s) => `  • ${s}`).join('\n')}`);
  console.log(`\nAll accounts share the password: ${DEFAULT_PASSWORD}`);
  console.log('Change it, or set SEED_PASSWORD, before pointing this at anything real.\n');

  await disconnectDatabase();
}

seed().catch(async (err: unknown) => {
  logger.error('Seed failed', { error: String(err) });
  await disconnectDatabase();
  process.exit(1);
});
