import { asyncHandler, ok } from "../../shared/http.js";
import { onboardDriver } from "./hqinit.onboardDriver.service.js";

export const onboardDriverController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, driver } = req.body;

  const result = await onboardDriver({
    hqId,
    regionCode,
    driver,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
