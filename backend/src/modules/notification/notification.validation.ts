import { z } from 'zod';
import { ROLES } from '../../config/roles.js';
import { zObjectId, zText } from '../../shared/validationFragments.js';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  PUSH_PLATFORMS,
} from './notification.model.js';

export const registerPushTokenSchema = z
  .object({
    token: z.string().trim().min(8).max(512),
    platform: z.enum(PUSH_PLATFORMS),
    deviceId: zText(200).optional(),
    appVersion: zText(40).optional(),
    locale: zText(10).optional(),
  })
  .strict();

export const sendTestNotificationSchema = z
  .object({
    recipient: zObjectId,
    category: z.enum(NOTIFICATION_CATEGORIES).optional(),
    channel: z.enum(NOTIFICATION_CHANNELS).optional(),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2000),
    deepLink: zText(500).optional(),
  })
  .strict();

export const markNotificationSchema = z
  .object({
    read: z.boolean(),
  })
  .strict();

/**
 * An HQ broadcast, aimed at a role.
 *
 * `role` rather than a recipient list: the platform already knows who holds a
 * role, and a client-supplied list of user ids is both a privacy leak and a way
 * to reach someone who has since been deactivated.
 */
export const broadcastNotificationSchema = z
  .object({
    role: z.enum(ROLES),
    category: z.enum(NOTIFICATION_CATEGORIES).optional(),
    channel: z.enum(NOTIFICATION_CHANNELS).optional(),
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(3).max(2000),
    deepLink: zText(2048).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();
