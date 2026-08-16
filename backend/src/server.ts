import type { Server } from 'node:http';
import Stripe from 'stripe';
import { createApp } from './app.js';
import { assertIndexesBuilt, connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createStripeCheckoutProvider, setCheckoutProvider } from './shared/providers/checkout.js';

let server: Server | null = null;

/**
 * The one place a Stripe client is constructed.
 *
 * The key is read from the environment and never from source. `preflight.ts`
 * already refuses a production boot whose key does not look like one, and
 * `.gitignore` keeps `.env` out of the repository; a literal here would defeat
 * both at once.
 *
 * No `apiVersion` is pinned. The SDK's types pin the version it was generated
 * against, so naming a different one is a compile error rather than a silent
 * mismatch — and naming the same one is noise that goes stale on every upgrade.
 * Pin here only to deliberately hold an older version, and expect a cast.
 *
 * Left unset, `checkoutProvider()` stays the stub that refuses. That is the
 * correct behaviour for an unconfigured deployment: `POST /order/:id/pay`
 * answers "no checkout provider is configured" instead of taking an order
 * nobody can pay for.
 */
function configureCheckout(): void {
  if (!env.STRIPE_SECRET_KEY) {
    logger.warn('No STRIPE_SECRET_KEY — checkout will refuse every payment');
    return;
  }
  setCheckoutProvider(createStripeCheckoutProvider(new Stripe(env.STRIPE_SECRET_KEY)));
  logger.info('Checkout provider configured', { provider: 'stripe' });
}

async function start(): Promise<void> {
  await connectDatabase();

  configureCheckout();

  /* Production builds no indexes at boot — correctly, since two servers should
   * not race to create them and `syncIndexes` also *drops* ones no longer
   * declared. But nothing called the migration either, so production ran with
   * no index beyond `_id` and every uniqueness guard in the codebase was inert.
   * This only looks, and refuses to serve traffic if the migration was missed. */
  if (env.isProduction) await assertIndexesBuilt();

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
