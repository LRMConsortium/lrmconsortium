import { DefaultSchemaOptions, DefaultTimestampProps, Document, FlatRecord, MergeType, Model, Schema, Types, model } from "mongoose";

const HQExecutiveSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },

    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    profileId: { type: Schema.Types.ObjectId, ref: "HQExecutiveProfile", required: true },

    hqCode: { type: String, required: true },
    role: { type: String, required: true },

    clearanceLevel: { type: String, default: "standard" },

    assignedZones: [{ type: String, default: [] }],
    assignedSurfaces: [{ type: String, default: [] }],

    status: { type: String, default: "active" },
  },
  { timestamps: true }
);

export default npmmodel("HQExecutive", HQExecutiveSchema);
function npmmodel(arg0: string, HQExecutiveSchema: Schema<any, Model<any, any, any, any, any, any>, {}, {}, {}, {}, { timestamps: true; }, { organizationId: Types.ObjectId; userId: Types.ObjectId; profileId: Types.ObjectId; hqCode: string; role: string; clearanceLevel: string; assignedZones: string[]; assignedSurfaces: string[]; status: string; } & DefaultTimestampProps, Document<unknown, {}, FlatRecord<{ organizationId: Types.ObjectId; userId: Types.ObjectId; profileId: Types.ObjectId; hqCode: string; role: string; clearanceLevel: string; assignedZones: string[]; assignedSurfaces: string[]; status: string; } & DefaultTimestampProps>, {}, MergeType<DefaultSchemaOptions, { timestamps: true; }>> & FlatRecord<{ organizationId: Types.ObjectId; userId: Types.ObjectId; profileId: Types.ObjectId; hqCode: string; role: string; clearanceLevel: string; assignedZones: string[]; assignedSurfaces: string[]; status: string; } & DefaultTimestampProps> & { _id: Types.ObjectId; } & { __v: number; }>) {
  throw new Error("Function not implemented.");
}

