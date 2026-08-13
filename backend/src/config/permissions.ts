/**
 * Permission vocabulary for LRMC + Ususu.
 *
 * A permission is always `resource:action`. Nothing in the platform is
 * authorised by role name alone — roles are bundles of these strings, so a
 * new role is a data change, not a code change.
 */

export const RESOURCES = [
  // Identity & HQ
  'user',
  'founderProfile',
  'hqExecutiveProfile',
  'backOfficeStaffProfile',
  'policy',
  'auditLog',
  'analytics',

  // LRMC residential
  'landlordProfile',
  'tenantProfile',
  'coordinatorProfile',
  'vendorProfile',
  'property',
  'lease',
  'rentPayment',
  'maintenanceRequest',
  /** A tenant asking to see a property, and LRMC agreeing to be there. */
  'viewing',
  /** A tenancy application: scored by LRMC, decided by a person. */
  'application',
  /** Evidence LRMC gathers about a person, never about itself. */
  'reference',
  'dispute',
  'ususuLedger',

  // LRMC commercial clients
  'airbnbHostProfile',
  'hotelProfile',
  'resortProfile',
  'rentalCarCompanyProfile',

  // Ususu mobility
  'driverProfile',
  'riderProfile',
  'ride',
  'earnings',

  // Cross-cutting operational surfaces
  'payment',
  'payout',
  'notification',
  'commercialClient',
  'document',

  // Marketplace — merchants sell, customers buy, coordinators supervise both
  'merchantProfile',
  'customerProfile',
  'listing',
  'order',
  'marketplace',

  // Governance & access control
  'fac',
  'governance',

  // Revenue
  'advertiserProfile',
  'ad',
  'adReport',
  'adPolicy',

  // Public surface
  'publicContent',
  'publicMetrics',
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = [
  'create',
  'read',
  'readOwn',
  'update',
  'updateOwn',
  'delete',
  'approve',
  'verify',
  'assign',
  'export',
  'publish',
  'settle',
  'review',
  'revoke',
  /**
   * Write down something that already happened outside the system.
   *
   * Distinct from `create`, and the distinction is the point. `payment:create`
   * means "start a payment" — a tenant initiating a transfer holds it, and
   * rightly so. `payment:record` means "assert that money changed hands in a
   * room", which is a completely different power: it writes a settled row into
   * the ledger on somebody else's behalf.
   *
   * They were briefly the same grant, and the contract exposed what that meant
   * — every tenant could reach `POST /payments/record` while the coordinators
   * the endpoint exists for could not, because a coordinator holds
   * `rentPayment:create` and not `payment:create`. Nothing would have failed
   * loudly: the rules module refuses a tenant, so it would have been a 422 on a
   * route advertised to them.
   */
  'record',
] as const;

export type Action = (typeof ACTIONS)[number];

export type Permission = `${Resource}:${Action}`;

/** Wildcards understood by the permission matcher. */
export const WILDCARD = '*:*' as const;
export type PermissionGrant = Permission | typeof WILDCARD | `${Resource}:*` | `*:${Action}`;

export function permission(resource: Resource, action: Action): Permission {
  return `${resource}:${action}`;
}

/** Every `read`/`update`/`delete`… on one resource. */
export function all(resource: Resource): `${Resource}:*` {
  return `${resource}:*`;
}

/** Read-only bundle for a set of resources. */
export function readOnly(...resources: Resource[]): Permission[] {
  return resources.map((r) => permission(r, 'read'));
}

/** Self-service bundle: read and update only your own record. */
export function selfService(...resources: Resource[]): Permission[] {
  return resources.flatMap((r) => [permission(r, 'readOwn'), permission(r, 'updateOwn')]);
}

/**
 * Does a set of grants satisfy a required permission?
 * Supports `*:*`, `resource:*` and `*:action`.
 */
export function grantsSatisfy(grants: readonly string[], required: Permission): boolean {
  if (grants.includes(WILDCARD)) return true;
  if (grants.includes(required)) return true;
  const [resource, action] = required.split(':') as [Resource, Action];
  return grants.includes(`${resource}:*`) || grants.includes(`*:${action}`);
}

/**
 * `update` implies `updateOwn`, `read` implies `readOwn`. Callers ask for the
 * narrow permission; a broad grant still answers.
 */
const IMPLIES: Partial<Record<Action, Action>> = {
  readOwn: 'read',
  updateOwn: 'update',
};

export function can(grants: readonly string[], required: Permission): boolean {
  if (grantsSatisfy(grants, required)) return true;
  const [resource, action] = required.split(':') as [Resource, Action];
  const broader = IMPLIES[action];
  return broader ? grantsSatisfy(grants, permission(resource, broader)) : false;
}
