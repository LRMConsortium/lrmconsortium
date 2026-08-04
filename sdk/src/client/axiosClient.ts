import { LrmcApiError } from '../types/errors.js';
import { serializeQuery } from './fetchClient.js';
import type { RawResponse, RequestSpec, Transport, TransportConfig } from './types.js';

/**
 * The Node / server / React Native transport.
 *
 * axios is an **optional** peer dependency, resolved by dynamic import the first
 * time this transport is used. Two reasons it is not a hard dependency: a
 * browser bundle should never pull it in, and a Node 18+ consumer who is happy
 * with `fetch` should not be forced to install it. If it is genuinely absent,
 * `autoClient` falls back rather than throwing at import time.
 */

/** The slice of axios this transport actually uses. */
export interface AxiosLike {
  request(config: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    data?: unknown;
    signal?: AbortSignal;
    timeout?: number;
    validateStatus?: (status: number) => boolean;
    responseType?: string;
    maxRedirects?: number;
  }): Promise<{ status: number; headers: unknown; data: unknown }>;
}

let cachedAxios: AxiosLike | null = null;
let axiosLookupFailed = false;

/** Resolve axios once. Returns null when it is not installed. */
export async function resolveAxios(): Promise<AxiosLike | null> {
  if (cachedAxios) return cachedAxios;
  if (axiosLookupFailed) return null;
  try {
    // Indirected through a variable so bundlers treat it as optional rather than
    // failing the build when axios is absent.
    const moduleName = 'axios';
    const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ moduleName)) as {
      default?: AxiosLike;
    } & AxiosLike;
    cachedAxios = mod.default ?? mod;
    return cachedAxios;
  } catch {
    axiosLookupFailed = true;
    return null;
  }
}

/** Test seam, and an escape hatch for a pre-configured instance. */
export function setAxiosInstance(instance: AxiosLike | null): void {
  cachedAxios = instance;
  axiosLookupFailed = false;
}

export function createAxiosTransport(instance?: AxiosLike): Transport {
  return {
    name: 'axios',

    async request(spec: RequestSpec, config: TransportConfig): Promise<RawResponse> {
      const axios = instance ?? (await resolveAxios());
      if (!axios) {
        throw new LrmcApiError({
          code: 'CONFIGURATION_ERROR',
          message:
            'axios is not installed. Run `npm install axios`, or configure the SDK with the fetch transport.',
          method: spec.method,
          path: spec.path,
        });
      }

      const base = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
      const suffix = spec.path.startsWith('/') ? spec.path : `/${spec.path}`;
      const url = `${base}${suffix}${serializeQuery(spec.query)}`;
      const timeoutMs = spec.timeoutMs ?? config.defaultTimeoutMs;

      const headers: Record<string, string> = { Accept: 'application/json', ...spec.headers };
      const body = spec.body;
      const multipart =
        typeof FormData !== 'undefined' && body instanceof FormData;
      if (body !== undefined && body !== null && !multipart) {
        headers['Content-Type'] ??= 'application/json';
      }
      if (multipart) delete headers['Content-Type'];

      try {
        const response = await axios.request({
          url,
          method: spec.method,
          headers,
          data: body,
          signal: spec.signal,
          timeout: timeoutMs,
          // Never throw on status — `ApiClient` owns the status→error mapping,
          // so both transports behave identically.
          validateStatus: () => true,
          maxRedirects: 5,
        });

        const responseHeaders: Record<string, string> = {};
        const raw = response.headers as Record<string, unknown> | undefined;
        if (raw && typeof raw === 'object') {
          for (const [key, value] of Object.entries(raw)) {
            if (typeof value === 'string') responseHeaders[key.toLowerCase()] = value;
          }
        }

        return { status: response.status, headers: responseHeaders, body: response.data };
      } catch (err) {
        const e = err as { code?: string; message?: string; name?: string };
        const timedOut = e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT';
        const aborted = e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED';
        throw new LrmcApiError({
          code: timedOut ? 'TIMEOUT' : aborted ? 'ABORTED' : 'NETWORK_ERROR',
          message: timedOut
            ? `Request timed out after ${timeoutMs}ms`
            : aborted
              ? 'Request aborted'
              : `Network request failed: ${e?.message ?? String(err)}`,
          method: spec.method,
          path: spec.path,
          cause: err,
        });
      }
    },
  };
}

export const axiosTransport: Transport = createAxiosTransport();
