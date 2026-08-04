import {
  isFailureEnvelope,
  isSuccessEnvelope,
  type PageMeta,
} from '../types/envelope.js';
import { LrmcApiError, LrmcClientForbiddenError } from '../types/errors.js';
import { Page, emptyPageMeta, type ListQuery } from '../types/pagination.js';
import { can } from '../types/roles.js';
import { createAutoTransport, type AutoTransportOptions } from './autoClient.js';
import type {
  ActorContext,
  ApiClientConfig,
  HttpMethod,
  OperationMeta,
  QueryParams,
  RawResponse,
  RequestSpec,
  Transport,
} from './types.js';

/**
 * The client every generated module calls.
 *
 * Owns everything that is the same for all 179 operations: the bearer token,
 * unwrapping the envelope, turning any failure into a `LrmcApiError`, the
 * optional RBAC pre-check, retries and pagination. The transports below it know
 * nothing about any of that — they move bytes.
 */

export interface RequestOptions {
  query?: QueryParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Operation metadata from the spec; enables the client-side RBAC guard. */
  meta?: OperationMeta;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiClient {
  readonly transport: Transport;
  private config: ApiClientConfig;

  constructor(config: ApiClientConfig, autoOptions?: AutoTransportOptions) {
    if (!config.baseUrl) {
      throw new LrmcApiError({
        code: 'CONFIGURATION_ERROR',
        message: 'ApiClient requires a baseUrl, e.g. https://api.lrmconsortium.africa/api/v1',
      });
    }
    this.config = config;
    this.transport = config.transport ?? createAutoTransport(autoOptions);
  }

  /** Merge in new settings — typically a token after sign-in. */
  configure(patch: Partial<ApiClientConfig>): this {
    this.config = { ...this.config, ...patch };
    return this;
  }

  setToken(token: ApiClientConfig['token']): this {
    this.config.token = token;
    return this;
  }

  /** Set the actor the optional client-side RBAC guard checks against. */
  setActor(actor: ActorContext | undefined): this {
    this.config.actor = actor;
    return this;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  private async resolveToken(): Promise<string | undefined> {
    const t = this.config.token;
    if (!t) return undefined;
    if (typeof t === 'string') return t;
    const value = await t();
    return value ?? undefined;
  }

  /**
   * The optional client-side gate. Mirrors the server's three checks — zone,
   * then permission — so a UI can fail fast instead of round-tripping to a 403.
   *
   * This is **not** a security boundary. The server enforces the same rules and
   * is the only thing that matters; this just saves a request.
   */
  private assertAllowed(meta: OperationMeta | undefined): void {
    if (!this.config.enforceRbac || !meta) return;
    const actor = this.config.actor;
    if (!actor) return;
    if (meta.auth === 'none') return;

    if (meta.zone) {
      const restricted = actor.restrictedZones?.includes(meta.zone) ?? false;
      const allowed = actor.allowedZones ? actor.allowedZones.includes(meta.zone) : !restricted;
      if (restricted || !allowed) {
        throw new LrmcClientForbiddenError({
          reason: 'zone',
          message: `Zone ${meta.zone} is restricted for role(s) ${actor.roles.join(', ')}`,
          method: meta.method,
          path: meta.pathTemplate,
        });
      }
    }

    if (meta.permissions.length > 0) {
      const grants = actor.grants;
      if (grants && grants.length > 0) {
        const ok = meta.permissions.some((p) => can(grants, p));
        if (!ok) {
          throw new LrmcClientForbiddenError({
            reason: 'permission',
            message: `Missing permission: ${meta.permissions.join(' or ')}`,
            method: meta.method,
            path: meta.pathTemplate,
          });
        }
      } else if (meta.roles.length > 0 && !actor.roles.some((r) => meta.roles.includes(r))) {
        // No grant list available — fall back to the role list from the spec.
        throw new LrmcClientForbiddenError({
          reason: 'role',
          message: `${meta.method} ${meta.pathTemplate} is limited to: ${meta.roles.join(', ')}`,
          method: meta.method,
          path: meta.pathTemplate,
        });
      }
    }
  }

  /** Any non-2xx, or a malformed body, becomes a `LrmcApiError`. */
  private toError(response: RawResponse, spec: RequestSpec): LrmcApiError {
    const requestId = response.headers['x-request-id'];

    if (isFailureEnvelope(response.body)) {
      const { code, message, details } = response.body.error;
      return new LrmcApiError({
        code,
        message,
        status: response.status,
        details,
        requestId: response.body.error.requestId ?? requestId,
        method: spec.method,
        path: spec.path,
      });
    }

    // A non-enveloped failure: a proxy 502, an HTML error page, a gateway
    // timeout. Still has to arrive as the same error type.
    const fallbackMessage =
      typeof response.body === 'string' && response.body.length < 300
        ? response.body
        : `Request failed with status ${response.status}`;

    return new LrmcApiError({
      code: statusToCode(response.status),
      message: fallbackMessage,
      status: response.status,
      requestId,
      method: spec.method,
      path: spec.path,
    });
  }

  private shouldRetry(error: unknown, attempt: number): boolean {
    const max = this.config.retries ?? 0;
    if (attempt >= max) return false;
    return error instanceof LrmcApiError && error.isRetryable && error.code !== 'ABORTED';
  }

  /** One round trip, including auth, retries and envelope handling. */
  async raw(spec: RequestSpec, options: RequestOptions = {}): Promise<RawResponse> {
    this.assertAllowed(options.meta);

    const token = await this.resolveToken();
    const headers: Record<string, string> = {
      ...this.config.headers,
      ...spec.headers,
      ...options.headers,
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const finalSpec: RequestSpec = {
      ...spec,
      headers,
      query: options.query ?? spec.query,
      signal: options.signal ?? spec.signal,
      timeoutMs: options.timeoutMs ?? spec.timeoutMs,
    };

    const transportConfig = {
      baseUrl: this.config.baseUrl,
      defaultTimeoutMs: this.config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    };

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const started = Date.now();
      try {
        const response = await this.transport.request(finalSpec, transportConfig);

        this.config.onResponse?.({
          meta: options.meta,
          method: finalSpec.method,
          path: finalSpec.path,
          status: response.status,
          durationMs: Date.now() - started,
        });

        if (response.status >= 400) {
          const error = this.toError(response, finalSpec);
          if (error.isAuthError) await this.config.onUnauthorized?.(error);
          if (this.shouldRetry(error, attempt)) {
            attempt += 1;
            await delay(this.retryDelay(attempt));
            continue;
          }
          throw error;
        }

        return response;
      } catch (err) {
        if (this.shouldRetry(err, attempt)) {
          attempt += 1;
          await delay(this.retryDelay(attempt));
          continue;
        }
        throw err instanceof LrmcApiError
          ? err
          : new LrmcApiError({
              code: 'NETWORK_ERROR',
              message: (err as Error)?.message ?? String(err),
              method: finalSpec.method,
              path: finalSpec.path,
              cause: err,
            });
      }
    }
  }

  private retryDelay(attempt: number): number {
    const base = this.config.retryDelayMs ?? 250;
    return base * 2 ** (attempt - 1);
  }

  /** Unwrap `{ success, data }` and hand back `data`. */
  async request<T>(spec: RequestSpec, options: RequestOptions = {}): Promise<T> {
    const response = await this.raw(spec, options);

    if (response.status === 204 || response.body === undefined || response.body === '') {
      return undefined as T;
    }

    if (isSuccessEnvelope<T>(response.body)) return response.body.data;

    // `/openapi.json` is deliberately not enveloped.
    if (typeof response.body === 'object' && response.body !== null) return response.body as T;

    throw new LrmcApiError({
      code: 'MALFORMED_RESPONSE',
      message: 'Response was not in the { success, data } envelope',
      status: response.status,
      method: spec.method,
      path: spec.path,
    });
  }

  /** A list call, returning a `Page<T>` that can fetch its own successors. */
  async requestPage<T>(spec: RequestSpec, options: RequestOptions = {}): Promise<Page<T>> {
    const response = await this.raw(spec, options);
    const body = response.body;

    let items: T[] = [];
    let meta: PageMeta = emptyPageMeta();

    if (isSuccessEnvelope<T[]>(body)) {
      items = Array.isArray(body.data) ? body.data : [];
      meta = body.meta ?? { ...emptyPageMeta(), total: items.length, totalPages: 1 };
    } else if (Array.isArray(body)) {
      items = body as T[];
      meta = { ...emptyPageMeta(), total: items.length, totalPages: 1 };
    } else {
      throw new LrmcApiError({
        code: 'MALFORMED_RESPONSE',
        message: 'Expected a paginated { success, data, meta } response',
        status: response.status,
        method: spec.method,
        path: spec.path,
      });
    }

    const query = (options.query ?? spec.query ?? {}) as ListQuery;
    const fetcher = (next: ListQuery): Promise<Page<T>> =>
      this.requestPage<T>(spec, { ...options, query: next as QueryParams });

    return new Page<T>(items, meta, query, fetcher);
  }

  // ── Verb helpers, used by the generated modules ──────────────────────────

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>({ method: 'GET', path }, options);
  }
  list<T>(path: string, options?: RequestOptions): Promise<Page<T>> {
    return this.requestPage<T>({ method: 'GET', path }, options);
  }
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>({ method: 'POST', path, body }, options);
  }
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>({ method: 'PATCH', path, body }, options);
  }
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>({ method: 'PUT', path, body }, options);
  }
  delete<T = void>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>({ method: 'DELETE', path }, options);
  }
}

function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_FAILED';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL' : 'BAD_REQUEST';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Escape a path segment. Ids are opaque; never interpolate them raw. */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value));
}

/**
 * Build multipart bodies for the endpoints that take uploads — ID scans, vehicle
 * photos, ad creatives.
 */
export function toFormData(input: Record<string, unknown>): FormData {
  if (typeof FormData === 'undefined') {
    throw new LrmcApiError({
      code: 'CONFIGURATION_ERROR',
      message: 'FormData is not available in this runtime',
    });
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, item as string | Blob);
    } else if (typeof value === 'object' && !(value as Blob).size) {
      form.append(key, JSON.stringify(value));
    } else {
      form.append(key, value as string | Blob);
    }
  }
  return form;
}
