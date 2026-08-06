/**
 * Commercial client portfolio analytics — pure aggregation.
 *
 * A hospitality group's account manager asks three questions: how full is the
 * estate, what did it earn, and what is outstanding. Those answers span
 * properties, leases, the ledger, fleets and campaigns, so the arithmetic lives
 * in one place rather than being reassembled per screen.
 *
 * Every rate is returned as a percentage rounded to one decimal, and every
 * money figure through `money()`, so the dashboard and the export agree.
 */

import { money } from '../lease/rentSchedule.js';

export interface PortfolioProperty {
  id: string;
  occupancyStatus: string;
  rentAmount?: number;
  rentPeriod?: string;
  rentCurrency?: string;
  region?: string;
}

export interface PortfolioLease {
  id: string;
  status: string;
  monthlyRent: number;
  arrearsAmount?: number;
  totalPaid?: number;
  currency?: string;
}

export interface PortfolioLedgerRow {
  kind: string;
  status: string;
  amount: number;
  netAmount?: number;
  currency: string;
  paidAt?: Date;
}

export interface PortfolioVehicle {
  availability: string;
}

export interface PortfolioAd {
  status: string;
  spend?: number;
  impressions?: number;
  clicks?: number;
}

export interface PortfolioInput {
  properties: PortfolioProperty[];
  leases: PortfolioLease[];
  ledger: PortfolioLedgerRow[];
  fleet: PortfolioVehicle[];
  ads: PortfolioAd[];
  currency?: string;
  /** Inclusive lower bound for revenue attribution. */
  from?: Date;
  to?: Date;
}

/** Occupancy counts only properties that are actually on the market. */
export const OCCUPIABLE_STATUSES = ['vacant', 'occupied', 'maintenance'] as const;

export function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export interface OccupancyKpis {
  total: number;
  occupiable: number;
  occupied: number;
  vacant: number;
  underMaintenance: number;
  offMarket: number;
  occupancyRate: number;
}

/**
 * Occupancy against the *occupiable* estate, not against everything on file.
 *
 * A villa withdrawn from the market for a season is not a vacancy the manager
 * failed to fill; counting it as one makes the number useless for judging
 * performance, which is the only thing it is for.
 */
export function occupancyKpis(properties: PortfolioProperty[]): OccupancyKpis {
  const count = (status: string): number =>
    properties.filter((p) => p.occupancyStatus === status).length;

  const occupied = count('occupied');
  const vacant = count('vacant');
  const underMaintenance = count('maintenance');
  const offMarket = count('offMarket');
  const occupiable = occupied + vacant + underMaintenance;

  return {
    total: properties.length,
    occupiable,
    occupied,
    vacant,
    underMaintenance,
    offMarket,
    occupancyRate: percent(occupied, occupiable),
  };
}

export interface RevenueKpis {
  currency: string;
  /** Contracted monthly rent across active leases — the run rate. */
  monthlyRentRoll: number;
  /** Money that actually settled in the window. */
  collected: number;
  platformFees: number;
  netToClient: number;
  arrears: number;
  collectionRate: number;
  adSpend: number;
  transactions: number;
}

const REVENUE_KINDS = ['rent', 'deposit', 'ride'];

export function revenueKpis(input: PortfolioInput): RevenueKpis {
  const currency = input.currency ?? 'GMD';
  const inWindow = (row: PortfolioLedgerRow): boolean => {
    if (!row.paidAt) return false;
    if (input.from && row.paidAt.getTime() < input.from.getTime()) return false;
    if (input.to && row.paidAt.getTime() > input.to.getTime()) return false;
    return true;
  };

  const settled = input.ledger.filter(
    (r) => r.status === 'succeeded' && r.currency === currency && inWindow(r),
  );
  const revenue = settled.filter((r) => REVENUE_KINDS.includes(r.kind));

  const collected = money(revenue.reduce((s, r) => s + r.amount, 0));
  const netToClient = money(revenue.reduce((s, r) => s + (r.netAmount ?? r.amount), 0));

  const activeLeases = input.leases.filter(
    (l) => l.status === 'active' || l.status === 'inArrears' || l.status === 'expiring',
  );
  const monthlyRentRoll = money(activeLeases.reduce((s, l) => s + l.monthlyRent, 0));
  const arrears = money(input.leases.reduce((s, l) => s + (l.arrearsAmount ?? 0), 0));

  return {
    currency,
    monthlyRentRoll,
    collected,
    platformFees: money(collected - netToClient),
    netToClient,
    arrears,
    // Against what was billable in the window: collected plus what is still owed.
    collectionRate: percent(collected, collected + arrears),
    adSpend: money(
      settled.filter((r) => r.kind === 'adSpend').reduce((s, r) => s + r.amount, 0),
    ),
    transactions: settled.length,
  };
}

export interface FleetKpis {
  size: number;
  available: number;
  onTrip: number;
  maintenance: number;
  utilizationRate: number;
}

/** Mirrors the rental-car module's own definition, so the two never disagree. */
export function fleetKpis(fleet: PortfolioVehicle[]): FleetKpis {
  const count = (status: string): number => fleet.filter((v) => v.availability === status).length;
  const onTrip = count('onTrip') + count('rented');
  const available = count('available');
  const maintenance = count('maintenance');
  const inService = available + onTrip;

  return {
    size: fleet.length,
    available,
    onTrip,
    maintenance,
    utilizationRate: percent(onTrip, inService),
  };
}

export interface CampaignKpis {
  campaigns: number;
  active: number;
  impressions: number;
  clicks: number;
  clickThroughRate: number;
  spend: number;
}

export function campaignKpis(ads: PortfolioAd[]): CampaignKpis {
  const impressions = ads.reduce((s, a) => s + (a.impressions ?? 0), 0);
  const clicks = ads.reduce((s, a) => s + (a.clicks ?? 0), 0);
  return {
    campaigns: ads.length,
    active: ads.filter((a) => a.status === 'active').length,
    impressions,
    clicks,
    clickThroughRate: percent(clicks, impressions),
    spend: money(ads.reduce((s, a) => s + (a.spend ?? 0), 0)),
  };
}

export interface PortfolioAnalytics {
  currency: string;
  window: { from: Date | null; to: Date | null };
  occupancy: OccupancyKpis;
  revenue: RevenueKpis;
  fleet: FleetKpis;
  campaigns: CampaignKpis;
  portfolioSize: number;
  /** One number for a card: occupancy, collection and utilisation, evenly weighted. */
  healthScore: number;
}

/**
 * The whole picture, and one composite number for the top of the screen.
 *
 * `healthScore` averages only the dimensions the client actually has — a
 * landlord group with no fleet should not be marked down for a utilisation rate
 * of zero on vehicles it does not own.
 */
export function portfolioAnalytics(input: PortfolioInput): PortfolioAnalytics {
  const occupancy = occupancyKpis(input.properties);
  const revenue = revenueKpis(input);
  const fleet = fleetKpis(input.fleet);
  const campaigns = campaignKpis(input.ads);

  const dimensions: number[] = [];
  if (occupancy.occupiable > 0) dimensions.push(occupancy.occupancyRate);
  if (revenue.collected + revenue.arrears > 0) dimensions.push(revenue.collectionRate);
  if (fleet.size > 0) dimensions.push(fleet.utilizationRate);

  const healthScore = dimensions.length
    ? Math.round((dimensions.reduce((s, d) => s + d, 0) / dimensions.length) * 10) / 10
    : 0;

  return {
    currency: revenue.currency,
    window: { from: input.from ?? null, to: input.to ?? null },
    occupancy,
    revenue,
    fleet,
    campaigns,
    portfolioSize: input.properties.length + fleet.size + campaigns.campaigns,
    healthScore,
  };
}
