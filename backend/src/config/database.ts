import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

mongoose.set('autoIndex', false);

let connecting: Promise<typeof mongoose> | null = null;

export async function connectDatabase(uri: string = env.MONGO_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (connecting) return connecting;

  connecting = mongoose
    .connect(uri, {
      autoIndex: false,
      maxPoolSize: env.MONGO_MAX_POOL_SIZE,
      serverSelectionTimeoutMS: 10_000,
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
 */
export async function syncIndexes(): Promise<void> {
  const names = Object.keys(mongoose.models);
  for (const name of names) {
    await mongoose.models[name]!.syncIndexes();
  }
  logger.info('Indexes synced', { models: names.length });
}
