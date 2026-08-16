import { Router, type Request, type Response } from 'express';
import {
  authenticate,
  auditTrail,
  enterZone,
  requireOwnership,
  requirePermission,
  validate,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { BaseService } from '../../shared/BaseService.js';
import { createCrudController } from '../../shared/BaseController.js';
import { asyncHandler, created, ok, paginated } from '../../shared/http.js';
import { aliasIdParam, listQuery, namedIdParam } from '../../shared/moduleFactory.js';
import { LandlordProfile } from '../landlord/landlord.model.js';
import { TenantProfile } from '../tenant/tenant.model.js';
import { Payment } from '../payment/payment.model.js';
import { dispatchNotification, summariseDispatch, type DispatchOutcome } from '../notification/dispatch.js';
import { Lease, type ILease } from './lease.model.js';
import {
  applyPayment,
  arrearsEscalation,
  arrearsFor,
  creditBalanceFor,
  expectedToDate,
  instalmentsDueBy,
  lifecycleStatus,
  money,
  nextPaymentDue,
  paymentSchedule,
  reminderFor,
  RENT_REMINDER_LEAD_DAYS,
  type RentTerms,
} from './rentSchedule.js';
import {
  createLeaseSchema,
  leaseActionSchema,
  leaseTerminateSchema,
  memberCreateLeaseSchema,
  recordRentPaymentSchema,
  runRentRemindersSchema,
  updateLeaseSchema,
} from './lease.validation.js';
import {
  creationProblems,
  leaseScope,
  transitionProblems,
  type LeaseStatus,
} from './leaseLifecycle.js';
import { LAUNCH_CURRENCY } from '../../config/currencies.js';
import { Property } from '../property/property.model.js';
import { User } from '../../models/User.js';

/** Reduce a lease document to the fields the rent arithmetic needs. */
function termsOf(lease: ILease): RentTerms {
  return {
    leaseStart: lease.leaseStart,
    leaseEnd: lease.leaseEnd,
    monthlyRent: lease.monthlyRent,
    paymentDayOfMonth: lease.paymentDayOfMonth ?? 1,
    totalPaid: lease.totalPaid ?? 0,
  };
}

/**
 * A single payment may not exceed a year of rent.
 *
 * Not a policy about prepayment — it is a fat-finger guard. A tenant paying
 * 250,000 instead of 2,500 should get a 422 they can read, not a credit balance
 * somebody has to unwind by hand three months later.
 */
export const MAX_PAYMENT_MONTHS = 12;

export const leaseService = new BaseService<ILease>(Lease, {
  label: 'Lease',
  searchableFields: ['reference'],
  filterableFields: ['status', 'property', 'tenant', 'landlord', 'coordinator', 'currency'],
  ownerPath: 'tenant',
  organizationPath: 'landlord',
  populate: ['property'],
  defaultSort: '-createdAt',
});

const controller = createCrudController(leaseService);

/**
 * The person behind a tenant profile.
 *
 * `Notification.recipient` is a **User** — you notify a person, not one of the
 * roles they hold — while `Lease.tenant` is a TenantProfile id. Both dispatches
 * below passed the profile id straight through, so `GET /notifications/me`
 * (which filters on `recipient: actor.userId`) matched nothing and
 * `dispatch.targetsFor` found no push tokens.
 *
 * Every rent receipt and every rent reminder LRMC has ever sent went to an id
 * that belongs to no user. Nothing failed; the rows were written and delivered
 * to nobody.
 */
async function tenantUserFor(tenantProfileId: unknown): Promise<string | null> {
  const profile = await TenantProfile.findOne({ _id: tenantProfileId as never, deletedAt: null })
    .select('user')
    .lean()
    .exec();
  return profile?.user ? String(profile.user) : null;
}

const collectionRouter = Router();
const itemRouter = Router();
/** Mounted under the existing `/tenant` and `/landlord` item paths. */
const tenantScopedRouter = Router();
const landlordScopedRouter = Router();

const leaseId = namedIdParam('leaseId');
const aliasLease = aliasIdParam('leaseId');
const backOffice = [authenticate, enterZone('BACK_OFFICE'), auditTrail('lease')] as const;

// ── Collection ──────────────────────────────────────────────────────────────

collectionRouter.get(
  '/',
  ...backOffice,
  requirePermission('lease:read'),
  validate({ query: listQuery }),
  controller.list,
);

/**
 * Open a lease.
 *
 * `nextDueDate` is stamped here rather than left null and back-filled by the
 * first reminder run: a lease that exists but does not yet know when its rent
 * is due is invisible to the reminder job, which is exactly the lease a landlord
 * will ask about.
 */
collectionRouter.post(
  '/',
  ...backOffice,
  requirePermission('lease:create'),
  validate({ body: createLeaseSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as Record<string, unknown>;
    const terms: RentTerms = {
      leaseStart: body.leaseStart as Date,
      leaseEnd: body.leaseEnd as Date,
      monthlyRent: body.monthlyRent as number,
      paymentDayOfMonth: (body.paymentDayOfMonth as number | undefined) ?? 1,
      totalPaid: 0,
    };
    const now = new Date();

    const lease = await Lease.create({
      ...body,
      totalPaid: 0,
      arrearsAmount: arrearsFor(terms, now),
      nextDueDate: nextPaymentDue(terms, now),
      status: (body.status as string | undefined) ?? lifecycleStatus(terms, now),
      createdBy: actor.userId,
    });
    return created(res, lease.toObject());
  }),
);

// ── Item ────────────────────────────────────────────────────────────────────

itemRouter.get(
  '/:leaseId',
  ...backOffice,
  requirePermission('lease:read', 'lease:readOwn'),
  validate({ params: leaseId }),
  aliasLease,
  requireOwnership(leaseService, 'leaseId'),
  controller.get,
);

itemRouter.patch(
  '/:leaseId',
  ...backOffice,
  requirePermission('lease:update'),
  validate({ params: leaseId, body: updateLeaseSchema }),
  aliasLease,
  requireOwnership(leaseService, 'leaseId'),
  controller.update,
);

/**
 * Record a rent payment against a lease.
 *
 * Writes the `Payment` ledger row and rolls the lease's running totals forward
 * in the same request — a payment that is recorded but not reflected in
 * `totalPaid` is the bug that produces disputed arrears.
 */
itemRouter.post(
  '/:leaseId/payments',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  auditTrail('payment'),
  requirePermission('payment:create', 'rentPayment:create'),
  validate({ params: leaseId, body: recordRentPaymentSchema }),
  aliasLease,
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const lease = await Lease.findOne({ _id: req.params.leaseId, deletedAt: null }).exec();
    if (!lease) throw ApiError.notFound('Lease');

    const body = req.body as {
      amount: number;
      currency?: string;
      method?: string;
      paidAt?: Date;
      providerReference?: string;
      notes?: string;
    };

    if (body.amount <= 0) {
      throw ApiError.validation('A rent payment must be greater than zero', [
        { field: 'amount', message: 'must be greater than zero' },
      ]);
    }
    if (body.amount > lease.monthlyRent * MAX_PAYMENT_MONTHS) {
      throw ApiError.validation(
        `A single payment may not exceed ${MAX_PAYMENT_MONTHS} months of rent`,
        [{ field: 'amount', message: `maximum ${money(lease.monthlyRent * MAX_PAYMENT_MONTHS)}` }],
      );
    }
    if (body.currency && body.currency !== lease.currency) {
      throw ApiError.policy(
        `This lease is billed in ${lease.currency}; a ${body.currency} payment cannot be applied to it`,
      );
    }
    if (lease.status === 'draft' || lease.status === 'pendingSignature') {
      throw ApiError.policy('Rent cannot be recorded against a lease that is not yet in force');
    }

    const paidAt = body.paidAt ?? new Date();

    // One computation, applied to both rows. The ledger entry and the lease
    // totals cannot disagree because neither is derived independently.
    const applied = applyPayment(termsOf(lease), body.amount, paidAt, lease.status);

    const payment = await Payment.create({
      kind: 'rent',
      subjectKind: 'Lease',
      subject: lease._id,
      payer: lease.tenant,
      payerKind: 'TenantProfile',
      payee: lease.landlord,
      payeeKind: 'LandlordProfile',
      amount: body.amount,
      currency: lease.currency,
      method: body.method ?? lease.paymentMethod ?? 'mobileMoney',
      providerReference: body.providerReference,
      notes: body.notes,
      paidAt,
      status: 'succeeded',
      createdBy: actor.userId,
    });

    await Lease.updateOne(
      { _id: lease._id },
      {
        $set: {
          totalPaid: applied.totalPaid,
          arrearsAmount: applied.arrearsAmount,
          lastPaymentAt: paidAt,
          nextDueDate: applied.nextDueDate,
          status: applied.status,
          updatedBy: actor.userId,
        },
      },
    ).exec();

    // Receipt to the tenant. Best-effort: a provider outage must not fail a
    // payment that has already been recorded.
    try {
      const tenantUser = await tenantUserFor(lease.tenant);
      if (!tenantUser) throw ApiError.internal('No user behind this tenant profile');
      await dispatchNotification({
        recipient: tenantUser,
        category: 'rentReceipt',
        channel: 'inApp',
        title: `Rent received — ${lease.reference}`,
        body: `${money(body.amount)} ${lease.currency} recorded. Balance outstanding: ${applied.arrearsAmount} ${lease.currency}.`,
        subjectKind: 'Lease',
        subject: String(lease._id),
        createdBy: actor.userId,
      });
    } catch {
      // Deliberately swallowed — see above.
    }

    return created(res, {
      payment: payment.toObject(),
      lease: {
        id: String(lease._id),
        reference: lease.reference,
        totalPaid: applied.totalPaid,
        arrearsAmount: applied.arrearsAmount,
        creditBalance: applied.creditBalance,
        nextDueDate: applied.nextDueDate,
        status: applied.status,
        escalation: applied.escalation,
      },
    });
  }),
);

/**
 * The instalment schedule and where the tenant stands against it.
 *
 * Everything here is computed from the term and the running total — no schedule
 * rows are stored, so a corrected rent or start date reshapes the statement
 * instead of leaving stale instalments behind.
 */
itemRouter.get(
  '/:leaseId/schedule',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('lease:read', 'lease:readOwn'),
  validate({ params: leaseId }),
  aliasLease,
  requireOwnership(leaseService, 'leaseId'),
  asyncHandler(async (req, res) => {
    const lease = (await Lease.findOne({ _id: req.params.leaseId, deletedAt: null })
      .lean()
      .exec()) as ILease | null;
    if (!lease) throw ApiError.notFound('Lease');

    const terms = termsOf(lease);
    const now = new Date();
    const schedule = paymentSchedule(terms, now);
    const arrears = arrearsFor(terms, now);

    return ok(res, {
      leaseId: String(lease._id),
      reference: lease.reference,
      currency: lease.currency,
      monthlyRent: lease.monthlyRent,
      paymentDayOfMonth: lease.paymentDayOfMonth,
      instalmentsDue: instalmentsDueBy(terms, now),
      totalInstalments: schedule.totalInstalments,
      expectedToDate: expectedToDate(terms, now),
      totalPaid: lease.totalPaid ?? 0,
      arrearsAmount: arrears,
      creditBalance: creditBalanceFor(terms, now),
      nextDueDate: nextPaymentDue(terms, now),
      status: lifecycleStatus(terms, now, lease.status),
      escalation: arrearsEscalation(arrears, lease.monthlyRent),
      truncated: schedule.truncated,
      entries: schedule.entries,
    });
  }),
);

/**
 * The rent reminder run.
 *
 * A cron stub in the honest sense: the *scheduling* is external — a platform
 * cron, a queue worker, whatever operations prefers — and this is the idempotent
 * endpoint it calls. Keeping the trigger outside the process means the job does
 * not silently stop when a container restarts, and means an operator can run it
 * by hand after an outage without a deploy.
 *
 * `dryRun` is the default-safe option a first run should use.
 */
collectionRouter.post(
  '/run-rent-reminders',
  authenticate,
  enterZone('BACK_OFFICE'),
  auditTrail('lease'),
  requirePermission('lease:update', 'lease:read'),
  validate({ body: runRentRemindersSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as {
      asOf?: Date;
      leadDays?: number;
      dryRun?: boolean;
      limit?: number;
    };
    const asOf = body.asOf ?? new Date();
    const leadDays = body.leadDays ?? RENT_REMINDER_LEAD_DAYS;
    const dryRun = body.dryRun ?? false;

    const leases = (await Lease.find({
      deletedAt: null,
      status: { $in: ['active', 'inArrears', 'expiring'] },
      leaseStart: { $lte: asOf },
    })
      .limit(body.limit ?? 500)
      .lean()
      .exec()) as unknown as ILease[];

    const outcomes: DispatchOutcome[] = [];
    const byEscalation: Record<string, number> = {};
    let examined = 0;
    let due = 0;
    let statusesCorrected = 0;

    for (const lease of leases) {
      examined += 1;
      const terms = termsOf(lease);
      const verdict = reminderFor(terms, asOf, leadDays);
      byEscalation[verdict.escalation] = (byEscalation[verdict.escalation] ?? 0) + 1;

      // The run doubles as the arrears sweep: recompute the balance and the
      // lifecycle status even for leases that need no reminder, so a lease that
      // fell into arrears overnight is labelled before anyone looks at it.
      const freshStatus = lifecycleStatus(terms, asOf, lease.status);
      if (
        !dryRun &&
        (freshStatus !== lease.status || money(verdict.arrears) !== money(lease.arrearsAmount ?? 0))
      ) {
        statusesCorrected += 1;
        await Lease.updateOne(
          { _id: lease._id },
          {
            $set: {
              status: freshStatus,
              arrearsAmount: verdict.arrears,
              nextDueDate: verdict.dueDate,
              updatedBy: actor.userId,
            },
          },
        ).exec();
      }

      if (!verdict.send) continue;
      due += 1;
      if (dryRun) continue;

      /* A reminder with nobody to send it to is not sent. Skipped rather than
       * dispatched to an empty string, which would write a notification row
       * addressed to nothing and count it as delivered. */
      const dueUser = await tenantUserFor(lease.tenant);
      if (!dueUser) continue;

      const title =
        verdict.reason === 'inArrears'
          ? `Rent overdue — ${lease.reference}`
          : `Rent due in ${verdict.daysUntilDue} day${verdict.daysUntilDue === 1 ? '' : 's'}`;
      const detail =
        verdict.reason === 'inArrears'
          ? `${verdict.arrears} ${lease.currency} is outstanding on ${lease.reference}.`
          : `${money(lease.monthlyRent)} ${lease.currency} is due on ${verdict.dueDate?.toISOString().slice(0, 10)}.`;

      outcomes.push(
        await dispatchNotification({
          recipient: dueUser,
          category: 'rentDue',
          channel: 'push',
          title,
          body: detail,
          deepLink: `lrmc://lease/${lease.reference}`,
          subjectKind: 'Lease',
          subject: String(lease._id),
          createdBy: actor.userId,
        }),
      );
    }

    return ok(res, {
      asOf,
      leadDays,
      dryRun,
      examined,
      remindersDue: due,
      statusesCorrected,
      byEscalation,
      ...summariseDispatch(outcomes),
    });
  }),
);

// ── Member-scoped views ─────────────────────────────────────────────────────

/** Resolve the caller's own profile id for a given collection. */
async function ownProfileId(
  model: typeof TenantProfile | typeof LandlordProfile,
  userId: string,
  label: string,
): Promise<string> {
  const doc = await model.findOne({ user: userId, deletedAt: null }).select('_id').lean().exec();
  if (!doc) throw ApiError.notFound(`${label} for current user`);
  return String(doc._id);
}

tenantScopedRouter.get(
  '/me/leases',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('lease:readOwn', 'lease:read'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const tenantId = await ownProfileId(TenantProfile, req.actor!.userId, 'Tenant profile');
    const { items, meta } = await leaseService.list({ filters: { tenant: tenantId } });
    return res.status(200).json({ success: true, data: items, meta });
  }),
);

landlordScopedRouter.get(
  '/me/leases',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('lease:readOwn', 'lease:read'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const landlordId = await ownProfileId(LandlordProfile, req.actor!.userId, 'Landlord profile');
    const { items, meta } = await leaseService.list({ filters: { landlord: landlordId } });
    return res.status(200).json({ success: true, data: items, meta });
  }),
);

/* ═══════════════════════════════════════════════════════════════════════════
 * The member-portal surface.
 *
 * `/leases` and `/lease/:leaseId` above are the Back Office collection — the
 * whole platform's tenancies, paged and filterable, plus the rent ledger and
 * the schedule that hang off each one. What follows is the same records seen
 * from inside a tenancy: the four lifecycle acts, and the three reads a member
 * portal needs.
 *
 * Every rule lives in `leaseLifecycle.ts`, which has no Mongoose and is
 * asserted without a database. This section resolves ids and writes rows. It
 * decides nothing.
 *
 * ── The asymmetry worth knowing about ─────────────────────────────────────
 * A landlord activates and completes. A landlord does **not** terminate —
 * ending a tenancy early is eviction by another name, and LRMC carries the
 * tenancy, holds the deposit and answers for the outcome. A coordinator does
 * it, and has to say why. Same principle as a landlord not approving their own
 * applicant.
 * ══════════════════════════════════════════════════════════════════════════ */

const memberRouter = Router();
const leaseUserIdParam = namedIdParam('userId');
const leasePropertyIdParam = namedIdParam('propertyId');
const leaseMember = [authenticate, enterZone('MEMBER_PORTAL'), auditTrail('lease')] as const;

/**
 * The users behind a lease's three parties.
 *
 * The lease points at *profiles* — a TenantProfile, a LandlordProfile — because
 * one person can be both a tenant and a landlord and their two positions are
 * genuinely different. Deciding who somebody is to a lease needs user ids, so
 * this is the join, done once per request rather than guessed at per check.
 */
async function partiesOf(lease: ILease): Promise<{
  landlordUser: string | null;
  tenantUser: string | null;
  coordinatorUser: string | null;
}> {
  const [landlord, tenant] = await Promise.all([
    lease.landlord
      ? LandlordProfile.findById(lease.landlord).select('user').lean().exec()
      : null,
    lease.tenant
      ? TenantProfile.findById(lease.tenant).select('user').lean().exec()
      : null,
  ]);
  return {
    landlordUser: landlord?.user ? String(landlord.user) : null,
    tenantUser: tenant?.user ? String(tenant.user) : null,
    coordinatorUser: lease.coordinator ? String(lease.coordinator) : null,
  };
}

/** Every profile id this user owns, for matching against a lease's parties. */
async function leaseProfileIds(userId: string): Promise<string[]> {
  const user = await User.findOne({ _id: userId, deletedAt: null })
    .select('profiles')
    .lean()
    .exec();
  return (user?.profiles ?? []).map((p) => String(p.profileId));
}

/**
 * One lifecycle act, written once.
 *
 * Activate, complete and terminate differ only in the status they aim at and
 * whether they need a reason — so they are one function with a parameter rather
 * than three handlers that agree today and drift next quarter. The permission
 * check is `leaseLifecycle.transitionProblems`, which is the same table the
 * suite asserts against.
 */
function lifecycleAct(target: LeaseStatus) {
  return asyncHandler(async (req: Request, res: Response) => {
    const actor = req.actor!;
    const body = req.body as { lease: string; reason?: string };

    const lease = await Lease.findOne({ _id: body.lease, deletedAt: null }).exec();
    if (!lease) throw ApiError.notFound('Lease');

    /* Who this actor is *to this lease* comes from the loaded row, never from
     * anything the caller asserted. A body claiming `party: 'coordinator'`
     * would be the whole authorisation model in one field. */
    const parties = await partiesOf(lease);

    const problems = transitionProblems(
      { userId: actor.userId, roles: actor.roles as string[] },
      { status: lease.status, ...parties },
      { from: lease.status, to: target, reason: body.reason },
    );
    if (problems.length) throw ApiError.validation('Request validation failed', problems);

    const now = new Date();
    lease.status = target;
    lease.updatedBy = actor.userId as never;
    if (target === 'terminated') {
      lease.terminationReason = body.reason;
      /* Stamped, because `leaseEnd` is when the term was *meant* to run out and
       * this is when the tenancy actually stopped. Tenancy stability measures
       * the second; using the first would credit a terminated tenant with
       * months they did not live there. */
      lease.closedAt = now;
    }
    if (target === 'completed') lease.closedAt = now;

    await lease.save();
    return ok(res, lease);
  });
}

memberRouter.post(
  '/create',
  ...leaseMember,
  requirePermission('lease:create'),
  validate({ body: memberCreateLeaseSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as Record<string, unknown>;

    const problems = creationProblems(
      { userId: actor.userId, roles: actor.roles as string[] },
      body as never,
    );
    if (problems.length) throw ApiError.validation('Request validation failed', problems);

    const property = await Property.findOne({ _id: body.property, deletedAt: null })
      .select('_id owner ownerKind assignedCoordinator')
      .lean()
      .exec();
    if (!property) throw ApiError.notFound('Property');

    /* The landlord is the property's, not the caller's claim about it. A body
     * that could name the landlord would let somebody draw up a lease over
     * a building they have nothing to do with.
     *
     * ── `owner` + `ownerKind`, not `landlord` ─────────────────────────────
     * This selected `landlord` and `coordinator`, neither of which is a path on
     * `Property` — ownership is polymorphic, because a building can belong to a
     * landlord, a hotel or a resort. Mongoose returned `_id` alone, `landlord`
     * was therefore always undefined, and **every member-portal lease creation
     * was refused** with "that property has no landlord on record". A landlord
     * could not draw up a tenancy at all.
     *
     * The `as { landlord?: unknown }` cast is what hid it: without the cast
     * this would not have compiled. It is gone, so the types can do their job.
     *
     * `ownerKind` is checked rather than assumed — a hotel's property has an
     * owner too, and it is not a landlord. */
    const landlord = property.ownerKind === 'LandlordProfile' ? property.owner : undefined;
    if (!landlord) {
      throw ApiError.validation('Request validation failed', [{
        field: 'property', code: 'no-landlord',
        message: 'That property has no landlord on record, so a lease cannot name one.',
      }]);
    }

    const lease = await Lease.create({
      property: property._id,
      landlord,
      tenant: body.tenant,
      coordinator: property.assignedCoordinator,
      monthlyRent: body.monthlyRent,
      currency: body.currency ?? LAUNCH_CURRENCY,
      leaseStart: body.leaseStart,
      /* Absent means month-to-month, which is ordinary here. Stored as null
       * rather than invented, so nothing downstream treats a made-up date as a
       * commitment somebody agreed to. */
      leaseEnd: body.leaseEnd ?? null,
      paymentDayOfMonth: body.paymentDayOfMonth ?? 1,
      securityDeposit: body.securityDeposit,
      /* Always. A lease is drawn up, then activated by the landlord whose
       * property it is — a create that could land straight in `active` would
       * skip the one moment either party gets to look at it. */
      status: 'draft',
      createdBy: actor.userId,
    });

    return created(res, lease);
  }),
);

memberRouter.post('/activate', ...leaseMember, requirePermission('lease:update', 'lease:updateOwn'),
  validate({ body: leaseActionSchema }), lifecycleAct('active'));

memberRouter.post('/complete', ...leaseMember, requirePermission('lease:update', 'lease:updateOwn'),
  validate({ body: leaseActionSchema }), lifecycleAct('completed'));

memberRouter.post('/terminate', ...leaseMember, requirePermission('lease:update', 'lease:updateOwn'),
  validate({ body: leaseTerminateSchema }), lifecycleAct('terminated'));

/**
 * One person's tenancies — as tenant or as landlord, because the same account
 * can be both and their two histories are one screen.
 */
memberRouter.get(
  '/user/:userId',
  ...leaseMember,
  requirePermission('lease:read', 'lease:readOwn'),
  validate({ params: leaseUserIdParam, query: listQuery }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const subjectId = String(req.params.userId);
    const scope = leaseScope(
      { userId: actor.userId, roles: actor.roles as string[] },
      subjectId,
    );
    /* Refused, not answered empty. "You may not see this" and "there is nothing
     * here" are different facts, and returning the second for the first teaches
     * a caller something about a person that is not theirs to learn. */
    if (scope === 'none') throw ApiError.forbidden('You may not read this person\'s tenancies');

    const profileIds = await leaseProfileIds(subjectId);
    /* `serverFilters`: this `$or` is the authorization decision, and the
     * client-filter allowlist does not list `$or`. Passed as `filters` it was
     * dropped and every lease on the platform was returned. See `ListParams`. */
    const { items, meta } = await leaseService.list({
      serverFilters: {
        $or: [{ tenant: { $in: profileIds } }, { landlord: { $in: profileIds } }],
      },
      limit: Number(req.query.limit ?? 20),
      page: Number(req.query.page ?? 1),
    });
    return paginated(res, items, meta);
  }),
);

/** A property's succession of tenancies. */
memberRouter.get(
  '/property/:propertyId',
  ...leaseMember,
  requirePermission('lease:read', 'lease:readOwn'),
  validate({ params: leasePropertyIdParam, query: listQuery }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const property = await Property.findOne({ _id: req.params.propertyId, deletedAt: null })
      .select('_id owner ownerKind')
      .lean()
      .exec();
    if (!property) throw ApiError.notFound('Property');

    /* A property's lease history is its landlord's business and LRMC's. A
     * tenant may read their own lease — that is `/leases/user/:userId` — but
     * not the succession of everybody who lived there before them. */
    const mine = await leaseProfileIds(actor.userId);
    const isOwner = property.ownerKind === 'LandlordProfile'
      && mine.some((id) => id === String(property.owner));
    const staffOrCoordinator = leaseScope(
      { userId: actor.userId, roles: actor.roles as string[] }, actor.userId) === 'all';
    if (!isOwner && !staffOrCoordinator) {
      throw ApiError.forbidden('You may not read this property\'s tenancies');
    }

    const { items, meta } = await leaseService.list({
      filters: { property: property._id },
      limit: Number(req.query.limit ?? 20),
      page: Number(req.query.page ?? 1),
    });
    return paginated(res, items, meta);
  }),
);

export const leaseModule = {
  collectionPath: 'leases',
  itemPath: 'lease',
  idParam: 'leaseId',
  resource: 'lease' as const,
  service: leaseService,
  controller,
  mounts: [
    { path: 'leases', router: collectionRouter },
    { path: 'leases', router: memberRouter },
    { path: 'lease', router: itemRouter },
    { path: 'tenant', router: tenantScopedRouter },
    { path: 'landlord', router: landlordScopedRouter },
  ],
};

export { Lease, LEASE_STATUSES } from './lease.model.js';
export type { ILease };
export * from './lease.validation.js';
