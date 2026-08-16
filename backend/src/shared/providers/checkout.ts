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
 *
 * `createStripeCheckoutProvider` at the foot of this file is that adapter. It
 * takes a client rather than importing one, so the rule above survives it and
 * the suite can drive the adapter with a fake.
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

/* ═══════════════════════════════════════════════════════════════════════════
 * Stripe
 *
 * The adapter, and only the adapter: two calls out to `paymentIntents`, and the
 * translation between Stripe's vocabulary and this module's. The signature
 * check above is what secures the payment path; nothing here is load-bearing
 * for it.
 *
 * ── Why the client is injected rather than imported ───────────────────────
 * The header explains why this file imports no SDK, and that reasoning does not
 * stop at the provider: `verify.ts` runs with no network and no dependencies
 * installed, and it reads this file's source to assert the constant-time
 * comparison. An `import Stripe from 'stripe'` here makes the module unloadable
 * in the suite that checks it.
 *
 * So the surface used is declared structurally — the same move the `Hmac` and
 * `TextEncoder` declarations above make, for the same reason. A real client
 * satisfies it without a cast, and wiring at the composition root reads:
 *
 *     import Stripe from 'stripe';
 *     if (env.STRIPE_SECRET_KEY) {
 *       setCheckoutProvider(createStripeCheckoutProvider(new Stripe(env.STRIPE_SECRET_KEY)));
 *     }
 *
 * Left undone, `checkoutProvider()` stays the stub that refuses, which is the
 * behaviour an unconfigured deployment should have.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The fields of a Stripe PaymentIntent this adapter reads. */
export interface StripePaymentIntent {
  id: string;
  status: string;
  /** Minor units, as Stripe holds them. */
  amount: number;
  /** Lowercase ISO code, as Stripe returns it. */
  currency: string;
  client_secret?: string | null;
  metadata?: Record<string, string> | null;
  /** Present on a decline. A declined intent is not a failed one — see below. */
  last_payment_error?: { message?: string | null } | null;
}

export interface StripeIntentCreateParams {
  amount: number;
  currency: string;
  metadata: Record<string, string>;
  description?: string;
  automatic_payment_methods?: { enabled: boolean };
}

/**
 * The two calls made, and nothing else.
 *
 * Method shorthand rather than arrow properties is deliberate: TypeScript
 * compares method parameters bivariantly, so `new Stripe(key)` — whose params
 * are far wider than these — is assignable without a cast at the call site.
 */
export interface StripeClient {
  paymentIntents: {
    create(
      params: StripeIntentCreateParams,
      options?: { idempotencyKey?: string },
    ): Promise<StripePaymentIntent>;
    retrieve(id: string): Promise<StripePaymentIntent>;
  };
}

/**
 * Stripe's status vocabulary, mapped onto this module's.
 *
 * Note what is **not** here: nothing maps to `failed`. A declined card does not
 * produce a failed intent — Stripe returns it to `requires_payment_method` with
 * `last_payment_error` set, so the buyer can try another card on the same
 * intent. Treating a decline as terminal is how a buyer who paid on the second
 * attempt ends up with an order nobody will ship. `failed` here means the call
 * itself failed, and it is set in the catch blocks below.
 *
 * `requires_capture` is money authorised but not taken, which is neither
 * settled nor waiting on the buyer — `processing` is the honest reading.
 */
const STRIPE_INTENT_STATUS: Record<string, IntentStatus> = {
  requires_payment_method: 'requiresPayment',
  requires_confirmation: 'requiresPayment',
  requires_action: 'requiresPayment',
  requires_capture: 'processing',
  processing: 'processing',
  succeeded: 'succeeded',
  /* Stripe spells it with one `l`. This module spells it with two. */
  canceled: 'cancelled',
};

/**
 * An unrecognised status resolves to `processing`, never to `succeeded` or
 * `cancelled`. A status Stripe adds after this was written means "no decision
 * yet, ask again" — the one reading that neither ships goods nor writes off a
 * payment that may still land.
 */
function intentStatus(stripeStatus: string): IntentStatus {
  return STRIPE_INTENT_STATUS[stripeStatus] ?? 'processing';
}

/** Stripe's lowercase code back to a currency this platform recognises. */
function currencyFrom(code: string | undefined | null): Currency | undefined {
  const upper = typeof code === 'string' ? code.toUpperCase() : '';
  return (CURRENCIES as readonly string[]).includes(upper) ? (upper as Currency) : undefined;
}

/** Stripe's errors carry a message; the SDK is not needed to read one. */
function errorMessage(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : 'The gateway call failed.';
}

/** A 404 from Stripe — this id names no intent, as opposed to the lookup failing. */
function isMissingResource(err: unknown): boolean {
  const e = err as { code?: unknown; statusCode?: unknown } | null;
  return e?.code === 'resource_missing' || e?.statusCode === 404;
}

/** Everything the two calls report in common, taken from the gateway's object. */
function describeIntent(
  intent: StripePaymentIntent,
  name: string,
): IntentResult {
  return {
    ok: true,
    provider: name,
    reference: intent.id,
    clientSecret: intent.client_secret ?? undefined,
    status: intentStatus(intent.status),
    /* The gateway's own amount and currency, never the ones asked for. The
     * webhook reconciles these against the order, and a reconciliation against
     * the value this process sent would agree with itself and prove nothing. */
    amountMinor: intent.amount,
    currency: currencyFrom(intent.currency),
    orderId: intent.metadata?.orderId,
    error: intent.last_payment_error?.message ?? undefined,
  };
}

/**
 * The real provider.
 *
 * `ok` means the call did what was asked — an intent exists, or was read — and
 * never that money arrived. `status` carries that, and `succeeded` is the only
 * value that means it.
 */
export function createStripeCheckoutProvider(
  client: StripeClient,
  name = 'stripe',
): CheckoutProvider {
  return {
    name,

    async createIntent(request: IntentRequest): Promise<IntentResult> {
      /* Refused here rather than at the gateway, so the complaint names the
       * amount instead of arriving as a provider error nobody can act on. */
      if (!isExpressible(request.amount, request.currency)) {
        return {
          ok: false,
          provider: name,
          status: 'failed',
          error: `${request.amount} is not expressible in ${request.currency}`,
        };
      }

      try {
        const intent = await client.paymentIntents.create(
          {
            amount: toMinorUnits(request.amount, request.currency),
            /* Stripe requires the code lowercase and rejects `USD`. */
            currency: request.currency.toLowerCase(),
            /* `orderId` is what the webhook reads back off the event to find
             * the order it settles — `payment/index.ts` looks for exactly this
             * key. Renaming it here severs settlement silently: intents keep
             * being created, payments keep succeeding, and no order ever moves. */
            metadata: { orderId: request.orderId },
            ...(request.description ? { description: request.description } : {}),
            /* Lets the dashboard decide which methods are offered, so adding a
             * local rail is a settings change rather than a deploy. */
            automatic_payment_methods: { enabled: true },
          },
          /* Request options, not parameters. Stripe ignores an `idempotency_key`
           * passed in the body, and a double-tapped pay button then buys twice. */
          { idempotencyKey: request.idempotencyKey },
        );

        return describeIntent(intent, name);
      } catch (err) {
        return {
          ok: false,
          provider: name,
          status: 'failed',
          error: errorMessage(err),
        };
      }
    },

    async getIntent(reference: string): Promise<IntentResult | null> {
      try {
        return describeIntent(await client.paymentIntents.retrieve(reference), name);
      } catch (err) {
        /* `null` means Stripe answered and holds no such intent. A failed
         * lookup is `ok: false` instead, and the difference is the point: a
         * caller that reads a timeout as "no such payment" concludes money
         * never arrived, on the one call whose job is knowing that it did. */
        if (isMissingResource(err)) return null;
        return {
          ok: false,
          provider: name,
          status: 'failed',
          reference,
          error: errorMessage(err),
        };
      }
    },
  };
}

let provider: CheckoutProvider = stubCheckoutProvider;

export function setCheckoutProvider(next: CheckoutProvider): void {
  provider = next;
}

export function checkoutProvider(): CheckoutProvider {
  return provider;
}
