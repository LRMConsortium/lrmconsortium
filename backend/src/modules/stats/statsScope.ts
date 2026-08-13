/**
 * Who a statistic is about.
 *
 * Pure — no Express, no Mongoose. It lives apart from the handlers because it
 * is the only security-relevant line in the stats module and the handlers are
 * not testable without a database. A `$match` that widens by one role is a
 * dashboard that shows one landlord the institution's whole rent roll, and
 * that must be assertable in a suite that runs in a second.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * The scope is **derived from the token**. There is no `?owner=` and no
 * `?region=`. A parameter a client could set would turn every one of these
 * endpoints into a directory of LRMC's holdings queryable by anybody with a
 * login, and it would do so while looking exactly like a feature.
 *
 * ── Failing closed ────────────────────────────────────────────────────────
 * Every path that cannot work out a scope returns `DENY_ALL` — a match no
 * document satisfies — rather than `{}`. `{}` means "no filter", which in an
 * aggregation means *everything*. The difference between the two is one pair of
 * braces and the entire access model, so the empty scope is a named constant
 * here and never written inline.
 *
 * A coordinator with no region assigned is the case that makes this concrete:
 * they hold a supervisory role, so a naive "not a plain owner, so no owner
 * filter" reading gives them the lot. They see nothing until somebody assigns
 * them a region.
 */

/** Roles whose remit is the whole institution. */
export const UNSCOPED_ROLES = ['founder', 'hqExecutive', 'backOfficeStaff'] as const;

/** Roles scoped to a region rather than to their own records. */
export const REGIONAL_ROLES = ['coordinator'] as const;

/**
 * A match no document satisfies.
 *
 * `_id: null` and not `{}`. An empty object is not "nothing" to an aggregation
 * pipeline — it is "no restriction".
 */
export const DENY_ALL: Record<string, unknown> = { _id: null };

/** No restriction. Named so that returning it is a deliberate act. */
export const ALLOW_ALL: Record<string, unknown> = {};

export interface ScopeActor {
  userId: string;
  roles: string[];
  regions?: string[];
}

/**
 * Which field on this collection carries each kind of ownership.
 *
 * Named per collection rather than guessed, because the word differs: a
 * property is owned by a landlord, an application is submitted by an
 * applicant, a payment belongs to whoever it moved money for. A guess that got
 * it wrong would silently match nothing — a dashboard of zeros — or, worse,
 * match everything.
 */
export interface ScopeFields {
  /** The field holding the individual whose records these are. */
  owner?: string;
  /** The field holding the supervising coordinator, if the collection has one. */
  coordinator?: string;
  /** The field holding the region, for coordinators supervising an area. */
  region?: string;
}

export function seesEverything(actor: ScopeActor): boolean {
  return (UNSCOPED_ROLES as readonly string[]).some((r) => actor.roles.includes(r));
}

export function isRegional(actor: ScopeActor): boolean {
  return (REGIONAL_ROLES as readonly string[]).some((r) => actor.roles.includes(r));
}

/**
 * The scope for one collection, as a match stage.
 *
 * Order matters and is deliberate: institution-wide first, then regional, then
 * own-records, then deny. A coordinator who is also a landlord gets the
 * regional scope, which is the wider of the two they are entitled to — not
 * both scopes unioned, because a union of two `$match` shapes is an `$or` and
 * writing one here would be the first step toward a filter nobody can read.
 */
export function scopeFor(
  actor: ScopeActor,
  fields: ScopeFields,
): Record<string, unknown> {
  if (!actor || typeof actor.userId !== 'string' || !actor.userId) return { ...DENY_ALL };
  if (!Array.isArray(actor.roles)) return { ...DENY_ALL };

  if (seesEverything(actor)) return { ...ALLOW_ALL };

  if (isRegional(actor)) {
    if (fields.coordinator) return { [fields.coordinator]: actor.userId };
    if (fields.region && actor.regions?.length) {
      return { [fields.region]: { $in: [...actor.regions] } };
    }
    // Holds a supervisory role, has nothing to supervise.
    return { ...DENY_ALL };
  }

  if (fields.owner) return { [fields.owner]: actor.userId };

  // A role this file has never heard of. Better an empty dashboard than
  // somebody else's.
  return { ...DENY_ALL };
}

/**
 * Is this scope the one that shows everything?
 *
 * Exists so the suite can assert the question directly instead of comparing
 * object literals, and so a reviewer can see at a glance that "no keys" is
 * what unrestricted looks like.
 */
export function isUnrestricted(scope: Record<string, unknown>): boolean {
  return Object.keys(scope).length === 0;
}
