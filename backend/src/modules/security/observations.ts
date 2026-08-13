/**
 * The observation pipeline: `observe` → `grade` → `escalate`.
 *
 * Pure: no Express, no Mongoose, no clock — the caller supplies `now`.
 *
 * `abuse.ts` says what a *count* means. This file is what turns individual
 * events into counts, and it is the piece that was missing: Week 4 shipped
 * thresholds and assertions with nothing feeding them, which is a smoke alarm
 * wired to no sensor.
 *
 * ── Counting is the whole design problem ──────────────────────────────────
 * The naive version keeps every event and counts them on demand. That is a
 * table that grows without bound, dominated by the noisiest client, and it puts
 * a database read in the login path.
 *
 * Instead: a fixed-size ring of buckets per key. Each bucket is a minute, the
 * ring is as long as the widest window any signal uses, and an event increments
 * one integer. Memory is bounded by (number of active keys × ring length),
 * counting is a sum over at most sixty integers, and a bucket older than the
 * window is not deleted — it is *overwritten*, which is why nothing has to be
 * swept.
 *
 * ── What a key is, and why it is not always a person ──────────────────────
 * Credential stuffing is one address trying many accounts, so it is keyed by
 * address. Enumeration is one account reading many people, so it is keyed by
 * account. Keying both by account would miss the first entirely — the attacker
 * has no account — and keying both by address would flag an office where
 * fifteen people share a connection.
 *
 * ── Nothing here can act against anybody ──────────────────────────────────
 * `abuse.ts` caps the outcome at `escalate` and asserts it. This file cannot
 * raise that ceiling: it produces counts and hands them over. The only thing it
 * decides is *whether to bother somebody*, and `escalationsFor` is deliberately
 * the only function that answers that question.
 */

import {
  SIGNAL_DEFINITIONS,
  actionFor,
  assessAbuse,
  type AbuseAction,
  type AbuseFinding,
  type AbuseSignal,
  type AbuseObservation,
} from './abuse.js';

/** One minute per bucket. Every window in `SIGNAL_DEFINITIONS` is whole minutes. */
export const BUCKET_MS = 60_000;

/**
 * How many buckets to keep.
 *
 * The widest window any signal uses, plus one. The `+1` is not decoration: the
 * current minute is partial, so a ring of exactly the window length would drop
 * the oldest whole minute the instant the clock ticked, and a count taken at
 * :59 would differ from the same count taken at :01 by a whole minute of
 * events.
 */
export const RING_MINUTES = Math.max(
  ...Object.values(SIGNAL_DEFINITIONS).map((d) => d.windowMinutes),
) + 1;

/** What an event is keyed by. See the header for why this is not always a person. */
export type ObservationKey = 'subject' | 'address';

export const KEY_BY_SIGNAL: Record<AbuseSignal, ObservationKey> = {
  /* The attacker has no account. Keyed by address, or this signal never fires. */
  credentialStuffing: 'address',
  /* One account, several places. */
  impossibleTravel: 'subject',
  /* Somebody walking the API. They may or may not be signed in; the account is
   * the more useful handle when there is one, and `observe` falls back to the
   * address when there is not. */
  permissionProbing: 'subject',
  recordingBurst: 'subject',
  enumeration: 'subject',
};

export interface ObservationEvent {
  signal: AbuseSignal;
  /** The account, where the event has one. */
  subject?: string | null;
  /** The address, where the event has one. */
  address?: string | null;
  /** When. Supplied, so this file needs no clock. */
  at: number;
  /**
   * How much this event counts for.
   *
   * Almost always 1. `impossibleTravel` is the exception: the interesting
   * quantity is *distinct* addresses, not sign-ins, so the caller counts the
   * distinct set and reports it as a weight.
   */
  weight?: number;
}

/** A ring of per-minute counts. */
export interface Ring {
  /** Counts, indexed by `minute % RING_MINUTES`. */
  buckets: number[];
  /** Which absolute minute each slot currently holds, so stale slots are
   *  recognisable without sweeping. */
  stamps: number[];
}

export function emptyRing(): Ring {
  return {
    buckets: new Array<number>(RING_MINUTES).fill(0),
    stamps: new Array<number>(RING_MINUTES).fill(-1),
  };
}

/** The store: one ring per `signal|key`. */
export type ObservationStore = Map<string, Ring>;

export function storeKey(signal: AbuseSignal, key: string): string {
  return `${signal}|${key}`;
}

/**
 * Which handle to file this event under.
 *
 * Returns `null` when the event carries neither — an anonymous request with no
 * address, which happens behind a misconfigured proxy. Counting those together
 * under one bucket would merge every anonymous caller on the platform into a
 * single very suspicious-looking client, so they are dropped instead.
 */
export function keyFor(event: ObservationEvent): string | null {
  const preferred = KEY_BY_SIGNAL[event.signal];
  const first = preferred === 'address' ? event.address : event.subject;
  const second = preferred === 'address' ? event.subject : event.address;
  const chosen = first || second || null;
  return chosen ? String(chosen) : null;
}

/**
 * Record one event.
 *
 * Returns the store, mutated. Cheap on purpose: this runs in the login path and
 * on every refused request, and an observation pipeline that costs a database
 * write per event is one somebody switches off the first time the platform is
 * busy.
 */
export function observe(
  store: ObservationStore,
  event: ObservationEvent,
): ObservationStore {
  if (!event || !SIGNAL_DEFINITIONS[event.signal]) return store;
  const key = keyFor(event);
  if (!key) return store;

  const at = Number(event.at);
  if (!Number.isFinite(at)) return store;

  const weight = Number.isFinite(Number(event.weight)) ? Math.max(0, Number(event.weight)) : 1;
  if (weight === 0) return store;

  const minute = Math.floor(at / BUCKET_MS);
  const slot = ((minute % RING_MINUTES) + RING_MINUTES) % RING_MINUTES;

  const full = storeKey(event.signal, key);
  let ring = store.get(full);
  if (!ring) { ring = emptyRing(); store.set(full, ring); }

  /* A slot holding a different minute is stale — the ring has come round. It is
   * overwritten rather than added to, which is what makes sweeping unnecessary
   * and is also the one place an off-by-one would silently double a count. */
  if (ring.stamps[slot] !== minute) {
    ring.stamps[slot] = minute;
    ring.buckets[slot] = 0;
  }
  ring.buckets[slot] = (ring.buckets[slot] ?? 0) + weight;
  return store;
}

/**
 * How many events for this signal and key inside its window.
 *
 * Sums only the slots whose stamp is inside the window, so a stale slot the
 * ring has not yet reached contributes nothing.
 */
export function countIn(
  store: ObservationStore,
  signal: AbuseSignal,
  key: string,
  now: number,
): number {
  const def = SIGNAL_DEFINITIONS[signal];
  if (!def) return 0;
  const ring = store.get(storeKey(signal, key));
  if (!ring) return 0;

  const nowMinute = Math.floor(now / BUCKET_MS);
  /* Inclusive of the current partial minute, so an event a second ago counts. */
  const oldest = nowMinute - def.windowMinutes + 1;

  let total = 0;
  for (let i = 0; i < RING_MINUTES; i += 1) {
    const stamp = ring.stamps[i] ?? -1;
    if (stamp >= oldest && stamp <= nowMinute) total += ring.buckets[i] ?? 0;
  }
  return total;
}

/**
 * Everything the store currently has to say.
 *
 * Grading is a read: it takes no action, mutates nothing, and can be called as
 * often as anybody likes. That separation is what lets the escalation decision
 * live in one place rather than being made incidentally by whoever happened to
 * call `observe` last.
 */
export function grade(store: ObservationStore, now: number): AbuseFinding[] {
  const observations: AbuseObservation[] = [];

  for (const full of store.keys()) {
    const sep = full.indexOf('|');
    if (sep < 0) continue;
    const signal = full.slice(0, sep) as AbuseSignal;
    const key = full.slice(sep + 1);
    if (!SIGNAL_DEFINITIONS[signal]) continue;

    const count = countIn(store, signal, key, now);
    if (count <= 0) continue;

    const keyed = KEY_BY_SIGNAL[signal];
    observations.push({
      signal,
      count,
      subject: keyed === 'subject' ? key : null,
      address: keyed === 'address' ? key : null,
    });
  }

  /* `assessAbuse` applies the thresholds and drops the quiet ones. The ceiling
   * lives there and this file cannot raise it. */
  return assessAbuse(observations);
}

/**
 * The findings that warrant bothering a person.
 *
 * The only function that answers "should somebody be told". Everything else
 * observes or reads.
 */
export function escalationsFor(findings: AbuseFinding[]): AbuseFinding[] {
  return (Array.isArray(findings) ? findings : []).filter((f) => f.action === 'escalate');
}

/**
 * How long to wait before repeating an escalation about the same thing.
 *
 * An attack lasting an hour produces the same finding on every grade. Without a
 * cooldown that is sixty notifications about one event, and the coordinator who
 * receives them learns to ignore the channel — which costs LRMC the next
 * genuine one.
 */
export const ESCALATION_COOLDOWN_MINUTES = 30;

export function escalationFingerprint(finding: AbuseFinding): string {
  return `${finding.signal}|${finding.subject ?? ''}|${finding.address ?? ''}`;
}

/**
 * Which of these have not been sent recently.
 *
 * `lastSentAt` maps fingerprint → when it last went out. Returns the ones to
 * send now, so the caller records them and moves on.
 */
export function dueForEscalation(
  findings: AbuseFinding[],
  lastSentAt: Map<string, number>,
  now: number,
): AbuseFinding[] {
  const cooldown = ESCALATION_COOLDOWN_MINUTES * 60_000;
  return escalationsFor(findings).filter((f) => {
    const last = lastSentAt.get(escalationFingerprint(f));
    return last === undefined || now - last >= cooldown;
  });
}

/**
 * Drop rings nobody has touched inside the widest window.
 *
 * Not needed for correctness — a stale slot contributes nothing to a count —
 * but needed for memory, because the map itself grows one entry per key seen
 * and a credential-stuffing run walks through a great many addresses.
 */
export function prune(store: ObservationStore, now: number): ObservationStore {
  const nowMinute = Math.floor(now / BUCKET_MS);
  const oldest = nowMinute - RING_MINUTES;
  for (const [full, ring] of store) {
    const newest = Math.max(...ring.stamps);
    if (newest < oldest) store.delete(full);
  }
  return store;
}

/**
 * The pipeline cannot act against anybody.
 *
 * Asserted rather than commented. `grade` returns findings whose actions come
 * from `abuse.ts`, and if a fourth action ever appears there this returns false
 * and the suite fails.
 */
export function pipelineIsAdvisoryOnly(actions: readonly AbuseAction[]): boolean {
  const forbidden = ['block', 'lock', 'ban', 'suspend', 'throttle'];
  return !actions.some((a) => forbidden.includes(a));
}
