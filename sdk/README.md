# @lrmc/sdk

The unified TypeScript client for the **LRMC + Ususu** API. One package for the
founder console, HQ dashboard, back office, member portal, Ususu app and the
public sites.

- **251 operations** across **30 modules**, generated from the OpenAPI spec
- **159 schemas** as TypeScript types, with `writeOnly` fields absent from
  response types and `readOnly` fields absent from request types
- **fetch in the browser, axios in Node / server / mobile** — selected at first
  use, no configuration
- Envelope unwrapping, one error type, pagination helpers, multipart, retries
- Optional client-side RBAC and zone checks, using the same `x-zone` / `x-roles`
  metadata the server enforces

```bash
npm install @lrmc/sdk
npm install axios     # optional — Node/RN only; Node 18+ works without it
```

## Start here

```ts
import { configureApi, api } from '@lrmc/sdk';

configureApi({
  baseUrl: 'https://api.lrmconsortium.africa/api/v1',
  token: () => localStorage.getItem('accessToken'),
});

const { accessToken, user } = await api.auth.login({
  email: 'coordinator@africalrmc.com',
  password: '…',
});

const page = await api.landlords.list({ query: { search: 'Asante', limit: 25 } });
for await (const landlord of page.stream()) {
  console.log(landlord.fullName, landlord.diasporaStatus);
}
```

Every module follows the same shape:

```ts
api.landlords.list()                      // GET    /landlords     → Page<Landlord>
api.landlords.create(body)                // POST   /landlords     → Landlord
api.landlords.getById(id)                 // GET    /landlord/:id  → Landlord
api.landlords.update(id, body)            // PATCH  /landlord/:id  → Landlord
api.landlords.delete(id)                  // DELETE /landlord/:id  → void
api.landlords.me()                        // GET    /landlord/me   → Landlord
api.landlords.updateMe(body)              // PATCH  /landlord/me   → Landlord
api.landlords.verify(id, { status: 'verified' })
api.landlords.restore(id)
```

## Transport selection

| Runtime | Transport | Why |
|---|---|---|
| Browser | `fetch` | Already there; nothing to bundle |
| Web / service worker | `fetch` | Same |
| Node.js | `axios`, falling back to `fetch` | axios is an optional peer dependency |
| React Native | `axios`, falling back to `fetch` | Same |

Selection is **lazy** — the first request decides, so importing the SDK costs
nothing and a browser bundle never pulls axios in. Override it when you need to:

```ts
import { configureApi, createFetchTransport } from '@lrmc/sdk';

configureApi({ baseUrl, transport: createFetchTransport(myFetch) });
```

## Responses and errors

The API envelopes everything as `{ success, data, meta? }`. The SDK unwraps it,
so you work with `data`; list calls return a `Page<T>` carrying `meta`.

Every failure — server, network, timeout, abort, malformed body — arrives as a
single `LrmcApiError`, so one `catch` covers all of them:

```ts
import { LrmcApiError } from '@lrmc/sdk';

try {
  await api.tenants.create(form);
} catch (err) {
  if (err instanceof LrmcApiError) {
    if (err.isAuthError) return redirectToLogin();
    if (err.code === 'VALIDATION_FAILED') return showFieldErrors(err.fieldErrors);
    if (err.isRetryable) return scheduleRetry();
  }
  throw err;
}
```

`err.fieldErrors` is `Record<string, string[]>`, ready to bind to form inputs.

## Pagination

```ts
const page = await api.drivers.list({ query: { limit: 50, verificationStatus: 'pending' } });

page.items          // Driver[]
page.total          // 412
page.hasNext        // true
await page.next()   // Page<Driver> | null
await page.collect()// every remaining item, up to maxPages
for await (const d of page.stream()) { … }   // streams, never buffers the lot
```

## Optional client-side RBAC

The SDK ships every operation's `x-zone`, `x-roles` and `x-permissions`. Feed it
the `authorization` block from `GET /auth/me` and it can refuse calls the server
would reject anyway:

```ts
const me = await api.auth.me();
configureApi({ baseUrl, token, enforceRbac: true, actor: {
  roles: me.user.roles,
  grants: me.authorization.grants,
  allowedZones: me.authorization.allowedZones,
  restrictedZones: me.authorization.restrictedZones,
}});

await api.landlords.list();   // throws LrmcClientForbiddenError for a tenant,
                              // without a round trip
```

> **This is a UX affordance, not a security boundary.** The server enforces the
> same three gates and is the only thing that matters. This just saves a request
> on a button the user was never going to be allowed to press. Never rely on it
> to protect anything.

Reading the metadata directly is often more useful than catching the error — it
is how you grey out a control instead of letting someone click it:

```ts
import { landlordsMeta } from '@lrmc/sdk';
const canCreate = landlordsMeta.create.roles.includes(myRole);
```

## Uploads

```ts
import { toFormData } from '@lrmc/sdk';

await api.drivers.update(driverId, toFormData({
  driverLicensePhoto: fileInput.files[0],
  vehiclePhotos: [...morePhotos],
}) as never);
```

Content-Type is left to the runtime so the multipart boundary is set correctly.

## Package layout

```
src/
├── client/
│   ├── fetchClient.ts   browser transport, zero dependencies
│   ├── axiosClient.ts   Node / RN transport, axios optional & dynamically imported
│   ├── autoClient.ts    runtime detection and lazy selection
│   ├── ApiClient.ts     envelope, errors, auth, RBAC guard, retries, pagination
│   └── types.ts         the transport contract
├── modules/             30 generated modules — one per API area
└── types/
    ├── index.ts         159 schemas (generated)
    ├── envelope.ts      { success, data, meta }
    ├── errors.ts        LrmcApiError and friends
    ├── pagination.ts    Page<T>, stream(), collect()
    ├── roles.ts         15 roles + the permission matcher (generated)
    └── zones.ts         5 HQ zones + 3 ad zones (generated)
```

`client/` and the four hand-written files in `types/` are the runtime — that is
where the judgement lives. Everything else is **generated** from
`backend/docs/openapi.json` by `npm run generate`, so the SDK cannot drift from
the API. Change the backend, regenerate, and the compiler shows you every call
site that needs updating.

## Scripts

```bash
npm run generate    # regenerate types and modules from the OpenAPI spec
npm run typecheck   # tsc --noEmit
npm run verify      # 1,736 runtime checks, no server needed
npm run build       # generate + tsup → ESM, CJS, .d.ts
npm test            # all three
```

`npm run verify` exercises the parts that are easy to get quietly wrong:
transport selection across four runtimes, envelope unwrapping, error
normalisation through **both** transports, the auth header, the RBAC guard,
pagination traversal, retry behaviour, multipart, and — the important one — it
**invokes all 251 generated operations against a mock transport and asserts each
one issues the method and URL its metadata declares**. The suite is
mutation-tested: breaking transport selection and the envelope unwrap produced
exactly the expected failures.
