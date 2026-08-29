import { asyncHandler, ok } from "../../shared/http.js";
import { cancelRentalBooking } from "./hqinit.cancelBooking.service.js";

export const cancelRentalBookingController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, bookingCode } = req.body;

  const result = await cancelRentalBooking({
    hqId,
    regionCode,
    bookingCode,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
