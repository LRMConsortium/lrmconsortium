import mongoose from 'mongoose';

const FounderProfileSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    founderTitle: { type: String, required: true },
    email: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const FounderProfile = mongoose.model('FounderProfile', FounderProfileSchema);
