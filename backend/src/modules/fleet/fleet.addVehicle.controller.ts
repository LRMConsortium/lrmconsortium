import { asyncHandler, ok } from "../../shared/http.js";
import { addVehicleToFleet } from "./fleet.addVehicle.service.js";

export const addVehicleController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, vehicle } = req.body;

  const result = await addVehicleToFleet({
    hqId,
    regionCode,
    vehicle,
  });

  ok(res, { success: true, data: result });
});
