/**
 * Model registry. Import from here rather than reaching into a module's
 * internals — it keeps cross-module reads shallow and gives migrations and
 * seeds one honest list of every collection in the platform.
 */

export { User } from './User.js';
export type { IUser, UserDocument, UserModel } from './User.js';
export { AuditLog } from './AuditLog.js';
export type { IAuditLog } from './AuditLog.js';

// HQ
export { FounderProfile } from '../modules/founder/founder.model.js';
export type { IFounderProfile } from '../modules/founder/founder.model.js';
export { HQExecutiveProfile } from '../modules/hqExecutive/hqExecutive.model.js';
export type { IHQExecutiveProfile } from '../modules/hqExecutive/hqExecutive.model.js';
export { BackOfficeStaffProfile } from '../modules/backOfficeStaff/backOfficeStaff.model.js';
export type { IBackOfficeStaffProfile } from '../modules/backOfficeStaff/backOfficeStaff.model.js';

// LRMC residential
export { LandlordProfile } from '../modules/landlord/landlord.model.js';
export type { ILandlordProfile } from '../modules/landlord/landlord.model.js';
export { TenantProfile } from '../modules/tenant/tenant.model.js';
export type { ITenantProfile } from '../modules/tenant/tenant.model.js';
export { CoordinatorProfile } from '../modules/coordinator/coordinator.model.js';
export type { ICoordinatorProfile } from '../modules/coordinator/coordinator.model.js';
export { VendorProfile } from '../modules/vendor/vendor.model.js';
export type { IVendorProfile } from '../modules/vendor/vendor.model.js';
export { Property } from '../modules/property/property.model.js';
export type { IProperty } from '../modules/property/property.model.js';

// LRMC commercial clients
export { AirbnbHostProfile } from '../modules/airbnbHost/airbnbHost.model.js';
export type { IAirbnbHostProfile } from '../modules/airbnbHost/airbnbHost.model.js';
export { HotelProfile } from '../modules/hotel/hotel.model.js';
export type { IHotelProfile } from '../modules/hotel/hotel.model.js';
export { ResortProfile } from '../modules/resort/resort.model.js';
export type { IResortProfile } from '../modules/resort/resort.model.js';
export { RentalCarCompanyProfile } from '../modules/rentalCarCompany/rentalCarCompany.model.js';
export type {
  IRentalCarCompanyProfile,
  IFleetVehicle,
} from '../modules/rentalCarCompany/rentalCarCompany.model.js';

// Ususu
export { DriverProfile } from '../modules/driver/driver.model.js';
export type { IDriverProfile } from '../modules/driver/driver.model.js';
export { RiderProfile } from '../modules/rider/rider.model.js';
export type { IRiderProfile } from '../modules/rider/rider.model.js';

// Revenue
export { AdvertiserProfile } from '../modules/advertising/advertiser.model.js';
export type { IAdvertiserProfile } from '../modules/advertising/advertiser.model.js';
export { Ad } from '../modules/advertising/ad.model.js';
export type { IAd } from '../modules/advertising/ad.model.js';
export { AdEvent } from '../modules/advertising/adEvent.model.js';
export type { IAdEvent } from '../modules/advertising/adEvent.model.js';
export { AdPolicy } from '../modules/advertising/adPolicy.model.js';
export type { IAdPolicy } from '../modules/advertising/adPolicy.model.js';

// Public portal
export { PublicContent, TrafficEvent } from '../modules/publicPortal/publicPortal.model.js';
export type { IPublicContent, ITrafficEvent } from '../modules/publicPortal/publicPortal.model.js';

// Operations
export { Lease } from '../modules/lease/lease.model.js';
export type { ILease } from '../modules/lease/lease.model.js';
export { MaintenanceRequest } from '../modules/maintenance/maintenance.model.js';
export type { IMaintenanceRequest } from '../modules/maintenance/maintenance.model.js';
export { Ride } from '../modules/ride/ride.model.js';
export type { IRide } from '../modules/ride/ride.model.js';
export { Payment } from '../modules/payment/payment.model.js';
export type { IPayment } from '../modules/payment/payment.model.js';
export { Notification, PushToken } from '../modules/notification/notification.model.js';
export type { INotification, IPushToken } from '../modules/notification/notification.model.js';
export { CommercialClient } from '../modules/commercialClient/commercialClient.model.js';
export type { ICommercialClient } from '../modules/commercialClient/commercialClient.model.js';
export { FacCode, FacAttempt, FacClearance } from '../modules/fac/fac.model.js';
export type { IFacCode, IFacAttempt, IFacClearance } from '../modules/fac/fac.model.js';
export { DocumentRecord } from '../modules/document/document.model.js';
export type { IDocument, IDocumentAuditEntry, IDocumentScore } from '../modules/document/document.model.js';
export { PayoutBatch } from '../modules/payout/payout.model.js';
export type { IPayoutBatch, IPayoutLine } from '../modules/payout/payout.model.js';
