/**
 * Build the database's indexes.
 *
 *   npm run migrate
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * `connectDatabase` sets `autoIndex: !env.isProduction`, which is right: two
 * application servers coming up together should not race to build indexes, and
 * index creation on a large collection is not something to do inside a boot
 * that a load balancer is waiting on.
 *
 * The trouble was that nothing then built them. `syncIndexes` was exported with
 * a comment saying the deploy pipeline would call it, and there was no deploy
 * pipeline. So production would have run with no index beyond `_id`.
 *
 * That is not a performance footnote in this codebase. The unique indexes *are*
 * the concurrency control:
 *
 *   • `(subject, group, period, kind)` on a ususu entry is what turns a
 *     double-tapped contribution on a bad connection into a duplicate-key error
 *     the evidence module catches by name, instead of two rows that inflate a
 *     member's savings streak
 *   • the payment idempotency key is what stops a retried POST recording rent
 *     twice
 *   • `jti` uniqueness is what makes revoking an already-revoked token a no-op
 *   • the two TTL indexes are the whole retention mechanism — the sign-out
 *     denylist, and the ninety-day expiry on error reports that the security
 *     module presents to members as a privacy commitment
 *
 * ── Run this against a copy first ─────────────────────────────────────────
 * `syncIndexes` **drops** indexes that are no longer declared in the schemas.
 * On a database that has been hand-tuned, or that is a version behind this
 * code, that is destructive. It is the right behaviour for keeping the database
 * honest to the schemas, and it is the reason this is a deliberate step run by
 * a person rather than something that happens at boot.
 */

import { connectDatabase, disconnectDatabase, syncIndexes } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

async function migrate(): Promise<void> {
  logger.info('Building indexes', { environment: env.NODE_ENV, uri: redactUri(env.MONGO_URI) });
  await connectDatabase();
  await syncIndexes();
  await disconnectDatabase();
}

/** The host and database, never the credentials. Deploy logs get read. */
function redactUri(uri: string): string {
  return uri.replace(/\/\/[^@]*@/, '//***@');
}

migrate()
  .then(() => {
    console.log('\nIndexes are built. The application will now boot in production.\n');
    process.exit(0);
  })
  .catch((err: unknown) => {
    logger.error('Index migration failed', { error: String(err) });
    console.error('\nIndexes were NOT built. Do not start the application:\n'
      + 'every uniqueness guarantee it relies on would be absent.\n');
    process.exit(1);
  });
