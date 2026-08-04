import { Schema, model, type Types } from 'mongoose';
import {
  baseSchemaOptions,
  contactFields,
  identityFields,
  lifecycleFields,
  locationFields,
  ratingFields,
  verificationFields,
  type ContactShape,
  type IdentityShape,
  type LifecycleShape,
  type LocationShape,
  type RatingShape,
  type TimestampShape,
  type VerificationShape,
} from '../../shared/schemaFragments.js';

/**
 * Coordinator Profile — the LRMC field officer, owned by Back Office (Zone C).
 *
 * `areasCovered` is what confines a coordinator: it feeds `requireRegion`, so a
 * coordinator posted to Kumasi cannot read an Accra property.
 */
export interface ICoordinatorProfile
  extends ContactShape,
    IdentityShape,
    LocationShape,
    VerificationShape,
    LifecycleShape,
    RatingShape,
    TimestampShape {
  _id: Types.ObjectId;
  fullName: string;
  areasCovered: string[];
  assignedProperties: Types.ObjectId[];
  skills: string[];
  languages: string[];
  availabilitySchedule?: string;
  availabilityWindows: { day: string; from: string; to: string }[];
  completedTasks: number;
  openTasks: number;
  onTimeCompletionRate: number;
  employmentType: 'staff' | 'contract' | 'volunteer';
  startDate?: Date;
}

const availabilityWindowSchema = new Schema(
  {
    day: {
      type: String,
      enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      required: true,
    },
    from: { type: String, required: true, match: [/^\d{2}:\d{2}$/, 'Use HH:MM'] },
    to: { type: String, required: true, match: [/^\d{2}:\d{2}$/, 'Use HH:MM'] },
  },
  { _id: false },
);

const coordinatorProfileSchema = new Schema<ICoordinatorProfile>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...identityFields,
    ...locationFields,
    ...verificationFields,
    ...ratingFields,

    areasCovered: { type: [String], default: [], index: true },
    assignedProperties: [{ type: Schema.Types.ObjectId, ref: 'Property' }],
    skills: { type: [String], default: [] },
    languages: { type: [String], default: ['English'] },
    availabilitySchedule: { type: String, trim: true },
    availabilityWindows: { type: [availabilityWindowSchema], default: [] },

    completedTasks: { type: Number, min: 0, default: 0 },
    openTasks: { type: Number, min: 0, default: 0 },
    onTimeCompletionRate: { type: Number, min: 0, max: 100, default: 100 },

    employmentType: { type: String, enum: ['staff', 'contract', 'volunteer'], default: 'contract' },
    startDate: { type: Date },

    ...lifecycleFields,
  },
  baseSchemaOptions('coordinator_profiles'),
);

coordinatorProfileSchema.index({ email: 1 }, { unique: true });
coordinatorProfileSchema.index({ areasCovered: 1, verificationStatus: 1 });
coordinatorProfileSchema.index({ rating: -1, completedTasks: -1 });

export const CoordinatorProfile = model<ICoordinatorProfile>(
  'CoordinatorProfile',
  coordinatorProfileSchema,
);
