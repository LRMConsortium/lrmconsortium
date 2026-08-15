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
