import { Router } from 'express';
import {
  ROLE_DEFINITIONS,
  ROLE_MATRIX,
  actionsForRoles,
  grantsForRoles,
} from '../../config/roles.js';
import { HQ_ZONE_DEFINITIONS } from '../../config/hqZones.js';
import {
  authRateLimit,
  auditTrail,
  authenticate,
  enterZone,
  requireFounder,
  validate,
  requireClearance,
} from '../../middleware/index.js';
import { ApiError } from '../../shared/ApiError.js';
import { asyncHandler, created, noContent, ok } from '../../shared/http.js';
import { namedIdParam } from '../../shared/moduleFactory.js';
import { User } from '../../models/User.js';
import { authService, type RegisterInput } from './auth.service.js';
import {
  assignRoleSchema,
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from './auth.validation.js';

const router = Router();

router.post(
  '/register',
  authRateLimit,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body as RegisterInput);
    return created(res, result);
  }),
);

router.post(
  '/login',
  authRateLimit,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    return ok(res, await authService.login(email, password));
  }),
);

router.post(
  '/refresh',
  authRateLimit,
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken: string };
    return ok(res, await authService.refresh(refreshToken));
  }),
);

/**
 * Sign out.
 *
 * This route was missing. The frontend called it on every sign-out, swallowed
 * the 404, and cleared local storage — so signing out looked like it worked
 * while the thirty-day refresh token stayed valid for anybody holding a copy.
 * `revocation.ts` has the full account.
 *
 * `authenticate`, not `authRateLimit`: a person may only end a session they can
 * prove they hold, and the act is recorded against them. Rate-limiting the way
 * out of the building is the wrong place for a queue.
 */
router.post(
  '/logout',
  authenticate,
  auditTrail('auth'),
  validate({ body: logoutSchema }),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    const actor = req.actor!;
    return ok(res, await authService.signOut(
      { userId: actor.userId, roles: actor.roles as string[] },
      refreshToken,
    ));
  }),
);

/**
 * The whole authorisation picture for the caller: grants, zones, actions and the
 * zone metadata each frontend needs to render its own navigation. One request
 * on app boot instead of a permission check per widget.
 */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const actor = req.actor!;
    const user = await User.findById(actor.userId).lean().exec();
    if (!user && actor.userId !== 'anonymous') throw ApiError.notFound('User');

    return ok(res, {
      user: user
        ? {
            id: String(user._id),
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            roles: user.roles,
            primaryRole: user.primaryRole,
            status: user.status,
            isVerified: user.isVerified,
            regions: user.regions,
            profiles: user.profiles,
          }
        : null,
      authorization: {
        accessScope: actor.accessScope,
        grants: actor.grants,
        allowedZones: actor.allowedZones,
        restrictedZones: actor.restrictedZones,
        allowedActions: actor.allowedActions,
      },
      zones: actor.allowedZones.map((z) => {
        const d = HQ_ZONE_DEFINITIONS[z];
        return {
          key: d.key,
          code: d.code,
          label: d.label,
          purpose: d.purpose,
          capabilities: d.capabilities,
          surfaces: d.surfaces,
        };
      }),
    });
  }),
);

router.post(
  '/change-password',
  authenticate,
  authRateLimit,
  auditTrail('user'),
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    await authService.changePassword(req.actor!.userId, currentPassword, newPassword);
    return noContent(res);
  }),
);

/** Appointment is a Founder act — Zone A only. */
router.patch(
  '/user/:userId/roles',
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance(),
  requireFounder,
  auditTrail('user'),
  validate({ params: namedIdParam('userId'), body: assignRoleSchema }),
  asyncHandler(async (req, res) => {
    const { roles, primaryRole, regions } = req.body as {
      roles: string[];
      primaryRole?: string;
      regions?: string[];
    };
    const user = await authService.assignRoles(req.params.userId!, roles, primaryRole, regions);
    return ok(res, user.toObject());
  }),
);

/** Public: the RBAC contract, so frontends can be built against it. */
router.get(
  '/roles',
  asyncHandler(async (_req, res) =>
    ok(res, {
      roles: ROLE_MATRIX,
      detail: Object.fromEntries(
        Object.entries(ROLE_DEFINITIONS).map(([role, d]) => [
          role,
          {
            accessScope: d.accessScope,
            serviceLine: d.serviceLine,
            permissions: d.permissions,
            allowedZones: d.allowedZones,
            restrictedZones: d.restrictedZones,
            allowedActions: d.allowedActions,
            requiresVerification: d.requiresVerification,
            profileModel: d.profileModel,
          },
        ]),
      ),
    }),
  ),
);

/** Debug helper: what would this role combination be able to do? */
router.get(
  '/resolve',
  authenticate,
  enterZone('FOUNDER_COMMAND_CENTER'),
  requireClearance(),
  requireFounder,
  asyncHandler(async (req, res) => {
    const roles = String(req.query.roles ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean) as never[];
    return ok(res, {
      roles,
      grants: grantsForRoles(roles),
      allowedActions: actionsForRoles(roles),
    });
  }),
);

export const authModule = { collectionPath: 'auth', mounts: [{ path: 'auth', router }] };
export { authService } from './auth.service.js';
export * from './auth.validation.js';
