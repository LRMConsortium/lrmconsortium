import { Router, type RequestHandler } from 'express';
import type { Model } from 'mongoose';
import {
  authenticate,
  enterZone,
  requireOwnership,
  requirePermission,
  validate,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { BaseService } from '../../shared/BaseService.js';
import { createCrudController } from '../../shared/BaseController.js';
import { asyncHandler, paginated } from '../../shared/http.js';
import { aliasIdParam, listQuery, namedIdParam } from '../../shared/moduleFactory.js';
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

export const paymentModule = {
  collectionPath: 'payments',
  itemPath: 'payment',
  idParam: 'paymentId',
  resource: 'payment' as const,
  service: paymentService,
  controller,
  mounts: [
    { path: 'payments', router: collectionRouter },
    { path: 'payment', router: itemRouter },
    { path: 'tenant', router: tenantRouter },
    { path: 'landlord', router: landlordRouter },
    { path: 'driver', router: driverRouter },
    { path: 'advertiser', router: advertiserRouter },
  ],
};

export { Payment, PAYMENT_KINDS, PAYMENT_STATUSES } from './payment.model.js';
export type { IPayment };
