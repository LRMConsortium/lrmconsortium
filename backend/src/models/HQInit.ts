import { Schema, model } from "mongoose";

const HQInitSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    hqCode: { type: String, required: true, unique: true },
    hqName: { type: String, required: true },

    // Initial zones seeded by HQInit
    zones: { type: [String], default: [] },

    // Initial surfaces seeded by HQInit
    surfaces: { type: Object, default: {} },

    // Initial region structure seeded by HQInit
    regionStructure: { type: Object, default: {} },
  },
  { timestamps: true }
);

export const HQInit = model("HQInit", HQInitSchema);
