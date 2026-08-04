import { Router } from 'express';
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
  recordRentPaymentSchema,
  runRentRemindersSchema,
  updateLeaseSchema,
} from './lease.validation.js';

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
      await dispatchNotification({
        recipient: String(lease.tenant),
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
          recipient: String(lease.tenant),
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

export const leaseModule = {
  collectionPath: 'leases',
  itemPath: 'lease',
  idParam: 'leaseId',
  resource: 'lease' as const,
  service: leaseService,
  controller,
  mounts: [
    { path: 'leases', router: collectionRouter },
    { path: 'lease', router: itemRouter },
    { path: 'tenant', router: tenantScopedRouter },
    { path: 'landlord', router: landlordScopedRouter },
  ],
};

export { Lease, LEASE_STATUSES } from './lease.model.js';
export type { ILease };
export * from './lease.validation.js';
