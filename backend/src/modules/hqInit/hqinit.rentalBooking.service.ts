import { HQInit } from "../../models/HQInit.js";

export const createRentalBooking = async ({
  hqId,
  regionCode,
  booking,
}: {
  hqId: string;
  regionCode: string;
  booking: any;
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

  if (!region.rentalSurface.rentalAvailability.acceptingBookings) {
    throw new Error("Bookings are not enabled");
  }

  // Ensure booking array exists
  if (!region.rentalSurface.rentalBookings) {
    region.rentalSurface.rentalBookings = [];
  }

  const newBooking = {
    ...booking,
    status: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  region.rentalSurface.rentalBookings.push(newBooking);

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
