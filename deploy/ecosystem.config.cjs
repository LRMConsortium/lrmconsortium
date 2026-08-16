/**
 * PM2 — one process per market.
 *
 *   pm2 start deploy/ecosystem.config.cjs --only lrmc-us
 *   pm2 start deploy/ecosystem.config.cjs --only lrmc-gm
 *
 * ── One file, two apps, and they share nothing ────────────────────────────
 * The US pilot and the Gambia launch are separate deployments: separate
 * database, separate Stripe account, separate domains, separate `.env`. They
 * appear together here only because one file is easier to read than two, and
 * PM2's `--only` keeps them independent in operation.
 *
 * They are *never* both started on one host by default. `deploy/release.sh`
 * takes a market and starts that one. Starting both by accident is the mistake
 * this arrangement is most exposed to, which is why `npm run preflight` refuses
 * a configuration where the two share a database, a Stripe key, a signing
 * secret or a port.
 *
 * ── Why `env_file` and not an `env` block ─────────────────────────────────
 * Secrets do not go in a file that is committed. Each app reads
 * `backend/.env.<market>`, which is `.gitignore`d, and PM2 loads it. The only
 * things stated here are the ones that are not secret and must not drift: which
 * market the process serves, and the fact that it is production.
 *
 * ── One instance per market, deliberately ─────────────────────────────────
 * `instances: 1`, not `max`. Several parts of this platform hold state in the
 * process — the abuse observation ring buffer, the client error store, the rate
 * limiter's counters — and each is documented as conservative: a missed alert,
 * never a false one. Under cluster mode those become *wrong* rather than
 * conservative, because each worker sees a fraction of the traffic and none of
 * them sees the whole. Scaling out is a real change, not a config flag, and it
 * starts with moving that state to the database.
 */

const path = require('node:path');

/** Everything a market's process needs that is not a secret. */
function app(marketId, shortName) {
  return {
    name: `lrmc-${shortName}`,
    cwd: path.resolve(__dirname, '..', 'backend'),
    script: 'dist/server.js',

    /* Not `max`. See the header. */
    instances: 1,
    exec_mode: 'fork',

    /* Secrets live here, out of the repository. */
    env_file: `.env.${marketId}`,

    /* Stated rather than inherited. A process that takes its market from
     * whatever happened to be exported is a process that quotes Banjul in
     * dollars the first time somebody runs it from the wrong shell. */
    env: {
      NODE_ENV: 'production',
      LRMC_MARKET: marketId,
    },

    /* ── Restart policy ──
     * The process refuses to boot on a bad secret, an unset market, or a
     * database with no indexes. Those refusals are permanent — restarting will
     * not fix them — so PM2 must give up rather than loop. Ten tries with
     * backoff distinguishes a crash loop from a transient database blip. */
    autorestart: true,
    max_restarts: 10,
    restart_delay: 2000,
    exp_backoff_restart_delay: 500,
    /* A process that has stayed up this long counts as started, and its restart
     * counter resets. Shorter than this and a slow first request looks like a
     * successful boot. */
    min_uptime: '30s',

    /* SIGTERM first, and enough time for `shutdown` to drain in-flight requests
     * and close Mongo. `server.ts` forces an exit at 15s, so PM2 waiting 20 is
     * the process's decision honoured rather than overridden. */
    kill_timeout: 20000,
    listen_timeout: 15000,
    wait_ready: false,

    /* Logs go to one place per market, timestamped, never interleaved. */
    error_file: `/var/log/lrmc/${shortName}.error.log`,
    out_file: `/var/log/lrmc/${shortName}.out.log`,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

    /* A memory ceiling well above normal use. Reaching it means something is
     * leaking — the in-process error store is the candidate — and a restart is
     * a stopgap that keeps members served while somebody looks. */
    max_memory_restart: '600M',
  };
}

module.exports = {
  apps: [
    app('unitedStates', 'us'),
    app('gambia', 'gm'),
  ],
};
