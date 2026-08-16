/**
 * Tenancy applications — the lifecycle, and who is allowed to move it.
 *
 * `eligibility.ts` scores. This file is where somebody decides, and it exists
 * separately so that the decision always has an author. Every transition into
 * `approved` or `rejected` requires a decider and a reason; the table below
 * cannot express an approval that happened by itself.
 *
 * Pure — no Express, no Mongoose.
 */

export const APPLICATION_STATUSES = [
  /** The tenant has applied. LRMC has not looked yet. */
  'submitted',
  /** Somebody at LRMC has it open. */
  'underReview',
  /** LRMC has asked the applicant for something. The clock is on them. */
  'awaitingApplicant',
  /** A named person approved it. No lease yet. */
  'approved',
  /** A named person rejected it, with a reason. */
  'rejected',
  /** The applicant pulled out. */
  'withdrawn',
  /** A lease was generated from the approval. Terminal. */
  'leaseIssued',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Five rules enforced by absence from this table:
 *
 *  1. **Nothing reaches `leaseIssued` except from `approved`.** A lease is the
 *     institution committing a landlord's property to a tenant; it may only
 *     follow a decision somebody signed.
 *  2. **`rejected` is terminal.** Reversing a refusal in place would leave a
 *     record whose history contradicts the letter the applicant received. They
 *     apply again.
 *  3. **`leaseIssued` is terminal.** Undoing it is a lease termination, which
 *     is a different process with different notice.
 *  4. **An application cannot be approved straight from `submitted`.** Someone
 *     has to open it first — which is what makes `decidedBy` mean something.
 *  5. **`withdrawn` cannot be undone by LRMC.** Only the applicant withdraws,
 *     and only they can start again.
 */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  submitted: ['underReview', 'withdrawn'],
  underReview: ['awaitingApplicant', 'approved', 'rejected', 'withdrawn'],
  awaitingApplicant: ['underReview', 'withdrawn', 'rejected'],
  approved: ['leaseIssued', 'withdrawn'],
  rejected: [],
  withdrawn: [],
  leaseIssued: [],
};

export function canTransitionApplication(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return (APPLICATION_TRANSITIONS[from] ?? []).includes(to);
}

export function nextApplicationStatuses(
  from: ApplicationStatus,
): readonly ApplicationStatus[] {
  return APPLICATION_TRANSITIONS[from] ?? [];
}

/** Still somebody's work. */
export function isOpenApplication(status: ApplicationStatus): boolean {
  return status === 'submitted' || status === 'underReview' || status === 'awaitingApplicant';
}

/** A statement about the applicant that outlives the application. */
export function isDecided(status: ApplicationStatus): boolean {
  return status === 'approved' || status === 'rejected' || status === 'leaseIssued';
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Who decides
 * ────────────────────────────────────────────────────────────────────────── */

export type ApplicationActor = 'applicant' | 'landlord' | 'coordinator' | 'staff';

/**
 * Transitions that must carry a named decider and a reason.
 *
 * Approval is on the list as well as rejection. It is tempting to require a
 * reason only for a refusal, but an approval nobody signed is exactly the
 * thing that cannot be defended later — and "who let this tenancy through" is
 * asked more often than anyone expects.
 */
export const DECISIONS: readonly ApplicationStatus[] = ['approved', 'rejected'];

export function requiresDecider(to: ApplicationStatus): boolean {
  return DECISIONS.includes(to);
}

/**
 * May this actor move an application here?
 *
 * The landlord is deliberately absent from `approved` and `rejected`. LRMC
 * carries the tenancy, holds the deposit and answers for the decision, so LRMC
 * makes it — the landlord's view is an input, recorded on the application,
 * not the act itself. If that is not what LRMC wants, it is a one-line change
 * here and the assertions will tell you what else it moves.
 */
export function mayDecide(actor: ApplicationActor, to: ApplicationStatus): boolean {
  switch (to) {
    case 'withdrawn':
      return actor === 'applicant';
    case 'underReview':
    case 'awaitingApplicant':
      return actor === 'coordinator' || actor === 'staff';
    case 'approved':
    case 'rejected':
      return actor === 'coordinator' || actor === 'staff';
    case 'leaseIssued':
      return actor === 'staff';
    default:
      return false;
  }
}

export type DecisionProblem =
  | 'not-a-transition'
  | 'not-your-decision'
  | 'needs-a-decider'
  | 'needs-a-reason';

export interface DecisionAttempt {
  from: ApplicationStatus;
  to: ApplicationStatus;
  actor: ApplicationActor;
  decidedBy?: string;
  reason?: string;
}

/**
 * Everything wrong with a decision, in one pass.
 *
 * Returns every problem rather than the first, so a caller is told once what
 * to fix instead of discovering it a refusal at a time.
 */
export function decisionProblems(attempt: DecisionAttempt): DecisionProblem[] {
  const problems: DecisionProblem[] = [];

  if (!canTransitionApplication(attempt.from, attempt.to)) problems.push('not-a-transition');
  if (!mayDecide(attempt.actor, attempt.to)) problems.push('not-your-decision');

  if (requiresDecider(attempt.to)) {
    if (!attempt.decidedBy || !attempt.decidedBy.trim()) problems.push('needs-a-decider');
    if (!attempt.reason || attempt.reason.trim().length < 4) problems.push('needs-a-reason');
  }

  return problems;
}

export function describeDecisionProblem(problem: DecisionProblem): string {
  switch (problem) {
    case 'not-a-transition':
      return 'An application cannot move from where it is to there.';
    case 'not-your-decision':
      return 'That decision is not yours to make.';
    case 'needs-a-decider':
      return 'A decision has to be signed by the person making it.';
    case 'needs-a-reason':
      return 'A decision has to carry a reason the applicant could be shown.';
    default:
      return 'That decision cannot be recorded.';
  }
}
