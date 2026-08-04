import type { RequestHandler } from 'express';
import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../config/logger.js';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Writes an immutable trail entry for every successful mutation. The Founder
 * Command Center reads this; nothing else may.
 *
 * Fire-and-forget by design: an audit write must never fail a member's rent
 * payment, but a failure is logged loudly.
 */
export function auditTrail(resource: string): RequestHandler {
  return (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();

    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      void AuditLog.create({
        actor: req.actor?.userId && req.actor.userId !== 'anonymous' ? req.actor.userId : undefined,
        actorEmail: req.actor?.email,
        actorRoles: req.actor?.roles ?? [],
        action: `${req.method} ${req.route?.path ?? req.originalUrl}`,
        resource,
        resourceId: req.params.id,
        zone: req.zone,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        requestId: req.requestId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch((err: unknown) => {
        logger.error('Audit write failed', { requestId: req.requestId, error: String(err) });
      });
    });

    next();
  };
}
