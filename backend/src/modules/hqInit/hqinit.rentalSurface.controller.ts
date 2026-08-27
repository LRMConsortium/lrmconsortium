import { asyncHandler, ok } from "../../shared/http.js";
import { activateRentalSurface } from "./hqinit.rentalSurface.service.js";

export const activateRentalSurfaceController = asyncHandler(async (req, res) => {
  const { hqId, regionCode } = req.body;

  const result = await activateRentalSurface({
    hqId,
    regionCode,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
