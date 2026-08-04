import type { ErrorDetail } from './envelope.js';

/**
 * One error type for everything the SDK can fail with, so a caller writes one
 * `catch` rather than three.
 *
 * Transport failures (DNS, TLS, timeout, abort) are normalised into the same
 * shape as server failures, with a synthetic `code` — `catch (e) { e.code }`
 * behaves identically whether the network died or the server said 403.
 */

export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'ZONE_RESTRICTED',
  'NOT_FOUND',
  'CONFLICT',
  'DUPLICATE_KEY',
  'UNPROCESSABLE',
  'RATE_LIMITED',
  'POLICY_VIOLATION',
  'INTERNAL',
  // Client-side, never returned by the server:
  'NETWORK_ERROR',
  'TIMEOUT',
  'ABORTED',
  'MALFORMED_RESPONSE',
  'CLIENT_FORBIDDEN',
  'CONFIGURATION_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorInit {
  code: ErrorCode | string;
  message: string;
  status?: number;
  details?: ErrorDetail[];
  requestId?: string;
  method?: string;
  path?: string;
  cause?: unknown;
}

export class LrmcApiError extends Error {
  readonly code: ErrorCode | string;
  readonly status: number;
  readonly details: ErrorDetail[];
  readonly requestId?: string;
  readonly method?: string;
  readonly path?: string;
  override readonly cause?: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'LrmcApiError';
    this.code = init.code;
    this.status = init.status ?? 0;
    this.details = init.details ?? [];
    this.requestId = init.requestId;
    this.method = init.method;
    this.path = init.path;
    this.cause = init.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Retrying this request unchanged might succeed. */
  get isRetryable(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT' ||
      this.code === 'RATE_LIMITED' ||
      this.status >= 500
    );
  }

  /** The caller needs to sign in again. */
  get isAuthError(): boolean {
    return this.code === 'UNAUTHENTICATED' || this.status === 401;
  }

  /** The caller is signed in but not permitted. */
  get isPermissionError(): boolean {
    return (
      this.code === 'FORBIDDEN' ||
      this.code === 'ZONE_RESTRICTED' ||
      this.code === 'POLICY_VIOLATION' ||
      this.code === 'CLIENT_FORBIDDEN' ||
      this.status === 403
    );
  }

  /** Field-level messages, keyed by field, for binding to form inputs. */
  get fieldErrors(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const d of this.details) {
      if (!d.field) continue;
      (out[d.field] ??= []).push(d.message);
    }
    return out;
  }

  override toString(): string {
    const where = this.method && this.path ? ` (${this.method} ${this.path})` : '';
    return `${this.name} [${this.code}]${where}: ${this.message}`;
  }
}

export function isLrmcApiError(value: unknown): value is LrmcApiError {
  return value instanceof LrmcApiError;
}

/** Thrown by the optional client-side RBAC guard, before anything is sent. */
export class LrmcClientForbiddenError extends LrmcApiError {
  readonly reason: 'zone' | 'permission' | 'role';

  constructor(init: Omit<ApiErrorInit, 'code'> & { reason: 'zone' | 'permission' | 'role' }) {
    super({ ...init, code: 'CLIENT_FORBIDDEN', status: 403 });
    this.name = 'LrmcClientForbiddenError';
    this.reason = init.reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
