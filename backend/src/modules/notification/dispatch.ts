/**
 * The one way anything on this platform reaches a person.
 *
 * Rent reminders, SLA escalations, ride offers and HQ broadcasts all funnel
 * through `dispatchNotification`, so every message is recorded in the member's
 * inbox *before* the provider is asked to deliver it. That order matters: a push
 * that fails should leave a notification the member can still find in the app,
 * not vanish. The provider's verdict is written back onto the same row.
 */

import { PushToken, Notification, type INotification } from './notification.model.js';
import {
  pushProvider,
  summarisePushResults,
  type PushPayload,
  type PushResult,
  type PushTarget,
} from '../../shared/providers/push.js';

export interface DispatchRequest {
  recipient: string;
  category: INotification['category'];
  channel?: INotification['channel'];
  title: string;
  body: string;
  deepLink?: string;
  subjectKind?: string;
  subject?: string;
  createdBy?: string;
}

export interface DispatchOutcome {
  notificationId: string;
  recipient: string;
  channel: string;
  /** How many device tokens the push was attempted against. */
  devices: number;
  delivered: number;
  failed: number;
  provider: string;
  status: INotification['status'];
}

/** Active tokens for one account, as provider targets. */
async function targetsFor(userId: string): Promise<PushTarget[]> {
  const tokens = await PushToken.find({ user: userId, status: 'active', deletedAt: null })
    // `token` is `select: false` — the one place it is legitimately read.
    .select('+token platform')
    .lean()
    .exec();
  return tokens.map((t) => ({ token: String(t.token), platform: t.platform }));
}

/**
 * Record, then deliver.
 *
 * `inApp` notifications never touch the provider — writing the row *is* the
 * delivery. Anything else is attempted against every active device, and a
 * partial failure still leaves the row marked `sent` rather than `failed`,
 * because one dead token on an old handset is not a failed notification.
 */
export async function dispatchNotification(request: DispatchRequest): Promise<DispatchOutcome> {
  const channel = request.channel ?? 'inApp';

  const doc = await Notification.create({
    recipient: request.recipient,
    category: request.category,
    channel,
    title: request.title,
    body: request.body,
    deepLink: request.deepLink,
    subjectKind: request.subjectKind,
    subject: request.subject,
    status: 'queued',
    createdBy: request.createdBy,
  });

  if (channel === 'inApp') {
    doc.status = 'delivered';
    doc.deliveredAt = new Date();
    await doc.save();
    return {
      notificationId: String(doc._id),
      recipient: request.recipient,
      channel,
      devices: 0,
      delivered: 1,
      failed: 0,
      provider: 'inApp',
      status: doc.status,
    };
  }

  const targets = await targetsFor(request.recipient);
  const payload: PushPayload = {
    title: request.title,
    body: request.body,
    deepLink: request.deepLink,
    category: request.category,
  };

  const results: PushResult[] =
    targets.length > 0 ? await pushProvider().sendMany(targets, payload) : [];
  const summary = summarisePushResults(results);

  // A token the provider rejects outright is retired, not retried forever.
  const dead = results
    .map((r, i) => (r.error === 'invalidToken' ? targets[i]!.token : null))
    .filter((t): t is string => t !== null);
  if (dead.length > 0) {
    await PushToken.updateMany({ token: { $in: dead } }, { $set: { status: 'revoked' } }).exec();
  }

  doc.status = targets.length === 0 ? 'queued' : summary.delivered > 0 ? 'sent' : 'failed';
  if (summary.delivered > 0) doc.deliveredAt = new Date();
  if (doc.status === 'failed') doc.failureReason = results[0]?.detail ?? results[0]?.error;
  await doc.save();

  return {
    notificationId: String(doc._id),
    recipient: request.recipient,
    channel,
    devices: targets.length,
    delivered: summary.delivered,
    failed: summary.failed,
    provider: targets.length ? summary.provider : pushProvider().name,
    status: doc.status,
  };
}

/** Roll a fan-out up into the counts a job reports back over HTTP. */
export function summariseDispatch(outcomes: DispatchOutcome[]): {
  notified: number;
  delivered: number;
  failed: number;
  devices: number;
} {
  return {
    notified: outcomes.length,
    delivered: outcomes.reduce((s, o) => s + o.delivered, 0),
    failed: outcomes.reduce((s, o) => s + o.failed, 0),
    devices: outcomes.reduce((s, o) => s + o.devices, 0),
  };
}
