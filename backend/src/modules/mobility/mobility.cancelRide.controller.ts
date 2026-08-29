import { asyncHandler, ok } from "../../shared/http.js";
import { cancelRide } from "./mobility.cancelRide.service.js";

export const cancelRideController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, rideCode, reason } = req.body;

  const result = await cancelRide({
    hqId,
    regionCode,
    rideCode,
    reason,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
