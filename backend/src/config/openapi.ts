import {
  API_BLUEPRINT,
  resolveBlueprint,
  type EndpointSpec,
  type ResolvedEndpoint,
} from './apiBlueprint.js';
import { HQ_ZONE_DEFINITIONS, HQ_ZONES } from './hqZones.js';
import { ROLES } from './roles.js';
import {
  COMPONENT_SCHEMAS,
  REQUEST_SCHEMA_BY_NAME,
  RESPONSE_SCHEMA_BY_LABEL,
  type JsonSchema,
} from './openapiSchemas.js';

/**
 * Builds the OpenAPI 3.1 document from the same blueprint the routers and the
 * markdown reference come from.
 *
 * Generated rather than hand-maintained for one reason: a spec that disagrees
 * with the server is worse than no spec, because a generated client will compile
 * against the lie. Here, `x-roles` is computed from `ROLE_DEFINITIONS` and every
 * path comes from the blueprint, so the three artefacts cannot diverge.
 */

export interface OpenApiOptions {
  version?: string;
  servers?: { url: string; description: string }[];
}

/**
 * The consortium's domain hierarchy — one API behind four public faces.
 *
 * Order is deliberate: HQ first, then the surfaces it oversees, then Ususu, then
 * local. A client generator takes the first entry as its default base URL, so
 * the institutional domain leads.
 *
 * These must stay in step with `CORS_ORIGINS` in the environment — a server
 * listed here that CORS rejects is a contract that cannot be honoured from a
 * browser. `npm run verify` asserts the list.
 */
export const DEFAULT_SERVERS = [
  {
    url: 'https://api.lrmconsortium.africa/api/v1',
    description: 'LRMC HQ (Institutional Command Center)',
  },
  { url: 'https://api.lrmconsortium.com/api/v1', description: 'LRMC Public Portal' },
  { url: 'https://api.africalrmc.com/api/v1', description: 'LRMC PR & Communications' },
  { url: 'https://api.africaususu.com/api/v1', description: 'Ususu Rideshare Platform' },
  { url: 'http://localhost:3000/api/v1', description: 'Local Development' },
] as const satisfies readonly { url: string; description: string }[];

/** `/landlord/:landlordId` → `/landlord/{landlordId}` */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}');
}

export function pathParameters(path: string): JsonSchema[] {
  const names = [...path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]!);
  return names.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema:
      name.endsWith('Id')
        ? { type: 'string', pattern: '^[a-f\\d]{24}$' }
        : { type: 'string' },
    description: name.endsWith('Id') ? 'Mongo ObjectId.' : undefined,
  }));
}

const LIST_QUERY_PARAMS: JsonSchema[] = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
  { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Mongoose sort, e.g. `-createdAt`.' },
  { name: 'search', in: 'query', schema: { type: 'string', maxLength: 120 } },
  { name: 'includeDeleted', in: 'query', schema: { type: 'boolean', default: false } },
  { name: 'status', in: 'query', schema: { type: 'string' } },
  { name: 'verificationStatus', in: 'query', schema: { type: 'string' } },
  { name: 'region', in: 'query', schema: { type: 'string' } },
];

/** The data payload for one endpoint, before it is wrapped in the envelope. */
function dataSchema(ep: EndpointSpec): JsonSchema | null {
  // An explicit declaration always wins. Parsing prose out of `responseShape`
  // works for the generic CRUD surface; it cannot describe a dashboard.
  if (ep.responseSchema) {
    if (!COMPONENT_SCHEMAS[ep.responseSchema]) {
      throw new Error(
        `${ep.method} ${ep.path} declares responseSchema "${ep.responseSchema}", which is not a component schema`,
      );
    }
    return { $ref: `#/components/schemas/${ep.responseSchema}` };
  }

  const shape = ep.responseShape;

  // `{ success, data: X[], meta: PageMeta }`
  const listMatch = /data:\s*([A-Za-z ]+?)\[\]/.exec(shape);
  if (listMatch) {
    const name = RESPONSE_SCHEMA_BY_LABEL[listMatch[1]!.trim()] ?? listMatch[1]!.trim();
    return COMPONENT_SCHEMAS[name]
      ? { type: 'array', items: { $ref: `#/components/schemas/${name}` } }
      : { type: 'array', items: { type: 'object' } };
  }

  // `{ success, data: X }`
  const oneMatch = /data:\s*([A-Za-z ]+?)\s*\}/.exec(shape);
  if (oneMatch) {
    const label = oneMatch[1]!.trim();
    const name = RESPONSE_SCHEMA_BY_LABEL[label] ?? label;
    if (COMPONENT_SCHEMAS[name]) return { $ref: `#/components/schemas/${name}` };
  }

  if (shape.startsWith('204')) return null;
  return { type: 'object' };
}

function isPaginated(ep: EndpointSpec): boolean {
  return ep.responseShape.includes('meta: PageMeta');
}

function successResponse(ep: EndpointSpec): JsonSchema {
  if (ep.responseShape.startsWith('204')) {
    return { '204': { description: 'No content. The record is archived, not removed.' } };
  }

  const data = dataSchema(ep);

  // A raw document, not the platform envelope.
  if (ep.enveloped === false) {
    return {
      '200': {
        description: ep.summary,
        content: { 'application/json': { schema: data ?? { type: 'object' } } },
      },
    };
  }

  const envelope: JsonSchema = {
    type: 'object',
    properties: {
      success: { type: 'boolean', const: true },
      ...(data ? { data } : {}),
      ...(isPaginated(ep) ? { meta: { $ref: '#/components/schemas/PageMeta' } } : {}),
    },
    required: ['success', ...(data ? ['data'] : [])],
  };

  const status = ep.method === 'POST' && !ep.responseShape.startsWith('202') ? '201' : '200';
  const code = ep.responseShape.startsWith('202') ? '202' : status;

  return {
    [code]: {
      description: ep.summary,
      content: { 'application/json': { schema: envelope } },
    },
  };
}

function errorResponses(ep: EndpointSpec): JsonSchema {
  const err = (description: string): JsonSchema => ({
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  });

  const responses: JsonSchema = {};
  if (ep.requestBody || ep.requestQuery) responses['422'] = err('Request validation failed.');
  if (ep.auth === 'optional') {
    responses['403'] = err('Authenticated, but not permitted on this surface.');
  }
  if (ep.auth === 'required') {
    responses['401'] = err('Missing, expired or invalid access token.');
    responses['403'] =
      ep.zone === 'FOUNDER_COMMAND_CENTER'
        ? // Zone A carries a fourth gate the other zones do not, and a client
          // has to be able to tell its refusal apart from the others. Same
          // status, different `error.code`: ZONE_RESTRICTED means stop, you
          // will never be allowed here; CLEARANCE_REQUIRED means you are
          // entitled and one step short — enter your Founder Authorisation
          // Code. A console that conflates them either nags people who cannot
          // succeed or swallows the prompt a founder was waiting for.
          err(
            `Zone ${ep.zone} is restricted for this role, the required permission is not held ` +
              '(`ZONE_RESTRICTED`), or no live FAC clearance is held (`CLEARANCE_REQUIRED`, with ' +
              '`error.details[0].reason` of `clearanceRequired` or `noActiveCode`).',
          )
        : ep.zone
          ? err(`Zone ${ep.zone} is restricted for this role, or the required permission is not held.`)
          : err('The required permission is not held.');
  }
  if (ep.path.includes(':') || ep.responseShape.includes('data:')) {
    responses['404'] = err('Not found, or not visible at this actor’s scope.');
  }
  if (ep.rateLimit) responses['429'] = err('Rate limit exceeded.');
  responses['500'] = err('Internal error.');
  return responses;
}

function operation(ep: ResolvedEndpoint): JsonSchema {
  const params = [
    ...pathParameters(ep.path),
    ...(ep.requestQuery === 'listQuery' ? LIST_QUERY_PARAMS : []),
  ];

  const bodySchema = ep.requestBody ? REQUEST_SCHEMA_BY_NAME[ep.requestBody] : undefined;

  const op: JsonSchema = {
    operationId: operationId(ep),
    summary: ep.summary,
    tags: [ep.module],
    ...(ep.notes ? { description: ep.notes } : {}),

    // Non-standard, deliberately: these are the three gates the middleware
    // applies, published so a gateway or a frontend can reason about them.
    'x-zone': ep.zone ?? null,
    'x-roles': ep.roles,
    'x-permissions': ep.permissions,
    'x-ownership': ep.ownership,
    ...(ep.audited ? { 'x-audited': true } : {}),
    ...(ep.rateLimit ? { 'x-rate-limit': ep.rateLimit } : {}),

    // OpenAPI encodes "optional auth" as an empty requirement object alongside
    // the real one. Without the `{}`, Swagger UI and every client generator
    // treat the anonymous public endpoints as bearer-required — which is exactly
    // backwards for the property search and the public content reads.
    security:
      ep.auth === 'none'
        ? []
        : ep.auth === 'optional'
          ? [{}, { bearerAuth: [] }]
          : [{ bearerAuth: [] }],
    ...(params.length ? { parameters: params } : {}),
    ...(bodySchema
      ? {
          requestBody: {
            required: ep.method === 'POST' || ep.method === 'PUT',
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${bodySchema}` } },
            },
          },
        }
      : {}),
    responses: { ...successResponse(ep), ...errorResponses(ep) },
  };

  return op;
}

/** Stable, readable ids: `getLandlords`, `patchLandlordByLandlordId`. */
export function operationId(ep: EndpointSpec): string {
  const segments = ep.path.split('/').filter(Boolean);
  const words = segments.map((s) =>
    s.startsWith(':')
      ? `By${s.slice(1).replace(/^./, (c) => c.toUpperCase())}`
      : s.replace(/(^|-)([a-z])/g, (_m, _d, c: string) => c.toUpperCase()),
  );
  const base = words.join('') || 'Root';
  return `${ep.method.toLowerCase()}${base}`;
}

export function buildOpenApiDocument(options: OpenApiOptions = {}): JsonSchema {
  const endpoints = resolveBlueprint();
  const paths: Record<string, JsonSchema> = {};

  for (const ep of endpoints) {
    const key = toOpenApiPath(ep.path);
    paths[key] ??= {};
    (paths[key] as Record<string, unknown>)[ep.method.toLowerCase()] = operation(ep);
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'LRMC + Ususu Unified API',
      version: options.version ?? '1.0.0',
      description:
        'Legacy Rental Management Consortium + Ususu Rideshare unified African institutional platform. ' +
        'Includes HQ zones, member portal, public portal, commercial clients, and advertising.\n\n' +
        'Route convention: **plural for collections, singular for items** — `/landlords` for the set, ' +
        '`/landlord/{landlordId}` for the one.\n\n' +
        'Every authenticated request passes three gates: zone (`x-zone`), permission (`x-permissions`), ' +
        'then ownership (`x-ownership`). `x-roles` lists the roles that clear all three; it is computed ' +
        'from the RBAC configuration, not hand-maintained.\n\n' +
        'All responses are enveloped: `{ success, data, meta? }` or `{ success: false, error }`.',
    },
    servers: options.servers ?? DEFAULT_SERVERS,
    tags: tagList(),
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: COMPONENT_SCHEMAS,
    },
    paths,
    'x-hq-zones': HQ_ZONES.map((z) => {
      const d = HQ_ZONE_DEFINITIONS[z];
      return { code: d.code, key: d.key, label: d.label, purpose: d.purpose, surfaces: d.surfaces };
    }),
    'x-roles-catalogue': ROLES,
  };
}

const TAG_DESCRIPTIONS: Record<string, string> = {
  platform: 'Index and the live machine-readable contract.',
  auth: 'Registration, sessions, the caller’s own authorisation picture, and Founder appointment.',
  hq: 'HQ zone directory, executive dashboards, and the Zone A audit trail.',
  founder: 'Founder profile — Zone A.',
  hqExecutive: 'HQ executive profiles.',
  backOfficeStaff: 'Back office staff records — Zone C.',
  landlord: 'Landlords.',
  tenant: 'Tenants.',
  coordinator: 'Coordinators — the LRMC field officers.',
  vendor: 'Vendors.',
  property: 'Properties: rentals, short-lets, hotel rooms and resort villas.',
  airbnbHost: 'Airbnb hosts.',
  hotel: 'Hotels.',
  resort: 'Resorts.',
  rentalCarCompany: 'Rental car companies and their fleets.',
  driver: 'Ususu drivers.',
  rider: 'Ususu riders.',
  advertiser: 'Advertiser accounts.',
  advertising: 'Ad serving, tracking, lifecycle and Founder policy.',
  lease: 'Leases: the contract between a landlord and a tenant, and the rent recorded against it.',
  maintenance: 'Maintenance work orders, vendor assignment and property history.',
  ride: 'Ususu ride dispatch: request, accept, start, complete, cancel.',
  payment: 'The single money ledger — rent, deposits, fares, payouts, ad spend, fees and refunds.',
  payout: 'Outbound transfer batches: built by Back Office from the ledger, released by the Founder.',
  document: 'The Document Engine: submission, review, compliance, scoring, expiry and the append-only audit trail.',
  fac: 'The Founder Authorisation Code — issuance, verification, lockout and the attempt ledger. Sits in front of Zone A.',
  governance: 'Governance tiers, the seal visibility matrix, and institutional health.',
  notification: 'Push token registration, member inboxes and HQ test sends.',
  commercialClient: 'Commercial client accounts: the contracting entity above the operational profiles.',
  publicPortal: 'Public content, traffic and conversion metrics.',
};

function tagList(): JsonSchema[] {
  const seen = new Set(API_BLUEPRINT.map((e) => e.module));
  return [...seen].map((name) => ({
    name,
    ...(TAG_DESCRIPTIONS[name] ? { description: TAG_DESCRIPTIONS[name] } : {}),
  }));
}

/**
 * Every `$ref` in the document must resolve. Asserted by `npm run verify`,
 * because a dangling ref makes the whole spec unusable to a code generator and
 * is trivially easy to introduce.
 */
export function danglingRefs(doc: JsonSchema): string[] {
  const schemas = ((doc.components as JsonSchema)?.schemas ?? {}) as Record<string, unknown>;
  const missing = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const name = value.replace('#/components/schemas/', '');
        if (!(name in schemas)) missing.add(value);
      } else {
        walk(value);
      }
    }
  };

  walk(doc);
  return [...missing].sort();
}
