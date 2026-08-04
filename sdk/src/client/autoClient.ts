import { createAxiosTransport, resolveAxios, type AxiosLike } from './axiosClient.js';
import { createFetchTransport } from './fetchClient.js';
import type { RawResponse, RequestSpec, Transport, TransportConfig } from './types.js';

/**
 * Runtime detection and transport selection.
 *
 * Browser → fetch (zero bundle cost, and the platform already has it).
 * Node / server / React Native → axios, falling back to fetch when axios is not
 * installed, because it is an optional peer dependency.
 *
 * Selection is lazy: the first request decides, so importing the SDK costs
 * nothing and axios is never loaded in a browser bundle.
 */

export type RuntimeKind = 'browser' | 'node' | 'react-native' | 'worker' | 'unknown';

export function detectRuntime(): RuntimeKind {
  // React Native first: it defines `navigator` but has no DOM.
  const nav = (globalThis as { navigator?: { product?: string } }).navigator;
  if (nav?.product === 'ReactNative') return 'react-native';

  // Service / web workers have `self` and `importScripts` but no `window`.
  const g = globalThis as { importScripts?: unknown; WorkerGlobalScope?: unknown };
  if (typeof g.importScripts === 'function' || typeof g.WorkerGlobalScope !== 'undefined') {
    return 'worker';
  }

  const win = (globalThis as { window?: { document?: unknown } }).window;
  if (typeof win !== 'undefined' && typeof win?.document !== 'undefined') return 'browser';

  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (proc?.versions?.node) return 'node';

  return 'unknown';
}

/** Browsers and workers use fetch; everything else prefers axios. */
export function prefersAxios(runtime: RuntimeKind = detectRuntime()): boolean {
  return runtime === 'node' || runtime === 'react-native' || runtime === 'unknown';
}

export interface AutoTransportOptions {
  /** Override detection, for tests or for a deliberate choice. */
  runtime?: RuntimeKind;
  /** Supply axios directly instead of resolving it. */
  axiosInstance?: AxiosLike;
  /** Supply a fetch implementation (a polyfill, or a mock). */
  fetchImpl?: typeof fetch;
  /** Called once, when the transport is chosen. */
  onSelect?: (info: { runtime: RuntimeKind; transport: 'fetch' | 'axios'; reason: string }) => void;
}

export interface AutoTransport extends Transport {
  /** Which transport was chosen, or null before the first request. */
  readonly selected: 'fetch' | 'axios' | null;
  readonly runtime: RuntimeKind;
  /** Force selection now rather than on first use. */
  resolve(): Promise<Transport>;
}

export function createAutoTransport(options: AutoTransportOptions = {}): AutoTransport {
  const runtime = options.runtime ?? detectRuntime();
  let chosen: Transport | null = null;
  let pending: Promise<Transport> | null = null;

  const select = async (): Promise<Transport> => {
    if (chosen) return chosen;

    if (!prefersAxios(runtime)) {
      chosen = createFetchTransport(options.fetchImpl);
      options.onSelect?.({
        runtime,
        transport: 'fetch',
        reason: `${runtime} runtime — using the platform fetch`,
      });
      return chosen;
    }

    if (options.axiosInstance) {
      chosen = createAxiosTransport(options.axiosInstance);
      options.onSelect?.({ runtime, transport: 'axios', reason: 'axios instance supplied' });
      return chosen;
    }

    const axios = await resolveAxios();
    if (axios) {
      chosen = createAxiosTransport(axios);
      options.onSelect?.({ runtime, transport: 'axios', reason: `${runtime} runtime — axios resolved` });
      return chosen;
    }

    // axios is optional; a Node 18+ consumer without it is still fine.
    chosen = createFetchTransport(options.fetchImpl);
    options.onSelect?.({
      runtime,
      transport: 'fetch',
      reason: `${runtime} runtime, but axios is not installed — falling back to fetch`,
    });
    return chosen;
  };

  return {
    name: 'fetch',
    get selected() {
      return chosen ? chosen.name : null;
    },
    runtime,
    async resolve() {
      pending ??= select();
      return pending;
    },
    async request(spec: RequestSpec, config: TransportConfig): Promise<RawResponse> {
      pending ??= select();
      const transport = await pending;
      return transport.request(spec, config);
    },
  };
}

export const autoTransport: AutoTransport = createAutoTransport();
