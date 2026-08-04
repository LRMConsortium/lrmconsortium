import { LrmcApiError } from '../types/errors.js';
import type { RawResponse, RequestSpec, Transport, TransportConfig } from './types.js';

/**
 * The browser transport.
 *
 * Uses only the platform: no dependency, nothing to bundle. Node 18+ has a
 * global `fetch` too, so this is also the fallback when axios is not installed.
 */

export function buildUrl(baseUrl: string, path: string, query?: RequestSpec['query']): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const search = serializeQuery(query);
  return `${base}${suffix}${search}`;
}

export function serializeQuery(query?: RequestSpec['query']): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    // Arrays go out comma-joined — that is what the API's `exclude` expects.
    const encoded = Array.isArray(value) ? value.join(',') : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(encoded)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** FormData must go out untouched so the runtime can set its own boundary. */
export function isFormData(body: unknown): boolean {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

export function createFetchTransport(fetchImpl?: typeof fetch): Transport {
  return {
    name: 'fetch',

    async request(spec: RequestSpec, config: TransportConfig): Promise<RawResponse> {
      const doFetch = fetchImpl ?? globalThis.fetch;
      if (typeof doFetch !== 'function') {
        throw new LrmcApiError({
          code: 'CONFIGURATION_ERROR',
          message:
            'No global fetch available. Use Node 18+, pass a fetch implementation, or install axios.',
        });
      }

      const url = buildUrl(config.baseUrl, spec.path, spec.query);
      const timeoutMs = spec.timeoutMs ?? config.defaultTimeoutMs;

      // Compose the caller's signal with our timeout, so an explicit abort and a
      // timeout both work rather than one clobbering the other.
      const controller = new AbortController();
      const onAbort = (): void => controller.abort();
      if (spec.signal) {
        if (spec.signal.aborted) controller.abort();
        else spec.signal.addEventListener('abort', onAbort, { once: true });
      }
      const timer =
        timeoutMs > 0 ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs) : undefined;

      const headers: Record<string, string> = { Accept: 'application/json', ...spec.headers };
      let payload: BodyInit | undefined;

      if (spec.body !== undefined && spec.body !== null) {
        if (isFormData(spec.body)) {
          payload = spec.body as FormData;
          delete headers['Content-Type'];
        } else {
          payload = JSON.stringify(spec.body);
          headers['Content-Type'] ??= 'application/json';
        }
      }

      try {
        const response = await doFetch(url, {
          method: spec.method,
          headers,
          body: payload,
          signal: controller.signal,
          credentials: 'omit',
        });

        const text = await response.text();
        let body: unknown;
        if (text) {
          try {
            body = JSON.parse(text) as unknown;
          } catch {
            body = text;
          }
        }

        const responseHeaders: Record<string, string> = {};
        response.headers?.forEach?.((value: string, key: string) => {
          responseHeaders[key.toLowerCase()] = value;
        });

        return { status: response.status, headers: responseHeaders, body };
      } catch (err) {
        const aborted = (err as Error)?.name === 'AbortError' || controller.signal.aborted;
        const timedOut = aborted && !spec.signal?.aborted;
        throw new LrmcApiError({
          code: timedOut ? 'TIMEOUT' : aborted ? 'ABORTED' : 'NETWORK_ERROR',
          message: timedOut
            ? `Request timed out after ${timeoutMs}ms`
            : aborted
              ? 'Request aborted'
              : `Network request failed: ${(err as Error)?.message ?? String(err)}`,
          method: spec.method,
          path: spec.path,
          cause: err,
        });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        spec.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

export const fetchTransport: Transport = createFetchTransport();
