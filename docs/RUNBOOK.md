# LRMC — Deployment Runbook

Start, restart, roll back. Two markets, two deployments, one code line.

Everything here assumes you are on the server, as the deploy user, in the
checkout at `/srv/lrmc/src`. Every command names a market explicitly. There is
no command in this document that acts on "the deployment" — there is no such
thing, there is Casper and there is Banjul, and the whole design is that one
cannot reach the other.

| | The Gambia | The US pilot |
|---|---|---|
| market id | `gambia` | `unitedStates` |
| short name | `gm` | `us` |
| port | 4000 | 4100 |
| PM2 process | `lrmc-gm` | `lrmc-us` |
| releases | `/srv/lrmc/gm/releases` | `/srv/lrmc/us/releases` |
| live symlink | `/srv/lrmc/gm/current` | `/srv/lrmc/us/current` |
| env file | `backend/.env.gambia` | `backend/.env.unitedStates` |
| currency | GMD | **USD** |
| management fee | 10% | 10% |
| ride commission | 15% | 18% |
| domains | lrmconsortium.com, .africa, africaususu.com | us.lrmconsortium.com |
| logs | `/var/log/lrmc/gm.*.log` | `/var/log/lrmc/us.*.log` |

Those numbers are not written down twice. They come from
`backend/src/config/markets.ts`, and `npm run verify` fails if this table's
ports stop matching `frontend/deploy/nginx.conf` or if the short names stop
matching the shell scripts. If you change one, change it there.

**Launch order: the US pilot first. Gambia when you are physically present.**

---

## Building for a market

The public pages are static and built per market. Everything that differs —
country, city, regions, currency and its symbol, the dialling code and the
phone-number shape, both fee percentages, and the currency a landlord is
offered first — comes from `backend/src/config/markets.ts` and is written into
the pages at build time.

```bash
cd frontend
LRMC_MARKET=unitedStates python3 build-public-pages.py
```

`deploy/release.sh` runs this for you, and then runs the suite with
`LRMC_MARKET` exported so it verifies the pages it just built. Running the
suite without that exported checks the Gambia market's constants against
whatever pages happen to be on disk, which is how "Serving The Gambia" once
survived in the footer of every page of the Casper build.

The build refuses rather than borrowing. A market that has not decided a field
carries `null`, and:

```
$ LRMC_MARKET=<market> python3 build-public-pages.py

  The <market> market has not decided its regions.
  …
  Nothing has been written.
```

The same fields refuse a production boot and refuse a release, so an
unfinished market cannot reach anybody.

Both markets are complete today. The pilot's pages say Casper, Cheyenne,
Laramie, Gillette and Rock Springs; prices in US dollars; `+1 000 000 0000`.

---

## 0. One-time setup, per market

Done once per server, by hand, deliberately. `release.sh` will not do any of it
— a release script that can create a database can also silently recreate one
somebody carefully configured.

```bash
sudo mkdir -p /srv/lrmc/us/releases /var/log/lrmc
sudo chown -R deploy:deploy /srv/lrmc /var/log/lrmc

cd /srv/lrmc/src/backend
cp .env.example.market .env.unitedStates
```

Then fill it in. Every value below is per market and **must differ** from the
other market's — `npm run preflight` refuses a release if any of them match:

```
NODE_ENV=production
LRMC_MARKET=unitedStates
PORT=4100

MONGO_URI=mongodb://…/lrmc_us          # its own database, its own cluster
JWT_SECRET=…                            # 64 random chars
JWT_REFRESH_SECRET=…
FAC_PEPPER=…                            # 64 random chars, and see below
STRIPE_SECRET_KEY=sk_live_…             # the US Stripe account
STRIPE_WEBHOOK_SECRET=whsec_…           # the US endpoint's signing secret
```

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Two things about `FAC_PEPPER`. It is what stands between a stolen database dump
and every Founder Authorisation Code, so it must not be shared with the other
market and must not be derived from `JWT_SECRET`. And **rotating it invalidates
every FAC already issued** — the founder has to issue new ones. Set it once,
back it up somewhere that is not the server.

`STRIPE_WEBHOOK_SECRET` is the endpoint's signing secret from the Stripe
dashboard (`whsec_…`), not the API key. Using the API key for it means every
webhook fails signature verification and no order ever settles, quietly.
Preflight refuses on the shape.

Finally, nginx and the certificate:

```bash
sudo cp /srv/lrmc/src/frontend/deploy/nginx.conf /etc/nginx/conf.d/lrmc.conf
sudo certbot certonly --webroot -w /var/www/acme -d us.lrmconsortium.com -d www.us.lrmconsortium.com
sudo nginx -t && sudo systemctl reload nginx
```

And make PM2 survive a reboot:

```bash
pm2 startup          # prints a command; run it
pm2 save
```

---

## 1. Check before you touch anything

Reads configuration, changes nothing, safe at any time:

```bash
cd /srv/lrmc/src/backend
npm run preflight                # both markets
npm run preflight unitedStates   # one
```

It asks the questions the process asks at boot — missing variables, a secret
still on its placeholder wording, a market whose fee nobody has decided — plus
the one no single process can ask: **whether the two markets are sharing
anything**. A copied `MONGO_URI` does not crash. It merges two jurisdictions'
members into one collection and sums dalasi with dollars in every aggregate,
silently. The second `.env` is always made from the first, which is why this
check exists at all.

`✗` is fatal and nothing has moved. `!` is a warning worth reading.

---

## 2. Start / deploy

```bash
cd /srv/lrmc/src
git pull
deploy/release.sh unitedStates
```

That is the whole command, for a first start and for every update after it. The
order inside it is the design:

1. **preflight** — configuration, secrets, cross-market isolation. Reads only.
2. **build** — TypeScript, then `LRMC_MARKET=unitedStates python3 build-public-pages.py`.
   The public pages are static and built *per market*: this is what puts USD and
   Casper on the pricing page instead of dalasi and Banjul.
3. **verify** — the backend suite, the SDK suite, the blueprint and the OpenAPI
   document. A release that cannot pass them is not a release. Finding out after
   the cutover means finding out from a member.
4. **stage** — `dist/`, `node_modules`, `frontend/`, the `.env`, and two stamp
   files: `COMMIT` and `MARKET`.
5. **migrate** — indexes, before the new code runs. This platform uses unique
   indexes as concurrency control, and `server.ts` refuses to serve traffic
   without them.
6. **cut over** — move the symlink, `pm2 reload`.
7. **health** — poll `http://127.0.0.1:4100/healthz` for a minute. **If it never
   answers, the script rolls itself back** and exits non-zero.
8. **tidy** — keep the five most recent releases.

Everything that can fail happens before step 6. Steps 1–5 leave the running
process untouched, so a failure there is a message, not an outage.

If you ever need to start PM2 without a release — after a reboot PM2 did not
resurrect, say:

```bash
pm2 start /srv/lrmc/src/deploy/ecosystem.config.cjs --only lrmc-us
pm2 save
```

Note `--only`. Without it you start both markets on one host, and on a host
that has only one `.env` the other simply crash-loops ten times and gives up.

---

## 3. Restart

**After a config change** (a new Stripe key, a rotated secret) — the process
must re-read the environment, so `--update-env` is not optional:

```bash
pm2 reload lrmc-us --update-env
```

`reload` drains: SIGTERM, in-flight requests finish, Mongo closes, then exit.
`server.ts` gives itself 15 seconds before forcing the issue and PM2 waits 20,
so nothing is cut off mid-request.

**After a crash** — nothing, normally. PM2 restarts it, with backoff, up to ten
times. If it has given up, find out why before restarting it by hand:

```bash
pm2 status
pm2 logs lrmc-us --lines 200
```

Ten failed restarts almost always means a **refusal, not a crash**, and a
refusal will not fix itself:

| What the log says | What it means |
|---|---|
| `LRMC_MARKET must be set in production` | `.env.unitedStates` is missing or PM2 did not load it |
| `Market "…" is not ready to serve anybody` | a fee or the city is `null` in `markets.ts` |
| `FAC_PEPPER must be set in production` | it is absent and the derived fallback is refused |
| `Refusing to start … with unsafe secrets` | a secret is still the example's placeholder wording |
| `indexes have not been built` | run the migration (below) |
| `EADDRINUSE` | something else holds 4100 — very likely the other market's `.env` was copied without changing `PORT` |

Fix the cause, then:

```bash
pm2 reload lrmc-us --update-env
```

**A hard restart**, when reload is not enough (a native module changed, PM2
itself is confused):

```bash
pm2 restart lrmc-us --update-env
```

This one drops in-flight requests. Prefer `reload`.

**Indexes only**, without a release:

```bash
cd /srv/lrmc/us/current
env $(grep -v '^#' .env.unitedStates | xargs) node dist/scripts/migrate.js
```

---

## 4. Roll back

```bash
deploy/rollback.sh unitedStates --list          # what is on disk
deploy/rollback.sh unitedStates                 # the previous release
deploy/rollback.sh unitedStates 20260815-1412-a3f9c1d
```

It refuses a release built for the other market — the `MARKET` stamp file is
checked before the symlink moves — then relinks, reloads, and polls `/healthz`.
Seconds, usually, because the old release is still on disk with its
dependencies.

**It rolls back code. It does not roll back the database.**

`npm run migrate` runs `syncIndexes`, which creates the indexes the new code
declares *and drops the ones it no longer does*. Going back to code that expects
a dropped index leaves that code running without it — and here that means a
retried payment can record twice.

This only bites when a release changed an index. When one did, the honest
procedure is two steps:

```bash
deploy/rollback.sh unitedStates
cd /srv/lrmc/us/current && env $(grep -v '^#' .env.unitedStates | xargs) node dist/scripts/migrate.js
```

Stop the bleeding, then restore the older release's indexes.

**Rolling back further than five releases** — the old release directory is
gone, so go through a release:

```bash
cd /srv/lrmc/src
git checkout <commit>
deploy/release.sh unitedStates
git checkout -            # do not leave the checkout detached
```

---

## 5. Checking it is actually up

```bash
curl -fsS http://127.0.0.1:4100/healthz          # the process
curl -fsS https://us.lrmconsortium.com/healthz   # through nginx and TLS
pm2 status
tail -f /var/log/lrmc/us.error.log
```

A 502 through nginx with a healthy `127.0.0.1` is always the same thing: the
port in `nginx.conf` and the port in the `.env` disagree. Both files look
correct on their own. `npm run preflight` and `npm run verify` both check that
pairing against `markets.ts`, so it should be caught before the release — but
if somebody edited nginx by hand on the box, that is where to look.

---

## 6. Stripe

Each market has its own Stripe account, its own keys and its own webhook
endpoint. In the US dashboard, point the endpoint at:

```
https://us.lrmconsortium.com/api/v1/payments/webhooks/stripe
```

and subscribe it to `payment_intent.succeeded`, `payment_intent.payment_failed`
and `charge.refunded`.

Then copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET` and
`pm2 reload lrmc-us --update-env`.

What to know when a payment does not land:

- The webhook is the **only** thing that moves an order to `paid`. A client
  saying it paid is not evidence and never has been. `/pay` creates an intent
  and returns a `clientSecret`; nothing settles until the webhook arrives,
  verifies, and reconciles against the order.
- Every event is keyed on its Stripe event id with a unique index. A redelivery
  is recognised and applied once. Stripe retries for days; that is fine.
- Verification is over the **raw bytes** of the body. If you ever see signature
  failures across the board, do not relax the check — it is either the wrong
  secret in `STRIPE_WEBHOOK_SECRET` or a proxy rewriting the body.
- The amount must match the order **exactly**. An underpayment is refused, and
  so is an overpayment; both leave the order unsettled with a reason recorded
  rather than quietly accepting a number nobody agreed.

Failures are visible in `pm2 logs lrmc-us` and in the Stripe dashboard's event
log, which shows the response the endpoint gave.

---

## 7. What this runbook does not cover, and should say so

- **Ususu's frontend root** (`/srv/lrmc/ususu`) is the one path nginx serves
  that is not inside a release. `build-public-pages.py` does not produce an
  Ususu tree yet, so those files are placed by hand — and a rollback does not
  take them with it.
- **`assets/vendor/` is empty.** Run `scripts/fetch-vendor-assets.sh --write`
  and `scripts/bundle.production.sh` before the first real release, or the
  pages load their libraries from a CDN.
- **Ten public-page values are still marked unconfirmed**, four of them on the
  legal pages. They need counsel, not a deployment. The pilot's terms and
  privacy notice now say "checked against the law of the United States" where
  they used to say "Gambian law" — the sentence is parameterised, the wording
  behind it is still unreviewed.
- **The Stripe SDK adapter for `createIntent` is not written.** The interface
  is there and the stub *fails closed* — an unconfigured deployment cannot take
  an order and believe it was paid — but until the adapter exists, checkout
  cannot complete. This is the one item on this list that blocks taking money.
- **Escalations are logged, not dispatched.** Nobody is paged.
