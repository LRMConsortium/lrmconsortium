import { asyncHandler, ok } from "../../shared/http.js";
import { createRentalBooking } from "./hqinit.rentalBooking.service.js";

export const createRentalBookingController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, booking } = req.body;

  const result = await createRentalBooking({
    hqId,
    regionCode,
    booking,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
