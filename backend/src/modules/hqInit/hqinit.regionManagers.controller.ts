import { asyncHandler, ok } from "../../shared/http.js";
import { seedRegionManagers } from "./hqinit.regionManagers.service.js";

export const seedRegionManagersController = asyncHandler(async (req, res) => {
  const { hqId, regionCode } = req.body;

  const result = await seedRegionManagers({
    hqId,
    regionCode,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
