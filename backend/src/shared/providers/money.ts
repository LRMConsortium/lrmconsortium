/**
 * Money movement, behind an interface.
 *
 * Paying a landlord in Accra is MTN MoMo; paying a diaspora landlord in London
 * is a bank transfer; paying a driver is a wallet credit. Three rails, three
 * settlement times, three idempotency stories. Handlers should not know which.
 *
 * The shipped implementation is a **stub**: it validates the instruction,
 * enforces idempotency in memory and returns `pending`, which is what a real
 * rail returns too — money does not move synchronously, and code written
 * against a provider that pretends it does will break on the first real one.
 *
 * Two rules this interface exists to enforce:
 *
 * 1. **Every transfer carries an idempotency key.** A retried payout must not
 *    pay twice. The key is the caller's to choose and is required, not optional.
 * 2. **No transfer is ever reported `settled` by the initiating call.** Callers
 *    must poll or await a webhook. The stub honours that so the code path is
 *    exercised from day one.
 */

export const TRANSFER_RAILS = ['mobileMoney', 'bankTransfer', 'wallet', 'card'] as const;
export type TransferRail = (typeof TRANSFER_RAILS)[number];

export const TRANSFER_STATUSES = ['pending', 'processing', 'settled', 'failed', 'reversed'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export interface TransferInstruction {
  /** Caller-chosen, stable across retries. Usually the payout line's id. */
  idempotencyKey: string;
  rail: TransferRail | string;
  amount: number;
  currency: string;
  /** Opaque handle for the destination account — never a raw account number. */
  destinationRef: string;
  beneficiaryName?: string;
  narrative?: string;
  /** What this settles, for reconciliation against the ledger. */
  reference?: string;
}

export interface TransferResult {
  ok: boolean;
  provider: string;
  status: TransferStatus;
  /** The rail's own id, for reconciliation and support calls. */
  providerReference?: string;
  /** True when the key had already been seen and no new transfer was created. */
  deduplicated: boolean;
  error?: 'invalidInstruction' | 'insufficientFunds' | 'railUnavailable' | 'rejected';
  detail?: string;
  estimatedSettlement?: Date;
}

export interface MoneyProvider {
  readonly name: string;
  initiateTransfer(instruction: TransferInstruction): Promise<TransferResult>;
  getTransfer(providerReference: string): Promise<TransferResult | null>;
}

/** Rail-independent rules, checked before any vendor call. */
export function validateInstruction(instruction: TransferInstruction): string | null {
  if (!instruction.idempotencyKey?.trim()) return 'idempotencyKey is required';
  if (!Number.isFinite(instruction.amount) || instruction.amount <= 0) {
    return 'amount must be a positive number';
  }
  if (Math.round(instruction.amount * 100) !== instruction.amount * 100) {
    return 'amount has more precision than the minor unit';
  }
  if (!/^[A-Z]{3}$/.test(instruction.currency ?? '')) return 'currency must be a 3-letter code';
  if (!instruction.destinationRef?.trim()) return 'destinationRef is required';
  if (!(TRANSFER_RAILS as readonly string[]).includes(instruction.rail)) {
    return `unsupported rail: ${instruction.rail}`;
  }
  return null;
}

/** Indicative settlement windows, in hours. Used for the estimate only. */
export const SETTLEMENT_HOURS: Record<TransferRail, number> = {
  wallet: 0,
  mobileMoney: 1,
  card: 24,
  bankTransfer: 48,
};

export class StubMoneyProvider implements MoneyProvider {
  readonly name = 'stub';
  private readonly byKey = new Map<string, TransferResult>();
  private readonly byReference = new Map<string, TransferResult>();
  private sequence = 0;

  async initiateTransfer(instruction: TransferInstruction): Promise<TransferResult> {
    const invalid = validateInstruction(instruction);
    if (invalid) {
      return {
        ok: false,
        provider: this.name,
        status: 'failed',
        deduplicated: false,
        error: 'invalidInstruction',
        detail: invalid,
      };
    }

    // Idempotency: the same key returns the same transfer, flagged as a repeat.
    const seen = this.byKey.get(instruction.idempotencyKey);
    if (seen) return { ...seen, deduplicated: true };

    this.sequence += 1;
    const hours = SETTLEMENT_HOURS[instruction.rail as TransferRail] ?? 24;
    const result: TransferResult = {
      ok: true,
      provider: this.name,
      // Never `settled` here. Real rails settle asynchronously; so does this.
      status: 'pending',
      providerReference: `stub-txn-${this.sequence}`,
      deduplicated: false,
      estimatedSettlement: new Date(Date.now() + hours * 3_600_000),
    };

    this.byKey.set(instruction.idempotencyKey, result);
    this.byReference.set(result.providerReference!, result);
    return result;
  }

  async getTransfer(providerReference: string): Promise<TransferResult | null> {
    return this.byReference.get(providerReference) ?? null;
  }

  reset(): void {
    this.byKey.clear();
    this.byReference.clear();
    this.sequence = 0;
  }
}

let provider: MoneyProvider = new StubMoneyProvider();

export function registerMoneyProvider(next: MoneyProvider): void {
  provider = next;
}

export function moneyProvider(): MoneyProvider {
  return provider;
}

/** Which rail suits a payout method. Falls back to the safest, slowest option. */
export function railFor(payoutMethod?: string): TransferRail {
  switch (payoutMethod) {
    case 'mobileMoney':
      return 'mobileMoney';
    case 'wallet':
      return 'wallet';
    case 'card':
      return 'card';
    default:
      return 'bankTransfer';
  }
}

/** Roll a batch settlement up into the counts reported over HTTP. */
export function summariseTransfers(results: TransferResult[]): {
  attempted: number;
  accepted: number;
  deduplicated: number;
  failed: number;
  provider: string;
} {
  return {
    attempted: results.length,
    accepted: results.filter((r) => r.ok).length,
    deduplicated: results.filter((r) => r.deduplicated).length,
    failed: results.filter((r) => !r.ok).length,
    provider: results[0]?.provider ?? provider.name,
  };
}
