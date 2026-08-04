import { z } from 'zod';
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
  zText,
} from '../../shared/validationFragments.js';
import { CLIENT_KINDS, CONTRACT_STATUSES } from './commercialClient.model.js';

const linkedProfile = z.object({
  kind: z.enum([
    'LandlordProfile',
    'AirbnbHostProfile',
    'HotelProfile',
    'ResortProfile',
    'RentalCarCompanyProfile',
    'AdvertiserProfile',
  ]),
  profile: zObjectId,
  label: zText(160).optional(),
});

const clientFields = z
  .object({
    clientName: z.string().trim().min(2).max(200),
    clientKind: z.enum(CLIENT_KINDS),
    registrationNumber: zText(80).optional(),
    taxIdentificationNumber: zText(80).optional(),
    primaryContactName: zName,
    accountManager: zObjectId.optional(),
    ...contactCreate,
    ...locationCreate,
    ...lifecycleCreate,
    linkedProfiles: z.array(linkedProfile).max(200).optional(),
    linkedProperties: zIdArray.optional(),
    linkedAdvertisers: zIdArray.optional(),
    contractStart: zDate.optional(),
    contractEnd: zDate.optional(),
    contractStatus: z.enum(CONTRACT_STATUSES).optional(),
    contractValue: zMoney.optional(),
    currency: zCurrency.optional(),
    billingFrequency: z.enum(['monthly', 'quarterly', 'annually']).optional(),
    negotiatedFeePercent: z.number().min(0).max(100).optional(),
    slaHours: z.number().int().min(1).max(2160).optional(),
    notes: zText(4000).optional(),
  })
  .strict();

export const createCommercialClientSchema = clientFields;
export const updateCommercialClientSchema = toUpdateSchema(clientFields);

/** Window and currency for the portfolio analytics roll-up. */
export const analyticsQuery = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    currency: zCurrency.optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    message: 'to must be on or after from',
    path: ['to'],
  });
