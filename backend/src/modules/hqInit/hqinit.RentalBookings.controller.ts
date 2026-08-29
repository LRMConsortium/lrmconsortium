import { asyncHandler, ok } from "../../shared/http.js";
import { enableRentalBookings } from "./hqinit.RentalBookings.service.js";

export const enableRentalBookingsController = asyncHandler(async (req, res) => {
  const { hqId, regionCode } = req.body;

  const result = await enableRentalBookings({
    hqId,
    regionCode,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
