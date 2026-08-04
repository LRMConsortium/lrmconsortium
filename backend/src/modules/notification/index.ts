import { Router } from 'express';
import {
  authenticate,
  auditTrail,
  enterZone,
  requirePermission,
  requireRole,
  validate,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { BaseService } from '../../shared/BaseService.js';
import { createCrudController } from '../../shared/BaseController.js';
import { asyncHandler, created, ok, paginated } from '../../shared/http.js';
import { aliasIdParam, listQuery, namedIdParam } from '../../shared/moduleFactory.js';
import { Notification, PushToken, type INotification } from './notification.model.js';
import {
  markNotificationSchema,
  registerPushTokenSchema,
  sendTestNotificationSchema,
  broadcastNotificationSchema,
} from './notification.validation.js';
import { dispatchNotification, summariseDispatch, type DispatchOutcome } from './dispatch.js';
import { looksLikeToken, pushProvider } from '../../shared/providers/push.js';
import { User } from '../../models/User.js';

export const notificationService = new BaseService<INotification>(Notification, {
  label: 'Notification',
  searchableFields: ['title', 'body'],
  filterableFields: ['category', 'channel', 'status', 'recipient'],
  ownerPath: 'recipient',
  defaultSort: '-createdAt',
});

const controller = createCrudController(notificationService);

const collectionRouter = Router();
const itemRouter = Router();

const notificationId = namedIdParam('notificationId');
const member = [authenticate, enterZone('MEMBER_PORTAL')] as const;

/**
 * Register a device for push.
 *
 * Upsert on the token itself, not on (user, device): the same physical device
 * can be handed to a different driver, and the token is what the push provider
 * addresses. Re-registering simply re-points it and refreshes `lastSeenAt`.
 */
collectionRouter.post(
  '/register-token',
  ...member,
  auditTrail('notification'),
  validate({ body: registerPushTokenSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as {
      token: string;
      platform: string;
      deviceId?: string;
      appVersion?: string;
      locale?: string;
    };

    if (!looksLikeToken(body.token)) {
      throw ApiError.validation('That does not look like a push token', [
        { field: 'token', message: 'must be at least 16 non-whitespace characters' },
      ]);
    }

    const doc = await PushToken.findOneAndUpdate(
      { token: body.token },
      {
        $set: {
          user: actor.userId,
          platform: body.platform,
          deviceId: body.deviceId,
          appVersion: body.appVersion,
          locale: body.locale,
          lastSeenAt: new Date(),
          status: 'active',
          updatedBy: actor.userId,
        },
        $setOnInsert: { createdBy: actor.userId },
      },
      { new: true, upsert: true, runValidators: true },
    ).exec();

    // The token itself is never echoed back — it is a capability to reach a phone.
    const { token: _omit, ...safe } = doc.toObject() as Record<string, unknown>;
    return created(res, safe);
  }),
);

/** The caller's own inbox. */
collectionRouter.get(
  '/me',
  ...member,
  requirePermission('notification:readOwn', 'notification:read'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { items, meta } = await notificationService.list({
      filters: { recipient: req.actor!.userId },
      limit: Number(req.query.limit ?? 25),
      page: Number(req.query.page ?? 1),
    });
    return paginated(res, items, meta);
  }),
);

/**
 * HQ-only test send. Exists so an operator can prove the pipe works end to end
 * without waiting for a real rent reminder to fall due.
 */
collectionRouter.post(
  '/test',
  authenticate,
  enterZone('HQ_EXECUTIVE'),
  requireRole('founder', 'hqExecutive'),
  requirePermission('notification:create'),
  auditTrail('notification'),
  validate({ body: sendTestNotificationSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as {
      recipient: string;
      category?: string;
      channel?: string;
      title: string;
      body: string;
      deepLink?: string;
    };

    const outcome = await dispatchNotification({
      recipient: body.recipient,
      category: (body.category ?? 'system') as never,
      channel: (body.channel ?? 'push') as never,
      title: body.title,
      body: body.body,
      deepLink: body.deepLink,
      createdBy: actor.userId,
    });

    return created(res, { ...outcome, provider: pushProvider().name });
  }),
);

/**
 * HQ broadcast to a role.
 *
 * Zone B, and deliberately capped: a broadcast is a blunt instrument, and an
 * unbounded one aimed at every rider on the platform is an outage with a
 * friendly name. The cap is reported in the response rather than silently
 * applied, so an operator can see they reached 500 of 4,000 and schedule the
 * rest instead of assuming everyone got it.
 */
collectionRouter.post(
  '/broadcast',
  authenticate,
  enterZone('HQ_EXECUTIVE'),
  requireRole('founder', 'hqExecutive'),
  requirePermission('notification:create'),
  auditTrail('notification'),
  validate({ body: broadcastNotificationSchema }),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const body = req.body as {
      role: string;
      category?: string;
      channel?: string;
      title: string;
      body: string;
      deepLink?: string;
      limit?: number;
      dryRun?: boolean;
    };
    const limit = Math.min(body.limit ?? 500, 2000);

    const recipients = await User.find({ roles: body.role, status: 'active', deletedAt: null })
      .select('_id')
      .limit(limit + 1)
      .lean()
      .exec();
    const truncated = recipients.length > limit;
    const targets = recipients.slice(0, limit);

    if (body.dryRun) {
      return ok(res, {
        role: body.role,
        dryRun: true,
        audience: targets.length,
        truncated,
        notified: 0,
        delivered: 0,
        failed: 0,
        devices: 0,
        provider: pushProvider().name,
      });
    }

    const outcomes: DispatchOutcome[] = [];
    for (const user of targets) {
      outcomes.push(
        await dispatchNotification({
          recipient: String(user._id),
          category: (body.category ?? 'system') as never,
          channel: (body.channel ?? 'inApp') as never,
          title: body.title,
          body: body.body,
          deepLink: body.deepLink,
          createdBy: actor.userId,
        }),
      );
    }

    return ok(res, {
      role: body.role,
      dryRun: false,
      audience: targets.length,
      truncated,
      ...summariseDispatch(outcomes),
      provider: pushProvider().name,
    });
  }),
);

/** Mark one notification read or unread. */
itemRouter.patch(
  '/:notificationId',
  ...member,
  auditTrail('notification'),
  requirePermission('notification:updateOwn', 'notification:readOwn'),
  validate({ params: notificationId, body: markNotificationSchema }),
  aliasIdParam('notificationId'),
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const { read } = req.body as { read: boolean };
    const doc = await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, recipient: actor.userId, deletedAt: null },
      { $set: { readAt: read ? new Date() : null, status: read ? 'read' : 'delivered' } },
      { new: true },
    ).exec();
    if (!doc) throw ApiError.notFound('Notification');
    return ok(res, doc.toObject());
  }),
);

export const notificationModule = {
  collectionPath: 'notifications',
  itemPath: 'notification',
  idParam: 'notificationId',
  resource: 'notification' as const,
  service: notificationService,
  controller,
  mounts: [
    { path: 'notifications', router: collectionRouter },
    { path: 'notification', router: itemRouter },
  ],
};

export {
  Notification,
  PushToken,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  PUSH_PLATFORMS,
} from './notification.model.js';
export type { INotification, IPushToken } from './notification.model.js';
export * from './notification.validation.js';
