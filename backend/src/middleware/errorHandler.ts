import type { ErrorRequestHandler, RequestHandler } from 'express';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError, isApiError } from '../shared/ApiError.js';
import { translateMongoError } from '../shared/BaseService.js';

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
