import type { Server } from 'node:http';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

let server: Server | null = null;

async function start(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  const instance: Server = app.listen(env.PORT, () => {
    logger.info('LRMC + Ususu API listening', {
      port: env.PORT,
      prefix: env.API_PREFIX,
      environment: env.NODE_ENV,
    });
  });

  // Slightly above the reverse proxy's idle timeout, so the proxy closes first.
  instance.keepAliveTimeout = 65_000;
  instance.headersTimeout = 66_000;
  server = instance;
}

/**
 * Graceful shutdown. The C4 deployment rolls one server at a time, so in-flight
 * requests must finish rather than being cut mid-transaction.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down`);
  const timeout = setTimeout(() => {
    logger.error('Forced shutdown after 15s');
    process.exit(1);
  }, 15_000);

  try {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await disconnectDatabase();
    clearTimeout(timeout);
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: String(err) });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  void shutdown('uncaughtException');
});

start().catch((err: unknown) => {
  logger.error('Failed to start server', { error: String(err) });
  process.exit(1);
});
