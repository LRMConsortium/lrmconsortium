/**
 * The security surface: fault reports in, anomalies out.
 *
 * Every rule lives in `errorCollector.ts`, `observations.ts` and `abuse.ts` —
 * all three pure, all three asserted without a database. This file stores rows
 * and shapes replies. It decides nothing.
 *
 * ── One thing to know before changing anything here ───────────────────────
 * Nothing on this surface may act against a member. Not a block, not a lock,
 * not a throttle that takes the application away from somebody. The intake
 * endpoint is deliberately the most permissive route on the platform: it
 * accepts anonymous reports, it never refuses a member for reporting too much,
 * and the strongest thing it produces is a line in front of a coordinator.
 *
 * The reason is in `errorCollector.ts`'s header and worth repeating: the client
 * reporting a great many faults is overwhelmingly a member on a bad connection
 * whose page half-loaded, and shutting them out would take the platform away
 * from exactly the person it exists for, at exactly the moment it had already
 * failed them.
 */

import { Router } from 'express';
import { Schema, model, type Types } from 'mongoose';
import { authenticate, auditTrail, enterZone, requirePermission, validate } from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { asyncHandler, created, ok } from '../../shared/http.js';
import { baseSchemaOptions, type TimestampShape } from '../../shared/schemaFragments.js';
import { logger } from '../../config/logger.js';
import {
  ERROR_KINDS,
  ERROR_SEVERITIES,
  intakeAction,
  redactReport,
  reportProblems,
  describeForCoordinator,
  mayReadErrors,
  REPORTS_PER_SESSION_WINDOW,
  REPORT_WINDOW_MINUTES,
  type RawReport,
} from './errorCollector.js';
import {
  observe, grade, dueForEscalation, prune, escalationFingerprint,
  type ObservationStore,
} from './observations.js';
import { mayReadAbuse } from './abuse.js';
import { errorReportSchema } from './security.validation.js';

/* ═══════════════════════════════════════════════════════════════════════════
 * Storage
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * A fault a browser reported.
 *
 * **Append-only.** No update route, no delete route, no soft-delete field. An
 * error log somebody can edit is an error log nobody can rely on, and the first
 * thing anybody wants to do with an embarrassing one is tidy it away.
 *
 * A TTL index expires rows after ninety days. That is a retention decision
 * rather than a storage one: these carry fragments of what members were doing,
 * and keeping them forever would make the error log the longest-lived copy of
 * that information on the platform.
 */
export interface IErrorReport extends TimestampShape {
  _id: Types.ObjectId;
  kind: (typeof ERROR_KINDS)[number];
  severity: (typeof ERROR_SEVERITIES)[number];
  message: string;
  /** A path template — `/members/lease/:id/payments`. Never a real URL. */
  path: string;
  source?: string | null;
  line?: number | null;
  stack?: string | null;
  control?: string | null;
  /** Who, when they were signed in. Anonymous reports are accepted. */
  reportedBy?: Types.ObjectId | null;
  userAgent?: string | null;
  expiresAt: Date;
}

const RETENTION_DAYS = 90;

const errorReportSchemaDef = new Schema<IErrorReport>(
  {
    kind: { type: String, enum: ERROR_KINDS, required: true, index: true },
    severity: { type: String, enum: ERROR_SEVERITIES, required: true, index: true },
    message: { type: String, required: true, maxlength: 600 },
    path: { type: String, required: true, index: true },
    source: { type: String, default: null },
    line: { type: Number, default: null },
    stack: { type: String, default: null, maxlength: 2400 },
    control: { type: String, default: null },
    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    userAgent: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { ...baseSchemaOptions('errorreports'), timestamps: true },
);

/* Mongo removes the row at `expiresAt`. `expireAfterSeconds: 0` means "at the
 * time in this field", not "immediately". */
errorReportSchemaDef.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
/* The query a coordinator actually runs: what is broken lately, worst first. */
errorReportSchemaDef.index({ severity: 1, createdAt: -1 });

export const ErrorReport = model<IErrorReport>('ErrorReport', errorReportSchemaDef);

/* ═══════════════════════════════════════════════════════════════════════════
 * The observation store
 *
 * In memory, per process, and that is a deliberate limitation rather than an
 * oversight. Two C4 servers means two stores and therefore thresholds that are
 * effectively halved per node — which makes the signals *less* sensitive, never
 * more, so the failure direction is a missed alert rather than a false one.
 *
 * Putting it in Mongo would mean a write on every failed login and every
 * refused request, which is a database write in the hot path of the exact
 * traffic an attacker controls the volume of. That trade is the wrong way
 * round; if cross-node counting is ever needed the answer is Redis, not the
 * primary datastore.
 * ══════════════════════════════════════════════════════════════════════════ */

const store: ObservationStore = new Map();
const lastEscalatedAt = new Map<string, number>();

/** How many reports this browser has filed lately, for the storage bound. */
const reportCounts = new Map<string, { minute: number; n: number }>();

function countReport(fingerprint: string, now: number): number {
  const minute = Math.floor(now / (REPORT_WINDOW_MINUTES * 60_000));
  const seen = reportCounts.get(fingerprint);
  if (!seen || seen.minute !== minute) {
    reportCounts.set(fingerprint, { minute, n: 1 });
    return 0;
  }
  seen.n += 1;
  return seen.n - 1;
}

/**
 * Record an event against the anomaly pipeline.
 *
 * Exported so the auth, payment and authorisation paths can feed it without
 * importing the whole module. Never throws: a fault in the security pipeline
 * must not become a fault in the thing it is watching.
 */
export function recordObservation(event: Parameters<typeof observe>[1]): void {
  try {
    observe(store, event);
  } catch (err) {
    logger.warn('Observation dropped', { error: (err as Error).message });
  }
}

/** Read the pipeline. Takes no action; mutates nothing. */
export function currentFindings(now = Date.now()) {
  prune(store, now);
  return grade(store, now);
}

/**
 * Escalations that are due, marked as sent.
 *
 * The cooldown lives in `observations.ts`; this applies it and records the
 * send, so an attack lasting an hour produces one notification rather than
 * sixty — and the coordinator who receives it has not learned to ignore the
 * channel by the time the next genuine one arrives.
 */
export function takeEscalations(now = Date.now()) {
  const due = dueForEscalation(currentFindings(now), lastEscalatedAt, now);
  for (const finding of due) lastEscalatedAt.set(escalationFingerprint(finding), now);
  return due;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Routes
 * ══════════════════════════════════════════════════════════════════════════ */

const router = Router();

/**
 * A browser reporting that something went wrong.
 *
 * **Zone E, `auth: 'optional'`** — and both of those are deliberate. The most
 * valuable report on the platform is the one from a page that failed before the
 * member could sign in, and requiring a token would discard exactly those.
 *
 * The reply is `201` with nothing useful in it. A caller learns whether LRMC
 * received the report and nothing about what was done with it: an intake that
 * echoed back its own grading would be a way to discover the thresholds.
 */
router.post(
  '/errors',
  enterZone('PUBLIC_PORTAL'),
  validate({ body: errorReportSchema }),
  asyncHandler(async (req, res) => {
    const raw = req.body as RawReport;
    const now = Date.now();

    /* Per browser, not per member: a fault before sign-in has no member. The
     * address is a coarse handle and that is fine — this bounds storage, and
     * over-counting an office behind one address costs a dropped report, not a
     * refused request. */
    const fingerprint = `${req.ip ?? 'unknown'}|${String(req.headers['user-agent'] ?? '').slice(0, 60)}`;
    const seenThisWindow = countReport(fingerprint, now);

    const action = intakeAction({ ...raw, seenThisWindow });

    /* Past the storage bound. The report is dropped and the member's session is
     * entirely unaffected — every other request they make continues to work.
     * Still a 201: telling a client it is being dropped invites it to retry,
     * and a page in a render loop does not need encouragement. */
    if (action === 'ignore') {
      return created(res, { received: true });
    }

    const problems = reportProblems(raw);
    if (problems.length) throw ApiError.validation('Request validation failed', problems);

    const stored = redactReport(raw);
    await ErrorReport.create({
      ...stored,
      reportedBy: req.actor?.userId ?? null,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200) || null,
      expiresAt: new Date(now + RETENTION_DAYS * 86_400_000),
    });

    if (action === 'escalate') {
      /* Logged rather than dispatched, for now. A notification channel for this
       * is a separate piece of work, and a half-built one that silently drops
       * messages would be worse than a log a person can grep — see the note in
       * the Week 5 record. */
      logger.warn('Member-facing fault escalated', {
        kind: stored.kind,
        path: stored.path,
        summary: describeForCoordinator(stored),
      });
    }

    return created(res, { received: true });
  }),
);

const staffGuard = [authenticate, enterZone('BACK_OFFICE'), auditTrail('security')] as const;

/** What is breaking for members lately. Worst first. */
router.get(
  '/errors',
  ...staffGuard,
  requirePermission('auditLog:read', 'analytics:read'),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    if (!mayReadErrors({ roles: actor.roles as string[] })) {
      throw ApiError.forbidden('That log is not yours to read.');
    }
    const rows = await ErrorReport.find({})
      .sort({ severity: 1, createdAt: -1 })
      .limit(Math.min(100, Number(req.query.limit ?? 50)))
      .lean()
      .exec();

    return ok(res, rows.map((r) => ({
      ...r,
      /* The sentence a coordinator reads, computed rather than stored, so a
       * change to the wording reaches old rows too. */
      summary: describeForCoordinator(r as never),
    })));
  }),
);

/** The anomaly feed. Read-only, and it is the only way to see it. */
router.get(
  '/anomalies',
  ...staffGuard,
  requirePermission('auditLog:read', 'analytics:read'),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    if (!mayReadAbuse({ roles: actor.roles as string[] })) {
      throw ApiError.forbidden('That feed is not yours to read.');
    }
    return ok(res, {
      findings: currentFindings(),
      /* Said out loud on every read. The counts are per process and there are
       * two servers, so a reader comparing them against a log will find them
       * low — and should know why rather than conclude the pipeline is broken. */
      note: 'Counted in memory, per server. With two servers a threshold is effectively halved per node, so these are conservative — a missed signal rather than a false one.',
      reportsPerBrowserPerWindow: REPORTS_PER_SESSION_WINDOW,
    });
  }),
);

export const securityModule = {
  collectionPath: 'errors',
  mounts: [{ path: 'security', router }],
};
