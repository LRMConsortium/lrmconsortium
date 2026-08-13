/**
 * Faults reported by a browser, and what LRMC is allowed to do about them.
 *
 * Pure: no Express, no Mongoose, no clock.
 *
 * ── The rule that governs this whole file ─────────────────────────────────
 * **Nothing here may ever stop somebody paying their rent.**
 *
 * That is not a slogan. An error pipeline is exactly the kind of subsystem that
 * grows a circuit breaker — "this client is reporting a lot of faults, stop
 * serving it" — and the client reporting a lot of faults is, overwhelmingly, a
 * member on a bad connection in Basse whose page half-loaded. Throttling them
 * would take the platform away from precisely the person it exists for, at
 * precisely the moment it was already failing them.
 *
 * So: intake is append-only, it never blocks, it never locks, it never rate-
 * limits a member out of the application, and the strongest thing it can
 * produce is an escalation to a coordinator. `intakeIsAdvisoryOnly()` asserts
 * that, and it is asserted so a future contributor has to come and read this
 * paragraph before adding a fourth verb.
 *
 * ── What it is for ────────────────────────────────────────────────────────
 * Finding out that a page is broken without waiting for somebody to telephone.
 * `boot.js` already proved the shape of the problem: Alpine failing left the
 * sidebar covering the screen with no console error and no visible fault, and
 * the only way anybody would have known is a member giving up. A dead control
 * is a fault worth reporting even though nothing threw.
 *
 * ── What it must not collect ──────────────────────────────────────────────
 * A stack trace from a page about somebody's rent can carry their name, their
 * property, their balance. `redactReport` strips anything that looks like it
 * came from a person rather than from the code, and the URL is reduced to a
 * path template. An error pipeline that quietly becomes a second copy of the
 * database is the failure mode here, and it is not hypothetical — it is what
 * every naive implementation does.
 */

/* ─────────────────────────────────────────────────────────────────────────────
 * What a browser can report
 * ────────────────────────────────────────────────────────────────────────── */

export const ERROR_KINDS = [
  /** An uncaught exception. `window.onerror`. */
  'uncaught',
  /** A rejected promise nobody handled. */
  'unhandledRejection',
  /** Alpine never initialised — the case `boot.js` exists for. */
  'frameworkMissing',
  /** A request failed at the transport layer, not with a status. */
  'networkFailure',
  /**
   * A control that should do something and does not.
   *
   * The one kind here that nothing throws for. It is the most valuable one:
   * the sidebar covering a phone with no console error was invisible for four
   * weeks, and a person meeting it has no vocabulary to report it beyond "the
   * app is broken".
   */
  'deadPath',
  /** A resource — script, stylesheet, image — that did not load. */
  'assetFailure',
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

/**
 * How much a kind matters.
 *
 * Deliberately not a number. A severity score invites arithmetic, and there is
 * nothing here worth adding up: these are three buckets a person triages by.
 */
export const ERROR_SEVERITIES = ['noise', 'degraded', 'blocking'] as const;
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

export const SEVERITY_BY_KIND: Record<ErrorKind, ErrorSeverity> = {
  /* One uncaught exception is usually a browser extension or an ad blocker
   * mangling a page. It matters in aggregate, not individually. */
  uncaught: 'degraded',
  unhandledRejection: 'noise',
  /* The chrome is gone. `boot.js` catches it and the page stays usable, but
   * somebody should know it is happening. */
  frameworkMissing: 'degraded',
  /* On the connections LRMC serves, a failed request is ordinary. Treating
   * each one as an incident would bury everything else. */
  networkFailure: 'noise',
  /* A control that does nothing. Nobody can work around it and nobody can
   * describe it, so it is the one thing here that gets a person's attention. */
  deadPath: 'blocking',
  assetFailure: 'degraded',
};

/* ─────────────────────────────────────────────────────────────────────────────
 * What may be done about one
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The complete list of outcomes.
 *
 * Three, and none of them touches the member. `record` files it, `escalate`
 * puts it in front of a coordinator, `ignore` drops it. There is deliberately
 * no `throttle`, no `block`, no `lock` — see the header.
 */
export const INTAKE_ACTIONS = ['ignore', 'record', 'escalate'] as const;
export type IntakeAction = (typeof INTAKE_ACTIONS)[number];

/**
 * Nothing here can act against a member.
 *
 * A function rather than a comment, so a future `throttle` fails the suite and
 * whoever added it has to come and read why. The forbidden list is written out
 * rather than inferred, because "anything not in the allowed list" is a rule
 * that passes when somebody renames the allowed list.
 */
export function intakeIsAdvisoryOnly(): boolean {
  const forbidden = ['block', 'throttle', 'lock', 'ban', 'suspend', 'reject', 'quarantine'];
  return !(INTAKE_ACTIONS as readonly string[]).some((a) => forbidden.includes(a));
}

/**
 * How many reports one browser may file before LRMC stops storing them.
 *
 * A storage bound, **not a rate limit on the member**. Past this, further
 * reports in the window are dropped on the floor and the member's session is
 * entirely unaffected — every other request they make continues to work. The
 * distinction matters: a page in a render loop can emit thousands of identical
 * errors a minute, and the disk is a real constraint on a C4 server, but a
 * member whose page is in a render loop is a member who needs the rest of the
 * application to keep working more than anybody.
 */
export const REPORTS_PER_SESSION_WINDOW = 20;
export const REPORT_WINDOW_MINUTES = 10;

export interface RawReport {
  kind?: string | null;
  message?: string | null;
  /** Where in the code. Never where in the data — see `redactReport`. */
  source?: string | null;
  line?: number | null;
  column?: number | null;
  stack?: string | null;
  /** The page. Reduced to a template before storage. */
  url?: string | null;
  userAgent?: string | null;
  /** Which control, for a dead path. */
  control?: string | null;
  /** How many times this browser has already reported in the window. */
  seenThisWindow?: number | null;
}

export interface StoredReport {
  kind: ErrorKind;
  severity: ErrorSeverity;
  message: string;
  path: string;
  source: string | null;
  line: number | null;
  stack: string | null;
  control: string | null;
}

/** Everything wrong with a report, as a list. */
export function reportProblems(raw: RawReport): { field: string; code: string; message: string }[] {
  const out: { field: string; code: string; message: string }[] = [];
  const add = (field: string, code: string, message: string) =>
    out.push({ field, code, message });

  if (!raw || typeof raw !== 'object') {
    add('report', 'malformed', 'That is not a report.');
    return out;
  }
  if (!raw.kind) {
    add('kind', 'required', 'Say what kind of fault this is.');
  } else if (!(ERROR_KINDS as readonly string[]).includes(raw.kind)) {
    add('kind', 'unknown-kind', `"${raw.kind}" is not a kind of fault LRMC records.`);
  }
  if (!String(raw.message ?? '').trim()) {
    add('message', 'required', 'A report with no message is not a report.');
  }
  return out;
}

/**
 * What to do with a report.
 *
 * `seenThisWindow` is how the storage bound is applied, and it applies to
 * *storage only*. A browser past the bound gets `ignore` — the report is not
 * written — and nothing else about that member's session changes.
 */
export function intakeAction(raw: RawReport): IntakeAction {
  if (reportProblems(raw).length) return 'ignore';

  const seen = Number(raw.seenThisWindow ?? 0);
  if (Number.isFinite(seen) && seen >= REPORTS_PER_SESSION_WINDOW) return 'ignore';

  const kind = raw.kind as ErrorKind;
  const severity = SEVERITY_BY_KIND[kind];

  /* Only a dead path reaches a person unprompted. Everything else is filed and
   * read in aggregate, because an alert that fires on every flaky connection in
   * The Gambia is an alert somebody turns off in a fortnight. */
  if (severity === 'blocking') return 'escalate';
  return 'record';
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Keeping people out of the error log
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * A URL reduced to the shape of a URL.
 *
 * `/members/lease/6532ab…/payments?tenant=Awa+Ceesay` becomes
 * `/members/lease/:id/payments`. The query string is dropped entirely rather
 * than filtered: a query is where a search term goes, and a search term on this
 * platform is somebody's name.
 */
export function pathTemplate(url: string | null | undefined): string {
  if (!url) return 'unknown';
  let path = String(url);

  /* Absolute or relative. `new URL` is not available in every runtime this
   * might be read from, so this is done by hand. */
  const schemeEnd = path.indexOf('://');
  if (schemeEnd >= 0) {
    const afterHost = path.indexOf('/', schemeEnd + 3);
    path = afterHost >= 0 ? path.slice(afterHost) : '/';
  }
  const q = path.search(/[?#]/);
  if (q >= 0) path = path.slice(0, q);

  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^[a-f\d]{24}$/i.test(seg)) return ':id';            // Mongo id
      if (/^[0-9a-f-]{32,36}$/i.test(seg)) return ':id';       // uuid
      if (/^\d+$/.test(seg)) return ':n';
      return seg;
    })
    .join('/') || '/';
}

/** Patterns that mean a person is in the string. */
const PERSONAL = [
  /[\w.+-]+@[\w-]+\.[\w.]+/g,                 // email
  /\+?\d[\d\s-]{7,14}\d/g,                    // phone
  /\b[a-f\d]{24}\b/gi,                        // a record id
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g,             // a JWT
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, // a card number
];

/**
 * Strip anything that looks like it came from a person.
 *
 * Applied to every free-text field before storage. This is not a complete
 * defence — nothing that greps text ever is — and it is not the only one: the
 * browser side sends a truncated stack and never sends form values. It is the
 * layer that catches the ordinary case, which is a message like
 * `Cannot read 'amount' of undefined at /lease/6532…/pay?tenant=awa@…`.
 *
 * A error pipeline that quietly becomes a second copy of the tenant database is
 * the failure mode here, and it is what every naive implementation does.
 */
export function redact(text: string | null | undefined): string {
  if (!text) return '';
  let out = String(text);
  for (const pattern of PERSONAL) out = out.replace(pattern, '[redacted]');
  return out;
}

/** The longest message LRMC stores. A stack is truncated, not dropped. */
export const MAX_MESSAGE = 500;
export const MAX_STACK = 2000;

export function redactReport(raw: RawReport): StoredReport {
  const kind = raw.kind as ErrorKind;
  return {
    kind,
    severity: SEVERITY_BY_KIND[kind] ?? 'noise',
    message: redact(raw.message).slice(0, MAX_MESSAGE),
    path: pathTemplate(raw.url),
    /* `source` is a script URL — code, not data — so it is kept, but redacted
     * anyway because a source map URL can carry a query. */
    source: raw.source ? redact(raw.source).slice(0, MAX_MESSAGE) : null,
    line: Number.isFinite(Number(raw.line)) ? Number(raw.line) : null,
    stack: raw.stack ? redact(raw.stack).slice(0, MAX_STACK) : null,
    control: raw.control ? redact(raw.control).slice(0, 120) : null,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Who hears about it
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Roles an escalation reaches.
 *
 * The same list as `abuse.ts`, and for the same reason: the person who can do
 * something about "this member's page is dead" is the coordinator who can ring
 * them. Not the founder — Zone A is for decisions only the founder can make,
 * and a stream of browser faults in front of somebody with no time is a stream
 * nobody reads.
 */
export const ERROR_ESCALATION_ROLES = ['coordinator', 'backOfficeStaff'] as const;

export function mayReceiveErrorEscalation(
  actor: { roles: string[] } | null | undefined,
): boolean {
  if (!actor || !Array.isArray(actor.roles)) return false;
  return (ERROR_ESCALATION_ROLES as readonly string[]).some((r) => actor.roles.includes(r));
}

/** Reading the log is wider than being paged by it. */
export const ERROR_READ_ROLES = [
  'coordinator', 'backOfficeStaff', 'hqExecutive', 'founder',
] as const;

export function mayReadErrors(actor: { roles: string[] } | null | undefined): boolean {
  if (!actor || !Array.isArray(actor.roles)) return false;
  return (ERROR_READ_ROLES as readonly string[]).some((r) => actor.roles.includes(r));
}

/**
 * What a coordinator reads.
 *
 * Never a stack trace. A coordinator is being asked "is this member stuck", not
 * "debug this" — a stack in front of them is noise they will learn to skip, and
 * the next thing they skip is the one that mattered.
 */
export function describeForCoordinator(report: StoredReport): string {
  if (report.kind === 'deadPath') {
    return report.control
      ? `A member tapped "${report.control}" on ${report.path} and nothing happened.`
      : `A control on ${report.path} is not responding for a member.`;
  }
  if (report.kind === 'frameworkMissing') {
    return `A member's page on ${report.path} loaded without its menus. They can still use it.`;
  }
  if (report.kind === 'networkFailure') {
    return `A member's request from ${report.path} did not reach LRMC.`;
  }
  return `Something went wrong on ${report.path} for a member.`;
}
