import { asyncHandler, ok } from "../../shared/http.js";
import { defineRentalPricingRules } from "./hqinit.rentalPricingRules.service.js";

export const defineRentalPricingRulesController = asyncHandler(async (req, res) => {
  const { hqId, regionCode, pricingRules } = req.body;

  const result = await defineRentalPricingRules({
    hqId,
    regionCode,
    pricingRules,
  });

  ok(res, {
    success: true,
    data: result,
  });
});
