import { asyncHandler, ok } from "../../shared/http.js";
import { setDriverAvailability } from "./mobility.driverAvailability.service.js";

export const setDriverAvailabilityController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, driverCode, availabilityStatus } = req.body;

  const result = await setDriverAvailability({
    hqId,
    regionCode,
    driverCode,
    availabilityStatus,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
