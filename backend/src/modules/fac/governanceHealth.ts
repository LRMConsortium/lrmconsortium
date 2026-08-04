/**
 * The governance health score — the console's headline number.
 *
 * The wireframe shows one bar and three lines beneath it. The temptation with a
 * number like that is to invent it; this computes it from things the platform
 * actually measures, and names each component after the real signal rather than
 * after the label on the mock.
 *
 * Two rules, both asserted:
 *
 * **A component with no data is excluded, not scored zero.** A consortium with
 * no leases yet should not show 40% governance health because rent collection
 * has nothing to divide by. The response says which components were counted.
 *
 * **A failed FAC state caps the whole score.** Everything else can be perfect;
 * if there is no code in force, governance is not healthy, and a green bar
 * saying otherwise is worse than no bar at all.
 */

export const HEALTH_COMPONENTS = [
  'facCompliance',
  'rentCollection',
  'auditIntegrity',
  'documentBacklog',
  'verificationCoverage',
] as const;
export type HealthComponent = (typeof HEALTH_COMPONENTS)[number];

export const COMPONENT_WEIGHTS: Record<HealthComponent, number> = {
  facCompliance: 0.3,
  rentCollection: 0.2,
  auditIntegrity: 0.25,
  documentBacklog: 0.15,
  verificationCoverage: 0.1,
};

/** Above this, a missing or expired code caps the composite. */
export const NO_CODE_CEILING = 40;

export const HEALTH_BANDS = ['critical', 'degraded', 'healthy', 'strong'] as const;
export type HealthBand = (typeof HEALTH_BANDS)[number];

export function healthBand(score: number): HealthBand {
  if (score < 40) return 'critical';
  if (score < 70) return 'degraded';
  if (score < 88) return 'healthy';
  return 'strong';
}

export interface HealthSignals {
  /** Is a code in force, and how far through its life? */
  code?: { active: boolean; expired: boolean; daysRemaining: number; rotationDays: number } | null;
  /** Actors currently locked out of Zone A. */
  activeLockouts?: number;
  /** Leases, for the rent-collection line. */
  leases?: { total: number; inArrears: number } | null;
  /** Audit trails examined and how many were intact. */
  audit?: { examined: number; intact: number } | null;
  /** Document verification queue. */
  documents?: { total: number; backlog: number } | null;
  /** Member accounts and how many are verified. */
  members?: { total: number; verified: number } | null;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export interface ComponentScore {
  component: HealthComponent;
  score: number;
  /** False when there was nothing to measure; excluded from the composite. */
  measured: boolean;
  detail: string;
}

/**
 * FAC compliance: is there a code, is it in date, and is anyone locked out?
 *
 * Degrades smoothly through the last stretch of a code's life rather than
 * falling off a cliff on the ninetieth day — the point is to prompt a rotation
 * before the expiry, not to report the failure afterwards.
 */
export function facComplianceScore(signals: HealthSignals): ComponentScore {
  const code = signals.code;
  if (!code) {
    return { component: 'facCompliance', score: 0, measured: true, detail: 'no code has ever been issued' };
  }
  if (code.expired || !code.active) {
    return { component: 'facCompliance', score: 0, measured: true, detail: 'no code is currently in force' };
  }

  // Full marks until the last quarter of the code's life, then a linear slide.
  const window = Math.max(1, Math.round(code.rotationDays * 0.25));
  const freshness = code.daysRemaining >= window ? 100 : (code.daysRemaining / window) * 100;
  // Each active lockout is a founder who cannot reach Zone A right now.
  const lockoutPenalty = Math.min(40, (signals.activeLockouts ?? 0) * 20);

  return {
    component: 'facCompliance',
    score: clamp(freshness - lockoutPenalty),
    measured: true,
    detail:
      (signals.activeLockouts ?? 0) > 0
        ? `${code.daysRemaining} days remaining, ${signals.activeLockouts} actor(s) locked out`
        : `${code.daysRemaining} days remaining`,
  };
}

export function rentCollectionScore(signals: HealthSignals): ComponentScore {
  const leases = signals.leases;
  if (!leases || leases.total === 0) {
    return { component: 'rentCollection', score: 0, measured: false, detail: 'no leases on file' };
  }
  const current = leases.total - leases.inArrears;
  return {
    component: 'rentCollection',
    score: clamp(pct(current, leases.total)),
    measured: true,
    detail: `${current} of ${leases.total} leases current`,
  };
}

export function auditIntegrityScore(signals: HealthSignals): ComponentScore {
  const audit = signals.audit;
  if (!audit || audit.examined === 0) {
    return { component: 'auditIntegrity', score: 0, measured: false, detail: 'no trails examined' };
  }
  return {
    component: 'auditIntegrity',
    score: clamp(pct(audit.intact, audit.examined)),
    measured: true,
    detail: `${audit.intact} of ${audit.examined} trails verified intact`,
  };
}

/** Backlog is inverted: a queue of zero is a perfect score. */
export function documentBacklogScore(signals: HealthSignals): ComponentScore {
  const docs = signals.documents;
  if (!docs || docs.total === 0) {
    return { component: 'documentBacklog', score: 0, measured: false, detail: 'no documents on file' };
  }
  return {
    component: 'documentBacklog',
    score: clamp(100 - pct(docs.backlog, docs.total)),
    measured: true,
    detail: `${docs.backlog} of ${docs.total} awaiting review`,
  };
}

export function verificationCoverageScore(signals: HealthSignals): ComponentScore {
  const members = signals.members;
  if (!members || members.total === 0) {
    return { component: 'verificationCoverage', score: 0, measured: false, detail: 'no members on file' };
  }
  return {
    component: 'verificationCoverage',
    score: clamp(pct(members.verified, members.total)),
    measured: true,
    detail: `${members.verified} of ${members.total} members verified`,
  };
}

export interface GovernanceHealth {
  score: number;
  band: HealthBand;
  components: ComponentScore[];
  /** Which components had data and contributed. */
  measured: HealthComponent[];
  /** Which were skipped, and therefore neither helped nor hurt. */
  unmeasured: HealthComponent[];
  /** Set when the FAC state capped the composite. */
  cappedBy: 'facCompliance' | null;
  weakest: HealthComponent | null;
}

export function governanceHealth(signals: HealthSignals): GovernanceHealth {
  const components: ComponentScore[] = [
    facComplianceScore(signals),
    rentCollectionScore(signals),
    auditIntegrityScore(signals),
    documentBacklogScore(signals),
    verificationCoverageScore(signals),
  ];

  const measured = components.filter((c) => c.measured);
  const totalWeight = measured.reduce((sum, c) => sum + COMPONENT_WEIGHTS[c.component], 0);

  // Re-normalise across the components that actually had data, so excluding one
  // shifts the others' influence rather than dragging the total down.
  let score =
    totalWeight === 0
      ? 0
      : clamp(
          measured.reduce((sum, c) => sum + c.score * COMPONENT_WEIGHTS[c.component], 0) / totalWeight,
        );

  const fac = components[0]!;
  const capped = fac.score === 0 && score > NO_CODE_CEILING;
  if (capped) score = NO_CODE_CEILING;

  const weakest = measured.length
    ? measured.reduce((low, c) => (c.score < low.score ? c : low)).component
    : null;

  return {
    score,
    band: healthBand(score),
    components,
    measured: measured.map((c) => c.component),
    unmeasured: components.filter((c) => !c.measured).map((c) => c.component),
    cappedBy: capped ? 'facCompliance' : null,
    weakest,
  };
}
