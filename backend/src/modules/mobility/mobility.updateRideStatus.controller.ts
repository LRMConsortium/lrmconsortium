import { asyncHandler, ok } from "../../shared/http.js";
import { updateRideStatus } from "./mobility.updateRideStatus.service.js";

export const updateRideStatusController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, rideCode, status } = req.body;

  const result = await updateRideStatus({
    hqId,
    regionCode,
    rideCode,
    status,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
