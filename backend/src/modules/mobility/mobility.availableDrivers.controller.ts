import { asyncHandler, ok } from "../../shared/http.js";
import { getAvailableDrivers } from "./mobility.availableDrivers.service.js";

export const availableDriversController = asyncHandler(async (req, res) => {
  const { hqId, regionCode } = req.body;

  const result = await getAvailableDrivers({
    hqId,
    regionCode,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
