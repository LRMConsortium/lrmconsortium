import { HQInit } from "../../models/HQInit.js";

export const cancelRide = async ({
  hqId,
  regionCode,
  rideCode,
  reason,
}: {
  hqId: string;
  regionCode: string;
  rideCode: string;
  reason: string;
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

  ride.status = "CANCELLED";
  ride.cancellationReason = reason;
  ride.cancelledAt = new Date();
  ride.updatedAt = new Date();

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
