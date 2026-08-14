/**
 * Viewing requests.
 *
 * One collection. Everything about *when* a slot is acceptable and *who* may
 * move a request lives in `viewingRules.ts`; this file only stores the answer.
 *
 * Two fields deserve a note before the schema:
 *
 * `localHour` is stored alongside `requestedFor`. The server runs in UTC and
 * the tenant is in The Gambia, so the hour a person meant when they said
 * "three o'clock" is not recoverable from a UTC instant without knowing their
 * offset. The client sends both; storing the local hour means a coordinator's
 * diary can be read back years later without guessing.
 *
 * `outcomeNote` is separate from `note`. The tenant writes one at request
 * time; LRMC writes the other when the viewing is over. Merging them would let
 * a coordinator's account of a no-show sit in a field the tenant authored.
 */

import { Schema, model, type Types } from 'mongoose';
import {
  baseSchemaOptions,
  type TimestampShape,
} from '../../shared/schemaFragments.js';
import { VIEWING_STATUSES } from './viewingRules.js';

export interface IViewing extends TimestampShape {
  _id: Types.ObjectId;

  property: Types.ObjectId;
  /** The User who asked. Not the TenantProfile — an applicant may not have one yet. */
  requestedBy: Types.ObjectId;
  /** Denormalised so a landlord's list does not need a join per row. */
  landlord?: Types.ObjectId;
  coordinator?: Types.ObjectId;

  requestedFor: Date;
  /** The hour the tenant meant, in their own day. See the note above. */
  localHour: number;
  /** A second choice, offered at request time. Never auto-booked. */
  alternateFor?: Date;
  alternateLocalHour?: number;

  status: (typeof VIEWING_STATUSES)[number];
  /** What the tenant said when asking. */
  note?: string;
  /** What LRMC said when answering, and afterwards. */
  decisionReason?: string;
  outcomeNote?: string;

  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  /** When the outcome was recorded — never before `requestedFor`. */
  outcomeRecordedAt?: Date;

  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date | null;
}

const viewingSchema = new Schema<IViewing>(
  {
    property: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /* Profile ids — same correction as Application, same cause: written from
     * `property.owner` and `property.assignedCoordinator`, declared as User,
     * and compared against `actor.userId` on every read. `requestedBy` above
     * stays a User: it records who asked, which is a person. */
    landlord: { type: Schema.Types.ObjectId, ref: 'LandlordProfile', index: true },
    coordinator: { type: Schema.Types.ObjectId, ref: 'CoordinatorProfile', index: true },

    requestedFor: { type: Date, required: true, index: true },
    localHour: { type: Number, required: true, min: 0, max: 23 },
    alternateFor: { type: Date },
    alternateLocalHour: { type: Number, min: 0, max: 23 },

    status: {
      type: String,
      enum: VIEWING_STATUSES,
      default: 'requested',
      required: true,
      index: true,
    },
    note: { type: String, trim: true, maxlength: 600 },
    decisionReason: { type: String, trim: true, maxlength: 600 },
    outcomeNote: { type: String, trim: true, maxlength: 600 },

    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    outcomeRecordedAt: { type: Date },

    /* The audit and soft-delete fields, taken individually. The generic
     * `lifecycleFields` block cannot be spread here: it carries its own
     * `status` with the platform-wide enum, and spreading it would replace
     * this collection's states with 'draft' | 'active' | … */
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, default: null, index: true },
  },
  { ...baseSchemaOptions('viewings'), timestamps: true },
);

/* A coordinator's morning question is "what is on today, in order". */
viewingSchema.index({ coordinator: 1, status: 1, requestedFor: 1 });
/* The open-request cap is counted per tenant, so that count must be cheap. */
viewingSchema.index({ requestedBy: 1, status: 1 });

export const Viewing = model<IViewing>('Viewing', viewingSchema);
