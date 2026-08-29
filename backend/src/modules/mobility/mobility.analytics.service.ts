import { HQInit } from "../../models/HQInit.js";

export const getRideHistoryAndAnalytics = async ({
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

  const rides = surface.rideBookings || [];

  // Basic aggregates
  const totalRides = rides.length;
  const completedRides = rides.filter((r: any) => r.status === "COMPLETED");
  const cancelledRides = rides.filter((r: any) => r.status === "CANCELLED");

  const totalCompleted = completedRides.length;
  const totalCancelled = cancelledRides.length;

  // Revenue analytics
  const totalRevenue = completedRides.reduce(
    (sum: number, r: any) => sum + (r.finalTotal || 0),
    0
  );

  const avgRevenuePerRide =
    totalCompleted > 0 ? totalRevenue / totalCompleted : 0;

  // Distance analytics
  const totalMiles = completedRides.reduce(
    (sum: number, r: any) => sum + (r.actualDistanceMiles || 0),
    0
  );

  const avgMilesPerRide =
    totalCompleted > 0 ? totalMiles / totalCompleted : 0;

  // Duration analytics
  const totalMinutes = completedRides.reduce(
    (sum: number, r: any) => sum + (r.actualDurationMinutes || 0),
    0
  );

  const avgMinutesPerRide =
    totalCompleted > 0 ? totalMinutes / totalCompleted : 0;

  // Driver analytics
  const driverStats: Record<string, any> = {};

  surface.drivers.forEach((driver: any) => {
    const driverRides = completedRides.filter(
      (r: any) => r.assignedDriver?.driverCode === driver.driverCode
    );

    const driverRevenue = driverRides.reduce(
      (sum: number, r: any) => sum + (r.finalTotal || 0),
      0
    );

    driverStats[driver.driverCode] = {
      driverCode: driver.driverCode,
      name: driver.name,
      totalRides: driverRides.length,
      totalRevenue: driverRevenue,
      avgRevenuePerRide:
        driverRides.length > 0 ? driverRevenue / driverRides.length : 0,
    };
  });

  return {
    totalRides,
    totalCompleted,
    totalCancelled,
    totalRevenue,
    avgRevenuePerRide,
    totalMiles,
    avgMilesPerRide,
    totalMinutes,
    avgMinutesPerRide,
    driverStats,
    rideHistory: rides,
  };
};
