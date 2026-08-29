import { asyncHandler, ok } from "../../shared/http.js";
import { getRideHistoryAndAnalytics } from "./mobility.analytics.service.js";

export const rideAnalyticsController = asyncHandler(async (req, res) => {
  const { hqId, regionCode } = req.body;

  const result = await getRideHistoryAndAnalytics({
    hqId,
    regionCode,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
