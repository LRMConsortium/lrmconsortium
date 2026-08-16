import compression from 'compression';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { accessLog, globalRateLimit, requestId } from './middleware/requestContext.js';
import { buildApiRouter } from './routes/index.js';
import { ok } from './shared/http.js';

export function createApp(): Express {
  const app = express();

  // Behind the C4 servers' reverse proxy, so client IPs come from X-Forwarded-For.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Ad creatives and property photos are served from object storage.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: env.isProduction ? undefined : false,
    }),
  );

  app.use(
    cors({
      origin: env.corsOrigins === '*' ? true : env.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  app.use(compression());

  /* ── The webhook keeps its raw bytes ──────────────────────────────────────
   * Stripe signs the body byte for byte. `express.json` parses and discards
   * those bytes, and `JSON.stringify(req.body)` is not them — key order,
   * whitespace and unicode escaping all differ — so a signature check run
   * against a re-serialised body fails for *correct* payloads.
   *
   * That failure is the dangerous one, because the obvious way to make it stop
   * is to weaken the check. Mounted before the JSON parser so the raw body
   * survives, and only for this one path.
   *
   * The matcher is a wildcard rather than a content type. Stripe sends
   * `application/json`, but a proxy that rewrites or drops that header would
   * otherwise route the request to the JSON parser instead, and the signature
   * would then fail for a reason invisible from the code. */
  /* The sandbox's trimmed express types stub the module down to `json` and
   * `urlencoded`. `raw` is part of express 4 proper; cast locally rather than
   * widening the suite's typecheck filter. */
  const rawBody = (express as unknown as {
    raw(o: { type: string; limit: string }): RequestHandler;
  }).raw({ type: '*/*', limit: '1mb' });
  app.use(`${env.API_PREFIX}/payments/webhooks/stripe`, rawBody);

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(requestId);
  app.use(accessLog);

  // Liveness / readiness probes sit outside the rate limiter and the API prefix.
  app.get('/healthz', (_req, res) => {
    ok(res, { status: 'ok', service: 'lrmc-api', environment: env.NODE_ENV });
  });

  app.use(env.API_PREFIX, globalRateLimit, buildApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
