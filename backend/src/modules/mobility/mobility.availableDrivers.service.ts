import { HQInit } from "../../models/HQInit.js";

export const getAvailableDrivers = async ({
  hqId,
  regionCode,
}: {
  hqId: string;
  regionCode: string;
}) => {
  const hq = await HQInit.findById(hqId);
  if (!hq) throw new Error("HQ not found");

  const region = hq.regionStructure?.regions?.find(
    (r: any) => r.code === regionCode
  );
  if (!region) throw new Error("Region not found");

  const surface = region.mobilitySurface;
  if (!surface) throw new Error("Mobility surface not activated");

  const drivers = surface.drivers || [];

  const availableDrivers = drivers.filter(
    (d: any) =>
      d.active !== false && d.availabilityStatus === "ONLINE"
  );

  return {
    totalDrivers: drivers.length,
    availableCount: availableDrivers.length,
    availableDrivers,
  };
};
