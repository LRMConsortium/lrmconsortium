import { all, readOnly, type PermissionGrant } from './permissions.js';

/**
 * The institutional hierarchy. Five HQ zones, each a bounded surface with its
 * own dashboards, its own data and its own gate. A request is checked twice:
 * once for the zone it is entering, once for the permission it is exercising.
 */
export const HQ_ZONES = [
  'FOUNDER_COMMAND_CENTER',
  'HQ_EXECUTIVE',
  'BACK_OFFICE',
  'MEMBER_PORTAL',
  'PUBLIC_PORTAL',
] as const;

export type HQZone = (typeof HQ_ZONES)[number];

/** Ad-serving surfaces. Distinct from HQ zones: these are where ads render. */
export const AD_ZONES = ['PUBLIC_PORTAL', 'MEMBER_PORTAL', 'USUSU_PORTAL'] as const;
export type AdZone = (typeof AD_ZONES)[number];

export interface HQZoneDefinition {
  key: HQZone;
  code: 'A' | 'B' | 'C' | 'D' | 'E';
  label: string;
  purpose: string;
  /** Zones this zone can read through — the institutional line of sight. */
  oversees: HQZone[];
  /** Capabilities the zone exposes, for dashboard scaffolding and docs. */
  capabilities: string[];
  /** Permissions required merely to enter the zone. */
  entryPermissions: PermissionGrant[];
  /** Surfaces served out of this zone. */
  surfaces: string[];
  /** Data the zone must never see, regardless of role permissions. */
  dataFirewall: string[];
}

export const HQ_ZONE_DEFINITIONS: Record<HQZone, HQZoneDefinition> = {
  FOUNDER_COMMAND_CENTER: {
    key: 'FOUNDER_COMMAND_CENTER',
    code: 'A',
    label: 'Founder Command Center',
    purpose:
      'Constitutional layer. Writes rules, regulations and policy; approves system-wide change; owns ad pricing and rotation policy; oversees every region and service.',
    oversees: ['HQ_EXECUTIVE', 'BACK_OFFICE', 'MEMBER_PORTAL', 'PUBLIC_PORTAL'],
    capabilities: [
      'authorPolicy',
      'ratifyPolicy',
      'approveSystemWideChange',
      'setAdPricing',
      'setAdRotationRules',
      'appointHQExecutive',
      'overrideVerification',
      'readAuditLog',
      'declareRegion',
      'freezeService',
    ],
    entryPermissions: [all('policy')],
    surfaces: ['founder-console'],
    dataFirewall: [],
  },

  HQ_EXECUTIVE: {
    key: 'HQ_EXECUTIVE',
    code: 'B',
    label: 'HQ Executive Layer',
    purpose:
      'Sees the whole institution and steers it: high-level dashboards, KPIs, analytics and system health. Reads into Back Office, Member Portal and public metrics.',
    oversees: ['BACK_OFFICE', 'MEMBER_PORTAL', 'PUBLIC_PORTAL'],
    capabilities: [
      'viewExecutiveDashboard',
      'viewKPIs',
      'viewSystemHealth',
      'viewRegionalPerformance',
      'proposePolicy',
      'approveOnboarding',
      'exportAnalytics',
    ],
    entryPermissions: ['analytics:read'],
    surfaces: ['hq-dashboard'],
    dataFirewall: ['founderProfile.securityNotes', 'user.passwordHash'],
  },

  BACK_OFFICE: {
    key: 'BACK_OFFICE',
    code: 'C',
    label: 'Back Office (HR & Staff)',
    purpose:
      'Operational engine room. Owns coordinator, vendor and staff records, Ususu driver verification, and commercial-client onboarding for Airbnb hosts, hotels, resorts and rental car companies.',
    oversees: ['MEMBER_PORTAL'],
    capabilities: [
      'manageCoordinatorProfiles',
      'manageVendorProfiles',
      'manageStaffRecords',
      'verifyDrivers',
      'onboardCommercialClients',
      'assignCoordinatorToZone',
      'assignVendorToJob',
      'processVerificationQueue',
    ],
    entryPermissions: ['coordinatorProfile:read', 'vendorProfile:read'],
    surfaces: ['back-office'],
    dataFirewall: ['policy.draft', 'adPolicy.pricing', 'user.passwordHash'],
  },

  MEMBER_PORTAL: {
    key: 'MEMBER_PORTAL',
    code: 'D',
    label: 'Member Portal',
    purpose:
      'Where members live: their own profile, their performance, residency, rent, compliance and engagement history.',
    oversees: [],
    capabilities: [
      'viewOwnProfile',
      'updateOwnProfile',
      'viewOwnPerformance',
      'viewResidencyRecord',
      'viewRentLedger',
      'viewComplianceStatus',
      'viewEngagementScore',
      'submitMaintenanceRequest',
    ],
    entryPermissions: [],
    surfaces: ['member-portal', 'ususu-app'],
    dataFirewall: [
      'policy.draft',
      'adPolicy.pricing',
      'auditLog',
      'user.passwordHash',
      'otherMembers.*',
    ],
  },

  PUBLIC_PORTAL: {
    key: 'PUBLIC_PORTAL',
    code: 'E',
    label: 'Public Portal',
    purpose:
      'The face of the consortium: website stats, traffic analytics, conversion metrics, public content, and ad placement with rotation.',
    oversees: [],
    capabilities: [
      'viewPublicContent',
      'viewWebsiteStats',
      'viewTrafficAnalytics',
      'viewConversionMetrics',
      'servePlacements',
      'rotateAds',
      'captureLead',
    ],
    entryPermissions: [],
    surfaces: ['public-web', 'ususu-marketing'],
    dataFirewall: ['*.IDNumber', '*.nationalID', 'user.passwordHash', 'rentPayment', 'earnings'],
  },
};

/** Zones a holder of `zone` may read through, including itself. */
export function zoneLineOfSight(zone: HQZone): HQZone[] {
  const seen = new Set<HQZone>([zone]);
  const walk = (z: HQZone): void => {
    for (const child of HQ_ZONE_DEFINITIONS[z].oversees) {
      if (!seen.has(child)) {
        seen.add(child);
        walk(child);
      }
    }
  };
  walk(zone);
  return [...seen];
}

export function isHQZone(value: string): value is HQZone {
  return (HQ_ZONES as readonly string[]).includes(value);
}

export function isAdZone(value: string): value is AdZone {
  return (AD_ZONES as readonly string[]).includes(value);
}

/** Read-only projection helper used by the zone dashboards. */
export const HQ_ZONE_SUMMARY = HQ_ZONES.map((z) => {
  const d = HQ_ZONE_DEFINITIONS[z];
  return { code: d.code, key: d.key, label: d.label, purpose: d.purpose, surfaces: d.surfaces };
});

/** Convenience bundle: everything an executive dashboard reads. */
export const EXECUTIVE_READ_SCOPE = readOnly(
  'analytics',
  'publicMetrics',
  'coordinatorProfile',
  'vendorProfile',
  'property',
  'lease',
  'rentPayment',
  'maintenanceRequest',
  'ride',
  'earnings',
  'adReport',
);
