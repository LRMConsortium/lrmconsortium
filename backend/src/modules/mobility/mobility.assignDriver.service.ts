import { HQInit } from "../../models/HQInit.js";

export const assignDriverToRide = async ({
  hqId,
  regionCode,
  rideCode,
  driverCode,
}: {
  hqId: string;
  regionCode: string;
  rideCode: string;
  driverCode: string;
}) => {
  const hq = await HQInit.findById(hqId);
  if (!hq) throw new Error("HQ not found");

  const region = hq.regionStructure?.regions?.find(
    (r: any) => r.code === regionCode
  );
  if (!region) throw new Error("Region not found");

  const surface = region.mobilitySurface;
  if (!surface) throw new Error("Mobility surface not activated");

  const ride = surface.rideBookings.find((r: any) => r.rideCode === rideCode);
  if (!ride) throw new Error("Ride not found");

  const driver = surface.drivers.find((d: any) => d.driverCode === driverCode);
  if (!driver) throw new Error("Driver not found");

  ride.assignedDriver = {
    driverCode: driver.driverCode,
    name: driver.name,
    vehicle: driver.vehicle,
  };

  ride.status = "DRIVER_ASSIGNED";
  ride.updatedAt = new Date();

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
