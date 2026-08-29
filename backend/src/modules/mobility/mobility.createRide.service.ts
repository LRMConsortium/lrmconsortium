import { HQInit } from "../../models/HQInit.js";

type RideBookingInput = {
  hqId: string;
  regionCode: string;
  ride: {
    rideCode: string;
    riderName: string;
    riderPhone: string;
    pickupLocation: string;
    dropoffLocation: string;
    estimatedDistanceMiles: number;
    estimatedDurationMinutes: number;
    pricing: number;
  };
};

export const createRideBooking = async ({ hqId, regionCode, ride }: RideBookingInput) => {
  const hq = await HQInit.findById(hqId);
  if (!hq) throw new Error("HQ not found");

  const region = hq.regionStructure?.regions?.find((r: { code: string }) => r.code === regionCode);
  if (!region) throw new Error("Region not found");

  const surface = region.mobilitySurface;
  if (!surface) throw new Error("Mobility surface not activated");

  const newRide = {
    rideCode: ride.rideCode,
    riderName: ride.riderName,
    riderPhone: ride.riderPhone,
    pickupLocation: ride.pickupLocation,
    dropoffLocation: ride.dropoffLocation,
    estimatedDistanceMiles: ride.estimatedDistanceMiles,
    estimatedDurationMinutes: ride.estimatedDurationMinutes,
    pricing: ride.pricing,
    assignedDriver: null,
    status: "REQUESTED",
    createdAt: new Date(),
    updatedAt: new Date()
  };

  surface.rideBookings.push(newRide);

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
