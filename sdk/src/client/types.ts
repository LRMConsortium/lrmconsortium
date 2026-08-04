import type { HQZone } from '../types/zones.js';
import type { Role } from '../types/roles.js';

/**
 * The transport contract.
 *
 * `fetchClient` and `axiosClient` both satisfy this, which is what lets
 * `autoClient` swap them without anything above noticing. Everything to do with
 * envelopes, errors, auth and RBAC lives above this line, in `ApiClient` — so
 * adding a third transport means implementing one method, not reimplementing the
 * client.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined | (string | number)[];
export type QueryParams = Record<string, QueryValue>;

export interface RequestSpec {
  method: HttpMethod;
  /** Path relative to the base URL, e.g. `/landlord/652f…`. */
  path: string;
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON, or `undefined` for an empty body. */
  body: unknown;
}

export interface TransportConfig {
  baseUrl: string;
  defaultTimeoutMs: number;
}

export interface Transport {
  readonly name: 'fetch' | 'axios';
  request(spec: RequestSpec, config: TransportConfig): Promise<RawResponse>;
}

/** Metadata the generator attaches to each operation, from `x-*` in the spec. */
export interface OperationMeta {
  operationId: string;
  method: HttpMethod;
  /** Template form, e.g. `/landlord/{landlordId}`. */
  pathTemplate: string;
  zone: HQZone | null;
  roles: Role[];
  permissions: string[];
  ownership: 'none' | 'scoped' | 'self';
  auth: 'required' | 'optional' | 'none';
}

/** What the optional client-side guard checks against. */
export interface ActorContext {
  roles: Role[];
  grants?: string[];
  allowedZones?: HQZone[];
  restrictedZones?: HQZone[];
}

export type TokenProvider = string | (() => string | null | undefined | Promise<string | null | undefined>);

export interface ApiClientConfig {
  /** e.g. `https://api.lrmconsortium.africa/api/v1`. */
  baseUrl: string;
  /** Static token, or a getter — the getter is awaited on every request. */
  token?: TokenProvider;
  /** Force a transport instead of auto-selecting. */
  transport?: Transport;
  defaultTimeoutMs?: number;
  headers?: Record<string, string>;
  /** Retries on network errors, timeouts, 429 and 5xx. Default 0. */
  retries?: number;
  retryDelayMs?: number;
  /**
   * Check zone and permissions locally before sending.
   *
   * A UX affordance, not a security boundary — the server enforces the same
   * rules and is the only thing that matters. Turning this on saves a round trip
   * on a button the user was never going to be allowed to press.
   */
  enforceRbac?: boolean;
  actor?: ActorContext;
  /** Called on any 401, before the error is thrown. */
  onUnauthorized?: (error: unknown) => void | Promise<void>;
  /** Observe every completed request. */
  onResponse?: (info: {
    meta?: OperationMeta;
    method: HttpMethod;
    path: string;
    status: number;
    durationMs: number;
  }) => void;
}
