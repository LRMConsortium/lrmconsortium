import { asyncHandler, ok } from "../../shared/http.js";
import { activateMobilitySurface } from "./hqinit.mobilitySurface.service.js";

export const activateMobilitySurfaceController = asyncHandler(async (req, res) => {
  const { hqId, regionCode } = req.body;

  const result = await activateMobilitySurface({
    hqId,
    regionCode,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
