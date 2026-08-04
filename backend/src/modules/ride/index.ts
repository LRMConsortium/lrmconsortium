import { Router, type RequestHandler } from 'express';
import {
  authenticate,
  auditTrail,
  enterZone,
  requirePermission,
  validate,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { BaseService } from '../../shared/BaseService.js';
import { createCrudController } from '../../shared/BaseController.js';
import { asyncHandler, created, ok, paginated } from '../../shared/http.js';
import { aliasIdParam, listQuery, namedIdParam } from '../../shared/moduleFactory.js';
import { DriverProfile } from '../driver/driver.model.js';
import { RiderProfile } from '../rider/rider.model.js';
import { Payment } from '../payment/payment.model.js';
import { commissionSplit, DEFAULT_RIDE_COMMISSION_PERCENT } from '../payment/ledger.js';
import { dispatchNotification } from '../notification/dispatch.js';
import { Ride, canTransition, type IRide } from './ride.model.js';
import {
  rankDrivers,
  type DispatchCandidate,
  type DispatchRequest,
} from './matching.js';
import {
  acceptRideSchema,
  cancelRideSchema,
  completeRideSchema,
  requestRideSchema,
  startRideSchema,
  updateRideSchema,
} from './ride.validation.js';

export const rideService = new BaseService<IRide>(Ride, {
  label: 'Ride',
  searchableFields: ['reference', 'pickupAddress', 'dropoffAddress'],
  filterableFields: ['status', 'region', 'vehicleType', 'rider', 'driver'],
  ownerPath: 'rider',
  organizationPath: 'driver',
  defaultSort: '-requestedAt',
});

const controller = createCrudController(rideService);

const collectionRouter = Router();
const itemRouter = Router();
const driverScopedRouter = Router();
const riderScopedRouter = Router();

const rideId = namedIdParam('rideId');
const aliasRide = aliasIdParam('rideId');
const ususu = [authenticate, enterZone('MEMBER_PORTAL'), auditTrail('ride')] as const;

/** Resolve the caller's own driver or rider profile. */
async function ownProfile(
  which: 'driver' | 'rider',
  userId: string,
): Promise<{ id: string; doc: Record<string, unknown> }> {
  const model = which === 'driver' ? DriverProfile : RiderProfile;
  const doc = await model.findOne({ user: userId, deletedAt: null }).lean().exec();
  if (!doc) throw ApiError.notFound(`${which === 'driver' ? 'Driver' : 'Rider'} profile for current user`);
  return { id: String(doc._id), doc: doc as unknown as Record<string, unknown> };
}

/**
 * Move a ride through the lifecycle.
 *
 * Every transition goes through `canTransition`, which reads the state machine
 * declared alongside the model. That is what stops a completed ride being
 * accepted again, or a cancelled one being started — the rules live in one table
 * rather than in five handlers.
 */
function transition(
  to: IRide['status'],
  mutate: (
    ride: IRide,
    body: Record<string, unknown>,
    actorId: string,
    req: Parameters<RequestHandler>[0],
  ) => Record<string, unknown>,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const ride = (await Ride.findOne({ _id: req.params.rideId, deletedAt: null })
      .lean()
      .exec()) as IRide | null;
    if (!ride) throw ApiError.notFound('Ride');

    if (!canTransition(ride.status, to)) {
      throw ApiError.conflict(`A ride in status "${ride.status}" cannot move to "${to}"`);
    }

    const patch = mutate(ride, (req.body ?? {}) as Record<string, unknown>, actor.userId, req);
    const updated = await Ride.findOneAndUpdate(
      { _id: ride._id, status: ride.status },   // optimistic: status must not have moved
      { $set: { ...patch, status: to, updatedBy: actor.userId } },
      { new: true, runValidators: true },
    ).exec();

    if (!updated) throw ApiError.conflict('The ride changed status while this request was in flight');
    return ok(res, updated.toObject());
  });
}

// ── Collection ──────────────────────────────────────────────────────────────

collectionRouter.get(
  '/',
  ...ususu,
  requirePermission('ride:read', 'ride:readOwn'),
  validate({ query: listQuery }),
  controller.list,
);

/** A rider asks for a trip. Fare and driver are the server's to decide. */
collectionRouter.post(
  '/requests',
  ...ususu,
  requirePermission('ride:create'),
  validate({ body: requestRideSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const { id: riderId } = await ownProfile('rider', actor.userId);
    const body = req.body as Record<string, unknown>;

    const ride = await Ride.create({
      ...body,
      rider: riderId,
      status: 'searching',
      requestedAt: new Date(),
      createdBy: actor.userId,
    });
    return created(res, ride.toObject());
  }),
);

// ── Item ────────────────────────────────────────────────────────────────────

itemRouter.get(
  '/:rideId',
  ...ususu,
  requirePermission('ride:read', 'ride:readOwn'),
  validate({ params: rideId }),
  aliasRide,
  controller.get,
);

itemRouter.patch(
  '/:rideId',
  ...ususu,
  requirePermission('ride:update'),
  validate({ params: rideId, body: updateRideSchema }),
  aliasRide,
  controller.update,
);

itemRouter.post(
  '/:rideId/accept',
  ...ususu,
  requirePermission('ride:update', 'ride:readOwn'),
  validate({ params: rideId, body: acceptRideSchema }),
  asyncHandler(async (req, res, next) => {
    // Only a dispatchable driver may accept.
    const { doc } = await ownProfile('driver', req.actor!.userId);
    if (doc.verificationStatus !== 'verified') {
      throw ApiError.forbidden('Only a verified driver can accept a ride');
    }
    (req as unknown as { _driverId: string })._driverId = String(doc._id);
    return next();
  }),
  // The driver resolved above is written onto the ride here. Stamping
  // `acceptedAt` without `driver` would leave a ride that is accepted by nobody
  // — accepted and unassigned is not a state dispatch can act on.
  transition('accepted', (_ride, _body, _actorId, req) => ({
    acceptedAt: new Date(),
    driver: (req as unknown as { _driverId: string })._driverId,
  })),
);

itemRouter.post(
  '/:rideId/start',
  ...ususu,
  requirePermission('ride:update'),
  validate({ params: rideId, body: startRideSchema }),
  transition('inProgress', (_ride, body) => ({
    startedAt: (body.startedAt as Date | undefined) ?? new Date(),
  })),
);

/**
 * Complete the trip: stamp the fare, split the commission, and write the
 * ledger row. The `Payment` is created here rather than left to a later job,
 * because a completed ride with no payment record is an earnings dispute.
 */
itemRouter.post(
  '/:rideId/complete',
  ...ususu,
  requirePermission('ride:update'),
  validate({ params: rideId, body: completeRideSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const ride = (await Ride.findOne({ _id: req.params.rideId, deletedAt: null })
      .lean()
      .exec()) as IRide | null;
    if (!ride) throw ApiError.notFound('Ride');
    if (!canTransition(ride.status, 'completed')) {
      throw ApiError.conflict(`A ride in status "${ride.status}" cannot be completed`);
    }

    const body = req.body as { finalFare: number; currency?: string; distanceKm?: number; durationMin?: number };
    if (!ride.driver) {
      throw ApiError.conflict('A ride with no assigned driver cannot be completed');
    }

    // One split, shared with the payout batcher. The fee is rounded and the net
    // is the remainder, so gross always equals fee plus net and the ledger
    // balances to the pesewa.
    const split = commissionSplit(
      body.finalFare,
      ride.platformCommission ?? DEFAULT_RIDE_COMMISSION_PERCENT,
    );
    const platformFee = split.platformFee;
    const driverEarnings = split.net;

    const payment = await Payment.create({
      kind: 'ride',
      subjectKind: 'Ride',
      subject: ride._id,
      payer: ride.rider,
      payerKind: 'RiderProfile',
      payee: ride.driver,
      payeeKind: 'DriverProfile',
      amount: body.finalFare,
      currency: body.currency ?? ride.currency,
      method: ride.paymentMethod,
      platformFee,
      netAmount: driverEarnings,
      paidAt: new Date(),
      status: 'succeeded',
      createdBy: actor.userId,
    });

    const updated = await Ride.findOneAndUpdate(
      { _id: ride._id, status: ride.status },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          finalFare: body.finalFare,
          driverEarnings,
          payment: payment._id,
          updatedBy: actor.userId,
        },
      },
      { new: true },
    ).exec();
    if (!updated) throw ApiError.conflict('The ride changed status while this request was in flight');

    return ok(res, updated.toObject());
  }),
);

itemRouter.post(
  '/:rideId/cancel',
  ...ususu,
  requirePermission('ride:update'),
  validate({ params: rideId, body: cancelRideSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const ride = (await Ride.findOne({ _id: req.params.rideId, deletedAt: null })
      .lean()
      .exec()) as IRide | null;
    if (!ride) throw ApiError.notFound('Ride');

    const to = actor.roles.includes('driver') ? 'cancelledByDriver' : 'cancelledByRider';
    if (!canTransition(ride.status, to)) {
      throw ApiError.conflict(`A ride in status "${ride.status}" cannot be cancelled`);
    }

    const updated = await Ride.findOneAndUpdate(
      { _id: ride._id, status: ride.status },
      {
        $set: {
          status: to,
          cancelledAt: new Date(),
          cancellationReason: (req.body as { reason: string }).reason,
          updatedBy: actor.userId,
        },
      },
      { new: true },
    ).exec();
    if (!updated) throw ApiError.conflict('The ride changed status while this request was in flight');
    return ok(res, updated.toObject());
  }),
);

/**
 * Ranked driver candidates for a ride.
 *
 * Two stages: hard filters (verified, active, online with a fresh heartbeat,
 * right vehicle, in region, within radius) then a weighted score. The rejected
 * counts come back too — "no drivers found" is not actionable; "eleven
 * considered, six offline, three wrong vehicle" is.
 *
 * This is a placeholder for a real dispatch optimiser. It is a *deterministic*
 * placeholder: ties break on driver id, so the same fleet always produces the
 * same order and the ranking can be asserted.
 */
itemRouter.get(
  '/:rideId/matches',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('ride:read', 'ride:update'),
  validate({ params: rideId, query: listQuery }),
  asyncHandler(async (req, res) => {
    const ride = (await Ride.findOne({ _id: req.params.rideId, deletedAt: null })
      .lean()
      .exec()) as IRide | null;
    if (!ride) throw ApiError.notFound('Ride');

    const request: DispatchRequest = {
      vehicleType: ride.vehicleType,
      region: ride.region,
      pickupLongitude: ride.pickupLongitude,
      pickupLatitude: ride.pickupLatitude,
    };

    // Narrow in the database on the cheap, indexed predicates; apply the rest of
    // the filters in the ranker so their reasons can be reported.
    const pool = await DriverProfile.find({
      deletedAt: null,
      isOnline: true,
      vehicleType: ride.vehicleType,
    })
      .limit(200)
      .lean()
      .exec();

    const candidates: DispatchCandidate[] = pool.map((d) => ({
      id: String(d._id),
      vehicleType: d.vehicleType,
      verificationStatus: d.verificationStatus,
      status: d.status,
      isOnline: d.isOnline,
      region: d.region,
      areasCovered: d.areasCovered,
      rating: d.rating,
      ratingCount: d.ratingCount,
      acceptanceRate: d.acceptanceRate,
      completedRides: d.completedRides,
      cancelledRides: d.cancelledRides,
      longitude: d.currentLocation?.coordinates?.[0],
      latitude: d.currentLocation?.coordinates?.[1],
      lastOnlineAt: d.lastOnlineAt,
    }));

    const ranked = rankDrivers(
      candidates,
      request,
      new Date(),
      Math.min(25, Number(req.query.limit ?? 10)),
    );

    return ok(res, {
      rideId: String(ride._id),
      reference: ride.reference,
      vehicleType: ride.vehicleType,
      region: ride.region ?? null,
      considered: ranked.considered,
      matched: ranked.matches.length,
      rejected: ranked.rejected,
      matches: ranked.matches,
    });
  }),
);

// ── Member-scoped views ─────────────────────────────────────────────────────

/** Unclaimed rides a driver could take, nearest in time first. */
driverScopedRouter.get(
  '/me/dispatch-queue',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('ride:readOwn', 'ride:read'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { doc } = await ownProfile('driver', req.actor!.userId);
    if (doc.verificationStatus !== 'verified') {
      throw ApiError.forbidden('Only a verified driver can see the dispatch queue');
    }

    // Only trips this driver could actually take: their vehicle class, and a
    // region they cover. Offering a saloon driver an SUV booking is how a
    // dispatch queue trains drivers to ignore it.
    const regions = [
      ...new Set([doc.region as string | undefined, ...((doc.areasCovered as string[]) ?? [])]),
    ].filter(Boolean) as string[];

    const { items, meta } = await rideService.list({
      filters: {
        status: 'searching',
        vehicleType: doc.vehicleType as string,
        ...(regions.length ? { region: { $in: regions } } : {}),
      },
      sort: 'requestedAt',
      limit: Number(req.query.limit ?? 25),
    });
    return paginated(res, items, meta);
  }),
);

driverScopedRouter.get(
  '/me/rides',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('ride:readOwn', 'ride:read'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { id } = await ownProfile('driver', req.actor!.userId);
    const { items, meta } = await rideService.list({
      filters: { driver: id },
      limit: Number(req.query.limit ?? 20),
      page: Number(req.query.page ?? 1),
    });
    return paginated(res, items, meta);
  }),
);

riderScopedRouter.get(
  '/me/rides',
  authenticate,
  enterZone('MEMBER_PORTAL'),
  requirePermission('ride:readOwn', 'ride:read'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { id } = await ownProfile('rider', req.actor!.userId);
    const { items, meta } = await rideService.list({
      filters: { rider: id },
      limit: Number(req.query.limit ?? 20),
      page: Number(req.query.page ?? 1),
    });
    return paginated(res, items, meta);
  }),
);

export const rideModule = {
  collectionPath: 'rides',
  itemPath: 'ride',
  idParam: 'rideId',
  resource: 'ride' as const,
  service: rideService,
  controller,
  mounts: [
    { path: 'rides', router: collectionRouter },
    { path: 'ride', router: itemRouter },
    { path: 'driver', router: driverScopedRouter },
    { path: 'rider', router: riderScopedRouter },
  ],
};

export { Ride, RIDE_STATUSES, RIDE_TRANSITIONS, canTransition } from './ride.model.js';
export type { IRide };
export * from './ride.validation.js';
