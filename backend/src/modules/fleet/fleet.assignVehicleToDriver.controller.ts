import { asyncHandler, ok } from "../../shared/http.js";
import { assignVehicleToDriver } from "./fleet.assignVehicleToDriver.service.js";

export const assignVehicleToDriverController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, driverCode, vehicleCode } = req.body;

  const result = await assignVehicleToDriver({
    hqId,
    regionCode,
    driverCode,
    vehicleCode,
  });

  ok(res, { success: true, data: result });
});
