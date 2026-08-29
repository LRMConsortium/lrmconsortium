import { requestId, accessLog } from '../middleware/requestContext.js';
import { authenticate } from '../middleware/authenticate.js';
import { enterZone, requireFounder } from '../middleware/authorize.js';
import { requireClearance } from '../middleware/requireClearance.js';

import { getFounders, createMultipleFounders } from '../modules/founder/founder.controller.js';

import { Router } from 'express';
import { env } from '../config/env.js';
import { HQ_ZONE_SUMMARY } from '../config/hqZones.js';
import { ROLES } from '../config/roles.js';
import {
  SCOPE_TABLE,
  blueprintForRole,
  resolveBlueprint,
} from '../config/apiBlueprint.js';
import { buildOpenApiDocument } from '../config/openapi.js';
import { optionalAuthenticate } from '../middleware/index.js';
import { ok } from '../shared/http.js';
import { assertBlueprintMatchesRouters } from './blueprintCheck.js';
import { authModule } from '../modules/auth/index.js';
import { founderModule } from '../modules/founder/index.js';
import { hqExecutiveModule } from '../modules/hqExecutive/index.js';
import { backOfficeStaffModule } from '../modules/backOfficeStaff/index.js';
import { coordinatorModule } from '../modules/coordinator/index.js';
import { vendorModule } from '../modules/vendor/index.js';
import { landlordModule } from '../modules/landlord/index.js';
import { tenantModule } from '../modules/tenant/index.js';
import { airbnbHostModule } from '../modules/airbnbHost/index.js';
import { hotelModule } from '../modules/hotel/index.js';
import { resortModule } from '../modules/resort/index.js';
import { rentalCarCompanyModule } from '../modules/rentalCarCompany/index.js';
import { driverModule } from '../modules/driver/index.js';
import { riderModule } from '../modules/rider/index.js';
import { propertyModule } from '../modules/property/index.js';
import { advertiserModule, adModule, adPolicyModule } from '../modules/advertising/index.js';
import { hqModule } from '../modules/hq/index.js';
import { leaseModule } from '../modules/lease/index.js';
import { maintenanceModule } from '../modules/maintenance/index.js';
import { rideModule } from '../modules/ride/index.js';
import { paymentModule } from '../modules/payment/index.js';
import { payoutModule } from '../modules/payout/index.js';
import { notificationModule } from '../modules/notification/index.js';
import { documentModule } from '../modules/document/index.js';
import { facModule } from '../modules/fac/index.js';
import { commercialClientModule } from '../modules/commercialClient/index.js';
import { publicPortalModule } from '../modules/publicPortal/index.js';
import organizationModule from '../modules/organization/index.js';
import hqInitModule from "../modules/hqInit/index.js";
import mobilityRoutes from "../modules/mobility/mobility.routes.js";

export const MODULES = [
  authModule,

  // Organization root
  organizationModule,

  // Governance & access control
  facModule,
  
  // HQ
  founderModule,
  hqExecutiveModule,
  backOfficeStaffModule,
  hqModule,

  // LRMC residential
  landlordModule,
  tenantModule,
  coordinatorModule,
  vendorModule,
  propertyModule,

  // LRMC operations
  leaseModule,
  maintenanceModule,

  // LRMC commercial clients
  airbnbHostModule,
  hotelModule,
  resortModule,
  rentalCarCompanyModule,
  commercialClientModule,

  // Ususu mobility
  driverModule,
  riderModule,
  rideModule,

  // Cross-cutting
  paymentModule,
  payoutModule,
  notificationModule,
  documentModule,

  // Revenue
  advertiserModule,
  adModule,
  adPolicyModule,

  // Public
  publicPortalModule,
] as const;

export function buildApiRouter(): Router {
  const router = Router();

  // API index route
  router.get('/', (_req, res) => {
    ok(res, {
      platform: 'LRMC (Legacy Rental Management Consortium) + Ususu Rideshare',
      version: '1.0.0',
      environment: env.NODE_ENV,
      roles: ROLES,
      hqZones: HQ_ZONE_SUMMARY,
      endpoints: MODULES.flatMap((m) =>
        'mounts' in m ? m.mounts.map((x) => `${env.API_PREFIX}/${x.path}`) : [],
      ),
      blueprint: `${env.API_PREFIX}/_blueprint`,
      openapi: `${env.API_PREFIX}/openapi.json`,
    });
  });

  router.get(
  '/founders',
  requestId,
  accessLog,
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireFounder,
  requireClearance(),
  getFounders
);

router.post(
  '/founders',
  requestId,
  accessLog,
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireFounder,
  requireClearance(),
  createMultipleFounders
);

router.use("/hq-init", hqInitModule);

  // ⭐ Mount all modules (singular modules only)
  for (const module of MODULES) {
    if ('mounts' in module) {
      for (const mount of module.mounts) {
        router.use(`/${mount.path}`, mount.router);
      }
    }
  }
  // Blueprint drift check
  if (!env.isProduction) {
    assertBlueprintMatchesRouters(
      MODULES.flatMap((m) => ('mounts' in m ? m.mounts : [])),
      [
        { method: 'GET', path: '/' },
        { method: 'GET', path: '/_blueprint' },
        { method: 'GET', path: '/openapi.json' },
        { method: 'GET', path: '/founders' },      // added
        { method: 'POST', path: '/founders' },     // added
        { method: 'POST', path: '/hq-init/init' },
      ],
    );
  }
router.use("/mobility", mobilityRoutes);
  return router;
}

