/**
 * Push delivery, behind an interface.
 *
 * The platform has to reach a driver's phone in Accra through FCM, APNs and
 * eventually a WhatsApp Business number — three vendors with three failure
 * modes. Handlers should not know which. They call `pushProvider().send()` and
 * receive the same result shape whichever vendor is configured.
 *
 * The shipped implementation is a **stub**: it validates the payload, records
 * the attempt in memory and reports success without touching the network. That
 * is deliberate — it keeps the notification surface callable end to end, in
 * tests and in a demo, before any vendor account exists. Swapping in a real
 * provider is `registerPushProvider()` at boot; no call site changes.
 */

export const PUSH_PLATFORMS = ['ios', 'android', 'web'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

export interface PushPayload {
  title: string;
  body: string;
  /** Deep link the phone opens on tap, e.g. `ususu://ride/RID-1A2B3C`. */
  deepLink?: string;
  category?: string;
  /** Small key/value bag delivered alongside the notification. */
  data?: Record<string, string>;
}

export interface PushTarget {
  token: string;
  platform: PushPlatform | string;
}

export interface PushResult {
  ok: boolean;
  provider: string;
  /** The vendor's id for this send, where there is one. */
  providerMessageId?: string;
  /** Set when `ok` is false. `invalidToken` means: stop using this token. */
  error?: 'invalidToken' | 'rateLimited' | 'providerUnavailable' | 'invalidPayload';
  detail?: string;
}

export interface PushProvider {
  readonly name: string;
  send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
  /** Fan-out. Default implementations may simply map over `send`. */
  sendMany(targets: PushTarget[], payload: PushPayload): Promise<PushResult[]>;
}

/** Payload rules every provider shares, checked before any vendor call. */
export function validatePushPayload(payload: PushPayload): string | null {
  if (!payload.title?.trim()) return 'title is required';
  if (!payload.body?.trim()) return 'body is required';
  if (payload.title.length > 120) return 'title exceeds 120 characters';
  if (payload.body.length > 1000) return 'body exceeds 1000 characters';
  return null;
}

/**
 * A token that is obviously not a token. Cheap guard so a typo fails here
 * rather than as an opaque 400 from a vendor an hour later.
 */
export function looksLikeToken(token: string): boolean {
  return typeof token === 'string' && token.trim().length >= 16 && !/\s/.test(token);
}

export interface RecordedPush {
  target: PushTarget;
  payload: PushPayload;
  at: Date;
}

/**
 * The stub. Deterministic, offline, and honest about being a stub: every result
 * carries `provider: 'stub'`, so nothing downstream can mistake a recorded send
 * for a delivered one.
 */
export class StubPushProvider implements PushProvider {
  readonly name = 'stub';
  /** Bounded so a long-running process cannot grow without limit. */
  private readonly sent: RecordedPush[] = [];
  private readonly capacity = 500;

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    const invalid = validatePushPayload(payload);
    if (invalid) return { ok: false, provider: this.name, error: 'invalidPayload', detail: invalid };
    if (!looksLikeToken(target.token)) {
      return { ok: false, provider: this.name, error: 'invalidToken', detail: 'malformed token' };
    }

    this.sent.push({ target, payload, at: new Date() });
    if (this.sent.length > this.capacity) this.sent.splice(0, this.sent.length - this.capacity);

    return {
      ok: true,
      provider: this.name,
      providerMessageId: `stub-${this.sent.length}`,
    };
  }

  async sendMany(targets: PushTarget[], payload: PushPayload): Promise<PushResult[]> {
    return Promise.all(targets.map((t) => this.send(t, payload)));
  }

  /** Test and diagnostic access to what was "sent". */
  recorded(): readonly RecordedPush[] {
    return this.sent;
  }

  reset(): void {
    this.sent.length = 0;
  }
}

let provider: PushProvider = new StubPushProvider();

export function registerPushProvider(next: PushProvider): void {
  provider = next;
}

export function pushProvider(): PushProvider {
  return provider;
}

/** Roll a fan-out up into the counts a caller reports back over HTTP. */
export function summarisePushResults(results: PushResult[]): {
  attempted: number;
  delivered: number;
  failed: number;
  invalidTokens: number;
  provider: string;
} {
  return {
    attempted: results.length,
    delivered: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    invalidTokens: results.filter((r) => r.error === 'invalidToken').length,
    provider: results[0]?.provider ?? provider.name,
  };
}
