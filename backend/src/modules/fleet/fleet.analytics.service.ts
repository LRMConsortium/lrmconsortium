import { HQInit } from "../../models/HQInit.js";

export const fleetAnalytics = async ({
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

  const vehicles = surface.fleetInventory || [];

  const totalVehicles = vehicles.length;
  const activeVehicles = vehicles.filter((v: any) => v.status === "ACTIVE");
  const maintenanceVehicles = vehicles.filter(
    (v: any) => v.status === "IN_MAINTENANCE"
  );
  const outOfServiceVehicles = vehicles.filter(
    (v: any) => v.status === "OUT_OF_SERVICE"
  );

  return {
    totalVehicles,
    activeVehicles: activeVehicles.length,
    maintenanceVehicles: maintenanceVehicles.length,
    outOfServiceVehicles: outOfServiceVehicles.length,
    vehicles,
  };
};
