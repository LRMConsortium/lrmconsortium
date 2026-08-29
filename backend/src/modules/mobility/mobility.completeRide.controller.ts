import { asyncHandler, ok } from "../../shared/http.js";
import { completeRide } from "./mobility.completeRide.service.js";

export const completeRideController = asyncHandler(async (req, res) => {
  const {
    hqId,
    regionCode,
    rideCode,
    actualDistanceMiles,
    actualDurationMinutes,
  } = req.body;

  const result = await completeRide({
    hqId,
    regionCode,
    rideCode,
    actualDistanceMiles,
    actualDurationMinutes,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
