/**
 * One row per webhook event LRMC has seen.
 *
 * This collection *is* the idempotency guarantee. There is no transaction to
 * lean on — the database topology is unsettled and a single-node mongod has
 * none — so the guard is a unique index and the order of two writes.
 *
 * ── The sequence, and why it is this way round ────────────────────────────
 *   1. Insert the row. The unique index on `eventId` means exactly one process
 *      wins; every other delivery gets a duplicate-key error and answers 200
 *      without doing anything.
 *   2. Do the work — write the ledger, move the order.
 *   3. Stamp `appliedAt`.
 *
 * A crash between 1 and 2 leaves a claimed, unapplied row. `intakeDecision`
 * treats one older than `CLAIM_STALE_AFTER_MS` as retryable, which is the only
 * case where re-running the work is correct.
 *
 * Marking applied *first* would be simpler and wrong: any crash would then mean
 * money taken and never credited, with a row saying it had been.
 *
 * ── This is append-only, and deliberately not soft-deleted ────────────────
 * Most records on this platform are soft-deleted because the record of a thing
 * having existed is part of what LRMC owes people. This one is different in the
 * other direction: it is not a record of anything a person did, it is a latch,
 * and a soft-deleted latch is a latch that has quietly stopped latching. The
 * same reasoning as `RevokedToken`.
 */

import { Schema, model, type Types } from 'mongoose';

export const WEBHOOK_SOURCES = ['stripe'] as const;
export type WebhookSource = (typeof WEBHOOK_SOURCES)[number];

export interface ProcessedWebhookEventDoc {
  _id: Types.ObjectId;
  /** The gateway's event id. The whole point of the collection. */
  eventId: string;
  source: WebhookSource;
  type: string;
  /** When this process claimed the event. */
  claimedAt: Date;
  /** When the work finished. Absent means claimed and not yet applied. */
  appliedAt?: Date | null;
  /** The order it settled, when it settled one. For support and reconciliation. */
  order?: Types.ObjectId | null;
  /** What happened, in one line, for an operator reading the collection. */
  outcome?: string;
  createdAt: Date;
  updatedAt: Date;
}

const processedWebhookEventSchema = new Schema<ProcessedWebhookEventDoc>(
  {
    /* Unique, and this is the entire guard. Note that indexes are **not**
     * created at boot in production — `npm run migrate` builds them, and
     * `assertIndexesBuilt` refuses to serve traffic without them. Without that
     * index this collection does nothing at all and every retry pays again. */
    eventId: { type: String, required: true, unique: true, index: true },
    source: { type: String, enum: WEBHOOK_SOURCES, required: true, index: true },
    type: { type: String, required: true, index: true },
    claimedAt: { type: Date, required: true },
    appliedAt: { type: Date, default: null, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    outcome: { type: String, trim: true, maxlength: 400 },
  },
  { timestamps: true, collection: 'processedwebhookevents' },
);

/* Claimed-but-never-applied rows are the ones an operator needs to find: they
 * are the events that were taken and possibly not finished. */
processedWebhookEventSchema.index({ appliedAt: 1, claimedAt: 1 });

export const ProcessedWebhookEvent = model<ProcessedWebhookEventDoc>(
  'ProcessedWebhookEvent',
  processedWebhookEventSchema,
);
