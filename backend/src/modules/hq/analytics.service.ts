import mongoose from 'mongoose';
import { HQ_ZONE_SUMMARY, type HQZone } from '../../config/hqZones.js';
import { Ad } from '../advertising/ad.model.js';
import { AdEvent } from '../advertising/adEvent.model.js';
import { AdvertiserProfile } from '../advertising/advertiser.model.js';
import { AirbnbHostProfile } from '../airbnbHost/airbnbHost.model.js';
import { BackOfficeStaffProfile } from '../backOfficeStaff/backOfficeStaff.model.js';
import { CoordinatorProfile } from '../coordinator/coordinator.model.js';
import { DriverProfile } from '../driver/driver.model.js';
import { HotelProfile } from '../hotel/hotel.model.js';
import { LandlordProfile } from '../landlord/landlord.model.js';
import { Property } from '../property/property.model.js';
import { RentalCarCompanyProfile } from '../rentalCarCompany/rentalCarCompany.model.js';
import { ResortProfile } from '../resort/resort.model.js';
import { RiderProfile } from '../rider/rider.model.js';
import { TenantProfile } from '../tenant/tenant.model.js';
import { VendorProfile } from '../vendor/vendor.model.js';
import { User } from '../../models/User.js';

const live = { deletedAt: null } as const;

export interface KPISnapshot {
  generatedAt: Date;
  members: {
    landlords: number;
    tenants: number;
    coordinators: number;
    vendors: number;
    drivers: number;
    riders: number;
    total: number;
  };
  commercialClients: {
    airbnbHosts: number;
    hotels: number;
    resorts: number;
    rentalCarCompanies: number;
    total: number;
  };
  portfolio: {
    properties: number;
    occupied: number;
    vacant: number;
    occupancyRatePercent: number;
    underMaintenance: number;
    publiclyListed: number;
  };
  verification: {
    pending: number;
    inReview: number;
    verified: number;
    rejected: number;
  };
  revenue: {
    advertisers: number;
    activeAds: number;
    impressions30d: number;
    clicks30d: number;
    ctr30d: number;
  };
  staff: { backOffice: number; accounts: number };
}

const ctr = (clicks: number, impressions: number): number =>
  impressions > 0 ? Math.round((clicks / impressions) * 10_000) / 100 : 0;

/** One round trip per collection, all in parallel. Cheap enough to poll. */
export async function kpiSnapshot(): Promise<KPISnapshot> {
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [
    landlords,
    tenants,
    coordinators,
    vendors,
    drivers,
    riders,
    airbnbHosts,
    hotels,
    resorts,
    rentalCarCompanies,
    properties,
    occupied,
    vacant,
    underMaintenance,
    publiclyListed,
    advertisers,
    activeAds,
    backOffice,
    accounts,
    eventRollup,
    verificationRollup,
  ] = await Promise.all([
    LandlordProfile.countDocuments(live).exec(),
    TenantProfile.countDocuments(live).exec(),
    CoordinatorProfile.countDocuments(live).exec(),
    VendorProfile.countDocuments(live).exec(),
    DriverProfile.countDocuments(live).exec(),
    RiderProfile.countDocuments(live).exec(),
    AirbnbHostProfile.countDocuments(live).exec(),
    HotelProfile.countDocuments(live).exec(),
    ResortProfile.countDocuments(live).exec(),
    RentalCarCompanyProfile.countDocuments(live).exec(),
    Property.countDocuments(live).exec(),
    Property.countDocuments({ ...live, occupancyStatus: 'occupied' }).exec(),
    Property.countDocuments({ ...live, occupancyStatus: 'vacant' }).exec(),
    Property.countDocuments({ ...live, occupancyStatus: 'maintenance' }).exec(),
    Property.countDocuments({ ...live, listedPublicly: true }).exec(),
    AdvertiserProfile.countDocuments(live).exec(),
    Ad.countDocuments({ ...live, status: 'active' }).exec(),
    BackOfficeStaffProfile.countDocuments(live).exec(),
    User.countDocuments(live).exec(),
    AdEvent.aggregate<{ _id: string; count: number }>([
      { $match: { occurredAt: { $gte: since } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]).exec(),
    Promise.all(
      [
        LandlordProfile,
        TenantProfile,
        CoordinatorProfile,
        VendorProfile,
        DriverProfile,
        AirbnbHostProfile,
        HotelProfile,
        ResortProfile,
        RentalCarCompanyProfile,
        AdvertiserProfile,
      ].map((m) =>
        (m as unknown as typeof LandlordProfile)
          .aggregate<{ _id: string; count: number }>([
            { $match: { deletedAt: null } },
            { $group: { _id: '$verificationStatus', count: { $sum: 1 } } },
          ])
          .exec(),
      ),
    ),
  ]);

  const impressions = eventRollup.find((e) => e._id === 'impression')?.count ?? 0;
  const clicks = eventRollup.find((e) => e._id === 'click')?.count ?? 0;

  const verification = { pending: 0, inReview: 0, verified: 0, rejected: 0 };
  for (const rollup of verificationRollup) {
    for (const row of rollup) {
      if (row._id in verification) {
        verification[row._id as keyof typeof verification] += row.count;
      }
    }
  }

  return {
    generatedAt: new Date(),
    members: {
      landlords,
      tenants,
      coordinators,
      vendors,
      drivers,
      riders,
      total: landlords + tenants + coordinators + vendors + drivers + riders,
    },
    commercialClients: {
      airbnbHosts,
      hotels,
      resorts,
      rentalCarCompanies,
      total: airbnbHosts + hotels + resorts + rentalCarCompanies,
    },
    portfolio: {
      properties,
      occupied,
      vacant,
      occupancyRatePercent:
        properties > 0 ? Math.round((occupied / properties) * 1000) / 10 : 0,
      underMaintenance,
      publiclyListed,
    },
    verification,
    revenue: {
      advertisers,
      activeAds,
      impressions30d: impressions,
      clicks30d: clicks,
      ctr30d: ctr(clicks, impressions),
    },
    staff: { backOffice, accounts },
  };
}

export interface SystemHealth {
  status: 'ok' | 'degraded' | 'down';
  uptimeSeconds: number;
  database: { state: string; readyState: number; name?: string; host?: string };
  memory: { rssMB: number; heapUsedMB: number };
  node: string;
  collections: number;
  checkedAt: Date;
}

const READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'] as const;

export async function systemHealth(): Promise<SystemHealth> {
  const readyState = mongoose.connection.readyState;
  const dbUp = readyState === 1;
  const mem = process.memoryUsage();

  let collections = 0;
  if (dbUp && mongoose.connection.db) {
    try {
      collections = (await mongoose.connection.db.listCollections().toArray()).length;
    } catch {
      collections = 0;
    }
  }

  return {
    status: dbUp ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    database: {
      state: READY_STATES[readyState] ?? 'unknown',
      readyState,
      name: mongoose.connection.name,
      host: mongoose.connection.host,
    },
    memory: {
      rssMB: Math.round(mem.rss / 1048576),
      heapUsedMB: Math.round(mem.heapUsed / 1048576),
    },
    node: process.version,
    collections,
    checkedAt: new Date(),
  };
}

/** Per-region roll-up, the view HQ Executives actually steer by. */
export async function regionalPerformance(): Promise<
  { region: string; properties: number; occupied: number; coordinators: number; vendors: number; drivers: number }[]
> {
  const [byRegion, coordinators, vendors, drivers] = await Promise.all([
    Property.aggregate<{ _id: string; properties: number; occupied: number }>([
      { $match: live },
      {
        $group: {
          _id: { $ifNull: ['$region', 'unassigned'] },
          properties: { $sum: 1 },
          occupied: { $sum: { $cond: [{ $eq: ['$occupancyStatus', 'occupied'] }, 1, 0] } },
        },
      },
      { $sort: { properties: -1 } },
    ]).exec(),
    CoordinatorProfile.aggregate<{ _id: string; count: number }>([
      { $match: live },
      { $unwind: { path: '$areasCovered', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $ifNull: ['$areasCovered', 'unassigned'] }, count: { $sum: 1 } } },
    ]).exec(),
    VendorProfile.aggregate<{ _id: string; count: number }>([
      { $match: live },
      { $unwind: { path: '$areasCovered', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $ifNull: ['$areasCovered', 'unassigned'] }, count: { $sum: 1 } } },
    ]).exec(),
    DriverProfile.aggregate<{ _id: string; count: number }>([
      { $match: live },
      { $unwind: { path: '$areasCovered', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $ifNull: ['$areasCovered', 'unassigned'] }, count: { $sum: 1 } } },
    ]).exec(),
  ]);

  const lookup = (rows: { _id: string; count: number }[], region: string): number =>
    rows.find((r) => r._id === region)?.count ?? 0;

  return byRegion.map((r) => ({
    region: r._id,
    properties: r.properties,
    occupied: r.occupied,
    coordinators: lookup(coordinators, r._id),
    vendors: lookup(vendors, r._id),
    drivers: lookup(drivers, r._id),
  }));
}

export const zoneDirectory = HQ_ZONE_SUMMARY;

export function zoneDetail(zone: HQZone) {
  return HQ_ZONE_SUMMARY.find((z) => z.key === zone);
}

export const analyticsService = {
  kpiSnapshot,
  systemHealth,
  regionalPerformance,
  zoneDirectory,
  zoneDetail,
};
