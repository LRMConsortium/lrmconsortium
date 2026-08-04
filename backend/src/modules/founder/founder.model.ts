import { Schema, model, type Types } from 'mongoose';
import { HQ_ZONES } from '../../config/hqZones.js';
import {
  baseSchemaOptions,
  contactFields,
  lifecycleFields,
  locationFields,
  type ContactShape,
  type LifecycleShape,
  type LocationShape,
  type TimestampShape,
} from '../../shared/schemaFragments.js';

/**
 * Founder Profile — Zone A, the Founder Command Center.
 *
 * This is the constitutional record of the consortium: mission, vision, core
 * values and the founder's declared policy authority. `securityNotes` is
 * `select: false` and stripped by `toJSON`; it never leaves Zone A.
 */
export interface IFounderProfile
  extends ContactShape,
    LocationShape,
    LifecycleShape,
    TimestampShape {
  _id: Types.ObjectId;
  fullName: string;
  founderTitle: string;
  bio?: string;
  missionStatement?: string;
  visionStatement?: string;
  coreValues: string[];
  policyAuthorityLevel: 'absolute' | 'delegatedReview' | 'boardRatified';
  regionsOverseen: string[];
  serviceLinesOverseen: string[];
  systemAccessScope: 'global' | 'regional';
  commandZones: string[];
  successionContact?: string;
  securityNotes?: string;
}

const founderProfileSchema = new Schema<IFounderProfile>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...locationFields,

    founderTitle: { type: String, required: true, trim: true, default: 'Founder & Chief Custodian' },
    bio: { type: String, trim: true, maxlength: 5000 },
    missionStatement: { type: String, trim: true, maxlength: 3000 },
    visionStatement: { type: String, trim: true, maxlength: 3000 },
    coreValues: { type: [String], default: [] },

    policyAuthorityLevel: {
      type: String,
      enum: ['absolute', 'delegatedReview', 'boardRatified'],
      default: 'absolute',
    },
    regionsOverseen: { type: [String], default: [] },
    serviceLinesOverseen: { type: [String], default: ['LRMC', 'USUSU'] },
    systemAccessScope: { type: String, enum: ['global', 'regional'], default: 'global' },
    commandZones: { type: [String], enum: HQ_ZONES, default: [...HQ_ZONES] },
    successionContact: { type: String, trim: true },
    securityNotes: { type: String, trim: true, select: false },

    ...lifecycleFields,
  },
  baseSchemaOptions('founder_profiles'),
);

founderProfileSchema.index({ email: 1 }, { unique: true });

export const FounderProfile = model<IFounderProfile>('FounderProfile', founderProfileSchema);
