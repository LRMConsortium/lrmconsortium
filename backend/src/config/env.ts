import dotenv from 'dotenv';
import { z } from 'zod';

import { SECRET_GENERATION_HINT, secretProblem } from './secretHygiene.js';

dotenv.config();

/**
 * Fail-fast environment contract. The process refuses to boot with a
 * half-configured environment rather than dying at the first request.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /* 4000, because that is what `deploy/nginx.conf` proxies to — in four places.
   * The default was 3000 and the example file said 3000, so a deployment that
   * took either at its word answered nothing at all: every API call a 502, with
   * both files individually correct and no error anywhere saying why.
   * `verify.ts` now reads the nginx config and fails if the two disagree. */
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  MONGO_MAX_POOL_SIZE: z.coerce.number().int().positive().default(25),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  JWT_REFRESH_SECRET: z.string().min(16).optional(),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  /**
   * Pepper for the Founder Authorisation Code.
   *
   * The FAC search space is only ~10^6. bcrypt at cost 12 is ~250ms a guess,
   * so a leaked database yields the code to anyone with a cluster and a
   * weekend. HMAC-ing the code with this secret before bcrypt makes the dump
   * useless without it — and it lives in the environment, not in Mongo, so a
   * database compromise alone is not enough.
   *
   * Losing or rotating it invalidates every existing generation. That is the
   * same failure mode as losing the code itself: a founder issues a new one.
   */
  FAC_PEPPER: z.string().min(32, 'FAC_PEPPER must be at least 32 chars').optional(),

  CORS_ORIGINS: z.string().default('*'),

  AD_DEFAULT_SLOT_COUNT: z.coerce.number().int().positive().default(3),
  AD_IMPRESSION_DEDUPE_WINDOW_SECONDS: z.coerce.number().int().nonnegative().default(30),

  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins:
    raw.CORS_ORIGINS === '*'
      ? '*'
      : raw.CORS_ORIGINS.split(',')
          .map((o) => o.trim())
          .filter(Boolean),
  jwtRefreshSecret: raw.JWT_REFRESH_SECRET ?? `${raw.JWT_SECRET}:refresh`,
  /**
   * Derived rather than required outright so `npm run dev` works unconfigured.
   * Production is a different matter — see the refusal below.
   */
  facPepper: raw.FAC_PEPPER ?? `${raw.JWT_SECRET}:fac-pepper`,
} as const;

/**
 * Production refuses to boot on a derived pepper.
 *
 * A derived one is better than none, but it means the FAC digest and the JWT
 * secret share a root: one leak compromises both. In development that is an
 * acceptable convenience; in production it is a silent downgrade of the
 * platform's most privileged credential, and a silent downgrade is exactly the
 * kind of thing nobody notices until it matters.
 */
if (env.isProduction && !raw.FAC_PEPPER) {
  throw new Error(
    `FAC_PEPPER must be set in production. Generate one with:\n${SECRET_GENERATION_HINT}`,
  );
}

/**
 * And production refuses to boot on a secret that was never replaced.
 *
 * The length rules above are satisfied by `change-me-to-a-64-char-random-string`
 * — which is the whole problem, since that string ships in `.env.example` and
 * is therefore public. Someone copying the example onto the production box gets
 * a platform whose JWT signing key is published in the repository, and nothing
 * anywhere complains.
 *
 * Checked as a batch so a misconfigured deployment learns about all of its bad
 * secrets in one boot rather than one per restart.
 */
if (env.isProduction) {
  const problems = [
    secretProblem('JWT_SECRET', raw.JWT_SECRET),
    // Only checked when supplied. An absent refresh secret is derived from
    // JWT_SECRET with a distinct suffix, which is a deliberate and long-
    // standing choice here — refusing to boot over it would break deployments
    // that are configured exactly as intended.
    raw.JWT_REFRESH_SECRET ? secretProblem('JWT_REFRESH_SECRET', raw.JWT_REFRESH_SECRET) : null,
    secretProblem('FAC_PEPPER', raw.FAC_PEPPER),
  ].filter((p): p is string => p !== null);

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with unsafe secrets:\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        `\nGenerate replacements with:\n${SECRET_GENERATION_HINT}`,
    );
  }
}

export type Env = typeof env;
