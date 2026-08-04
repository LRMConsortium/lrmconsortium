import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
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
