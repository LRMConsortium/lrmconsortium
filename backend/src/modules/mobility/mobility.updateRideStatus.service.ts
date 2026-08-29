import { HQInit } from "../../models/HQInit.js";

export const updateRideStatus = async ({
  hqId,
  regionCode,
  rideCode,
  status,
}: {
  hqId: string;
  regionCode: string;
  rideCode: string;
  status: string;
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

  const allowedStatuses = [
    "REQUESTED",
    "DRIVER_ASSIGNED",
    "EN_ROUTE_TO_PICKUP",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
  ];

  if (!allowedStatuses.includes(status)) {
    throw new Error("Invalid ride status");
  }

  ride.status = status;
  ride.updatedAt = new Date();

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
