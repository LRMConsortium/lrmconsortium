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

/** HQ Executive Profile — Zone B. Appointed by the Founder; reads, rarely writes. */
export interface IHQExecutiveProfile
  extends ContactShape,
    LocationShape,
    LifecycleShape,
    TimestampShape {
  _id: Types.ObjectId;
  fullName: string;
  executiveTitle: string;
  portfolio: string[];
  regionsOverseen: string[];
  serviceLinesOverseen: string[];
  zonesVisible: string[];
  reportsTo?: Types.ObjectId;
  appointedBy?: Types.ObjectId;
  appointmentDate?: Date;
  dashboardPreferences: { defaultZone?: string; pinnedKPIs: string[] };
}

const hqExecutiveProfileSchema = new Schema<IHQExecutiveProfile>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    ...contactFields,
    ...locationFields,

    executiveTitle: { type: String, required: true, trim: true },
    portfolio: { type: [String], default: [] },
    regionsOverseen: { type: [String], default: [], index: true },
    serviceLinesOverseen: { type: [String], default: ['LRMC', 'USUSU'] },
    zonesVisible: {
      type: [String],
      enum: HQ_ZONES,
      default: ['HQ_EXECUTIVE', 'BACK_OFFICE', 'MEMBER_PORTAL', 'PUBLIC_PORTAL'],
    },
    reportsTo: { type: Schema.Types.ObjectId, ref: 'FounderProfile' },
    appointedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    appointmentDate: { type: Date },
    dashboardPreferences: {
      defaultZone: { type: String, enum: HQ_ZONES, default: 'HQ_EXECUTIVE' },
      pinnedKPIs: { type: [String], default: [] },
    },

    ...lifecycleFields,
  },
  baseSchemaOptions('hq_executive_profiles'),
);

hqExecutiveProfileSchema.index({ email: 1 }, { unique: true });

export const HQExecutiveProfile = model<IHQExecutiveProfile>(
  'HQExecutiveProfile',
  hqExecutiveProfileSchema,
);
