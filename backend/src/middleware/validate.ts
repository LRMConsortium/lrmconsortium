import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ApiError } from '../shared/ApiError.js';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates and *replaces* the request parts with their parsed output, so
 * controllers receive coerced, trimmed, defaulted values rather than raw
 * strings. Parsed results also land on `req.validated`.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      req.validated ??= {};
      if (schemas.params) {
        const parsed = schemas.params.parse(req.params);
        req.validated.params = parsed;
        Object.assign(req.params, parsed);
      }
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        req.validated.query = parsed;
        Object.assign(req.query, parsed as Record<string, unknown>);
      }
      if (schemas.body) {
        const parsed = schemas.body.parse(req.body);
        req.validated.body = parsed;
        req.body = parsed;
      }
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(
          ApiError.validation(
            'Request validation failed',
            err.issues.map((i) => ({
              field: i.path.join('.') || '(root)',
              message: i.message,
              code: i.code,
            })),
          ),
        );
      }
      return next(err);
    }
  };
}
