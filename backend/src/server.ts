import type { Server } from 'node:http';
import { env } from './config/env';
import { connectDatabase } from './config/database';
import createApp from './app';

let server: Server | null = null;

async function start(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  const instance: Server = app.listen(env.PORT, () => {
    console.log(`[INFO] LRMC API listening on port ${env.PORT}`);
  });

  instance.keepAliveTimeout = 65_000;
  instance.headersTimeout = 66_000;
  server = instance;
}


async function shutdown(signal: string): Promise<void> {
  console.log(`[INFO] Received ${signal}, shutting down`);

  const timeout = setTimeout(() => {
    console.error('[ERROR] Forced shutdown after 15s');
    process.exit(1);
  }, 15_000);

  try {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((err) => (err ? reject(err) : resolve()));
    });

    clearTimeout(timeout);
    console.log('[INFO] Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[ERROR] Error during shutdown', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[ERROR] Unhandled rejection', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[ERROR] Uncaught exception', err);
  void shutdown('uncaughtException');
});

start().catch((err: unknown) => {
  console.error('[ERROR] Failed to start server', err);
  process.exit(1);
});
