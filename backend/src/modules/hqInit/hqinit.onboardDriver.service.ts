import { HQInit } from "../../models/HQInit.js";

export const onboardDriver = async ({
  hqId,
  regionCode,
  driver,
}: {
  hqId: string;
  regionCode: string;
  driver: any;
}) => {
  const hq = await HQInit.findById(hqId);
  if (!hq) throw new Error("HQ not found");

  const region = hq.regionStructure?.regions?.find(
    (r: any) => r.code === regionCode
  );
  if (!region) throw new Error("Region not found");

  const surface = region.mobilitySurface;
  if (!surface) throw new Error("Mobility surface not activated");

  surface.drivers.push({
    ...driver,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
