import { HQInit } from "../../models/HQInit.js";

export const activateMobilitySurface = async ({
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

  const mobilitySurface = {
    opsStatus: "ACTIVE",
    drivers: [],
    fleetInventory: [],
    ridePricingRules: {
      baseFare: 5,
      perMile: 1.25,
      perMinute: 0.35,
      surgeMultiplier: 1.0
    },
    rideAvailability: {
      acceptingDrivers: true,
      acceptingRides: true
    },
    rideBookings: []
  };

  region.mobilitySurface = mobilitySurface;

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
