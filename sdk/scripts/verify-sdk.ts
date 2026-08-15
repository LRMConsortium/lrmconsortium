/**
 * Runtime verification for the SDK.
 *
 *   npm run verify
 *
 * Runs against mocked transports — no server, no network. The point is to prove
 * the parts that are easy to get quietly wrong: transport auto-selection, the
 * envelope unwrap, error normalisation across both transports, the RBAC guard,
 * pagination, and that every one of the 179 operations is actually reachable and
 * hits the URL it claims to.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiClient, toFormData } from '../src/client/ApiClient.js';
import { createAutoTransport, detectRuntime, prefersAxios } from '../src/client/autoClient.js';
import { createAxiosTransport, type AxiosLike } from '../src/client/axiosClient.js';
import { buildUrl, createFetchTransport, serializeQuery } from '../src/client/fetchClient.js';
import type { RawResponse, RequestSpec, Transport, TransportConfig } from '../src/client/types.js';
import { LrmcApiError, LrmcClientForbiddenError } from '../src/types/errors.js';
import { isFailureEnvelope, isSuccessEnvelope } from '../src/types/envelope.js';
import { can, ROLES } from '../src/types/roles.js';
import { HQ_ZONES } from '../src/types/zones.js';
import { api } from '../src/modules/index.js';
import { setClient } from '../src/modules/_runtime.js';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) passed += 1;
  else failures.push(detail ? `${name} — ${detail}` : name);
}
function eq<T>(name: string, actual: T, expected: T): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}
async function throws(name: string, fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    check(name, false, 'no error thrown');
  } catch (err) {
    const actual = err instanceof LrmcApiError ? err.code : (err as Error).name;
    check(name, actual === code, `expected ${code}, got ${actual}`);
  }
}
function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);
}

/** A transport that records what it was asked for and replays a scripted reply. */
interface Recorded {
  spec: RequestSpec;
  config: TransportConfig;
}
function mockTransport(
  reply: (spec: RequestSpec) => RawResponse | Promise<RawResponse>,
  name: 'fetch' | 'axios' = 'fetch',
): Transport & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    name,
    calls,
    async request(spec, config) {
      calls.push({ spec, config });
      return reply(spec);
    },
  };
}

const okBody = (data: unknown, meta?: unknown): RawResponse => ({
  status: 200,
  headers: { 'x-request-id': 'req-1' },
  body: meta ? { success: true, data, meta } : { success: true, data },
});

const BASE = 'https://api.lrmconsortium.africa/api/v1';

async function main(): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════════
  section('URL building & query serialisation');

  eq('joins base and path', buildUrl(BASE, '/landlords'), `${BASE}/landlords`);
  eq('tolerates a trailing slash on the base', buildUrl(`${BASE}/`, '/landlords'), `${BASE}/landlords`);
  eq('tolerates a missing leading slash', buildUrl(BASE, 'landlords'), `${BASE}/landlords`);
  eq('serialises query params', serializeQuery({ page: 2, limit: 50 }), '?page=2&limit=50');
  eq('drops undefined, null and empty', serializeQuery({ a: 1, b: undefined, c: null, d: '' }), '?a=1');
  eq('comma-joins arrays', serializeQuery({ exclude: ['a', 'b'] }), '?exclude=a%2Cb');
  eq('encodes values', serializeQuery({ search: 'a b&c' }), '?search=a%20b%26c');
  eq('empty query yields nothing', serializeQuery(undefined), '');

  // ═══════════════════════════════════════════════════════════════════════
  section('Transport auto-selection');

  eq('this process is detected as node', detectRuntime(), 'node');
  check('node prefers axios', prefersAxios('node'));
  check('react-native prefers axios', prefersAxios('react-native'));
  check('browser does not prefer axios', !prefersAxios('browser'));
  check('worker does not prefer axios', !prefersAxios('worker'));

  const browserAuto = createAutoTransport({ runtime: 'browser', fetchImpl: (async () =>
    new Response('{"success":true,"data":{"ok":true}}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch });
  const browserPicked = await browserAuto.resolve();
  eq('browser selects fetch', browserPicked.name, 'fetch');
  eq('selection is reported', browserAuto.selected, 'fetch');

  const fakeAxios: AxiosLike = {
    async request() {
      return { status: 200, headers: {}, data: { success: true, data: { via: 'axios' } } };
    },
  };
  const nodeAuto = createAutoTransport({ runtime: 'node', axiosInstance: fakeAxios });
  eq('node with axios selects axios', (await nodeAuto.resolve()).name, 'axios');

  const rnAuto = createAutoTransport({ runtime: 'react-native', axiosInstance: fakeAxios });
  eq('react-native selects axios', (await rnAuto.resolve()).name, 'axios');

  // axios is an optional peer dep — absent, Node must still work.
  let fallbackReason = '';
  const noAxios = createAutoTransport({
    runtime: 'node',
    fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    onSelect: (info) => {
      fallbackReason = info.reason;
    },
  });
  eq('node without axios falls back to fetch', (await noAxios.resolve()).name, 'fetch');
  check('the fallback is explained', fallbackReason.includes('axios is not installed'), fallbackReason);

  // Selection happens once, not per request.
  let selections = 0;
  const counted = createAutoTransport({
    runtime: 'browser',
    fetchImpl: (async () => new Response('{"success":true,"data":1}', { status: 200 })) as unknown as typeof fetch,
    onSelect: () => {
      selections += 1;
    },
  });
  await counted.resolve();
  await counted.resolve();
  await counted.request({ method: 'GET', path: '/x' }, { baseUrl: BASE, defaultTimeoutMs: 1000 });
  eq('the transport is selected exactly once', selections, 1);

  // ═══════════════════════════════════════════════════════════════════════
  section('Envelope parsing');

  check('recognises a success envelope', isSuccessEnvelope({ success: true, data: 1 }));
  check('recognises a failure envelope', isFailureEnvelope({ success: false, error: { code: 'X', message: 'y' } }));
  check('rejects a bare object', !isSuccessEnvelope({ data: 1 }));

  const unwrap = new ApiClient({
    baseUrl: BASE,
    transport: mockTransport(() => okBody({ id: 'abc', fullName: 'Nana Asante' })),
  });
  const landlord = await unwrap.get<{ id: string; fullName: string }>('/landlord/abc');
  eq('unwraps data out of the envelope', landlord.fullName, 'Nana Asante');

  const noContent = new ApiClient({
    baseUrl: BASE,
    transport: mockTransport(() => ({ status: 204, headers: {}, body: undefined })),
  });
  eq('204 resolves to undefined', await noContent.delete('/landlord/abc'), undefined as never);

  // The one endpoint that is deliberately not enveloped.
  const rawDoc = new ApiClient({
    baseUrl: BASE,
    transport: mockTransport(() => ({ status: 200, headers: {}, body: { openapi: '3.1.0' } })),
  });
  eq('a raw document passes through', (await rawDoc.get<{ openapi: string }>('/openapi.json')).openapi, '3.1.0');

  await throws(
    'a non-object body is rejected as malformed',
    () =>
      new ApiClient({
        baseUrl: BASE,
        transport: mockTransport(() => ({ status: 200, headers: {}, body: 'not json' })),
      }).get('/x'),
    'MALFORMED_RESPONSE',
  );

  // ═══════════════════════════════════════════════════════════════════════
  section('Error normalisation');

  const failing = (status: number, body: unknown): ApiClient =>
    new ApiClient({ baseUrl: BASE, transport: mockTransport(() => ({ status, headers: { 'x-request-id': 'r9' }, body })) });

  await throws(
    'a server failure envelope keeps its code',
    () => failing(403, { success: false, error: { code: 'ZONE_RESTRICTED', message: 'no' } }).get('/x'),
    'ZONE_RESTRICTED',
  );
  await throws(
    'a non-enveloped 502 still becomes an ApiError',
    () => failing(502, '<html>bad gateway</html>').get('/x'),
    'INTERNAL',
  );
  await throws('401 maps to UNAUTHENTICATED', () => failing(401, undefined).get('/x'), 'UNAUTHENTICATED');
  await throws('404 maps to NOT_FOUND', () => failing(404, undefined).get('/x'), 'NOT_FOUND');
  await throws('429 maps to RATE_LIMITED', () => failing(429, undefined).get('/x'), 'RATE_LIMITED');

  try {
    await failing(422, {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: [
          { field: 'email', message: 'Invalid email address' },
          { field: 'email', message: 'Already taken' },
          { field: 'phone', message: 'Invalid phone number' },
        ],
      },
    }).post('/landlords', {});
    check('validation error thrown', false);
  } catch (err) {
    const e = err as LrmcApiError;
    eq('validation errors carry their status', e.status, 422);
    eq('request id is captured', e.requestId, 'r9');
    eq('fieldErrors groups by field', Object.keys(e.fieldErrors).sort().join(','), 'email,phone');
    eq('fieldErrors keeps every message', e.fieldErrors.email?.length, 2);
    check('method and path are attached', e.method === 'POST' && e.path === '/landlords');
  }

  // Both transports must normalise a dead network identically.
  const deadFetch = new ApiClient({
    baseUrl: BASE,
    transport: createFetchTransport((() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch),
  });
  await throws('fetch: network failure', () => deadFetch.get('/x'), 'NETWORK_ERROR');

  const deadAxios = new ApiClient({
    baseUrl: BASE,
    transport: createAxiosTransport({
      async request() {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      },
    }),
  });
  await throws('axios: network failure', () => deadAxios.get('/x'), 'NETWORK_ERROR');

  const timedOutAxios = new ApiClient({
    baseUrl: BASE,
    transport: createAxiosTransport({
      async request() {
        throw Object.assign(new Error('timeout of 10ms exceeded'), { code: 'ECONNABORTED' });
      },
    }),
  });
  await throws('axios: timeout', () => timedOutAxios.get('/x'), 'TIMEOUT');

  const err = new LrmcApiError({ code: 'RATE_LIMITED', message: 'slow down', status: 429 });
  check('rate limiting is retryable', err.isRetryable);
  check('403 is a permission error', new LrmcApiError({ code: 'FORBIDDEN', message: '', status: 403 }).isPermissionError);
  check('401 is an auth error', new LrmcApiError({ code: 'UNAUTHENTICATED', message: '', status: 401 }).isAuthError);
  check('a validation error is not retryable', !new LrmcApiError({ code: 'VALIDATION_FAILED', message: '', status: 422 }).isRetryable);

  // ═══════════════════════════════════════════════════════════════════════
  section('Auth header');

  let seenAuth: string | undefined;
  const authed = new ApiClient({
    baseUrl: BASE,
    token: 'static-token',
    transport: mockTransport((spec) => {
      seenAuth = spec.headers?.Authorization;
      return okBody({});
    }),
  });
  await authed.get('/x');
  eq('a static token becomes a bearer header', seenAuth, 'Bearer static-token');

  let calls = 0;
  const dynamic = new ApiClient({
    baseUrl: BASE,
    token: () => `rotating-${++calls}`,
    transport: mockTransport((spec) => {
      seenAuth = spec.headers?.Authorization;
      return okBody({});
    }),
  });
  await dynamic.get('/a');
  await dynamic.get('/b');
  eq('a token getter is called per request', seenAuth, 'Bearer rotating-2');

  const asyncToken = new ApiClient({
    baseUrl: BASE,
    token: async () => 'awaited-token',
    transport: mockTransport((spec) => {
      seenAuth = spec.headers?.Authorization;
      return okBody({});
    }),
  });
  await asyncToken.get('/x');
  eq('an async token getter is awaited', seenAuth, 'Bearer awaited-token');

  const anon = new ApiClient({
    baseUrl: BASE,
    transport: mockTransport((spec) => {
      seenAuth = spec.headers?.Authorization;
      return okBody({});
    }),
  });
  await anon.get('/public/content');
  eq('no token means no Authorization header', seenAuth, undefined);

  let unauthorizedSeen = false;
  const expiring = new ApiClient({
    baseUrl: BASE,
    token: 'stale',
    onUnauthorized: () => {
      unauthorizedSeen = true;
    },
    transport: mockTransport(() => ({ status: 401, headers: {}, body: { success: false, error: { code: 'UNAUTHENTICATED', message: 'expired' } } })),
  });
  await throws('401 propagates', () => expiring.get('/x'), 'UNAUTHENTICATED');
  check('onUnauthorized fires on 401', unauthorizedSeen);

  // ═══════════════════════════════════════════════════════════════════════
  section('Client-side RBAC guard');

  const guardMeta = {
    operationId: 'getLandlords',
    method: 'GET' as const,
    pathTemplate: '/landlords',
    zone: 'BACK_OFFICE' as const,
    roles: ['founder', 'hqExecutive', 'backOfficeStaff'] as never,
    permissions: ['landlordProfile:read'],
    ownership: 'scoped' as const,
    auth: 'required' as const,
  };

  const tenantClient = new ApiClient({
    baseUrl: BASE,
    enforceRbac: true,
    actor: {
      roles: ['tenant'] as never,
      grants: ['tenantProfile:readOwn'],
      allowedZones: ['MEMBER_PORTAL', 'PUBLIC_PORTAL'] as never,
      restrictedZones: ['FOUNDER_COMMAND_CENTER', 'HQ_EXECUTIVE', 'BACK_OFFICE'] as never,
    },
    transport: mockTransport(() => okBody([])),
  });
  await throws(
    'a tenant is blocked from a Back Office route before sending',
    () => tenantClient.get('/landlords', { meta: guardMeta }),
    'CLIENT_FORBIDDEN',
  );

  try {
    await tenantClient.get('/landlords', { meta: guardMeta });
  } catch (e) {
    check('the guard says which gate failed', (e as LrmcClientForbiddenError).reason === 'zone');
  }

  const guardTransport = mockTransport(() => okBody([]));
  const staffClient = new ApiClient({
    baseUrl: BASE,
    enforceRbac: true,
    actor: {
      roles: ['backOfficeStaff'] as never,
      grants: ['landlordProfile:read', 'coordinatorProfile:read'],
      allowedZones: ['BACK_OFFICE', 'MEMBER_PORTAL', 'PUBLIC_PORTAL'] as never,
      restrictedZones: ['FOUNDER_COMMAND_CENTER', 'HQ_EXECUTIVE'] as never,
    },
    transport: guardTransport,
  });
  await staffClient.get('/landlords', { meta: guardMeta });
  eq('back office staff pass the guard', guardTransport.calls.length, 1);

  // Guard off by default: nothing is blocked client-side.
  const ungated = mockTransport(() => okBody([]));
  await new ApiClient({ baseUrl: BASE, actor: { roles: ['tenant'] as never }, transport: ungated }).get(
    '/landlords',
    { meta: guardMeta },
  );
  eq('the guard is off unless enforceRbac is set', ungated.calls.length, 1);

  // Permission-only check, no zone.
  await throws(
    'a missing permission is caught',
    () =>
      new ApiClient({
        baseUrl: BASE,
        enforceRbac: true,
        actor: { roles: ['advertiser'] as never, grants: ['ad:createOwn'] },
        transport: mockTransport(() => okBody({})),
      }).patch('/ad/x/review', {}, { meta: { ...guardMeta, zone: null, permissions: ['ad:approve'] } }),
    'CLIENT_FORBIDDEN',
  );

  // A founder's wildcard must satisfy everything.
  check('founder wildcard satisfies any permission', can(['*:*'], 'adPolicy:update'));
  check('resource wildcard works', can(['ad:*'], 'ad:delete'));
  check('read implies readOwn', can(['property:read'], 'property:readOwn'));
  check('readOwn does not imply read', !can(['property:readOwn'], 'property:read'));

  // ═══════════════════════════════════════════════════════════════════════
  section('Pagination');

  const pageData = [
    [{ id: '1' }, { id: '2' }],
    [{ id: '3' }, { id: '4' }],
    [{ id: '5' }],
  ];
  const paged = new ApiClient({
    baseUrl: BASE,
    transport: mockTransport((spec) => {
      const page = Number(spec.query?.page ?? 1);
      const items = pageData[page - 1] ?? [];
      return okBody(items, {
        page,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNext: page < 3,
        hasPrev: page > 1,
      });
    }),
  });

  const first = await paged.list<{ id: string }>('/landlords', { query: { page: 1, limit: 2 } });
  eq('a page carries its items', first.length, 2);
  eq('a page carries its total', first.total, 5);
  check('a first page has a next', first.hasNext);
  check('a first page has no previous', !first.hasPrev);

  const second = await first.next();
  eq('next() advances the page', second?.meta.page, 2);
  eq('next() returns the right items', second?.items[0]?.id, '3');
  const back = await second?.prev();
  eq('prev() goes back', back?.meta.page, 1);
  eq('the last page has no next', (await (await second?.next())?.next()) ?? null, null);

  const all = await first.collect();
  eq('collect() walks every page', all.length, 5);
  eq('collect() preserves order', all.map((x) => x.id).join(''), '12345');

  const streamed: string[] = [];
  for await (const item of first.stream()) streamed.push(item.id);
  eq('stream() yields every item', streamed.join(''), '12345');

  eq('a page is iterable', [...first].length, 2);
  eq('a page maps', first.map((x) => x.id).join(''), '12');

  // ═══════════════════════════════════════════════════════════════════════
  section('Retries');

  let attempts = 0;
  const flaky = new ApiClient({
    baseUrl: BASE,
    retries: 2,
    retryDelayMs: 1,
    transport: mockTransport(() => {
      attempts += 1;
      return attempts < 3 ? { status: 503, headers: {}, body: undefined } : okBody({ ok: true });
    }),
  });
  const recovered = await flaky.get<{ ok: boolean }>('/x');
  check('a 5xx is retried to success', recovered.ok === true);
  eq('it took three attempts', attempts, 3);

  let noRetryAttempts = 0;
  const permanent = new ApiClient({
    baseUrl: BASE,
    retries: 3,
    retryDelayMs: 1,
    transport: mockTransport(() => {
      noRetryAttempts += 1;
      return { status: 422, headers: {}, body: { success: false, error: { code: 'VALIDATION_FAILED', message: 'no' } } };
    }),
  });
  await throws('a 422 is not retried', () => permanent.post('/x', {}), 'VALIDATION_FAILED');
  eq('a validation failure is attempted once', noRetryAttempts, 1);

  // ═══════════════════════════════════════════════════════════════════════
  section('Multipart');

  const form = toFormData({ file: 'contents', label: 'ID scan', tags: ['a', 'b'] });
  check('toFormData builds a FormData', typeof FormData !== 'undefined' && form instanceof FormData);
  eq('scalar fields are appended', form.get('label'), 'ID scan');
  eq('array fields are appended once per item', form.getAll('tags').length, 2);

  let multipartHeaders: Record<string, string> | undefined;
  const uploader = new ApiClient({
    baseUrl: BASE,
    transport: mockTransport((spec) => {
      multipartHeaders = spec.headers;
      return okBody({});
    }),
  });
  await uploader.post('/landlords', form);
  check(
    'multipart does not get a JSON content-type forced on it',
    multipartHeaders?.['Content-Type'] === undefined,
  );

  // ═══════════════════════════════════════════════════════════════════════
  section('Generated modules');

  const spec = JSON.parse(
    readFileSync(resolve(process.cwd(), '../backend/docs/openapi.json'), 'utf8'),
  ) as { paths: Record<string, Record<string, { operationId: string }>> };

  /* Every module, not just the ones with an expected-method list.
   *
   * This guard was written to catch `list2`, and it did — but it only ran
   * inside the OPERATIONAL_SURFACE loop, so `evidence.get2` shipped anyway. A
   * check that covers most of a surface is a check that will be believed about
   * all of it. */
  for (const [moduleName, mod] of Object.entries(api as Record<string, Record<string, unknown>>)) {
    for (const k of Object.keys(mod).filter((n) => typeof mod[n] === 'function')) {
      check(`${moduleName}.${k}: is not a deduped name`, !/\d$/.test(k),
        'two operations collided; add a NAME_OVERRIDES entry');
    }
  }

  /* ── Method-name and endpoint-name sweeps, over the whole surface ────────
   *
   * The deduped-name guard was widened last week and immediately found
   * `evidence.get2` and `marketplace.get` — a *list* endpoint called `get` —
   * both of which had shipped because the original guard only ran over modules
   * with an expected-method list. These two are the same idea applied to the
   * other two things a generator can get quietly wrong.
   * ─────────────────────────────────────────────────────────────────────── */
  {
    const surface = api as Record<string, Record<string, unknown>>;

    /* Names a caller cannot reason about at the call site. `get(id)` on a
     * module could be a list or an item; `data()` could be anything. These are
     * not style preferences — they are the names that made `marketplace.get`
     * survive review, because nobody reading it knew which one it was. */
    const VAGUE = new Set(['get', 'do', 'run', 'data', 'fetch', 'call', 'post', 'go', 'item']);
    for (const [moduleName, mod] of Object.entries(surface)) {
      for (const fn of Object.keys(mod).filter((k) => typeof mod[k] === 'function')) {
        check(`${moduleName}.${fn}: is not a vague name`, !VAGUE.has(fn),
          'a caller cannot tell what this returns from the call site');
        check(`${moduleName}.${fn}: starts lower-case`, /^[a-z]/.test(fn));
        check(`${moduleName}.${fn}: is not snake_case`, !fn.includes('_'));
      }
    }

    /* A `list`-named method must actually list, and a `getById` must take an
     * id. `marketplace.get` was `GET /orders` — a list — and the name said
     * nothing. This catches the shape rather than the word. */
    for (const [moduleName] of Object.entries(surface)) {
      let meta: Record<string, { method: string; pathTemplate: string }>;
      try {
        meta = ((await import(`../src/modules/${moduleName}.js`)) as {
          META: Record<string, { method: string; pathTemplate: string }>;
        }).META;
      } catch { continue; }

      for (const [fn, m] of Object.entries(meta)) {
        if (!m) continue;
        const takesId = m.pathTemplate.includes('{');
        if (fn === 'list' || fn.startsWith('listFor')) {
          check(`${moduleName}.${fn}: a list method is a GET`, m.method === 'GET');
        }
        if (fn === 'getById') {
          check(`${moduleName}.getById: addresses a single record`, takesId,
            `${m.pathTemplate} takes no id, so this is a list wearing an item's name`);
        }
        if (fn === 'create') {
          check(`${moduleName}.create: is a POST`, m.method === 'POST');
        }
        /* An endpoint path and its method name should not contradict each
         * other. A `read`/`get` name on a POST is the shape that hides a
         * mutation behind a name that reads as safe. */
        if (/^(read|get|list|summary|recent)/.test(fn)) {
          check(`${moduleName}.${fn}: a reading name is a GET`, m.method === 'GET',
            `${m.method} ${m.pathTemplate} — a mutation must not be named like a read`);
        }
      }
    }
  }

  /* ── One deliberate gap between the spec and the client ────────────────
   * Every operation in the spec has a generated function, with one exception:
   * a gateway webhook. Stripe calls it, nothing else can — it authenticates by
   * HMAC over a raw body, which no SDK caller can produce — and generating
   * `payments.webhooksStripe()` would put an endpoint in every consumer's
   * autocomplete that exists only to be misused.
   *
   * Named here rather than silently subtracted, so the coverage rule stays
   * absolute for everything else. A second entry in this list needs a reason
   * as good as this one. */
  const NOT_FOR_CLIENTS = [/^POST \/payments\/webhooks\//];

  const specOps = new Set<string>();
  const withheld: string[] = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const method of Object.keys(methods)) {
      const op = `${method.toUpperCase()} ${path}`;
      if (NOT_FOR_CLIENTS.some((rx) => rx.test(op))) { withheld.push(op); continue; }
      specOps.add(op);
    }
  }
  eq('exactly one operation is withheld from the client', withheld.length, 1);
  eq('and it is the gateway webhook', withheld[0], 'POST /payments/webhooks/stripe');
  /* It is still in the contract, because an integrator has to read about it. */
  check('which is still declared in the spec',
    spec.paths['/payments/webhooks/stripe'] !== undefined);

  const EXPECTED_MODULES = [
    'founders', 'hqExecutives', 'staff', 'coordinators', 'vendors', 'landlords',
    'tenants', 'drivers', 'riders', 'airbnbHosts', 'hotels', 'resorts',
    'rentalCarCompanies', 'properties', 'ads', 'advertisers', 'adPolicy',
    'auth', 'rbac', 'hq', 'public', 'blueprint',
    // Operational surfaces
    'leases', 'maintenanceRequests', 'rides', 'payments', 'notifications',
    'commercialClients', 'payoutBatches', 'documents', 'fac', 'governance',
    // Marketplace: two party collections plus listings, orders and the overview
    'merchant', 'customer', 'marketplace',
    // Lettings: asking to see a property, and asking to live in one
    'viewing', 'application',
    // References, disputes and the Ususu ledger are one surface: they are the
    // same shape of record and they are read together by the scoring engine.
    'evidence',
    // Aggregates. Separate from the collections they count because the reply is
    // a different kind of thing — a number the database produced, scoped to the
    // caller's token, rather than a page of documents.
    'stats',
    // Fault reports in, anomalies out. Nothing on this surface can act against
    // a member — see errorCollector.ts.
    'security',
  ];
  for (const name of EXPECTED_MODULES) {
    check(`module ${name} exists`, name in api, `missing from the api surface`);
  }
  eq('exactly the requested modules are present', Object.keys(api).length, EXPECTED_MODULES.length);

  // Every operation in the spec must be callable, and must hit the right URL.
  const recorder = mockTransport(() => okBody({}));
  const probe = new ApiClient({ baseUrl: BASE, transport: recorder });
  setClient(probe);

  const covered = new Set<string>();
  let functionCount = 0;

  for (const [moduleName, moduleValue] of Object.entries(api)) {
    const mod = moduleValue as Record<string, unknown>;
    const meta = (await import(`../src/modules/${moduleName}.js`)) as {
      META: Record<string, { method: string; pathTemplate: string }>;
    };

    for (const [fnName, fn] of Object.entries(mod)) {
      if (typeof fn !== 'function') continue;
      functionCount += 1;
      const m = meta.META[fnName];
      check(`${moduleName}.${fnName}: has metadata`, m !== undefined);
      if (!m) continue;

      covered.add(`${m.method} ${m.pathTemplate}`);

      // Call it with placeholder ids and assert the URL it produced.
      const paramCount = (m.pathTemplate.match(/\{[^}]+\}/g) ?? []).length;
      const args: unknown[] = Array.from({ length: paramCount }, (_v, i) => `id${i}`);
      const needsBody = ['POST', 'PATCH', 'PUT'].includes(m.method);
      if (needsBody && (fn as (...a: unknown[]) => unknown).length > paramCount + 1) args.push({});

      const before = recorder.calls.length;
      try {
        await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (e) {
        check(`${moduleName}.${fnName}: invocable`, false, (e as Error).message);
        continue;
      }
      const call = recorder.calls[before];
      check(`${moduleName}.${fnName}: issued a request`, call !== undefined);
      if (!call) continue;

      eq(`${moduleName}.${fnName}: uses the declared method`, call.spec.method, m.method);

      let expectedPath = m.pathTemplate;
      let i = 0;
      expectedPath = expectedPath.replace(/\{[^}]+\}/g, () => `id${i++}`);
      eq(`${moduleName}.${fnName}: builds the declared path`, call.spec.path, expectedPath);
    }
  }

  eq('every generated function is metadata-backed', functionCount, covered.size);
  eq('every spec operation is covered', covered.size, specOps.size);

  const missing = [...specOps].filter((op) => !covered.has(op));
  for (const op of missing.slice(0, 10)) check(`spec operation covered: ${op}`, false);

  setClient(null);

  // Using a module before configuring must fail loudly, not silently no-op.
  await throws(
    'calling before configureApi() is a clear error',
    () => api.landlords.list() as Promise<unknown>,
    'CONFIGURATION_ERROR',
  );

  // ═══════════════════════════════════════════════════════════════════════
  section('Operational module bindings');

  /**
   * The six operational surfaces, spelled out by hand.
   *
   * The sweep above proves every spec operation is reachable; it cannot prove
   * the surface is the one a frontend was told to expect. A renamed method is a
   * silent breaking change to every app on the SDK, so the names are pinned.
   */
  const OPERATIONAL_SURFACE: Record<string, string[]> = {
    leases: [
      'list', 'create', 'getById', 'update', 'recordPayment', 'schedule',
      'runRentReminders', 'mineAsTenant', 'mineAsLandlord',
      // The member-portal surface: drawing one up, the three lifecycle acts,
      // and the two reads.
      'draftForMember', 'activate', 'complete', 'terminate',
      'listForUser', 'listForProperty',
    ],
    maintenanceRequests: [
      'list', 'create', 'getById', 'update', 'assignVendor', 'sla', 'runSlaEscalation',
      'myQueue', 'historyForProperty',
      // The member-portal surface: raising one from inside a tenancy, moving it
      // along, and one person's list and summary.
      'request', 'updateStatus', 'listForUser', 'summaryForUser',
    ],
    rides: [
      'list', 'request', 'getById', 'update', 'accept', 'start', 'complete', 'cancel',
      'matches', 'dispatchQueue', 'mineAsDriver', 'mineAsRider',
    ],
    payments: [
      'list', 'getById', 'mineAsTenant', 'mineAsLandlord', 'mineAsDriver', 'mineAsAdvertiser',
      // One person's ledger, one person's summary, and the ledger's single
      // write route — a receipt for cash taken in a room. See the note on the
      // `record` action in config/permissions.ts.
      'history', 'summary', 'record',
    ],
    notifications: ['registerToken', 'inbox', 'sendTest', 'broadcast', 'mark'],
    commercialClients: [
      'list', 'create', 'getById', 'update', 'properties', 'fleet', 'ads', 'analytics',
    ],
    payoutBatches: ['list', 'build', 'getById', 'lines', 'settle', 'cancel'],
    documents: [
      'list', 'create', 'getById', 'update', 'delete',
      'submit', 'review', 'requestInfo', 'verify', 'reject', 'expire', 'reverify',
      'verificationSummary', 'mine', 'queue', 'listAll', 'analytics',
    ],
  };

  for (const [moduleName, methods] of Object.entries(OPERATIONAL_SURFACE)) {
    const mod = (api as Record<string, Record<string, unknown>>)[moduleName];
    check(`${moduleName}: bound into the api surface`, mod !== undefined);
    if (!mod) continue;

    const actual = Object.keys(mod).filter((k) => typeof mod[k] === 'function');
    for (const name of methods) {
      check(`${moduleName}.${name}(): exists`, typeof mod[name] === 'function');
    }
    eq(
      `${moduleName}: exposes exactly ${methods.length} methods`,
      actual.length,
      methods.length,
    );
    /* A name ending in a digit is the deduper's fingerprint: two operations
     * wanted the same method name and one silently became `list2`. That is not
     * a broken build — the compiler is perfectly happy — but a caller writing
     * `list2()` cannot tell from the call site which of the two they picked, or
     * that there was a choice. Fix it with a NAME_OVERRIDES entry naming what
     * the operation actually does. */
    for (const k of actual) {
      check(`${moduleName}.${k}: is not a deduped name`, !/\d$/.test(k),
        'two operations collided; add a NAME_OVERRIDES entry');
    }

    const unexpected = actual.filter((k) => !methods.includes(k));
    for (const k of unexpected) check(`${moduleName}.${k}: is an expected method`, false);
  }

  // Paginated methods must be typed on the element, not on the list schema.
  // `Page<Lease[]>` compiles and is wrong in a way no runtime test would catch.
  for (const moduleName of Object.keys(OPERATIONAL_SURFACE)) {
    const source = readFileSync(
      resolve(process.cwd(), `src/modules/${moduleName}.ts`),
      'utf8',
    );
    const generics = [...source.matchAll(/Promise<Page<([A-Za-z0-9_]+)>>/g)].map((m) => m[1]!);
    check(`${moduleName}: has paginated methods`, generics.length > 0);
    for (const g of new Set(generics)) {
      check(
        `${moduleName}: Page<${g}> is an element type, not a list schema`,
        !g.endsWith('List'),
      );
    }
    check(
      `${moduleName}: does not leak a bare unknown payload`,
      !/Promise<unknown>/.test(source),
    );
  }

  // The three gates travel with each operation, or the RBAC guard has nothing
  // to read and the docs comment lies about who may call it.
  for (const moduleName of Object.keys(OPERATIONAL_SURFACE)) {
    const meta = (await import(`../src/modules/${moduleName}.js`)) as {
      META: Record<string, {
        zone: string | null;
        roles: string[];
        permissions: string[];
        ownership: string;
        auth: string;
      }>;
    };
    for (const [fnName, m] of Object.entries(meta.META)) {
      check(
        `${moduleName}.${fnName}: carries a zone`,
        m.zone !== null && (HQ_ZONES as readonly string[]).includes(m.zone),
      );
      check(`${moduleName}.${fnName}: carries a non-empty role list`, m.roles.length > 0);
      check(
        `${moduleName}.${fnName}: every role is real`,
        m.roles.every((r) => (ROLES as readonly string[]).includes(r)),
      );
      eq(`${moduleName}.${fnName}: requires auth`, m.auth, 'required');
      check(
        `${moduleName}.${fnName}: declares an ownership rule`,
        ['none', 'scoped', 'self'].includes(m.ownership),
      );
    }
  }

  // Member-scoped views must be self-scoped and must address `/me`, never an id.
  const MEMBER_VIEWS: [string, string, string][] = [
    ['leases', 'mineAsTenant', '/tenant/me/leases'],
    ['leases', 'mineAsLandlord', '/landlord/me/leases'],
    ['maintenanceRequests', 'myQueue', '/vendor/me/maintenance-queue'],
    ['rides', 'dispatchQueue', '/driver/me/dispatch-queue'],
    ['rides', 'mineAsDriver', '/driver/me/rides'],
    ['rides', 'mineAsRider', '/rider/me/rides'],
    ['payments', 'mineAsTenant', '/tenant/me/payments'],
    ['payments', 'mineAsLandlord', '/landlord/me/payments'],
    ['payments', 'mineAsDriver', '/driver/me/payments'],
    ['payments', 'mineAsAdvertiser', '/advertiser/me/payments'],
    ['notifications', 'inbox', '/notifications/me'],
  ];
  for (const [moduleName, fnName, path] of MEMBER_VIEWS) {
    const meta = (await import(`../src/modules/${moduleName}.js`)) as {
      META: Record<string, { pathTemplate: string; ownership: string; method: string }>;
    };
    const m = meta.META[fnName];
    check(`${moduleName}.${fnName}: declared`, m !== undefined);
    if (!m) continue;
    eq(`${moduleName}.${fnName}: addresses ${path}`, m.pathTemplate, path);
    eq(`${moduleName}.${fnName}: is self-scoped`, m.ownership, 'self');
    eq(`${moduleName}.${fnName}: is a read`, m.method, 'GET');
    check(`${moduleName}.${fnName}: carries no path parameter`, !m.pathTemplate.includes('{'));
  }

  // The ledger is read-only through the SDK too, not merely on the server.
  {
    const meta = (await import('../src/modules/payments.js')) as {
      META: Record<string, { method: string }>;
    };
    const writes = Object.entries(meta.META).filter(([, m]) => m.method !== 'GET');
    /* The ledger has exactly one door through the SDK, same as on the server.
     * It was zero until this week; see the long note in the backend suite for
     * why recording cash in person had to become possible, and what fences it. */
    eq('payments exposes exactly one write method', writes.length, 1);
    eq('and it is the in-person receipt', writes[0]?.[0], 'record');
    eq('by POST', writes[0]?.[1].method, 'POST');
  }

  // Payout batches are the *only* place a client can cause money to leave the
  // platform, and releasing one is Zone A. If that ever relaxes, this fails.
  {
    const meta = (await import('../src/modules/payoutBatches.js')) as {
      META: Record<string, { method: string; zone: string | null; permissions: string[]; roles: string[] }>;
    };
    eq('settling a batch is Zone A', meta.META.settle!.zone, 'FOUNDER_COMMAND_CENTER');
    eq('and the founder is the only role that can', meta.META.settle!.roles.join(','), 'founder');
    check('gated on payout:settle', meta.META.settle!.permissions.includes('payout:settle'));
    eq('building a batch is Back Office', meta.META.build!.zone, 'BACK_OFFICE');
    check(
      'a batch is never edited — no PATCH anywhere in the module',
      Object.values(meta.META).every((m) => m.method !== 'PATCH'),
    );
    check(
      'no member role reaches any payout route',
      Object.values(meta.META).every((m) =>
        m.roles.every((r) => !['tenant', 'landlord', 'driver', 'rider', 'advertiser', 'vendor'].includes(r)),
      ),
    );
  }

  // The job endpoints are Back Office triggers, not member surfaces. A cron that
  // any tenant could fire is a notification-spam vector.
  for (const [moduleName, fnName] of [
    ['leases', 'runRentReminders'],
    ['maintenanceRequests', 'runSlaEscalation'],
  ] as const) {
    const meta = (await import(`../src/modules/${moduleName}.js`)) as {
      META: Record<string, { method: string; zone: string | null; roles: string[] }>;
    };
    const m = meta.META[fnName]!;
    eq(`${moduleName}.${fnName}: is a POST`, m.method, 'POST');
    eq(`${moduleName}.${fnName}: is Back Office`, m.zone, 'BACK_OFFICE');
    check(
      `${moduleName}.${fnName}: no member role can fire it`,
      m.roles.every((r) => !['tenant', 'landlord', 'driver', 'rider', 'advertiser'].includes(r)),
    );
  }

  // The Document Engine's own invariants, pinned at the binding layer.
  {
    const meta = (await import('../src/modules/documents.js')) as {
      META: Record<string, { method: string; zone: string | null; roles: string[]; ownership: string; permissions: string[] }>;
    };

    // Every lifecycle step is a POST on the singular item. A GET that changed
    // state, or a transition on the collection, would break every client's
    // retry logic.
    for (const step of ['submit', 'review', 'requestInfo', 'verify', 'reject', 'expire', 'reverify']) {
      eq(`documents.${step}: is a POST`, meta.META[step]!.method, 'POST');
    }

    // Who may do what. The holder submits from the member portal; everything
    // else is a reviewing desk behind the Back Office gate.
    eq('submitting is a member act', meta.META.submit!.zone, 'MEMBER_PORTAL');
    for (const step of ['review', 'requestInfo', 'verify', 'reject', 'expire', 'reverify']) {
      eq(`documents.${step}: is Back Office`, meta.META[step]!.zone, 'BACK_OFFICE');
      for (const role of ['tenant', 'landlord', 'driver', 'rider', 'advertiser']) {
        check(
          `documents.${step}: a ${role} cannot perform it`,
          !meta.META[step]!.roles.includes(role),
        );
      }
    }
    check('verifying is gated on document:verify', meta.META.verify!.permissions.includes('document:verify'));

    // The HQ reads are Zone B and reach nobody below it.
    for (const view of ['listAll', 'analytics']) {
      eq(`documents.${view}: is Zone B`, meta.META[view]!.zone, 'HQ_EXECUTIVE');
      eq(`documents.${view}: reaches HQ alone`, meta.META[view]!.roles.join(','), 'founder,hqExecutive');
    }

    // A member's own view is self-scoped; a reviewer's queue is too, and no
    // member role can read it.
    eq('documents.mine: is self-scoped', meta.META.mine!.ownership, 'self');
    eq('documents.queue: is self-scoped', meta.META.queue!.ownership, 'self');
    eq('documents.mine: is a member view', meta.META.mine!.zone, 'MEMBER_PORTAL');
    eq('documents.queue: is a Back Office view', meta.META.queue!.zone, 'BACK_OFFICE');
    for (const role of ['tenant', 'landlord', 'driver', 'rider', 'advertiser']) {
      check(`documents.queue: a ${role} cannot read a reviewer's queue`, !meta.META.queue!.roles.includes(role));
      check(`documents.mine: a ${role} can read their own documents`, meta.META.mine!.roles.includes(role));
    }
  }

  // A verified document's evidence must never be addressable by a permanent URL
  // in a response type. The storage key is `writeOnly` in the spec, so it must
  // be absent from `Document` and present on `DocumentInput`.
  {
    const source = readFileSync(resolve(process.cwd(), 'src/types/index.ts'), 'utf8');
    // `Document` renders as an intersection (it composes `LifecycleFields`), so
    // match either form rather than assuming `interface`.
    const declOf = (name: string): string => {
      const iface = new RegExp(`export interface ${name} \\{[\\s\\S]*?\\n\\}`).exec(source);
      if (iface) return iface[0];
      const alias = new RegExp(`export type ${name} = [\\s\\S]*?\\n\\}\\);`).exec(source);
      return alias?.[0] ?? '';
    };
    const documentType = declOf('Document');
    const documentInput = declOf('DocumentInput');
    check('the Document response type exists', documentType.length > 0);
    check('storageKey is absent from the response type', !/storageKey/.test(documentType));
    check('but present on the request type', /storageKey/.test(documentInput));
    check('and status is absent from the request type', !/\bstatus\??:/.test(documentInput));
  }

  // The FAC bindings. This is the platform's most privileged surface, so the
  // zones and roles are pinned rather than merely swept.
  {
    const meta = (await import('../src/modules/fac.js')) as {
      META: Record<string, { method: string; pathTemplate: string; zone: string | null; roles: string[]; permissions: string[]; auth: string }>;
    };
    const surface = ['listGenerations', 'issue', 'getGeneration', 'revoke', 'attempts',
      'clearance', 'verify', 'standDown', 'requestReset', 'lockouts', 'lockoutClear'];
    for (const name of surface) check(`fac.${name}(): exists`, meta.META[name] !== undefined);
    eq('fac exposes exactly its declared surface',
      Object.keys((api as Record<string, Record<string, unknown>>).fac!).filter(
        (k) => typeof (api as Record<string, Record<string, unknown>>).fac![k] === 'function').length,
      surface.length);

    // Issuing and revoking are Zone A and founder-alone. If that ever relaxes,
    // somebody other than a principal can mint the key to the whole platform.
    for (const name of ['issue', 'revoke', 'listGenerations', 'getGeneration', 'attempts',
      'lockouts', 'lockoutClear']) {
      eq(`fac.${name}: is Zone A`, meta.META[name]!.zone, 'FOUNDER_COMMAND_CENTER');
      eq(`fac.${name}: reaches the founder alone`, meta.META[name]!.roles.join(','), 'founder');
    }

    // Verification must NOT be Zone A — the code is what opens Zone A, so
    // gating it there would be a locked door with the key inside.
    eq('fac.verify: is Zone B, not Zone A', meta.META.verify!.zone, 'HQ_EXECUTIVE');
    check('and is reachable by the HQ executive who needs it',
      meta.META.verify!.roles.includes('hqExecutive'));
    for (const role of ['tenant', 'landlord', 'driver', 'rider', 'advertiser', 'vendor', 'coordinator', 'backOfficeStaff']) {
      check(`fac.verify: a ${role} cannot submit a code`, !meta.META.verify!.roles.includes(role));
    }
    eq('fac.clearance: is Zone B', meta.META.clearance!.zone, 'HQ_EXECUTIVE');

    // The override is a way back in, not a way around. It sits in Zone A, so
    // the founder using it has already entered their own code — it can never
    // cost less than the lockout it lifts.
    check('fac.lockoutClear: takes an actor id, so it can only ever be used on somebody else',
      meta.META.lockoutClear!.pathTemplate.includes('{actorId}'));
    check('fac.lockoutClear: demands a body, so a reason is not optional',
      /lockoutClear\(actorId: string, body: ClearLockoutRequest/.test(
        readFileSync(resolve(process.cwd(), 'src/modules/fac.ts'), 'utf8')));
    check('every FAC operation requires authentication',
      Object.values(meta.META).every((m) => m.auth === 'required'));
  }

  // Governance reads descend by tier: the matrix and tiers are a staff read,
  // health is HQ, and every member can ask what they themselves may see.
  {
    const meta = (await import('../src/modules/governance.js')) as {
      META: Record<string, { zone: string | null; roles: string[]; ownership: string }>;
    };
    eq('governance.tiers: is Back Office', meta.META.tiers!.zone, 'BACK_OFFICE');
    eq('governance.visibilityMatrix: is Back Office', meta.META.visibilityMatrix!.zone, 'BACK_OFFICE');
    eq('governance.health: is HQ', meta.META.health!.zone, 'HQ_EXECUTIVE');
    eq('governance.myVisibility: is a member read', meta.META.myVisibility!.zone, 'MEMBER_PORTAL');
    eq('and is self-scoped', meta.META.myVisibility!.ownership, 'self');
    for (const role of ['tenant', 'driver', 'advertiser']) {
      check(`a ${role} can ask what they may see`, meta.META.myVisibility!.roles.includes(role));
      check(`but a ${role} cannot read the tier structure`, !meta.META.tiers!.roles.includes(role));
      check(`nor governance health`, !meta.META.health!.roles.includes(role));
    }
  }

  // The code must never be a readable field anywhere in the generated types.
  {
    const source = readFileSync(resolve(process.cwd(), 'src/types/index.ts'), 'utf8');
    const codeType = /export type FacCode = [\s\S]*?\n\}\);/.exec(source)?.[0]
      ?? /export interface FacCode \{[\s\S]*?\n\}/.exec(source)?.[0] ?? '';
    check('the FacCode type exists', codeType.length > 0);
    check('and carries no hash field', !/codeHash/.test(codeType));
    check('nor a plaintext code field', !/\bcode\??:/.test(codeType));
    // The one place a plaintext code appears is the issuance response.
    const issuance = /export interface FacIssuance \{[\s\S]*?\n\}/.exec(source)?.[0] ?? '';
    check('the issuance response does carry the code', /\bcode\??:/.test(issuance));
    check('and says it is shown once', /issuedOnce/.test(issuance));
    // And the verify request carries it write-only, so it is absent from the
    // response variant a client would ever hold.
    const verifyReq = /export interface VerifyFacCodeRequest \{[\s\S]*?\n\}/.exec(source)?.[0] ?? '';
    check('the verify request declares the code', /\bcode\??:/.test(verifyReq));
  }

  // Broadcast is HQ-only for the same reason, one level up.
  {
    const meta = (await import('../src/modules/notifications.js')) as {
      META: Record<string, { zone: string | null; roles: string[] }>;
    };
    eq('broadcast is Zone B', meta.META.broadcast!.zone, 'HQ_EXECUTIVE');
    eq('and reaches HQ alone', meta.META.broadcast!.roles.join(','), 'founder,hqExecutive');
  }

  // ═══════════════════════════════════════════════════════════════════════
  section('Generated constants');

  eq('19 roles', ROLES.length, 19);
  eq('5 HQ zones', HQ_ZONES.length, 5);
  check('roles include founder', (ROLES as readonly string[]).includes('founder'));
  check('zones include the Founder Command Center', (HQ_ZONES as readonly string[]).includes('FOUNDER_COMMAND_CENTER'));

  // ═══════════════════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(62)}`);
  if (failures.length === 0) {
    console.log(`✓ all ${passed} SDK checks passed`);
  } else {
    console.log(`✗ ${failures.length} of ${passed + failures.length} SDK checks failed:\n`);
    for (const f of failures.slice(0, 40)) console.log(`   • ${f}`);
    if (failures.length > 40) console.log(`   … and ${failures.length - 40} more`);
  }
  console.log('═'.repeat(62));
  process.exit(failures.length === 0 ? 0 : 1);
}

void main();
