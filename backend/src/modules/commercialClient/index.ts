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
import { asyncHandler, ok, paginated } from '../../shared/http.js';
import { aliasIdParam, listQuery, namedIdParam } from '../../shared/moduleFactory.js';
import { Ad } from '../advertising/ad.model.js';
import { Property } from '../property/property.model.js';
import { RentalCarCompanyProfile } from '../rentalCarCompany/rentalCarCompany.model.js';
import { Lease } from '../lease/lease.model.js';
import { Payment } from '../payment/payment.model.js';
import { portfolioAnalytics } from './analytics.js';
import { CommercialClient, type ICommercialClient } from './commercialClient.model.js';
import {
  analyticsQuery,
  createCommercialClientSchema,
  updateCommercialClientSchema,
} from './commercialClient.validation.js';

export const commercialClientService = new BaseService<ICommercialClient>(CommercialClient, {
  label: 'Commercial client',
  searchableFields: ['clientName', 'primaryContactName', 'email'],
  filterableFields: ['clientKind', 'contractStatus', 'verificationStatus', 'region', 'city'],
  ownerPath: 'user',
  organizationPath: '_id',
  populate: ['accountManager'],
});

const controller = createCrudController(commercialClientService);

const collectionRouter = Router();
const itemRouter = Router();

const clientId = namedIdParam('clientId');
const aliasClient = aliasIdParam('clientId');
const backOffice = [authenticate, enterZone('BACK_OFFICE'), auditTrail('commercialClient')] as const;

collectionRouter.get(
  '/',
  ...backOffice,
  requirePermission('commercialClient:read'),
  validate({ query: listQuery }),
  controller.list,
);

collectionRouter.post(
  '/',
  ...backOffice,
  requirePermission('commercialClient:create'),
  validate({ body: createCommercialClientSchema }),
  controller.create,
);

itemRouter.get(
  '/:clientId',
  ...backOffice,
  requirePermission('commercialClient:read', 'commercialClient:readOwn'),
  validate({ params: clientId }),
  aliasClient,
  requireOwnership(commercialClientService, 'clientId'),
  controller.get,
);

itemRouter.patch(
  '/:clientId',
  ...backOffice,
  requirePermission('commercialClient:update'),
  validate({ params: clientId, body: updateCommercialClientSchema }),
  aliasClient,
  requireOwnership(commercialClientService, 'clientId'),
  controller.update,
);

/** Load a client, or 404. Shared by the three portfolio views below. */
async function loadClient(id: string): Promise<ICommercialClient> {
  const doc = await CommercialClient.findOne({ _id: id, deletedAt: null }).lean().exec();
  if (!doc) throw ApiError.notFound('Commercial client');
  return doc as unknown as ICommercialClient;
}

const portfolio = [
  authenticate,
  enterZone('BACK_OFFICE'),
  requirePermission('commercialClient:read', 'commercialClient:readOwn'),
] as const;

/**
 * Everything this client owns, across the operational profiles.
 *
 * A hospitality group's properties are spread over several hotel and resort
 * profiles; this rolls them up so the account manager sees one portfolio rather
 * than nine.
 */
itemRouter.get(
  '/:clientId/properties',
  ...portfolio,
  validate({ params: clientId, query: listQuery }),
  asyncHandler(async (req, res) => {
    const client = await loadClient(req.params.clientId!);
    const ownerIds = client.linkedProfiles.map((p) => p.profile);

    const limit = Math.min(100, Number(req.query.limit ?? 25));
    const page = Math.max(1, Number(req.query.page ?? 1));
    const filter = {
      deletedAt: null,
      $or: [
        { _id: { $in: client.linkedProperties } },
        ...(ownerIds.length ? [{ owner: { $in: ownerIds } }] : []),
      ],
    };

    const [items, total] = await Promise.all([
      Property.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit).lean().exec(),
      Property.countDocuments(filter).exec(),
    ]);
    const totalPages = Math.ceil(total / limit);
    return paginated(res, items, {
      page, limit, total, totalPages,
      hasNext: page < totalPages, hasPrev: page > 1,
    });
  }),
);

/** Every vehicle across every rental car company this client owns. */
itemRouter.get(
  '/:clientId/fleet',
  ...portfolio,
  validate({ params: clientId }),
  asyncHandler(async (req, res) => {
    const client = await loadClient(req.params.clientId!);
    const companyIds = client.linkedProfiles
      .filter((p) => p.kind === 'RentalCarCompanyProfile')
      .map((p) => p.profile);

    const companies = await RentalCarCompanyProfile.find({
      _id: { $in: companyIds },
      deletedAt: null,
    })
      .lean()
      .exec();

    const vehicles = companies.flatMap((c) =>
      (c.fleet ?? []).map((v) => ({ ...v, companyId: String(c._id), companyName: c.companyName })),
    );
    return paginated(res, vehicles, {
      page: 1, limit: vehicles.length || 1, total: vehicles.length,
      totalPages: 1, hasNext: false, hasPrev: false,
    });
  }),
);

/** Every campaign across every advertiser account this client owns. */
itemRouter.get(
  '/:clientId/ads',
  ...portfolio,
  validate({ params: clientId, query: listQuery }),
  asyncHandler(async (req, res) => {
    const client = await loadClient(req.params.clientId!);
    const advertiserIds = [
      ...client.linkedAdvertisers,
      ...client.linkedProfiles.filter((p) => p.kind === 'AdvertiserProfile').map((p) => p.profile),
    ];

    const limit = Math.min(100, Number(req.query.limit ?? 25));
    const page = Math.max(1, Number(req.query.page ?? 1));
    const filter = { advertiser: { $in: advertiserIds }, deletedAt: null };

    const [items, total] = await Promise.all([
      Ad.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit).lean().exec(),
      Ad.countDocuments(filter).exec(),
    ]);
    const totalPages = Math.ceil(total / limit);
    return paginated(res, items, {
      page, limit, total, totalPages,
      hasNext: page < totalPages, hasPrev: page > 1,
    });
  }),
);

/**
 * Portfolio KPIs for one client.
 *
 * Occupancy, revenue, fleet utilisation and campaign performance in one call,
 * plus a composite `healthScore`. The score averages only the dimensions the
 * client actually has — a landlord group with no vehicles is not marked down for
 * a utilisation rate of zero on a fleet it does not own.
 *
 * All of it reads through the same pure functions the exports use, so the
 * dashboard number and the spreadsheet number are the same number.
 */
itemRouter.get(
  '/:clientId/analytics',
  ...portfolio,
  validate({ params: clientId, query: analyticsQuery }),
  asyncHandler(async (req, res) => {
    const client = await loadClient(req.params.clientId!);
    const ownerIds = client.linkedProfiles.map((p) => p.profile);
    const advertiserIds = [
      ...client.linkedAdvertisers,
      ...client.linkedProfiles.filter((p) => p.kind === 'AdvertiserProfile').map((p) => p.profile),
    ];
    const companyIds = client.linkedProfiles
      .filter((p) => p.kind === 'RentalCarCompanyProfile')
      .map((p) => p.profile);

    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const currency = String(req.query.currency ?? 'GHS');

    const propertyFilter = {
      deletedAt: null,
      $or: [
        { _id: { $in: client.linkedProperties } },
        ...(ownerIds.length ? [{ owner: { $in: ownerIds } }] : []),
      ],
    };

    const [properties, companies, ads] = await Promise.all([
      Property.find(propertyFilter).select('occupancyStatus rentAmount rentPeriod rentCurrency region').limit(2000).lean().exec(),
      companyIds.length
        ? RentalCarCompanyProfile.find({ _id: { $in: companyIds }, deletedAt: null }).select('fleet').lean().exec()
        : Promise.resolve([]),
      advertiserIds.length
        ? Ad.find({ advertiser: { $in: advertiserIds }, deletedAt: null }).select('status spend impressions clicks').limit(2000).lean().exec()
        : Promise.resolve([]),
    ]);

    const propertyIds = properties.map((p) => p._id);
    const [leases, ledger] = await Promise.all([
      propertyIds.length
        ? Lease.find({ property: { $in: propertyIds }, deletedAt: null }).select('status monthlyRent arrearsAmount totalPaid currency').limit(2000).lean().exec()
        : Promise.resolve([]),
      Payment.find({
        deletedAt: null,
        status: 'succeeded',
        $or: [
          ...(ownerIds.length ? [{ payee: { $in: ownerIds } }] : []),
          ...(advertiserIds.length ? [{ payer: { $in: advertiserIds } }] : []),
        ],
      })
        .select('kind status amount netAmount currency paidAt')
        .limit(5000)
        .lean()
        .exec(),
    ]);

    const analytics = portfolioAnalytics({
      properties: properties.map((p) => ({
        id: String(p._id),
        occupancyStatus: p.occupancyStatus,
        rentAmount: p.rentAmount,
        rentPeriod: p.rentPeriod,
        rentCurrency: p.rentCurrency,
        region: p.region,
      })),
      leases: leases.map((l) => ({
        id: String(l._id),
        status: l.status,
        monthlyRent: l.monthlyRent,
        arrearsAmount: l.arrearsAmount,
        totalPaid: l.totalPaid,
        currency: l.currency,
      })),
      ledger: ledger.map((r) => ({
        kind: r.kind,
        status: r.status,
        amount: r.amount,
        netAmount: r.netAmount,
        currency: r.currency,
        paidAt: r.paidAt,
      })),
      fleet: companies.flatMap((c) => (c.fleet ?? []).map((v) => ({ availability: v.availability }))),
      ads: ads.map((a) => ({
        status: a.status,
        spend: a.spend,
        impressions: a.impressions,
        clicks: a.clicks,
      })),
      currency,
      from,
      to,
    });

    return ok(res, {
      clientId: String(client._id),
      clientName: client.clientName,
      clientKind: client.clientKind,
      ...analytics,
    });
  }),
);

export const commercialClientModule = {
  collectionPath: 'commercial-clients',
  itemPath: 'commercial-client',
  idParam: 'clientId',
  resource: 'commercialClient' as const,
  service: commercialClientService,
  controller,
  mounts: [
    { path: 'commercial-clients', router: collectionRouter },
    { path: 'commercial-client', router: itemRouter },
  ],
};

export { CommercialClient, CLIENT_KINDS, CONTRACT_STATUSES } from './commercialClient.model.js';
export type { ICommercialClient };
export * from './commercialClient.validation.js';
