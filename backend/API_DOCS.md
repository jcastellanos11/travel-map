# Local interactive API documentation

Open **https://127.0.0.1:8789/api-docs**.
The OpenAPI3.1 specification is **https://127.0.0.1:8789/openapi.json**;
source of truth for this artifact is backend/openapi.json, reviewed against the
implemented request handlers, SQL DTOs and docs/API_CONTRACT.md. It describes38
operations, including health, identity, Projects, Trips, Places, Visits, maps,
membership/lifecycle, invitations, the invitation landing and documentation routes.
Internal static asset URLs are not business API operations.

## Use an existing authenticated browser session

1. Open /api-docs in the browser/profile where Google login succeeded. Use the exact
   configured origin127.0.0.1:8789; localhost is a different cookie origin.
2. If needed, click **Sign in with Google** at the top. Complete normal Google login
   in the new tab, then return to docs. Never copy a cookie or enter credentials into
   Swagger's authorization controls (these controls are hidden).
3. Expand GET /api/v1/me, click Try it out and Execute. Expected200 for an active
   session,401 when logged out. The docs transport hides csrfToken from the displayed
   response; the actual API response contract is unchanged.
4. Try GET /api/v1/projects or an authorized Trip/Visit/map. Fill path UUIDs and
   bounded limit/cursor/filter fields as documented. Missing/inaccessible resources404.
5. To mutate, use only a dedicated test Project. For example POST /api/v1/projects
   with {"name":"API docs test","tripCreationPolicy":"admins_only"} returns201.
   The X-CSRF-Token input defaults to the non-secret placeholder `automatic`; leave
   it unchanged. A private same-origin /me fetch supplies the real value at the
   browser fetch boundary. Origin is supplied by the browser, HttpOnly session cookie
   automatically accompanies the request. Real CSRF never enters Swagger request/
   curl state. Do not manually add Origin/Cookie or disable protection.
6. POST /api/v1/auth/logout returns204; later GET /me401. Sign in normally to resume.

Mutations are real and persist in your local development database. The documentation
interface has no automatic fixtures, rollback or cleanup. Archive is Owner-only and
has no restoration API; avoid archiving existing content during exploration.

OAuth handshake and all invitation operations are **reference-only** in Swagger.
Their request/response models and role rules remain visible, but Try it out is disabled
and transport rejects them. This prevents bearer invitation URLs, redemption tokens,
OAuth codes/state or cookies from being entered/retained in Swagger request/response
state. Use the existing Google link and /invite#secret flow, and the controlled
procedure in E2_4_VALIDATION.md for issuing/sharing links. No cookie/JWT login panel,
mock login, browser-cookie extraction or automatic invitation consumption.

## Isolation and security

Routes /api-docs, /openapi.json and assets require APP_ENV=dev AND HTTPS loopback
host AND configured APP_ORIGIN equality (if set). Production and test environments
always404, as do remote hosts, wrong origins, extra queries and non-GET methods.
No query/config switch can enable access. The spec and assets are bundled, but are
not accessible through these routes in production; this is runtime gating, not a
claim that documentation bytes are excluded from the bundle.

Swagger5.34.1 assets are self-hosted from the pinned devDependency, no CDN/third-party
validator/config URLs. docs-assets.ts generates ignored .generated/swagger-assets.ts
before dev/typecheck/build. No Wrangler configuration change or production asset
binding. Browser requests are restricted to same-origin; OAuth/invitation requests
are blocked at both the execution selector and fetch transport. No storage,
credential persistence, telemetry, cookie access, console logging or external
validator requests in initializer. showMutatedRequest=false and no request snippets;
CSRF is injected only below Swagger's request-state layer. GET /me is redacted before
Swagger sees the response. Login/session security implementation remains unchanged.

Documentation CSP allows only same-origin scripts/styles/connections and local/data
images, forbids framing/base/form destinations, no unsafe-eval/unsafe-inline. Existing
API CSP default-src none is unchanged. All docs responses private/no-store,
no-referrer and nosniff. Normal devtools Network views necessarily observe HTTP
traffic; do not export captures containing authenticated API responses/headers.

Configuration references: [official Swagger UI configuration](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/).

## Drift checks and maintenance

npm run check includes documentation.test.ts:
- Actual OpenAPI3.1 validation/references and unique operation IDs using pinned
  @apidevtools/swagger-parser12.1.0.
- Every documented private method/path executes the actual request handler with
  valid synthetic DTOs and an in-process repository port; no database mutation.
  Unknown routes falling back to /me fail this check.
- Reviewed source hashes flag routing/validation/SQL DTO/security changes, and new
  route/validation/type files must enter the manifest. This is an explicit review
  gate, not automatic semantic equivalence or DTO generation.
- Production/test/remote/wrong-protocol rejection; transport secret redaction,
  automatic CSRF, no third-party/sensitive requests; actual workerd asset responses.

After reviewing a real API change and updating OpenAPI:

```sh
# From backend/. Explicit acknowledgement: do not use just to silence drift failures.
node scripts/docs-sources.ts --accept-reviewed
npm run check
```

Fresh setup: npm ci, npm run dev. Existing installs already have the pinned packages.
predev/pretypecheck/prebuild regenerate assets locally without network or credentials.
Generated assets are Git-ignored and excluded from ESLint, not manually edited.

## Actual validation and limitations — 2026-11-05

- Lint/typecheck/build pass; wrangler deploy --dry-run only, no deployment.
- Initial unit/artifact/documentation/workerd suite39 passed,0 failed/skipped; the later rendering fix is recorded below.
- Disposable PostgreSQL E0–E2.4 suite125 records passed,0 failed/skipped.
  Existing Supabase provider regression was not rerun for this documentation change;
  no identity/provider implementation changed. Prior evidence remains historical.
- Unit transport tests execute initializer in VM and prove the synthetic CSRF value
  reaches only network headers, not original Swagger request object or displayed /me.
- OpenAPI source operations38. All0001–0006 migrations unchanged during this task;
  no persistent database data or permissions touched.
- Live existing HTTPS Worker returned200 for /health, /api-docs, /openapi.json,
  initializer, Swagger JS/CSS and the preserved local API test page. No authenticated
  browser requests or real-account mutations performed.
- Initial browser inventory was empty; the later rendering investigation below
  used native Firefox app control and supersedes the initial browser limitation.
- Packaging experiment using dynamic Text imports passed compilation but CSS failed500
  in actual workerd. Replaced with generated static strings; final actual asset test
  passed. Initial route probe failed because test PATCH sample was empty; corrected
  fixture generation without changing production validation.
- The existing dev server stalled during intermediate asset reload before generation.
  Restarted only its verified Wrangler process with existing ignored E2.2 API assets;
  predev now generates assets first. Supabase/PostgreSQL services were not restarted.
- npm audit reported10 moderate advisories in the existing ESLint/typescript-eslint/
  minimatch tooling chain; no high/critical and none attributed to the two added docs
  packages. No force/downgrade remediation or unrelated dependency update attempted.
- Final dry-run Worker size about2582KiB (gzip600KiB); assets increase bundle size.
  Deployment/performance behavior remains untested. Production routes are disabled.

No migrations, authorization policies, OAuth/session model, frontend, deployment,
commit/push or E2.5 work added. Existing uncommitted E2.4 implementation preserved.

## Rendering investigation and fix — 2026-11-05

### Two independent causes reproduced before implementation changes

**Resolver failure (application integration bug, verified):** the configured
parameterMacro returned undefined for every non-CSRF parameter. Swagger UI5.34.1
uses ApiDOM for OpenAPI3.1 resolution; the macro inserts an undefined default node.
Resolving a parameterized operation then reaches Transcluder.computeEdges and tries
to use undefined as a WeakMap key. This was reproduced with the installed bundle's
actual resolveSubtree in Node without a browser/CSP. The same specification resolves
with no macro; returning parameter.default also fails where that default is absent.
The specification validates as OpenAPI3.1; changing API schemas or dependency
versions is unnecessary. Existing selector/transport plugins are compatible.

Fix: remove parameterMacro entirely. The documentation's fetch layer adds only the
non-secret default `automatic` to the CSRF parameter in its **in-memory UI copy** of
the spec. The served openapi.json remains unchanged. Real CSRF still enters only the
network request headers below Swagger state; cookie/Origin/session behavior unchanged.

**CSP violation (browser-extension injection, verified separately):** clean reload
of the original Firefox profile reported an inline script at
`sandbox eval code:17:34`, hash
`sha256-ieoeWczDHkReVBsRBqaal5AFMlBtNjMzgwKvLqi/tSU=`. Inspection of actual DOM script
nodes found only /api-docs/swagger-ui.js and /api-docs/init.js, both external. Firefox
Debugger's anonymous source contains extension snippets/storage-shim code:

```js
const injectScript = (executable, policy) => {
  const script = document.createElement("script");
  script.type = "application/javascript";
  script.async = false;
  script.textContent = policy ? policy.createScript(executable) : executable;
  try { document.documentElement.appendChild(script); } catch (_) {}
  document.documentElement.removeChild(script);
};
```

The caller builds a bootstrap invoking runStorageShim and optional runSnippets,
including an isolated-world/MV2 extension injection branch. Its source explicitly
references extension API access for snippet detection. It is not the Travel Map
initializer, inline HTML or an OpenAPI response. The exact installed extension
package identity is not established from this anonymous source (Adblock Plus is
present in DevTools; attribution to that specific package remains an inference).

CSP correctly blocks this extension-created script. No nonce/hash allowlist for
that injection was added; no extension setting, security exception or CSP directive
was changed. A new Firefox private window loaded the same localhost page and
expanded the paginated Projects operation with **no CSP or WeakMap errors** in its
console. The normal extension-enabled profile may continue to report its injected
script warning. Use a private/clean browser context for a clean console; changing
browser-extension permissions is a user-controlled action outside this code fix.

### Files changed in this fix

- src/modules/documentation/routes.ts: remove unsafe macro contract; UI-copy CSRF
  default at fetch boundary. CSP/production gating unchanged.
- src/modules/documentation/assets.d.ts: unknown module declaration for importing
  the actual installed Swagger resolver in tests, no new dependency.
- tests/documentation.test.ts: macro absence/UI-copy default assertions and a real
  Swagger resolver regression proving old failure and successful resolution of all
  38 operations. Existing secret handling and production denial tests retained.
- openapi.sources.json: explicit reviewed documentation-source hash refresh.
- API_DOCS.md: this evidence and corrected earlier browser-validation limitation.

No business handler, API contract/spec, auth model, database schema/migration,
permissions, Swagger version or dependency manifest changed during this fix.

### Actual validation

From backend/:

```sh
npm run lint
npm run typecheck
node scripts/docs-sources.ts --accept-reviewed
WRANGLER_LOG_PATH=.local/swagger-fix-check.log WRANGLER_SEND_METRICS=false npm run check
PG_BIN=/Users/luffy/.supabase/cache/stack/slim-services/postgres/17.11.0.006-r0/darwin-arm64/fb7594525d712ab85b6da00d4d4854f8d0c9ba26b49b781a5fede0119362e917/bin WRANGLER_LOG_PATH=.local/docs-db.log WRANGLER_SEND_METRICS=false npm run db:local:test
```

- Lint/typecheck exit0. Build exit0,2582.67KiB/gzip599.68KiB; only dry-run.
- 40/40 unit/artifact/OpenAPI/workerd/resolver tests passed;0 failures/skips,
  4526.29ms. Actual resolver expands all38 documented operations with0 errors.
- 125/125 PostgreSQL/workerd regression records passed;0 failures/skips,2636.16ms.
  Only generated disposable local databases/clusters were used for this suite.
- OpenAPI3.1 schema/ref validation passes. Served spec unchanged, SHA-256
  30ef07fc76d3b7a1c696c92a92dc9d5cb01cef140518fb47f738958b338ca66a.
- Production/test/remote-host documentation and assets remain404. Existing private
  API CSP verified unchanged; no unsafe-inline/unsafe-eval or new script nonce.
- VM transport checks verify no real CSRF in Swagger request state/displayed me,
  no sensitive/external requests, no storage/cookie-reading/console logging.

Browser validation used the browser-use QA workflow through native Firefox UI;
no browser runtime/tool installed and no cookies/credentials imported or extracted.
Observed before fix: paginated Projects stuck loading plus computeEdges exception.
After fix: parameters/limit/cursor/Try it out render; private-window console has no
CSP/WeakMap errors. Existing normal-profile extension warning is independent.

**Actual authenticated browser flow through Swagger:** GET /api/v1/me200;
POST /api/v1/auth/logout204 with automatic CSRF placeholder; subsequent GET /me401
SESSION_REQUIRED. Logout was the safe mutation chosen instead of creating or
modifying persistent Projects/memberships. This intentionally signed the current
normal-profile test session out; sign in normally with the page Google link to
continue. No session secret/CSRF value was displayed or logged. Domain data untouched.

Browser QA verdict4/5: rendering and authenticated read/mutation work; the original
profile retains an external injection warning until the user uses a clean context
or adjusts their extension. No claim that application code can suppress an external
extension's violation while preserving CSP. No deployment, commit/push or new phase.
