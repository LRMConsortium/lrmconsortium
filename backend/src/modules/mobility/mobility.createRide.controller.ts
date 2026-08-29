import { asyncHandler, ok } from "../../shared/http.js";
import { createRideBooking } from "./mobility.createRide.service.js";

export const createRideBookingController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, ride } = req.body;

  const result = await createRideBooking({ hqId, regionCode, ride });

  ok(res, {
    success: true,
    data: result,
  });
});
