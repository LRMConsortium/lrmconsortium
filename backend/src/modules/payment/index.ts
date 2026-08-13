import { Router, type RequestHandler } from 'express';
import type { Model } from 'mongoose';
import {
  auditTrail,
  authenticate,
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
import { LAUNCH_CURRENCY } from '../../config/currencies.js';
import { User } from '../../models/User.js';
import { recordObservation } from '../security/index.js';
import {
  historyScope, recordingProblems, receiptReference, summarisePayments,
  futureDatedBy, type HistoryScope, type RecordInput,
} from './paymentRules.js';
import { recordPaymentSchema } from './payment.validation.js';
import { AdvertiserProfile } from '../advertising/advertiser.model.js';
import { DriverProfile } from '../driver/driver.model.js';
import { LandlordProfile } from '../landlord/landlord.model.js';
import { TenantProfile } from '../tenant/tenant.model.js';
import { Payment, type IPayment } from './payment.model.js';

export const paymentService = new BaseService<IPayment>(Payment, {
  label: 'Payment',
  searchableFields: ['reference', 'providerName'],
  filterableFields: ['kind', 'status', 'currency', 'subject', 'subjectKind', 'payer', 'payee'],
  ownerPath: 'payer',
  organizationPath: 'payee',
  defaultSort: '-paidAt',
});

const controller = createCrudController(paymentService);

const collectionRouter = Router();
const itemRouter = Router();

const paymentId = namedIdParam('paymentId');
const aliasPayment = aliasIdParam('paymentId');
/* `:userId` on the member surface. Validated as an id like any other, so a
 * path segment cannot carry a Mongo operator into a query. */
const userIdParam = namedIdParam('userId');

// Payments are read-only over HTTP. They are written by the flows that cause
// them — a rent payment by `POST /lease/{leaseId}/payments`, a fare by ride
// completion — never by a client asserting that money moved.
collectionRouter.get(
  '/',
  authenticate,
  enterZone('BACK_OFFICE'),
  requirePermission('payment:read'),
  validate({ query: listQuery }),
  controller.list,
);

itemRouter.get(
  '/:paymentId',
  authenticate,
  enterZone('BACK_OFFICE'),
  requirePermission('payment:read', 'payment:readOwn'),
  validate({ params: paymentId }),
  aliasPayment,
  requireOwnership(paymentService, 'paymentId'),
  controller.get,
);

/**
 * Each member type sees the ledger from its own side. A tenant's payments are
 * the ones they made; a landlord's are the ones they received. Same collection,
 * different end of the transaction — which is why this is a shared builder
 * rather than four hand-written handlers that could drift apart.
 */
function ownLedger(
  model: Model<never>,
  label: string,
  side: 'payer' | 'payee',
  kinds?: string[],
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const profile = await (model as unknown as typeof TenantProfile)
      .findOne({ user: req.actor!.userId, deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    if (!profile) throw ApiError.notFound(`${label} for current user`);

    const filters: Record<string, unknown> = { [side]: String(profile._id) };
    if (kinds?.length) filters.kind = { $in: kinds };

    const { items, meta } = await paymentService.list({
      filters,
      limit: Number(req.query.limit ?? 20),
      page: Number(req.query.page ?? 1),
    });
    return paginated(res, items, meta);
  });
}

const member = [authenticate, enterZone('MEMBER_PORTAL')] as const;
const ownPermission = requirePermission('payment:readOwn', 'payment:read');

const tenantRouter = Router();
tenantRouter.get('/me/payments', ...member, ownPermission, validate({ query: listQuery }),
  ownLedger(TenantProfile as never, 'Tenant profile', 'payer', ['rent', 'deposit']));

const landlordRouter = Router();
landlordRouter.get('/me/payments', ...member, ownPermission, validate({ query: listQuery }),
  ownLedger(LandlordProfile as never, 'Landlord profile', 'payee', ['rent', 'landlordPayout']));

const driverRouter = Router();
driverRouter.get('/me/payments', ...member, ownPermission, validate({ query: listQuery }),
  ownLedger(DriverProfile as never, 'Driver profile', 'payee', ['ride', 'driverPayout']));

const advertiserRouter = Router();
advertiserRouter.get('/me/payments', ...member, ownPermission, validate({ query: listQuery }),
  ownLedger(AdvertiserProfile as never, 'Advertiser profile', 'payer', ['adSpend']));

/* ═══════════════════════════════════════════════════════════════════════════
 * The member-portal surface: one person's history, one person's summary, and
 * a receipt for money taken in a room.
 *
 * The rules — who may read whose, who may write one down, what a summary
 * means — are all in `paymentRules.ts`, which has no Mongoose and is asserted
 * without a database. This section resolves ids and runs queries.
 *
 * ── `:userId` is a user id; the ledger is in profile ids ──────────────────
 * `payer` and `payee` point at a *profile* (a TenantProfile, a LandlordProfile),
 * not at a user, because one person can be both a tenant and a landlord and
 * their two ledgers are genuinely different. The member portal speaks in user
 * ids. `profileIdsFor` is the join, and it is done once per request rather
 * than being guessed at per query.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Every profile document this user owns, as ids. The ledger's side of the join. */
async function profileIdsFor(userId: string): Promise<string[]> {
  const user = await User.findOne({ _id: userId, deletedAt: null })
    .select('profiles')
    .lean()
    .exec();
  if (!user) return [];
  return (user.profiles ?? []).map((p) => String(p.profileId));
}

/**
 * The Mongo filter for "payments about this person", narrowed by what the
 * caller is allowed to see.
 *
 * Returns `null` when the answer is "nothing", so a caller cannot mistake an
 * empty filter for an unrestricted one — the same trap as `DENY_ALL` in the
 * stats module, and the same reason for making it a distinct value rather than
 * an empty object.
 */
function historyFilter(
  scope: HistoryScope,
  profileIds: string[],
  actorId: string,
): Record<string, unknown> | null {
  if (scope === 'none') return null;
  /* A person with no profile has no ledger rows. An `$in: []` matches nothing,
   * which is right — but it is worth being explicit that this is "no rows",
   * not "no filter". */
  const sides = { $or: [{ payer: { $in: profileIds } }, { payee: { $in: profileIds } }] };
  if (scope === 'all') return { deletedAt: null, ...sides };
  /* A coordinator sees the receipts they wrote and nothing else. Recording and
   * reading are different powers; holding the first does not grant the second. */
  return { deletedAt: null, recordedBy: actorId, ...sides };
}

const historyRouter = Router();

historyRouter.get(
  '/:userId/history',
  ...member,
  auditTrail('payment'),
  ownPermission,
  validate({ params: userIdParam, query: listQuery }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const subjectId = String(req.params.userId);
    const scope = historyScope(
      { userId: actor.userId, roles: actor.roles as string[] },
      subjectId,
    );

    /* Refused rather than answered empty. An empty list and "you may not see
     * this" are different facts, and returning the first for the second teaches
     * a caller that the person has no payments. */
    if (scope === 'none') {
      throw ApiError.forbidden('You may not read this person\'s payment history');
    }

    const profileIds = await profileIdsFor(subjectId);
    const filters = historyFilter(scope, profileIds, actor.userId);
    if (!filters) throw ApiError.forbidden('You may not read this person\'s payment history');

    /* Reading somebody else's ledger. One is ordinary — a coordinator checking
     * a receipt. Eighty different people in ten minutes is somebody walking the
     * member list. */
    if (subjectId !== actor.userId) {
      recordObservation({ signal: 'enumeration', subject: actor.userId, at: Date.now() });
    }

    /* `serverFilters`, not `filters`. `historyFilter` is the authorization
     * decision for this route, and `filters` is passed through the
     * `filterableFields` allowlist — which does not list `$or` or `recordedBy`
     * and therefore dropped both, silently, leaving `{ deletedAt: null }` and
     * answering with the whole platform's ledger. See `ListParams`. */
    const { items, meta } = await paymentService.list({
      serverFilters: filters,
      limit: Number(req.query.limit ?? 20),
      page: Number(req.query.page ?? 1),
    });
    return paginated(res, items, meta);
  }),
);

historyRouter.get(
  '/:userId/summary',
  ...member,
  auditTrail('payment'),
  ownPermission,
  validate({ params: userIdParam }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const subjectId = String(req.params.userId);
    const scope = historyScope(
      { userId: actor.userId, roles: actor.roles as string[] },
      subjectId,
    );
    if (scope === 'none') {
      throw ApiError.forbidden('You may not read this person\'s payment summary');
    }

    const profileIds = await profileIdsFor(subjectId);
    const filters = historyFilter(scope, profileIds, actor.userId);
    if (!filters) throw ApiError.forbidden('You may not read this person\'s payment summary');

    /* The whole set, not a page. A summary computed over twenty rows is the
     * exact bug the aggregate endpoints were built to remove, and it would be
     * worse here: a rate over a page reads as a rate over a history.
     *
     * `.lean()` and four fields, so this stays cheap even for a long-standing
     * tenant. If it ever stops being cheap the answer is an aggregation, not a
     * page. */
    const rows = await Payment.find(filters)
      .select('status amount currency dueDate paidAt')
      .lean()
      .exec();

    return ok(res, {
      ...summarisePayments(rows as never, LAUNCH_CURRENCY),
      /* Said out loud, because a coordinator reading a total that covers only
       * their own receipts would otherwise reasonably read it as the whole. */
      scope,
      partial: scope !== 'all',
    });
  }),
);

/**
 * Write down money that changed hands in a room.
 *
 * See the header of `paymentRules.ts` for why this exists at all — the short
 * version is that refusing to record cash would push The Gambia's informal
 * economy out of the evidence base, and that population is who LRMC is for.
 *
 * Everything that makes it safe is in the rules module and asserted there. What
 * happens here is the two things that need a database: the idempotency
 * collision, and resolving a payer's user id to the profile the ledger indexes.
 */
historyRouter.post(
  '/record',
  ...member,
  auditTrail('payment'),
  requirePermission('payment:record'),
  validate({ body: recordPaymentSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const input = req.body as RecordInput & { notes?: string; subject?: string };

    const problems = recordingProblems(
      { userId: actor.userId, roles: actor.roles as string[] },
      input,
    );
    /* A receipt dated tomorrow is a promise, not a payment, and it would sort
     * to the top of a history as the most recent thing that happened. Checked
     * here because it needs a clock and the rules module deliberately has none. */
    if (futureDatedBy(input.paidAt, Date.now()) > 0) {
      problems.push({
        field: 'paidAt', code: 'future',
        message: 'A payment cannot be recorded as having happened in the future.',
      });
    }
    if (problems.length) throw ApiError.validation('Request validation failed', problems);

    const payerProfiles = await profileIdsFor(String(input.payer));
    if (!payerProfiles.length) {
      throw ApiError.validation('Request validation failed', [{
        field: 'payer', code: 'no-profile',
        message: 'That member has no profile to record a payment against.',
      }]);
    }

    const reference = receiptReference(input);
    const existing = await Payment.findOne({ reference }).select('_id').lean().exec();
    if (existing) {
      /* Surfaced, not swallowed. A retry on a bad connection and a genuine
       * second identical payment on the same day look the same from here, and
       * silently accepting either would double a tenant's rent or lose a real
       * receipt. The caller is told which row it collided with so a person can
       * decide. */
      throw ApiError.conflict(
        'A receipt with these details already exists for that day. If this is a second, separate payment, add a note to tell them apart.',
      );
    }

    const payment = await Payment.create({
      reference,
      kind: input.kind,
      subjectKind: input.subjectKind ?? (input.subject ? 'Lease' : undefined),
      subject: input.subject,
      payer: payerProfiles[0],
      payerKind: 'TenantProfile',
      amount: input.amount,
      currency: input.currency ?? LAUNCH_CURRENCY,
      method: input.method ?? 'cash',
      /* The money is already in hand. That is what recording one means — this
       * is not an instruction to collect, it is a receipt for a collection. */
      status: 'succeeded',
      paidAt: input.paidAt ? new Date(input.paidAt as string) : new Date(),
      /* From the token, never from the body. A hand-written money record with
       * no named author is not evidence of anything. */
      recordedBy: actor.userId,
      notes: input.notes,
      createdBy: actor.userId,
    });

    /* A coordinator writing up a week of collections on a Friday might enter
     * twenty receipts in an hour. Sixty is a lot of compounds, and it is the
     * shape a compromised coordinator account would make. Advisory only —
     * `abuse.ts` caps the outcome at telling somebody. */
    recordObservation({ signal: 'recordingBurst', subject: actor.userId, at: Date.now() });

    return created(res, payment);
  }),
);

export const paymentModule = {
  collectionPath: 'payments',
  itemPath: 'payment',
  idParam: 'paymentId',
  resource: 'payment' as const,
  service: paymentService,
  controller,
  mounts: [
    { path: 'payments', router: collectionRouter },
    { path: 'payments', router: historyRouter },
    { path: 'payment', router: itemRouter },
    { path: 'tenant', router: tenantRouter },
    { path: 'landlord', router: landlordRouter },
    { path: 'driver', router: driverRouter },
    { path: 'advertiser', router: advertiserRouter },
  ],
};

export { Payment, PAYMENT_KINDS, PAYMENT_STATUSES } from './payment.model.js';
export type { IPayment };
