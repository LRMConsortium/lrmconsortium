import { asyncHandler, ok } from "../../shared/http.js";
import { declareRegion } from "./hqinit.region.service.js";

export const declareRegionController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, regionName } = req.body;

  const result = await declareRegion({
    hqId,
    regionCode,
    regionName,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
