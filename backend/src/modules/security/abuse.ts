/**
 * Anomaly detection, and what LRMC does about it.
 *
 * Pure: no Express, no Mongoose, no clock. The caller counts; this file decides
 * what a count means.
 *
 * ── What this is not ──────────────────────────────────────────────────────
 * Not a fraud engine, not machine learning, and deliberately not clever. It
 * watches a handful of things that would be strange for a real member to do and
 * are cheap for somebody probing the platform to do, and it raises them to a
 * person.
 *
 * The reason it is dull is the reason it is safe. Every rule here can produce a
 * false positive, and every false positive lands on somebody trying to pay
 * their rent. So nothing in this file blocks anybody: the strongest outcome is
 * `escalate`, which puts a signal in front of a coordinator. Locking an account
 * remains what it already was — a deliberate act by Back Office, and the
 * automatic lockout after repeated failed logins, which is narrow and
 * reversible.
 *
 * ── Escalation goes to a coordinator, not to the founder ──────────────────
 * The person who can actually resolve "this tenant's account is behaving oddly"
 * is the coordinator who knows them and can telephone them. Routing anomalies
 * to Zone A would put them in front of somebody with no context and no time,
 * which is how a security signal becomes something nobody reads.
 */

/* ─────────────────────────────────────────────────────────────────────────────
 * Signals
 * ────────────────────────────────────────────────────────────────────────── */

export const ABUSE_SIGNALS = [
  /** Many failed sign-ins from one address, across different accounts. */
  'credentialStuffing',
  /** One account signing in from several places in an implausible window. */
  'impossibleTravel',
  /** A burst of refusals — somebody walking the API to see what answers. */
  'permissionProbing',
  /** Money records appearing far faster than a person could take cash. */
  'recordingBurst',
  /** A single account enumerating other people's records. */
  'enumeration',
] as const;

export type AbuseSignal = (typeof ABUSE_SIGNALS)[number];

/**
 * What LRMC does about a signal.
 *
 * Three levels, and the ceiling is deliberate. `escalate` is the strongest
 * because every rule here can be wrong about a real member, and a system that
 * can lock somebody out on a heuristic will eventually lock out a tenant on the
 * day their rent is due.
 */
export const ABUSE_ACTIONS = ['ignore', 'watch', 'escalate'] as const;
export type AbuseAction = (typeof ABUSE_ACTIONS)[number];

export interface SignalDefinition {
  signal: AbuseSignal;
  /** Below this, nothing happens. */
  watchAt: number;
  /** At or above this, a person is told. */
  escalateAt: number;
  /** The window the count is taken over, in minutes. */
  windowMinutes: number;
  /** What a coordinator reads. Never names a database column. */
  describe: (count: number) => string;
}

/**
 * The thresholds.
 *
 * Chosen to be quiet. A rule that fires weekly is a rule somebody investigates;
 * a rule that fires hourly is a rule somebody filters into a folder, and a
 * filtered alert is worse than no alert because it looks like coverage.
 */
export const SIGNAL_DEFINITIONS: Record<AbuseSignal, SignalDefinition> = {
  credentialStuffing: {
    signal: 'credentialStuffing',
    watchAt: 10,
    escalateAt: 25,
    windowMinutes: 15,
    describe: (n) => `${n} failed sign-ins from one address, across different accounts.`,
  },
  impossibleTravel: {
    /* Two distinct addresses is ordinary — a phone on mobile data and a laptop
     * on wifi. Five in a quarter of an hour is not, and in The Gambia, where
     * shared devices and shared accounts are common, this is the signal most
     * likely to be a real member doing something reasonable. Hence the gap
     * between watching and escalating. */
    signal: 'impossibleTravel',
    watchAt: 3,
    escalateAt: 6,
    windowMinutes: 15,
    describe: (n) => `Signed in from ${n} different addresses in a quarter of an hour.`,
  },
  permissionProbing: {
    signal: 'permissionProbing',
    watchAt: 15,
    escalateAt: 40,
    windowMinutes: 10,
    describe: (n) => `${n} refused requests in ten minutes — somebody trying doors.`,
  },
  recordingBurst: {
    /* A coordinator writing up a week of cash collections on a Friday might
     * enter twenty receipts in an hour. Forty is a lot of compounds. */
    signal: 'recordingBurst',
    watchAt: 25,
    escalateAt: 60,
    windowMinutes: 60,
    describe: (n) => `${n} payments recorded by hand in an hour.`,
  },
  enumeration: {
    signal: 'enumeration',
    watchAt: 30,
    escalateAt: 80,
    windowMinutes: 10,
    describe: (n) => `Looked up ${n} different people's records in ten minutes.`,
  },
};

/**
 * What to do about a count.
 *
 * `>=`, not `>`: a threshold of 25 means twenty-five is enough. Getting this
 * wrong is the classic off-by-one in alerting and it fails silent — the alert
 * simply never fires at the number somebody wrote down.
 */
export function actionFor(signal: AbuseSignal, count: number): AbuseAction {
  const def = SIGNAL_DEFINITIONS[signal];
  if (!def) return 'ignore';
  /* Redundant while every `watchAt` is at least 1 — and the suite asserts that
   * it is, so this is provably belt to those braces rather than a guard nobody
   * has checked. It stays because a threshold of 0 would otherwise make every
   * request with no observations at all look like an anomaly, and that is a
   * one-character mistake away. */
  if (!Number.isFinite(count) || count <= 0) return 'ignore';
  if (count >= def.escalateAt) return 'escalate';
  if (count >= def.watchAt) return 'watch';
  return 'ignore';
}

export interface AbuseObservation {
  signal: AbuseSignal;
  count: number;
  /** The account involved, where there is one. */
  subject?: string | null;
  /** The address involved, where there is one. */
  address?: string | null;
}

export interface AbuseFinding {
  signal: AbuseSignal;
  action: AbuseAction;
  count: number;
  windowMinutes: number;
  subject: string | null;
  address: string | null;
  /** One sentence a coordinator can read. */
  summary: string;
}

/**
 * Turn observations into findings, dropping the ones nobody needs to see.
 *
 * Sorted with escalations first, because a list where the urgent thing is
 * fourteenth is a list nobody reads to the bottom of.
 */
export function assessAbuse(observations: AbuseObservation[]): AbuseFinding[] {
  const list = Array.isArray(observations) ? observations : [];
  const findings: AbuseFinding[] = [];

  for (const obs of list) {
    const def = SIGNAL_DEFINITIONS[obs.signal];
    if (!def) continue;
    const action = actionFor(obs.signal, obs.count);
    if (action === 'ignore') continue;
    findings.push({
      signal: obs.signal,
      action,
      count: obs.count,
      windowMinutes: def.windowMinutes,
      subject: obs.subject ?? null,
      address: obs.address ?? null,
      summary: def.describe(obs.count),
    });
  }

  const weight = (a: AbuseAction) => (a === 'escalate' ? 0 : 1);
  return findings.sort((a, b) =>
    weight(a.action) - weight(b.action) || b.count - a.count);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Who is told
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Roles that receive an escalation.
 *
 * A coordinator, because they know the member and can telephone them, and Back
 * Office, because they can act. **Not the founder** — Zone A is for decisions
 * only the founder can make, and a queue of heuristic alerts in front of
 * somebody with no time is a queue nobody reads.
 */
export const ESCALATION_ROLES = ['coordinator', 'backOfficeStaff'] as const;

export function mayReceiveEscalation(actor: { roles: string[] } | null | undefined): boolean {
  if (!actor || !Array.isArray(actor.roles)) return false;
  return (ESCALATION_ROLES as readonly string[]).some((r) => actor.roles.includes(r));
}

/**
 * May this person read the abuse feed?
 *
 * The same list, plus HQ and the founder — who are not *sent* escalations but
 * must be able to look. Being able to read a security feed and being paged by
 * it are different things, and conflating them is how the founder ends up
 * either blind or buried.
 */
export const ABUSE_READ_ROLES = [
  'coordinator', 'backOfficeStaff', 'hqExecutive', 'founder',
] as const;

export function mayReadAbuse(actor: { roles: string[] } | null | undefined): boolean {
  if (!actor || !Array.isArray(actor.roles)) return false;
  return (ABUSE_READ_ROLES as readonly string[]).some((r) => actor.roles.includes(r));
}

/**
 * Nothing here ever blocks anybody.
 *
 * Stated as a function so it can be asserted rather than trusted. If somebody
 * later adds a `block` action, this returns false and the suite fails, and they
 * have to come and read the note at the top of this file about what a false
 * positive costs a person trying to pay their rent.
 */
export function isAdvisoryOnly(): boolean {
  return !(ABUSE_ACTIONS as readonly string[]).some(
    (a) => a === 'block' || a === 'lock' || a === 'ban' || a === 'suspend',
  );
}
