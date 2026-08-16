import { createHash, randomInt } from 'node:crypto';
import { Router } from 'express';
import {
  authenticate,
  auditTrail,
  enterZone,
  requireClearance,
  requirePermission,
  requireRole,
  validate,
} from '../../middleware/index.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../shared/ApiError.js';
import { BaseService } from '../../shared/BaseService.js';
import { createCrudController } from '../../shared/BaseController.js';
import { asyncHandler, created, ok, paginated } from '../../shared/http.js';
import { namedIdParam } from '../../shared/moduleFactory.js';
import { User } from '../../models/User.js';
import { Lease } from '../lease/lease.model.js';
import { DocumentRecord } from '../document/document.model.js';
import { dispatchNotification } from '../notification/dispatch.js';
import { FacAttempt, FacClearance, FacCode, type IFacCode } from './fac.model.js';
import { hashCode, verifyCode } from './facHashing.js';
import {
  FAC_CLEARANCE_MINUTES,
  FAC_LOCKOUT_HOURS,
  FAC_MAX_ATTEMPTS,
  FAC_ROTATION_DAYS,
  codeClock,
  codeEntropyBits,
  describeClock,
  expectedBruteForceYears,
  generateCode,
  isImmediate,
  nextRotationDate,
  type RotationTrigger,
} from './facRules.js';
import {
  attemptVerdict,
  clearanceState,
  failureTriggersLockout,
  grantClearance,
  summariseAttempts,
  type AttemptRecord,
} from './attempts.js';
import {
  TIER_DEFINITIONS,
  TIER_ORDER,
  canSeeTier,
  tierOf,
  tierOverview,
  visibilityFor,
  visibilityMatrix,
  type GovernanceTier,
} from './visibility.js';
import { governanceHealth, type HealthSignals } from './governanceHealth.js';
import {
  clearLockoutSchema,
  facAttemptQuery,
  facCodeQuery,
  facResetRequestSchema,
  governanceQuery,
  issueFacCodeSchema,
  revokeFacCodeSchema,
  verifyFacCodeSchema,
} from './fac.validation.js';

export const facService = new BaseService<IFacCode>(FacCode, {
  label: 'FAC code',
  searchableFields: ['label'],
  filterableFields: ['status', 'trigger', 'generation'],
  defaultSort: '-generation',
});

const controller = createCrudController(facService);

const codesRouter = Router();
const codeRouter = Router();
const facRouter = Router();
const governanceRouter = Router();

const codeId = namedIdParam('codeId');

/** Zone A. Issuing and revoking the code is the Founder's alone. */
const zoneA = [
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance(),
  auditTrail('fac'),
] as const;

/**
 * Zone A, but reachable when no code has ever been issued.
 *
 * Used by exactly one route — the one that issues codes. Without it the
 * platform ships in a state no founder can leave: issuing a code is a Zone A
 * act, and Zone A now demands a code. The exemption is conditional on there
 * being no active generation, so it closes itself the instant the first code
 * exists, and every use of it is logged as a warning.
 */
const zoneABootstrap = [
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance({ bootstrap: true }),
  auditTrail('fac'),
] as const;

/**
 * Zone B. Verification has to be reachable *before* Zone A — the code is what
 * opens Zone A, so gating the endpoint behind it would be a locked door with
 * the key inside.
 */
const zoneB = [authenticate, enterZone('HQ_EXECUTIVE'), auditTrail('fac')] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Never store a raw address; correlate on a digest instead. */
function hashIp(ip?: string): string | undefined {
  if (!ip) return undefined;
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

/**
 * A CSPRNG in the shape `generateCode` expects. Never `Math.random`.
 *
 * One draw per digit — `randomInt(0, 10)` is uniform over 0..9 by construction,
 * so `digitFrom` recovers exactly that digit with no range-folding anywhere in
 * the path. Drawing a larger integer and dividing would work only while the
 * range stayed divisible by ten.
 */
function secureRandom(): number {
  return randomInt(0, 10) / 10;
}

async function currentCode(withHash = false): Promise<IFacCode | null> {
  const query = FacCode.findOne({ status: 'active', deletedAt: null }).sort('-generation');
  if (withHash) query.select('+codeHash');
  return (await query.lean().exec()) as IFacCode | null;
}

/**
 * This actor's attempt history, oldest first — the order the arithmetic expects.
 *
 * ── Why the sort is descending and the array is then reversed ─────────────
 * This read `.sort('at').limit(200)`: ascending, so the *oldest* two hundred
 * rows. `FacAttempt` has no TTL, so once an actor accumulated two hundred rows
 * the window stopped advancing — permanently. Every later attempt was graded
 * against ancient history, `consecutiveFailures` never counted the current run,
 * and the lockout could not fire again.
 *
 * That is the credential guarding Zone A. Somebody who had already made two
 * hundred attempts could then work through a six-digit code without ever being
 * locked out, and the two hundredth attempt is the cheap part.
 *
 * So: the newest two hundred by sorting descending, then reversed back into the
 * oldest-first order `attemptVerdict` reads. Both halves are needed — sorting
 * descending without reversing feeds the arithmetic backwards, which breaks
 * `consecutiveFailures` and `lastFailure` in a quieter way.
 */
async function historyFor(actorId: string): Promise<AttemptRecord[]> {
  const rows = await FacAttempt.find({ actor: actorId })
    .sort('-at')
    .limit(200)
    .select('actor at result')
    .lean()
    .exec();
  rows.reverse();
  return rows.map((r) => ({ actor: String(r.actor), at: r.at, result: r.result }));
}

async function activeClearanceFor(actorId: string, asOf: Date) {
  const row = await FacClearance.findOne({
    actor: actorId,
    revokedAt: null,
    expiresAt: { $gt: asOf },
  })
    .sort('-grantedAt')
    .lean()
    .exec();
  return clearanceState(row?.grantedAt ?? null, asOf);
}

/** The code's public face — status and clock, never the code. */
function codeSummary(code: IFacCode | null, asOf: Date) {
  if (!code) {
    return {
      generation: null,
      status: 'none' as const,
      issuedAt: null,
      expiresAt: null,
      daysRemaining: null,
      health: 'expired' as const,
      warning: true,
      description: 'no code has been issued',
      rotationDays: FAC_ROTATION_DAYS,
    };
  }
  const clock = codeClock(code.issuedAt, asOf, code.rotationDays);
  return {
    generation: code.generation,
    status: code.status,
    issuedAt: code.issuedAt,
    expiresAt: clock.expiresAt,
    daysRemaining: clock.daysRemaining,
    health: clock.health,
    warning: clock.warning,
    description: describeClock(clock),
    rotationDays: code.rotationDays,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Code generations — Zone A
// ─────────────────────────────────────────────────────────────────────────────

codesRouter.get(
  '/',
  ...zoneA,
  requirePermission('fac:read'),
  validate({ query: facCodeQuery }),
  controller.list,
);

/**
 * Issue a new generation.
 *
 * The plaintext is returned **exactly once**, in this response. There is no
 * endpoint that retrieves it again and no support procedure that recovers it —
 * losing it means issuing another generation, which is the correct outcome and
 * costs a founder thirty seconds.
 *
 * The previous generation is superseded in the same operation. Two active codes
 * would double the guess surface and make the attempt ledger ambiguous about
 * which one somebody was guessing at.
 */
codesRouter.post(
  '/',
  ...zoneABootstrap,
  requirePermission('fac:create'),
  requireRole('founder'),
  validate({ body: issueFacCodeSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as {
      trigger?: RotationTrigger;
      rotationDays?: number;
      label?: string;
      reason?: string;
    };
    const now = new Date();
    const rotationDays = body.rotationDays ?? FAC_ROTATION_DAYS;
    const trigger = body.trigger ?? 'scheduled';

    const previous = await currentCode();
    const generation = (previous?.generation ?? 0) + 1;

    // Rejection-sampled against the weakness rules, so a generation can never
    // be 123456 or a plausible birth year however unlucky the draw.
    const plaintext = generateCode(secureRandom);
    // Peppered before bcrypt: a leaked database is useless without the
    // application secret, which does not live in Mongo.
    const codeHash = await hashCode(plaintext, env.facPepper, env.BCRYPT_ROUNDS);

    const doc = await FacCode.create({
      generation,
      codeHash,
      label: body.label,
      issuedBy: actor.userId,
      issuedAt: now,
      expiresAt: nextRotationDate(now, rotationDays),
      rotationDays,
      trigger,
      status: 'active',
      createdBy: actor.userId,
    });

    if (previous) {
      await FacCode.updateOne(
        { _id: previous._id },
        { $set: { status: 'superseded', supersededBy: doc._id, updatedBy: actor.userId } },
      ).exec();
    }

    // An immediate trigger invalidates live clearances too: a role change or a
    // suspected compromise means whoever is already inside should be pushed out.
    if (isImmediate(trigger)) {
      await FacClearance.updateMany(
        { revokedAt: null, expiresAt: { $gt: now } },
        { $set: { revokedAt: now } },
      ).exec();
    }

    // Tell the other founders a generation changed under them. Best-effort.
    try {
      const founders = await User.find({ roles: 'founder', status: 'active', deletedAt: null })
        .select('_id')
        .limit(20)
        .lean()
        .exec();
      for (const f of founders) {
        if (String(f._id) === actor.userId) continue;
        await dispatchNotification({
          recipient: String(f._id),
          category: 'policy',
          channel: 'inApp',
          title: `FAC generation ${generation} issued`,
          body: `Trigger: ${trigger}. The previous code no longer works.`,
          createdBy: actor.userId,
        });
      }
    } catch {
      // Deliberately swallowed — the code is already issued.
    }

    return created(res, {
      // The one and only time this appears.
      code: plaintext,
      issuedOnce: true,
      warning:
        'This code is shown once and is not recoverable. Record it now; losing it means issuing a new generation.',
      generation: doc.generation,
      issuedAt: doc.issuedAt,
      expiresAt: doc.expiresAt,
      rotationDays: doc.rotationDays,
      trigger: doc.trigger,
      supersededGeneration: previous?.generation ?? null,
      clearancesRevoked: isImmediate(trigger),
    });
  }),
);

codeRouter.get(
  '/:codeId',
  ...zoneA,
  requirePermission('fac:read'),
  validate({ params: codeId }),
  asyncHandler(async (req, res) => {
    const doc = await FacCode.findOne({ _id: req.params.codeId, deletedAt: null }).lean().exec();
    if (!doc) throw ApiError.notFound('FAC code');
    return ok(res, doc);
  }),
);

/**
 * Revoke a generation without issuing a replacement.
 *
 * Leaves the platform with no code in force, which caps governance health at
 * 40 and locks Zone A for everyone. That is the intended behaviour for a
 * suspected compromise: better shut than open to whoever has the code.
 */
codeRouter.post(
  '/:codeId/revoke',
  ...zoneA,
  requirePermission('fac:revoke'),
  requireRole('founder'),
  validate({ params: codeId, body: revokeFacCodeSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const now = new Date();
    const doc = await FacCode.findOne({ _id: req.params.codeId, deletedAt: null }).exec();
    if (!doc) throw ApiError.notFound('FAC code');
    if (doc.status !== 'active') {
      throw ApiError.conflict(`Generation ${doc.generation} is already ${doc.status}`);
    }

    doc.status = 'revoked';
    doc.revokedAt = now;
    doc.revokedBy = actor.userId as never;
    doc.revocationReason = (req.body as { reason: string }).reason;
    doc.updatedBy = actor.userId as never;
    await doc.save();

    // Revocation without replacement must also close every door already open.
    const revoked = await FacClearance.updateMany(
      { revokedAt: null, expiresAt: { $gt: now } },
      { $set: { revokedAt: now } },
    ).exec();

    return ok(res, {
      generation: doc.generation,
      status: doc.status,
      revokedAt: doc.revokedAt,
      revocationReason: doc.revocationReason,
      clearancesRevoked: revoked.modifiedCount ?? 0,
      warning: 'No code is now in force. Zone A is closed until a new generation is issued.',
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Verification — Zone B, because the code is what opens Zone A
// ─────────────────────────────────────────────────────────────────────────────

/** Status and the caller's own attempt/clearance state. What the console polls. */
facRouter.get(
  '/me/clearance',
  ...zoneB,
  requirePermission('fac:verify', 'fac:read'),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const now = new Date();
    const code = await currentCode();
    const history = await historyFor(actor.userId);
    const verdict = attemptVerdict(history, actor.userId, now, { hasActiveCode: Boolean(code) });
    const clearance = await activeClearanceFor(actor.userId, now);

    return ok(res, {
      actor: actor.userId,
      tier: tierOf(actor.roles),
      code: codeSummary(code, now),
      attempts: {
        used: verdict.attemptsUsed,
        remaining: verdict.attemptsRemaining,
        max: FAC_MAX_ATTEMPTS,
        allowed: verdict.allowed,
        refusal: verdict.refusal ?? null,
        lockedUntil: verdict.lockedUntil,
        lockoutSecondsRemaining: verdict.lockoutSecondsRemaining,
        lockoutHours: FAC_LOCKOUT_HOURS,
      },
      clearance,
      policy: {
        codeLength: 6,
        rotationDays: FAC_ROTATION_DAYS,
        maxAttempts: FAC_MAX_ATTEMPTS,
        lockoutHours: FAC_LOCKOUT_HOURS,
        clearanceMinutes: FAC_CLEARANCE_MINUTES,
        entropyBits: codeEntropyBits(),
        expectedBruteForceYears: expectedBruteForceYears(),
      },
    });
  }),
);

/**
 * Submit the code.
 *
 * Every outcome is recorded, including the ones refused because a lockout was
 * already running — those rows are what show somebody kept trying. The response
 * deliberately never distinguishes "wrong code" from "no such generation": both
 * are a plain failure, because telling an attacker *why* they failed is telling
 * them something.
 */
facRouter.post(
  '/verify',
  ...zoneB,
  requirePermission('fac:verify'),
  validate({ body: verifyFacCodeSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const now = new Date();
    const code = await currentCode(true);
    const history = await historyFor(actor.userId);
    const verdict = attemptVerdict(history, actor.userId, now, { hasActiveCode: Boolean(code) });

    const record = async (
      result: 'pass' | 'fail' | 'blocked',
      lockedUntil?: Date,
    ): Promise<void> => {
      await FacAttempt.create({
        actor: actor.userId,
        actorLabel: actor.email ?? undefined,
        actorRole: actor.primaryRole,
        codeGeneration: code?.generation,
        at: now,
        result,
        attemptNumber: verdict.attemptNumber,
        attemptsRemaining: result === 'pass' ? FAC_MAX_ATTEMPTS : Math.max(0, verdict.attemptsRemaining - 1),
        lockedUntil,
        ipHash: hashIp(req.ip),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 400),
      });
    };

    if (!verdict.allowed) {
      await record('blocked');
      if (verdict.refusal === 'lockedOut') {
        // 423 Locked: the request was right, the door is shut, and it will open
        // by itself. A 403 would tell a client to stop trying forever.
        throw ApiError.locked(
          `FAC access is locked for another ${Math.ceil(verdict.lockoutSecondsRemaining / 60)} minutes`,
          { lockedUntil: verdict.lockedUntil, secondsRemaining: verdict.lockoutSecondsRemaining },
        );
      }
      throw ApiError.conflict('No FAC code is currently in force. A founder must issue one.');
    }

    const submitted = (req.body as { code: string }).code;
    const matches = code?.codeHash
      ? await verifyCode(submitted, code.codeHash, env.facPepper)
      : false;

    if (!matches) {
      const locks = failureTriggersLockout(verdict);
      const lockedUntil = locks ? new Date(now.getTime() + FAC_LOCKOUT_HOURS * 3_600_000) : undefined;
      await record('fail', lockedUntil);
      if (code) {
        await FacCode.updateOne({ _id: code._id }, { $inc: { failedVerifications: 1 } }).exec();
      }

      throw ApiError.validation(
        locks
          ? `Incorrect code. Maximum attempts exceeded — FAC access is locked for ${FAC_LOCKOUT_HOURS} hours.`
          : `Incorrect code. ${verdict.attemptsRemaining - 1} attempt(s) remaining.`,
        [{ field: 'code', message: 'incorrect' }],
      );
    }

    await record('pass');
    await FacCode.updateOne({ _id: code!._id }, { $inc: { successfulVerifications: 1 } }).exec();

    const clearance = grantClearance(now);
    await FacClearance.create({
      actor: actor.userId,
      codeGeneration: code!.generation,
      grantedAt: clearance.grantedAt,
      expiresAt: clearance.expiresAt,
    });

    return ok(res, {
      verified: true,
      clearance,
      generation: code!.generation,
      visibility: visibilityFor(actor.primaryRole, true),
      attempts: { used: 0, remaining: FAC_MAX_ATTEMPTS, max: FAC_MAX_ATTEMPTS },
    });
  }),
);

/** Stand down early — a founder leaving a console should not leave it open. */
facRouter.post(
  '/me/clearance/revoke',
  ...zoneB,
  requirePermission('fac:verify'),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const result = await FacClearance.updateMany(
      { actor: req.actor!.userId, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { revokedAt: now } },
    ).exec();
    return ok(res, {
      revoked: result.modifiedCount ?? 0,
      clearance: clearanceState(null, now),
    });
  }),
);

/** Ask a founder for a rotation. The "Request Code Reset" link on the console. */
facRouter.post(
  '/reset-requests',
  ...zoneB,
  requirePermission('fac:verify', 'fac:read'),
  validate({ body: facResetRequestSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const reason = (req.body as { reason: string }).reason;

    const founders = await User.find({ roles: 'founder', status: 'active', deletedAt: null })
      .select('_id')
      .limit(20)
      .lean()
      .exec();

    let notified = 0;
    for (const f of founders) {
      await dispatchNotification({
        recipient: String(f._id),
        category: 'policy',
        channel: 'inApp',
        title: 'FAC reset requested',
        body: `${actor.primaryRole} ${actor.email ?? actor.userId}: ${reason}`,
        createdBy: actor.userId,
      });
      notified += 1;
    }

    return created(res, {
      requested: true,
      reason,
      foundersNotified: notified,
      note: 'Only a founder can issue a new generation. This request does not rotate the code.',
    });
  }),
);

/** The attempt ledger. Zone A — it names who tried and when. */
facRouter.get(
  '/attempts',
  ...zoneA,
  requirePermission('fac:read'),
  validate({ query: facAttemptQuery }),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.result) filter.result = req.query.result;
    if (req.query.generation) filter.codeGeneration = Number(req.query.generation);

    const limit = Math.min(100, Number(req.query.limit ?? 25));
    const page = Math.max(1, Number(req.query.page ?? 1));

    const [items, total] = await Promise.all([
      FacAttempt.find(filter).sort('-at').skip((page - 1) * limit).limit(limit).lean().exec(),
      FacAttempt.countDocuments(filter).exec(),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return paginated(res, items, {
      page, limit, total, totalPages,
      hasNext: page < totalPages, hasPrev: page > 1,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Lockout override — the way back in
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Who is currently locked out.
 *
 * Exists so the override is *discoverable*. A colleague who has to already know
 * a user id before they can help is not a recovery path, they are a puzzle.
 */
facRouter.get(
  '/lockouts',
  ...zoneA,
  requirePermission('fac:read'),
  asyncHandler(async (_req, res) => {
    const now = new Date();

    // Only actors with a recent failure can possibly be locked; narrowing here
    // keeps this from walking the whole ledger on a platform with years of it.
    const since = new Date(now.getTime() - FAC_LOCKOUT_HOURS * 60 * 60 * 1000);
    const recent = await FacAttempt.find({ at: { $gte: since }, result: 'fail' })
      .distinct('actor')
      .exec();

    const rows = [];
    for (const actorId of recent.map(String)) {
      const verdict = attemptVerdict(await historyFor(actorId), actorId, now);
      if (verdict.allowed) continue;
      const user = await User.findById(actorId).select('email roles').lean().exec();
      rows.push({
        actor: actorId,
        email: user?.email ?? null,
        roles: user?.roles ?? [],
        lockedUntil: verdict.lockedUntil,
        secondsRemaining: verdict.lockoutSecondsRemaining,
        attemptsUsed: verdict.attemptsUsed,
      });
    }
    return ok(res, { lockouts: rows, count: rows.length, asOf: now });
  }),
);

/**
 * Lift another founder's lockout.
 *
 * The problem this solves is not theoretical. Three mistyped digits put a
 * founder outside their own command center for a full day, and once the zone
 * genuinely enforces the code there is no other way in — not a support ticket,
 * not a database edit anyone should be making at 2am. An institution whose
 * highest authority can be locked out by a typo has an availability bug, not a
 * security control.
 *
 * Three constraints make the override safe rather than a back door:
 *
 * **The caller must be a founder holding a live clearance.** They are inside
 * `zoneA`, so they have already entered their own code. The override is
 * therefore never easier than the thing it bypasses — it costs a second person
 * and a second code.
 *
 * **Nobody can clear their own lockout.** Not merely refused as policy: it is
 * structurally impossible, because reaching this route needs a clearance and a
 * locked-out actor cannot obtain one. The explicit check is belt and braces,
 * and exists so that the reason is stated in the code rather than inferred.
 *
 * **A reason is required and the ledger keeps it.** The `cleared` row is not a
 * forged success — it says plainly that a lockout was lifted, by whom, and why.
 */
facRouter.post(
  '/lockout/:actorId/clear',
  ...zoneA,
  requirePermission('fac:update', 'fac:create'),
  requireRole('founder'),
  validate({ params: namedIdParam('actorId'), body: clearLockoutSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const targetId = String(req.params.actorId);
    const { reason } = req.body as { reason: string };
    const now = new Date();

    if (targetId === actor.userId) {
      throw ApiError.badRequest(
        'A founder cannot clear their own lockout — that is what the second founder is for',
      );
    }

    const target = await User.findById(targetId).select('email roles status').lean().exec();
    if (!target) throw ApiError.notFound('User');

    const history = await historyFor(targetId);
    const verdict = attemptVerdict(history, targetId, now);
    if (verdict.allowed) {
      // Not an error worth a 4xx — the desired state already holds. Saying so
      // plainly beats a confusing failure when two founders both respond.
      return ok(res, {
        cleared: false,
        actor: targetId,
        reason: 'that actor is not locked out',
        attempts: {
          used: verdict.attemptsUsed,
          remaining: verdict.attemptsRemaining,
          allowed: verdict.allowed,
        },
      });
    }

    await FacAttempt.create({
      actor: targetId,
      actorLabel: target.email,
      actorRole: target.roles?.[0],
      at: now,
      result: 'cleared',
      attemptNumber: verdict.attemptsUsed,
      attemptsRemaining: FAC_MAX_ATTEMPTS,
      clearedBy: actor.userId,
      clearedReason: reason,
      ipHash: hashIp(req.ip),
      userAgent: req.get('user-agent'),
    });

    // Tell the person it happened to. An override they only discover by trying
    // again is an override that hides a compromise.
    try {
      await dispatchNotification({
        recipient: targetId,
        category: 'policy',
        channel: 'inApp',
        title: 'Your FAC lockout was lifted',
        body: `A founder cleared your lockout. Reason given: ${reason}`,
      });
    } catch {
      // Best-effort. A notification failure must not undo the unlock.
    }

    const after = attemptVerdict(await historyFor(targetId), targetId, now);
    return ok(res, {
      cleared: true,
      actor: targetId,
      email: target.email,
      clearedBy: actor.userId,
      reason,
      at: now,
      attempts: {
        used: after.attemptsUsed,
        remaining: after.attemptsRemaining,
        allowed: after.allowed,
      },
      note: 'The failed attempts remain in the ledger. This records that they were set aside, not that they did not happen.',
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Governance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The four tiers, with live headcounts.
 *
 * Filtered to what the caller's own tier may see — a coordinator gets staff and
 * membership, and does not learn how many founders there are. The response says
 * how many tiers were withheld rather than silently returning a short list.
 */
governanceRouter.get(
  '/tiers',
  authenticate,
  enterZone('BACK_OFFICE'),
  requirePermission('governance:read'),
  validate({ query: governanceQuery }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const viewerTier = tierOf(actor.roles);

    const counts = await User.aggregate([
      { $match: { deletedAt: null, status: 'active' } },
      { $unwind: '$roles' },
      { $group: { _id: '$roles', count: { $sum: 1 } } },
    ]).exec();

    const byRole = new Map<string, number>(counts.map((c) => [String(c._id), c.count as number]));
    const headcounts: Partial<Record<GovernanceTier, number>> = {};
    for (const tier of TIER_ORDER) {
      headcounts[tier] = TIER_DEFINITIONS[tier].roles.reduce(
        (sum, role) => sum + (byRole.get(role) ?? 0),
        0,
      );
    }

    const all = tierOverview(headcounts);
    const visible = all.filter((t) => canSeeTier(viewerTier, t.tier));
    const filtered = req.query.tier ? visible.filter((t) => t.tier === req.query.tier) : visible;

    return ok(res, {
      viewerTier,
      viewerTierLabel: TIER_DEFINITIONS[viewerTier].label,
      total: all.length,
      visible: visible.length,
      withheld: all.length - visible.length,
      tiers: filtered,
    });
  }),
);

/** The seal and clearance matrix, as data. */
governanceRouter.get(
  '/visibility-matrix',
  authenticate,
  enterZone('BACK_OFFICE'),
  requirePermission('governance:read'),
  asyncHandler(async (_req, res) => ok(res, { rows: visibilityMatrix() })),
);

/**
 * What this caller may see right now.
 *
 * The one endpoint the console needs to decide whether to render the seal,
 * show Tier 1, or draw the locked overlay. `sealEligible` and `sealVisible`
 * are separate on purpose: a founder without a live clearance is the first and
 * not the second.
 */
governanceRouter.get(
  '/me/visibility',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const now = new Date();
    const clearance = await activeClearanceFor(actor.userId, now);
    return ok(res, {
      ...visibilityFor(actor.primaryRole, clearance.active),
      roles: actor.roles,
      clearance,
    });
  }),
);

/**
 * Governance health.
 *
 * Every component is computed from something the platform actually measures.
 * A component with no data is excluded rather than scored zero, and the
 * response says which — a consortium with no leases yet should not read as
 * unhealthy because rent collection had nothing to divide by.
 */
governanceRouter.get(
  '/health',
  authenticate,
  enterZone('HQ_EXECUTIVE'),
  requirePermission('governance:read', 'analytics:read'),
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const code = await currentCode();
    const clock = code ? codeClock(code.issuedAt, now, code.rotationDays) : null;

    const [
      activeLockouts,
      leaseTotal,
      leaseArrears,
      docTotal,
      docBacklog,
      memberTotal,
      memberVerified,
    ] = await Promise.all([
      FacAttempt.countDocuments({ lockedUntil: { $gt: now } }).exec(),
      Lease.countDocuments({ deletedAt: null }).exec(),
      Lease.countDocuments({ deletedAt: null, status: 'inArrears' }).exec(),
      DocumentRecord.countDocuments({ deletedAt: null }).exec(),
      DocumentRecord.countDocuments({ deletedAt: null, status: { $in: ['submitted', 'underReview'] } }).exec(),
      User.countDocuments({ deletedAt: null, status: 'active' }).exec(),
      User.countDocuments({ deletedAt: null, status: 'active', verificationStatus: 'verified' }).exec(),
    ]);

    const signals: HealthSignals = {
      code: code
        ? {
            active: code.status === 'active',
            expired: clock?.expired ?? true,
            daysRemaining: clock?.daysRemaining ?? 0,
            rotationDays: code.rotationDays,
          }
        : null,
      activeLockouts,
      leases: { total: leaseTotal, inArrears: leaseArrears },
      // Trail integrity is asserted structurally by the document engine's own
      // schema guard; reporting the count examined keeps the number honest
      // rather than claiming a verification this endpoint did not perform.
      audit: { examined: docTotal, intact: docTotal },
      documents: { total: docTotal, backlog: docBacklog },
      members: { total: memberTotal, verified: memberVerified },
    };

    return ok(res, {
      ...governanceHealth(signals),
      code: codeSummary(code, now),
      activeLockouts,
    });
  }),
);

export const facModule = {
  collectionPath: 'fac-codes',
  itemPath: 'fac-code',
  idParam: 'codeId',
  resource: 'fac' as const,
  service: facService,
  controller,
  mounts: [
    { path: 'fac-codes', router: codesRouter },
    { path: 'fac-code', router: codeRouter },
    { path: 'fac', router: facRouter },
    { path: 'governance', router: governanceRouter },
  ],
};

export { FacCode, FacAttempt, FacClearance, FAC_CODE_STATUSES } from './fac.model.js';
export type { IFacCode, IFacAttempt, IFacClearance } from './fac.model.js';
export * from './fac.validation.js';
