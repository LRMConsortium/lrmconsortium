import {
  HQ_ZONES,
  type HQZone,
  EXECUTIVE_READ_SCOPE,
} from './hqZones.js';
import {
  all,
  readOnly,
  selfService,
  WILDCARD,
  type PermissionGrant,
} from './permissions.js';

/**
 * The fifteen roles of the consortium.
 *
 * Every role declares four things and nothing else:
 *   accessScope     — how wide the role sees (global → own record)
 *   permissions     — resource:action grants
 *   allowedZones    — HQ zones the role may enter
 *   restrictedZones — HQ zones the role may never enter (derived + explicit)
 *   allowedActions  — named business operations, for UI affordances and audit
 */
export const ROLES = [
  'founder',
  'hqExecutive',
  'backOfficeStaff',
  'coordinator',
  'vendor',
  'landlord',
  'tenant',
  'airbnbHost',
  'hotelManager',
  'resortManager',
  'rentalCarCompany',
  'driver',
  'rider',
  'advertiser',
  'publicUser',
] as const;

export type Role = (typeof ROLES)[number];

export const ACCESS_SCOPES = ['global', 'regional', 'zonal', 'organizational', 'own', 'public'] as const;
export type AccessScope = (typeof ACCESS_SCOPES)[number];

/** Which platform a role primarily belongs to. Drives portal routing. */
export const SERVICE_LINES = ['LRMC', 'USUSU', 'BOTH', 'REVENUE', 'PUBLIC'] as const;
export type ServiceLine = (typeof SERVICE_LINES)[number];

export interface RoleDefinition {
  role: Role;
  label: string;
  serviceLine: ServiceLine;
  accessScope: AccessScope;
  /** Does this role act on behalf of an organisation rather than a person? */
  isOrganizational: boolean;
  /** Must Back Office verify the account before it becomes active? */
  requiresVerification: boolean;
  /** The profile collection that backs this role, if any. */
  profileModel: string | null;
  permissions: PermissionGrant[];
  allowedZones: HQZone[];
  restrictedZones: HQZone[];
  allowedActions: string[];
}

const NO_ZONES: HQZone[] = [];

function restrict(allowed: HQZone[]): HQZone[] {
  return HQ_ZONES.filter((z) => !allowed.includes(z));
}

/**
 * The Public Portal is the open surface — a signed-in landlord browsing the
 * property listings, or a driver reading the Ususu marketing pages, is still
 * just a visitor to the public website. Gating it per role would 403 members out
 * of their own front door.
 *
 * Nothing is given away by this: Zone E has no entry permissions, its
 * `dataFirewall` blocks ID numbers, rent and earnings, and the administrative
 * capability inside it (content authoring, traffic metrics) is gated by
 * `publicContent:*` / `publicMetrics:read`, which no member role holds.
 */
const UNIVERSAL_ZONES: HQZone[] = ['PUBLIC_PORTAL'];

function define(
  d: Omit<RoleDefinition, 'restrictedZones'> & { restrictedZones?: HQZone[] },
): RoleDefinition {
  const allowedZones = [...new Set([...d.allowedZones, ...UNIVERSAL_ZONES])];
  return {
    ...d,
    allowedZones,
    restrictedZones: d.restrictedZones ?? restrict(allowedZones),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HQ
// ─────────────────────────────────────────────────────────────────────────────

const founder = define({
  role: 'founder',
  label: 'Founder',
  serviceLine: 'BOTH',
  accessScope: 'global',
  isOrganizational: false,
  requiresVerification: false,
  profileModel: 'FounderProfile',
  permissions: [WILDCARD],
  allowedZones: [...HQ_ZONES],
  allowedActions: [
    'authorPolicy',
    'amendPolicy',
    'ratifyPolicy',
    'repealPolicy',
    'approveSystemWideChange',
    'appointHQExecutive',
    'appointBackOfficeStaff',
    'setAdPricing',
    'setAdRotationRules',
    'setAdCategoryPolicy',
    'overrideVerification',
    'suspendAccount',
    'reinstateAccount',
    'declareRegion',
    'freezeService',
    'readAuditLog',
    'exportAnything',
  ],
});

const hqExecutive = define({
  role: 'hqExecutive',
  label: 'HQ Executive',
  serviceLine: 'BOTH',
  accessScope: 'regional',
  isOrganizational: false,
  requiresVerification: false,
  profileModel: 'HQExecutiveProfile',
  permissions: [
    ...EXECUTIVE_READ_SCOPE,
    'policy:read',
    'auditLog:read',
    'analytics:export',
    'hqExecutiveProfile:readOwn',
    'hqExecutiveProfile:updateOwn',
    'backOfficeStaffProfile:read',
    'landlordProfile:read',
    'tenantProfile:read',
    'driverProfile:read',
    'riderProfile:read',
    'airbnbHostProfile:read',
    'hotelProfile:read',
    'resortProfile:read',
    'rentalCarCompanyProfile:read',
    'advertiserProfile:read',
    'ad:read',
    'ad:approve',
    'publicMetrics:read',
    'lease:read',
    'payment:read',
    'commercialClient:read',
    'maintenanceRequest:read',
    'ride:read',
    'notification:readOwn',
    'notification:create',
    'payout:read',
    'document:read',
    'document:review',
    'document:verify',
    'document:export',
    'fac:verify',
    'fac:read',
    'governance:read',
  ],
  allowedZones: ['HQ_EXECUTIVE', 'BACK_OFFICE', 'MEMBER_PORTAL', 'PUBLIC_PORTAL'],
  allowedActions: [
    'viewExecutiveDashboard',
    'viewKPIs',
    'viewSystemHealth',
    'viewRegionalPerformance',
    'proposePolicy',
    'approveOnboarding',
    'approveAdCampaign',
    'escalateToFounder',
    'exportAnalytics',
  ],
});

const backOfficeStaff = define({
  role: 'backOfficeStaff',
  label: 'Back Office Staff',
  serviceLine: 'BOTH',
  accessScope: 'zonal',
  isOrganizational: false,
  requiresVerification: true,
  profileModel: 'BackOfficeStaffProfile',
  permissions: [
    all('coordinatorProfile'),
    all('vendorProfile'),
    all('backOfficeStaffProfile'),
    'driverProfile:read',
    'driverProfile:update',
    'driverProfile:verify',
    'riderProfile:read',
    'landlordProfile:create',
    'landlordProfile:read',
    'landlordProfile:update',
    'landlordProfile:verify',
    'tenantProfile:create',
    'tenantProfile:read',
    'tenantProfile:update',
    'tenantProfile:verify',
    'airbnbHostProfile:create',
    'airbnbHostProfile:read',
    'airbnbHostProfile:update',
    'airbnbHostProfile:verify',
    'hotelProfile:create',
    'hotelProfile:read',
    'hotelProfile:update',
    'hotelProfile:verify',
    'resortProfile:create',
    'resortProfile:read',
    'resortProfile:update',
    'resortProfile:verify',
    'rentalCarCompanyProfile:create',
    'rentalCarCompanyProfile:read',
    'rentalCarCompanyProfile:update',
    'rentalCarCompanyProfile:verify',
    'property:read',
    'property:update',
    'lease:read',
    'maintenanceRequest:read',
    'maintenanceRequest:assign',
    'maintenanceRequest:update',
    'rentPayment:read',
    'analytics:read',
    'user:read',
    'user:update',
    'lease:create',
    'lease:read',
    'lease:update',
    'payment:read',
    'payment:create',
    'commercialClient:create',
    'commercialClient:read',
    'commercialClient:update',
    'ride:read',
    'notification:readOwn',
    'notification:create',
    'payout:create',
    'payout:read',
    'payout:update',
    'document:create',
    'document:read',
    'document:review',
    'document:verify',
    'document:update',
    'document:assign',
    'governance:read',
  ],
  allowedZones: ['BACK_OFFICE', 'MEMBER_PORTAL'],
  allowedActions: [
    'createCoordinatorProfile',
    'updateCoordinatorProfile',
    'deactivateCoordinator',
    'createVendorProfile',
    'updateVendorProfile',
    'verifyVendor',
    'verifyDriver',
    'rejectDriver',
    'onboardAirbnbHost',
    'onboardHotel',
    'onboardResort',
    'onboardRentalCarCompany',
    'assignCoordinatorToZone',
    'assignVendorToJob',
    'processVerificationQueue',
    'maintainStaffRecords',
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// LRMC field & members
// ─────────────────────────────────────────────────────────────────────────────

const coordinator = define({
  role: 'coordinator',
  label: 'Coordinator',
  serviceLine: 'LRMC',
  accessScope: 'regional',
  isOrganizational: false,
  requiresVerification: true,
  profileModel: 'CoordinatorProfile',
  permissions: [
    ...selfService('coordinatorProfile'),
    'property:read',
    'property:update',
    'lease:read',
    'tenantProfile:read',
    'landlordProfile:read',
    'vendorProfile:read',
    'maintenanceRequest:create',
    'maintenanceRequest:read',
    'maintenanceRequest:update',
    'maintenanceRequest:assign',
    'rentPayment:read',
    'rentPayment:create',
    'lease:read',
    'payment:readOwn',
    'notification:readOwn',
    'document:create',
    'document:read',
    'document:review',
    'document:readOwn',
    'governance:read',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'viewAssignedProperties',
    'inspectProperty',
    'logPropertyCondition',
    'openMaintenanceRequest',
    'assignVendorToRequest',
    'closeMaintenanceRequest',
    'recordRentCollection',
    'uploadInspectionPhotos',
    'contactTenant',
    'contactLandlord',
    'escalateToBackOffice',
  ],
});

const vendor = define({
  role: 'vendor',
  label: 'Vendor',
  serviceLine: 'LRMC',
  accessScope: 'own',
  isOrganizational: true,
  requiresVerification: true,
  profileModel: 'VendorProfile',
  permissions: [
    ...selfService('vendorProfile'),
    'maintenanceRequest:read',
    'maintenanceRequest:update',
    'property:read',
    'notification:readOwn',
    'payment:readOwn',
    'document:create',
    'document:readOwn',
    'document:updateOwn',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'viewAssignedJobs',
    'acceptJob',
    'declineJob',
    'updateJobStatus',
    'uploadJobPhotos',
    'submitQuote',
    'submitInvoice',
    'updateOwnRates',
    'updateAvailability',
  ],
});

const landlord = define({
  role: 'landlord',
  label: 'Landlord',
  serviceLine: 'LRMC',
  accessScope: 'own',
  isOrganizational: false,
  requiresVerification: true,
  profileModel: 'LandlordProfile',
  permissions: [
    ...selfService('landlordProfile'),
    'property:create',
    'property:readOwn',
    'property:updateOwn',
    'lease:readOwn',
    'rentPayment:readOwn',
    'maintenanceRequest:readOwn',
    'maintenanceRequest:approve',
    'tenantProfile:readOwn',
    'vendorProfile:read',
    'lease:readOwn',
    'lease:create',
    'payment:readOwn',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'document:updateOwn',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'viewOwnProperties',
    'addProperty',
    'updateProperty',
    'viewRentLedger',
    'viewOwnStatements',
    'approveMaintenanceSpend',
    'requestPayout',
    'viewTenantOfOwnProperty',
    'updateOwnProfile',
    'uploadOwnershipDocuments',
  ],
});

const tenant = define({
  role: 'tenant',
  label: 'Tenant',
  serviceLine: 'LRMC',
  accessScope: 'own',
  isOrganizational: false,
  requiresVerification: true,
  profileModel: 'TenantProfile',
  permissions: [
    ...selfService('tenantProfile'),
    'lease:readOwn',
    'rentPayment:readOwn',
    'rentPayment:create',
    'maintenanceRequest:create',
    'maintenanceRequest:readOwn',
    'property:readOwn',
    'lease:readOwn',
    'payment:readOwn',
    'payment:create',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'document:updateOwn',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'viewOwnLease',
    'payRent',
    'viewPaymentHistory',
    'downloadReceipt',
    'submitMaintenanceRequest',
    'trackMaintenanceRequest',
    'rateVendorVisit',
    'updateOwnProfile',
    'requestLeaseRenewal',
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// LRMC commercial clients
// ─────────────────────────────────────────────────────────────────────────────

const commercialActions = (unit: string): string[] => [
  `viewOwn${unit}s`,
  `add${unit}`,
  `update${unit}`,
  'requestCleaning',
  'requestMaintenance',
  'assignPreferredVendor',
  'viewServiceHistory',
  'viewOwnInvoices',
  'downloadReports',
  'updateOwnProfile',
];

const airbnbHost = define({
  role: 'airbnbHost',
  label: 'Airbnb Host',
  serviceLine: 'LRMC',
  accessScope: 'organizational',
  isOrganizational: true,
  requiresVerification: true,
  profileModel: 'AirbnbHostProfile',
  permissions: [
    ...selfService('airbnbHostProfile'),
    'property:create',
    'property:readOwn',
    'property:updateOwn',
    'maintenanceRequest:create',
    'maintenanceRequest:readOwn',
    'vendorProfile:read',
    'coordinatorProfile:read',
    'commercialClient:readOwn',
    'payment:readOwn',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'document:updateOwn',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    ...commercialActions('Unit'),
    'setCheckInInstructions',
    'setCheckOutInstructions',
    'scheduleTurnoverClean',
  ],
});

const hotelManager = define({
  role: 'hotelManager',
  label: 'Hotel Manager',
  serviceLine: 'LRMC',
  accessScope: 'organizational',
  isOrganizational: true,
  requiresVerification: true,
  profileModel: 'HotelProfile',
  permissions: [
    ...selfService('hotelProfile'),
    'property:create',
    'property:readOwn',
    'property:updateOwn',
    'maintenanceRequest:create',
    'maintenanceRequest:readOwn',
    'vendorProfile:read',
    'coordinatorProfile:read',
    'commercialClient:readOwn',
    'payment:readOwn',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'document:updateOwn',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [...commercialActions('Room'), 'manageStaffList', 'setReportingPreferences'],
});

const resortManager = define({
  role: 'resortManager',
  label: 'Resort Manager',
  serviceLine: 'LRMC',
  accessScope: 'organizational',
  isOrganizational: true,
  requiresVerification: true,
  profileModel: 'ResortProfile',
  permissions: [
    ...selfService('resortProfile'),
    'property:create',
    'property:readOwn',
    'property:updateOwn',
    'maintenanceRequest:create',
    'maintenanceRequest:readOwn',
    'vendorProfile:read',
    'coordinatorProfile:read',
    'commercialClient:readOwn',
    'payment:readOwn',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'document:updateOwn',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    ...commercialActions('Villa'),
    'manageAmenities',
    'manageStaffList',
    'setReportingPreferences',
  ],
});

const rentalCarCompany = define({
  role: 'rentalCarCompany',
  label: 'Rental Car Company',
  serviceLine: 'BOTH',
  accessScope: 'organizational',
  isOrganizational: true,
  requiresVerification: true,
  profileModel: 'RentalCarCompanyProfile',
  permissions: [
    ...selfService('rentalCarCompanyProfile'),
    'maintenanceRequest:create',
    'maintenanceRequest:readOwn',
    'vendorProfile:read',
    'driverProfile:read',
    'earnings:readOwn',
    'commercialClient:readOwn',
    'payment:readOwn',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'document:updateOwn',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'viewOwnFleet',
    'addVehicle',
    'retireVehicle',
    'assignVehicleToDriver',
    'requestMaintenance',
    'updateRentalRates',
    'manageInsuranceProviders',
    'viewUtilizationReport',
    'downloadReports',
    'updateOwnProfile',
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// Ususu mobility
// ─────────────────────────────────────────────────────────────────────────────

const driver = define({
  role: 'driver',
  label: 'Ususu Driver',
  serviceLine: 'USUSU',
  accessScope: 'own',
  isOrganizational: false,
  requiresVerification: true,
  profileModel: 'DriverProfile',
  permissions: [
    ...selfService('driverProfile'),
    'ride:read',
    'ride:update',
    'earnings:readOwn',
    'riderProfile:read',
    'ride:readOwn',
    'ride:update',
    'payment:readOwn',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'document:updateOwn',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'goOnline',
    'goOffline',
    'acceptRide',
    'declineRide',
    'startRide',
    'completeRide',
    'cancelRide',
    'viewOwnEarnings',
    'requestPayout',
    'uploadVehicleDocuments',
    'updateOwnProfile',
    'rateRider',
  ],
});

const rider = define({
  role: 'rider',
  label: 'Ususu Rider',
  serviceLine: 'USUSU',
  accessScope: 'own',
  isOrganizational: false,
  requiresVerification: false,
  profileModel: 'RiderProfile',
  permissions: [
    ...selfService('riderProfile'),
    'ride:create',
    'ride:readOwn',
    'ride:update',
    'driverProfile:read',
    'payment:readOwn',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'document:updateOwn',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'requestRide',
    'cancelRide',
    'viewRideHistory',
    'rateDriver',
    'addPaymentMethod',
    'setPreferredPaymentMethod',
    'shareTrip',
    'reportIssue',
    'updateOwnProfile',
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// Revenue & public
// ─────────────────────────────────────────────────────────────────────────────

const advertiser = define({
  role: 'advertiser',
  label: 'Advertiser',
  serviceLine: 'REVENUE',
  accessScope: 'own',
  isOrganizational: true,
  requiresVerification: true,
  profileModel: 'AdvertiserProfile',
  permissions: [
    ...selfService('advertiserProfile'),
    'ad:create',
    'ad:readOwn',
    'ad:updateOwn',
    'adReport:readOwn',
    'adPolicy:read',
    'payment:readOwn',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'document:updateOwn',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'submitAdCreative',
    'editPendingAd',
    'pauseOwnAd',
    'resumeOwnAd',
    'setCampaignDates',
    'requestRotationWeight',
    'viewOwnImpressions',
    'viewOwnClicks',
    'viewOwnCTR',
    'downloadCampaignReport',
    'updateOwnProfile',
  ],
});

const publicUser = define({
  role: 'publicUser',
  label: 'Public User',
  serviceLine: 'PUBLIC',
  accessScope: 'public',
  isOrganizational: false,
  requiresVerification: false,
  profileModel: null,
  permissions: [...readOnly('publicContent'), 'publicMetrics:read'],
  allowedZones: ['PUBLIC_PORTAL'],
  allowedActions: [
    'browsePublicListings',
    'viewPublicContent',
    'searchProperties',
    'submitContactForm',
    'requestQuote',
    'applyAsTenant',
    'applyAsDriver',
    'applyAsVendor',
    'registerAccount',
    'viewAdPlacement',
    'clickAdPlacement',
  ],
});

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  founder,
  hqExecutive,
  backOfficeStaff,
  coordinator,
  vendor,
  landlord,
  tenant,
  airbnbHost,
  hotelManager,
  resortManager,
  rentalCarCompany,
  driver,
  rider,
  advertiser,
  publicUser,
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function roleDefinition(role: Role): RoleDefinition {
  return ROLE_DEFINITIONS[role];
}

/** Flattened grants for a set of roles (a user may legitimately hold several). */
export function grantsForRoles(roles: readonly Role[]): string[] {
  const set = new Set<string>();
  for (const r of roles) for (const p of ROLE_DEFINITIONS[r].permissions) set.add(p);
  return [...set];
}

export function zonesForRoles(roles: readonly Role[]): HQZone[] {
  const set = new Set<HQZone>();
  for (const r of roles) for (const z of ROLE_DEFINITIONS[r].allowedZones) set.add(z);
  return [...set];
}

export function actionsForRoles(roles: readonly Role[]): string[] {
  const set = new Set<string>();
  for (const r of roles) for (const a of ROLE_DEFINITIONS[r].allowedActions) set.add(a);
  return [...set];
}

/** Widest scope wins when a user holds multiple roles. */
const SCOPE_RANK: Record<AccessScope, number> = {
  global: 6,
  regional: 5,
  zonal: 4,
  organizational: 3,
  own: 2,
  public: 1,
};

export function effectiveScope(roles: readonly Role[]): AccessScope {
  if (roles.length === 0) return 'public';
  return roles.reduce<AccessScope>((widest, r) => {
    const s = ROLE_DEFINITIONS[r].accessScope;
    return SCOPE_RANK[s] > SCOPE_RANK[widest] ? s : widest;
  }, 'public');
}

/** A zone is restricted unless at least one held role allows it. */
export function restrictedZonesForRoles(roles: readonly Role[]): HQZone[] {
  const allowed = new Set(zonesForRoles(roles));
  return HQ_ZONES.filter((z) => !allowed.has(z));
}

export const ROLE_MATRIX = ROLES.map((r) => {
  const d = ROLE_DEFINITIONS[r];
  return {
    role: d.role,
    label: d.label,
    serviceLine: d.serviceLine,
    accessScope: d.accessScope,
    permissionCount: d.permissions.length,
    allowedZones: d.allowedZones,
    restrictedZones: d.restrictedZones,
    allowedActionCount: d.allowedActions.length,
  };
});

export { NO_ZONES };
