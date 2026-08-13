/**
 * Ususu groups — who may run one, who may be in one, and what its health means.
 *
 * Pure: no Express, no Mongoose, no clock.
 *
 * ── What an Ususu group is ────────────────────────────────────────────────
 * A rotating savings circle. A handful of people put in the same amount each
 * period and one of them takes the pot; next period, the next person. It is how
 * a very large share of West Africa saves, and it works because everybody knows
 * everybody — the enforcement is social, not legal.
 *
 * LRMC records them because a person who has kept up with a circle for two
 * years has demonstrated something a bank statement cannot show. That evidence
 * counts *in an applicant's favour* and never against them: somebody who has
 * never been in a circle is not a worse tenant, and `ususuEvidence` reports
 * `hasRecord: false` rather than a zero for exactly that reason.
 *
 * ══ Three deviations from the brief, and why ══════════════════════════════
 *
 * The brief specified a group document holding `contributions[]`, a `streaks`
 * map and a stored `groupHealth`. All three are computed here instead, and the
 * reasons are the same reasons the existing ledger gives for being a ledger:
 *
 *  1. **Contributions stay in `UsusuEntry`**, the append-only ledger that
 *     already exists, with a `group` field added. Embedding them would put a
 *     twenty-member group's three years of history — seven hundred entries —
 *     in one document, and would give the platform two records of the same
 *     fact. The scoring engine reads the ledger; a group that disagreed with it
 *     would be a second opinion nobody could reconcile.
 *
 *  2. **`streaks` is derived on read.** A stored streak is a number somebody
 *     can correct by hand, and it goes stale the moment a contribution is
 *     recorded out of order. The ledger already carries `period`, which is what
 *     a streak is actually counted over.
 *
 *  3. **`groupHealth` is derived on read**, for the same reason, and it is
 *     `null` — not `0`, not `100` — for a group with no contributions at all.
 *     A circle nobody has paid into yet is not a *failing* circle.
 *
 * The read endpoints return all three, so the shape the brief asked for is what
 * a caller actually receives. What differs is where the truth lives.
 */

import { GROUP_HEALTH_PENALTY_PER_MISS, groupHealthFrom } from '../../config/evidence.js';

export { GROUP_HEALTH_PENALTY_PER_MISS, groupHealthFrom };

/* ─────────────────────────────────────────────────────────────────────────────
 * Lifecycle
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * A group's states.
 *
 * Short on purpose. A savings circle is either running, paused between rounds,
 * or finished; there is no approval workflow because LRMC does not approve
 * people's savings arrangements, it records them.
 */
export const USUSU_GROUP_STATUSES = ['forming', 'active', 'paused', 'closed'] as const;
export type UsusuGroupStatus = (typeof USUSU_GROUP_STATUSES)[number];

export const USUSU_GROUP_TRANSITIONS: Record<UsusuGroupStatus, readonly UsusuGroupStatus[]> = {
  /** Members are being gathered. Nobody has contributed. */
  forming: ['active', 'closed'],
  /** Running. */
  active: ['paused', 'closed'],
  /** Between rounds, or waiting on somebody. Rejoinable. */
  paused: ['active', 'closed'],
  /** Finished. Terminal — the history stays, and a new round is a new group,
   *  because a reopened circle would silently rewrite everybody's streak. */
  closed: [],
};

export function canTransitionGroup(from: string, to: string): boolean {
  const allowed = USUSU_GROUP_TRANSITIONS[from as UsusuGroupStatus];
  return Array.isArray(allowed) && (allowed as readonly string[]).includes(to);
}

/** States in which contributions may still be recorded. */
export const OPEN_GROUP_STATUSES: readonly UsusuGroupStatus[] = ['forming', 'active', 'paused'];

export function isOpenGroup(status: string): boolean {
  return (OPEN_GROUP_STATUSES as readonly string[]).includes(status);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Who
 * ────────────────────────────────────────────────────────────────────────── */

export interface GroupActor {
  userId: string;
  roles: string[];
}

/** Roles whose remit is the whole platform. */
export const GROUP_WIDE_ROLES = ['founder', 'hqExecutive', 'backOfficeStaff'] as const;

export function isGroupStaff(actor: GroupActor | null | undefined): boolean {
  if (!actor || !Array.isArray(actor.roles)) return false;
  return (GROUP_WIDE_ROLES as readonly string[]).some((r) => actor.roles.includes(r));
}

/** Only a coordinator or LRMC opens a circle on the platform. */
export function mayCreateGroup(actor: GroupActor | null | undefined): boolean {
  if (!actor || !Array.isArray(actor.roles)) return false;
  return actor.roles.includes('coordinator') || isGroupStaff(actor);
}

export type GroupRelation = 'steward' | 'member' | 'staff' | 'none';

/**
 * What this person is to this group.
 *
 * `steward` is whoever created it — the coordinator who runs the circle.
 * Deliberately not called "owner": nobody owns a savings circle, and the word
 * would suggest they hold the money. They hold the register.
 */
export function relationTo(
  actor: GroupActor | null | undefined,
  group: { createdBy?: string | null; members?: string[] | null },
): GroupRelation {
  if (!actor || typeof actor.userId !== 'string' || !actor.userId) return 'none';
  if (!Array.isArray(actor.roles)) return 'none';

  if (isGroupStaff(actor)) return 'staff';
  if (group.createdBy && group.createdBy === actor.userId) return 'steward';
  if (Array.isArray(group.members) && group.members.includes(actor.userId)) return 'member';
  return 'none';
}

/**
 * May this person read this group?
 *
 * **A coordinator does not see every group**, and that is the interesting line
 * — the brief called for it explicitly and it would have been easy to get
 * wrong, because coordinators see almost everything else on this platform.
 *
 * A savings circle is a private financial arrangement between named people. A
 * coordinator who happens to steward a circle in Serrekunda has no business
 * reading the contribution history of a circle in Basse. They see the ones they
 * steward; members see the ones they are in; only Back Office sees all, and
 * only because reconciliation is their job.
 */
export function mayReadGroup(
  actor: GroupActor | null | undefined,
  group: { createdBy?: string | null; members?: string[] | null },
): boolean {
  return relationTo(actor, group) !== 'none';
}

/**
 * May this person change the register — add or remove members, move the
 * lifecycle?
 *
 * The steward and LRMC. Not an ordinary member: a circle where anybody can
 * remove anybody is a circle where a disagreement is settled by whoever gets to
 * the phone first.
 */
export function mayManageGroup(
  actor: GroupActor | null | undefined,
  group: { createdBy?: string | null; members?: string[] | null },
): boolean {
  const relation = relationTo(actor, group);
  return relation === 'steward' || relation === 'staff';
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Membership
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The largest circle LRMC will record.
 *
 * Not a limit on how people save — it is a limit on what this data model is
 * honest about. A rotating circle works because each member takes the pot once
 * per round; past a certain size the round is longer than anybody's patience
 * and the thing being recorded is no longer a rotating circle. Fifty is
 * generous; the typical circle is eight to fifteen.
 */
export const MAX_GROUP_MEMBERS = 50;

/** Below this, "the group" is two people with an arrangement. */
export const MIN_GROUP_MEMBERS = 2;

export interface MembershipAttempt {
  member?: string | null;
  members?: string[] | null;
  status?: string;
  createdBy?: string | null;
}

/**
 * Everything wrong with adding somebody.
 *
 * A list rather than a first-failure throw, as everywhere else here: the person
 * doing this is a coordinator on a phone, and one problem per round trip is how
 * a register stops being kept.
 */
export function addMemberProblems(
  actor: GroupActor | null | undefined,
  group: { status: string; createdBy?: string | null; members?: string[] | null },
  member: string | null | undefined,
): { field: string; code: string; message: string }[] {
  const out: { field: string; code: string; message: string }[] = [];
  const add = (field: string, code: string, message: string) =>
    out.push({ field, code, message });

  if (!mayManageGroup(actor, group)) {
    add('actor', 'not-permitted',
      'Only the coordinator who runs this circle, or LRMC, may change who is in it.');
    return out;
  }
  if (!member) {
    add('member', 'required', 'Say who is joining.');
    return out;
  }

  const members = group.members ?? [];
  if (members.includes(member)) {
    /* Not an error worth shouting about — two people tapping "add" is ordinary
     * — but it must not silently double the register, because a duplicated
     * member would be counted twice in group health. */
    add('member', 'already-a-member', 'They are already in this circle.');
  }
  if (members.length >= MAX_GROUP_MEMBERS) {
    add('member', 'group-full',
      `A circle this size is no longer a rotating circle. ${MAX_GROUP_MEMBERS} is the most LRMC records.`);
  }
  /* A closed circle's register is history, and history is not edited. Adding
   * somebody to a finished round would credit them with contributions they
   * never made. */
  if (!isOpenGroup(group.status)) {
    add('member', 'group-closed', 'This circle is closed. Its members are a matter of record now.');
  }

  return out;
}

/**
 * Everything wrong with removing somebody.
 *
 * The important rule is the last one: **removing a member never deletes their
 * contributions.** Somebody who paid into a circle for a year and then left has
 * a year of evidence, and a register change must not erase it. The ledger is
 * append-only and this function does not touch it — it is stated here because
 * the obvious implementation of "remove a member" is to tidy up after them.
 */
export function removeMemberProblems(
  actor: GroupActor | null | undefined,
  group: { status: string; createdBy?: string | null; members?: string[] | null },
  member: string | null | undefined,
): { field: string; code: string; message: string }[] {
  const out: { field: string; code: string; message: string }[] = [];
  const add = (field: string, code: string, message: string) =>
    out.push({ field, code, message });

  if (!mayManageGroup(actor, group)) {
    add('actor', 'not-permitted',
      'Only the coordinator who runs this circle, or LRMC, may change who is in it.');
    return out;
  }
  if (!member) {
    add('member', 'required', 'Say who is leaving.');
    return out;
  }
  if (!(group.members ?? []).includes(member)) {
    add('member', 'not-a-member', 'They are not in this circle.');
  }
  /* The steward is the person answerable for the register. Removing them would
   * leave a circle nobody can manage, and there is no succession here yet —
   * so it is refused with an explanation rather than silently allowed. */
  if (group.createdBy && group.createdBy === member) {
    add('member', 'is-the-steward',
      'The coordinator who runs this circle cannot be removed from it. Close the circle instead.');
  }

  return out;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Contributing
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Everything wrong with recording a contribution or a miss.
 *
 * ── Nobody records their own ──────────────────────────────────────────────
 * The same rule as every other kind of evidence on this platform, and the
 * reason is the same: a contribution somebody wrote down about themselves is
 * not a record, it is a claim, and it is the one claim nobody else is in a
 * position to check. In a real circle the person who keeps the book is not the
 * person putting money in that week.
 *
 * This is the rule that keeps Ususu evidence worth anything at all. Without it,
 * the fastest route to a high tenancy score is to open a circle and pay
 * yourself on paper.
 */
export function contributionProblems(
  actor: GroupActor | null | undefined,
  group: { status: string; createdBy?: string | null; members?: string[] | null },
  input: { member?: string | null; period?: string | null; amount?: number | null },
  kind: 'contribution' | 'miss' = 'contribution',
): { field: string; code: string; message: string }[] {
  const out: { field: string; code: string; message: string }[] = [];
  const add = (field: string, code: string, message: string) =>
    out.push({ field, code, message });

  if (!actor || typeof actor.userId !== 'string' || !actor.userId
      || !Array.isArray(actor.roles)) {
    add('actor', 'unidentified', 'A contribution needs a named recorder.');
    return out;
  }
  if (!mayManageGroup(actor, group)) {
    add('actor', 'not-permitted',
      'Only the coordinator who runs this circle, or LRMC, may record contributions.');
  }

  if (!input.member) {
    add('member', 'required', 'Say who this is for.');
  } else {
    if (input.member === actor.userId) {
      add('member', 'self-recording',
        'You cannot record your own contribution. Ask a colleague at LRMC to record it.');
    }
    if (!(group.members ?? []).includes(input.member)) {
      add('member', 'not-a-member',
        'They are not in this circle. Add them first, so the record says when they joined.');
    }
  }

  if (!isOpenGroup(group.status)) {
    add('member', 'group-closed', 'This circle is closed. Nothing more can be recorded against it.');
  }

  if (!String(input.period ?? '').trim()) {
    /* The period is what a streak is counted over and what makes a duplicate
     * detectable. Without it, two entries for March are indistinguishable from
     * March and April. */
    add('period', 'required', 'Say which period this is for, such as 2026-08.');
  } else if (!PERIOD_PATTERN.test(String(input.period).trim())) {
    add('period', 'malformed', 'Write the period as a year and month, such as 2026-08.');
  }

  if (kind === 'contribution') {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      add('amount', 'required', 'Enter the amount contributed.');
    }
  }

  return out;
}

/** `YYYY-MM`. Sortable as a string, which is what makes streak counting cheap. */
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ─────────────────────────────────────────────────────────────────────────────
 * What a group's ledger says
 * ────────────────────────────────────────────────────────────────────────── */

export interface GroupLedgerRow {
  member: string;
  kind: 'contribution' | 'miss';
  period: string;
  amount?: number | null;
  currency?: string | null;
}

export interface GroupSummary {
  memberCount: number;
  contributions: number;
  misses: number;
  /**
   * 0–100, or `null` when nobody has contributed yet.
   *
   * `null`, not `100` and not `0`. A circle formed on Tuesday with nobody
   * having paid in yet is not in perfect health and is not in bad health — it
   * has no health to report, and a tile showing either number would be stating
   * something LRMC does not know.
   */
  groupHealth: number | null;
  /** Consecutive contributions without a miss, per member. */
  streaks: Record<string, number>;
  /** One entry per currency, never summed. There is no exchange rate here. */
  contributedByCurrency: { currency: string; amount: number; entries: number }[];
  /** Whether LRMC has anything at all to report. */
  hasActivity: boolean;
}

/**
 * Turn a group's ledger into the figures its page shows.
 *
 * `groupHealth` is `100 - misses * 5`, floored at zero, exactly as the brief
 * asked — that arithmetic already lives in `config/evidence.ts` as
 * `groupHealthFrom`, and is imported rather than rewritten so a circle's page
 * and an applicant's assessment can never disagree about what a miss costs.
 */
export function summariseGroup(
  rows: GroupLedgerRow[],
  members: string[],
  launchCurrency = 'GMD',
): GroupSummary {
  const list = Array.isArray(rows) ? rows : [];
  const contributions = list.filter((r) => r.kind === 'contribution').length;
  const misses = list.filter((r) => r.kind === 'miss').length;
  const hasActivity = list.length > 0;

  const byCurrency = new Map<string, { amount: number; entries: number }>();
  for (const row of list) {
    if (row.kind !== 'contribution') continue;
    const key = row.currency || launchCurrency;
    const entry = byCurrency.get(key) ?? { amount: 0, entries: 0 };
    const amount = Number(row.amount);
    entry.amount += Number.isFinite(amount) ? Math.max(0, amount) : 0;
    entry.entries += 1;
    byCurrency.set(key, entry);
  }

  return {
    memberCount: Array.isArray(members) ? members.length : 0,
    contributions,
    misses,
    /* Null over nothing. See the field's own note. */
    groupHealth: hasActivity ? groupHealthFrom(misses) : null,
    streaks: streaksFrom(list, members),
    contributedByCurrency: [...byCurrency.entries()]
      .map(([currency, v]) => ({ currency, amount: v.amount, entries: v.entries }))
      .sort((a, b) => b.amount - a.amount),
    hasActivity,
  };
}

/**
 * Each member's current streak: contributions in a row, counting back from the
 * most recent period, stopping at the first miss.
 *
 * **Counted backwards from the latest period**, which is the only direction
 * that gives the right answer. Counting forwards returns the length of
 * somebody's *first* good run — so a member who paid for six months, missed
 * one, and has paid every month for two years since would be reported with a
 * streak of six.
 *
 * A member with no entries at all gets `0`. That is a real zero rather than an
 * unknown: they are in the circle, LRMC has looked, and they have not
 * contributed. The distinction between that and "not in any circle" is carried
 * by `ususuEvidence.hasRecord`, one level up.
 */
export function streaksFrom(
  rows: GroupLedgerRow[],
  members: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of Array.isArray(members) ? members : []) out[m] = 0;

  const byMember = new Map<string, GroupLedgerRow[]>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const list = byMember.get(row.member) ?? [];
    list.push(row);
    byMember.set(row.member, list);
  }

  for (const [member, list] of byMember) {
    /* Sorted by period, not by insertion. A contribution recorded late — which
     * happens constantly, because a coordinator writes up a week of collections
     * on Friday — would otherwise land at the end and be counted as the most
     * recent. */
    const sorted = [...list].sort((a, b) => String(a.period).localeCompare(String(b.period)));
    let streak = 0;
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      if (sorted[i]!.kind !== 'contribution') break;
      streak += 1;
    }
    out[member] = streak;
  }
  return out;
}
