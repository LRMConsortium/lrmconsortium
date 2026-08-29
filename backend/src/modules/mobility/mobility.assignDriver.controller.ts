import { asyncHandler, ok } from "../../shared/http.js";
import { assignDriverToRide } from "./mobility.assignDriver.service.js";

export const assignDriverController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, rideCode, driverCode } = req.body;

  const result = await assignDriverToRide({
    hqId,
    regionCode,
    rideCode,
    driverCode,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
