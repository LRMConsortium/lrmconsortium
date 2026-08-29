import { asyncHandler, ok } from "../../shared/http.js";
import { confirmRentalBooking } from "./hqinit.confirmBooking.service.js";

export const confirmRentalBookingController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, bookingCode } = req.body;

  const result = await confirmRentalBooking({
    hqId,
    regionCode,
    bookingCode,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
