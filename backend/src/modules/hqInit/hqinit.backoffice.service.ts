import { HQInit } from "../../models/HQInit.js";

export const seedBackOffice = async ({
  hqId,
  regionCode,
}: {
  hqId: string;
  regionCode: string;
}) => {
  const hq = await HQInit.findById(hqId);
  if (!hq) {
    throw new Error("HQ not found");
  }

  const region = hq.regionStructure?.regions?.find(
    (r: any) => r.code === regionCode
  );

  if (!region) {
    throw new Error("Region not found");
  }

  const backOffice = [
    {
      code: "RSS",
      title: "Rental Support Specialist",
      clearance: "BACK_OFFICE_TIER",
    },
    {
      code: "MSS",
      title: "Mobility Support Specialist",
      clearance: "BACK_OFFICE_TIER",
    },
    {
      code: "CSS",
      title: "Commercial Support Specialist",
      clearance: "BACK_OFFICE_TIER",
    },
    {
      code: "CSP",
      title: "Compliance Support Specialist",
      clearance: "BACK_OFFICE_TIER",
    },
    {
      code: "FSP",
      title: "Finance Support Specialist",
      clearance: "BACK_OFFICE_TIER",
    }
  ];

  region.backOffice = backOffice;

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
