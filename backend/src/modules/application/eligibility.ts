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
  employment: 20,
  disputes: 10,
  references: 12,
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

  /** References supplied and checked. */
  referencesProvided?: number;
  referencesCleared?: number;

  /** Rent instalments LRMC has observed. */
  paymentsOnTime?: number;
  paymentsLate?: number;
  paymentsMissed?: number;

  /** Consecutive months of Ususu contributions. */
  ususuMonths?: number;

  /** Disputes currently open against the applicant. */
  openDisputes?: number;
  /** Disputes resolved in the past, whatever the outcome. */
  resolvedDisputes?: number;
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
  const provided = input.referencesProvided;
  if (typeof provided !== 'number') {
    return result('references', 'unknown', 0, 'No references on record.');
  }
  if (provided === 0) {
    return result('references', 'fail', 0, 'No references supplied.');
  }
  const cleared = typeof input.referencesCleared === 'number' ? input.referencesCleared : 0;
  if (cleared === 0) {
    return result('references', 'concern', 0.25, `${provided} supplied, none checked yet.`);
  }
  if (cleared >= 2) {
    return result('references', 'pass', 1, `${cleared} references checked and cleared.`);
  }
  return result('references', 'concern', 0.6, 'One reference checked and cleared.');
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
  const months = input.ususuMonths;
  if (typeof months !== 'number') {
    // Deliberately `unknown` rather than `fail`. Ususu is a ride service; not
    // using one is not a mark against a tenant, and treating it as one would
    // make housing conditional on mobility.
    return result('ususuContributions', 'unknown', 0, 'No Ususu contributions on record.');
  }
  if (months >= 6) {
    return result('ususuContributions', 'pass', 1, `${months} consecutive months of contributions.`);
  }
  if (months >= 3) {
    return result('ususuContributions', 'concern', 0.6, `${months} months of contributions.`);
  }
  if (months > 0) {
    return result('ususuContributions', 'concern', 0.3, `${months} months of contributions.`);
  }
  return result('ususuContributions', 'unknown', 0, 'No Ususu contributions on record.');
}

function scoreDisputes(input: EligibilityInput): FactorResult {
  const open = input.openDisputes;
  const resolved = input.resolvedDisputes ?? 0;

  if (typeof open !== 'number') {
    return result('disputes', 'unknown', 0, 'Dispute history not checked.');
  }
  if (open > 0) {
    return result(
      'disputes',
      'fail',
      0,
      `${open} open ${open === 1 ? 'dispute' : 'disputes'} must be resolved first.`,
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

/** Score at or above which an unblocked, fully-evidenced application is recommended. */
export const RECOMMEND_AT = 70;
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

  let recommendation: Recommendation;
  if (score >= RECOMMEND_AT) recommendation = 'recommend';
  else if (score >= REVIEW_AT) recommendation = 'review';
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
