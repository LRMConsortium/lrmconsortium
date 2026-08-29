import { asyncHandler, ok } from "../../shared/http.js";
import { blockPropertyDates } from "./hqinit.blockDates.service.js";

export const blockPropertyDatesController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, propertyCode, startDate, endDate } = req.body;

  const result = await blockPropertyDates({
    hqId,
    regionCode,
    propertyCode,
    startDate,
    endDate,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
