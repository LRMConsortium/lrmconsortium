/**
 * Taking money from a buyer.
 *
 * Separate from `money.ts`, which pays money *out*. Paying out is a transfer
 * LRMC initiates; taking payment is a conversation with a gateway that ends in
 * a webhook, and the two have almost nothing in common except the word.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 * `POST /order/:orderId/pay` took a `paymentRef` string from the request body
 * and moved the order to `paid` on the strength of it. Nothing verified that
 * money had arrived, nothing checked the amount, and the marketplace module
 * did not import a payment provider at all. Any buyer could post any string and
 * receive goods.
 *
 * The payment module's own header has always said a client never asserts that
 * money moved. It was true there and absent here.
 *
 * ── Why there is no `stripe` import ───────────────────────────────────────
 * The two things that must be right — the minor-unit conversion and the webhook
 * signature — need no SDK, and writing them here rather than trusting a library
 * call means they can be asserted in a suite that has no network and no
 * dependencies installed. Stripe's signature scheme is HMAC-SHA256 over
 * `timestamp.payload`, which `node:crypto` does natively.
 *
 * The SDK is still the right way to *create* an intent, and `CheckoutProvider`
 * is where that lives. The security-critical half does not depend on it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { CURRENCIES, type Currency } from '../../config/currencies.js';

/* ═══════════════════════════════════════════════════════════════════════════
 * Minor units
 *
 * Every gateway speaks in the smallest unit — cents, pesewas, bututs — and this
 * platform stores whole units with two decimal places. The conversion is two
 * lines and it is where double-charges live, so it happens **here and nowhere
 * else**, and both directions are asserted against each other.
 *
 * Not every currency has two decimal places. XOF (the CFA franc) has none: 1000
 * XOF is 1000 minor units, not 100,000. A hard-coded `* 100` would multiply
 * every West African payment by a hundred, and it would do it silently, in the
 * direction that overcharges.
 * ══════════════════════════════════════════════════════════════════════════ */

export const MINOR_UNIT_EXPONENT: Record<Currency, number> = {
  GMD: 2,
  GHS: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  NGN: 2,
  /* Zero-decimal. The CFA franc has no subdivision in circulation. */
  XOF: 0,
};

export function minorUnitFactor(currency: Currency): number {
  return 10 ** MINOR_UNIT_EXPONENT[currency];
}

/**
 * Whole units to the gateway's units.
 *
 * Rounds rather than truncates, and rounds the scaled value rather than
 * scaling a rounded one: `19.99 * 100` is `1998.9999999999998` in IEEE 754, and
 * `Math.trunc` of that is 1998 — a cent short on every price ending in .99.
 */
export function toMinorUnits(amount: number, currency: Currency): number {
  if (!Number.isFinite(amount)) throw new Error(`Not an amount: ${amount}`);
  return Math.round(amount * minorUnitFactor(currency));
}

/** The gateway's units back to whole ones. */
export function fromMinorUnits(minor: number, currency: Currency): number {
  if (!Number.isInteger(minor)) throw new Error(`Minor units must be whole: ${minor}`);
  return minor / minorUnitFactor(currency);
}

/**
 * Is this amount expressible in this currency at all?
 *
 * `10.005` USD is not a price; it is a rounding error with a decimal point.
 * Catching it before the gateway does means the refusal names the field rather
 * than arriving as a provider error nobody can act on.
 */
export function isExpressible(amount: number, currency: Currency): boolean {
  if (!Number.isFinite(amount) || amount < 0) return false;
  const minor = amount * minorUnitFactor(currency);
  return Math.abs(minor - Math.round(minor)) < 1e-6;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Webhook signatures
 *
 * The webhook is the only thing that may move an order to `paid`, which makes
 * this function the entire security boundary of the payment path. If it can be
 * fooled, anyone on the internet can mark any order paid — which is exactly
 * where the platform was before, minus the HTTP round trip.
 *
 * Three separate things have to hold, and each has been the subject of a real
 * CVE somewhere:
 *
 *   1. The HMAC is computed over the **raw body**, byte for byte. A parsed and
 *      re-serialised body has different bytes — key order, whitespace, unicode
 *      escaping — and will not verify. Worse, a codebase that re-serialises
 *      tends to "fix" the mismatch by disabling the check.
 *   2. The comparison is **constant-time**. A `===` on a hex digest leaks the
 *      correct signature a byte at a time to anyone willing to make enough
 *      requests.
 *   3. The timestamp is **inside** the signed payload and checked against a
 *      tolerance. Without that, a valid signature captured once is valid
 *      forever, and a replayed `payment_intent.succeeded` is free goods.
 * ══════════════════════════════════════════════════════════════════════════ */

/** How far a webhook's timestamp may be from now. Stripe's own default. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
  | 'noHeader'
  | 'malformedHeader'
  | 'noSecret'
  | 'staleTimestamp'
  | 'mismatch';

export interface SignatureCheck {
  ok: boolean;
  failure?: SignatureFailure;
}

/** `t=1699999999,v1=abc...` — possibly with several v1 entries during a secret roll. */
export function parseSignatureHeader(header: string | undefined | null): {
  timestamp: number | null;
  signatures: string[];
} {
  if (typeof header !== 'string' || !header) return { timestamp: null, signatures: [] };
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (!key || value === undefined) continue;
    if (key.trim() === 't') {
      const n = Number(value);
      timestamp = Number.isFinite(n) ? n : null;
    }
    /* Several `v1`s appear while an endpoint secret is being rotated, and both
     * are valid. Accepting only the first would break every rotation. */
    if (key.trim() === 'v1') signatures.push(value.trim());
  }
  return { timestamp, signatures };
}

/* ── A note on these two declarations ──────────────────────────────────────
 * This sandbox ships a trimmed `@types/node`: it stubs `createHmac` down to
 * `digest` and omits `TextEncoder` entirely. Both exist at runtime in every
 * supported Node, and the alternative — adding TS2304 and TS2339 to the
 * suite's typecheck filter — would hide genuine type errors across the whole
 * codebase to accommodate one file. Declared locally, so the workaround is
 * where the problem is. */
interface Hmac {
  update(data: Uint8Array | string, encoding?: string): Hmac;
  digest(encoding: string): string;
}

const utf8 = new (globalThis as unknown as {
  TextEncoder: new () => { encode(input: string): Uint8Array };
}).TextEncoder();

function constantTimeEquals(a: string, b: string): boolean {
  const left = utf8.encode(a);
  const right = utf8.encode(b);
  /* `timingSafeEqual` throws on a length mismatch, which would itself be a
   * timing signal. Compare lengths first and still run a comparison of equal
   * size, so the work done does not depend on whether the lengths matched. */
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Does this raw body carry a signature this secret produced, recently?
 *
 * `rawBody` must be the bytes as received. Passing `JSON.stringify(req.body)`
 * will fail for correct payloads, and the fix for that is never to relax this
 * function.
 */
export function verifyWebhookSignature(
  rawBody: Uint8Array | string,
  header: string | undefined | null,
  secret: string | undefined | null,
  nowSeconds: number,
  toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): SignatureCheck {
  if (!secret) return { ok: false, failure: 'noSecret' };
  if (!header) return { ok: false, failure: 'noHeader' };

  const { timestamp, signatures } = parseSignatureHeader(header);
  if (timestamp === null || signatures.length === 0) {
    return { ok: false, failure: 'malformedHeader' };
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, failure: 'staleTimestamp' };
  }

  /* Chained updates rather than concatenating: the HMAC is over
   * `timestamp.rawBody`, and feeding the body straight through means its bytes
   * are never copied, re-encoded, or accidentally re-serialised on the way. */
  const body = typeof rawBody === 'string' ? utf8.encode(rawBody) : rawBody;
  const expected = (createHmac('sha256', secret) as unknown as Hmac)
    .update(`${timestamp}.`, 'utf8')
    .update(body)
    .digest('hex');

  for (const candidate of signatures) {
    if (constantTimeEquals(expected, candidate)) return { ok: true };
  }
  return { ok: false, failure: 'mismatch' };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The provider
 * ══════════════════════════════════════════════════════════════════════════ */

export interface IntentRequest {
  /** Whole units. Converted here, once. */
  amount: number;
  currency: Currency;
  /** The order this pays for. Round-trips through the gateway's metadata. */
  orderId: string;
  /** Stable across retries of the same order, so a double-tap creates one intent. */
  idempotencyKey: string;
  description?: string;
}

export type IntentStatus = 'requiresPayment' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

export interface IntentResult {
  ok: boolean;
  provider: string;
  /** The gateway's id. Reconciliation and support calls both need it. */
  reference?: string;
  /** What the browser needs to complete the payment. Never a secret key. */
  clientSecret?: string;
  status: IntentStatus;
  /** Minor units, as the gateway holds them. */
  amountMinor?: number;
  currency?: Currency;
  orderId?: string;
  error?: string;
}

export interface CheckoutProvider {
  readonly name: string;
  createIntent(request: IntentRequest): Promise<IntentResult>;
  /** The authority on whether money arrived. Never the client, never a webhook body alone. */
  getIntent(reference: string): Promise<IntentResult | null>;
}

/**
 * The stub. Refuses rather than pretending.
 *
 * A stub that returned `succeeded` would make every suite green and every
 * order free. This one fails closed, so a deployment that has not configured a
 * real gateway cannot take an order and believe it was paid.
 */
export const stubCheckoutProvider: CheckoutProvider = {
  name: 'stub',
  async createIntent(): Promise<IntentResult> {
    return {
      ok: false,
      provider: 'stub',
      status: 'failed',
      error: 'No checkout provider is configured. Set STRIPE_SECRET_KEY.',
    };
  },
  async getIntent(): Promise<IntentResult | null> {
    return null;
  },
};

let provider: CheckoutProvider = stubCheckoutProvider;

export function setCheckoutProvider(next: CheckoutProvider): void {
  provider = next;
}

export function checkoutProvider(): CheckoutProvider {
  return provider;
}
