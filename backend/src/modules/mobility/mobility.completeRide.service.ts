import { HQInit } from "../../models/HQInit.js";

export const completeRide = async ({
  hqId,
  regionCode,
  rideCode,
  actualDistanceMiles,
  actualDurationMinutes,
}: {
  hqId: string;
  regionCode: string;
  rideCode: string;
  actualDistanceMiles: number;
  actualDurationMinutes: number;
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

  const { baseFare, perMile, perMinute, surgeMultiplier } = ride.pricing;

  const finalTotal =
    (baseFare +
      actualDistanceMiles * perMile +
      actualDurationMinutes * perMinute) *
    surgeMultiplier;

  ride.status = "COMPLETED";
  ride.actualDistanceMiles = actualDistanceMiles;
  ride.actualDurationMinutes = actualDurationMinutes;
  ride.finalTotal = Number(finalTotal.toFixed(2));
  ride.completedAt = new Date();
  ride.updatedAt = new Date();

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
