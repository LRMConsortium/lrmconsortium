/**
 * Everything that must be true before a release touches the running process.
 *
 *   npm run preflight
 *
 * Run by `deploy/release.sh` before it builds anything, and safe to run by hand
 * at any time. It reads configuration and makes no changes.
 *
 * ── Why this exists as well as the boot refusals ──────────────────────────
 * `env.ts` already refuses to start on a missing market, an undecided market or
 * a placeholder secret. Those refusals are correct and they arrive **too late**:
 * by the time the process refuses, the release script has already swapped the
 * symlink, and the operator is looking at a stopped service rather than a
 * message about a missing variable.
 *
 * So the same questions are asked before anything moves, plus the ones a single
 * process cannot ask at all — which are the interesting ones.
 *
 * ── The check that only exists because there are two markets ──────────────
 * The US pilot and the Gambia launch are separate deployments with separate
 * databases, separate Stripe keys and separate domains. Nothing in either
 * process can tell whether the *other* one is pointed at the same database,
 * because neither knows the other exists.
 *
 * A shared `MONGO_URI` would not crash. It would merge two jurisdictions'
 * tenants into one collection, sum dalasi and dollars in every aggregate, and
 * do it quietly. A shared `STRIPE_WEBHOOK_SECRET` would let Casper's gateway
 * settle Banjul's orders. Both are copy-paste mistakes — the most likely kind,
 * because the second `.env` is always made from the first.
 *
 * This is the one place both files can be read at once, so this is where that
 * question gets asked.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MARKET_IDS, marketFor, marketProblems, type MarketId } from '../config/markets.js';
import { secretProblem } from '../config/secretHygiene.js';

interface Problem {
  severity: 'fatal' | 'warning';
  message: string;
}

const problems: Problem[] = [];
const fatal = (message: string) => problems.push({ severity: 'fatal', message });
const warn = (message: string) => problems.push({ severity: 'warning', message });

/** `.env` as a map. Not a parser — a reader of `KEY=value` lines. */
function readEnvFile(path: string): Record<string, string> | null {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const REQUIRED = [
  'NODE_ENV', 'PORT', 'LRMC_MARKET', 'MONGO_URI',
  'JWT_SECRET', 'FAC_PEPPER', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
];

function checkOne(marketId: string, env: Record<string, string>): void {
  const where = `[${marketId}]`;

  for (const key of REQUIRED) {
    if (!env[key]) fatal(`${where} ${key} is not set.`);
  }

  if (env.LRMC_MARKET && env.LRMC_MARKET !== marketId) {
    fatal(`${where} LRMC_MARKET says "${env.LRMC_MARKET}". A file named for one market `
      + 'configuring another is how the pilot\'s settings reach Banjul.');
  }
  if (env.NODE_ENV !== 'production') {
    warn(`${where} NODE_ENV is "${env.NODE_ENV}". The boot refusals only run in production.`);
  }

  /* The same hygiene rule the process enforces, asked before the swap. */
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'FAC_PEPPER']) {
    if (!env[key]) continue;
    const problem = secretProblem(key, env[key]);
    if (problem) fatal(`${where} ${problem}`);
  }

  if (env.LRMC_MARKET && (MARKET_IDS as readonly string[]).includes(env.LRMC_MARKET)) {
    const market = marketFor(env.LRMC_MARKET);
    for (const p of marketProblems(market)) {
      fatal(`${where} market is not ready: ${p.field} — ${p.message}`);
    }
    /* The registry is what nginx is checked against, so the deployment has to
     * agree with the registry rather than with itself. */
    if (env.PORT && Number(env.PORT) !== market.port) {
      fatal(`${where} PORT is ${env.PORT}; the ${market.id} market is declared on `
        + `${market.port} and nginx is checked against that.`);
    }
  }

  /* A live key on a market whose webhook secret is a test one, or the reverse,
   * is a deployment that takes real money and never hears about it. */
  const liveKey = env.STRIPE_SECRET_KEY?.startsWith('sk_live_');
  const testKey = env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
  if (env.STRIPE_SECRET_KEY && !liveKey && !testKey) {
    warn(`${where} STRIPE_SECRET_KEY does not look like a Stripe key.`);
  }
  if (env.NODE_ENV === 'production' && testKey) {
    warn(`${where} is production and holds a Stripe TEST key. No real money will move.`);
  }
  if (env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
    fatal(`${where} STRIPE_WEBHOOK_SECRET is not an endpoint secret (whsec_…). `
      + 'The API key is not the signing secret, and using one for the other means '
      + 'every webhook fails signature verification and no order ever settles.');
  }
}

/** The port the app listens on must be the one nginx proxies to. */
function checkPort(envs: Map<string, Record<string, string>>, root: string): void {
  let nginx: string;
  try { nginx = readFileSync(resolve(root, 'frontend/deploy/nginx.conf'), 'utf8'); }
  catch { warn('nginx.conf could not be read; the port pairing is unchecked.'); return; }

  const upstreams = [...new Set(
    [...nginx.matchAll(/proxy_pass\s+http:\/\/127\.0\.0\.1:(\d+)/g)].map((m) => m[1]!),
  )];
  for (const [marketId, env] of envs) {
    if (env.PORT && !upstreams.includes(env.PORT)) {
      fatal(`[${marketId}] listens on ${env.PORT}; nginx proxies to ${upstreams.join(', ')}. `
        + 'Individually correct, collectively a 502 on every API call.');
    }
  }
}

/**
 * The markets must share nothing.
 *
 * Every value here is one somebody copies from the first `.env` to make the
 * second, and every one of them is silent when wrong.
 */
function checkIsolation(envs: Map<string, Record<string, string>>): void {
  const ids = [...envs.keys()];
  if (ids.length < 2) {
    warn('Only one market is configured, so cross-market isolation is unchecked.');
    return;
  }

  const MUST_DIFFER: [string, string][] = [
    ['MONGO_URI', 'Two markets on one database merges two jurisdictions\' members and '
      + 'sums dalasi with dollars in every aggregate.'],
    ['STRIPE_SECRET_KEY', 'One Stripe account for both markets means each can settle the '
      + 'other\'s orders.'],
    ['STRIPE_WEBHOOK_SECRET', 'A shared endpoint secret lets either deployment accept the '
      + 'other\'s webhooks as genuine.'],
    ['JWT_SECRET', 'A shared signing key makes a session minted in one market valid in the '
      + 'other, which is a cross-jurisdiction account takeover.'],
    ['FAC_PEPPER', 'A shared pepper means one leaked database yields both markets\' '
      + 'Founder Authorisation Codes.'],
    ['PORT', 'Two processes cannot listen on one port; the second will not start.'],
  ];

  for (const [key, why] of MUST_DIFFER) {
    const seen = new Map<string, string[]>();
    for (const [marketId, env] of envs) {
      const value = env[key];
      if (!value) continue;
      seen.set(value, [...(seen.get(value) ?? []), marketId]);
    }
    for (const [, markets] of seen) {
      if (markets.length > 1) fatal(`${markets.join(' and ')} share a ${key}. ${why}`);
    }
  }

  /* A database *name* reused on different hosts is the same mistake wearing a
   * disguise: it looks different in the file and is identical in effect the day
   * somebody points both at one cluster. */
  const dbNames = new Map<string, string[]>();
  for (const [marketId, env] of envs) {
    const name = env.MONGO_URI?.split('/').pop()?.split('?')[0];
    if (!name) continue;
    dbNames.set(name, [...(dbNames.get(name) ?? []), marketId]);
  }
  for (const [name, markets] of dbNames) {
    if (markets.length > 1) {
      warn(`${markets.join(' and ')} both use a database named "${name}". Different hosts `
        + 'today, one cluster the day somebody consolidates.');
    }
  }
}

function main(): void {
  const root = resolve(process.cwd(), '..');
  /* The sandbox's trimmed `process` type omits `argv`. Reached through
   * globalThis rather than widening the suite's typecheck filter. */
  const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
  const requested = argv.slice(2).filter((a) => !a.startsWith('-'));
  const wanted = (requested.length ? requested : [...MARKET_IDS]) as MarketId[];

  const envs = new Map<string, Record<string, string>>();
  for (const marketId of wanted) {
    /* One file per market, named for it. `.env.gambia`, `.env.unitedStates`. */
    const path = resolve(process.cwd(), `.env.${marketId}`);
    const env = readEnvFile(path);
    if (!env) {
      warn(`No .env.${marketId} — that market is not configured on this host.`);
      continue;
    }
    envs.set(marketId, env);
    checkOne(marketId, env);
  }

  if (envs.size === 0) {
    fatal('No market is configured on this host. Expected backend/.env.<market>.');
  }
  checkPort(envs, root);
  checkIsolation(envs);

  const fatals = problems.filter((p) => p.severity === 'fatal');
  const warnings = problems.filter((p) => p.severity === 'warning');

  console.log(`\nPreflight — ${envs.size} market(s): ${[...envs.keys()].join(', ')}\n`);
  for (const p of warnings) console.log(`  ! ${p.message}`);
  for (const p of fatals) console.log(`  ✗ ${p.message}`);

  if (fatals.length) {
    console.log(`\n${fatals.length} fatal problem(s). Nothing has been changed.\n`);
    process.exit(1);
  }
  console.log(`\n  ✓ ready${warnings.length ? ` (${warnings.length} warning(s))` : ''}\n`);
}

main();
