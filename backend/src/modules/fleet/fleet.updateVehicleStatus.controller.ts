import { asyncHandler, ok } from "../../shared/http.js";
import { updateVehicleStatus } from "./fleet.updateVehicleStatus.service.js";

export const updateVehicleStatusController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, vehicleCode, status } = req.body;

  const result = await updateVehicleStatus({
    hqId,
    regionCode,
    vehicleCode,
    status,
  });

  ok(res, { success: true, data: result });
});
