import { HQInit } from "../../models/HQInit.js";

export const seedRegionManagers = async ({
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

  const managers = [
    {
      code: "ROM",
      title: "Rental Operations Manager",
      clearance: "REGION_MANAGER_TIER",
    },
    {
      code: "MOM",
      title: "Mobility Operations Manager",
      clearance: "REGION_MANAGER_TIER",
    },
    {
      code: "COM",
      title: "Commercial Operations Manager",
      clearance: "REGION_MANAGER_TIER",
    },
    {
      code: "RCM",
      title: "Regional Compliance Manager",
      clearance: "REGION_MANAGER_TIER",
    },
    {
      code: "RFM",
      title: "Regional Finance Manager",
      clearance: "REGION_MANAGER_TIER",
    }
  ];

  region.managers = managers;

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
