import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req.requestId = typeof incoming === 'string' && incoming ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

/** Structured access log with zone + role, so RBAC decisions are auditable. */
export const accessLog: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(ms * 100) / 100,
      userId: req.actor?.userId,
      role: req.actor?.primaryRole,
      zone: req.zone,
    });
  });
  next();
};

export const globalRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60_000,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});

/** Tighter bucket for credential endpoints. */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts' },
  },
});

/** Public ad-serving endpoint: high volume, low cost per call. */
export const adServeRateLimit = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
