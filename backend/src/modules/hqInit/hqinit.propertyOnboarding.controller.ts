import { asyncHandler, ok } from "../../shared/http.js";
import { onboardProperty } from "./hqinit.propertyOnboarding.service.js";

export const onboardPropertyController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, property } = req.body;

  const result = await onboardProperty({
    hqId,
    regionCode,
    property,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
