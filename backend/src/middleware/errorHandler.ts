import type { ErrorRequestHandler, RequestHandler } from 'express';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError, isApiError } from '../shared/ApiError.js';
import { translateMongoError } from '../shared/BaseService.js';
import { recordObservation } from '../modules/security/index.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError('NOT_FOUND', `Route ${req.method} ${req.originalUrl} does not exist`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const translated = isApiError(err) ? err : translateMongoError(err, 'Record');
  const apiError = isApiError(translated)
    ? translated
    : ApiError.internal(env.isProduction ? 'Internal server error' : String((err as Error)?.message ?? err));

  const context = {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    status: apiError.status,
    code: apiError.code,
    userId: req.actor?.userId,
    roles: req.actor?.roles,
    zone: req.zone,
  };

  /* ── Feeding the anomaly pipeline ───────────────────────────────────────
   *
   * Here rather than at each throw site, because this is the one place that
   * sees every refusal on the platform. Wiring it per-handler would mean a
   * refusal added next month is unwatched until somebody remembers, and
   * "somebody remembers" is not a security control.
   *
   * Never throws and never blocks: `recordObservation` swallows its own
   * failures, and nothing about the response below depends on it. A fault in
   * the thing watching for faults must not become a fault in the thing it is
   * watching.
   * ────────────────────────────────────────────────────────────────────── */
  try {
    const at = Date.now();
    const address = req.ip ?? null;
    const subject = req.actor?.userId ?? null;

    if (apiError.status === 401 && /\/auth\/login$/.test(req.path)) {
      /* Keyed by address in `KEY_BY_SIGNAL`, because the attacker has no
       * account — keying this by subject would mean it never fires. */
      recordObservation({ signal: 'credentialStuffing', address, subject, at });
    } else if (apiError.status === 403) {
      /* Somebody walking the API to see what answers. A member meeting one 403
       * is ordinary; forty in ten minutes is not. */
      recordObservation({ signal: 'permissionProbing', subject, address, at });
    }
  } catch { /* never let the watcher become the fault */ }

  if (apiError.status >= 500) {
    logger.error(apiError.message, { ...context, stack: (err as Error)?.stack });
  } else {
    logger.warn(apiError.message, context);
  }

  res.status(apiError.status).json({
    success: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      details: apiError.details,
      ...(env.isProduction ? {} : { requestId: req.requestId }),
    },
  });
};
