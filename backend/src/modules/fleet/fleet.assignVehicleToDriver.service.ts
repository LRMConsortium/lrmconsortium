import { HQInit } from "../../models/HQInit.js";

export const assignVehicleToDriver = async ({
  hqId,
  regionCode,
  driverCode,
  vehicleCode,
}: {
  hqId: string;
  regionCode: string;
  driverCode: string;
  vehicleCode: string;
}) => {
  const hq = await HQInit.findById(hqId);
  if (!hq) throw new Error("HQ not found");

  const region = hq.regionStructure?.regions?.find(
    (r: any) => r.code === regionCode
  );
  if (!region) throw new Error("Region not found");

  const surface = region.mobilitySurface;

  const driver = surface.drivers.find(
    (d: any) => d.driverCode === driverCode
  );
  if (!driver) throw new Error("Driver not found");

  const vehicle = surface.fleetInventory.find(
    (v: any) => v.vehicleCode === vehicleCode
  );
  if (!vehicle) throw new Error("Vehicle not found");

  driver.assignedVehicle = {
    vehicleCode: vehicle.vehicleCode,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    plate: vehicle.plate,
  };

  vehicle.assignedDriver = driver.driverCode;
  vehicle.updatedAt = new Date();

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
