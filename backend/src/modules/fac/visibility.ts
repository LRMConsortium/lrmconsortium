/**
 * Governance tiers and the seal visibility matrix.
 *
 * The wireframe shows four tiers and a four-row visibility table. This is that
 * table as data, mapped onto the platform's fifteen real roles — so the console
 * is rendering the same rule the server enforces, rather than a hand-copied
 * duplicate that will drift the first time a role moves tier.
 *
 * The rule worth stating plainly: **seal visibility requires the founder tier
 * *and* a live FAC clearance.** Role alone is not enough. A founder who has not
 * entered the code this session sees the same placeholder a member does, which
 * is what makes the seal a controlled symbol rather than a picture in the CSS.
 */

import { ROLES, ROLE_DEFINITIONS, type Role } from '../../config/roles.js';

export const GOVERNANCE_TIERS = ['founders', 'hq', 'staff', 'membership'] as const;
export type GovernanceTier = (typeof GOVERNANCE_TIERS)[number];

export const ADMIN_ACCESS_LEVELS = ['full', 'partial', 'limited', 'none'] as const;
export type AdminAccess = (typeof ADMIN_ACCESS_LEVELS)[number];

export interface TierDefinition {
  tier: GovernanceTier;
  ordinal: 1 | 2 | 3 | 4;
  label: string;
  summary: string;
  roles: Role[];
  /** Does entering this tier's console require an FAC code? */
  facRequired: boolean;
  /** May this tier see the institutional seal, given a live clearance? */
  sealEligible: boolean;
  adminAccess: AdminAccess;
  /** Tiers whose detail this tier may read. */
  visibleTiers: GovernanceTier[];
}

/**
 * The four tiers.
 *
 * Membership is defined by exclusion — everything that is not HQ, staff or a
 * founder — so a role added to `config/roles.ts` lands in the right place
 * without anyone remembering to update this file. Asserted in verify.
 */
const FOUNDER_ROLES: Role[] = ['founder'];
const HQ_ROLES: Role[] = ['hqExecutive'];
const STAFF_ROLES: Role[] = ['backOfficeStaff', 'coordinator'];
const MEMBER_ROLES: Role[] = ROLES.filter(
  (r) => ![...FOUNDER_ROLES, ...HQ_ROLES, ...STAFF_ROLES].includes(r),
);

export const TIER_DEFINITIONS: Record<GovernanceTier, TierDefinition> = {
  founders: {
    tier: 'founders',
    ordinal: 1,
    label: 'Founders Council',
    summary:
      'Supreme governance authority. Full institutional powers including FAC issuance, policy ratification and veto over every resolution.',
    roles: FOUNDER_ROLES,
    facRequired: true,
    sealEligible: true,
    adminAccess: 'full',
    visibleTiers: ['founders', 'hq', 'staff', 'membership'],
  },
  hq: {
    tier: 'hq',
    ordinal: 2,
    label: 'HQ Administration',
    summary:
      'Administrative command centre. Executive dashboards, regional performance, onboarding approval and campaign review.',
    roles: HQ_ROLES,
    facRequired: true,
    sealEligible: false,
    adminAccess: 'partial',
    // Zone A's *existence* is visible; its contents are not.
    visibleTiers: ['hq', 'staff', 'membership'],
  },
  staff: {
    tier: 'staff',
    ordinal: 3,
    label: 'Staff Operations',
    summary:
      'Operational support. Member and vendor administration, document review, field coordination and maintenance dispatch.',
    roles: STAFF_ROLES,
    facRequired: false,
    sealEligible: false,
    adminAccess: 'limited',
    visibleTiers: ['staff', 'membership'],
  },
  membership: {
    tier: 'membership',
    ordinal: 4,
    label: 'General Membership',
    summary:
      'Standard access. Own profile, own documents, own leases, rides and payments. No visibility into governance structures.',
    roles: MEMBER_ROLES,
    facRequired: false,
    sealEligible: false,
    adminAccess: 'none',
    visibleTiers: ['membership'],
  },
};

export const TIER_ORDER: GovernanceTier[] = ['founders', 'hq', 'staff', 'membership'];

/** Which tier a role sits in. Every role lands in exactly one. */
export function tierFor(role: string): GovernanceTier {
  for (const tier of TIER_ORDER) {
    if ((TIER_DEFINITIONS[tier].roles as string[]).includes(role)) return tier;
  }
  return 'membership';
}

export function tierOf(roles: readonly string[]): GovernanceTier {
  // The most privileged tier any held role grants.
  for (const tier of TIER_ORDER) {
    if (roles.some((r) => (TIER_DEFINITIONS[tier].roles as string[]).includes(r))) return tier;
  }
  return 'membership';
}

export function canSeeTier(viewer: GovernanceTier, target: GovernanceTier): boolean {
  return TIER_DEFINITIONS[viewer].visibleTiers.includes(target);
}

export interface VisibilityVerdict {
  role: string;
  tier: GovernanceTier;
  tierLabel: string;
  /** Does this role's console demand the code? */
  facRequired: boolean;
  /** Would the seal be visible *if* a clearance were live? */
  sealEligible: boolean;
  /** Is the seal visible right now? Requires eligibility AND a live clearance. */
  sealVisible: boolean;
  adminAccess: AdminAccess;
  visibleTiers: GovernanceTier[];
}

/**
 * What this caller may see, right now.
 *
 * `clearanceActive` is a parameter rather than something this module looks up,
 * so the rule stays pure — and so the distinction between *eligible* and
 * *visible* is impossible to collapse by accident. A founder with a lapsed
 * clearance is `sealEligible: true, sealVisible: false`.
 */
export function visibilityFor(role: string, clearanceActive = false): VisibilityVerdict {
  const tier = tierFor(role);
  const def = TIER_DEFINITIONS[tier];
  return {
    role,
    tier,
    tierLabel: def.label,
    facRequired: def.facRequired,
    sealEligible: def.sealEligible,
    sealVisible: def.sealEligible && clearanceActive,
    adminAccess: def.adminAccess,
    visibleTiers: def.visibleTiers,
  };
}

/** The whole matrix, one row per tier — what the console's table renders. */
export function visibilityMatrix(): {
  tier: GovernanceTier;
  ordinal: number;
  label: string;
  roles: Role[];
  sealEligible: boolean;
  facRequired: boolean;
  adminAccess: AdminAccess;
}[] {
  return TIER_ORDER.map((tier) => {
    const d = TIER_DEFINITIONS[tier];
    return {
      tier,
      ordinal: d.ordinal,
      label: d.label,
      roles: d.roles,
      sealEligible: d.sealEligible,
      facRequired: d.facRequired,
      adminAccess: d.adminAccess,
    };
  });
}

/**
 * Tier detail with live headcounts, for the governance overview.
 *
 * Counts are passed in rather than queried, keeping the module pure; the router
 * supplies them from the user collection.
 */
export function tierOverview(
  headcounts: Partial<Record<GovernanceTier, number>> = {},
): (TierDefinition & { headcount: number; zones: string[] })[] {
  return TIER_ORDER.map((tier) => {
    const d = TIER_DEFINITIONS[tier];
    // Zones are derived from the roles in the tier, so the overview cannot claim
    // access the RBAC does not actually grant.
    const zones = [
      ...new Set(d.roles.flatMap((r) => ROLE_DEFINITIONS[r]?.allowedZones ?? [])),
    ];
    return { ...d, headcount: headcounts[tier] ?? 0, zones };
  });
}
