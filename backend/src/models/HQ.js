// src/models/HQ.js
import { Schema, model } from 'mongoose';

const HQSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    founderUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    founderProfileId: { type: Schema.Types.ObjectId, ref: 'FounderProfile', required: true },

    hqCode: { type: String, required: true, unique: true },
    hqName: { type: String, required: true },

    zones: [{ type: String, required: true }],
    restrictedZones: [{ type: String, default: [] }],

    regionStructure: [
      {
        code: String,
        label: String,
        status: { type: String, default: 'active' },
      },
    ],

    surfaces: {
      rental: { enabled: Boolean, capabilities: [String], dataFirewall: [String] },
      mobility: { enabled: Boolean, capabilities: [String], dataFirewall: [String] },
      commercial: { enabled: Boolean, capabilities: [String], dataFirewall: [String] },
      advertising: { enabled: Boolean, capabilities: [String], dataFirewall: [String] },
      payment: { enabled: Boolean, capabilities: [String], dataFirewall: [String] },
    },

    auditAnchorId: { type: Schema.Types.ObjectId },
    analyticsAnchorId: { type: Schema.Types.ObjectId },

    status: { type: String, default: 'active' },
  },
  { timestamps: true },
);

export const HQ = model('HQ', HQSchema);
