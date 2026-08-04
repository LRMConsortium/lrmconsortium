import { z } from 'zod';
import { VEHICLE_TYPES } from '../driver/driver.model.js';
import {
  contactCreate,
  lifecycleCreate,
  locationCreate,
  toUpdateSchema,
  zCurrency,
  zDate,
  zIdArray,
  zMoney,
  zName,
  zObjectId,
  zStringArray,
  zText,
} from '../../shared/validationFragments.js';

export const fleetVehicleInput = z
  .object({
    plate: z.string().trim().toUpperCase().min(3).max(16),
    vehicleType: z.enum(VEHICLE_TYPES),
    make: zText(80).optional(),
    model: zText(80).optional(),
    year: z.number().int().min(1970).max(new Date().getFullYear() + 1).optional(),
    color: zText(40).optional(),
    vin: zText(40).optional(),
    dailyRate: zMoney.optional(),
    currency: zCurrency.optional(),
    insuranceProvider: zText(160).optional(),
    insuranceExpiry: zDate.optional(),
    roadworthyExpiry: zDate.optional(),
    odometerKm: z.number().min(0).optional(),
    assignedDriver: zObjectId.optional(),
    availability: z.enum(['available', 'rented', 'maintenance', 'retired']).optional(),
  })
  .strict();

export const createRentalCarCompanySchema = z
  .object({
    companyName: z.string().trim().min(2).max(200),
    managerName: zName,
    ...contactCreate,
    ...locationCreate,
    ...lifecycleCreate,
    fleet: z.array(fleetVehicleInput).max(2000).optional(),
    insuranceProviders: zStringArray(40).optional(),
    maintenanceVendors: zIdArray.optional(),
    rentalRates: zText(2000).optional(),
    reportingPreferences: zText(2000).optional(),
    reportingFrequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly']).optional(),
    businessRegistrationNumber: zText(80).optional(),
    serviceTier: z.enum(['basic', 'standard', 'premium']).optional(),
    suppliesUsusu: z.boolean().optional(),
    contractStart: zDate.optional(),
    contractEnd: zDate.optional(),
  })
  .strict();

export const updateRentalCarCompanySchema = toUpdateSchema(createRentalCarCompanySchema);
