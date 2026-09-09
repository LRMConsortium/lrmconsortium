import { asyncHandler, ok } from "../../shared/http.js";
import { fleetAnalytics } from "./fleet.analytics.service.js";

export const fleetAnalyticsController = asyncHandler(async (req, res) => {
  const { hqId, regionCode } = req.body;

  const result = await fleetAnalytics({
    hqId,
    regionCode,
  });

  ok(res, { success: true, data: result });
});
