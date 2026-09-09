import { HQInit } from "../../models/HQInit.js";

export const updateVehicleStatus = async ({
  hqId,
  regionCode,
  vehicleCode,
  status,
}: {
  hqId: string;
  regionCode: string;
  vehicleCode: string;
  status: "ACTIVE" | "IN_MAINTENANCE" | "OUT_OF_SERVICE";
}) => {
  const hq = await HQInit.findById(hqId);
  if (!hq) throw new Error("HQ not found");

  const region = hq.regionStructure?.regions?.find(
    (r: any) => r.code === regionCode
  );
  if (!region) throw new Error("Region not found");

  const surface = region.mobilitySurface;

  const vehicle = surface.fleetInventory.find(
    (v: any) => v.vehicleCode === vehicleCode
  );
  if (!vehicle) throw new Error("Vehicle not found");

  vehicle.status = status;
  vehicle.updatedAt = new Date();

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
