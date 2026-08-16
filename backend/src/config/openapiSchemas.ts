/**
 * OpenAPI component schemas.
 *
 * Express-free and Mongoose-free, like `apiBlueprint.ts`, so `npm run verify`
 * can assert against it and `npm run openapi` can render the document without a
 * server.
 *
 * The shared fragments mirror `shared/schemaFragments.ts` one-for-one:
 * `ContactFields` here is `contactFields` there. Same reason as the TypeScript
 * shapes — a field group should be stated once, so the schema, the type and the
 * published contract cannot drift apart.
 *
 * `writeOnly: true` marks fields the API accepts but never returns. Those are
 * `select: false` in Mongoose *and* stripped in `toJSON`; saying so here stops a
 * generated client from expecting an ID number it will never see.
 */

export type JsonSchema = Record<string, unknown>;

const str = (extra: JsonSchema = {}): JsonSchema => ({ type: 'string', ...extra });
const num = (extra: JsonSchema = {}): JsonSchema => ({ type: 'number', ...extra });
const int = (extra: JsonSchema = {}): JsonSchema => ({ type: 'integer', ...extra });
const bool = (extra: JsonSchema = {}): JsonSchema => ({ type: 'boolean', ...extra });
const date = (): JsonSchema => ({ type: 'string', format: 'date-time' });
const arr = (items: JsonSchema): JsonSchema => ({ type: 'array', items });
const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });
const strArr = (): JsonSchema => arr(str());
/** Mongo ObjectId as it appears on the wire. */
const oid = (desc?: string): JsonSchema =>
  str({ pattern: '^[a-f\\d]{24}$', ...(desc ? { description: desc } : {}) });

const allOf = (...parts: JsonSchema[]): JsonSchema => ({ allOf: parts });

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations — kept in step with config/* and the models
// ─────────────────────────────────────────────────────────────────────────────

export const VERIFICATION_STATUS = [
  'unsubmitted', 'pending', 'inReview', 'verified', 'rejected', 'suspended',
];
export const LIFECYCLE_STATUS = ['draft', 'active', 'inactive', 'suspended', 'archived'];

/** Marketplace. Mirrors `orderLifecycle.ORDER_STATUSES` and `MERCHANT_CATEGORIES`. */
export const ORDER_STATUS = [
  'pending', 'paid', 'accepted', 'fulfilled', 'confirmed',
  'released', 'cancelled', 'refunded', 'disputed',
];
export const LISTING_STATUS = ['draft', 'pending', 'published', 'suspended', 'archived'];
export const MERCHANT_CATEGORY = [
  'homeGoods', 'buildingMaterials', 'furnishing', 'appliances', 'cleaning',
  'security', 'landscaping', 'professionalServices', 'logistics', 'other',
];
export const ID_TYPE = ['ghanaCard', 'passport', 'driversLicense', 'votersId', 'nationalId', 'ssnit', 'other'];
export const CONTACT_METHOD = ['phone', 'whatsapp', 'email', 'sms', 'inApp'];
export const PAYMENT_METHOD = ['mobileMoney', 'bankTransfer', 'cash', 'card', 'cheque', 'crypto'];
export const CURRENCY = ['GMD', 'GHS', 'USD', 'EUR', 'GBP', 'NGN', 'XOF'];
export const DIASPORA_STATUS = ['resident', 'diaspora', 'returnee', 'dualBased'];
export const SERVICE_TIER = ['basic', 'standard', 'premium'];
export const REPORTING_FREQUENCY = ['daily', 'weekly', 'monthly', 'quarterly'];

// Operational enumerations. Named rather than inlined because the flow schemas
// below reference the same lists from several places, and a copy that drifts is
// a contract that lies.
export const LEASE_STATUS = [
  'draft', 'pendingSignature', 'active', 'inArrears', 'expiring', 'completed', 'terminated',
];
export const ARREARS_ESCALATION = [
  'none', 'reminder', 'firstNotice', 'finalNotice', 'legalReferral',
];
export const MAINTENANCE_STATUS = [
  'open', 'triaged', 'assigned', 'quoted', 'approved', 'inProgress', 'onHold',
  'completed', 'verified', 'cancelled',
];
export const MAINTENANCE_PRIORITY = ['low', 'normal', 'high', 'emergency'];
export const SLA_STATE = ['onTrack', 'atRisk', 'due', 'overdue', 'met', 'breached'];
export const SLA_ESCALATION = [
  'none', 'notifyVendor', 'notifyCoordinator', 'notifyBackOffice', 'notifyHQ',
];
export const NOTIFICATION_CHANNEL = ['inApp', 'push', 'whatsapp', 'sms', 'email'];
export const NOTIFICATION_STATUS = ['queued', 'sent', 'delivered', 'read', 'failed'];
export const NOTIFICATION_CATEGORY = [
  'verification', 'documentExpiry', 'rentDue', 'rentReceipt', 'maintenance',
  'rideOffer', 'rideUpdate', 'payout', 'adReview', 'adBudget', 'policy', 'system',
];
export const CLIENT_KIND = [
  'hospitalityGroup', 'propertyCompany', 'mobilityOperator', 'agency',
  'corporate', 'government', 'ngo',
];
export const PAYOUT_KIND = ['driverPayout', 'landlordPayout', 'refund'];
export const PAYOUT_BATCH_STATUS = [
  'draft', 'approved', 'settling', 'settled', 'partiallySettled', 'failed', 'cancelled',
];
export const TRANSFER_STATUS = ['pending', 'processing', 'settled', 'failed', 'reversed'];
export const DOCUMENT_TYPE = [
  'identity', 'proofOfResidency', 'hostConfirmation', 'rentalAgreement', 'tenantIntake',
  'propertyOwnership', 'employmentVerification', 'incomeProof', 'maritalStatus', 'birthRecord',
  'criminalBackground', 'driverLicence', 'vehicleInsurance', 'roadworthiness',
  'businessRegistration', 'taxClearance',
];
export const DOCUMENT_STATUS = [
  'submitted', 'underReview', 'needsMoreInfo', 'verified', 'rejected', 'expired',
];
export const DOCUMENT_FIELD = [
  'holderName', 'counterpartyName', 'documentNumber', 'issuingAuthority', 'issuedOn',
  'expiresOn', 'dateOfBirth', 'nationality', 'address', 'city', 'region', 'employerName',
  'jobTitle', 'monthlyIncome', 'amount', 'currency', 'periodStart', 'periodEnd',
  'relationship', 'outcome', 'notes',
];
export const REVIEW_DESK = ['backOffice', 'coordinator', 'hqExecutive'];
export const AUDIT_ACTION = [
  'create', 'submit', 'review', 'requestInfo', 'verify', 'reject', 'expire', 'reverify',
  'amend', 'archive',
];
export const COMPLIANCE_RULE = [
  'residencyMatchesProperty', 'hostConfirmationMatchesLandlord', 'rentalAgreementMatchesLease',
  'tenantIntakeMatchesProfile', 'propertyOwnershipMatchesClient', 'employmentMatchesEmployer',
  'identityMatchesProfile', 'maritalStatusMatchesHousehold', 'birthRecordMatchesDependent',
  'criminalBackgroundMatchesEligibility',
];
export const CHECK_OUTCOME = ['passed', 'failed', 'skipped'];
export const CHECK_SEVERITY = ['blocking', 'advisory'];
export const EXPIRY_STATE = ['noExpiry', 'valid', 'expiringSoon', 'expiresToday', 'expired'];
export const EXPIRY_ESCALATION = [
  'none', 'notifyHolder', 'notifyCoordinator', 'notifyBackOffice', 'suspendPrivilege',
];
export const SCORE_BAND = ['poor', 'fair', 'good', 'excellent'];
export const SCORE_DIMENSION = ['completeness', 'clarity', 'consistency', 'crossDocument'];
export const DOCUMENT_MIME_TYPE = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp',
];

export const HQ_ZONE_KEYS = [
  'FOUNDER_COMMAND_CENTER', 'HQ_EXECUTIVE', 'BACK_OFFICE', 'MEMBER_PORTAL', 'PUBLIC_PORTAL',
];
export const FAC_CODE_STATUS = ['active', 'expired', 'revoked', 'superseded'];
export const ROTATION_TRIGGER = [
  'scheduled', 'roleChange', 'manual', 'compromise', 'lockoutThreshold',
];
export const ATTEMPT_RESULT = ['pass', 'fail', 'blocked', 'cleared'];
export const ATTEMPT_REFUSAL = ['lockedOut', 'noActiveCode', 'malformed'];
export const CODE_HEALTH = ['active', 'expiringSoon', 'expired'];
export const GOVERNANCE_TIER = ['founders', 'hq', 'staff', 'membership'];
export const ADMIN_ACCESS = ['full', 'partial', 'limited', 'none'];
export const HEALTH_COMPONENT = [
  'facCompliance', 'rentCollection', 'auditIntegrity', 'documentBacklog', 'verificationCoverage',
];
export const HEALTH_BAND = ['critical', 'degraded', 'healthy', 'strong'];

export const ROLE_NAMES = [
  'founder', 'hqExecutive', 'backOfficeStaff', 'coordinator', 'vendor', 'landlord',
  'tenant', 'airbnbHost', 'hotelManager', 'resortManager', 'rentalCarCompany',
  'driver', 'rider', 'advertiser', 'publicUser',
];

// ─────────────────────────────────────────────────────────────────────────────
// Envelopes
// ─────────────────────────────────────────────────────────────────────────────

const ENVELOPES: Record<string, JsonSchema> = {
  PageMeta: {
    type: 'object',
    description: 'Pagination metadata returned alongside every list response.',
    properties: {
      page: int({ minimum: 1 }),
      limit: int({ minimum: 1 }),
      total: int({ minimum: 0 }),
      totalPages: int({ minimum: 0 }),
      hasNext: bool(),
      hasPrev: bool(),
    },
    required: ['page', 'limit', 'total', 'totalPages', 'hasNext', 'hasPrev'],
  },

  ErrorResponse: {
    type: 'object',
    description: 'Every failure, in one shape.',
    properties: {
      success: { type: 'boolean', const: false },
      error: {
        type: 'object',
        properties: {
          code: str({
            enum: [
              'BAD_REQUEST', 'VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN',
              'ZONE_RESTRICTED', 'NOT_FOUND', 'CONFLICT', 'DUPLICATE_KEY',
              'UNPROCESSABLE', 'RATE_LIMITED', 'LOCKED', 'POLICY_VIOLATION', 'INTERNAL',
            ],
          }),
          message: str(),
          details: arr({
            type: 'object',
            properties: { field: str(), message: str(), code: str() },
            required: ['message'],
          }),
        },
        required: ['code', 'message'],
      },
    },
    required: ['success', 'error'],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared field groups — mirroring shared/schemaFragments.ts
// ─────────────────────────────────────────────────────────────────────────────

const FRAGMENTS: Record<string, JsonSchema> = {
  ContactFields: {
    type: 'object',
    properties: {
      email: str({ format: 'email' }),
      phone: str({ pattern: '^\\+?[0-9]{7,15}$' }),
      WhatsApp: str({ pattern: '^\\+?[0-9]{7,15}$' }),
      preferredContactMethod: str({ enum: CONTACT_METHOD, default: 'whatsapp' }),
      profilePhoto: str(),
    },
    required: ['email', 'phone'],
  },

  IdentityFields: {
    type: 'object',
    description: 'National identity. Never returned by the API.',
    properties: {
      IDType: str({ enum: ID_TYPE }),
      IDNumber: str({ writeOnly: true }),
      IDPhoto: str({ writeOnly: true }),
      nationalID: str({ writeOnly: true }),
      nationalIDPhoto: str({ writeOnly: true }),
    },
  },

  LocationFields: {
    type: 'object',
    properties: {
      nationality: str(),
      residenceCountry: str({ default: 'Ghana' }),
      address: str(),
      city: str(),
      region: str(),
    },
  },

  EmergencyContactFields: {
    type: 'object',
    properties: {
      emergencyContactName: str(),
      emergencyContactPhone: str({ pattern: '^\\+?[0-9]{7,15}$' }),
      emergencyContactRelationship: str(),
    },
  },

  VerificationFields: {
    type: 'object',
    properties: {
      verificationStatus: str({ enum: VERIFICATION_STATUS, default: 'unsubmitted', readOnly: true }),
      verifiedAt: { ...date(), readOnly: true },
      verifiedBy: { ...oid(), readOnly: true },
      rejectionReason: str({ readOnly: true }),
    },
  },

  LifecycleFields: {
    type: 'object',
    properties: {
      id: { ...oid(), readOnly: true },
      user: oid('Owning User account.'),
      status: str({ enum: LIFECYCLE_STATUS, default: 'active' }),
      deletedAt: { ...date(), nullable: true, readOnly: true, description: 'Set when archived.' },
      createdAt: { ...date(), readOnly: true },
      updatedAt: { ...date(), readOnly: true },
    },
  },

  RatingFields: {
    type: 'object',
    properties: {
      rating: num({ minimum: 0, maximum: 5, readOnly: true }),
      ratingCount: int({ minimum: 0, readOnly: true }),
    },
  },
};

/** Common combinations, so each resource states only what is its own. */
const PROFILE_BASE = [ref('ContactFields'), ref('LocationFields'), ref('LifecycleFields')];
const VERIFIED_PROFILE = [...PROFILE_BASE, ref('VerificationFields')];

// ─────────────────────────────────────────────────────────────────────────────
// Resources
// ─────────────────────────────────────────────────────────────────────────────

const RESOURCES: Record<string, JsonSchema> = {
  Founder: allOf(...PROFILE_BASE, {
    type: 'object',
    description: 'Founder profile — Zone A. The constitutional record of the consortium.',
    properties: {
      fullName: str({ maxLength: 160 }),
      founderTitle: str({ default: 'Founder & Chief Custodian' }),
      bio: str({ maxLength: 5000 }),
      missionStatement: str({ maxLength: 3000 }),
      visionStatement: str({ maxLength: 3000 }),
      coreValues: strArr(),
      policyAuthorityLevel: str({ enum: ['absolute', 'delegatedReview', 'boardRatified'] }),
      regionsOverseen: strArr(),
      serviceLinesOverseen: strArr(),
      systemAccessScope: str({ enum: ['global', 'regional'] }),
      commandZones: strArr(),
      successionContact: str(),
      securityNotes: str({
        writeOnly: true,
        description: 'Never leaves Zone A — select:false and stripped in toJSON.',
      }),
    },
    required: ['fullName', 'email', 'phone'],
  }),

  HQExecutive: allOf(...PROFILE_BASE, {
    type: 'object',
    description: 'HQ executive profile — Zone B. Appointed by the Founder.',
    properties: {
      fullName: str({ maxLength: 160 }),
      executiveTitle: str(),
      portfolio: strArr(),
      regionsOverseen: strArr(),
      serviceLinesOverseen: strArr(),
      zonesVisible: strArr(),
      reportsTo: oid(),
      appointedBy: oid(),
      appointmentDate: date(),
      dashboardPreferences: {
        type: 'object',
        properties: { defaultZone: str(), pinnedKPIs: strArr() },
      },
    },
    required: ['fullName', 'email', 'phone', 'executiveTitle'],
  }),

  BackOfficeStaff: allOf(...VERIFIED_PROFILE, ref('IdentityFields'), ref('EmergencyContactFields'), {
    type: 'object',
    description: 'Back office staff record — Zone C. The HR record for HQ people.',
    properties: {
      fullName: str({ maxLength: 160 }),
      staffNumber: str({ maxLength: 24 }),
      department: str({
        enum: [
          'humanResources', 'coordinatorOps', 'vendorOps', 'driverVerification',
          'commercialOnboarding', 'financeSupport', 'complianceRecords', 'memberSupport',
        ],
      }),
      jobTitle: str(),
      employmentType: str({ enum: ['fullTime', 'partTime', 'contract', 'intern'] }),
      hireDate: date(),
      exitDate: date(),
      reportsTo: oid(),
      desksCovered: strArr(),
      regionsServed: strArr(),
    },
    required: ['fullName', 'email', 'phone', 'staffNumber', 'department', 'jobTitle'],
  }),

  Landlord: allOf(...VERIFIED_PROFILE, ref('IdentityFields'), ref('EmergencyContactFields'), {
    type: 'object',
    description:
      'Landlord profile. `diasporaStatus` is load-bearing: payout currency, statement cadence and escalation all branch on it.',
    properties: {
      fullName: str({ maxLength: 160 }),
      propertiesOwned: arr(oid()),
      diasporaStatus: str({ enum: DIASPORA_STATUS, default: 'resident' }),
      payoutMethod: str({ enum: PAYMENT_METHOD, default: 'bankTransfer' }),
      payoutAccountRef: str({ writeOnly: true }),
      payoutCurrency: str({ enum: CURRENCY, default: 'GMD' }),
      managementFeePercent: num({ minimum: 0, maximum: 100, default: 10 }),
      statementFrequency: str({ enum: ['monthly', 'quarterly', 'annually'] }),
    },
    required: ['fullName', 'email', 'phone'],
  }),

  Tenant: allOf(...VERIFIED_PROFILE, ref('IdentityFields'), ref('EmergencyContactFields'), {
    type: 'object',
    description: 'Tenant profile. Lease fields are optional at creation — Back Office often onboards a tenant before the lease is signed.',
    properties: {
      fullName: str({ maxLength: 160 }),
      occupation: str(),
      employerName: str(),
      employerContact: str(),
      monthlyIncome: num({ minimum: 0, writeOnly: true }),
      property: oid(),
      unitLabel: str(),
      leaseStart: date(),
      leaseEnd: date(),
      monthlyRent: num({ minimum: 0 }),
      rentCurrency: str({ enum: CURRENCY, default: 'GMD' }),
      securityDeposit: num({ minimum: 0 }),
      paymentMethod: str({ enum: PAYMENT_METHOD, default: 'mobileMoney' }),
      rentDueDay: int({ minimum: 1, maximum: 31, default: 1 }),
      complianceScore: num({ minimum: 0, maximum: 100, readOnly: true }),
      onTimePaymentRate: num({ minimum: 0, maximum: 100, readOnly: true }),
      engagementScore: num({ minimum: 0, maximum: 100, readOnly: true }),
      leaseDaysRemaining: int({ readOnly: true, nullable: true }),
    },
    required: ['fullName', 'email', 'phone'],
  }),

  Coordinator: allOf(...VERIFIED_PROFILE, ref('IdentityFields'), ref('RatingFields'), {
    type: 'object',
    description: 'Coordinator profile — the LRMC field officer. `areasCovered` is what confines them.',
    properties: {
      fullName: str({ maxLength: 160 }),
      areasCovered: strArr(),
      assignedProperties: arr(oid()),
      skills: strArr(),
      languages: strArr(),
      availabilitySchedule: str(),
      availabilityWindows: arr({
        type: 'object',
        properties: {
          day: str({ enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }),
          from: str({ pattern: '^\\d{2}:\\d{2}$' }),
          to: str({ pattern: '^\\d{2}:\\d{2}$' }),
        },
        required: ['day', 'from', 'to'],
      }),
      completedTasks: int({ minimum: 0, readOnly: true }),
      openTasks: int({ minimum: 0, readOnly: true }),
      onTimeCompletionRate: num({ minimum: 0, maximum: 100, readOnly: true }),
      employmentType: str({ enum: ['staff', 'contract', 'volunteer'] }),
      startDate: date(),
    },
    required: ['fullName', 'email', 'phone'],
  }),

  Vendor: allOf(...VERIFIED_PROFILE, ref('IdentityFields'), ref('RatingFields'), {
    type: 'object',
    description: 'Vendor profile — service provider for LRMC properties and Ususu fleets.',
    properties: {
      fullName: str({ maxLength: 160 }),
      businessName: str({ maxLength: 200 }),
      serviceType: str({
        enum: [
          'plumbing', 'electrical', 'carpentry', 'masonry', 'painting', 'cleaning',
          'landscaping', 'pestControl', 'security', 'hvac', 'appliance', 'roofing',
          'generalMaintenance', 'vehicleMaintenance', 'other',
        ],
      }),
      secondaryServiceTypes: strArr(),
      areasCovered: strArr(),
      skills: strArr(),
      toolsAvailable: strArr(),
      serviceRates: str(),
      rateCard: arr({
        type: 'object',
        properties: {
          item: str(),
          unit: str({ default: 'job' }),
          amount: num({ minimum: 0 }),
          currency: str({ enum: CURRENCY }),
        },
        required: ['item', 'amount'],
      }),
      completedJobs: int({ minimum: 0, readOnly: true }),
      openJobs: int({ minimum: 0, readOnly: true }),
      averageResponseHours: num({ minimum: 0 }),
      businessRegistrationNumber: str(),
      taxIdentificationNumber: str({ writeOnly: true }),
      insured: bool(),
    },
    required: ['fullName', 'email', 'phone', 'businessName', 'serviceType'],
  }),

  Driver: allOf(...VERIFIED_PROFILE, ref('IdentityFields'), ref('EmergencyContactFields'), ref('RatingFields'), {
    type: 'object',
    description:
      'Ususu driver. Licence and insurance expiry are first-class so the verification queue can be driven off them.',
    properties: {
      fullName: str({ maxLength: 160 }),
      driverLicenseNumber: str({ writeOnly: true }),
      driverLicensePhoto: str({ writeOnly: true }),
      driverLicenseExpiry: date(),
      vehicleType: str({
        enum: ['sedan', 'hatchback', 'suv', 'minivan', 'pickup', 'motorcycle', 'tricycle', 'bus', 'luxury'],
      }),
      vehicleMake: str(),
      vehicleModel: str(),
      vehicleYear: int({ minimum: 1970 }),
      vehicleColor: str(),
      vehiclePlate: str(),
      vehiclePhotos: strArr(),
      insurancePhoto: str({ writeOnly: true }),
      insuranceExpiry: date(),
      roadworthyExpiry: date(),
      ownedBy: oid('Rental car company operating this vehicle, if any.'),
      areasCovered: strArr(),
      completedRides: int({ minimum: 0, readOnly: true }),
      cancelledRides: int({ minimum: 0, readOnly: true }),
      acceptanceRate: num({ minimum: 0, maximum: 100, readOnly: true }),
      isOnline: { ...bool(), readOnly: true },
      lastOnlineAt: { ...date(), readOnly: true },
      payoutMethod: str({ enum: PAYMENT_METHOD }),
      payoutAccountRef: str({ writeOnly: true }),
      documentsCurrent: { ...bool(), readOnly: true },
      dispatchable: {
        ...bool(),
        readOnly: true,
        description: 'verified AND active AND licence/insurance unexpired.',
      },
    },
    required: ['fullName', 'email', 'phone', 'vehicleType'],
  }),

  Rider: allOf(ref('ContactFields'), ref('LifecycleFields'), ref('RatingFields'), ref('EmergencyContactFields'), {
    type: 'object',
    description:
      'Ususu rider — deliberately the lightest profile. No ID, no verification: signup friction is the enemy of a rideshare marketplace.',
    properties: {
      fullName: str({ maxLength: 160 }),
      preferredPaymentMethod: str({ enum: PAYMENT_METHOD, default: 'mobileMoney' }),
      savedPlaces: arr({
        type: 'object',
        properties: {
          label: str({ maxLength: 60 }),
          address: str({ maxLength: 400 }),
          longitude: num({ minimum: -180, maximum: 180 }),
          latitude: num({ minimum: -90, maximum: 90 }),
        },
        required: ['label', 'address'],
      }),
      rideHistory: { ...arr(oid()), readOnly: true },
      completedRides: int({ minimum: 0, readOnly: true }),
      cancelledRides: int({ minimum: 0, readOnly: true }),
    },
    required: ['fullName', 'email', 'phone'],
  }),

  AirbnbHost: allOf(...VERIFIED_PROFILE, ref('IdentityFields'), ref('EmergencyContactFields'), ref('RatingFields'), {
    type: 'object',
    description: 'Airbnb host — commercial client. Named vendors let a same-day turnover run without a human picking one.',
    properties: {
      businessName: str({ maxLength: 200 }),
      contactPerson: str({ maxLength: 160 }),
      unitsManaged: arr(oid()),
      cleaningVendors: arr(oid()),
      maintenanceVendors: arr(oid()),
      assignedCoordinator: oid(),
      checkInInstructions: str({ maxLength: 4000 }),
      checkOutInstructions: str({ maxLength: 4000 }),
      turnoverWindowHours: int({ minimum: 1, maximum: 72, default: 4 }),
      platformListingUrls: arr(str({ format: 'uri' })),
      contractStart: date(),
      contractEnd: date(),
      serviceTier: str({ enum: SERVICE_TIER }),
      unitCount: int({ readOnly: true }),
    },
    required: ['businessName', 'contactPerson', 'email', 'phone'],
  }),

  Hotel: allOf(...VERIFIED_PROFILE, ref('EmergencyContactFields'), ref('RatingFields'), {
    type: 'object',
    description: 'Hotel — commercial client.',
    properties: {
      hotelName: str({ maxLength: 200 }),
      managerName: str({ maxLength: 160 }),
      starRating: int({ minimum: 1, maximum: 5 }),
      roomCount: int({ minimum: 0 }),
      roomsManaged: arr(oid()),
      staffList: arr(ref('StaffMember')),
      maintenanceVendors: arr(oid()),
      cleaningVendors: arr(oid()),
      assignedCoordinator: oid(),
      reportingPreferences: str({ maxLength: 2000 }),
      reportingFrequency: str({ enum: REPORTING_FREQUENCY }),
      contractStart: date(),
      contractEnd: date(),
      serviceTier: str({ enum: SERVICE_TIER }),
      businessRegistrationNumber: str(),
    },
    required: ['hotelName', 'managerName', 'email', 'phone'],
  }),

  Resort: allOf(...VERIFIED_PROFILE, ref('EmergencyContactFields'), ref('RatingFields'), {
    type: 'object',
    description: 'Resort — commercial client. Villas plus amenities under service.',
    properties: {
      resortName: str({ maxLength: 200 }),
      managerName: str({ maxLength: 160 }),
      villasManaged: arr(oid()),
      villaCount: int({ minimum: 0 }),
      amenitiesManaged: arr(
        str({
          enum: [
            'pool', 'spa', 'gym', 'restaurant', 'bar', 'beachAccess', 'conferenceRooms',
            'golfCourse', 'kidsClub', 'waterSports', 'shuttle', 'generator', 'borehole',
          ],
        }),
      ),
      staffList: arr(ref('StaffMember')),
      maintenanceVendors: arr(oid()),
      cleaningVendors: arr(oid()),
      assignedCoordinator: oid(),
      reportingPreferences: str({ maxLength: 2000 }),
      reportingFrequency: str({ enum: REPORTING_FREQUENCY }),
      contractStart: date(),
      contractEnd: date(),
      serviceTier: str({ enum: SERVICE_TIER }),
      businessRegistrationNumber: str(),
    },
    required: ['resortName', 'managerName', 'email', 'phone'],
  }),

  StaffMember: {
    type: 'object',
    properties: { fullName: str({ maxLength: 160 }), role: str({ maxLength: 120 }), phone: str() },
    required: ['fullName', 'role'],
  },

  FleetVehicle: {
    type: 'object',
    properties: {
      plate: str({ maxLength: 16 }),
      vehicleType: str({
        enum: ['sedan', 'hatchback', 'suv', 'minivan', 'pickup', 'motorcycle', 'tricycle', 'bus', 'luxury'],
      }),
      make: str(),
      model: str(),
      year: int({ minimum: 1970 }),
      color: str(),
      vin: str({ writeOnly: true }),
      dailyRate: num({ minimum: 0 }),
      currency: str({ enum: CURRENCY }),
      insuranceProvider: str(),
      insuranceExpiry: date(),
      roadworthyExpiry: date(),
      odometerKm: num({ minimum: 0 }),
      assignedDriver: oid(),
      availability: str({ enum: ['available', 'rented', 'maintenance', 'retired'] }),
    },
    required: ['plate', 'vehicleType'],
  },

  RentalCarCompany: allOf(...VERIFIED_PROFILE, ref('RatingFields'), {
    type: 'object',
    description:
      'Rental car company — the bridge between LRMC vendor discipline and Ususu supply. `fleet` is embedded: a vehicle has no meaning outside its owning company.',
    properties: {
      companyName: str({ maxLength: 200 }),
      managerName: str({ maxLength: 160 }),
      fleet: arr(ref('FleetVehicle')),
      insuranceProviders: strArr(),
      maintenanceVendors: arr(oid()),
      rentalRates: str({ maxLength: 2000 }),
      reportingPreferences: str({ maxLength: 2000 }),
      reportingFrequency: str({ enum: REPORTING_FREQUENCY }),
      businessRegistrationNumber: str(),
      serviceTier: str({ enum: SERVICE_TIER }),
      suppliesUsusu: bool(),
      contractStart: date(),
      contractEnd: date(),
      fleetSize: int({ readOnly: true }),
      utilizationPercent: num({ readOnly: true }),
    },
    required: ['companyName', 'managerName', 'email', 'phone'],
  }),

  Property: allOf(ref('LocationFields'), ref('LifecycleFields'), {
    type: 'object',
    description:
      'One collection serves rentals, short-lets, hotel rooms and resort villas via a polymorphic owner.',
    properties: {
      reference: str({ readOnly: true, description: 'Auto-generated: LRMC-<REGION>-<6 hex>.' }),
      title: str({ maxLength: 240 }),
      propertyType: str({
        enum: [
          'singleFamily', 'apartment', 'compoundHouse', 'townhouse', 'duplex', 'studio',
          'shortLetUnit', 'hotelRoom', 'resortVilla', 'commercialSpace', 'land',
        ],
      }),
      ownerKind: str({
        enum: ['LandlordProfile', 'AirbnbHostProfile', 'HotelProfile', 'ResortProfile'],
      }),
      owner: oid(),
      assignedCoordinator: oid(),
      currentTenant: oid(),
      digitalAddress: str(),
      bedrooms: int({ minimum: 0 }),
      bathrooms: num({ minimum: 0 }),
      floorAreaSqm: num({ minimum: 0 }),
      furnished: bool(),
      amenities: strArr(),
      photos: strArr(),
      rentAmount: num({ minimum: 0 }),
      rentCurrency: str({ enum: CURRENCY }),
      rentPeriod: str({ enum: ['monthly', 'nightly', 'yearly'] }),
      occupancyStatus: str({ enum: ['vacant', 'occupied', 'maintenance', 'offMarket'] }),
      listedPublicly: bool(),
      lastInspectionAt: date(),
      nextInspectionDue: date(),
    },
    required: ['title', 'propertyType', 'ownerKind', 'owner'],
  }),

  PublicListing: {
    type: 'object',
    description:
      'The public projection of a Property. Named explicitly rather than filtered by omission — a public endpoint should state what it reveals.',
    properties: {
      reference: str(),
      title: str(),
      propertyType: str(),
      city: str(),
      region: str(),
      bedrooms: int(),
      bathrooms: num(),
      floorAreaSqm: num(),
      furnished: bool(),
      amenities: strArr(),
      photos: strArr(),
      rentAmount: num(),
      rentCurrency: str(),
      rentPeriod: str(),
    },
  },

  Advertiser: allOf(...VERIFIED_PROFILE, {
    type: 'object',
    description: 'The advertiser account — separate from the creative. Billing and standing attach here, not to the image.',
    properties: {
      advertiserName: str({ maxLength: 200 }),
      contactPerson: str({ maxLength: 160 }),
      businessType: str({
        enum: [
          'realEstate', 'construction', 'financialServices', 'telecom', 'retail',
          'hospitality', 'transport', 'automotive', 'healthcare', 'education',
          'agriculture', 'government', 'ngo', 'other',
        ],
      }),
      website: str({ format: 'uri' }),
      logo: str(),
      billingCurrency: str({ enum: CURRENCY }),
      creditLimit: num({ minimum: 0, readOnly: true, description: 'Founder-set.' }),
      outstandingBalance: num({ readOnly: true }),
      totalSpend: num({ minimum: 0, readOnly: true }),
      agreedCPM: num({ minimum: 0, readOnly: true, description: 'Founder-set.' }),
      agreedCPC: num({ minimum: 0, readOnly: true, description: 'Founder-set.' }),
      policyStandings: {
        type: 'object',
        readOnly: true,
        properties: { strikes: int({ minimum: 0 }), lastStrikeAt: date() },
      },
      inGoodStanding: { ...bool(), readOnly: true },
    },
    required: ['advertiserName', 'email', 'phone', 'businessType'],
  }),

  Ad: allOf(ref('LifecycleFields'), {
    type: 'object',
    description:
      'The creative and its serving rules. `rotationWeight` is the advertiser\'s *requested* share; what actually serves is that weight adjusted by tier, category, daypart and pacing.',
    properties: {
      advertiser: oid('The owning AdvertiserProfile.'),
      advertiserName: str(),
      title: str({ maxLength: 200 }),
      adImage: str(),
      adImageAltText: str({ maxLength: 300 }),
      adLink: str({ format: 'uri' }),
      adCategory: str({
        enum: [
          'property', 'construction', 'homeServices', 'finance', 'insurance', 'telecom',
          'retail', 'travel', 'automotive', 'mobility', 'hospitality', 'health',
          'education', 'agriculture', 'publicNotice', 'houseAd',
        ],
      }),
      placements: arr(
        str({
          enum: [
            'heroBanner', 'sidebar', 'inFeed', 'footer', 'interstitial',
            'ususuMapCard', 'memberDashboardTile',
          ],
        }),
      ),
      targetZones: arr(str({ enum: ['PUBLIC_PORTAL', 'MEMBER_PORTAL', 'USUSU_PORTAL'] })),
      targetRegions: strArr(),
      targetRoles: strArr(),
      startDate: date(),
      endDate: date(),
      dayParts: arr(int({ minimum: 0, maximum: 23 })),
      daysOfWeek: arr(int({ minimum: 0, maximum: 6 })),
      rotationWeight: num({ minimum: 0, maximum: 1000, default: 10 }),
      priorityTier: int({ minimum: 0, maximum: 10, default: 1 }),
      impressionCap: int({ minimum: 1 }),
      clickCap: int({ minimum: 1 }),
      dailyImpressionCap: int({ minimum: 1 }),
      budgetAmount: num({ minimum: 0 }),
      budgetCurrency: str({ enum: CURRENCY }),
      spend: num({ minimum: 0, readOnly: true }),
      impressions: int({ minimum: 0, readOnly: true }),
      clicks: int({ minimum: 0, readOnly: true }),
      ctr: num({ readOnly: true, description: 'Percentage, two decimals.' }),
      isLive: { ...bool(), readOnly: true },
      status: str({
        readOnly: true,
        enum: ['draft', 'pendingReview', 'approved', 'active', 'paused', 'rejected', 'expired', 'exhausted', 'archived'],
        description: 'Moved via /ad/{adId}/submit, /status and /review — never written directly.',
      }),
      reviewedBy: { ...oid(), readOnly: true },
      reviewedAt: { ...date(), readOnly: true },
      rejectionReason: str({ readOnly: true }),
    },
    required: ['advertiser', 'title', 'adImage', 'adLink', 'adCategory', 'startDate', 'endDate'],
  }),

  ServedAd: {
    type: 'object',
    description: 'One rotated placement, as returned to a rendering surface.',
    properties: {
      id: oid(),
      advertiser: oid(),
      advertiserName: str(),
      title: str(),
      adImage: str(),
      adImageAltText: str(),
      adLink: str({ format: 'uri' }),
      adCategory: str(),
      placement: str(),
      zone: str({ enum: ['PUBLIC_PORTAL', 'MEMBER_PORTAL', 'USUSU_PORTAL'] }),
      effectiveWeight: num({ description: 'Weight actually used in the draw, after policy and pacing.' }),
      beacon: str({ description: 'Opaque token returned with the impression/click beacon.' }),
    },
    required: ['id', 'adImage', 'adLink', 'beacon'],
  },

  AdPolicy: {
    type: 'object',
    description: 'Founder-owned, versioned and never edited in place.',
    properties: {
      id: { ...oid(), readOnly: true },
      version: { ...int({ minimum: 1 }), readOnly: true },
      isActive: { ...bool(), readOnly: true },
      effectiveFrom: date(),
      currency: str({ enum: CURRENCY }),
      pricing: arr({
        type: 'object',
        properties: { placement: str(), cpm: num({ minimum: 0 }), cpc: num({ minimum: 0 }), flatMonthly: num({ minimum: 0 }) },
        required: ['placement'],
      }),
      categoryWeightMultipliers: arr({
        type: 'object',
        properties: { category: str(), multiplier: num({ minimum: 0, maximum: 10 }) },
        required: ['category', 'multiplier'],
      }),
      dayPartMultipliers: arr({
        type: 'object',
        properties: { hour: int({ minimum: 0, maximum: 23 }), multiplier: num({ minimum: 0, maximum: 10 }) },
        required: ['hour', 'multiplier'],
      }),
      zoneSlotCounts: arr({
        type: 'object',
        properties: { zone: str(), slots: int({ minimum: 0, maximum: 20 }) },
        required: ['zone', 'slots'],
      }),
      bannedCategories: strArr(),
      houseAdOnlyZones: strArr(),
      maxAdvertiserSharePercent: num({ minimum: 1, maximum: 100, default: 40 }),
      pacingEnabled: bool(),
      requireReviewBeforeServing: bool(),
      minRotationWeight: num({ minimum: 0 }),
      maxRotationWeight: num({ minimum: 1 }),
      notes: str({ maxLength: 4000 }),
      authoredBy: { ...oid(), readOnly: true },
      ratifiedBy: { ...oid(), readOnly: true },
      createdAt: { ...date(), readOnly: true },
    },
  },

  AdReport: {
    type: 'object',
    properties: {
      from: date(),
      to: date(),
      zone: str(),
      totals: {
        type: 'object',
        properties: { impressions: int(), clicks: int(), ctr: num(), activeAds: int() },
      },
      byAd: arr({
        type: 'object',
        properties: {
          adId: oid(), title: str(), advertiserName: str(), category: str(),
          impressions: int(), clicks: int(), ctr: num(),
        },
      }),
      byZone: arr({
        type: 'object',
        properties: { zone: str(), impressions: int(), clicks: int(), ctr: num() },
      }),
      byCategory: arr({
        type: 'object',
        properties: { category: str(), impressions: int(), clicks: int(), ctr: num() },
      }),
    },
  },

  PublicContent: allOf(ref('LifecycleFields'), {
    type: 'object',
    properties: {
      slug: str({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
      contentType: str({
        enum: ['page', 'article', 'announcement', 'faq', 'testimonial', 'servicePage', 'pressRelease'],
      }),
      title: str({ maxLength: 240 }),
      excerpt: str({ maxLength: 600 }),
      body: str(),
      heroImage: str(),
      domains: strArr(),
      locale: str({ default: 'en' }),
      tags: strArr(),
      publishedAt: date(),
      isPublished: bool(),
      views: int({ minimum: 0, readOnly: true }),
      seoTitle: str({ maxLength: 200 }),
      seoDescription: str({ maxLength: 400 }),
    },
    required: ['slug', 'contentType', 'title'],
  }),

  AuditLogEntry: {
    type: 'object',
    description: 'Append-only. Updates and deletes are blocked at the schema level.',
    properties: {
      id: oid(),
      actor: oid(),
      actorEmail: str({ format: 'email' }),
      actorRoles: strArr(),
      action: str(),
      resource: str(),
      resourceId: str(),
      zone: str(),
      method: str(),
      path: str(),
      statusCode: int(),
      requestId: str(),
      ip: str(),
      userAgent: str(),
      createdAt: date(),
    },
  },

  // ── Auth ─────────────────────────────────────────────────────────────────
  AuthTokens: {
    type: 'object',
    properties: {
      accessToken: str(),
      refreshToken: str(),
      user: {
        type: 'object',
        properties: {
          id: oid(),
          fullName: str(),
          email: str({ format: 'email' }),
          roles: strArr(),
          primaryRole: str(),
          isVerified: bool(),
          status: str(),
          profileId: oid(),
          accessScope: str({ enum: ['global', 'regional', 'zonal', 'organizational', 'own', 'public'] }),
          allowedZones: strArr(),
          allowedActions: strArr(),
        },
      },
    },
    required: ['accessToken', 'refreshToken', 'user'],
  },

  RegisterRequest: {
    type: 'object',
    properties: {
      fullName: str({ minLength: 2, maxLength: 160 }),
      email: str({ format: 'email' }),
      phone: str({ pattern: '^\\+?[0-9]{7,15}$' }),
      WhatsApp: str(),
      password: str({
        minLength: 10,
        description: 'At least 10 characters, with upper case, lower case and a digit.',
      }),
      role: str({
        enum: [
          'tenant', 'landlord', 'rider', 'driver', 'vendor', 'advertiser',
          'airbnbHost', 'hotelManager', 'resortManager', 'rentalCarCompany', 'publicUser',
        ],
        description:
          'Only self-registerable roles. founder, hqExecutive, backOfficeStaff and coordinator are appointed in Zone A.',
      }),
      businessName: str({ description: 'Required for organisational roles.' }),
      region: str(),
      vehicleType: str({ description: 'Ususu drivers.' }),
      serviceType: str({ description: 'Vendors.' }),
      businessType: str({ description: 'Advertisers.' }),
    },
    required: ['fullName', 'email', 'phone', 'password', 'role'],
  },

  LoginRequest: {
    type: 'object',
    properties: { email: str({ format: 'email' }), password: str() },
    required: ['email', 'password'],
  },

  CurrentActor: {
    type: 'object',
    description: 'Everything a frontend needs on boot: identity, grants, zones, actions.',
    properties: {
      user: { type: 'object', nullable: true },
      authorization: {
        type: 'object',
        properties: {
          accessScope: str(),
          grants: strArr(),
          allowedZones: strArr(),
          restrictedZones: strArr(),
          allowedActions: strArr(),
        },
      },
      zones: arr({ type: 'object' }),
    },
  },

  VerificationRequest: {
    type: 'object',
    properties: {
      status: str({ enum: ['pending', 'inReview', 'verified', 'rejected', 'suspended'] }),
      note: str({ maxLength: 2000, description: 'Required when rejecting.' }),
    },
    required: ['status'],
  },


  // ── Operations: leases, maintenance, rides, payments ─────────────────────

  Lease: allOf(ref('LifecycleFields'), {
    type: 'object',
    description:
      'Binds a tenant to a property for a term, at a rent. A separate collection from the tenant profile because a tenant has a history of leases and the rent ledger hangs off the lease.',
    properties: {
      reference: str({ readOnly: true, description: 'Auto-generated: LSE-<6 hex>.' }),
      property: oid(),
      tenant: oid(),
      landlord: oid(),
      coordinator: oid(),
      leaseStart: date(),
      leaseEnd: date(),
      monthlyRent: num({ minimum: 0 }),
      currency: str({ enum: CURRENCY, default: 'GMD' }),
      paymentDayOfMonth: int({ minimum: 1, maximum: 31, default: 1 }),
      securityDeposit: num({ minimum: 0 }),
      depositHeldBy: str({ enum: ['LRMC', 'landlord', 'escrow'] }),
      paymentMethod: str({ enum: PAYMENT_METHOD }),
      totalPaid: num({ minimum: 0, readOnly: true }),
      arrearsAmount: num({ minimum: 0, readOnly: true }),
      lastPaymentAt: { ...date(), readOnly: true },
      nextDueDate: date(),
      renewalOption: bool(),
      noticePeriodDays: int({ minimum: 0 }),
      documentUrl: str(),
      signedByTenantAt: date(),
      signedByLandlordAt: date(),
      terminationReason: str(),
      daysRemaining: int({ readOnly: true, nullable: true }),
      isInArrears: { ...bool(), readOnly: true },
      status: str({
        enum: ['draft', 'pendingSignature', 'active', 'inArrears', 'expiring', 'completed', 'terminated'],
      }),
    },
    required: ['property', 'tenant', 'landlord', 'leaseStart', 'leaseEnd', 'monthlyRent'],
  }),

  LeaseList: arr(ref('Lease')),

  RecordRentPaymentRequest: {
    type: 'object',
    description: 'Records a rent payment and rolls the lease totals forward in the same request.',
    properties: {
      amount: num({ minimum: 0 }),
      currency: str({ enum: CURRENCY }),
      method: str({ enum: PAYMENT_METHOD }),
      paidAt: date(),
      providerReference: str({ writeOnly: true }),
      notes: str({ maxLength: 2000 }),
    },
    required: ['amount'],
  },

  MaintenanceStatusEntry: {
    type: 'object',
    properties: { status: str(), at: date(), by: oid(), note: str() },
    required: ['status', 'at'],
  },

  MaintenanceRequest: allOf(ref('LifecycleFields'), {
    type: 'object',
    description:
      'A work order against a property. `statusHistory` is append-only, because the question after a disputed invoice is always who moved this and when.',
    properties: {
      reference: str({ readOnly: true, description: 'Auto-generated: MNT-<6 hex>.' }),
      property: oid(),
      raisedBy: oid(),
      raisedByKind: str(),
      title: str({ maxLength: 240 }),
      description: str({ maxLength: 5000 }),
      serviceType: str({
        enum: [
          'plumbing', 'electrical', 'carpentry', 'masonry', 'painting', 'cleaning',
          'landscaping', 'pestControl', 'security', 'hvac', 'appliance', 'roofing',
          'generalMaintenance', 'vehicleMaintenance', 'other',
        ],
      }),
      priority: str({ enum: ['low', 'normal', 'high', 'emergency'], default: 'normal' }),
      assignedVendor: oid(),
      assignedCoordinator: oid(),
      assignedAt: { ...date(), readOnly: true },
      quotedAmount: num({ minimum: 0 }),
      approvedAmount: num({ minimum: 0 }),
      finalAmount: num({ minimum: 0 }),
      currency: str({ enum: CURRENCY }),
      approvedBy: { ...oid(), readOnly: true },
      approvedAt: { ...date(), readOnly: true },
      photosBefore: strArr(),
      photosAfter: strArr(),
      scheduledFor: date(),
      startedAt: date(),
      completedAt: date(),
      verifiedAt: date(),
      resolutionHours: num({ minimum: 0, readOnly: true }),
      slaHours: int({ minimum: 1, default: 72 }),
      tenantRating: int({ minimum: 1, maximum: 5 }),
      statusHistory: { ...arr(ref('MaintenanceStatusEntry')), readOnly: true },
      isOverdue: { ...bool(), readOnly: true },
      status: str({
        enum: [
          'open', 'triaged', 'assigned', 'quoted', 'approved',
          'inProgress', 'onHold', 'completed', 'verified', 'cancelled',
        ],
      }),
    },
    required: ['property', 'title', 'serviceType'],
  }),

  MaintenanceRequestList: arr(ref('MaintenanceRequest')),

  AssignVendorRequest: {
    type: 'object',
    description: 'Only a verified vendor may be assigned.',
    properties: { vendorId: oid(), scheduledFor: date(), note: str({ maxLength: 1000 }) },
    required: ['vendorId'],
  },

  Ride: allOf(ref('LifecycleFields'), {
    type: 'object',
    description:
      'One Ususu trip. The lifecycle is a strict forward march — the state machine is declared alongside the model and every transition is checked against it.',
    properties: {
      reference: str({ readOnly: true, description: 'Auto-generated: RID-<6 hex>.' }),
      rider: oid(),
      driver: oid(),
      pickupAddress: str({ maxLength: 400 }),
      pickupLongitude: num({ minimum: -180, maximum: 180 }),
      pickupLatitude: num({ minimum: -90, maximum: 90 }),
      dropoffAddress: str({ maxLength: 400 }),
      dropoffLongitude: num({ minimum: -180, maximum: 180 }),
      dropoffLatitude: num({ minimum: -90, maximum: 90 }),
      region: str(),
      vehicleType: str({
        enum: ['sedan', 'hatchback', 'suv', 'minivan', 'pickup', 'motorcycle', 'tricycle', 'bus', 'luxury'],
      }),
      estimatedDistanceKm: num({ minimum: 0 }),
      estimatedDurationMin: num({ minimum: 0 }),
      estimatedFare: num({ minimum: 0 }),
      finalFare: num({ minimum: 0, readOnly: true }),
      currency: str({ enum: CURRENCY }),
      platformCommission: num({ minimum: 0, maximum: 100, description: 'Percentage withheld.' }),
      driverEarnings: num({ minimum: 0, readOnly: true }),
      paymentMethod: str({ enum: PAYMENT_METHOD }),
      payment: { ...oid(), readOnly: true },
      requestedAt: { ...date(), readOnly: true },
      acceptedAt: { ...date(), readOnly: true },
      arrivedAt: { ...date(), readOnly: true },
      startedAt: { ...date(), readOnly: true },
      completedAt: { ...date(), readOnly: true },
      cancelledAt: { ...date(), readOnly: true },
      cancellationReason: str({ readOnly: true }),
      riderRating: int({ minimum: 1, maximum: 5 }),
      driverRating: int({ minimum: 1, maximum: 5 }),
      notes: str({ maxLength: 2000 }),
      isTerminal: { ...bool(), readOnly: true },
      status: str({
        readOnly: true,
        enum: [
          'requested', 'searching', 'accepted', 'arriving', 'inProgress',
          'completed', 'cancelledByRider', 'cancelledByDriver', 'expired',
        ],
        description: 'Moved only by the lifecycle endpoints, never written directly.',
      }),
    },
    required: ['rider', 'pickupAddress', 'dropoffAddress'],
  }),

  RideList: arr(ref('Ride')),

  RequestRideRequest: {
    type: 'object',
    description: 'The rider states where and when. Fare and driver are the server\'s to decide.',
    properties: {
      pickupAddress: str({ maxLength: 400 }),
      pickupLongitude: num({ minimum: -180, maximum: 180 }),
      pickupLatitude: num({ minimum: -90, maximum: 90 }),
      dropoffAddress: str({ maxLength: 400 }),
      dropoffLongitude: num({ minimum: -180, maximum: 180 }),
      dropoffLatitude: num({ minimum: -90, maximum: 90 }),
      region: str(),
      vehicleType: str(),
      paymentMethod: str({ enum: PAYMENT_METHOD }),
      estimatedDistanceKm: num({ minimum: 0 }),
      estimatedDurationMin: num({ minimum: 0 }),
      notes: str({ maxLength: 2000 }),
    },
    required: ['pickupAddress', 'dropoffAddress'],
  },

  AcceptRideRequest: {
    type: 'object',
    properties: { etaMinutes: int({ minimum: 0, maximum: 120 }) },
  },

  StartRideRequest: {
    type: 'object',
    properties: { startedAt: date() },
  },

  CompleteRideRequest: {
    type: 'object',
    description: 'Stamps the fare, splits the commission and writes the ledger row.',
    properties: {
      finalFare: num({ minimum: 0 }),
      currency: str({ enum: CURRENCY }),
      distanceKm: num({ minimum: 0 }),
      durationMin: num({ minimum: 0 }),
      notes: str({ maxLength: 2000 }),
    },
    required: ['finalFare'],
  },

  CancelRideRequest: {
    type: 'object',
    properties: { reason: str({ maxLength: 500 }) },
    required: ['reason'],
  },

  UpdateRideRequest: {
    type: 'object',
    properties: { driver: oid(), region: str(), notes: str(), estimatedFare: num({ minimum: 0 }) },
  },

  Payment: allOf(ref('LifecycleFields'), {
    type: 'object',
    description:
      'One ledger for every movement of money — rent, fares, payouts, ad spend, vendor invoices. Read-only over HTTP: rows are written by the flows that cause them.',
    properties: {
      reference: str({ readOnly: true, description: 'Auto-generated: PAY-<6 hex>.' }),
      kind: str({
        enum: [
          'rent', 'deposit', 'ride', 'driverPayout', 'landlordPayout',
          'adSpend', 'vendorInvoice', 'managementFee', 'refund',
        ],
      }),
      subjectKind: str({ enum: ['Lease', 'Ride', 'Ad', 'MaintenanceRequest'] }),
      subject: oid(),
      payer: oid(),
      payerKind: str(),
      payee: oid(),
      payeeKind: str(),
      amount: num({ minimum: 0 }),
      currency: str({ enum: CURRENCY }),
      method: str({ enum: PAYMENT_METHOD }),
      platformFee: num({ minimum: 0 }),
      netAmount: num({ minimum: 0, readOnly: true }),
      providerReference: str({ writeOnly: true, description: 'Identifies the payment instrument. Never returned.' }),
      providerName: str(),
      paidAt: date(),
      failureReason: str(),
      receiptUrl: str(),
      notes: str({ maxLength: 2000 }),
      status: str({
        enum: ['pending', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled'],
      }),
    },
    required: ['kind', 'amount'],
  }),

  PaymentList: arr(ref('Payment')),

  /**
   * One person's payment record, summarised.
   *
   * `onTimeRate` is nullable and that is load-bearing — see the endpoint's own
   * notes, and `paymentRules.ts` for why this figure differs from the
   * `paymentReliability` an assessment shows.
   */
  PaymentSummary: {
    type: 'object',
    properties: {
      total: int({ minimum: 0 }),
      settled: int({ minimum: 0 }),
      onTime: int({ minimum: 0 }),
      late: int({ minimum: 0 }),
      failed: int({ minimum: 0 }),
      awaiting: int({ minimum: 0, description: 'Raised, not yet settled. Excluded from every rate.' }),
      onTimeRate: {
        type: ['number', 'null'], minimum: 0, maximum: 100,
        description:
          '(onTime / (onTime + late)) * 100. NULL when nothing has settled — never 0, which would tell somebody on their first day that none of their payments were on time. Not the same as `paymentReliability` in an assessment, which counts missed instalments too.',
      },
      settledByCurrency: {
        type: 'array',
        description:
          'One entry per currency, deliberately not summed. There is no exchange rate on this platform, so a single total would not be an amount of anything.',
        items: {
          type: 'object',
          properties: {
            currency: str({ enum: CURRENCY }),
            amount: { type: 'number', minimum: 0 },
            payments: int({ minimum: 0 }),
          },
          required: ['currency', 'amount', 'payments'],
        },
      },
      scope: str({
        enum: ['all', 'recordedByMe'],
        description: 'Whose rows these totals cover.',
      }),
      partial: bool({
        description:
          'True when the totals cover only part of the person\'s history — a coordinator seeing their own receipts. Say so on screen; a partial total read as a whole one is worse than no total.',
      }),
    },
    required: ['total', 'settled', 'onTime', 'late', 'onTimeRate', 'settledByCurrency', 'scope', 'partial'],
  },

  /** One person's maintenance, summarised. Same buckets as `/stats/maintenance`. */
  MaintenanceSummary: {
    type: 'object',
    properties: {
      total: int({ minimum: 0 }),
      open: int({ minimum: 0 }),
      inProgress: int({ minimum: 0 }),
      completed: int({ minimum: 0 }),
      stalled: int({ minimum: 0, description: 'On hold or cancelled. Reported so the parts sum to the total.' }),
      unclassified: int({ minimum: 0, description: 'A status no bucket claims. Should always be 0; visible so it cannot hide.' }),
      needsEscalation: int({
        minimum: 0,
        description:
          'Computed on every read from the current state, never stored. An unassigned emergency, a breached SLA, or a job parked past 72 hours.',
      }),
      averageResolutionHours: {
        type: ['number', 'null'], minimum: 0,
        description: 'NULL over nothing resolved — never 0, which would read as an instant turnaround.',
      },
    },
    required: ['total', 'open', 'inProgress', 'completed', 'stalled', 'needsEscalation', 'averageResolutionHours'],
  },

  // ── Notifications ────────────────────────────────────────────────────────

  PushTokenRegistration: {
    type: 'object',
    description:
      'A registered device. The token itself is never returned — it is a capability to reach someone\'s phone.',
    properties: {
      id: { ...oid(), readOnly: true },
      token: str({ writeOnly: true, minLength: 8, maxLength: 512 }),
      platform: str({ enum: ['ios', 'android', 'web', 'expo'] }),
      deviceId: str(),
      appVersion: str(),
      locale: str({ default: 'en-GH' }),
      lastSeenAt: { ...date(), readOnly: true },
      status: str({ enum: ['active', 'stale', 'revoked'], readOnly: true }),
      createdAt: { ...date(), readOnly: true },
      updatedAt: { ...date(), readOnly: true },
    },
    required: ['token', 'platform'],
  },

  Notification: allOf(ref('LifecycleFields'), {
    type: 'object',
    description:
      '`channel` records how it was delivered, not just that it exists — WhatsApp reaches people that push does not.',
    properties: {
      recipient: oid(),
      category: str({
        enum: [
          'verification', 'documentExpiry', 'rentDue', 'rentReceipt', 'maintenance',
          'rideOffer', 'rideUpdate', 'payout', 'adReview', 'adBudget', 'policy', 'system',
        ],
      }),
      channel: str({ enum: ['inApp', 'push', 'whatsapp', 'sms', 'email'] }),
      title: str({ maxLength: 200 }),
      body: str({ maxLength: 2000 }),
      deepLink: str({ description: 'e.g. ususu://driver/verification' }),
      subjectKind: str(),
      subject: oid(),
      readAt: { ...date(), nullable: true },
      deliveredAt: { ...date(), readOnly: true },
      failureReason: str({ readOnly: true }),
      isRead: { ...bool(), readOnly: true },
      status: str({ enum: ['queued', 'sent', 'delivered', 'read', 'failed'], readOnly: true }),
    },
    required: ['recipient', 'category', 'title', 'body'],
  }),

  NotificationList: arr(ref('Notification')),

  SendTestNotificationRequest: {
    type: 'object',
    description: 'HQ-only. Proves the pipe works without waiting for a real event.',
    properties: {
      recipient: oid(),
      category: str(),
      channel: str({ enum: ['inApp', 'push', 'whatsapp', 'sms', 'email'] }),
      title: str({ maxLength: 200 }),
      body: str({ maxLength: 2000 }),
      deepLink: str(),
    },
    required: ['recipient', 'title', 'body'],
  },

  MarkNotificationRequest: {
    type: 'object',
    properties: { read: bool() },
    required: ['read'],
  },

  // ── Commercial clients ───────────────────────────────────────────────────

  LinkedProfile: {
    type: 'object',
    properties: {
      kind: str({
        enum: [
          'LandlordProfile', 'AirbnbHostProfile', 'HotelProfile',
          'ResortProfile', 'RentalCarCompanyProfile', 'AdvertiserProfile',
        ],
      }),
      profile: oid(),
      label: str(),
    },
    required: ['kind', 'profile'],
  },

  CommercialClient: allOf(ref('ContactFields'), ref('LocationFields'), ref('VerificationFields'), ref('LifecycleFields'), {
    type: 'object',
    description:
      'The account above the account. A hospitality group with nine hotels is one commercial relationship spread across several profiles; this ties them together without replacing them.',
    properties: {
      clientName: str({ maxLength: 200 }),
      clientKind: str({
        enum: [
          'corporateLandlord', 'fleetOwner', 'institutionalAdvertiser',
          'hospitalityGroup', 'propertyDeveloper', 'governmentAgency', 'ngo',
        ],
      }),
      registrationNumber: str(),
      taxIdentificationNumber: str({ writeOnly: true }),
      primaryContactName: str({ maxLength: 160 }),
      accountManager: oid(),
      linkedProfiles: arr(ref('LinkedProfile')),
      linkedProperties: arr(oid()),
      linkedAdvertisers: arr(oid()),
      contractStart: date(),
      contractEnd: date(),
      contractStatus: str({
        enum: ['prospect', 'negotiating', 'active', 'renewing', 'suspended', 'ended'],
      }),
      contractValue: num({ minimum: 0 }),
      currency: str({ enum: CURRENCY }),
      billingFrequency: str({ enum: ['monthly', 'quarterly', 'annually'] }),
      negotiatedFeePercent: num({ minimum: 0, maximum: 100 }),
      slaHours: int({ minimum: 1 }),
      notes: str({ maxLength: 4000 }),
      portfolioSize: int({ readOnly: true }),
    },
    required: ['clientName', 'clientKind', 'primaryContactName', 'email', 'phone'],
  }),

  CommercialClientList: arr(ref('CommercialClient')),

  ClientFleetVehicle: allOf(ref('FleetVehicle'), {
    type: 'object',
    properties: { companyId: oid(), companyName: str() },
  }),

  ClientFleetList: arr(ref('ClientFleetVehicle')),
  ClientAdList: arr(ref('Ad')),
  ClientPropertyList: arr(ref('Property')),

  // ── Operational flows ─────────────────────────────────────────────────────

  RentScheduleEntry: {
    type: 'object',
    description: 'One instalment on a lease, and whether the running total covers it.',
    properties: {
      instalment: int({ minimum: 0, description: 'Zero-based. Instalment 0 is the advance payment at lease start.' }),
      dueDate: date(),
      amount: num({ minimum: 0 }),
      cumulativeDue: num({ minimum: 0 }),
      settled: bool(),
    },
    required: ['instalment', 'dueDate', 'amount', 'cumulativeDue', 'settled'],
  },

  LeaseSchedule: {
    type: 'object',
    description:
      'The instalment schedule and where the tenant stands against it. Computed from the term and the running total — no schedule rows are stored.',
    properties: {
      leaseId: oid(),
      reference: str(),
      currency: str({ enum: CURRENCY }),
      monthlyRent: num({ minimum: 0 }),
      paymentDayOfMonth: int({ minimum: 1, maximum: 31 }),
      instalmentsDue: int({ minimum: 0 }),
      totalInstalments: int({ minimum: 0 }),
      expectedToDate: num({ minimum: 0 }),
      totalPaid: num({ minimum: 0 }),
      arrearsAmount: num({ minimum: 0 }),
      creditBalance: num({ minimum: 0, description: 'Paid ahead of schedule. Never negative; arrears is the other direction.' }),
      nextDueDate: { anyOf: [date(), { type: 'null' }] },
      status: str({ enum: LEASE_STATUS }),
      escalation: str({ enum: ARREARS_ESCALATION }),
      truncated: bool({ description: 'True when the term is longer than the schedule window returned.' }),
      entries: arr(ref('RentScheduleEntry')),
    },
    required: ['leaseId', 'currency', 'monthlyRent', 'arrearsAmount', 'entries'],
  },

  LeaseBalance: {
    type: 'object',
    description: 'The lease totals after a payment, recomputed rather than incremented.',
    properties: {
      id: oid(),
      reference: str(),
      totalPaid: num({ minimum: 0 }),
      arrearsAmount: num({ minimum: 0 }),
      creditBalance: num({ minimum: 0 }),
      nextDueDate: { anyOf: [date(), { type: 'null' }] },
      status: str({ enum: LEASE_STATUS }),
      escalation: str({ enum: ARREARS_ESCALATION }),
    },
    required: ['id', 'totalPaid', 'arrearsAmount', 'status'],
  },

  RentPaymentReceipt: {
    type: 'object',
    description:
      'The ledger row and the lease it settled, from one computation. The two cannot disagree because neither is derived independently.',
    properties: {
      payment: ref('Payment'),
      lease: ref('LeaseBalance'),
    },
    required: ['payment', 'lease'],
  },

  RunRentRemindersRequest: {
    type: 'object',
    description:
      'The rent reminder run. Scheduling is external — a platform cron calls this. `asOf` replays a missed day; `dryRun` reports without sending or writing.',
    properties: {
      asOf: date(),
      leadDays: int({ minimum: 0, maximum: 30, description: 'How far ahead of a due date to remind. Default 5.' }),
      dryRun: bool(),
      limit: int({ minimum: 1, maximum: 2000 }),
    },
  },

  RentReminderRun: {
    type: 'object',
    description: 'What the reminder run examined, corrected and sent.',
    properties: {
      asOf: date(),
      leadDays: int({ minimum: 0 }),
      dryRun: bool(),
      examined: int({ minimum: 0 }),
      remindersDue: int({ minimum: 0 }),
      statusesCorrected: int({ minimum: 0, description: 'Leases whose status or arrears the sweep brought up to date.' }),
      byEscalation: { type: 'object', additionalProperties: int({ minimum: 0 }) },
      notified: int({ minimum: 0 }),
      delivered: int({ minimum: 0 }),
      failed: int({ minimum: 0 }),
      devices: int({ minimum: 0 }),
    },
    required: ['asOf', 'examined', 'remindersDue'],
  },

  MaintenanceSla: {
    type: 'object',
    description:
      'The SLA clock for one work order. `dueAt` is the target; `overdueAt` adds a grace period, after which it escalates to a human.',
    properties: {
      requestId: oid(),
      reference: str(),
      priority: str({ enum: MAINTENANCE_PRIORITY }),
      status: str({ enum: MAINTENANCE_STATUS }),
      createdAt: date(),
      completedAt: { anyOf: [date(), { type: 'null' }] },
      slaHours: num({ minimum: 0 }),
      dueAt: date(),
      overdueAt: date(),
      elapsedHours: num({ minimum: 0 }),
      hoursRemaining: num({ description: 'Negative once the target has passed.' }),
      percentElapsed: num({ minimum: 0 }),
      state: str({ enum: SLA_STATE }),
      breached: bool(),
      escalation: str({ enum: SLA_ESCALATION }),
    },
    required: ['requestId', 'slaHours', 'dueAt', 'overdueAt', 'state', 'breached', 'escalation'],
  },

  RunSlaEscalationRequest: {
    type: 'object',
    description: 'The SLA sweep. Notifies only — it never changes a request\'s status.',
    properties: {
      asOf: date(),
      dryRun: bool(),
      limit: int({ minimum: 1, maximum: 2000 }),
    },
  },

  SlaEscalationRun: {
    type: 'object',
    properties: {
      asOf: date(),
      dryRun: bool(),
      examined: int({ minimum: 0 }),
      breached: int({ minimum: 0 }),
      byState: { type: 'object', additionalProperties: int({ minimum: 0 }) },
      byEscalation: { type: 'object', additionalProperties: int({ minimum: 0 }) },
      notified: int({ minimum: 0 }),
      delivered: int({ minimum: 0 }),
      failed: int({ minimum: 0 }),
      devices: int({ minimum: 0 }),
    },
    required: ['asOf', 'examined', 'breached'],
  },

  DriverMatch: {
    type: 'object',
    description: 'One ranked driver. Components are exposed so a dispatcher can see why.',
    properties: {
      driverId: oid(),
      score: num({ minimum: 0, maximum: 1 }),
      distanceKm: { anyOf: [num({ minimum: 0 }), { type: 'null' }] },
      components: {
        type: 'object',
        properties: {
          proximity: num({ minimum: 0, maximum: 1 }),
          rating: num({ minimum: 0, maximum: 1 }),
          acceptance: num({ minimum: 0, maximum: 1 }),
          reliability: num({ minimum: 0, maximum: 1 }),
        },
        required: ['proximity', 'rating', 'acceptance', 'reliability'],
      },
    },
    required: ['driverId', 'score', 'components'],
  },

  RideMatchResult: {
    type: 'object',
    description:
      'Ranked candidates plus the rejection tally. "No drivers found" is not actionable; "eleven considered, six offline" is.',
    properties: {
      rideId: oid(),
      reference: str(),
      vehicleType: str(),
      region: { anyOf: [str(), { type: 'null' }] },
      considered: int({ minimum: 0 }),
      matched: int({ minimum: 0 }),
      rejected: {
        type: 'object',
        description: 'Count per hard-filter reason.',
        additionalProperties: int({ minimum: 0 }),
      },
      matches: arr(ref('DriverMatch')),
    },
    required: ['rideId', 'considered', 'matched', 'matches'],
  },

  NotificationDispatch: {
    type: 'object',
    description:
      'The result of one send. The inbox row is written before the provider is called, so a failed push still leaves something the member can find.',
    properties: {
      notificationId: oid(),
      recipient: oid(),
      channel: str({ enum: NOTIFICATION_CHANNEL }),
      devices: int({ minimum: 0, description: 'Active push tokens the send was attempted against.' }),
      delivered: int({ minimum: 0 }),
      failed: int({ minimum: 0 }),
      provider: str({ description: '`stub` until a real vendor is registered at boot.' }),
      status: str({ enum: NOTIFICATION_STATUS }),
    },
    required: ['notificationId', 'recipient', 'channel', 'status', 'provider'],
  },

  BroadcastNotificationRequest: {
    type: 'object',
    description: 'Aimed at a role, not at a client-supplied recipient list.',
    properties: {
      role: str({ enum: ROLE_NAMES }),
      category: str({ enum: NOTIFICATION_CATEGORY }),
      channel: str({ enum: NOTIFICATION_CHANNEL }),
      title: str({ minLength: 3, maxLength: 200 }),
      body: str({ minLength: 3, maxLength: 2000 }),
      deepLink: str({ maxLength: 2048 }),
      limit: int({ minimum: 1, maximum: 2000 }),
      dryRun: bool(),
    },
    required: ['role', 'title', 'body'],
  },

  BroadcastResult: {
    type: 'object',
    properties: {
      role: str({ enum: ROLE_NAMES }),
      dryRun: bool(),
      audience: int({ minimum: 0 }),
      truncated: bool({ description: 'True when more members hold the role than the cap allowed. Reported, never silent.' }),
      notified: int({ minimum: 0 }),
      delivered: int({ minimum: 0 }),
      failed: int({ minimum: 0 }),
      devices: int({ minimum: 0 }),
      provider: str(),
    },
    required: ['role', 'audience', 'truncated', 'provider'],
  },

  OccupancyKpis: {
    type: 'object',
    properties: {
      total: int({ minimum: 0 }),
      occupiable: int({ minimum: 0, description: 'Excludes off-market stock — a withdrawn villa is not a vacancy.' }),
      occupied: int({ minimum: 0 }),
      vacant: int({ minimum: 0 }),
      underMaintenance: int({ minimum: 0 }),
      offMarket: int({ minimum: 0 }),
      occupancyRate: num({ minimum: 0, maximum: 100 }),
    },
    required: ['total', 'occupiable', 'occupied', 'occupancyRate'],
  },

  RevenueKpis: {
    type: 'object',
    properties: {
      currency: str({ enum: CURRENCY }),
      monthlyRentRoll: num({ minimum: 0, description: 'Contracted monthly rent across live leases — the run rate.' }),
      collected: num({ minimum: 0 }),
      platformFees: num({ minimum: 0 }),
      netToClient: num({ minimum: 0 }),
      arrears: num({ minimum: 0 }),
      collectionRate: num({ minimum: 0, maximum: 100 }),
      adSpend: num({ minimum: 0 }),
      transactions: int({ minimum: 0 }),
    },
    required: ['currency', 'monthlyRentRoll', 'collected', 'arrears', 'collectionRate'],
  },

  FleetKpis: {
    type: 'object',
    properties: {
      size: int({ minimum: 0 }),
      available: int({ minimum: 0 }),
      onTrip: int({ minimum: 0 }),
      maintenance: int({ minimum: 0 }),
      utilizationRate: num({ minimum: 0, maximum: 100 }),
    },
    required: ['size', 'utilizationRate'],
  },

  CampaignKpis: {
    type: 'object',
    properties: {
      campaigns: int({ minimum: 0 }),
      active: int({ minimum: 0 }),
      impressions: int({ minimum: 0 }),
      clicks: int({ minimum: 0 }),
      clickThroughRate: num({ minimum: 0, maximum: 100 }),
      spend: num({ minimum: 0 }),
    },
    required: ['campaigns', 'impressions', 'clicks', 'clickThroughRate'],
  },

  PortfolioAnalytics: {
    type: 'object',
    description:
      'Occupancy, revenue, fleet and campaigns for one commercial client, plus a composite score across only the dimensions the client actually has.',
    properties: {
      clientId: oid(),
      clientName: str(),
      clientKind: str({ enum: CLIENT_KIND }),
      currency: str({ enum: CURRENCY }),
      window: {
        type: 'object',
        properties: {
          from: { anyOf: [date(), { type: 'null' }] },
          to: { anyOf: [date(), { type: 'null' }] },
        },
      },
      occupancy: ref('OccupancyKpis'),
      revenue: ref('RevenueKpis'),
      fleet: ref('FleetKpis'),
      campaigns: ref('CampaignKpis'),
      portfolioSize: int({ minimum: 0 }),
      healthScore: num({ minimum: 0, maximum: 100 }),
    },
    required: ['clientId', 'currency', 'occupancy', 'revenue', 'fleet', 'campaigns', 'healthScore'],
  },

  // ── FAC & governance ──────────────────────────────────────────────────────

  FacCode: allOf(ref('LifecycleFields'), {
    type: 'object',
    description:
      'One generation of the Founder Authorisation Code. The code itself is never stored — only a bcrypt digest, which is `select: false` and stripped from every serialised body.',
    properties: {
      _id: oid(),
      generation: int({ minimum: 1, readOnly: true, description: 'Monotonic. Generation 1 is the first ever issued.' }),
      label: str({ maxLength: 120, description: 'A hint the founder chose. Never part of the code.' }),
      issuedBy: oid(),
      issuedAt: date(),
      expiresAt: date(),
      rotationDays: int({ minimum: 1 }),
      trigger: str({ enum: ROTATION_TRIGGER }),
      revokedAt: date(),
      revokedBy: oid(),
      revocationReason: str({ maxLength: 1000 }),
      supersededBy: oid(),
      successfulVerifications: int({ minimum: 0, readOnly: true }),
      failedVerifications: int({ minimum: 0, readOnly: true }),
      status: str({ enum: FAC_CODE_STATUS, readOnly: true }),
    },
    required: ['generation', 'issuedBy', 'issuedAt', 'expiresAt', 'status'],
  }),

  FacCodeList: arr(ref('FacCode')),

  IssueFacCodeRequest: {
    type: 'object',
    description:
      'No code may be supplied. The server generates it from a CSPRNG and rejection-samples against the weakness rules — a founder allowed to choose six digits will choose their birthday.',
    properties: {
      trigger: str({ enum: ROTATION_TRIGGER }),
      rotationDays: int({ minimum: 1, maximum: 365 }),
      label: str({ maxLength: 120 }),
      reason: str({ maxLength: 1000, description: 'Required when the trigger is `compromise`.' }),
    },
  },

  FacIssuance: {
    type: 'object',
    description:
      'The one and only time the plaintext code is returned. There is no endpoint that retrieves it again and no support procedure that recovers it.',
    properties: {
      code: str({ description: 'The plaintext code. Shown once. Not recoverable.' }),
      issuedOnce: bool(),
      warning: str(),
      generation: int({ minimum: 1 }),
      issuedAt: date(),
      expiresAt: date(),
      rotationDays: int({ minimum: 1 }),
      trigger: str({ enum: ROTATION_TRIGGER }),
      supersededGeneration: { anyOf: [int({ minimum: 1 }), { type: 'null' }] },
      clearancesRevoked: bool({ description: 'True when the trigger also closed every live clearance.' }),
    },
    required: ['code', 'generation', 'issuedAt', 'expiresAt', 'warning'],
  },

  RevokeFacCodeRequest: {
    type: 'object',
    properties: { reason: str({ minLength: 5, maxLength: 1000 }) },
    required: ['reason'],
  },

  ClearLockoutRequest: {
    type: 'object',
    description:
      'The reason is mandatory. An optional free-text field on a security override is left empty every time, and six months later nobody can reconstruct why the highest authority on the platform was let back in.',
    properties: { reason: str({ minLength: 10, maxLength: 500 }) },
    required: ['reason'],
  },

  FacRevocation: {
    type: 'object',
    description:
      'Revoking without replacing leaves no code in force. Zone A is then closed to everyone and governance health is capped — the intended outcome for a suspected compromise.',
    properties: {
      generation: int({ minimum: 1 }),
      status: str({ enum: FAC_CODE_STATUS }),
      revokedAt: date(),
      revocationReason: str(),
      clearancesRevoked: int({ minimum: 0 }),
      warning: str(),
    },
    required: ['generation', 'status', 'clearancesRevoked'],
  },

  FacCodeSummary: {
    type: 'object',
    description: "The code's public face: status and clock, never the code.",
    properties: {
      generation: { anyOf: [int({ minimum: 1 }), { type: 'null' }] },
      status: str({ enum: [...FAC_CODE_STATUS, 'none'] }),
      issuedAt: { anyOf: [date(), { type: 'null' }] },
      expiresAt: { anyOf: [date(), { type: 'null' }] },
      daysRemaining: { anyOf: [int(), { type: 'null' }] },
      health: str({ enum: CODE_HEALTH }),
      warning: bool(),
      description: str(),
      rotationDays: int({ minimum: 1 }),
    },
    required: ['status', 'health', 'description'],
  },

  FacAttemptState: {
    type: 'object',
    properties: {
      used: int({ minimum: 0 }),
      remaining: int({ minimum: 0 }),
      max: int({ minimum: 1 }),
      allowed: bool(),
      refusal: { anyOf: [str({ enum: ATTEMPT_REFUSAL }), { type: 'null' }] },
      lockedUntil: { anyOf: [date(), { type: 'null' }] },
      lockoutSecondsRemaining: int({ minimum: 0 }),
      lockoutHours: int({ minimum: 1 }),
    },
    required: ['used', 'remaining', 'max'],
  },

  FacClearance: {
    type: 'object',
    description:
      'A live clearance. Stored server-side rather than carried in the token, so revoking a code takes effect immediately.',
    properties: {
      granted: bool(),
      grantedAt: { anyOf: [date(), { type: 'null' }] },
      expiresAt: { anyOf: [date(), { type: 'null' }] },
      secondsRemaining: int({ minimum: 0 }),
      active: bool({ description: 'What Zone A actually checks. Recomputed on every request.' }),
    },
    required: ['granted', 'secondsRemaining', 'active'],
  },

  FacPolicy: {
    type: 'object',
    description:
      'The published rules. `entropyBits` is stated honestly — six digits is ~19.9 bits, and it is the attempt limit that makes it workable.',
    properties: {
      codeLength: int({ minimum: 1 }),
      rotationDays: int({ minimum: 1 }),
      maxAttempts: int({ minimum: 1 }),
      lockoutHours: int({ minimum: 1 }),
      clearanceMinutes: int({ minimum: 1 }),
      entropyBits: num({ minimum: 0 }),
      expectedBruteForceYears: num({ minimum: 0 }),
    },
    required: ['codeLength', 'rotationDays', 'maxAttempts', 'lockoutHours', 'entropyBits'],
  },

  FacClearanceState: {
    type: 'object',
    description: "Everything the console polls: code status, the caller's attempts, their clearance, and the policy.",
    properties: {
      actor: oid(),
      tier: str({ enum: GOVERNANCE_TIER }),
      code: ref('FacCodeSummary'),
      attempts: ref('FacAttemptState'),
      clearance: ref('FacClearance'),
      policy: ref('FacPolicy'),
    },
    required: ['actor', 'tier', 'code', 'attempts', 'clearance', 'policy'],
  },

  VerifyFacCodeRequest: {
    type: 'object',
    properties: { code: str({ pattern: '^\\d{6}$', writeOnly: true }) },
    required: ['code'],
  },

  FacVerification: {
    type: 'object',
    description:
      'A successful verification. A failure is a 422 and never says *why* it failed — telling an attacker that is telling them something.',
    properties: {
      verified: bool(),
      clearance: ref('FacClearance'),
      generation: int({ minimum: 1 }),
      visibility: ref('GovernanceVisibility'),
      attempts: ref('FacAttemptState'),
    },
    required: ['verified', 'clearance', 'generation'],
  },

  FacClearanceRevocation: {
    type: 'object',
    properties: {
      revoked: int({ minimum: 0 }),
      clearance: ref('FacClearance'),
    },
    required: ['revoked', 'clearance'],
  },

  FacResetRequestBody: {
    type: 'object',
    properties: { reason: str({ minLength: 5, maxLength: 1000 }) },
    required: ['reason'],
  },

  FacResetRequest: {
    type: 'object',
    properties: {
      requested: bool(),
      reason: str(),
      foundersNotified: int({ minimum: 0 }),
      note: str(),
    },
    required: ['requested', 'foundersNotified'],
  },

  FacAttempt: {
    type: 'object',
    description: 'One row of the append-only attempt ledger. `blocked` rows record that somebody kept trying.',
    properties: {
      _id: oid(),
      actor: oid(),
      actorLabel: str({ maxLength: 120 }),
      actorRole: str({ enum: ROLE_NAMES }),
      codeGeneration: int({ minimum: 1 }),
      at: date(),
      result: str({ enum: ATTEMPT_RESULT }),
      attemptNumber: int({ minimum: 1 }),
      attemptsRemaining: int({ minimum: 0 }),
      lockedUntil: date(),
      clearedBy: oid('On a `cleared` row: the founder who lifted the lockout.'),
      clearedReason: str({ maxLength: 500 }),
      ipHash: str({ description: 'SHA-256 prefix. The raw address is never stored.' }),
      userAgent: str({ maxLength: 400 }),
    },
    required: ['actor', 'at', 'result', 'attemptNumber'],
  },

  FacAttemptList: arr(ref('FacAttempt')),


  // ── Marketplace ────────────────────────────────────────────────────────

  // ── Viewings ──────────────────────────────────────────────────────────────

  Viewing: {
    type: 'object',
    description:
      'A tenant asking to see a property, and LRMC agreeing to be there. `localHour` is stored alongside `requestedFor` because the server runs in UTC and the tenant does not — the hour a person meant is not recoverable from an instant without their offset.',
    properties: {
      _id: oid(),
      property: oid(),
      requestedBy: oid('The User who asked. Not a TenantProfile — an applicant may not have one yet.'),
      landlord: oid(),
      coordinator: oid(),
      requestedFor: date(),
      localHour: int({ minimum: 0, maximum: 23, description: 'The hour the tenant meant, in their own day.' }),
      alternateFor: date(),
      alternateLocalHour: int({ minimum: 0, maximum: 23 }),
      status: str({ enum: ['requested', 'confirmed', 'declined', 'completed', 'cancelled', 'noShow'] }),
      note: str({ maxLength: 600, description: 'What the tenant said when asking.' }),
      decisionReason: str({ maxLength: 600 }),
      outcomeNote: str({ maxLength: 600, description: "LRMC's account, kept apart from the tenant's." }),
      decidedBy: oid(),
      decidedAt: date(),
      outcomeRecordedAt: date(),
      createdAt: date(),
      updatedAt: date(),
    },
    required: ['property', 'requestedBy', 'requestedFor', 'localHour', 'status'],
  },

  ViewingList: arr(ref('Viewing')),

  // ── Applications ──────────────────────────────────────────────────────────

  EligibilityFactor: {
    type: 'object',
    description: 'One scored factor, with the reason in words the applicant could be shown.',
    properties: {
      factor: str({
        enum: ['identity', 'employment', 'references', 'paymentHistory', 'ususuContributions', 'disputes'],
      }),
      label: str(),
      status: str({
        enum: ['pass', 'concern', 'fail', 'unknown'],
        description:
          '`unknown` means LRMC has no evidence, which is not the same as bad evidence and is never scored as a failure.',
      }),
      points: num({ minimum: 0 }),
      max: num({ minimum: 0 }),
      reason: str(),
    },
    required: ['factor', 'label', 'status', 'points', 'max', 'reason'],
  },

  Assessment: {
    type: 'object',
    description:
      'A recommendation, never a decision. Stored on the application as a snapshot of what the decider was looking at — recomputing on read would rewrite history every time somebody paid their rent.',
    properties: {
      factors: arr(ref('EligibilityFactor')),
      score: num({ minimum: 0, maximum: 100 }),
      recommendation: str({ enum: ['recommend', 'review', 'decline'] }),
      blockedBy: strArr(),
      missing: strArr(),
      summary: str(),
      evidence: ref('EvidenceBundle'),
      takenAt: date(),
      takenBy: oid(),
    },
    required: ['factors', 'score', 'recommendation', 'summary'],
  },

  Application: {
    type: 'object',
    description:
      'A tenancy application. LRMC scores it; a named person decides it. `decision` carries both the author and the reason, for an approval as much as for a refusal.',
    properties: {
      _id: oid(),
      property: oid(),
      applicant: oid(),
      landlord: oid(),
      coordinator: oid(),
      status: str({
        enum: ['submitted', 'underReview', 'awaitingApplicant', 'approved', 'rejected', 'withdrawn', 'leaseIssued'],
      }),
      proposedRent: num({ minimum: 0 }),
      currency: str({ enum: ['GMD', 'GHS', 'USD', 'EUR', 'GBP', 'NGN', 'XOF'] }),
      proposedStart: date(),
      termMonths: int({ minimum: 1, maximum: 120 }),
      householdSize: int({ minimum: 1, maximum: 30 }),
      message: str({ maxLength: 2000 }),
      documentKeys: strArr(),
      assessment: ref('Assessment'),
      decision: {
        type: 'object',
        properties: {
          outcome: str({ enum: ['approved', 'rejected'] }),
          decidedBy: oid(),
          decidedAt: date(),
          reason: str({ maxLength: 2000 }),
          againstRecommendation: bool({
            description: 'Recorded so a decision taken against the score is findable later.',
          }),
        },
      },
      lease: oid(),
      outstandingRequest: str({ maxLength: 600 }),
      createdAt: date(),
      updatedAt: date(),
    },
    required: ['property', 'applicant', 'status', 'currency'],
  },

  ApplicationList: arr(ref('Application')),

  ApplicationAssessment: {
    type: 'object',
    properties: {
      assessment: ref('Assessment'),
      application: ref('Application'),
    },
    required: ['assessment', 'application'],
  },

  RequestViewingRequest: {
    type: 'object',
    description:
      '`localHour` is required rather than derived: the server runs in UTC and the tenant does not, so the hour a person meant cannot be recovered from an instant without their offset.',
    properties: {
      property: oid(),
      requestedFor: date(),
      localHour: int({ minimum: 0, maximum: 23 }),
      alternateFor: date(),
      alternateLocalHour: int({ minimum: 0, maximum: 23 }),
      note: str({ maxLength: 600 }),
    },
    required: ['property', 'requestedFor', 'localHour'],
  },

  UpdateViewingRequest: {
    type: 'object',
    description: "The tenant's own note. Status moves through the action routes.",
    properties: { note: str({ maxLength: 600 }) },
  },

  ViewingDecisionRequest: {
    type: 'object',
    properties: { reason: str({ maxLength: 600 }) },
  },

  ViewingOutcomeRequest: {
    type: 'object',
    properties: { outcomeNote: str({ maxLength: 600 }) },
  },

  CreateApplicationRequest: {
    type: 'object',
    description:
      'What the applicant states. Notably absent: whether their income is evidenced, their payment history, and whether a dispute is open — those LRMC looks up, never accepts.',
    properties: {
      property: oid(),
      proposedRent: num({ minimum: 0 }),
      proposedStart: date(),
      termMonths: int({ minimum: 1, maximum: 120 }),
      householdSize: int({ minimum: 1, maximum: 30 }),
      monthlyIncome: num({ minimum: 0, description: 'Declared, not evidenced.' }),
      message: str({ maxLength: 2000 }),
      documentKeys: strArr(),
    },
    required: ['property'],
  },

  DecideApplicationRequest: {
    type: 'object',
    description:
      'Required for an approval as much as for a refusal. An approval nobody signed is the thing that cannot be defended later.',
    properties: { reason: str({ minLength: 4, maxLength: 2000 }) },
    required: ['reason'],
  },

  RequestFromApplicantRequest: {
    type: 'object',
    properties: { outstandingRequest: str({ minLength: 4, maxLength: 600 }) },
    required: ['outstandingRequest'],
  },

  // ── Evidence ──────────────────────────────────────────────────────────────
  //
  // Every one of these is always returned in full, never null. `hasRecord` is
  // what separates "LRMC looked and found zero" from "LRMC has never looked" —
  // the second is scored as unknown and holds an application at review, and
  // without this field the two are indistinguishable.

  // ── Aggregate statistics ──────────────────────────────────────────────────
  //
  // Every rate is nullable on purpose. `(part / 0) * 100` is NaN, and a tile
  // reading "NaN%" is worse than one reading "—". `null` means there was
  // nothing to measure, which is a different fact from zero.

  PropertyStats: {
    type: 'object',
    properties: {
      totalProperties: int({ minimum: 0 }),
      occupied: int({ minimum: 0 }),
      vacant: int({ minimum: 0 }),
      unavailable: int({ minimum: 0, description: 'Under maintenance or off-market.' }),
      unclassified: int({ minimum: 0, description: 'A status no bucket claims. Should be zero.' }),
      occupancyRate: { type: ['number', 'null'], minimum: 0, maximum: 100,
        description: 'Of lettable properties. Null when there are none.' },
    },
    required: ['totalProperties', 'occupied', 'vacant', 'occupancyRate'],
  },

  PaymentStats: {
    type: 'object',
    properties: {
      totalPayments: int({ minimum: 0 }),
      settled: int({ minimum: 0 }),
      onTime: int({ minimum: 0 }),
      late: int({ minimum: 0 }),
      awaiting: int({ minimum: 0 }),
      failed: int({ minimum: 0 }),
      reliability: { type: ['number', 'null'], minimum: 0, maximum: 100,
        description: 'Of settled instalments. Null when none have settled.' },
      collectionWindowDays: int({ minimum: 1,
        description: 'The period `collected` covers. Label the figure from this rather than assuming 30.' }),
      collected: {
        type: 'array',
        description:
          'Money settled inside the window, grouped by currency and deliberately NOT summed into one figure: the ledger carries several currencies and there is no exchange rate on this platform. An empty array means nothing settled in the window.',
        items: {
          type: 'object',
          properties: {
            currency: str({ enum: CURRENCY }),
            amount: { type: 'number', minimum: 0 },
            payments: int({ minimum: 0 }),
          },
          required: ['currency', 'amount', 'payments'],
        },
      },
    },
    required: ['totalPayments', 'onTime', 'late', 'reliability', 'collected', 'collectionWindowDays'],
  },

  MaintenanceStats: {
    type: 'object',
    properties: {
      totalRequests: int({ minimum: 0 }),
      openRequests: int({ minimum: 0 }),
      inProgress: int({ minimum: 0 }),
      completed: int({ minimum: 0 }),
      stalled: int({ minimum: 0, description: 'On hold or cancelled.' }),
      unclassified: int({ minimum: 0 }),
    },
    required: ['totalRequests', 'openRequests', 'inProgress', 'completed'],
  },

  ApplicationStats: {
    type: 'object',
    properties: {
      totalApplications: int({ minimum: 0 }),
      underReview: int({ minimum: 0 }),
      approved: int({ minimum: 0 }),
      declined: int({ minimum: 0 }),
      withdrawn: int({ minimum: 0 }),
      unclassified: int({ minimum: 0 }),
    },
    required: ['totalApplications', 'underReview', 'approved', 'declined'],
  },

  UsusuStats: {
    type: 'object',
    properties: {
      totalGroups: int({ minimum: 0,
        description: 'Savings circles this caller can see. NOT every circle on the platform — a coordinator sees only the ones they steward or belong to.' }),
      activeGroups: int({ minimum: 0, description: 'Forming, active or paused.' }),
      totalMembers: int({ minimum: 0,
        description: 'People with a ledger, not groups — there is no group entity.' }),
      avgGroupHealth: { type: ['number', 'null'], minimum: 0, maximum: 100 },
      totalContributions: int({ minimum: 0 }),
      totalMisses: int({ minimum: 0 }),
    },
    required: ['totalMembers', 'avgGroupHealth', 'totalContributions', 'totalMisses'],
  },

  IdentityEvidence: {
    type: 'object',
    properties: {
      identityVerified: bool(),
      identityPending: bool({ description: 'Documents submitted, not yet reviewed.' }),
      hasRecord: bool({ description: 'False means LRMC has never checked, which is not a failure.' }),
    },
    required: ['identityVerified', 'identityPending', 'hasRecord'],
  },

  ReferencesEvidence: {
    type: 'object',
    properties: {
      referenceRequested: bool(),
      referenceReceived: bool(),
      referenceScore: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
      hasRecord: bool(),
    },
    required: ['referenceRequested', 'referenceReceived', 'referenceScore', 'hasRecord'],
  },

  DisputesEvidence: {
    type: 'object',
    properties: {
      disputesOpen: int({ minimum: 0 }),
      disputesResolved: int({ minimum: 0 }),
      disputeSeverity: int({
        minimum: 0, maximum: 3,
        description: 'The worst open dispute, not the sum. Three minor ones are not one severe one.',
      }),
      hasRecord: bool(),
    },
    required: ['disputesOpen', 'disputesResolved', 'disputeSeverity', 'hasRecord'],
  },

  UsusuEvidence: {
    type: 'object',
    properties: {
      contributionsMade: int({ minimum: 0 }),
      contributionsMissed: int({ minimum: 0 }),
      streak: int({ minimum: 0, description: 'Counted backwards from the most recent period.' }),
      groupHealth: int({ minimum: 0, maximum: 100 }),
      hasRecord: bool(),
    },
    required: ['contributionsMade', 'contributionsMissed', 'streak', 'groupHealth', 'hasRecord'],
  },

  PaymentsEvidence: {
    type: 'object',
    properties: {
      paymentsOnTime: int({ minimum: 0 }),
      paymentsLate: int({ minimum: 0 }),
      paymentsMissed: int({ minimum: 0 }),
      paymentReliability: int({ minimum: 0, maximum: 100 }),
      hasRecord: bool(),
    },
    required: ['paymentsOnTime', 'paymentsLate', 'paymentsMissed', 'paymentReliability', 'hasRecord'],
  },

  EvidenceBundle: {
    type: 'object',
    description: 'All five kinds, always present.',
    properties: {
      identityEvidence: ref('IdentityEvidence'),
      referencesEvidence: ref('ReferencesEvidence'),
      disputesEvidence: ref('DisputesEvidence'),
      ususuEvidence: ref('UsusuEvidence'),
      paymentsEvidence: ref('PaymentsEvidence'),
    },
    required: ['identityEvidence', 'referencesEvidence', 'disputesEvidence',
               'ususuEvidence', 'paymentsEvidence'],
  },

  Reference: {
    type: 'object',
    properties: {
      _id: oid(), subject: oid(),
      refereeName: str({ maxLength: 160 }),
      relationship: str({ maxLength: 120 }),
      status: str({ enum: ['requested', 'received', 'declined', 'expired'] }),
      score: int({ minimum: 0, maximum: 100 }),
      comment: str({ maxLength: 2000 }),
      respondedAt: date(), createdAt: date(), updatedAt: date(),
    },
    required: ['subject', 'refereeName', 'status'],
  },

  Dispute: {
    type: 'object',
    properties: {
      _id: oid(), subject: oid(), raisedBy: oid(),
      kind: str({ enum: ['rent', 'damage', 'conduct', 'marketplace', 'ride', 'other'] }),
      severity: int({ minimum: 1, maximum: 3 }),
      summary: str({ maxLength: 2000 }),
      status: str({ enum: ['open', 'resolved', 'withdrawn'] }),
      resolution: str({ maxLength: 2000 }),
      resolvedBy: oid(), resolvedAt: date(), createdAt: date(), updatedAt: date(),
    },
    required: ['subject', 'raisedBy', 'kind', 'severity', 'summary', 'status'],
  },

  UsusuEntry: {
    type: 'object',
    properties: {
      _id: oid(), subject: oid(),
      kind: str({ enum: ['contribution', 'miss'] }),
      amount: num({ minimum: 0 }),
      currency: str(),
      period: str({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }),
      note: str({ maxLength: 600 }),
      createdAt: date(),
    },
    required: ['subject', 'kind', 'period'],
  },

  ReferenceEvidenceView: {
    type: 'object',
    properties: {
      subject: oid(),
      evidence: ref('ReferencesEvidence'),
      references: arr(ref('Reference')),
    },
    required: ['subject', 'evidence', 'references'],
  },

  DisputeEvidenceView: {
    type: 'object',
    properties: {
      subject: oid(),
      evidence: ref('DisputesEvidence'),
      disputes: arr(ref('Dispute')),
    },
    required: ['subject', 'evidence', 'disputes'],
  },

  UsusuEvidenceView: {
    type: 'object',
    properties: {
      subject: oid(),
      evidence: ref('UsusuEvidence'),
      entries: arr(ref('UsusuEntry')),
    },
    required: ['subject', 'evidence', 'entries'],
  },

  RequestReferenceRequest: {
    type: 'object',
    properties: {
      subject: oid(), refereeName: str({ minLength: 2, maxLength: 160 }),
      refereeEmail: str({ format: 'email' }), refereePhone: str({ maxLength: 30 }),
      relationship: str({ maxLength: 120 }),
    },
    required: ['subject', 'refereeName'],
  },

  RespondToReferenceRequest: {
    type: 'object',
    properties: {
      reference: oid(),
      score: int({ minimum: 0, maximum: 100 }),
      comment: str({ maxLength: 2000 }),
    },
    required: ['reference', 'score'],
  },

  OpenDisputeRequest: {
    type: 'object',
    properties: {
      subject: oid(),
      kind: str({ enum: ['rent', 'damage', 'conduct', 'marketplace', 'ride', 'other'] }),
      severity: int({ minimum: 1, maximum: 3 }),
      summary: str({ minLength: 10, maxLength: 2000 }),
    },
    required: ['subject', 'kind', 'severity', 'summary'],
  },

  ResolveMemberDisputeRequest: {
    type: 'object',
    description:
      'Closing a dispute raised against a person. Distinct from the marketplace `ResolveDisputeRequest`, which settles an order and carries a refund decision — two different acts that happened to want the same name.',
    properties: { resolution: str({ minLength: 4, maxLength: 2000 }) },
    required: ['resolution'],
  },

  UsusuContributionRequest: {
    type: 'object',
    properties: {
      subject: oid(), period: str({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }),
      amount: num({ minimum: 0 }), currency: str({ maxLength: 8 }),
      note: str({ maxLength: 600 }),
    },
    required: ['subject', 'period'],
  },

  UsusuMissRequest: {
    type: 'object',
    properties: {
      subject: oid(), period: str({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }),
      note: str({ maxLength: 600 }),
    },
    required: ['subject', 'period'],
  },

  Listing: {
    type: 'object',
    description:
      'A product or a service offered by a merchant. Services carry no stock — a plumber does not run out of plumbing.',
    properties: {
      _id: oid(),
      merchant: oid(),
      createdBySeller: oid(),
      kind: str({ enum: ['product', 'service'] }),
      status: str({ enum: ['draft', 'pending', 'published', 'suspended', 'archived'] }),
      title: str({ maxLength: 200 }),
      description: str({ maxLength: 4000 }),
      unitPrice: num({ minimum: 0 }),
      currency: str({ enum: CURRENCY }),
      stock: { type: ['integer', 'null'], minimum: 0,
        description: 'Null on a service.' },
      unit: str({ maxLength: 30 }),
      category: str({ maxLength: 60 }),
      imageKeys: arr(str({ description: 'Storage key, never a URL. Signed links are minted on demand.' })),
      publishedAt: date(),
      suspendedReason: str({ maxLength: 500 }),
      totalOrdered: int({ minimum: 0 }),
      createdAt: date(),
      updatedAt: date(),
    },
    required: ['merchant', 'kind', 'status', 'title', 'unitPrice'],
  },

  ListingList: arr(ref('Listing')),

  MerchantCatalogue: {
    type: 'object',
    properties: {
      merchant: oid(),
      tradingName: str(),
      verified: bool({ description: 'An unverified merchant cannot publish anything.' }),
      counts: {
        type: 'object',
        properties: {
          total: int({ minimum: 0 }), published: int({ minimum: 0 }),
          draft: int({ minimum: 0 }), suspended: int({ minimum: 0 }),
        },
      },
      listings: arr(ref('Listing')),
    },
    required: ['merchant', 'listings'],
  },

  OrderLine: {
    type: 'object',
    description:
      'Title and price are **copied at order time**, not referenced. A price change next Tuesday must not alter what was agreed last Friday.',
    properties: {
      listing: oid(),
      title: str({ maxLength: 200 }),
      unitPrice: num({ minimum: 0 }),
      quantity: int({ minimum: 1 }),
      lineTotal: num({ minimum: 0 }),
    },
    required: ['listing', 'title', 'unitPrice', 'quantity', 'lineTotal'],
  },

  OrderEvent: {
    type: 'object',
    description: 'Append-only. Every status change, who made it, and when.',
    properties: {
      at: date(),
      from: str({ enum: ORDER_STATUS }),
      to: str({ enum: ORDER_STATUS }),
      by: oid(),
      actorKind: str({ enum: ['buyer', 'merchant', 'backOffice', 'system'] }),
      note: str({ maxLength: 500 }),
    },
    required: ['at', 'from', 'to', 'actorKind'],
  },

  Order: {
    type: 'object',
    description:
      'Escrow order. LRMC holds the money from `paid` until `released`, `refunded` or `cancelled`.',
    properties: {
      _id: oid(),
      reference: str({ description: 'ORD-YYYY-NNNNNNN. Sortable and legible on a receipt.' }),
      merchant: oid(),
      customer: oid(),
      placedByBuyer: oid(),
      acceptedBySeller: oid(),
      status: str({ enum: ORDER_STATUS }),
      lines: arr(ref('OrderLine')),
      subtotal: num({ minimum: 0 }),
      deliveryFee: num({ minimum: 0 }),
      total: num({ minimum: 0, description: 'What the buyer pays.' }),
      commissionPercent: num({ minimum: 0, maximum: 100 }),
      platformFee: num({ minimum: 0, description: "LRMC's cut. Charged on goods, never on delivery." }),
      merchantNet: num({ minimum: 0, description: 'What the merchant is owed on completion.' }),
      currency: str({ enum: CURRENCY }),
      deliveryAddress: str({ maxLength: 400 }),
      note: str({ maxLength: 1000 }),
      placedAt: date(), paidAt: date(), acceptedAt: date(), fulfilledAt: date(),
      confirmedAt: date(), releasedAt: date(), cancelledAt: date(),
      refundedAt: date(), disputedAt: date(),
      /** When escrow releases on its own if the buyer stays silent. */
      autoReleaseAt: date(),
      disputeReason: str({ maxLength: 1000 }),
      disputeRuling: str({ maxLength: 1000 }),
      refundAmount: num({ minimum: 0 }),
      events: arr(ref('OrderEvent')),
      createdAt: date(),
      updatedAt: date(),
    },
    required: ['reference', 'merchant', 'customer', 'status', 'lines', 'total'],
  },

  OrderList: arr(ref('Order')),

  OrderDetail: {
    type: 'object',
    description: 'An order plus what *this* caller may do with it next.',
    properties: {
      statusLabel: str({ description: 'Plain language, for the screen.' }),
      escrowHeld: bool({ description: 'Is LRMC currently holding the money?' }),
      // Derived from the lifecycle table for this caller's side, so a client
      // never reimplements the rules to decide which buttons to draw.
      availableActions: arr(str({ enum: ORDER_STATUS })),
      yourSide: str({ enum: ['buyer', 'merchant', 'backOffice', 'system'] }),
    },
    allOf: [ref('Order')],
  },

  OrderSettlement: {
    type: 'object',
    description: 'The result of releasing or refunding an order.',
    properties: {
      statusLabel: str(),
      escrowHeld: bool(),
      settlement: {
        type: 'object',
        properties: {
          gross: num({ minimum: 0 }),
          platformFee: num({ minimum: 0 }),
          merchantNet: num({ minimum: 0 }),
        },
      },
      refund: {
        type: 'object',
        description: 'Commission is returned pro rata on a partial refund.',
        properties: {
          refundToBuyer: num({ minimum: 0 }),
          commissionReturned: num({ minimum: 0 }),
          merchantBears: num({ minimum: 0 }),
          isFull: bool(),
        },
      },
    },
    allOf: [ref('Order')],
  },

  MarketplaceOverview: {
    type: 'object',
    properties: {
      side: str({ enum: ['merchant', 'customer', 'observer'] }),
      account: {
        type: 'object',
        properties: { id: oid(), name: str(), verified: bool() },
      },
      orders: {
        type: 'object',
        properties: {
          total: int({ minimum: 0 }),
          byStatus: { type: 'object', additionalProperties: int({ minimum: 0 }) },
          escrowHeldCount: int({ minimum: 0 }),
          escrowHeldValue: num({ minimum: 0, description: 'What is currently tied up.' }),
          settledValue: num({ minimum: 0 }),
          commissionPaid: num({ minimum: 0, description: 'Merchant view only; null for a customer.' }),
        },
      },
      awaitingAction: arr({
        type: 'object',
        properties: {
          _id: oid(), reference: str(), status: str({ enum: ORDER_STATUS }),
          statusLabel: str(), total: num({ minimum: 0 }), currency: str({ enum: CURRENCY }),
          createdAt: date(),
        },
      }),
    },
    required: ['side', 'orders'],
  },

  Merchant: {
    type: 'object',
    description: 'A trading account on the LRMC marketplace. Sellers act for it.',
    properties: {
      _id: oid(),
      user: oid(),
      tradingName: str({ maxLength: 160 }),
      category: str({ enum: MERCHANT_CATEGORY }),
      registrationNumber: str({ maxLength: 60 }),
      sellers: arr(oid()),
      commissionPercent: num({ minimum: 0, maximum: 100,
        description: 'Negotiated rate. Absent means the platform default at time of order.' }),
      currency: str({ enum: CURRENCY }),
      totalOrders: int({ minimum: 0 }),
      totalSales: num({ minimum: 0 }),
      email: str(), phone: str(), region: str(), city: str(),
      verificationStatus: str({ enum: VERIFICATION_STATUS }),
      status: str({ enum: LIFECYCLE_STATUS }),
      rating: num({ minimum: 0, maximum: 5 }),
      createdAt: date(), updatedAt: date(),
    },
    required: ['user', 'tradingName', 'category'],
  },

  MerchantList: arr(ref('Merchant')),

  Customer: {
    type: 'object',
    description: 'A buying account on the LRMC marketplace. Buyers act for it.',
    properties: {
      _id: oid(),
      user: oid(),
      accountName: str({ maxLength: 160 }),
      buyers: arr(oid()),
      buyerOrderLimit: num({ minimum: 0,
        description: 'Ceiling on what a named buyer may spend without the account owner. Absent means no ceiling.' }),
      currency: str({ enum: CURRENCY }),
      totalOrders: int({ minimum: 0 }),
      totalSpend: num({ minimum: 0 }),
      email: str(), phone: str(), region: str(), city: str(),
      verificationStatus: str({ enum: VERIFICATION_STATUS }),
      status: str({ enum: LIFECYCLE_STATUS }),
      createdAt: date(), updatedAt: date(),
    },
    required: ['user', 'accountName'],
  },

  CustomerList: arr(ref('Customer')),


  MerchantSellersRequest: {
    type: 'object',
    description: 'Who may sell for this merchant account.',
    properties: { sellerIds: arr(oid()) },
    required: ['sellerIds'],
  },

  CustomerBuyersRequest: {
    type: 'object',
    description: 'Who may purchase against this customer account.',
    properties: { buyerIds: arr(oid()) },
    required: ['buyerIds'],
  },

  SuspendListingRequest: {
    type: 'object',
    properties: { reason: str({ minLength: 5, maxLength: 500 }) },
    required: ['reason'],
  },

  PlaceOrderRequest: {
    type: 'object',
    description:
      'Listing ids and quantities only. Prices are read from the listings server-side — a client that could name its own prices would name zero.',
    properties: {
      merchant: oid(),
      lines: arr({
        type: 'object',
        properties: { listing: oid(), quantity: int({ minimum: 1, maximum: 999 }) },
        required: ['listing', 'quantity'],
      }),
      deliveryAddress: str({ maxLength: 400 }),
      note: str({ maxLength: 1000 }),
    },
    required: ['merchant', 'lines'],
  },

  PayOrderRequest: {
    type: 'object',
    description:
      "The provider's reference, not an amount. The server already knows what the order costs; letting the client restate it would mean deciding which number to believe.",
    properties: { paymentRef: str({ minLength: 3, maxLength: 120 }) },
    required: ['paymentRef'],
  },

  FulfilOrderRequest: {
    type: 'object',
    properties: { note: str({ maxLength: 500 }) },
  },

  CancelOrderRequest: {
    type: 'object',
    properties: { reason: str({ minLength: 3, maxLength: 500 }) },
    required: ['reason'],
  },

  DisputeOrderRequest: {
    type: 'object',
    properties: { reason: str({ minLength: 10, maxLength: 1000 }) },
    required: ['reason'],
  },

  ResolveDisputeRequest: {
    type: 'object',
    description:
      'A refund ruling must carry an amount; the other two must not. Commission is returned pro rata.',
    properties: {
      outcome: str({ enum: ['release', 'refund', 'cancel'] }),
      ruling: str({ minLength: 10, maxLength: 1000 }),
      refundAmount: num({ minimum: 0 }),
    },
    required: ['outcome', 'ruling'],
  },

  FacLockout: {
    type: 'object',
    description: 'One founder currently shut out of Zone A, with the time left to run.',
    properties: {
      actor: oid(),
      email: str(),
      roles: arr(str({ enum: ROLE_NAMES })),
      lockedUntil: date(),
      secondsRemaining: int({ minimum: 0 }),
      attemptsUsed: int({ minimum: 0 }),
    },
    required: ['actor'],
  },

  FacLockoutList: {
    type: 'object',
    properties: {
      lockouts: arr(ref('FacLockout')),
      count: int({ minimum: 0 }),
      asOf: date(),
    },
    required: ['lockouts', 'count'],
  },

  FacLockoutClear: {
    type: 'object',
    description:
      'The result of one founder lifting another\'s lockout. `cleared: false` with a reason means the actor was not locked out — the desired state already held.',
    properties: {
      cleared: bool(),
      actor: oid(),
      email: str(),
      clearedBy: oid(),
      reason: str({ maxLength: 500 }),
      at: date(),
      attempts: {
        type: 'object',
        properties: {
          used: int({ minimum: 0 }),
          remaining: int({ minimum: 0 }),
          allowed: bool(),
        },
      },
      note: str(),
    },
    required: ['cleared', 'actor'],
  },

  GovernanceVisibility: {
    type: 'object',
    description:
      '`sealEligible` and `sealVisible` are separate on purpose: a founder without a live clearance is the first and not the second.',
    properties: {
      role: str({ enum: ROLE_NAMES }),
      roles: arr(str({ enum: ROLE_NAMES })),
      tier: str({ enum: GOVERNANCE_TIER }),
      tierLabel: str(),
      facRequired: bool(),
      sealEligible: bool(),
      sealVisible: bool({ description: 'Requires the founder tier AND a live FAC clearance.' }),
      adminAccess: str({ enum: ADMIN_ACCESS }),
      visibleTiers: arr(str({ enum: GOVERNANCE_TIER })),
      clearance: ref('FacClearance'),
    },
    required: ['role', 'tier', 'facRequired', 'sealEligible', 'sealVisible', 'adminAccess'],
  },

  VisibilityMatrixRow: {
    type: 'object',
    properties: {
      tier: str({ enum: GOVERNANCE_TIER }),
      ordinal: int({ minimum: 1, maximum: 4 }),
      label: str(),
      roles: arr(str({ enum: ROLE_NAMES })),
      sealEligible: bool(),
      facRequired: bool(),
      adminAccess: str({ enum: ADMIN_ACCESS }),
    },
    required: ['tier', 'ordinal', 'label', 'roles', 'sealEligible', 'facRequired', 'adminAccess'],
  },

  VisibilityMatrix: {
    type: 'object',
    properties: { rows: arr(ref('VisibilityMatrixRow')) },
    required: ['rows'],
  },

  GovernanceTierDetail: {
    type: 'object',
    properties: {
      tier: str({ enum: GOVERNANCE_TIER }),
      ordinal: int({ minimum: 1, maximum: 4 }),
      label: str(),
      summary: str(),
      roles: arr(str({ enum: ROLE_NAMES })),
      facRequired: bool(),
      sealEligible: bool(),
      adminAccess: str({ enum: ADMIN_ACCESS }),
      visibleTiers: arr(str({ enum: GOVERNANCE_TIER })),
      headcount: int({ minimum: 0 }),
      zones: arr(str({ enum: HQ_ZONE_KEYS })),
    },
    required: ['tier', 'ordinal', 'label', 'roles', 'headcount', 'adminAccess'],
  },

  GovernanceTiers: {
    type: 'object',
    description:
      'Filtered to what the caller\'s own tier may see. `withheld` is reported rather than the list silently coming back short.',
    properties: {
      viewerTier: str({ enum: GOVERNANCE_TIER }),
      viewerTierLabel: str(),
      total: int({ minimum: 0 }),
      visible: int({ minimum: 0 }),
      withheld: int({ minimum: 0 }),
      tiers: arr(ref('GovernanceTierDetail')),
    },
    required: ['viewerTier', 'total', 'visible', 'withheld', 'tiers'],
  },

  HealthComponentScore: {
    type: 'object',
    properties: {
      component: str({ enum: HEALTH_COMPONENT }),
      score: num({ minimum: 0, maximum: 100 }),
      measured: bool({ description: 'False when there was nothing to measure; excluded from the composite.' }),
      detail: str(),
    },
    required: ['component', 'score', 'measured', 'detail'],
  },

  GovernanceHealth: {
    type: 'object',
    description:
      'A component with no data is excluded, not scored zero. A missing or expired code caps the composite — a green bar over a platform with no code in force is worse than no bar at all.',
    properties: {
      score: num({ minimum: 0, maximum: 100 }),
      band: str({ enum: HEALTH_BAND }),
      components: arr(ref('HealthComponentScore')),
      measured: arr(str({ enum: HEALTH_COMPONENT })),
      unmeasured: arr(str({ enum: HEALTH_COMPONENT })),
      cappedBy: { anyOf: [str({ enum: ['facCompliance'] }), { type: 'null' }] },
      weakest: { anyOf: [str({ enum: HEALTH_COMPONENT }), { type: 'null' }] },
      code: ref('FacCodeSummary'),
      activeLockouts: int({ minimum: 0 }),
    },
    required: ['score', 'band', 'components', 'measured', 'unmeasured'],
  },

  // ── Document engine ───────────────────────────────────────────────────────

  DocumentFields: {
    type: 'object',
    description:
      'The type-specific field bag. Which keys are required is declared per type in `documentRules.ts` and published on `DocumentTypeRule`.',
    propertyNames: { enum: DOCUMENT_FIELD },
    additionalProperties: {
      anyOf: [str(), num(), bool(), date()],
    },
  },

  DocumentAudit: {
    type: 'object',
    description:
      'One append-only trail entry. Sequences are contiguous from 1 and timestamps never move backwards; both are asserted on every read.',
    properties: {
      sequence: int({ minimum: 1, readOnly: true }),
      at: date(),
      actor: oid(),
      actorRole: str({ enum: ROLE_NAMES }),
      action: str({ enum: AUDIT_ACTION }),
      fromStatus: { anyOf: [str({ enum: DOCUMENT_STATUS }), { type: 'null' }] },
      toStatus: { anyOf: [str({ enum: DOCUMENT_STATUS }), { type: 'null' }] },
      reason: { anyOf: [str({ maxLength: 2000 }), { type: 'null' }] },
      fieldsChanged: arr(str({ enum: DOCUMENT_FIELD })),
    },
    required: ['sequence', 'at', 'actor', 'action'],
  },

  DocumentAuditList: arr(ref('DocumentAudit')),

  DocumentAuditSummary: {
    type: 'object',
    properties: {
      total: int({ minimum: 0 }),
      byAction: { type: 'object', additionalProperties: int({ minimum: 0 }) },
      firstAt: { anyOf: [date(), { type: 'null' }] },
      lastAt: { anyOf: [date(), { type: 'null' }] },
      actors: arr(oid()),
    },
    required: ['total', 'byAction'],
  },

  DocumentScore: {
    type: 'object',
    description:
      'Four independent dimensions, weighted into one. Kept separate because a reviewer needs to know *which* is low: 62 for blur needs a re-upload, 62 for a name mismatch needs a conversation.',
    properties: {
      completeness: num({ minimum: 0, maximum: 100 }),
      clarity: num({ minimum: 0, maximum: 100 }),
      consistency: num({ minimum: 0, maximum: 100 }),
      crossDocument: num({ minimum: 0, maximum: 100 }),
      overall: num({ minimum: 0, maximum: 100 }),
      band: str({ enum: SCORE_BAND }),
      meetsVerificationFloor: bool({ description: 'False refuses verification however willing the reviewer.' }),
      weakest: str({ enum: SCORE_DIMENSION }),
      scoredAt: date(),
    },
    required: ['completeness', 'clarity', 'consistency', 'crossDocument', 'overall', 'band'],
  },

  DocumentExpiryInfo: {
    type: 'object',
    description:
      'The document\'s clock. Notices fire on an exact rung (90/60/30/14/7/1 days) rather than continuously, so a holder gets four reminders over three months instead of ninety.',
    properties: {
      type: str({ enum: DOCUMENT_TYPE }),
      expiresOn: { anyOf: [date(), { type: 'null' }] },
      daysRemaining: { anyOf: [int(), { type: 'null' }] },
      state: str({ enum: EXPIRY_STATE }),
      expired: bool(),
      noticeDue: { anyOf: [int({ minimum: 0 }), { type: 'null' }] },
      escalation: str({ enum: EXPIRY_ESCALATION }),
      requiresReverification: bool(),
      daysExpired: { anyOf: [int({ minimum: 0 }), { type: 'null' }] },
    },
    required: ['type', 'state', 'expired', 'escalation', 'requiresReverification'],
  },

  DocumentComplianceCheck: {
    type: 'object',
    properties: {
      rule: str({ enum: COMPLIANCE_RULE }),
      outcome: str({ enum: CHECK_OUTCOME }),
      severity: str({ enum: CHECK_SEVERITY }),
      detail: str(),
    },
    required: ['rule', 'outcome', 'severity', 'detail'],
  },

  DocumentComplianceReport: {
    type: 'object',
    description:
      'Cross-entity agreement. A blocking failure refuses verification outright; an advisory one is recorded and may be overridden by a reviewer who has looked at it. A context that cannot be loaded yields `skipped`, never `passed`.',
    properties: {
      type: str({ enum: DOCUMENT_TYPE }),
      rule: { anyOf: [str({ enum: COMPLIANCE_RULE }), { type: 'null' }] },
      checks: arr(ref('DocumentComplianceCheck')),
      passed: int({ minimum: 0 }),
      failed: int({ minimum: 0 }),
      skipped: int({ minimum: 0 }),
      blocking: arr(ref('DocumentComplianceCheck')),
      clear: bool({ description: 'True when nothing blocking failed — the document may be verified.' }),
      score: num({ minimum: 0, maximum: 100 }),
    },
    required: ['type', 'checks', 'passed', 'failed', 'skipped', 'clear', 'score'],
  },

  Document: allOf(ref('LifecycleFields'), {
    type: 'object',
    description:
      'One piece of evidence and everything that has happened to it. The file is addressed by storage key, never by URL — a permanent link to a passport scan in a database row is a breach waiting for a backup to leak.',
    properties: {
      _id: oid(),
      reference: str({ readOnly: true, description: 'DOC-xxxxxx, server-assigned.' }),
      type: str({ enum: DOCUMENT_TYPE }),
      title: str({ maxLength: 240 }),
      owner: oid({ readOnly: true } as never),
      subjectKind: str({ maxLength: 60 }),
      subject: oid(),
      fields: ref('DocumentFields'),
      storageKey: str({ writeOnly: true, description: 'Object-storage key. Never returned; a signed URL is minted on demand.' }),
      mimeType: str({ enum: DOCUMENT_MIME_TYPE }),
      fileSize: int({ minimum: 0 }),
      pageCount: int({ minimum: 0 }),
      ocrConfidence: num({ minimum: 0, maximum: 1 }),
      resolution: int({ minimum: 0 }),
      version: int({ minimum: 1, readOnly: true }),
      desk: str({ enum: REVIEW_DESK, readOnly: true }),
      assignedTo: oid(),
      assignedAt: date(),
      submittedAt: date(),
      reviewStartedAt: date(),
      verifiedAt: date(),
      verifiedBy: oid(),
      rejectedAt: date(),
      rejectionReason: str({ maxLength: 2000, readOnly: true }),
      infoRequestedAt: date(),
      infoRequestReason: str({ maxLength: 2000, readOnly: true }),
      expiresOn: date(),
      expiredAt: date(),
      score: ref('DocumentScore'),
      complianceClear: bool(),
      complianceCheckedAt: date(),
      audit: arr(ref('DocumentAudit')),
      status: str({ enum: DOCUMENT_STATUS, readOnly: true, description: 'Moves only through the lifecycle endpoints.' }),
      daysUntilExpiry: { anyOf: [int(), { type: 'null' }] },
      isExpired: bool(),
      auditCount: int({ minimum: 0, readOnly: true }),
    },
    required: ['type', 'owner', 'fields', 'status'],
  }),

  DocumentList: arr(ref('Document')),

  DocumentWithExpiry: allOf(ref('Document'), {
    type: 'object',
    properties: { expiry: ref('DocumentExpiryInfo') },
  }),

  DocumentWithExpiryList: arr(ref('DocumentWithExpiry')),

  DocumentInput: {
    type: 'object',
    description:
      'What a client may submit. `status`, `desk`, `version`, `reference` and the audit trail are all server-controlled and absent here.',
    properties: {
      type: str({ enum: DOCUMENT_TYPE }),
      title: str({ maxLength: 240 }),
      subjectKind: str({ maxLength: 60 }),
      subject: oid(),
      fields: ref('DocumentFields'),
      mimeType: str({ enum: DOCUMENT_MIME_TYPE }),
      fileSize: int({ minimum: 1 }),
      pageCount: int({ minimum: 1, maximum: 500 }),
      ocrConfidence: num({ minimum: 0, maximum: 1 }),
      resolution: int({ minimum: 1, maximum: 20000 }),
      storageKey: str({ minLength: 4, maxLength: 255 }),
    },
    required: ['type', 'fields'],
  },

  DocumentPatch: {
    type: 'object',
    description:
      'An amendment. `type` is absent deliberately: retyping a document would change which fields are required, which compliance rule applies and how long it lives. A different type is a different document.',
    properties: {
      title: str({ maxLength: 240 }),
      subjectKind: str({ maxLength: 60 }),
      subject: oid(),
      fields: ref('DocumentFields'),
      mimeType: str({ enum: DOCUMENT_MIME_TYPE }),
      fileSize: int({ minimum: 1 }),
      pageCount: int({ minimum: 1, maximum: 500 }),
      ocrConfidence: num({ minimum: 0, maximum: 1 }),
      resolution: int({ minimum: 1, maximum: 20000 }),
      storageKey: str({ minLength: 4, maxLength: 255 }),
    },
  },

  TransitionRequirements: {
    type: 'object',
    description: 'What the lifecycle demanded of this move.',
    properties: {
      reason: bool(),
      audit: bool({ description: 'True for every transition except the initial `submitted`.' }),
      reviewer: bool(),
      gated: bool({ description: 'True only for `verified`: compliance and score must both pass.' }),
    },
    required: ['reason', 'audit', 'reviewer', 'gated'],
  },

  DocumentLifecycle: {
    type: 'object',
    description:
      'The result of a lifecycle transition: the document as it now stands, what moved, and the trail summary. An illegal move never reaches this shape — it is a 409.',
    properties: {
      document: ref('Document'),
      transition: {
        type: 'object',
        properties: {
          from: str({ enum: DOCUMENT_STATUS }),
          to: str({ enum: DOCUMENT_STATUS }),
          action: str({ enum: AUDIT_ACTION }),
          at: date(),
          actor: oid(),
          reason: { anyOf: [str(), { type: 'null' }] },
          requirements: ref('TransitionRequirements'),
        },
        required: ['from', 'to', 'action', 'at', 'actor'],
      },
      audit: ref('DocumentAuditSummary'),
    },
    required: ['document', 'transition', 'audit'],
  },

  DocumentVerificationSummary: {
    type: 'object',
    description:
      'Lifecycle, score, compliance and expiry in one read. A reviewer deciding whether to verify needs all four, and four round trips to assemble them is four chances to act on a stale one.',
    properties: {
      documentId: oid(),
      reference: str(),
      type: str({ enum: DOCUMENT_TYPE }),
      lifecycle: {
        type: 'object',
        properties: {
          status: str({ enum: DOCUMENT_STATUS }),
          submittedAt: { anyOf: [date(), { type: 'null' }] },
          reviewStartedAt: { anyOf: [date(), { type: 'null' }] },
          verifiedAt: { anyOf: [date(), { type: 'null' }] },
          rejectedAt: { anyOf: [date(), { type: 'null' }] },
          expiredAt: { anyOf: [date(), { type: 'null' }] },
          reviewable: bool(),
          desk: str({ enum: REVIEW_DESK }),
        },
        required: ['status', 'reviewable'],
      },
      score: ref('DocumentScore'),
      compliance: ref('DocumentComplianceReport'),
      expiry: ref('DocumentExpiryInfo'),
      audit: arr(ref('DocumentAudit')),
      auditSummary: ref('DocumentAuditSummary'),
      verifiable: bool({
        description: 'The AND of reviewable, compliance-clear, above the score floor and not expired.',
      }),
    },
    required: ['documentId', 'type', 'lifecycle', 'score', 'compliance', 'expiry', 'verifiable'],
  },

  DocumentAnalytics: {
    type: 'object',
    description: 'Verification throughput and backlog across the platform.',
    properties: {
      window: {
        type: 'object',
        properties: {
          from: { anyOf: [date(), { type: 'null' }] },
          to: { anyOf: [date(), { type: 'null' }] },
        },
      },
      total: int({ minimum: 0 }),
      byStatus: { type: 'object', additionalProperties: int({ minimum: 0 }) },
      byType: { type: 'object', additionalProperties: int({ minimum: 0 }) },
      byDesk: { type: 'object', additionalProperties: int({ minimum: 0 }) },
      backlog: int({ minimum: 0, description: 'Submitted plus under review — what a desk still owes.' }),
      awaitingHolder: int({ minimum: 0 }),
      verified: int({ minimum: 0 }),
      rejected: int({ minimum: 0 }),
      verificationRate: num({ minimum: 0, maximum: 100 }),
      rejectionRate: num({ minimum: 0, maximum: 100 }),
      averageScore: num({ minimum: 0, maximum: 100 }),
      averageTurnaroundHours: num({ minimum: 0 }),
      expiringSoon: int({ minimum: 0 }),
      expired: int({ minimum: 0 }),
      truncated: bool({ description: 'True when the sample hit its cap. Reported, never silent.' }),
    },
    required: ['total', 'byStatus', 'backlog', 'verificationRate', 'rejectionRate'],
  },

  SubmitDocumentRequest: {
    type: 'object',
    properties: {
      fields: ref('DocumentFields'),
      storageKey: str({ minLength: 4, maxLength: 255 }),
      note: str({ maxLength: 2000 }),
    },
  },

  ReviewDocumentRequest: {
    type: 'object',
    properties: {
      note: str({ maxLength: 2000 }),
      assignTo: oid(),
    },
  },

  RequestInfoRequest: {
    type: 'object',
    description: 'Asking for more without saying what is the single most common way a queue stalls.',
    properties: {
      reason: str({ minLength: 5, maxLength: 2000 }),
      missingFields: arr(str({ enum: DOCUMENT_FIELD })),
    },
    required: ['reason'],
  },

  VerifyDocumentRequest: {
    type: 'object',
    properties: {
      note: str({ maxLength: 2000 }),
      overrideAdvisory: bool({
        description:
          'Lets a reviewer proceed past a failed *advisory* check they have read. It can never override a blocking one.',
      }),
    },
  },

  RejectDocumentRequest: {
    type: 'object',
    properties: { reason: str({ minLength: 5, maxLength: 2000 }) },
    required: ['reason'],
  },

  ExpireDocumentRequest: {
    type: 'object',
    properties: {
      reason: str({ maxLength: 2000 }),
      asOf: date(),
    },
  },

  ReverifyDocumentRequest: {
    type: 'object',
    properties: { reason: str({ maxLength: 2000 }) },
  },

  // ── Payout batches ────────────────────────────────────────────────────────

  PayoutLine: {
    type: 'object',
    description:
      'One payee, one currency, one transfer. Amounts are frozen at build time, not recomputed from rows that may since have been refunded.',
    properties: {
      _id: oid(),
      payee: oid(),
      payeeKind: str(),
      currency: str({ enum: CURRENCY }),
      sourcePayments: arr(oid()),
      gross: num({ minimum: 0 }),
      platformFee: num({ minimum: 0 }),
      net: num({ minimum: 0 }),
      transferStatus: str({ enum: TRANSFER_STATUS }),
      providerReference: str({ readOnly: true }),
      failureReason: str({ readOnly: true }),
      settledAt: date(),
    },
    required: ['payee', 'currency', 'gross', 'net', 'transferStatus'],
  },

  PayoutLineList: arr(ref('PayoutLine')),

  PayoutBatch: allOf(ref('LifecycleFields'), {
    type: 'object',
    description:
      'A batch of outbound transfers built from settled ledger rows. Separate from Payment: the ledger records money that has moved, a batch is an instruction to move some.',
    properties: {
      _id: oid(),
      reference: str({ readOnly: true, description: 'PYT-xxxxxx, server-assigned.' }),
      kind: str({ enum: PAYOUT_KIND }),
      currency: str({ enum: CURRENCY }),
      periodStart: date(),
      periodEnd: date(),
      lines: arr(ref('PayoutLine')),
      lineCount: int({ minimum: 0, readOnly: true }),
      gross: num({ minimum: 0, readOnly: true }),
      platformFee: num({ minimum: 0, readOnly: true }),
      net: num({ minimum: 0, readOnly: true }),
      approvedBy: oid(),
      approvedAt: date(),
      settledAt: date(),
      skipped: arr({
        type: 'object',
        properties: { payment: oid(), reason: str() },
      }),
      notes: str({ maxLength: 2000 }),
      status: str({ enum: PAYOUT_BATCH_STATUS, readOnly: true }),
      settledLineCount: int({ minimum: 0, readOnly: true }),
    },
    required: ['kind', 'currency', 'lineCount', 'gross', 'net', 'status'],
  }),

  PayoutBatchList: arr(ref('PayoutBatch')),

  BuildPayoutBatchRequest: {
    type: 'object',
    description:
      'A query, not a list of lines. The server reads the ledger and computes the amounts — a client that could post its own line amounts could pay itself.',
    properties: {
      kind: str({ enum: PAYOUT_KIND }),
      currency: str({ enum: CURRENCY }),
      periodStart: date(),
      periodEnd: date(),
      maxRows: int({ minimum: 1, maximum: 5000 }),
      notes: str({ maxLength: 2000 }),
    },
    required: ['kind'],
  },

  SettlePayoutBatchRequest: {
    type: 'object',
    properties: {
      confirmNet: num({
        minimum: 0,
        description: 'Must equal the stored net. Guards a stale approval screen releasing a rebuilt batch.',
      }),
      notes: str({ maxLength: 2000 }),
    },
    required: ['confirmNet'],
  },

  CancelPayoutBatchRequest: {
    type: 'object',
    properties: { reason: str({ maxLength: 1000 }) },
    required: ['reason'],
  },

  TransferSummary: {
    type: 'object',
    properties: {
      attempted: int({ minimum: 0 }),
      accepted: int({ minimum: 0 }),
      deduplicated: int({ minimum: 0, description: 'Lines whose idempotency key had already been seen. A retried settle does not pay twice.' }),
      failed: int({ minimum: 0 }),
      provider: str(),
    },
    required: ['attempted', 'accepted', 'deduplicated', 'failed', 'provider'],
  },

  PayoutSettlement: {
    type: 'object',
    description:
      'Never reports `settled`. The rail returns `pending`; the batch moves to `settling` and waits.',
    properties: {
      batch: ref('PayoutBatch'),
      transfers: ref('TransferSummary'),
    },
    required: ['batch', 'transfers'],
  },

  RefreshRequest: {
    type: 'object',
    properties: { refreshToken: str({ minLength: 10 }) },
    required: ['refreshToken'],
  },

  /**
   * Writing down money that changed hands in a room.
   *
   * Note what is absent and cannot be supplied: `status` (always succeeded),
   * `recordedBy` (from the token), `reference` (derived, for idempotency),
   * `platformFee` and `netAmount` (derived by the model). The schema is strict,
   * so sending one is a refusal rather than a silent drop.
   */
  RecordPaymentRequest: {
    type: 'object',
    properties: {
      payer: oid('The member the money came from, as a USER id. The server joins to their profile.'),
      subject: oid('The lease the money is against, where there is one.'),
      subjectKind: str({ enum: ['Lease', 'MaintenanceRequest'] }),
      kind: str({
        enum: ['rent', 'deposit'],
        description: 'Only these two. A payout recorded by hand would mark money as sent that was never sent.',
      }),
      method: str({ enum: ['cash', 'mobileMoney', 'bankTransfer'], default: 'cash' }),
      amount: { type: 'number', exclusiveMinimum: 0, maximum: 500000 },
      currency: str({ enum: CURRENCY }),
      paidAt: str({ format: 'date-time', description: 'When the money changed hands, which is not when it was typed in. A future date is refused.' }),
      notes: str({ maxLength: 2000 }),
    },
    required: ['payer', 'kind', 'amount'],
  },

  /**
   * Drawing up a tenancy from inside the portal.
   *
   * `landlord`, `status`, `totalPaid`, `arrearsAmount` and `reference` are all
   * absent and cannot be supplied — the schema is strict, so sending one is a
   * refusal rather than a silent drop.
   */
  MemberCreateLeaseRequest: {
    type: 'object',
    properties: {
      property: oid(),
      tenant: oid('The tenant, as a USER id. The server joins to their profile.'),
      monthlyRent: { type: 'number', exclusiveMinimum: 0 },
      currency: str({ enum: CURRENCY }),
      leaseStart: str({ format: 'date-time' }),
      leaseEnd: {
        type: ['string', 'null'], format: 'date-time',
        description:
          'OPTIONAL. Absent or null means a month-to-month tenancy, which is ordinary in The Gambia. A required end date would force whoever writes the lease to invent one that then looks like a commitment.',
      },
      paymentDayOfMonth: int({ minimum: 1, maximum: 31 }),
      securityDeposit: { type: 'number', minimum: 0 },
    },
    required: ['property', 'tenant', 'monthlyRent', 'leaseStart'],
  },

  /** Activating or completing. The id, and nothing else to get wrong. */
  LeaseActionRequest: {
    type: 'object',
    properties: { lease: oid() },
    required: ['lease'],
  },

  /** Ending a tenancy early. The reason is not optional. */
  LeaseTerminateRequest: {
    type: 'object',
    properties: {
      lease: oid(),
      reason: str({
        minLength: 4, maxLength: 600,
        description:
          'Required. The tenant is told, and a terminated lease with no stated reason is a fact about somebody\'s housing that nobody has to defend.',
      }),
    },
    required: ['lease', 'reason'],
  },

  /* ── Security ──────────────────────────────────────────────────────────── */

  /** What a browser sends. See the endpoint's notes for what it may not send. */
  ErrorReportRequest: {
    type: 'object',
    properties: {
      kind: str({
        enum: ['uncaught', 'unhandledRejection', 'frameworkMissing',
               'networkFailure', 'deadPath', 'assetFailure'],
        description:
          '`deadPath` is the one nothing throws for: a control that should do something and does not. It is the most valuable kind here — a member meeting it has no vocabulary to report it.',
      }),
      message: str({ minLength: 1, maxLength: 1000 }),
      source: str({ maxLength: 600, description: 'The script. Code, not data.' }),
      line: int({ minimum: 0 }),
      column: int({ minimum: 0 }),
      stack: str({ maxLength: 4000, description: 'Truncated and redacted before storage.' }),
      url: str({ maxLength: 2000, description: 'Reduced to a path template server-side. Never stored raw — a query string is where a name goes.' }),
      control: str({ maxLength: 200, description: 'Which control, for a dead path.' }),
    },
    required: ['kind', 'message'],
  },

  /** Deliberately empty of information. See the endpoint's notes. */
  ErrorReceipt: {
    type: 'object',
    properties: { received: bool() },
    required: ['received'],
  },

  ErrorReport: {
    type: 'object',
    properties: {
      id: oid(),
      kind: str(),
      severity: str({ enum: ['noise', 'degraded', 'blocking'] }),
      message: str(),
      path: str({ description: 'A path template, never a real URL.' }),
      source: str(),
      line: int(),
      stack: str(),
      control: str(),
      reportedBy: oid('Null for a fault reported before sign-in.'),
      summary: str({ description: 'Plain English, computed on read. Never a stack — a coordinator is being asked whether a member is stuck, not to debug.' }),
      createdAt: str({ format: 'date-time' }),
      expiresAt: str({ format: 'date-time', description: '90 days. A retention decision, not a storage one.' }),
    },
    required: ['id', 'kind', 'severity', 'message', 'path'],
  },

  ErrorReportList: arr(ref('ErrorReport')),

  AnomalyFeed: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            signal: str(),
            action: str({ enum: ['watch', 'escalate'], description: 'The ceiling is `escalate`. Nothing here blocks or locks.' }),
            count: int({ minimum: 0 }),
            windowMinutes: int({ minimum: 1 }),
            subject: oid(),
            address: str(),
            summary: str(),
          },
          required: ['signal', 'action', 'count', 'summary'],
        },
      },
      note: str({ description: 'Says that counts are per process, so a reader knows why they look low.' }),
      reportsPerBrowserPerWindow: int({ minimum: 1 }),
    },
    required: ['findings'],
  },

  /* ── Ususu groups ──────────────────────────────────────────────────────── */

  UsusuGroup: {
    type: 'object',
    properties: {
      id: oid(),
      name: str({ maxLength: 160 }),
      createdBy: oid('The coordinator who runs it. Holds the register, not the money.'),
      members: { type: 'array', items: oid() },
      status: str({ enum: ['forming', 'active', 'paused', 'closed'] }),
      contributionAmount: { type: 'number', minimum: 0 },
      currency: str({ enum: CURRENCY }),
      region: str(),
      note: str({ maxLength: 600 }),
      createdAt: str({ format: 'date-time' }),
      updatedAt: str({ format: 'date-time' }),
    },
    required: ['id', 'name', 'createdBy', 'members', 'status'],
  },

  UsusuGroupList: arr(ref('UsusuGroup')),

  /**
   * A circle's ledger, summarised.
   *
   * `groupHealth` and `streaks` are computed on every read and never stored —
   * a stored streak is a number somebody can correct by hand, and it goes stale
   * the moment a contribution is recorded out of order.
   */
  UsusuGroupSummary: {
    type: 'object',
    properties: {
      group: ref('UsusuGroup'),
      memberCount: int({ minimum: 0 }),
      contributions: int({ minimum: 0 }),
      misses: int({ minimum: 0 }),
      groupHealth: {
        type: ['number', 'null'], minimum: 0, maximum: 100,
        description:
          '100 minus five per miss, floored at zero. NULL when nobody has contributed yet — a circle formed on Tuesday is not in perfect health and is not in bad health.',
      },
      streaks: {
        type: 'object',
        additionalProperties: int({ minimum: 0 }),
        description:
          'Consecutive contributions per member, counted BACKWARDS from the latest period. A member in the circle with no entries gets a real 0.',
      },
      contributedByCurrency: {
        type: 'array',
        description: 'One entry per currency, never summed. There is no exchange rate on this platform.',
        items: {
          type: 'object',
          properties: {
            currency: str({ enum: CURRENCY }),
            amount: { type: 'number', minimum: 0 },
            entries: int({ minimum: 0 }),
          },
          required: ['currency', 'amount', 'entries'],
        },
      },
      hasActivity: bool({ description: 'Whether anything has been recorded at all.' }),
      entries: {
        type: 'array',
        description: 'Oldest first, so a page renders the history in the order it happened.',
        items: {
          type: 'object',
          properties: {
            member: oid(),
            kind: str({ enum: ['contribution', 'miss'] }),
            period: str({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }),
            amount: { type: 'number', minimum: 0 },
            currency: str({ enum: CURRENCY }),
          },
          required: ['member', 'kind', 'period'],
        },
      },
    },
    required: ['memberCount', 'contributions', 'misses', 'groupHealth', 'streaks', 'hasActivity'],
  },

  CreateUsusuGroupRequest: {
    type: 'object',
    properties: {
      name: str({ minLength: 2, maxLength: 160 }),
      members: { type: 'array', maxItems: 50, items: oid() },
      contributionAmount: { type: 'number', minimum: 0 },
      currency: str({ enum: CURRENCY }),
      region: str({ maxLength: 120 }),
      note: str({ maxLength: 600 }),
    },
    required: ['name'],
  },

  UsusuGroupMemberRequest: {
    type: 'object',
    properties: { group: oid(), member: oid() },
    required: ['group', 'member'],
  },

  UsusuGroupContributionRequest: {
    type: 'object',
    properties: {
      group: oid(),
      member: oid(),
      period: str({
        pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
        description: 'YYYY-MM. What a streak is counted over and what makes a duplicate detectable.',
      }),
      amount: { type: 'number', minimum: 0 },
      currency: str({ enum: CURRENCY }),
      note: str({ maxLength: 600 }),
    },
    required: ['group', 'member', 'period', 'amount'],
  },

  UsusuGroupMissRequest: {
    type: 'object',
    properties: {
      group: oid(),
      member: oid(),
      period: str({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }),
      note: str({ maxLength: 600 }),
    },
    required: ['group', 'member', 'period'],
  },

  /** Raising a work order from inside a tenancy. */
  RaiseMaintenanceRequest: {
    type: 'object',
    properties: {
      property: oid(),
      title: str({ minLength: 3, maxLength: 240 }),
      description: str({ maxLength: 5000 }),
      serviceType: str(),
      priority: str({
        enum: ['low', 'normal', 'high', 'emergency'],
        description: 'How urgent the person reporting it thinks it is. Triage may change it.',
      }),
      photosBefore: {
        type: 'array', maxItems: 8, items: str(),
        description: 'Storage keys, never URLs. An address a client supplies is an address a client controls.',
      },
    },
    required: ['property', 'title', 'serviceType'],
  },

  /** Moving a request along. `note` is required for some targets, not all. */
  UpdateMaintenanceStatusRequest: {
    type: 'object',
    properties: {
      request: oid(),
      status: str({
        enum: ['open', 'triaged', 'assigned', 'quoted', 'approved', 'inProgress',
               'onHold', 'completed', 'verified', 'cancelled'],
      }),
      note: str({
        maxLength: 1000,
        description:
          'REQUIRED when cancelling or parking a request, and when sending one back from completed. Whoever raised it is told what happened, and a bare status change reads as an accident.',
      }),
    },
    required: ['request', 'status'],
  },

  /**
   * Signing out. `refreshToken` is optional on purpose — see the note on the
   * endpoint. A sign-out with nothing to revoke still succeeds.
   */
  LogoutRequest: {
    type: 'object',
    properties: {
      refreshToken: str({
        minLength: 10,
        description:
          'The session\'s refresh token. Send it: revoking it is what makes signing out mean anything server-side. Omitted, the reply says nothing was revoked.',
      }),
    },
  },

  /**
   * What LRMC tells a payment gateway.
   *
   * Read by Stripe and by nobody else, which is why it carries no order and no
   * money: a webhook response is an acknowledgement, and anything more in it is
   * information handed to whoever can reach the endpoint.
   *
   * `received: true` accompanies almost every outcome on purpose — a non-2xx
   * tells Stripe to retry, and retrying cannot fix a duplicate, an unhandled
   * event type, or an event about an order that does not exist.
   */
  WebhookAck: {
    type: 'object',
    properties: {
      received: bool({ description: 'Always true when the signature verified.' }),
      outcome: str({
        description:
          'What was done: settled, alreadyApplied, inFlight, retryStale, ignoredType, unknownOrder, refused, recorded, unparseable or noEventId.',
      }),
      eventId: str({ description: "The gateway's event id, echoed for correlation." }),
      type: str({ description: 'The event type, when it was not acted on.' }),
    },
    required: ['received', 'outcome'],
  },

  SignOutOutcome: {
    type: 'object',
    properties: {
      signedOut: bool({
        description: 'Always true. The local session ends regardless of what could be revoked.',
      }),
      refreshRevoked: bool({
        description:
          'Whether a refresh token was presented and is now denied. False means any refresh token for this session remains valid until it expires.',
      }),
      note: str({
        description: 'Present when nothing was revoked, explaining why.',
      }),
    },
    required: ['signedOut', 'refreshRevoked'],
  },

  ChangePasswordRequest: {
    type: 'object',
    properties: {
      currentPassword: str(),
      newPassword: str({
        minLength: 10,
        description: 'At least 10 characters, with upper case, lower case and a digit.',
      }),
    },
    required: ['currentPassword', 'newPassword'],
  },

  AssignRolesRequest: {
    type: 'object',
    description: 'Founder appointment. Replaces the held roles outright.',
    properties: {
      roles: arr(str()),
      primaryRole: str(),
      regions: strArr(),
    },
    required: ['roles'],
  },

  AssignPropertiesRequest: {
    type: 'object',
    description: 'Posts a coordinator to a set of properties, replacing the current assignment.',
    properties: { propertyIds: arr(oid()) },
    required: ['propertyIds'],
  },

  DriverOnlineRequest: {
    type: 'object',
    description: 'Refused unless the driver is verified.',
    properties: {
      isOnline: bool(),
      longitude: num({ minimum: -180, maximum: 180 }),
      latitude: num({ minimum: -90, maximum: 90 }),
    },
    required: ['isOnline'],
  },

  AdTrackRequest: {
    type: 'object',
    description:
      'Impression or click beacon. Deduped per session inside the configured window — a repeat returns counted:false rather than an error.',
    properties: {
      adId: oid(),
      zone: str({ enum: ['PUBLIC_PORTAL', 'MEMBER_PORTAL', 'USUSU_PORTAL'] }),
      placement: str(),
      sessionId: str({ maxLength: 120 }),
      region: str(),
      beacon: str({ maxLength: 64, description: 'The token returned by /ads/serve.' }),
    },
    required: ['adId', 'zone'],
  },

  AdStatusRequest: {
    type: 'object',
    properties: { action: str({ enum: ['activate', 'pause', 'archive'] }) },
    required: ['action'],
  },

  AdReviewRequest: {
    type: 'object',
    description: 'HQ approval. A rejection must carry a reason.',
    properties: {
      decision: str({ enum: ['approve', 'reject'] }),
      reason: str({ maxLength: 1000 }),
    },
    required: ['decision'],
  },

  AdvertiserTermsRequest: {
    type: 'object',
    description: 'Founder-set commercial terms. Outside the advertiser’s own reach.',
    properties: {
      creditLimit: num({ minimum: 0 }),
      agreedCPM: num({ minimum: 0 }),
      agreedCPC: num({ minimum: 0 }),
      strikes: int({ minimum: 0, maximum: 10 }),
      notes: str({ maxLength: 2000 }),
    },
  },

  TrafficEventRequest: {
    type: 'object',
    properties: {
      domain: str({ maxLength: 120 }),
      path: str({ maxLength: 500 }),
      referrer: str({ maxLength: 500 }),
      sessionId: str({ maxLength: 120 }),
      country: str({ maxLength: 60 }),
      device: str({ enum: ['mobile', 'tablet', 'desktop', 'unknown'] }),
      isConversion: bool(),
      conversionGoal: str({
        enum: [
          'contactForm', 'tenantApplication', 'landlordEnquiry', 'driverApplication',
          'vendorApplication', 'advertiserEnquiry', 'quoteRequest', 'newsletterSignup',
          'accountCreated',
        ],
      }),
    },
    required: ['domain', 'path'],
  },


  // ── Composite payloads ───────────────────────────────────────────────────
  // These are response shapes rather than persisted resources: dashboards,
  // directories and the contract endpoints. Typed properly because a payload
  // documented as `object` is not documented at all.

  User: {
    type: 'object',
    description: 'The account. One credential, one or more roles; profiles are separate documents.',
    properties: {
      id: { ...oid(), readOnly: true },
      fullName: str({ maxLength: 160 }),
      email: str({ format: 'email' }),
      phone: str(),
      WhatsApp: str(),
      roles: strArr(),
      primaryRole: str(),
      profiles: arr({
        type: 'object',
        properties: { role: str(), profileId: oid(), profileModel: str() },
      }),
      organizationId: oid(),
      regions: strArr(),
      homeZone: str(),
      isVerified: bool(),
      verificationStatus: str({ enum: VERIFICATION_STATUS }),
      status: str({ enum: ['pending', 'active', 'suspended', 'archived'] }),
      locale: str({ default: 'en-GH' }),
      timezone: str({ default: 'Africa/Accra' }),
      lastLoginAt: { ...date(), readOnly: true },
      createdAt: { ...date(), readOnly: true },
      updatedAt: { ...date(), readOnly: true },
    },
  },

  RoleDefinition: {
    type: 'object',
    properties: {
      accessScope: str({ enum: ['global', 'regional', 'zonal', 'organizational', 'own', 'public'] }),
      serviceLine: str({ enum: ['LRMC', 'USUSU', 'BOTH', 'REVENUE', 'PUBLIC'] }),
      permissions: strArr(),
      allowedZones: strArr(),
      restrictedZones: strArr(),
      allowedActions: strArr(),
      requiresVerification: bool(),
      profileModel: str({ nullable: true }),
    },
  },

  RoleMatrixRow: {
    type: 'object',
    properties: {
      role: str(),
      label: str(),
      serviceLine: str(),
      accessScope: str(),
      permissionCount: int(),
      allowedZones: strArr(),
      restrictedZones: strArr(),
      allowedActionCount: int(),
    },
  },

  RoleCatalogue: {
    type: 'object',
    description: 'The whole RBAC contract. Frontends build route guards from this.',
    properties: {
      roles: arr(ref('RoleMatrixRow')),
      detail: {
        type: 'object',
        additionalProperties: ref('RoleDefinition'),
        description: 'Keyed by role name.',
      },
    },
  },

  ResolvedRoles: {
    type: 'object',
    description: 'Founder debug: what a hypothetical role combination resolves to.',
    properties: { roles: strArr(), grants: strArr(), allowedActions: strArr() },
  },

  HQZone: {
    type: 'object',
    properties: {
      code: str({ enum: ['A', 'B', 'C', 'D', 'E'] }),
      key: str(),
      label: str(),
      purpose: str(),
      capabilities: strArr(),
      surfaces: strArr(),
      oversees: strArr(),
      dataFirewall: { ...strArr(), description: 'Never visible in this zone, whatever the role permits.' },
      accessible: { ...bool(), description: 'Whether the calling actor may enter.' },
    },
  },

  HQZoneDetail: allOf(ref('HQZone'), {
    type: 'object',
    properties: {
      entryPermissions: strArr(),
      lineOfSight: { ...strArr(), description: 'Zones readable through this one, including itself.' },
    },
  }),

  ZoneDirectory: {
    type: 'object',
    properties: {
      zones: arr(ref('HQZone')),
      yourZones: strArr(),
      restrictedZones: strArr(),
    },
  },

  KPISnapshot: {
    type: 'object',
    description: 'Members, commercial clients, portfolio, verification queue and ad revenue.',
    properties: {
      generatedAt: date(),
      members: {
        type: 'object',
        properties: {
          landlords: int(), tenants: int(), coordinators: int(),
          vendors: int(), drivers: int(), riders: int(), total: int(),
        },
      },
      commercialClients: {
        type: 'object',
        properties: {
          airbnbHosts: int(), hotels: int(), resorts: int(),
          rentalCarCompanies: int(), total: int(),
        },
      },
      portfolio: {
        type: 'object',
        properties: {
          properties: int(), occupied: int(), vacant: int(),
          occupancyRatePercent: num(), underMaintenance: int(), publiclyListed: int(),
        },
      },
      verification: {
        type: 'object',
        properties: { pending: int(), inReview: int(), verified: int(), rejected: int() },
      },
      revenue: {
        type: 'object',
        properties: {
          advertisers: int(), activeAds: int(), impressions30d: int(),
          clicks30d: int(), ctr30d: num(),
        },
      },
      staff: { type: 'object', properties: { backOffice: int(), accounts: int() } },
    },
  },

  SystemHealth: {
    type: 'object',
    properties: {
      status: str({ enum: ['ok', 'degraded', 'down'] }),
      uptimeSeconds: int(),
      database: {
        type: 'object',
        properties: { state: str(), readyState: int(), name: str(), host: str() },
      },
      memory: { type: 'object', properties: { rssMB: int(), heapUsedMB: int() } },
      node: str(),
      collections: int(),
      checkedAt: date(),
    },
  },

  RegionalPerformance: {
    type: 'object',
    properties: {
      region: str(),
      properties: int(),
      occupied: int(),
      coordinators: int(),
      vendors: int(),
      drivers: int(),
    },
  },

  RegionalPerformanceList: arr(ref('RegionalPerformance')),
  AuditLogList: arr(ref('AuditLogEntry')),
  AdPolicyList: arr(ref('AdPolicy')),
  PublicListingList: arr(ref('PublicListing')),
  PublicContentList: arr(ref('PublicContent')),

  ExecutiveDashboard: {
    type: 'object',
    description: 'Zone B, in one call.',
    properties: {
      kpis: ref('KPISnapshot'),
      health: ref('SystemHealth'),
      regions: arr(ref('RegionalPerformance')),
      roleMatrix: arr(ref('RoleMatrixRow')),
    },
  },

  CommandCenter: {
    type: 'object',
    description: 'Zone A console.',
    properties: {
      zones: arr(ref('HQZoneDetail')),
      kpis: ref('KPISnapshot'),
      health: ref('SystemHealth'),
      regions: arr(ref('RegionalPerformance')),
      recentAudit: arr(ref('AuditLogEntry')),
      roleMatrix: arr(ref('RoleMatrixRow')),
    },
  },

  DriverVerificationQueue: {
    type: 'object',
    description: 'Pending drivers, plus any whose licence or insurance lapses inside 30 days.',
    properties: { items: arr(ref('Driver')), meta: ref('PageMeta') },
  },

  FleetUtilization: {
    type: 'object',
    properties: {
      companyName: str(),
      fleetSize: int({ description: 'Vehicles not retired.' }),
      utilizationPercent: num(),
      byStatus: {
        type: 'object',
        additionalProperties: int(),
        description: 'Count keyed by availability.',
      },
      suppliesUsusu: bool(),
    },
  },

  ServeAdsResponse: {
    type: 'object',
    properties: {
      zone: str({ enum: ['PUBLIC_PORTAL', 'MEMBER_PORTAL', 'USUSU_PORTAL'] }),
      count: int(),
      ads: arr(ref('ServedAd')),
    },
  },

  TrackResult: {
    type: 'object',
    description: 'counted:false means the beacon fell inside the dedupe window — not an error.',
    properties: { counted: bool() },
    required: ['counted'],
  },

  TrackAccepted: {
    type: 'object',
    properties: { recorded: bool() },
    required: ['recorded'],
  },

  RotationPreview: {
    type: 'object',
    description: 'Dry-run of the rotation engine: what would serve now, and at what weight.',
    properties: {
      zone: str(),
      policy: {
        type: 'object',
        properties: {
          pacingEnabled: bool(),
          maxAdvertiserSharePercent: num(),
          bannedCategories: strArr(),
          houseAdOnlyZones: strArr(),
        },
      },
      wouldServe: arr({
        type: 'object',
        properties: {
          id: oid(),
          title: str(),
          advertiserName: str(),
          category: str(),
          effectiveWeight: num(),
        },
      }),
    },
  },

  TrafficMetrics: {
    type: 'object',
    properties: {
      windowDays: int(),
      pageViews: int(),
      sessions: int(),
      conversions: int(),
      conversionRatePercent: num(),
      byDomain: arr({ type: 'object', properties: { domain: str(), views: int() } }),
      topPaths: arr({ type: 'object', properties: { path: str(), views: int() } }),
      byGoal: arr({ type: 'object', properties: { goal: str(), count: int() } }),
      byDevice: arr({ type: 'object', properties: { device: str(), count: int() } }),
    },
  },

  PlatformIndex: {
    type: 'object',
    properties: {
      platform: str(),
      version: str(),
      environment: str({ enum: ['development', 'test', 'production'] }),
      roles: strArr(),
      hqZones: arr(ref('HQZone')),
      endpoints: strArr(),
      blueprint: str(),
      openapi: str(),
    },
  },

  BlueprintEndpoint: {
    type: 'object',
    properties: {
      method: str({ enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] }),
      path: str(),
      module: str(),
      summary: str(),
      zone: str({ nullable: true }),
      auth: str({ enum: ['required', 'optional', 'none'] }),
      permissions: strArr(),
      ownership: str({ enum: ['none', 'scoped', 'self'] }),
      requestBody: str(),
      requestQuery: str(),
      responseShape: str(),
      surface: str({ enum: ['profile', 'custom'] }),
      roles: { ...strArr(), description: 'Only present when a founder passes ?all=true.' },
    },
  },

  BlueprintResponse: {
    type: 'object',
    description:
      'The live contract, filtered to what the caller can reach. What the PWA shells build navigation and route guards from.',
    properties: {
      prefix: str(),
      total: int(),
      reachable: int(),
      as: str({ description: 'The role the filter was applied for, or "anonymous".' }),
      endpoints: arr(ref('BlueprintEndpoint')),
      scopes: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: { ownerPath: str(), organizationPath: str(), describes: str() },
        },
      },
      zones: arr(ref('HQZone')),
    },
  },

  OpenApiDocument: {
    type: 'object',
    description: 'This document. Returned raw, not enveloped — a spec inside an envelope is not readable by any tool.',
    properties: {
      openapi: str({ const: '3.1.0' }),
      info: { type: 'object' },
      servers: arr({ type: 'object' }),
      paths: { type: 'object' },
      components: { type: 'object' },
    },
  },

};

export const COMPONENT_SCHEMAS: Record<string, JsonSchema> = {
  ...ENVELOPES,
  ...FRAGMENTS,
  ...RESOURCES,
};

/**
 * Maps a blueprint `responseShape` string onto a component schema name, so the
 * OpenAPI document stays tied to the same declaration the router and the
 * markdown reference come from.
 */
export const RESPONSE_SCHEMA_BY_LABEL: Record<string, string> = {
  'Founder profile': 'Founder',
  'HQ executive profile': 'HQExecutive',
  'Back office staff profile': 'BackOfficeStaff',
  'Landlord profile': 'Landlord',
  'Tenant profile': 'Tenant',
  'Coordinator profile': 'Coordinator',
  'Vendor profile': 'Vendor',
  'Airbnb host profile': 'AirbnbHost',
  'Hotel profile': 'Hotel',
  'Resort profile': 'Resort',
  'Rental car company profile': 'RentalCarCompany',
  'Driver profile': 'Driver',
  'Merchant profile': 'Merchant',
  'Customer profile': 'Customer',
  'Rider profile': 'Rider',
  'Advertiser profile': 'Advertiser',
  Property: 'Property',
  Ad: 'Ad',
  'Public content': 'PublicContent',
};

/** Zod schema name → request body component. */
export const REQUEST_SCHEMA_BY_NAME: Record<string, string> = {
  createFounderSchema: 'Founder',
  updateFounderSchema: 'Founder',
  createHQExecutiveSchema: 'HQExecutive',
  updateHQExecutiveSchema: 'HQExecutive',
  createBackOfficeStaffSchema: 'BackOfficeStaff',
  updateBackOfficeStaffSchema: 'BackOfficeStaff',
  createLandlordSchema: 'Landlord',
  updateLandlordSchema: 'Landlord',
  createTenantSchema: 'Tenant',
  updateTenantSchema: 'Tenant',
  createCoordinatorSchema: 'Coordinator',
  updateCoordinatorSchema: 'Coordinator',
  createVendorSchema: 'Vendor',
  updateVendorSchema: 'Vendor',
  createAirbnbHostSchema: 'AirbnbHost',
  updateAirbnbHostSchema: 'AirbnbHost',
  createHotelSchema: 'Hotel',
  updateHotelSchema: 'Hotel',
  createResortSchema: 'Resort',
  updateResortSchema: 'Resort',
  createRentalCarCompanySchema: 'RentalCarCompany',
  updateRentalCarCompanySchema: 'RentalCarCompany',
  createDriverSchema: 'Driver',
  updateDriverSchema: 'Driver',
  createRiderSchema: 'Rider',
  updateRiderSchema: 'Rider',
  createAdvertiserSchema: 'Advertiser',
  updateAdvertiserSchema: 'Advertiser',
  createPropertySchema: 'Property',
  updatePropertySchema: 'Property',
  createAdSchema: 'Ad',
  updateAdSchema: 'Ad',
  createContentSchema: 'PublicContent',
  updateContentSchema: 'PublicContent',
  verificationBody: 'VerificationRequest',
  registerSchema: 'RegisterRequest',
  loginSchema: 'LoginRequest',
  adPolicySchema: 'AdPolicy',
  fleetVehicleInput: 'FleetVehicle',
  createLeaseSchema: 'Lease',
  updateLeaseSchema: 'Lease',
  recordRentPaymentSchema: 'RecordRentPaymentRequest',
  createMaintenanceRequestSchema: 'MaintenanceRequest',
  updateMaintenanceRequestSchema: 'MaintenanceRequest',
  assignVendorSchema: 'AssignVendorRequest',
  requestRideSchema: 'RequestRideRequest',
  acceptRideSchema: 'AcceptRideRequest',
  startRideSchema: 'StartRideRequest',
  completeRideSchema: 'CompleteRideRequest',
  cancelRideSchema: 'CancelRideRequest',
  updateRideSchema: 'UpdateRideRequest',
  registerPushTokenSchema: 'PushTokenRegistration',
  sendTestNotificationSchema: 'SendTestNotificationRequest',
  markNotificationSchema: 'MarkNotificationRequest',
  createCommercialClientSchema: 'CommercialClient',
  runRentRemindersSchema: 'RunRentRemindersRequest',
  runSlaEscalationSchema: 'RunSlaEscalationRequest',
  broadcastNotificationSchema: 'BroadcastNotificationRequest',
  buildPayoutBatchSchema: 'BuildPayoutBatchRequest',
  settlePayoutBatchSchema: 'SettlePayoutBatchRequest',
  cancelPayoutBatchSchema: 'CancelPayoutBatchRequest',
  createDocumentSchema: 'DocumentInput',
  updateDocumentSchema: 'DocumentPatch',
  submitDocumentSchema: 'SubmitDocumentRequest',
  reviewDocumentSchema: 'ReviewDocumentRequest',
  requestInfoSchema: 'RequestInfoRequest',
  verifyDocumentSchema: 'VerifyDocumentRequest',
  rejectDocumentSchema: 'RejectDocumentRequest',
  expireDocumentSchema: 'ExpireDocumentRequest',
  reverifyDocumentSchema: 'ReverifyDocumentRequest',
  issueFacCodeSchema: 'IssueFacCodeRequest',
  verifyFacCodeSchema: 'VerifyFacCodeRequest',
  revokeFacCodeSchema: 'RevokeFacCodeRequest',
  clearLockoutSchema: 'ClearLockoutRequest',

  // Marketplace
  createMerchantSchema: 'Merchant',
  updateMerchantSchema: 'Merchant',
  merchantSellersSchema: 'MerchantSellersRequest',
  createCustomerSchema: 'Customer',
  updateCustomerSchema: 'Customer',
  customerBuyersSchema: 'CustomerBuyersRequest',
  createListingSchema: 'Listing',
  updateListingSchema: 'Listing',
  suspendListingSchema: 'SuspendListingRequest',
  placeOrderSchema: 'PlaceOrderRequest',
  payOrderSchema: 'PayOrderRequest',
  fulfilOrderSchema: 'FulfilOrderRequest',
  cancelOrderSchema: 'CancelOrderRequest',
  disputeOrderSchema: 'DisputeOrderRequest',
  resolveDisputeSchema: 'ResolveDisputeRequest',
  facResetRequestSchema: 'FacResetRequestBody',
  updateCommercialClientSchema: 'CommercialClient',
  refreshSchema: 'RefreshRequest',
  recordPaymentSchema: 'RecordPaymentRequest',
  memberCreateLeaseSchema: 'MemberCreateLeaseRequest',
  createUsusuGroupSchema: 'CreateUsusuGroupRequest',
  errorReportSchema: 'ErrorReportRequest',
  groupMemberSchema: 'UsusuGroupMemberRequest',
  groupContributionSchema: 'UsusuGroupContributionRequest',
  groupMissSchema: 'UsusuGroupMissRequest',
  leaseActionSchema: 'LeaseActionRequest',
  leaseTerminateSchema: 'LeaseTerminateRequest',
  raiseMaintenanceSchema: 'RaiseMaintenanceRequest',
  updateMaintenanceStatusSchema: 'UpdateMaintenanceStatusRequest',
  logoutSchema: 'LogoutRequest',
  changePasswordSchema: 'ChangePasswordRequest',
  assignRoleSchema: 'AssignRolesRequest',
  assignPropertiesSchema: 'AssignPropertiesRequest',
  onlineStatusSchema: 'DriverOnlineRequest',
  trackSchema: 'AdTrackRequest',
  adStatusSchema: 'AdStatusRequest',
  adReviewSchema: 'AdReviewRequest',
  advertiserTermsSchema: 'AdvertiserTermsRequest',
  requestViewingSchema: 'RequestViewingRequest',
  updateViewingSchema: 'UpdateViewingRequest',
  viewingDecisionSchema: 'ViewingDecisionRequest',
  viewingOutcomeSchema: 'ViewingOutcomeRequest',
  createApplicationSchema: 'CreateApplicationRequest',
  updateApplicationSchema: 'CreateApplicationRequest',
  decideApplicationSchema: 'DecideApplicationRequest',
  requestFromApplicantSchema: 'RequestFromApplicantRequest',
  requestReferenceSchema: 'RequestReferenceRequest',
  respondToReferenceSchema: 'RespondToReferenceRequest',
  openDisputeSchema: 'OpenDisputeRequest',
  resolveMemberDisputeSchema: 'ResolveMemberDisputeRequest',
  ususuContributionSchema: 'UsusuContributionRequest',
  ususuMissSchema: 'UsusuMissRequest',
  trackTrafficSchema: 'TrafficEventRequest',
};
