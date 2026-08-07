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
 * The nineteen roles of the consortium.
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

  // Marketplace. Merchant and Customer are the accounts a coordinator
  // supervises; Seller and Buyer are the people who act for them.
  'merchant',
  'seller',
  'customer',
  'buyer',

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
    'merchantProfile:read',
    'customerProfile:read',
    'listing:read',
    'order:read',
    'marketplace:read',
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
    // Back Office administers the marketplace parties and adjudicates orders.
    all('merchantProfile'),
    all('customerProfile'),
    all('listing'),
    all('order'),
    all('marketplace'),
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
    all('viewing'),
    all('application'),
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
    // The coordinator runs the viewing diary in their region and is the first
    // person to look at an application. `approve` here is the grant to record
    // a decision; which decisions exist is the lifecycle table's business.
    'viewing:read',
    'viewing:update',
    'viewing:approve',
    'application:read',
    'application:update',
    'application:approve',
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
    // Read-only on both. LRMC carries the tenancy, holds the deposit and
    // answers for the decision, so a landlord sees who applied and what LRMC
    // made of them — and does not approve or reject. See
    // `applicationLifecycle.mayDecide`.
    'viewing:readOwn',
    'application:readOwn',
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
    // A tenant asks for a viewing and applies for a tenancy. They may update
    // their own — which is how a withdrawal happens — but `mayDecide` is what
    // stops that becoming an approval.
    'viewing:create',
    'viewing:readOwn',
    'viewing:updateOwn',
    'application:create',
    'application:readOwn',
    'application:updateOwn',
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


// ─────────────────────────────────────────────────────────────────────────────
// Marketplace
//
// Four roles in two pairs, and the pairing is the whole design.
//
// A **Merchant** is an account — a trading business trading on the LRMC
// marketplace. A **Seller** is a person who acts for one. Likewise a
// **Customer** is an account and a **Buyer** is a person who purchases against
// it.
//
// **Nobody supervises them in the field.** Coordinators supervise vendors —
// maintenance workers on properties, dispatched against work orders. The
// marketplace parties are governed by the platform's own rules instead, which
// is a deliberate scaling choice: onboarding a merchant must not require a
// human in their region, or the marketplace grows only as fast as LRMC can
// hire.
//
// What "the system supervises them" means concretely, and where each rule
// lives:
//
//   verification    `listingRules.canPublish` refuses to publish anything for
//                   an unverified merchant, so an unverified account can exist
//                   but cannot trade.
//   catalogue       publish eligibility is checked on every submission, and a
//                   product that hits zero stock leaves the catalogue on its
//                   own (`autoUnpublish`).
//   money           escrow is held and released by rule, not by permission —
//                   `orderLifecycle` gives no actor a path to release funds to
//                   themselves, and `AUTO_RELEASE_DAYS` stops a silent buyer
//                   stranding a merchant's settlement.
//   disputes        the one place a human is required. Only Back Office can
//                   resolve one, because a dispute either party could quietly
//                   clear is not a dispute.
//
// Why not collapse each pair into one role: a merchant with three staff needs
// all three able to sell without sharing one login, and needs one of them
// removed on a Friday without the other two losing access. The account is what
// holds the trading relationship, the bank details and the coordinator's
// supervision; the person is what holds the password. Merging them makes the
// first staff change a data-migration problem.
//
// These are **not vendors**. A vendor does maintenance work on a property under
// a work order. A merchant trades goods and services in the marketplace under
// an order with money held in escrow. Different relationship, different money
// flow, deliberately different role.
// ─────────────────────────────────────────────────────────────────────────────

const merchant = define({
  role: 'merchant',
  label: 'Merchant',
  serviceLine: 'LRMC',
  accessScope: 'organizational',
  isOrganizational: true,
  requiresVerification: true,
  profileModel: 'MerchantProfile',
  permissions: [
    ...selfService('merchantProfile'),
    // The account owns its catalogue outright.
    all('listing'),
    'order:read',
    'order:update',
    // Not `order:create`. A merchant creating orders against itself is how a
    // marketplace's numbers stop meaning anything.
    'payout:read',
    'payment:readOwn',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'document:updateOwn',
    'marketplace:read',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'manageCatalogue',
    'publishListing',
    'unpublishListing',
    'manageSellers',
    'acceptOrder',
    'declineOrder',
    'fulfilOrder',
    'viewSettlements',
    'updateOwnRates',
  ],
});

const seller = define({
  role: 'seller',
  label: 'Seller',
  serviceLine: 'LRMC',
  accessScope: 'organizational',
  isOrganizational: false,
  requiresVerification: true,
  profileModel: 'MerchantProfile',
  permissions: [
    'merchantProfile:readOwn',
    'listing:create',
    'listing:read',
    'listing:update',
    // No `listing:delete`. A seller withdrawing a listing unpublishes it,
    // which is reversible; destroying the merchant's catalogue is not a thing
    // one member of staff should be able to do alone.
    'order:read',
    'order:update',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'marketplace:read',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'manageCatalogue',
    'publishListing',
    'unpublishListing',
    'acceptOrder',
    'declineOrder',
    'fulfilOrder',
  ],
});

const customer = define({
  role: 'customer',
  label: 'Customer',
  serviceLine: 'LRMC',
  accessScope: 'organizational',
  isOrganizational: true,
  requiresVerification: false,
  profileModel: 'CustomerProfile',
  permissions: [
    ...selfService('customerProfile'),
    'listing:read',
    'order:create',
    'order:read',
    'order:updateOwn',
    'payment:readOwn',
    'notification:readOwn',
    'document:create',
    'document:readOwn',
    'marketplace:read',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'browseMarketplace',
    'placeOrder',
    'cancelOrder',
    'confirmReceipt',
    'raiseDispute',
    'manageBuyers',
  ],
});

const buyer = define({
  role: 'buyer',
  label: 'Buyer',
  serviceLine: 'LRMC',
  accessScope: 'organizational',
  isOrganizational: false,
  requiresVerification: false,
  profileModel: 'CustomerProfile',
  permissions: [
    'customerProfile:readOwn',
    'listing:read',
    'order:create',
    'order:read',
    'order:updateOwn',
    'notification:readOwn',
    'marketplace:read',
  ],
  allowedZones: ['MEMBER_PORTAL'],
  allowedActions: [
    'browseMarketplace',
    'placeOrder',
    'cancelOrder',
    'confirmReceipt',
    'raiseDispute',
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
  merchant,
  seller,
  customer,
  buyer,
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
