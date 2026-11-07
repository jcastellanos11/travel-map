# E3.1 — Frontend integration foundation

Validation date: 2026-11-07. Starting commit: `fbaf4ea`.

Status: implementation and automated checks completed locally; authenticated
browser GET acceptance remains pending user login. E3.2 has not started.

## Scope and approved decisions

- **D-E3-01:** browser API interactions use the existing single HTTPS origin,
  `https://127.0.0.1:8789`. Relative API paths, browser-managed same-origin cookies,
  no CORS/proxy/alternative auth/cookie fallback.
- **D-E3-02:** demo remains independent. No imports of private API data into
  `App`, `WorldMap`, markers, boundaries, memory panels, gallery or welcome modal.
  No demo records/images were imported into accounts. No visual mode selector.
- **D-E3-03:** Trip/Visit/map DTOs make no assumption that their viewer may read
  the parent Project. No navigation, permission inference or Guest screens.
- **D-E3-04:** small fetch client and local React state/AbortController; no new
  runtime/development dependencies or global state framework.

The existing uncommitted `backend/supabase/config.toml` change was present before
this work and has been left untouched. No migrations, SQL, backend HTTP handlers,
OAuth configuration, credentials, lockfiles or domain policies changed.

## Same-origin architecture

`backend/scripts/frontend-dev.ts` builds Vite in **integration mode** and attaches
only ignored local static assets through Wrangler's existing `--assets` dev CLI.
It explicitly uses `--local --env dev --ip 127.0.0.1 --port 8789
--local-protocol https`. It refuses an occupied 8789 rather than silently selecting
a different OAuth/cookie origin. No Vite server is exposed, and Docker networking
is unchanged. The original `npm run dev` command still works without these assets.

| Path | Purpose |
| --- | --- |
| `/__local/integration/` | Separate React GET-only diagnostic |
| `/demo/` | Existing static demo, built with base `/demo/` |
| `/demo/data/`, `/demo/images/` | Existing public demo assets only |
| `/api/v1/*`, `/health`, OAuth callback, `/invite` | Existing Worker routing/behavior |
| `/api-docs`, `/openapi.json` | Existing dev-only documentation |
| `/__local/api-test/` | Preserved when the existing ignored local installation exists |

Root `/` retains the existing Worker 404 behavior. OAuth still returns there;
return manually to the diagnostic after login. No catch-all SPA fallback masks
API errors or changes invitation/auth redirects. This deliberately small setup
uses build/restart, not HMR, to avoid a WebSocket proxy or weaker CSP.

The diagnostic document allows only same-origin external script/style/connect,
with no inline/eval exception, no forms/frames, no referrers and no-store headers.
The demo document separately permits its existing geoBoundaries/raw GitHub/media
GitHub geography requests and self/data images. These document-specific headers
do not replace the Worker's private-API `default-src 'none'` CSP. No backend CSP,
Origin or CSRF policy was relaxed. A future private application shell must keep
its own CSP separate from the demo's public geography access.

**Production isolation:** normal frontend production build uses only `index.html`
and excludes diagnostic/API modules. The alternate build lives in ignored
`frontend/.local/`; assembled assets live in ignored `backend/.local/e31-assets/`.
No production Wrangler asset binding or production API-docs restriction changed.
`integration.html` also refuses initialization outside integration mode. The
local diagnostic is not authentication infrastructure and contains no bypass.
Do not deploy the alternate integration build or manually bind these dev assets
to production. Existing dev-only API-test files are optional, not a tracked
dependency of the new diagnostic.

## API contracts and client

`scripts/generate-api.mjs` derives readonly response types and the exact schema
subset from the validated `backend/openapi.json`, including Me, Error, Health,
Project, Trip, Place, Visit, VisitDate, MapMarker and paginated variants.
`api:check` compares regenerated output (including a source SHA-256) byte-for-byte.
No code-generation framework was added. It is not a full JSON Schema engine;
the small reader validates the currently selected DTO subset, while business
validation/date relationships/authorization remain authoritative on the server.

`contracts.ts` exports `CurrentUser` without CSRF, `ApiErrorResponse`, `Page<T>`
and domain DTOs. These are separate from demo types and future Leaflet models.
`client.ts` provides:

- Relative `/api/v1/` paths only; rejects external paths, traversal outside API,
  fragments and control characters. `/health` has a dedicated method.
- `credentials: 'same-origin'`, `cache: 'no-store'`, `redirect: 'error'`, JSON
  transport and AbortSignal support. No automatic retries or data cache.
- Strict JSON/content-type/DTO handling; HTML, invalid JSON, wrong DTOs or missing
  expected bodies cannot masquerade as successful data. Explicit void mutations
  accept 204; typed responses require their DTO.
- Safe `ApiError` with kind/status/server code/request ID. Server messages/raw
  bodies/network causes are not reflected. Distinguishes 400/validation,
  401/authentication, 403/forbidden, 404/hidden, 409/conflict, 429/rate limit,
  5xx/unavailable, network and protocol failures. Server codes are bounded safe
  identifiers. There are no console logs or persistence hooks in the client.
- `currentUser()` reads `/me` and removes CSRF before returning profile/storage
  DTO data. Future mutations acquire fresh `/me` CSRF for each request, send
  `X-CSRF-Token`, then discard their request-local value. No token cache across
  session changes; an invalid session stops before the mutation. Browser supplies
  Cookie and Origin. No localStorage/sessionStorage/cookie inspection.
- `items`/opaque `nextCursor` pagination with bounded 1–100 limits. No automatic
  cross-scope accumulation or assumption that a Trip viewer may fetch a Project.

Example (component cleanup must abort outstanding requests):

```ts
import { api, paginatedPath } from './api/client';

const controller = new AbortController();
const user = await api.currentUser({ signal: controller.signal });
const page = await api.get(
  paginatedPath('/api/v1/projects', { limit: 20 }),
  'ProjectPage',
  { signal: controller.signal },
);
// Later: use page.nextCursor in paginatedPath; abort on unmount/scope change.
```

Future explicit user-triggered mutation usage, **not exercised against persistent
data in E3.1**:

```ts
await api.mutate('POST', '/api/v1/projects', { name: 'User-chosen name' },
  { response: 'Project', signal: controller.signal });
// A 204 endpoint omits the response option and resolves void.
```

There is no session/global private-data store yet. Future screens must clear their
own private state on session/scope changes and handle permission errors from the
server. Cancellation does not undo a server-committed mutation; no mutation UI is
included here. Do not use this JSON transport for OAuth redirects or invitation
bearer-link processing.

## Commands and automated evidence

Environment observed: Node 24.21.0, npm 11.19.0; installed Vite 8.3.4,
TypeScript 6.0.3, Wrangler 4.156.0. No dependencies installed for this increment.

From the repository root unless noted:

| Exact command | Actual result |
| --- | --- |
| `npm --prefix frontend run api:generate` | Generated tracked DTO/schema module from current spec |
| `npm --prefix frontend run lint` | Passed |
| `npm --prefix frontend run typecheck` | Passed; app/config plus strict API/tests type check |
| `npm --prefix frontend test` | 20 passed, 0 failed, 0 skipped; includes contract drift check |
| `npm --prefix frontend run test:build` | Both normal and integration builds passed; 2 artifact tests passed, 0 failed/skipped |
| `node backend/scripts/frontend-dev.ts --prepare-only` | Assets prepared successfully; no server started |
| `npm --prefix backend run lint` | Passed |
| `npm --prefix backend run typecheck` | Passed |
| From `backend/`: `WRANGLER_LOG_PATH=.local/e31-check.log WRANGLER_SEND_METRICS=false npm run check` | Lint/typecheck/dry-run build passed; 40 tests passed, 0 failed, 0 skipped |

The 20 transport tests cover typed GET, 400/401/403/404/409/429/503, safe network
errors, HTML/malformed JSON/wrong DTOs, 204, per-mutation fresh CSRF, no manually
supplied Cookie/Origin, CSRF removal from public user DTO, no mutation after 401,
pagination, three cancellation timings, path escape rejection, health and
geography DTO separation. A dedicated test forbids access to browser persistent
stores/document and captures logging while exercising session/mutation requests.
Fixtures are synthetic; no persistent data writes.

The 2 build tests inspect production exclusion of diagnostic/private API code
and demo asset presence, plus separation of demo and diagnostic entry modules.
Backend's 40-test regression includes real local workerd, existing OAuth/session
unit tests, runtime/HTTP boundaries, documentation restrictions/resolver,
validation and migration-byte integrity. `build` is Wrangler **dry-run**, not a
deployment. Existing SQL/PostgreSQL/Supabase suites were not rerun: no SQL,
provider behavior, backend routes or auth code changed. Their historical results
are not counted as current E3.1 evidence.

Initial validation found one failed path-boundary test and two lint findings:
generic GET could reach `/health`, a control-character regex violated lint, and
the diagnostic component needed a separate exported React module. All were fixed
before the passing runs above. No claim of full browser/device/performance testing.

## Live local checks and browser evidence

Started from `backend/` using:

```sh
umask 077
WRANGLER_LOG_PATH=.local/e31-dev.log WRANGLER_SEND_METRICS=false npm run dev:frontend
```

With existing configured `.dev.vars.dev` and existing Supabase/PostgreSQL running,
9 anonymous read-only HTTPS checks passed: `/health` 200, `/api/v1/me` 401,
`/api/v1/projects` 401, `/api-docs` 200, `/openapi.json` 200,
`/__local/api-test/` 200, `/__local/integration/` 200, `/demo/` 200 and the actual
demo GeoJSON asset 200. Verified returned content types and scoped CSP headers;
API failures did not return HTML. Command-line TLS certificate verification was
bypassed only for the self-signed loopback endpoint; browser protections unchanged.

Firefox browser observations (native host-controlled browser, GET-only):

- React diagnostic rendered; **Check health** displayed HTTP 200.
- **Check current session** displayed the expected sanitized unauthenticated 401.
  No session cookie or CSRF value was extracted or displayed. No logout performed.
- `/demo/` showed the existing welcome modal and minimalist world map. Closing
  the modal and selecting Colombia showed the existing city markers, memory
  panel and photo controls. No component/data edits were required.
- Existing Colombia boundary source failed independently: geoBoundaries metadata
  returned 200, but the raw GitHub geometry URL returned a 133-byte Git LFS
  pointer, not GeoJSON (confirmed in browser Network response). The existing
  loader showed its error/retry state. No CSP bypass or unrelated loader fix.
- Firefox also reported an inline-script CSP rejection from `sandbox eval code`,
  outside the application's external module initialization. The React entry and
  GET checks worked; no inline-script permission was added to accommodate it.

QA verdict for the tested diagnostic: **4/5** — renders and handles health/401
clearly, with no sensitive display; authenticated 200 still requires user login.
Demo visual check is limited to the observed desktop flow; no full mobile,
geography-coverage or gallery regression claim. Public boundary-source issue is
recorded as pre-existing code behavior, not resolved by E3.1.

**Pending:** authenticated `/me` and paginated Project GET through the React
client in the user's browser. A login handoff was requested; no credentials were
entered by the agent. Do not mark E3.1 fully accepted until these checks succeed.

## Manual authenticated acceptance

1. Stop another Worker using 8789 if necessary; do not kill unrelated services.
   Run `npm --prefix backend run dev:frontend` at repository root. Existing
   ignored backend configuration and local Auth/database services are prerequisites;
   no credentials are needed in frontend environment variables.
2. Open **https://127.0.0.1:8789/__local/integration/** in your existing Firefox
   profile. Browser certificate prompts, if any, require your own review.
3. Click **Check health**: HTTP 200. Click **Check current session**: HTTP 200
   when signed in, or safe 401 when no valid session exists.
4. If needed, open **https://127.0.0.1:8789/api/v1/auth/google/start** in another
   tab and complete Google authentication yourself. The unchanged callback may
   land on `/` with 404; return to the diagnostic and check session again.
5. Click **Check first Project page**. Expect HTTP 200 and 0 or 1 item, without
   private details. Click **Check next Project page** only when available; no
   next page produces a clear message. No sample data is created.
6. **Cancel request** aborts an in-flight request; local responses may complete
   before a click. Automated tests cover cancellation deterministically. Network
   and server failures are synthetic automated evidence, not induced outages of
   your services. Do not sign out solely to repeat the already observed 401.
7. Optionally open `/demo/` and existing `/api-docs` separately. Do not execute
   mutations from Swagger/API test pages as part of E3.1 validation.

## File inventory

Created:

- `frontend/README.md`, `frontend/integration.html`, `frontend/tsconfig.api.json`.
- `frontend/scripts/generate-api.mjs`.
- `frontend/src/api/client.ts`, `contracts.ts`, `generated.ts`.
- `frontend/src/integration/main.tsx`, `IntegrationCheck.tsx`, `style.css`.
- `frontend/tests/api.test.ts`, `build.test.mjs`.
- `backend/scripts/frontend-dev.ts`.
- `docs/E3_1_VALIDATION.md`.

Modified: `.gitignore`, `frontend/package.json`, `frontend/vite.config.ts`,
`backend/package.json`, `backend/README.md`, `docs/IMPLEMENTATION_PLAN.md`.
No changes to existing React visual components/static data or backend domain code.

## Remaining work and E3.2 prerequisites

- Finish authenticated browser acceptance above before calling E3.1 accepted.
- Review the next increment's session/UI/navigation scope separately. No login,
  logout, dashboard, Project/Trip navigation, Visit form, live map adapter or
  visual demo/live selector was implemented.
- Future UI must handle revoked/expired sessions and clear private state, retain
  direct Trip access without Project details, and keep API DTOs separate from
  Leaflet models. The current transport enforces no UI-derived permissions.
- Production hosting/assets/private-shell CSP need a later reviewed configuration;
  this is a local foundation, not a production frontend integration or deployment.
- Existing public demo geography provider/LFS issue needs a separately scoped fix.

No cloud resources/costs, database mutations, OAuth changes, deployment, commits,
pushes or later increments were performed.
