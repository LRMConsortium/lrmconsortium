import { HQInit } from "../../models/HQInit.js";

export const activateRentalSurface = async ({
  hqId,
  regionCode,
}: {
  hqId: string;
  regionCode: string;
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

  const rentalSurface = {
    opsStatus: "ACTIVE",
    rentalInventory: [],
    rentalPricingRules: {
      baseRate: 0,
      cleaningFee: 0,
      taxPercent: 0,
    },
    rentalAvailability: {
      acceptingUnits: true,
      acceptingBookings: false
    }
  };

  region.rentalSurface = rentalSurface;

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
