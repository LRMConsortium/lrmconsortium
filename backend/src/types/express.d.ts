import type { HQZone } from '../config/hqZones.js';
import type { AccessScope, Role } from '../config/roles.js';
import type { ClearanceDecision } from '../modules/fac/facRules.js';

export interface AuthenticatedActor {
  userId: string;
  email: string;
  roles: Role[];
  primaryRole: Role;
  /** Flattened permission grants from all held roles. */
  grants: string[];
  allowedZones: HQZone[];
  restrictedZones: HQZone[];
  accessScope: AccessScope;
  allowedActions: string[];
  /** Regions / HQ zones this actor is posted to (coordinators, executives). */
  regions: string[];
  /** The profile document backing this actor, when one exists. */
  profileId?: string;
  /** Organisation the actor acts for (hotel, resort, rental car company…). */
  organizationId?: string;
  isVerified: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: AuthenticatedActor;
      /** HQ zone the current route belongs to, set by `enterZone`. */
      zone?: HQZone;
      /**
       * How the FAC gate let this request through, set by `requireClearance`.
       * Recorded so the audit trail can distinguish a founder who entered a
       * code from one who used the bootstrap exemption.
       */
      facDecision?: ClearanceDecision;
      requestId?: string;
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
