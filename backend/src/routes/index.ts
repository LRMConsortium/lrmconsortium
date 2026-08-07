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
import {
  customerModule,
  listingModule,
  merchantModule,
  orderModule,
} from '../modules/marketplace/index.js';
import { commercialClientModule } from '../modules/commercialClient/index.js';
import { publicPortalModule } from '../modules/publicPortal/index.js';
import { viewingModule } from '../modules/viewing/index.js';
import { applicationModule } from '../modules/application/index.js';

/**
 * Single mount point for the whole API.
 *
 * Adding a module is one import and one line here — there is no other place a
 * route can be registered, which is what makes the RBAC surface auditable.
 */
export const MODULES = [
  authModule,

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

  // Marketplace
  merchantModule,
  customerModule,
  listingModule,
  orderModule,

  // Public
  publicPortalModule,
  viewingModule,
  applicationModule,
] as const;

export function buildApiRouter(): Router {
  const router = Router();

  /** API index: what exists, and what the platform's contract looks like. */
  router.get('/', (_req, res) => {
    ok(res, {
      platform: 'LRMC (Legacy Rental Management Consortium) + Ususu Rideshare',
      version: '1.0.0',
      environment: env.NODE_ENV,
      roles: ROLES,
      hqZones: HQ_ZONE_SUMMARY,
      endpoints: MODULES.flatMap((m) => m.mounts.map((x) => `${env.API_PREFIX}/${x.path}`)),
      blueprint: `${env.API_PREFIX}/_blueprint`,
      openapi: `${env.API_PREFIX}/openapi.json`,
    });
  });

  /**
   * The OpenAPI 3.1 document, built once at boot.
   *
   * Point Swagger UI, Redoc or a client generator straight at this — it is
   * produced from the same declaration the routers are mounted from, so it
   * cannot describe an endpoint that does not exist.
   */
  // No `servers` override: the live document must show the same domain
  // hierarchy as the checked-in `docs/openapi.{json,yaml}`, or the two disagree
  // about where the API lives.
  const openApiDocument = buildOpenApiDocument();

  router.get('/openapi.json', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json(openApiDocument);
  });

  /**
   * The live API contract, filtered to what the caller can actually reach.
   *
   * This is what the six PWA shells build their navigation and route guards
   * from: instead of each frontend hard-coding "hide this button unless the user
   * is backOfficeStaff", it asks the server which endpoints it may call. A role
   * change in `config/roles.ts` then propagates to every client with no frontend
   * deploy.
   */
  router.get('/_blueprint', optionalAuthenticate, (req, res) => {
    const actor = req.actor;
    const role = actor && actor.userId !== 'anonymous' ? actor.primaryRole : null;
    const all = resolveBlueprint();
    const reachable = blueprintForRole(role ?? 'publicUser');

    const wantsAll = req.query.all === 'true' && actor?.primaryRole === 'founder';
    const endpoints = wantsAll ? all : reachable;

    ok(res, {
      prefix: env.API_PREFIX,
      total: all.length,
      reachable: reachable.length,
      as: role ?? 'anonymous',
      endpoints: endpoints.map((e) => ({
        method: e.method,
        path: `${env.API_PREFIX}${e.path === '/' ? '' : e.path}`,
        module: e.module,
        summary: e.summary,
        zone: e.zone,
        auth: e.auth,
        permissions: e.permissions,
        ownership: e.ownership,
        requestBody: e.requestBody,
        requestQuery: e.requestQuery,
        responseShape: e.responseShape,
        surface: e.surface,
        ...(wantsAll ? { roles: e.roles } : {}),
      })),
      scopes: SCOPE_TABLE,
      zones: HQ_ZONE_SUMMARY,
    });
  });

  // Every module contributes one or more mounts. Profile modules contribute two
  // — the plural collection and the singular item — which is what makes the LRMC
  // convention (`/landlords` for the set, `/landlord/:landlordId` for the one)
  // fall out of the factory rather than being hand-written fourteen times.
  for (const module of MODULES) {
    for (const mount of module.mounts) {
      router.use(`/${mount.path}`, mount.router);
    }
  }

  // Loud in development, silent in production: does the declaration still match
  // what we just mounted?
  if (!env.isProduction) {
    assertBlueprintMatchesRouters(
      MODULES.flatMap((m) => m.mounts),
      [
        { method: 'GET', path: '/' },
        { method: 'GET', path: '/_blueprint' },
        { method: 'GET', path: '/openapi.json' },
      ],
    );
  }

  return router;
}
