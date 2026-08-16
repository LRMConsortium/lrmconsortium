/**
 * Who may create their own LRMC account.
 *
 * Its own file, and pure, for the same reason `currencies.ts` is: `npm run
 * verify` runs with no dependencies installed, so a constant it needs to
 * assert cannot live in a module that imports Zod or Mongoose. This is the
 * third constant to move for that reason — the pattern is now deliberate.
 * **Policy constants belong in `config/` and import nothing.** The schema that
 * enforces them imports the constant, never the other way round.
 *
 * `customer` and `merchant` are open because a marketplace whose buyers cannot
 * sign themselves up has no buyers, and requiring staff to key in every
 * merchant makes onboarding grow only as fast as LRMC can hire. A merchant who
 * self-registers arrives **unverified**, and `listingRules.canPublish` refuses
 * to publish anything for an unverified merchant — so the open door leads to a
 * room they cannot trade in until somebody checks them.
 *
 * `seller` and `buyer` are deliberately absent. They act *for* an account and
 * are added by that account's owner; self-registration would create people who
 * belong to no merchant and no customer.
 *
 * Staff roles are absent for the obvious reason.
 */
export const SELF_REGISTERABLE_ROLES = [
  // LRMC residential
  'tenant',
  'landlord',

  // Ususu mobility
  'rider',
  'driver',

  // Services and commercial
  'vendor',
  'advertiser',
  'airbnbHost',
  'hotelManager',
  'resortManager',
  'rentalCarCompany',

  // Marketplace
  'customer',
  'merchant',

  // Anyone else
  'publicUser',
] as const;

export type SelfRegisterableRole = (typeof SELF_REGISTERABLE_ROLES)[number];

/**
 * Extra fields a role must supply at signup.
 *
 * Held here rather than in the form, so the page and the schema cannot
 * disagree about what a driver has to declare. The form reads this to decide
 * which questions to show; the API rejects a submission that omits them.
 */
export const REGISTRATION_EXTRAS: Partial<Record<SelfRegisterableRole, readonly string[]>> = {
  driver: ['vehicleType'],
  vendor: ['serviceType'],
  advertiser: ['businessType', 'businessName'],
  merchant: ['businessName'],
  hotelManager: ['businessName'],
  resortManager: ['businessName'],
  rentalCarCompany: ['businessName'],
  airbnbHost: ['businessName'],
  customer: ['businessName'],
};

/** Human wording for the extras, so a refusal names the thing on screen. */
export const EXTRA_LABELS: Record<string, string> = {
  businessName: 'Business name',
  businessType: 'Business type',
  vehicleType: 'Vehicle type',
  serviceType: 'Service type',
};

/**
 * Which required extras a submission is missing.
 *
 * The register schema marks every extra optional, because there is one shape
 * for thirteen roles and which extras apply depends on the role. This is where
 * that is made true in fact rather than in a table nobody consults: the schema
 * calls it, and so does `npm run verify`, which cannot import the schema
 * because the schema imports Zod.
 *
 * Whitespace is not an answer. `'   '` is how a required field gets past a
 * presence check, and a vendor whose service type is three spaces is a vendor
 * no coordinator can dispatch.
 */
export function missingExtras(
  role: string,
  supplied: Record<string, unknown>,
): string[] {
  const required = REGISTRATION_EXTRAS[role as SelfRegisterableRole] ?? [];
  return required.filter((field) => {
    const value = supplied[field];
    return typeof value !== 'string' || value.trim().length === 0;
  });
}

/** Password floor, stated once so the form and the schema agree. */
export const PASSWORD_MIN_LENGTH = 10;
