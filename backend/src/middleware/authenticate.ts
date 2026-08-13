import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import {
  actionsForRoles,
  effectiveScope,
  grantsForRoles,
  isRole,
  restrictedZonesForRoles,
  zonesForRoles,
  type Role,
} from '../config/roles.js';
import { ApiError } from '../shared/ApiError.js';
import type { AuthenticatedActor } from '../types/express.js';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  roles: Role[];
  regions?: string[];
  profileId?: string;
  organizationId?: string;
  isVerified?: boolean;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: 'lrmc',
    audience: 'lrmc-platform',
  } as jwt.SignOptions);
}

/**
 * A refresh token, with an id of its own.
 *
 * The `jti` is what makes signing out possible. Without one there is nothing to
 * write down: a stateless thirty-day token can only be revoked by revoking
 * every token the user holds, which logs them out of devices they never
 * touched. With one, `POST /auth/logout` denies exactly this session.
 *
 * `randomUUID` from `node:crypto`, never `Math.random` — a guessable id would
 * let somebody deny another person's session by writing down ids until one
 * matched.
 */
export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, typ: 'refresh', jti: randomUUID() }, env.jwtRefreshSecret, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: 'lrmc',
  } as jwt.SignOptions);
}

/**
 * Verify the signature and shape. **Does not check revocation** — that needs a
 * database read, so it lives in `auth.service.refresh`, which has one.
 *
 * `exp` rides along because a revocation is stored with the token's own expiry;
 * see `revocation.revocationExpiry`.
 */
export function verifyRefreshToken(token: string): {
  sub: string;
  jti: string | null;
  exp: number | null;
} {
  try {
    const payload = jwt.verify(token, env.jwtRefreshSecret, { issuer: 'lrmc' });
    if (typeof payload === 'string' || (payload as jwt.JwtPayload).typ !== 'refresh') {
      throw ApiError.unauthenticated('Invalid refresh token');
    }
    const claims = payload as jwt.JwtPayload;
    return {
      sub: String(claims.sub),
      /* Tokens signed before `jti` existed have none. They cannot be revoked
       * individually; they expire on their original schedule. Returning null
       * rather than inventing an id keeps that visible to the caller instead of
       * silently writing a denial for a token nobody holds. */
      jti: typeof claims.jti === 'string' && claims.jti ? claims.jti : null,
      exp: typeof claims.exp === 'number' ? claims.exp : null,
    };
  } catch {
    throw ApiError.unauthenticated('Invalid or expired refresh token');
  }
}

/** Expand token claims into the full actor: grants, zones, scope, actions. */
export function actorFromClaims(claims: AccessTokenClaims): AuthenticatedActor {
  const roles = claims.roles.filter(isRole);
  if (roles.length === 0) throw ApiError.forbidden('Token carries no recognised role');
  return {
    userId: claims.sub,
    email: claims.email,
    roles,
    primaryRole: roles[0]!,
    grants: grantsForRoles(roles),
    allowedZones: zonesForRoles(roles),
    restrictedZones: restrictedZonesForRoles(roles),
    accessScope: effectiveScope(roles),
    allowedActions: actionsForRoles(roles),
    regions: claims.regions ?? [],
    profileId: claims.profileId,
    organizationId: claims.organizationId,
    isVerified: claims.isVerified ?? false,
  };
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.accessToken;
  return cookieToken ?? null;
}

/** Hard gate: 401 unless a valid token is present. */
export const authenticate: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) return next(ApiError.unauthenticated());
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: 'lrmc',
      audience: 'lrmc-platform',
    }) as jwt.JwtPayload & AccessTokenClaims;
    req.actor = actorFromClaims({
      sub: String(payload.sub),
      email: payload.email,
      roles: payload.roles ?? [],
      regions: payload.regions,
      profileId: payload.profileId,
      organizationId: payload.organizationId,
      isVerified: payload.isVerified,
    });
    return next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    const message =
      (err as Error).name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token';
    return next(ApiError.unauthenticated(message));
  }
};

/**
 * Soft gate for the Public Portal: attaches an actor when a token is present,
 * otherwise lets the request through as an anonymous public user.
 */
export const optionalAuthenticate: RequestHandler = (req, _res, next) => {
  if (!extractToken(req)) {
    req.actor = actorFromClaims({
      sub: 'anonymous',
      email: '',
      roles: ['publicUser'],
      isVerified: false,
    });
    return next();
  }
  return authenticate(req, _res, next);
};

/** Some actions must wait for Back Office verification. */
export const requireVerified: RequestHandler = (req, _res, next) => {
  if (!req.actor) return next(ApiError.unauthenticated());
  if (req.actor.primaryRole === 'founder' || req.actor.isVerified) return next();
  return next(
    ApiError.forbidden('Your account is pending Back Office verification for this action'),
  );
};
