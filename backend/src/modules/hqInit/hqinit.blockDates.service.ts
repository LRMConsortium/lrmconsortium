import { HQInit } from "../../models/HQInit.js";

export const blockPropertyDates = async ({
  hqId,
  regionCode,
  propertyCode,
  startDate,
  endDate,
}: {
  hqId: string;
  regionCode: string;
  propertyCode: string;
  startDate: string;
  endDate: string;
}) => {
  const hq = await HQInit.findById(hqId);
  if (!hq) throw new Error("HQ not found");

  const region = hq.regionStructure?.regions?.find(
    (r: any) => r.code === regionCode
  );
  if (!region) throw new Error("Region not found");

  const surface = region.rentalSurface;
  if (!surface) throw new Error("Rental surface not activated");

  const property = surface.rentalInventory.find(
    (p: any) => p.propertyCode === propertyCode
  );
  if (!property) throw new Error("Property not found");

  const start = new Date(startDate);
  const end = new Date(endDate);

  const newBlockedDates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    newBlockedDates.push(new Date(d));
  }

  property.availability.blockedDates.push(...newBlockedDates);
  property.updatedAt = new Date();

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
