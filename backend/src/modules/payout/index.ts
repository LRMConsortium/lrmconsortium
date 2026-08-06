import { Router } from 'express';
import {
  authenticate,
  auditTrail,
  enterZone,
  requirePermission,
  validate,
  requireClearance,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { BaseService } from '../../shared/BaseService.js';
import { createCrudController } from '../../shared/BaseController.js';
import { asyncHandler, created, ok, paginated } from '../../shared/http.js';
import { listQuery, namedIdParam } from '../../shared/moduleFactory.js';
import {
  moneyProvider,
  railFor,
  summariseTransfers,
  type TransferResult,
} from '../../shared/providers/money.js';
import { Payment } from '../payment/payment.model.js';
import {
  batchBalances,
  buildPayoutBatch,
  money,
  PAYOUT_SOURCES,
  type LedgerRow,
  type PayoutKind,
} from '../payment/ledger.js';
import { PayoutBatch, type IPayoutBatch } from './payout.model.js';
import {
  buildPayoutBatchSchema,
  cancelPayoutBatchSchema,
  settlePayoutBatchSchema,
} from './payout.validation.js';

export const payoutService = new BaseService<IPayoutBatch>(PayoutBatch, {
  label: 'Payout batch',
  searchableFields: ['reference'],
  filterableFields: ['kind', 'status', 'currency'],
  defaultSort: '-createdAt',
});

const controller = createCrudController(payoutService);

const collectionRouter = Router();
const itemRouter = Router();

const batchId = namedIdParam('batchId');

/**
 * Payouts are a Back Office build and a Founder settle.
 *
 * Zone C composes the batch and can see the numbers; nobody below Zone A moves
 * the money. That split is the whole point of having a `draft` state — an
 * operator assembles, a principal releases.
 */
const backOffice = [authenticate, enterZone('BACK_OFFICE'), auditTrail('payoutBatch')] as const;

collectionRouter.get(
  '/',
  ...backOffice,
  requirePermission('payout:read'),
  validate({ query: listQuery }),
  controller.list,
);

/**
 * Build a batch from the ledger.
 *
 * The request is a *query* — kind, currency, window — and the server computes
 * the lines. Nothing a client sends becomes an amount, which is what stops the
 * endpoint from being a way to pay yourself.
 */
collectionRouter.post(
  '/',
  ...backOffice,
  requirePermission('payout:create'),
  validate({ body: buildPayoutBatchSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as {
      kind: PayoutKind;
      currency?: string;
      periodStart?: Date;
      periodEnd?: Date;
      maxRows?: number;
      notes?: string;
    };

    const currency = body.currency ?? 'GMD';
    const filter: Record<string, unknown> = {
      kind: { $in: PAYOUT_SOURCES[body.kind] },
      status: 'succeeded',
      currency,
      deletedAt: null,
    };
    if (body.periodStart || body.periodEnd) {
      filter.paidAt = {
        ...(body.periodStart ? { $gte: body.periodStart } : {}),
        ...(body.periodEnd ? { $lte: body.periodEnd } : {}),
      };
    }

    // A row already claimed by a live batch must not be paid twice. The lines of
    // any batch that is not cancelled or failed are treated as spent.
    const claimed = await PayoutBatch.find({
      status: { $nin: ['cancelled', 'failed'] },
      deletedAt: null,
    })
      .select('lines.sourcePayments')
      .lean()
      .exec();
    const spent = new Set(
      claimed.flatMap((b) =>
        (b.lines ?? []).flatMap((l) => (l.sourcePayments ?? []).map((id) => String(id))),
      ),
    );

    const rows = await Payment.find(filter)
      .sort('-paidAt')
      .limit(body.maxRows ?? 1000)
      .lean()
      .exec();

    const ledgerRows: LedgerRow[] = rows
      .filter((r) => !spent.has(String(r._id)))
      .map((r) => ({
        id: String(r._id),
        kind: r.kind,
        status: r.status,
        payee: r.payee ? String(r.payee) : undefined,
        payeeKind: r.payeeKind,
        payer: r.payer ? String(r.payer) : undefined,
        amount: r.amount,
        platformFee: r.platformFee,
        netAmount: r.netAmount,
        currency: r.currency,
        paidAt: r.paidAt,
      }));

    const draft = buildPayoutBatch(body.kind, ledgerRows, currency);
    if (!batchBalances(draft)) {
      throw ApiError.internal('Payout batch does not balance; refusing to persist it');
    }
    if (draft.lineCount === 0) {
      throw ApiError.policy('No unclaimed settled payments match that kind, currency and window');
    }

    const batch = await PayoutBatch.create({
      kind: draft.kind,
      currency: draft.currency,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      lines: draft.lines.map((l) => ({
        payee: l.payee,
        payeeKind: l.payeeKind,
        currency: l.currency,
        sourcePayments: l.sourceIds,
        gross: l.gross,
        platformFee: l.platformFee,
        net: l.net,
        transferStatus: 'pending',
      })),
      lineCount: draft.lineCount,
      gross: draft.gross,
      platformFee: draft.platformFee,
      net: draft.net,
      skipped: draft.skipped.map((s) => ({ payment: s.id, reason: s.reason })),
      notes: body.notes,
      status: 'draft',
      createdBy: actor.userId,
    });

    return created(res, batch.toObject());
  }),
);

itemRouter.get(
  '/:batchId',
  ...backOffice,
  requirePermission('payout:read'),
  validate({ params: batchId }),
  asyncHandler(async (req, res) => {
    const doc = await PayoutBatch.findOne({ _id: req.params.batchId, deletedAt: null })
      .lean()
      .exec();
    if (!doc) throw ApiError.notFound('Payout batch');
    return ok(res, doc);
  }),
);

/**
 * Release the money.
 *
 * Founder-only, and guarded three ways: the batch must still be a draft, the
 * caller must echo the net total they are approving (so a stale screen cannot
 * release a batch that has since been rebuilt), and every transfer carries the
 * line id as its idempotency key so a retried settle does not pay twice.
 *
 * Nothing here reports `settled`. The provider returns `pending`; the batch
 * moves to `settling` and waits for the rail. Code written against a provider
 * that pretends money moves synchronously breaks on the first real one.
 */
itemRouter.post(
  '/:batchId/settle',
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance(),
  auditTrail('payoutBatch'),
  requirePermission('payout:settle'),
  validate({ params: batchId, body: settlePayoutBatchSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const { confirmNet, notes } = req.body as { confirmNet: number; notes?: string };

    const batch = await PayoutBatch.findOne({ _id: req.params.batchId, deletedAt: null }).exec();
    if (!batch) throw ApiError.notFound('Payout batch');
    if (batch.status !== 'draft' && batch.status !== 'approved') {
      throw ApiError.conflict(`A batch in status "${batch.status}" cannot be settled`);
    }
    if (money(confirmNet) !== money(batch.net)) {
      throw ApiError.conflict(
        `Batch net is ${batch.net} ${batch.currency}, not ${confirmNet}. Reload before approving.`,
      );
    }

    const provider = moneyProvider();
    const results: TransferResult[] = [];

    for (const line of batch.lines) {
      if (line.transferStatus === 'settled') {
        results.push({ ok: true, provider: provider.name, status: 'settled', deduplicated: true });
        continue;
      }
      const result = await provider.initiateTransfer({
        // The line's own id: stable across retries of this batch, unique across batches.
        idempotencyKey: String((line as unknown as { _id?: unknown })._id ?? `${batch._id}:${line.payee}`),
        rail: railFor(line.payeeKind === 'DriverProfile' ? 'mobileMoney' : undefined),
        amount: line.net,
        currency: line.currency,
        destinationRef: String(line.payee),
        beneficiaryName: line.payeeKind,
        reference: batch.reference,
      });
      results.push(result);

      line.transferStatus = result.ok ? 'processing' : 'failed';
      line.providerReference = result.providerReference;
      line.failureReason = result.ok ? undefined : (result.detail ?? result.error);
    }

    const summary = summariseTransfers(results);
    batch.status =
      summary.failed === 0 ? 'settling' : summary.accepted === 0 ? 'failed' : 'partiallySettled';
    batch.approvedBy = actor.userId as never;
    batch.approvedAt = new Date();
    if (notes) batch.notes = notes;
    batch.updatedBy = actor.userId as never;
    await batch.save();

    return ok(res, { batch: batch.toObject(), transfers: summary });
  }),
);

itemRouter.post(
  '/:batchId/cancel',
  ...backOffice,
  requirePermission('payout:update'),
  validate({ params: batchId, body: cancelPayoutBatchSchema }),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as { reason: string };
    const batch = await PayoutBatch.findOne({ _id: req.params.batchId, deletedAt: null }).exec();
    if (!batch) throw ApiError.notFound('Payout batch');
    if (batch.status !== 'draft' && batch.status !== 'approved') {
      throw ApiError.conflict(`A batch in status "${batch.status}" cannot be cancelled`);
    }

    batch.status = 'cancelled';
    batch.notes = reason;
    batch.updatedBy = req.actor!.userId as never;
    await batch.save();
    return ok(res, batch.toObject());
  }),
);

/** The lines, paged. A batch of four hundred landlords is not a single payload. */
itemRouter.get(
  '/:batchId/lines',
  ...backOffice,
  requirePermission('payout:read'),
  validate({ params: batchId, query: listQuery }),
  asyncHandler(async (req, res) => {
    const batch = await PayoutBatch.findOne({ _id: req.params.batchId, deletedAt: null })
      .lean()
      .exec();
    if (!batch) throw ApiError.notFound('Payout batch');

    const limit = Math.min(100, Number(req.query.limit ?? 25));
    const page = Math.max(1, Number(req.query.page ?? 1));
    const all = batch.lines ?? [];
    const slice = all.slice((page - 1) * limit, page * limit);
    const totalPages = Math.max(1, Math.ceil(all.length / limit));

    return paginated(res, slice, {
      page,
      limit,
      total: all.length,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    });
  }),
);

export const payoutModule = {
  collectionPath: 'payout-batches',
  itemPath: 'payout-batch',
  idParam: 'batchId',
  resource: 'payout' as const,
  service: payoutService,
  controller,
  mounts: [
    { path: 'payout-batches', router: collectionRouter },
    { path: 'payout-batch', router: itemRouter },
  ],
};

export { PayoutBatch, PAYOUT_BATCH_STATUSES } from './payout.model.js';
export type { IPayoutBatch, IPayoutLine } from './payout.model.js';
export * from './payout.validation.js';
