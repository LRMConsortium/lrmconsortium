/**
 * Ledger arithmetic — commission splits, payout batching, refunds.
 *
 * Pure and Mongoose-free, for the same reason the rent maths is: these are the
 * numbers people dispute. A driver querying a week's earnings and the batch that
 * paid them must be produced by the same function, or the difference is a
 * support ticket nobody can settle.
 *
 * Everything here works in the minor unit via `money()` — rounding once, at the
 * point of computation, rather than letting float drift accumulate down a batch
 * of four hundred payout lines.
 */

import { money } from '../lease/rentSchedule.js';

export { money };

/** Default platform commission on an Ususu fare, in percent. */
export const DEFAULT_RIDE_COMMISSION_PERCENT = 15;

/** Kinds that move money *to* a member. These are what a payout batch settles. */
export const PAYOUT_KINDS = ['driverPayout', 'landlordPayout', 'refund'] as const;
export type PayoutKind = (typeof PAYOUT_KINDS)[number];

/** Which ledger kinds each payout kind is computed from. */
export const PAYOUT_SOURCES: Record<PayoutKind, readonly string[]> = {
  driverPayout: ['ride'],
  landlordPayout: ['rent', 'deposit'],
  refund: ['adSpend'],
};

export interface CommissionSplit {
  gross: number;
  commissionPercent: number;
  platformFee: number;
  net: number;
}

/**
 * Split a gross amount into platform fee and net.
 *
 * The fee is rounded and the net is the *remainder*, not a second independent
 * rounding — otherwise a 15% split of 33.33 loses a pesewa that belongs to
 * somebody, and the ledger stops balancing.
 */
export function commissionSplit(gross: number, commissionPercent: number): CommissionSplit {
  const pct = Math.min(100, Math.max(0, commissionPercent));
  const amount = Math.max(0, money(gross));
  const platformFee = money((amount * pct) / 100);
  return {
    gross: amount,
    commissionPercent: pct,
    platformFee,
    net: money(amount - platformFee),
  };
}

/**
 * The management fee LRMC withholds from rent before a landlord payout.
 * Same remainder discipline as the ride split.
 */
export function managementSplit(rent: number, managementFeePercent: number): CommissionSplit {
  return commissionSplit(rent, managementFeePercent);
}

/** One ledger row, reduced to what batching needs. */
export interface LedgerRow {
  id: string;
  kind: string;
  status: string;
  payee?: string;
  payeeKind?: string;
  payer?: string;
  amount: number;
  platformFee?: number;
  netAmount?: number;
  currency: string;
  paidAt?: Date;
}

export interface PayoutLine {
  payee: string;
  payeeKind: string;
  currency: string;
  /** Ledger rows rolled into this line. */
  sourceIds: string[];
  gross: number;
  platformFee: number;
  net: number;
}

export interface PayoutBatchDraft {
  kind: PayoutKind;
  currency: string;
  lines: PayoutLine[];
  lineCount: number;
  gross: number;
  platformFee: number;
  net: number;
  /** Rows that matched the kind but could not be paid, and why. */
  skipped: { id: string; reason: string }[];
}

/** Only settled money is payable. Pending and failed rows are not owed to anyone yet. */
export function isPayable(row: LedgerRow): { ok: boolean; reason?: string } {
  if (row.status !== 'succeeded') return { ok: false, reason: `status:${row.status}` };
  if (!row.payee) return { ok: false, reason: 'noPayee' };
  if (!(row.netAmount ?? row.amount)) return { ok: false, reason: 'zeroAmount' };
  return { ok: true };
}

/**
 * Roll a set of ledger rows into one payout line per payee.
 *
 * Grouped by payee *and currency*: a landlord with a GHS portfolio and a USD
 * one is owed two transfers, and summing across them would be wrong in a way
 * that only shows up at settlement.
 */
export function buildPayoutBatch(
  kind: PayoutKind,
  rows: LedgerRow[],
  currency?: string,
): PayoutBatchDraft {
  const sources = PAYOUT_SOURCES[kind];
  const byPayee = new Map<string, PayoutLine>();
  const skipped: { id: string; reason: string }[] = [];

  for (const row of rows) {
    if (!sources.includes(row.kind)) {
      skipped.push({ id: row.id, reason: `kind:${row.kind}` });
      continue;
    }
    if (currency && row.currency !== currency) {
      skipped.push({ id: row.id, reason: `currency:${row.currency}` });
      continue;
    }
    const payable = isPayable(row);
    if (!payable.ok) {
      skipped.push({ id: row.id, reason: payable.reason! });
      continue;
    }

    const key = `${row.payee}|${row.currency}`;
    const line = byPayee.get(key) ?? {
      payee: row.payee!,
      payeeKind: row.payeeKind ?? 'unknown',
      currency: row.currency,
      sourceIds: [],
      gross: 0,
      platformFee: 0,
      net: 0,
    };
    line.sourceIds.push(row.id);
    line.gross = money(line.gross + row.amount);
    line.platformFee = money(line.platformFee + (row.platformFee ?? 0));
    line.net = money(line.net + (row.netAmount ?? row.amount - (row.platformFee ?? 0)));
    byPayee.set(key, line);
  }

  // Largest first: if a batch is part-settled because a provider rate-limits,
  // the money that matters most has already moved.
  const lines = [...byPayee.values()].sort((a, b) => b.net - a.net || a.payee.localeCompare(b.payee));

  return {
    kind,
    currency: currency ?? lines[0]?.currency ?? 'GHS',
    lines,
    lineCount: lines.length,
    gross: money(lines.reduce((sum, l) => sum + l.gross, 0)),
    platformFee: money(lines.reduce((sum, l) => sum + l.platformFee, 0)),
    net: money(lines.reduce((sum, l) => sum + l.net, 0)),
    skipped,
  };
}

/**
 * A batch balances when its lines account for every pesewa: gross must equal
 * fee plus net, on every line and in the total. Asserted in verify, and worth
 * calling before a batch is settled.
 */
export function batchBalances(draft: PayoutBatchDraft): boolean {
  const lineOk = draft.lines.every((l) => Math.abs(l.gross - (l.platformFee + l.net)) < 0.005);
  const totalOk = Math.abs(draft.gross - (draft.platformFee + draft.net)) < 0.005;
  return lineOk && totalOk;
}

/**
 * What can be refunded against an original payment.
 *
 * Never more than was paid, never more than remains after earlier refunds, and
 * never against money that never settled.
 */
export function refundableAmount(
  original: { amount: number; status: string },
  alreadyRefunded = 0,
): number {
  if (original.status !== 'succeeded') return 0;
  return money(Math.max(0, original.amount - Math.max(0, alreadyRefunded)));
}

/** Earnings summary for a member's own ledger view. */
export interface EarningsSummary {
  currency: string;
  gross: number;
  platformFee: number;
  net: number;
  count: number;
  byKind: Record<string, { count: number; gross: number; net: number }>;
}

export function summariseEarnings(rows: LedgerRow[], currency = 'GHS'): EarningsSummary {
  const scoped = rows.filter((r) => r.currency === currency && r.status === 'succeeded');
  const byKind: EarningsSummary['byKind'] = {};

  for (const row of scoped) {
    const bucket = byKind[row.kind] ?? { count: 0, gross: 0, net: 0 };
    bucket.count += 1;
    bucket.gross = money(bucket.gross + row.amount);
    bucket.net = money(bucket.net + (row.netAmount ?? row.amount - (row.platformFee ?? 0)));
    byKind[row.kind] = bucket;
  }

  return {
    currency,
    gross: money(scoped.reduce((s, r) => s + r.amount, 0)),
    platformFee: money(scoped.reduce((s, r) => s + (r.platformFee ?? 0), 0)),
    net: money(scoped.reduce((s, r) => s + (r.netAmount ?? r.amount - (r.platformFee ?? 0)), 0)),
    count: scoped.length,
    byKind,
  };
}
