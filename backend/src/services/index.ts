/**
 * Service registry. Every module's data-access service in one place, so cron
 * jobs, seeds and cross-module logic have a stable import path.
 */

export { BaseService } from '../shared/BaseService.js';
export type { BaseServiceOptions, ListParams, ListResult } from '../shared/BaseService.js';

export { authService } from '../modules/auth/auth.service.js';
export { adEngine } from '../modules/advertising/adEngine.service.js';
export { analyticsService } from '../modules/hq/analytics.service.js';

export const profileServices = {
  get founder() {
    return import('../modules/founder/index.js').then((m) => m.founderModule.service);
  },
  get hqExecutive() {
    return import('../modules/hqExecutive/index.js').then((m) => m.hqExecutiveModule.service);
  },
  get backOfficeStaff() {
    return import('../modules/backOfficeStaff/index.js').then(
      (m) => m.backOfficeStaffModule.service,
    );
  },
  get landlord() {
    return import('../modules/landlord/index.js').then((m) => m.landlordModule.service);
  },
  get tenant() {
    return import('../modules/tenant/index.js').then((m) => m.tenantModule.service);
  },
  get coordinator() {
    return import('../modules/coordinator/index.js').then((m) => m.coordinatorModule.service);
  },
  get vendor() {
    return import('../modules/vendor/index.js').then((m) => m.vendorModule.service);
  },
  get property() {
    return import('../modules/property/index.js').then((m) => m.propertyService);
  },
  get airbnbHost() {
    return import('../modules/airbnbHost/index.js').then((m) => m.airbnbHostModule.service);
  },
  get hotel() {
    return import('../modules/hotel/index.js').then((m) => m.hotelModule.service);
  },
  get resort() {
    return import('../modules/resort/index.js').then((m) => m.resortModule.service);
  },
  get rentalCarCompany() {
    return import('../modules/rentalCarCompany/index.js').then(
      (m) => m.rentalCarCompanyModule.service,
    );
  },
  get driver() {
    return import('../modules/driver/index.js').then((m) => m.driverModule.service);
  },
  get rider() {
    return import('../modules/rider/index.js').then((m) => m.riderModule.service);
  },
  get advertiser() {
    return import('../modules/advertising/index.js').then((m) => m.advertiserModule.service);
  },
  get ad() {
    return import('../modules/advertising/index.js').then((m) => m.adService);
  },
  get publicContent() {
    return import('../modules/publicPortal/index.js').then((m) => m.contentService);
  },
};
