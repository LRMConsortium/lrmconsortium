/**
 * The markets LRMC operates in, one deployment each.
 *
 * ── Why a registry and not a second codebase ──────────────────────────────
 * The US pilot and the Gambia launch run **side by side, as separate
 * deployments**: one code line, two `.env` files, two databases, two sets of
 * domains. Nothing is multi-tenant. A US member's record never sits in the same
 * collection as a Gambian one, which is what keeps *money is never summed
 * across currencies* true by construction rather than by vigilance, and keeps
 * one jurisdiction's data out of the other's.
 *
 * ── Why the constants moved here ──────────────────────────────────────────
 * They were singletons — `LAUNCH_COUNTRY = 'The Gambia'` and five others,
 * asserted in `verify.ts` and read by the public-page builder. Two markets
 * makes a singleton a lie in one of them, and the failure mode is not a crash:
 * it is a US tenant recorded as resident in The Gambia, quoted in dalasi, and
 * told to ring +220. That is precisely the bug this file's predecessor was
 * written to end, arriving from the other direction.
 *
 * So the shape stays — one place, imported everywhere, asserted — and only the
 * selection becomes configuration. `currencies.ts` still exports
 * `LAUNCH_COUNTRY`; it now reads it from whichever market is active, so the
 * hundred call sites did not change.
 *
 * ── Nothing here is guessed ───────────────────────────────────────────────
 * A field LRMC has not decided is `null`, not a plausible default. `null` is
 * reported by `marketProblems()` and **refuses a production boot**, the same
 * way a placeholder secret does. The alternative is publishing a fee nobody
 * agreed to, which this project has already done once: the pricing page said
 * "to confirm" for four weeks while `ledger.ts` quietly took 15% of every fare.
 */

import type { Currency } from './currencies.js';

export const MARKET_IDS = ['gambia', 'unitedStates'] as const;
export type MarketId = (typeof MARKET_IDS)[number];

export interface MarketDefinition {
  id: MarketId;
  /** The country LRMC operates in, and the default on every profile. */
  country: string;
  /** The city LRMC operates from. `null` until somebody decides. */
  city: string | null;
  /** What this market stores and prints unless told otherwise. */
  currency: Currency;
  /**
   * The dialling code for a local number.
   *
   * Used to format and to suggest, never to restrict — `PHONE_REGEX` stays
   * broad on purpose, because LRMC exists partly so somebody abroad can let
   * property at home, and that landlord has a foreign number.
   */
  diallingCode: string;
  /** LRMC's share of rent collected, as a percentage. `null` until decided. */
  managementFeePercent: number | null;
  /** Ususu's share of each fare, as a percentage. `null` until decided. */
  rideCommissionPercent: number | null;
  /**
   * The port this market's process listens on.
   *
   * Here rather than only in a `.env` because it has to agree with
   * `deploy/nginx.conf`, and the two files are individually correct when they
   * disagree — the symptom is a 502 on every API call with nothing anywhere
   * saying why. `verify.ts` reads the nginx config and checks both markets'
   * ports appear in it; `npm run preflight` checks the deployment's `.env`
   * matches this. Two markets sharing one would mean the second process simply
   * never starts.
   */
  port: number;
  /**
   * The short name the deployment machinery uses.
   *
   * `us`, `gm`. It appears in the PM2 process name (`lrmc-us`), the release
   * directory (`/srv/lrmc/us/releases`), the log files, the nginx `root`, and
   * the `case` arms in `release.sh` and `rollback.sh` — six places, none of
   * which can see the others.
   *
   * Written down here so `verify.ts` can check that all six agree. The failure
   * it prevents is not a crash: a `rollback.sh` whose case arm says `gm` for
   * `unitedStates` reads Casper's release list from Banjul's directory, finds
   * releases, and relinks the wrong market's code.
   */
  shortName: string;
  /**
   * The administrative regions a member picks from when registering, and a
   * tenant filters on when searching. `null` until somebody decides.
   *
   * ── Why this is here rather than in the page that shows it ──────────────
   * It was in three files: the `REGIONS` array in `public/register.html`, the
   * same array in `assets/js/properties.js` (whose comment claimed it mirrored
   * `config/registration.ts`, which has never held a region list), and the
   * prose in the about page's "Where LRMC operates".
   *
   * Three copies is drift waiting to happen, but that is not what made this
   * urgent. Running `LRMC_MARKET=unitedStates python3 build-public-pages.py`
   * produced pages offering a Casper landlord a choice between Banjul,
   * Kanifing and Brikama, and a phone field reading `+220 000 0000`. Nothing
   * failed. The build succeeded and the pages looked finished.
   *
   * So it moves here, the builder writes all three from it, and a market that
   * has not decided its regions carries `null` — which `marketProblems()`
   * reports, `npm run preflight` refuses a release on, and production refuses
   * to boot with. The US pilot carries `null` today, deliberately: a
   * registration form that cannot collect a member's region is not a form,
   * and inventing a list of Wyoming counties here would be this file's own
   * header warning ignored.
   */
  regions: string[] | null;
}

export const MARKETS: Record<MarketId, MarketDefinition> = {
  gambia: {
    id: 'gambia',
    country: 'The Gambia',
    city: 'Banjul',
    currency: 'GMD',
    diallingCode: '+220',
    managementFeePercent: 10,
    rideCommissionPercent: 15,
    port: 4000,
    shortName: 'gm',
    /* Ordered by population, so the commonest answers sit at the top of a
     * phone dropdown. */
    regions: [
      'Banjul', 'Kanifing', 'Brikama', 'Mansakonko',
      'Kerewan', 'Kuntaur', 'Janjanbureh', 'Basse',
    ],
  },
  /**
   * The pilot, launching first. Casper, Wyoming.
   *
   * ── The Ususu share is 18 here and 15 in Banjul ────────────────────────
   * Worth pausing on, because it is the first number that genuinely differs
   * between the two markets and it is the reason this registry exists rather
   * than a second `LAUNCH_*` constant. Anything that reads a fee now gets its
   * own market's, and a deployment cannot borrow the other's by accident.
   *
   * `ledger.ts` takes `DEFAULT_RIDE_COMMISSION_PERCENT` from here, so a US ride
   * splits at 18 and a Gambian one at 15 with no branch anywhere. A ride that
   * carries its own `platformCommission` still overrides both — the rate agreed
   * when a trip was booked is the rate that trip settles at, whatever the
   * market later changes to.
   */
  unitedStates: {
    id: 'unitedStates',
    country: 'United States',
    city: 'Casper, WY',
    currency: 'USD',
    diallingCode: '+1',
    managementFeePercent: 10,
    rideCommissionPercent: 18,
    port: 4100,
    shortName: 'us',
    /* Undecided, and therefore null. See `regions` on the interface above:
     * this is what stops the pilot shipping a form that offers a Casper
     * landlord a choice between Banjul and Brikama. Wyoming counties, Casper
     * neighbourhoods, or a free-text field — it is a decision, and until it is
     * made this market refuses to boot in production. */
    regions: null,
  },
};

export function isMarketId(value: unknown): value is MarketId {
  return typeof value === 'string' && (MARKET_IDS as readonly string[]).includes(value);
}

export interface MarketProblem {
  field: string;
  message: string;
}

/**
 * What this market still needs before it can serve anybody.
 *
 * Empty means deployable. Non-empty is tracked debt: printed by the suite the
 * way unfetched vendor assets and unconfirmed public-page values are, and fatal
 * at a production boot.
 */
export function marketProblems(market: MarketDefinition): MarketProblem[] {
  const out: MarketProblem[] = [];
  const need = (field: string, value: unknown, message: string) => {
    if (value === null || value === undefined || value === '') out.push({ field, message });
  };

  need('city', market.city, 'No city on record. Every footer and address line prints it.');
  need('managementFeePercent', market.managementFeePercent,
    'No management fee. The pricing page publishes this and the ledger charges it.');
  need('rideCommissionPercent', market.rideCommissionPercent,
    'No ride commission. Ususu splits every fare on it.');
  need('regions', market.regions,
    'No regions. Registration cannot collect one and the property search '
    + 'cannot filter on one.');
  if (market.regions !== null && market.regions.length === 0) {
    out.push({ field: 'regions', message: 'An empty list is a dropdown with nothing in it.' });
  }

  /* A percentage outside 0–100 is not a fee, and a 0 is a decision somebody
   * should have to write down rather than reach by leaving a field blank. */
  for (const [field, value] of [
    ['managementFeePercent', market.managementFeePercent],
    ['rideCommissionPercent', market.rideCommissionPercent],
  ] as [string, number | null][]) {
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
      out.push({ field, message: `${value} is not a percentage.` });
    }
  }

  if (!Number.isInteger(market.port) || market.port < 1024 || market.port > 65535) {
    out.push({ field: 'port', message: `${market.port} is not a usable port.` });
  }

  /* It becomes a directory name, a PM2 process name and a log filename. A
   * shortName with a slash or a space in it is a release script writing
   * somewhere nobody meant. */
  if (!/^[a-z]{2,6}$/.test(market.shortName)) {
    out.push({
      field: 'shortName',
      message: `"${market.shortName}" is not a short lowercase name; it becomes a `
        + 'directory, a process name and a log file.',
    });
  }

  if (!market.diallingCode.startsWith('+')) {
    out.push({ field: 'diallingCode', message: 'A dialling code is written with its +.' });
  }
  return out;
}

/** Deployable markets, for a suite or a deploy check to ask about. */
export function marketIsDeployable(market: MarketDefinition): boolean {
  return marketProblems(market).length === 0;
}

/**
 * The market this process serves.
 *
 * Selected by `LRMC_MARKET`. Defaulting is deliberately *not* silent in
 * production — `env.ts` refuses to boot without an explicit value there —
 * because the way this goes wrong is deploying the pilot's configuration to
 * Banjul and quoting everybody in dollars.
 */
export function marketFor(id: string | undefined | null): MarketDefinition {
  if (!isMarketId(id)) {
    throw new Error(
      `LRMC_MARKET must be one of ${MARKET_IDS.join(', ')} — received ${JSON.stringify(id)}`,
    );
  }
  return MARKETS[id];
}
