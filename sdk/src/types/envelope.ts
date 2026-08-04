/**
 * The platform envelope.
 *
 * Every LRMC + Ususu response is wrapped: `{ success, data, meta? }` on the way
 * out, `{ success: false, error }` on failure. The SDK unwraps it so callers
 * work with `data` directly — see `ApiClient`.
 */

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: PageMeta;
}

export interface ErrorDetail {
  field?: string;
  message: string;
  code?: string;
  [key: string]: unknown;
}

export interface FailureEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
    requestId?: string;
  };
}

export type Envelope<T> = SuccessEnvelope<T> | FailureEnvelope;

export function isSuccessEnvelope<T>(value: unknown): value is SuccessEnvelope<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { success?: unknown }).success === true &&
    'data' in value
  );
}

export function isFailureEnvelope(value: unknown): value is FailureEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { success?: unknown }).success === false &&
    typeof (value as { error?: unknown }).error === 'object'
  );
}

/**
 * `204 No Content` and the raw `/openapi.json` document are the two responses
 * that are legitimately not enveloped.
 */
export function isEnveloped(value: unknown): boolean {
  return isSuccessEnvelope(value) || isFailureEnvelope(value);
}
