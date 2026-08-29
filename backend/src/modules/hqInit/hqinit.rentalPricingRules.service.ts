import { HQInit } from "../../models/HQInit.js";

export const defineRentalPricingRules = async ({
  hqId,
  regionCode,
  pricingRules,
}: {
  hqId: string;
  regionCode: string;
  pricingRules: any;
}) => {
  const hq = await HQInit.findById(hqId);
  if (!hq) {
    throw new Error("HQ not found");
  }

  const region = hq.regionStructure?.regions?.find(
    (r: any) => r.code === regionCode
  );

  if (!region) {
    throw new Error("Region not found");
  }

  if (!region.rentalSurface) {
    throw new Error("Rental surface not activated");
  }

  region.rentalSurface.rentalPricingRules = {
    ...region.rentalSurface.rentalPricingRules,
    ...pricingRules,
    updatedAt: new Date(),
  };

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
