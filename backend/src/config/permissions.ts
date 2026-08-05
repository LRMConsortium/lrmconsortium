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
