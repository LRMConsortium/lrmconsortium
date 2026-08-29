import { HQInit } from "../../models/HQInit.js";

export const confirmRentalBooking = async ({
  hqId,
  regionCode,
  bookingCode,
}: {
  hqId: string;
  regionCode: string;
  bookingCode: string;
}) => {
  const hq = await HQInit.findById(hqId);
  if (!hq) throw new Error("HQ not found");

  const region = hq.regionStructure?.regions?.find(
    (r: any) => r.code === regionCode
  );
  if (!region) throw new Error("Region not found");

  const surface = region.rentalSurface;
  if (!surface) throw new Error("Rental surface not activated");

  const bookings = surface.rentalBookings || [];
  const booking = bookings.find((b: any) => b.bookingCode === bookingCode);

  if (!booking) throw new Error("Booking not found");

  booking.status = "CONFIRMED";
  booking.confirmedAt = new Date();
  booking.updatedAt = new Date();

  // Lock dates
  const property = surface.rentalInventory.find(
    (p: any) => p.propertyCode === booking.propertyCode
  );

  if (!property) throw new Error("Property not found");

  const start = new Date(booking.checkIn);
  const end = new Date(booking.checkOut);

  const lockedDates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    lockedDates.push(new Date(d));
  }

  property.availability.blockedDates.push(...lockedDates);

  const updatedHQ = await HQInit.findByIdAndUpdate(
    hqId,
    { $set: { regionStructure: hq.regionStructure } },
    { new: true }
  );

  return updatedHQ;
};
