/**
 * What each kind of document *is* — the rule table the whole engine reads from.
 *
 * Pure and Mongoose-free, like the rent and SLA maths, so `npm run verify` can
 * assert it with no database. More importantly it is *data*: adding a document
 * type is one entry here, and the required fields, the expiry period, the
 * compliance rule, the reviewing desk and the scoring weights all follow. A type
 * added as a branch in a handler instead would be a type the expiry sweep and
 * the completeness score never learn about.
 */

export const DOCUMENT_TYPES = [
  'identity',
  'proofOfResidency',
  'hostConfirmation',
  'rentalAgreement',
  'tenantIntake',
  'propertyOwnership',
  'employmentVerification',
  'incomeProof',
  'maritalStatus',
  'birthRecord',
  'criminalBackground',
  'driverLicence',
  'vehicleInsurance',
  'roadworthiness',
  'businessRegistration',
  'taxClearance',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_CATEGORIES = [
  'identity',
  'tenancy',
  'ownership',
  'employment',
  'household',
  'eligibility',
  'business',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** The desk that reviews a type. Drives `/staff/me/document-queue`. */
export const REVIEW_DESKS = ['backOffice', 'coordinator', 'hqExecutive'] as const;
export type ReviewDesk = (typeof REVIEW_DESKS)[number];

/**
 * `restricted` documents carry data that must not be echoed back on a read —
 * a criminal record check and an ID number are not the same class of thing as a
 * roadworthiness certificate.
 */
export const SENSITIVITIES = ['standard', 'restricted'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

/** Compliance rule keys. One per cross-entity check; see `compliance.ts`. */
export const COMPLIANCE_RULES = [
  'residencyMatchesProperty',
  'hostConfirmationMatchesLandlord',
  'rentalAgreementMatchesLease',
  'tenantIntakeMatchesProfile',
  'propertyOwnershipMatchesClient',
  'employmentMatchesEmployer',
  'identityMatchesProfile',
  'maritalStatusMatchesHousehold',
  'birthRecordMatchesDependent',
  'criminalBackgroundMatchesEligibility',
] as const;
export type ComplianceRuleKey = (typeof COMPLIANCE_RULES)[number];

export interface DocumentTypeRule {
  type: DocumentType;
  label: string;
  category: DocumentCategory;
  /** Absent or empty and the document cannot leave `submitted`. */
  requiredFields: readonly string[];
  optionalFields: readonly string[];
  /** Null means the document does not expire — a birth record never does. */
  expiryMonths: number | null;
  /** Whether an expired document must be re-verified rather than merely renewed. */
  reverifyOnExpiry: boolean;
  /** The cross-entity check run before this type can be verified. */
  compliance: ComplianceRuleKey | null;
  /** What the document may be attached to. */
  subjectKinds: readonly string[];
  desk: ReviewDesk;
  sensitivity: Sensitivity;
}

const rule = (r: DocumentTypeRule): DocumentTypeRule => r;

export const DOCUMENT_RULES: Record<DocumentType, DocumentTypeRule> = {
  identity: rule({
    type: 'identity',
    label: 'Government identity document',
    category: 'identity',
    requiredFields: ['holderName', 'documentNumber', 'issuingAuthority', 'issuedOn', 'expiresOn'],
    optionalFields: ['dateOfBirth', 'nationality'],
    expiryMonths: null, // The document states its own expiry; we do not impute one.
    reverifyOnExpiry: true,
    compliance: 'identityMatchesProfile',
    subjectKinds: ['User'],
    desk: 'backOffice',
    sensitivity: 'restricted',
  }),
  proofOfResidency: rule({
    type: 'proofOfResidency',
    label: 'Proof of residency',
    category: 'tenancy',
    requiredFields: ['holderName', 'address', 'issuedOn'],
    optionalFields: ['city', 'region', 'issuingAuthority'],
    expiryMonths: 6, // A utility bill from last year proves nothing about today.
    reverifyOnExpiry: false,
    compliance: 'residencyMatchesProperty',
    subjectKinds: ['Property', 'TenantProfile'],
    desk: 'coordinator',
    sensitivity: 'standard',
  }),
  hostConfirmation: rule({
    type: 'hostConfirmation',
    label: 'Host confirmation letter',
    category: 'tenancy',
    requiredFields: ['holderName', 'counterpartyName', 'address', 'issuedOn'],
    optionalFields: ['relationship', 'notes'],
    expiryMonths: 12,
    reverifyOnExpiry: false,
    compliance: 'hostConfirmationMatchesLandlord',
    subjectKinds: ['LandlordProfile', 'TenantProfile'],
    desk: 'coordinator',
    sensitivity: 'standard',
  }),
  rentalAgreement: rule({
    type: 'rentalAgreement',
    label: 'Signed rental agreement',
    category: 'tenancy',
    requiredFields: ['holderName', 'counterpartyName', 'issuedOn', 'periodStart', 'periodEnd', 'amount'],
    optionalFields: ['currency', 'address', 'notes'],
    expiryMonths: null, // It expires when the lease does, not on a fixed clock.
    reverifyOnExpiry: true,
    compliance: 'rentalAgreementMatchesLease',
    subjectKinds: ['Lease'],
    desk: 'backOffice',
    sensitivity: 'standard',
  }),
  tenantIntake: rule({
    type: 'tenantIntake',
    label: 'Tenant intake form',
    category: 'tenancy',
    requiredFields: ['holderName', 'dateOfBirth', 'issuedOn'],
    optionalFields: ['address', 'employerName', 'relationship'],
    expiryMonths: 24,
    reverifyOnExpiry: false,
    compliance: 'tenantIntakeMatchesProfile',
    subjectKinds: ['TenantProfile'],
    desk: 'coordinator',
    sensitivity: 'standard',
  }),
  propertyOwnership: rule({
    type: 'propertyOwnership',
    label: 'Proof of property ownership',
    category: 'ownership',
    requiredFields: ['holderName', 'documentNumber', 'address', 'issuingAuthority', 'issuedOn'],
    optionalFields: ['counterpartyName', 'notes'],
    expiryMonths: null,
    reverifyOnExpiry: true,
    compliance: 'propertyOwnershipMatchesClient',
    subjectKinds: ['Property', 'CommercialClient'],
    desk: 'backOffice',
    sensitivity: 'standard',
  }),
  employmentVerification: rule({
    type: 'employmentVerification',
    label: 'Employment verification letter',
    category: 'employment',
    requiredFields: ['holderName', 'employerName', 'issuedOn'],
    optionalFields: ['jobTitle', 'monthlyIncome', 'currency', 'counterpartyName'],
    expiryMonths: 6,
    reverifyOnExpiry: false,
    compliance: 'employmentMatchesEmployer',
    subjectKinds: ['TenantProfile', 'User'],
    desk: 'backOffice',
    sensitivity: 'standard',
  }),
  incomeProof: rule({
    type: 'incomeProof',
    label: 'Proof of income',
    category: 'employment',
    requiredFields: ['holderName', 'monthlyIncome', 'currency', 'issuedOn'],
    optionalFields: ['employerName', 'periodStart', 'periodEnd'],
    expiryMonths: 3,
    reverifyOnExpiry: false,
    compliance: null,
    subjectKinds: ['TenantProfile', 'User'],
    desk: 'backOffice',
    sensitivity: 'restricted',
  }),
  maritalStatus: rule({
    type: 'maritalStatus',
    label: 'Marital status certificate',
    category: 'household',
    requiredFields: ['holderName', 'counterpartyName', 'issuingAuthority', 'issuedOn'],
    optionalFields: ['documentNumber', 'address'],
    expiryMonths: null,
    reverifyOnExpiry: false,
    compliance: 'maritalStatusMatchesHousehold',
    subjectKinds: ['User', 'TenantProfile'],
    desk: 'backOffice',
    sensitivity: 'restricted',
  }),
  birthRecord: rule({
    type: 'birthRecord',
    label: 'Birth certificate',
    category: 'household',
    requiredFields: ['holderName', 'dateOfBirth', 'issuingAuthority', 'issuedOn'],
    optionalFields: ['documentNumber', 'relationship', 'counterpartyName'],
    expiryMonths: null, // A birth does not lapse.
    reverifyOnExpiry: false,
    compliance: 'birthRecordMatchesDependent',
    subjectKinds: ['User', 'TenantProfile'],
    desk: 'backOffice',
    sensitivity: 'restricted',
  }),
  criminalBackground: rule({
    type: 'criminalBackground',
    label: 'Criminal background check',
    category: 'eligibility',
    requiredFields: ['holderName', 'issuingAuthority', 'issuedOn', 'outcome'],
    optionalFields: ['documentNumber', 'notes'],
    expiryMonths: 12,
    reverifyOnExpiry: true,
    compliance: 'criminalBackgroundMatchesEligibility',
    subjectKinds: ['DriverProfile', 'RiderProfile', 'User'],
    desk: 'hqExecutive',
    sensitivity: 'restricted',
  }),
  driverLicence: rule({
    type: 'driverLicence',
    label: 'Driving licence',
    category: 'eligibility',
    requiredFields: ['holderName', 'documentNumber', 'issuingAuthority', 'issuedOn', 'expiresOn'],
    optionalFields: ['dateOfBirth', 'notes'],
    expiryMonths: null,
    reverifyOnExpiry: true,
    compliance: null,
    subjectKinds: ['DriverProfile'],
    desk: 'backOffice',
    sensitivity: 'restricted',
  }),
  vehicleInsurance: rule({
    type: 'vehicleInsurance',
    label: 'Vehicle insurance certificate',
    category: 'eligibility',
    requiredFields: ['documentNumber', 'issuingAuthority', 'issuedOn', 'expiresOn'],
    optionalFields: ['holderName', 'amount', 'currency'],
    expiryMonths: null,
    reverifyOnExpiry: false,
    compliance: null,
    subjectKinds: ['DriverProfile', 'RentalCarCompanyProfile'],
    desk: 'backOffice',
    sensitivity: 'standard',
  }),
  roadworthiness: rule({
    type: 'roadworthiness',
    label: 'Roadworthiness certificate',
    category: 'eligibility',
    requiredFields: ['documentNumber', 'issuingAuthority', 'issuedOn', 'expiresOn'],
    optionalFields: ['notes'],
    expiryMonths: null,
    reverifyOnExpiry: false,
    compliance: null,
    subjectKinds: ['DriverProfile', 'RentalCarCompanyProfile'],
    desk: 'backOffice',
    sensitivity: 'standard',
  }),
  businessRegistration: rule({
    type: 'businessRegistration',
    label: 'Business registration certificate',
    category: 'business',
    requiredFields: ['holderName', 'documentNumber', 'issuingAuthority', 'issuedOn'],
    optionalFields: ['address', 'expiresOn'],
    expiryMonths: null,
    reverifyOnExpiry: false,
    compliance: null,
    subjectKinds: ['CommercialClient', 'VendorProfile', 'RentalCarCompanyProfile'],
    desk: 'backOffice',
    sensitivity: 'standard',
  }),
  taxClearance: rule({
    type: 'taxClearance',
    label: 'Tax clearance certificate',
    category: 'business',
    requiredFields: ['holderName', 'documentNumber', 'issuingAuthority', 'issuedOn', 'expiresOn'],
    optionalFields: ['notes'],
    expiryMonths: 12,
    reverifyOnExpiry: false,
    compliance: null,
    subjectKinds: ['CommercialClient', 'VendorProfile'],
    desk: 'backOffice',
    sensitivity: 'standard',
  }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Field-level validation
// ─────────────────────────────────────────────────────────────────────────────

/** Every field any type may carry. A field outside this set is rejected. */
export const DOCUMENT_FIELDS = [
  'holderName',
  'counterpartyName',
  'documentNumber',
  'issuingAuthority',
  'issuedOn',
  'expiresOn',
  'dateOfBirth',
  'nationality',
  'address',
  'city',
  'region',
  'employerName',
  'jobTitle',
  'monthlyIncome',
  'amount',
  'currency',
  'periodStart',
  'periodEnd',
  'relationship',
  'outcome',
  'notes',
] as const;
export type DocumentField = (typeof DOCUMENT_FIELDS)[number];

export const RELATIONSHIPS = ['self', 'spouse', 'child', 'parent', 'sibling', 'dependent', 'other'] as const;
export const BACKGROUND_OUTCOMES = ['clear', 'minor', 'adverse', 'pending'] as const;

/** A field value, as it arrives from a client. */
export type FieldValue = string | number | Date | undefined | null;

function asDate(value: FieldValue): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * One field, one rule. Returns null when valid, otherwise the reason.
 *
 * `asOf` is a parameter rather than `new Date()` so a document submitted with
 * yesterday's date validates the same way tomorrow, and so the rule is testable.
 */
export function validateField(field: string, value: FieldValue, asOf: Date): string | null {
  if (!(DOCUMENT_FIELDS as readonly string[]).includes(field)) return `unknown field "${field}"`;
  if (value === undefined || value === null || value === '') return null; // absence is `missingFields`' business

  switch (field) {
    case 'holderName':
    case 'counterpartyName':
    case 'employerName':
    case 'issuingAuthority': {
      const s = String(value).trim();
      if (s.length < 2) return `${field} is too short`;
      if (s.length > 160) return `${field} exceeds 160 characters`;
      return null;
    }
    case 'documentNumber': {
      const s = String(value).trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9 /-]{2,63}$/.test(s)) return 'documentNumber is malformed';
      return null;
    }
    case 'issuedOn': {
      const d = asDate(value);
      if (!d) return 'issuedOn is not a date';
      if (d.getTime() > asOf.getTime()) return 'issuedOn is in the future';
      return null;
    }
    case 'expiresOn':
    case 'periodEnd': {
      const d = asDate(value);
      if (!d) return `${field} is not a date`;
      return null;
    }
    case 'periodStart': {
      const d = asDate(value);
      if (!d) return 'periodStart is not a date';
      return null;
    }
    case 'dateOfBirth': {
      const d = asDate(value);
      if (!d) return 'dateOfBirth is not a date';
      if (d.getTime() > asOf.getTime()) return 'dateOfBirth is in the future';
      // 130 years. A guard against a mistyped century, not a demographic claim.
      if (asOf.getFullYear() - d.getUTCFullYear() > 130) return 'dateOfBirth is implausible';
      return null;
    }
    case 'monthlyIncome':
    case 'amount': {
      const n = Number(value);
      if (!Number.isFinite(n)) return `${field} is not a number`;
      if (n < 0) return `${field} cannot be negative`;
      return null;
    }
    case 'currency':
      return /^[A-Z]{3}$/.test(String(value)) ? null : 'currency must be a 3-letter code';
    case 'relationship':
      return (RELATIONSHIPS as readonly string[]).includes(String(value))
        ? null
        : `relationship must be one of ${RELATIONSHIPS.join(', ')}`;
    case 'outcome':
      return (BACKGROUND_OUTCOMES as readonly string[]).includes(String(value))
        ? null
        : `outcome must be one of ${BACKGROUND_OUTCOMES.join(', ')}`;
    case 'nationality':
    case 'city':
    case 'region':
    case 'jobTitle': {
      const s = String(value).trim();
      return s.length <= 120 ? null : `${field} exceeds 120 characters`;
    }
    case 'address':
      return String(value).trim().length <= 400 ? null : 'address exceeds 400 characters';
    case 'notes':
      return String(value).trim().length <= 2000 ? null : 'notes exceeds 2000 characters';
    default:
      return null;
  }
}

export type FieldBag = Record<string, FieldValue>;

function present(value: FieldValue): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function requiredFieldsFor(type: DocumentType): readonly string[] {
  return DOCUMENT_RULES[type].requiredFields;
}

export function allowedFieldsFor(type: DocumentType): string[] {
  const r = DOCUMENT_RULES[type];
  return [...r.requiredFields, ...r.optionalFields];
}

export function missingFields(type: DocumentType, fields: FieldBag): string[] {
  return requiredFieldsFor(type).filter((f) => !present(fields[f]));
}

export interface FieldProblem {
  field: string;
  message: string;
}

export interface DocumentValidation {
  ok: boolean;
  missing: string[];
  invalid: FieldProblem[];
  /** Present but not part of this type's schema. Rejected, not ignored. */
  unexpected: string[];
}

/**
 * Whole-document field validation.
 *
 * Unexpected fields are reported rather than dropped: a client sending
 * `employerName` on a birth certificate has misunderstood something, and
 * silently discarding it hides the misunderstanding until an auditor finds it.
 */
export function validateDocumentFields(
  type: DocumentType,
  fields: FieldBag,
  asOf: Date,
): DocumentValidation {
  const allowed = allowedFieldsFor(type);
  const invalid: FieldProblem[] = [];
  const unexpected: string[] = [];

  for (const [field, value] of Object.entries(fields)) {
    if (!allowed.includes(field)) {
      unexpected.push(field);
      continue;
    }
    const problem = validateField(field, value, asOf);
    if (problem) invalid.push({ field, message: problem });
  }

  // Internal date coherence — cheap here, and it stops an obviously incoherent
  // document reaching a reviewer's queue at all.
  const issued = asDate(fields.issuedOn ?? null);
  const expires = asDate(fields.expiresOn ?? null);
  if (issued && expires && expires.getTime() <= issued.getTime()) {
    invalid.push({ field: 'expiresOn', message: 'expiresOn must be after issuedOn' });
  }
  const from = asDate(fields.periodStart ?? null);
  const to = asDate(fields.periodEnd ?? null);
  if (from && to && to.getTime() <= from.getTime()) {
    invalid.push({ field: 'periodEnd', message: 'periodEnd must be after periodStart' });
  }
  const dob = asDate(fields.dateOfBirth ?? null);
  if (dob && issued && dob.getTime() > issued.getTime()) {
    invalid.push({ field: 'dateOfBirth', message: 'dateOfBirth cannot be after issuedOn' });
  }

  const missing = missingFields(type, fields);
  return { ok: missing.length === 0 && invalid.length === 0 && unexpected.length === 0, missing, invalid, unexpected };
}

// ─────────────────────────────────────────────────────────────────────────────
// Expiry, assignment, immutability
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When this document lapses.
 *
 * A stated `expiresOn` always wins — the passport says when it expires, and no
 * policy of ours overrides the issuing authority. Only when the document states
 * nothing do we impute one from the type's period.
 */
export function expiryDateFor(
  type: DocumentType,
  fields: FieldBag,
  verifiedAt?: Date | null,
): Date | null {
  const stated = asDate(fields.expiresOn ?? null);
  if (stated) return stated;

  const months = DOCUMENT_RULES[type].expiryMonths;
  if (months === null) return null;

  const anchor = asDate(fields.issuedOn ?? null) ?? verifiedAt ?? null;
  if (!anchor) return null;

  const d = new Date(anchor.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Month-length clamp, same discipline as the rent schedule: adding a month to
  // 31 January must land on 28 February, not drift into March.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

/** Which desk reviews this type. */
export function deskFor(type: DocumentType): ReviewDesk {
  return DOCUMENT_RULES[type].desk;
}

/**
 * Which staff role may act on a type.
 *
 * The founder is omitted deliberately: they can reach everything by permission,
 * and listing them here would make the desk assignment look like a whitelist
 * rather than a routing rule.
 */
export function reviewerRolesFor(type: DocumentType): string[] {
  switch (deskFor(type)) {
    case 'coordinator':
      return ['coordinator', 'backOfficeStaff'];
    case 'hqExecutive':
      return ['hqExecutive'];
    default:
      return ['backOfficeStaff'];
  }
}

/**
 * Fields frozen once a document is verified.
 *
 * The identity of the evidence cannot change after somebody signed off on it —
 * otherwise "verified" means only that *something* was verified once. `notes`
 * and the file itself stay editable so a reviewer can annotate.
 */
export const IMMUTABLE_AFTER_VERIFICATION = [
  'type',
  'subject',
  'subjectKind',
  'owner',
  'holderName',
  'documentNumber',
  'issuingAuthority',
  'issuedOn',
  'expiresOn',
  'dateOfBirth',
  'outcome',
] as const;

export function isImmutableAfterVerification(field: string): boolean {
  return (IMMUTABLE_AFTER_VERIFICATION as readonly string[]).includes(field);
}

/** Which of a proposed patch's keys a verified document refuses. */
export function lockedFieldsIn(patch: Record<string, unknown>): string[] {
  return Object.keys(patch).filter(isImmutableAfterVerification);
}

/** Types that must be re-verified rather than merely renewed once they lapse. */
export function requiresReverification(type: DocumentType): boolean {
  return DOCUMENT_RULES[type].reverifyOnExpiry;
}

export function complianceRuleFor(type: DocumentType): ComplianceRuleKey | null {
  return DOCUMENT_RULES[type].compliance;
}

export function acceptsSubjectKind(type: DocumentType, subjectKind: string): boolean {
  return DOCUMENT_RULES[type].subjectKinds.includes(subjectKind);
}

export function isRestricted(type: DocumentType): boolean {
  return DOCUMENT_RULES[type].sensitivity === 'restricted';
}
