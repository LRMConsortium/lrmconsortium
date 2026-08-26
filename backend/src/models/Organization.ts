import { Schema, model, Types } from 'mongoose';

const OrganizationSchema = new Schema(
  {
    name: { type: String, required: true },
    country: { type: String, required: true },
    currency: { type: String, required: true },
    hqZone: { type: String, required: true },
    regions: [{ type: String, required: true }],
    managementFeePercent: { type: Number, required: true },
    rideCommissionPercent: { type: Number, required: true },
    branding: {
      primaryColor: String,
      secondaryColor: String,
      accentColor: String,
      logoUrl: String
    },
    locale: { type: String, required: true },
    timezone: { type: String, required: true }
  },
  { timestamps: true }
);

export const Organization = model('Organization', OrganizationSchema);
