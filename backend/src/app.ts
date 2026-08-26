import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import express, { Express } from 'express';

import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { accessLog, globalRateLimit, requestId } from './middleware/requestContext.js';
import { buildApiRouter } from './routes/index.js';
import { ok } from './shared/http.js';

import healthRoute from "./routes/public/health.route.js";
import bootstrapFounderRoute from "./routes/auth/bootstrapFounder.route.js";

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(`${env.API_PREFIX}/health`, healthRoute);

  app.use(
    helmet({
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

  app.get('/healthz', (_req, res) => {
    ok(res, { status: 'ok', service: 'lrmc-api', environment: env.NODE_ENV });
  });

  app.use(env.API_PREFIX, globalRateLimit, buildApiRouter());
  app.use(`${env.API_PREFIX}/auth/bootstrap-founder`, bootstrapFounderRoute);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
