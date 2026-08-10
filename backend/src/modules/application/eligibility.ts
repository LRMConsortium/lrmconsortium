/**
 * Tenancy application scoring.
 *
 * **This module recommends. It never decides.** Every function here returns a
 * recommendation and the reasons behind it; approving or rejecting an
 * application is an act by a named person, recorded in
 * `applicationLifecycle.ts`. That separation is the point: a refusal that
 * nobody authored is a refusal LRMC cannot explain to the person refused, and
 * an institution that cannot explain a refusal will eventually be asked to in
 * a room where "the system decided" is not an answer.
 *
 * Three properties worth not undoing:
 *
 * 1. **Absent evidence is not bad evidence.** A factor with no data scores
 *    nothing but is reported `unknown`, and an application carrying any
 *    unknown can never be recommended outright — only sent for review. A
 *    tenant new to the country has no LRMC payment history; that is a reason
 *    to look at them, not a reason to refuse them.
 *
 * 2. **Two factors block.** Unverified identity and an open dispute cap the
 *    recommendation regardless of the total. A high score cannot buy past
 *    somebody LRMC cannot identify.
 *
 * 3. **Every factor carries its reason in words.** The tenant is entitled to
 *    know what counted against them, and a coordinator explaining a decision
 *    should not have to read the weights.
 *
 * Pure — no Express, no Mongoose, no clock of its own. `npm run verify` runs
 * it with nothing installed.
 */

import type { EvidenceBundle } from '../../config/evidence.js';

export const ELIGIBILITY_FACTORS = [
  'identity',
  'employment',
  'references',
  'paymentHistory',
  'ususuContributions',
  'disputes',
] as const;

export type EligibilityFactor = (typeof ELIGIBILITY_FACTORS)[number];

/**
 * Weights, summing to 100.
 *
 * Identity and payment history carry the most because they are the two things
 * that actually predict a tenancy that works: LRMC knows who this is, and LRMC
 * has watched them pay. Ususu contributions carry the least — they are
 * genuine evidence of regular income, but a tenant who has never used Ususu is
 * not thereby a worse tenant, and weighting it heavily would make the ride
 * service a gate on housing.
 */
export const FACTOR_WEIGHTS: Record<EligibilityFactor, number> = {
  identity: 25,
  paymentHistory: 25,
  disputes: 15,
  references: 15,
  employment: 12,
  ususuContributions: 8,
};

/** Human wording, so a decision letter never names a database column. */
export const FACTOR_LABELS: Record<EligibilityFactor, string> = {
  identity: 'Identity verification',
  employment: 'Employment and income',
  references: 'References',
  paymentHistory: 'Payment history with LRMC',
  ususuContributions: 'Ususu contributions',
  disputes: 'Open disputes',
};

/**
 * Factors that cap the outcome no matter what the total says.
 *
 * Kept as data rather than as `if` statements in the scorer, so the rule can
 * be asserted directly and so adding one is a one-line change with a test that
 * already covers it.
 */
export const BLOCKING_FACTORS: readonly EligibilityFactor[] = ['identity', 'disputes'];

export type FactorStatus = 'pass' | 'concern' | 'fail' | 'unknown';

export interface FactorResult {
  factor: EligibilityFactor;
  label: string;
  status: FactorStatus;
  /** Points awarded, 0 … `max`. */
  points: number;
  max: number;
  /** Why, in words the applicant could be shown. */
  reason: string;
}

export type Recommendation = 'recommend' | 'review' | 'decline';

export interface Assessment {
  factors: FactorResult[];
  /** 0 … 100. */
  score: number;
  recommendation: Recommendation;
  /** Factors that capped the recommendation, if any. */
  blockedBy: EligibilityFactor[];
  /** Factors LRMC has no evidence for. */
  missing: EligibilityFactor[];
  /** One sentence a coordinator can read aloud. */
  summary: string;
}

/**
 * What LRMC knows about an applicant.
 *
 * Every field is optional, and `undefined` means "no evidence", which is
 * treated differently from evidence that is bad. A caller that cannot look
 * something up must leave it out rather than passing a zero.
 */
export interface EligibilityInput {
  /** Has LRMC verified who this person is? */
  identityVerified?: boolean;
  /** Identity documents submitted but not yet reviewed. */
  identityPending?: boolean;

  /** Declared monthly income, in the same currency as the rent. */
  monthlyIncome?: number;
  /** Rent being applied for, per month. */
  monthlyRent?: number;
  /** Has the income been evidenced — payslip, contract, bank statement? */
  employmentEvidenced?: boolean;

  /** References — the shape `referencesEvidence` carries. */
  referenceRequested?: boolean;
  referenceReceived?: boolean;
  /** 0–100, as scored by whoever answered. */
  referenceScore?: number;

  /** Rent instalments LRMC has observed. */
  paymentsOnTime?: number;
  paymentsLate?: number;
  paymentsMissed?: number;

  /** Ususu — the shape `ususuEvidence` carries. */
  contributionsMade?: number;
  contributionsMissed?: number;
  streak?: number;
  /** 0–100. */
  groupHealth?: number;

  /** Disputes currently open against the applicant. */
  openDisputes?: number;
  /** Disputes resolved in the past, whatever the outcome. */
  resolvedDisputes?: number;
  /** Worst open dispute, 0–3. A severe one is not three minor ones. */
  disputeSeverity?: number;
}

/**
 * The income multiple LRMC looks for.
 *
 * Thirty per cent of income on rent is the conventional affordability line;
 * expressed as a multiple that is income ≥ 3.33 × rent. Rounded to 3 because
 * precision here is false — the number is a heuristic, not a measurement.
 */
export const INCOME_MULTIPLE_STRONG = 3;
export const INCOME_MULTIPLE_MINIMUM = 2;

function result(
  factor: EligibilityFactor,
  status: FactorStatus,
  fraction: number,
  reason: string,
): FactorResult {
  const max = FACTOR_WEIGHTS[factor];
  return {
    factor,
    label: FACTOR_LABELS[factor],
    status,
    points: Math.round(max * Math.max(0, Math.min(1, fraction))),
    max,
    reason,
  };
}

function scoreIdentity(input: EligibilityInput): FactorResult {
  if (input.identityVerified === true) {
    return result('identity', 'pass', 1, 'Identity verified by LRMC.');
  }
  if (input.identityPending === true) {
    return result('identity', 'concern', 0, 'Identity documents submitted but not yet reviewed.');
  }
  if (input.identityVerified === false) {
    return result('identity', 'fail', 0, 'Identity has not been verified.');
  }
  return result('identity', 'unknown', 0, 'No identity check on record.');
}

function scoreEmployment(input: EligibilityInput): FactorResult {
  const { monthlyIncome, monthlyRent } = input;
  if (typeof monthlyIncome !== 'number' || typeof monthlyRent !== 'number' || monthlyRent <= 0) {
    return result('employment', 'unknown', 0, 'No income information on record.');
  }

  const multiple = monthlyIncome / monthlyRent;
  // Evidence is worth a quarter of this factor on its own: a declared income
  // nobody has checked is a claim, not a fact.
  const evidenceShare = input.employmentEvidenced === true ? 1 : 0.75;
  const rounded = Math.round(multiple * 10) / 10;

  if (multiple >= INCOME_MULTIPLE_STRONG) {
    return result(
      'employment',
      input.employmentEvidenced === true ? 'pass' : 'concern',
      evidenceShare,
      input.employmentEvidenced === true
        ? `Income is ${rounded}× the rent, with evidence supplied.`
        : `Income is ${rounded}× the rent, but has not been evidenced.`,
    );
  }
  if (multiple >= INCOME_MULTIPLE_MINIMUM) {
    return result(
      'employment',
      'concern',
      0.5 * evidenceShare,
      `Income is ${rounded}× the rent, below the ${INCOME_MULTIPLE_STRONG}× LRMC looks for.`,
    );
  }
  return result(
    'employment',
    'fail',
    0,
    `Income is ${rounded}× the rent, which will not sustain the tenancy.`,
  );
}

function scoreReferences(input: EligibilityInput): FactorResult {
  if (input.referenceRequested === undefined) {
    return result('references', 'unknown', 0, 'No reference on record.');
  }
  if (input.referenceRequested === false) {
    // Not asked for is LRMC's omission, not the applicant's. It holds the
    // application at review; it does not count against them.
    return result('references', 'unknown', 0, 'No reference has been requested yet.');
  }
  if (input.referenceReceived !== true) {
    return result('references', 'concern', 0.25, 'Reference requested, no reply yet.');
  }
  const score = typeof input.referenceScore === 'number' ? input.referenceScore : null;
  if (score === null) {
    return result('references', 'concern', 0.5, 'Reference received, unscored.');
  }
  const clamped = Math.max(0, Math.min(100, score));
  if (clamped >= 70) {
    return result('references', 'pass', clamped / 100, `Reference scored ${clamped} of 100.`);
  }
  if (clamped >= 40) {
    return result('references', 'concern', clamped / 100, `Reference scored ${clamped} of 100.`);
  }
  return result('references', 'fail', clamped / 100, `Reference scored ${clamped} of 100.`);
}

function scorePaymentHistory(input: EligibilityInput): FactorResult {
  const onTime = input.paymentsOnTime;
  const late = input.paymentsLate ?? 0;
  const missed = input.paymentsMissed ?? 0;

  if (typeof onTime !== 'number' && input.paymentsLate === undefined && input.paymentsMissed === undefined) {
    return result('paymentHistory', 'unknown', 0, 'No payment history with LRMC yet.');
  }

  const paid = onTime ?? 0;
  const total = paid + late + missed;
  if (total === 0) {
    return result('paymentHistory', 'unknown', 0, 'No payment history with LRMC yet.');
  }

  if (missed > 0) {
    // A missed instalment is different in kind from a late one, so it is not
    // averaged away by a long run of good months.
    return result(
      'paymentHistory',
      'fail',
      Math.max(0, (paid - missed * 3) / total) * 0.4,
      `${missed} missed ${missed === 1 ? 'instalment' : 'instalments'} out of ${total}.`,
    );
  }

  const punctuality = paid / total;
  if (punctuality >= 0.9) {
    return result('paymentHistory', 'pass', 1, `${paid} of ${total} instalments paid on time.`);
  }
  return result(
    'paymentHistory',
    'concern',
    punctuality,
    `${late} late ${late === 1 ? 'payment' : 'payments'} out of ${total}.`,
  );
}

function scoreUsusu(input: EligibilityInput): FactorResult {
  const made = input.contributionsMade;
  if (typeof made !== 'number') {
    // Deliberately `unknown` rather than `fail`. Ususu is a ride service; not
    // using one is not a mark against a tenant, and treating it as one would
    // make housing conditional on mobility. It also carries the least weight
    // of the six for the same reason.
    return result('ususuContributions', 'unknown', 0, 'No Ususu record.');
  }
  const missed = input.contributionsMissed ?? 0;
  const streak = input.streak ?? 0;
  const health = typeof input.groupHealth === 'number' ? input.groupHealth : 100;

  if (made === 0 && missed === 0) {
    return result('ususuContributions', 'unknown', 0, 'Ususu account with no activity yet.');
  }

  const total = made + missed;
  const kept = total > 0 ? made / total : 0;
  // Group health and personal record both count; a person keeping up in a
  // collapsing group is doing better than the group is.
  const fraction = Math.max(0, Math.min(1, kept * 0.7 + (health / 100) * 0.3));

  if (missed === 0 && made >= 6) {
    return result('ususuContributions', 'pass', fraction,
      `${made} contributions, none missed, streak of ${streak}.`);
  }
  if (kept >= 0.8) {
    return result('ususuContributions', 'concern', fraction,
      `${made} contributions, ${missed} missed.`);
  }
  return result('ususuContributions', 'fail', fraction,
    `${missed} of ${total} contributions missed.`);
}

function scoreDisputes(input: EligibilityInput): FactorResult {
  const open = input.openDisputes;
  const resolved = input.resolvedDisputes ?? 0;

  if (typeof open !== 'number') {
    return result('disputes', 'unknown', 0, 'Dispute history not checked.');
  }
  if (open > 0) {
    const severity = Math.max(0, Math.min(3, input.disputeSeverity ?? 1));
    // Severity is reported but does not soften the outcome: an open dispute
    // blocks whatever its grade. It is here so a coordinator reading the
    // reason knows whether they are looking at a late payment or an eviction.
    const grade = ['', 'minor', 'serious', 'severe'][severity] || 'open';
    return result(
      'disputes',
      'fail',
      0,
      `${open} open ${open === 1 ? 'dispute' : 'disputes'} (${grade}) must be resolved first.`,
    );
  }
  if (resolved > 2) {
    return result('disputes', 'concern', 0.5, `No open disputes, ${resolved} resolved previously.`);
  }
  return result('disputes', 'pass', 1, 'No open disputes.');
}

const SCORERS: Record<EligibilityFactor, (input: EligibilityInput) => FactorResult> = {
  identity: scoreIdentity,
  employment: scoreEmployment,
  references: scoreReferences,
  paymentHistory: scorePaymentHistory,
  ususuContributions: scoreUsusu,
  disputes: scoreDisputes,
};

/**
 * Score at or above which an unblocked, fully-evidenced application is
 * recommended.
 *
 * Reachable without Ususu on purpose. Identity, payments, disputes,
 * references and employment total 92 between them, so a tenant who has never
 * used the ride service can still be recommended on the strength of the
 * things that actually predict a tenancy. Weighting Ususu so heavily that its
 * absence capped an applicant below this line would make a rideshare account
 * a precondition for housing.
 */
export const RECOMMEND_AT = 75;
/** Below this, the recommendation is to decline. A human may still say yes. */
export const REVIEW_AT = 45;

/**
 * Assess an application.
 *
 * Returns a recommendation and every reason behind it. It does not approve
 * anything — see `applicationLifecycle.ts`, where a decision requires a person.
 */
export function assessApplication(input: EligibilityInput): Assessment {
  const factors = ELIGIBILITY_FACTORS.map((f) => SCORERS[f](input));

  const score = factors.reduce((sum, f) => sum + f.points, 0);
  const missing = factors.filter((f) => f.status === 'unknown').map((f) => f.factor);
  const blockedBy = factors
    .filter((f) => BLOCKING_FACTORS.includes(f.factor) && f.status !== 'pass')
    .map((f) => f.factor);

  /**
   * The ceiling: what this application would score if every factor LRMC has
   * not checked turned out perfectly.
   *
   * This is what makes a decline defensible. An applicant is refused only when
   * **the evidence LRMC actually holds would still fail even if everything
   * unknown came back clean** — never merely because LRMC has not looked. An
   * application with nothing checked at all has a ceiling of 100 and is sent
   * to a person, which is the honest answer to "we know nothing about them".
   */
  const unknownWeight = factors
    .filter((f) => f.status === 'unknown')
    .reduce((sum, f) => sum + f.max, 0);
  const ceiling = score + unknownWeight;

  let recommendation: Recommendation;
  if (score >= RECOMMEND_AT) recommendation = 'recommend';
  else if (ceiling >= REVIEW_AT) recommendation = 'review';
  else recommendation = 'decline';

  // A blocking factor caps the outcome at `review` — never worse on its own,
  // because "we cannot yet identify this person" is a reason to look, not a
  // reason to refuse, and never better, because the total cannot buy past it.
  if (blockedBy.length > 0 && recommendation === 'recommend') recommendation = 'review';

  // Absent evidence caps it too, for the same reason and in the same direction.
  if (missing.length > 0 && recommendation === 'recommend') recommendation = 'review';

  return {
    factors,
    score,
    recommendation,
    blockedBy,
    missing,
    summary: summarise(score, recommendation, blockedBy, missing),
  };
}

function summarise(
  score: number,
  recommendation: Recommendation,
  blockedBy: EligibilityFactor[],
  missing: EligibilityFactor[],
): string {
  const named = (list: EligibilityFactor[]) =>
    list.map((f) => FACTOR_LABELS[f].toLowerCase()).join(' and ');

  if (blockedBy.length) {
    return `Scores ${score} of 100, held at review by ${named(blockedBy)}.`;
  }
  if (missing.length) {
    return `Scores ${score} of 100, with no evidence for ${named(missing)}.`;
  }
  if (recommendation === 'recommend') return `Scores ${score} of 100 on every factor checked.`;
  if (recommendation === 'review') return `Scores ${score} of 100 — worth a look before deciding.`;
  return `Scores ${score} of 100, below what LRMC can support without a reason to.`;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * From gathered evidence to a score
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Turn an evidence bundle into scorer input.
 *
 * This is where `hasRecord` does its work, and the whole of it is one rule:
 * **a source LRMC has never looked at contributes nothing to the input at
 * all.** Its fields are left `undefined`, every scorer already reports
 * `undefined` as `unknown`, and `assessApplication` already caps an
 * application carrying any unknown at review rather than declining it.
 *
 * So the fairness property survives a change of plumbing: it is not
 * re-implemented here, it falls out of leaving the field off.
 *
 * `stated` carries what the applicant themselves declared — income, and the
 * rent being applied for. LRMC does not look those up; it is told them, and
 * whether they are *evidenced* is a separate lookup.
 */
export function inputFromEvidence(
  evidence: EvidenceBundle,
  stated: { monthlyIncome?: number; monthlyRent?: number; employmentEvidenced?: boolean } = {},
): EligibilityInput {
  const input: EligibilityInput = {};

  const id = evidence.identityEvidence;
  if (id.hasRecord) {
    input.identityVerified = id.identityVerified;
    input.identityPending = id.identityPending;
  }

  const refs = evidence.referencesEvidence;
  if (refs.hasRecord) {
    input.referenceRequested = refs.referenceRequested;
    input.referenceReceived = refs.referenceReceived;
    if (refs.referenceScore !== null) input.referenceScore = refs.referenceScore;
  }

  const d = evidence.disputesEvidence;
  if (d.hasRecord) {
    input.openDisputes = d.disputesOpen;
    input.resolvedDisputes = d.disputesResolved;
    input.disputeSeverity = d.disputeSeverity;
  }

  const u = evidence.ususuEvidence;
  if (u.hasRecord) {
    input.contributionsMade = u.contributionsMade;
    input.contributionsMissed = u.contributionsMissed;
    input.streak = u.streak;
    input.groupHealth = u.groupHealth;
  }

  const p = evidence.paymentsEvidence;
  if (p.hasRecord) {
    input.paymentsOnTime = p.paymentsOnTime;
    input.paymentsLate = p.paymentsLate;
    input.paymentsMissed = p.paymentsMissed;
  }

  if (typeof stated.monthlyIncome === 'number') input.monthlyIncome = stated.monthlyIncome;
  if (typeof stated.monthlyRent === 'number') input.monthlyRent = stated.monthlyRent;
  if (typeof stated.employmentEvidenced === 'boolean') {
    input.employmentEvidenced = stated.employmentEvidenced;
  }

  return input;
}

/** Score a gathered bundle directly. */
export function assessEvidence(
  evidence: EvidenceBundle,
  stated: { monthlyIncome?: number; monthlyRent?: number; employmentEvidenced?: boolean } = {},
): Assessment {
  return assessApplication(inputFromEvidence(evidence, stated));
}
