import { HQInit } from "../../models/HQInit.js";

export const attachFounderToHQ = async ({
  hqId,
  founderProfileId,
}: {
  hqId: string;
  founderProfileId: string;
}) => {
  // Validate founder profile exists
  const founderProfileModel = HQInit.db.models.FounderProfile;
  if (!founderProfileModel) {
    throw new Error("Founder profile model not registered");
  }

  const founder = await founderProfileModel.findById(founderProfileId);
  if (!founder) {
    throw new Error("Founder profile not found");
  }

  // Attach founder to HQ
  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    {
      $set: {
        founderProfileId,
        ownerProfileId: founderProfileId,
      },
    },
    { new: true }
  );

  if (!updatedHQ) {
    throw new Error("HQ not found");
  }

  return updatedHQ;
};
