/**
 * @lrmc/sdk — the unified TypeScript client for LRMC + Ususu.
 *
 *   import { configureApi, api } from '@lrmc/sdk';
 *
 *   configureApi({
 *     baseUrl: 'https://api.lrmconsortium.africa/api/v1',
 *     token: () => localStorage.getItem('accessToken'),
 *   });
 *
 *   const page = await api.landlords.list({ query: { search: 'Asante' } });
 *   for await (const landlord of page.stream()) { … }
 *
 * The transport is chosen at first use: `fetch` in a browser or worker, `axios`
 * in Node and React Native, falling back to `fetch` when axios is not installed.
 * Nothing above the transport layer knows or cares which one is in play.
 */

import { ApiClient } from './client/ApiClient.js';
import type { AutoTransportOptions } from './client/autoClient.js';
import type { ApiClientConfig } from './client/types.js';
import { setClient } from './modules/_runtime.js';

export { api } from './modules/index.js';
export type { Api } from './modules/index.js';
export * from './modules/index.js';

export { ApiClient, seg, toFormData } from './client/ApiClient.js';
export type { RequestOptions } from './client/ApiClient.js';

export {
  autoTransport,
  createAutoTransport,
  detectRuntime,
  prefersAxios,
} from './client/autoClient.js';
export type { AutoTransport, AutoTransportOptions, RuntimeKind } from './client/autoClient.js';

export { createFetchTransport, fetchTransport, buildUrl } from './client/fetchClient.js';
export {
  axiosTransport,
  createAxiosTransport,
  resolveAxios,
  setAxiosInstance,
} from './client/axiosClient.js';
export type { AxiosLike } from './client/axiosClient.js';

export type {
  ActorContext,
  ApiClientConfig,
  HttpMethod,
  OperationMeta,
  QueryParams,
  RawResponse,
  RequestSpec,
  TokenProvider,
  Transport,
  TransportConfig,
} from './client/types.js';

export * from './types/envelope.js';
export * from './types/errors.js';
export * from './types/pagination.js';
export * from './types/roles.js';
export * from './types/zones.js';
export type * from './types/index.js';

let singleton: ApiClient | null = null;

/**
 * Configure the client the `api.*` modules use.
 *
 * Call once at startup. Calling again replaces the configuration — which is how
 * a sign-in flow attaches its token, or how a test points the SDK at a mock.
 */
export function configureApi(
  config: ApiClientConfig,
  autoOptions?: AutoTransportOptions,
): ApiClient {
  singleton = new ApiClient(config, autoOptions);
  setClient(singleton);
  return singleton;
}

/** The configured client, or null. */
export function getApiClient(): ApiClient | null {
  return singleton;
}

/** Update the token without rebuilding the client. */
export function setAuthToken(token: ApiClientConfig['token']): void {
  if (!singleton) {
    throw new Error('configureApi() must be called before setAuthToken()');
  }
  singleton.setToken(token);
}

/**
 * Tell the client who is signed in, so the optional client-side RBAC guard can
 * short-circuit calls the server would reject. Feed it the `authorization`
 * block from `GET /auth/me`.
 */
export function setActor(actor: ApiClientConfig['actor']): void {
  if (!singleton) {
    throw new Error('configureApi() must be called before setActor()');
  }
  singleton.setActor(actor);
}

/** Drop the configuration. Mostly useful between tests. */
export function resetApi(): void {
  singleton = null;
  setClient(null);
}
