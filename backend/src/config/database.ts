import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);

let connecting: Promise<typeof mongoose> | null = null;

export async function connectDatabase(uri: string = env.MONGO_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (connecting) return connecting;

  connecting = mongoose
    .connect(uri, {
      maxPoolSize: env.MONGO_MAX_POOL_SIZE,
      serverSelectionTimeoutMS: 10_000,
      autoIndex: !env.isProduction,
    })
    .then((m) => {
      logger.info('MongoDB connected', { host: m.connection.host, db: m.connection.name });
      return m;
    })
    .catch((err) => {
      connecting = null;
      throw err;
    });

  return connecting;
}

export async function disconnectDatabase(): Promise<void> {
  connecting = null;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  }
}

mongoose.connection.on('error', (err) => logger.error('MongoDB error', { error: String(err) }));
mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

/**
 * In production these indexes must be created by a migration, not at boot.
 * `syncIndexes` is exposed so the deploy pipeline can call it explicitly.
 *
 * ── Read this before removing the boot check below ────────────────────────
 * `autoIndex: !env.isProduction` is correct, and for four weeks it was also a
 * silent catastrophe, because nothing anywhere called this function. There was
 * no deploy pipeline to call it. So on a production box **no index existed
 * beyond `_id`** — and this codebase does not treat indexes as a performance
 * matter. It uses them as its concurrency control:
 *
 *   • the unique key on a ususu entry `(subject, group, period, kind)` is what
 *     makes a double-tapped contribution a 11000 rather than two rows, and the
 *     evidence module catches that code by name
 *   • `jti` uniqueness is what makes revoking a token twice not an error
 *   • the payment idempotency key is what stops a retried POST paying twice
 *   • two TTL indexes are the *entire* retention mechanism — the sign-out
 *     denylist and the ninety-day error-report expiry, which the security
 *     module's header presents to members as a privacy commitment
 *
 * None of that existed where it mattered. Every one of those guards is written
 * correctly, asserted correctly, and was inert in production.
 */
export async function syncIndexes(): Promise<void> {
  const names = Object.keys(mongoose.models);
  for (const name of names) {
    await mongoose.models[name]!.syncIndexes();
  }
  logger.info('Indexes synced', { models: names.length });
}

/**
 * Refuse to serve traffic on a database whose indexes were never built.
 *
 * A cheap read of one collection that must have a unique index. If it is
 * missing, the migration has not been run, and every uniqueness guarantee the
 * application relies on is absent — so the honest thing is to fail the boot
 * rather than to start and be quietly wrong about money and savings streaks.
 *
 * Deliberately *not* `syncIndexes()` at boot: that also **drops** indexes no
 * longer declared, which is not a thing two servers should race to do while
 * taking traffic. This only looks.
 */
export async function assertIndexesBuilt(): Promise<void> {
  const users = mongoose.connection.db?.collection('users');
  if (!users) throw new Error('Cannot verify indexes: no database connection');

  const indexes = await users.indexes();
  const hasEmailIndex = indexes.some(
    (i) => i.key && Object.keys(i.key).includes('email'),
  );
  if (!hasEmailIndex) {
    throw new Error(
      'The database has no index on users.email, which means the index migration has '
      + 'not been run. Every unique constraint this application uses as concurrency '
      + 'control — ususu periods, payment idempotency, token revocation — is absent. '
      + 'Run `npm run migrate` before starting.',
    );
  }
  logger.info('Index check passed', { collection: 'users', indexes: indexes.length });
}
