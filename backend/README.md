# Travel Map backend — E2.4

Workers/TypeScript modular monolith under [decision #40](../docs/ADR-001-STACK.md).
E0 is committed; E1 adds Supabase Google OAuth/PKCE integration, opaque revocable
application sessions, identity synchronization and private projects. Real Google
login/logout were subsequently confirmed by the user. E2.1 adds Trips and inherited
authorization; E2.2 adds controlled Places, Visits and map projections. E2.3 adds membership administration, departure, settings and Owner-only archive; E2.4 remains unimplemented. No frontend integration, cloud
resources or deployment is included.

See [E1 validation and manual prerequisites](E1_VALIDATION.md). The
[E0 record](E0_VALIDATION.md) is historical evidence; its HTTP-only development
instructions are superseded by the HTTPS instructions here.

## Local tools and checks

From `backend/`, use Node 24.x and npm 11.x (tested 24.21.0 / 11.19.0):

```sh
npm ci
npm run types -- --check
npm run check
```

`check` runs lint, strict Worker/tooling type checking, local dry-run build and
33 tests. Regenerate with `npm run types` after changing compatibility settings.
`build` uses `wrangler deploy --dry-run --env test --outdir dist`: no deployment
occurs and no Cloudflare login is required. All outputs/state/logs are ignored.
Do not remove `--dry-run` or invoke a real deployment command.

For the disposable PostgreSQL suite:

```sh
export PG_BIN=/absolute/path/to/existing/postgresql/bin
npm run db:local:test
```

Use PostgreSQL 17+ executables (`initdb`, `postgres`, `pg_ctl`). The command builds
current Worker code, creates its own loopback-only cluster and random databases,
runs E0/E1/E2.1/E2.2/E2.3 SQL and workerd integration tests, and stops/removes only its generated
cluster. No Docker, existing database or `.env` is required. Temporary local trust
authentication is for synthetic tests only. Let the command finish normally; if
interrupted, inspect its own `.local/pg-e0-*` directory and stop that exact cluster
with `"$PG_BIN/pg_ctl" -D <that-directory>/data -m fast -w stop`. Never stop unrelated
PostgreSQL instances or perform global cleanup.

Alternatively `npm run test:db` reads ignored `.env` and creates a random database
on the explicitly acknowledged disposable local server. It requires local admin
CREATEDB/CREATEROLE permission. Missing configuration produces an explicit skip,
which is not a validation pass. The automatic helper is the verified path.

## Start the API

For the E3.2 private React app, E3.1 diagnostic and isolated static demo,
use `npm run dev:frontend` instead of `npm run dev` (one Worker at a time).
This builds frontend assets locally and uses the existing HTTPS dev Worker on
8789; it exposes no Vite network server and changes no authentication settings.
See [frontend instructions](../frontend/README.md) and
[E3.2 validation](../docs/E3_2_VALIDATION.md). `/app` deep links are narrowly
rewritten to the local application document; root `/` provides frontend-only
continuation after the unchanged OAuth callback. Default backend production
configuration has no frontend diagnostic asset binding.

`npm run test:frontend` prepares local assets, performs a dry-run Worker build,
and runs three real workerd routing/isolation tests without database access.

```sh
npm run dev
```

Expected: `https://127.0.0.1:8789`. HTTPS is intentional: cookies remain `Secure`
in development. For command-line liveness with Wrangler's local certificate:

```sh
curl --insecure --include https://127.0.0.1:8789/health
curl --insecure --include https://127.0.0.1:8789/api/v1/me
```

Expected: 200 `{"status":"ok"}` and unauthenticated 401 `SESSION_REQUIRED`.
`--insecure` is exclusively for this self-signed localhost certificate; production
TLS verification is required. Stop Wrangler with Ctrl-C or `x`.

Health is liveness, not provider/database readiness. Without identity configuration,
health still works, requests without sessions return 401, and login or a plausibly
formatted session requiring dependencies returns sanitized 503. No mock login
fallback exists. With API-only `npm run dev`, root `/` has no UI and returns 404
after the existing OAuth callback. With `npm run dev:frontend`, the local root
document continues to the E3.2 private application without changing that callback.

## Local Supabase Auth integration tests

An isolated native stack is configured in `supabase/config.toml`; its service
versions are pinned in `supabase/supabase.lock`. The CLI is a local dev dependency.
Google is disabled, and email/password is enabled **only for synthetic test setup**;
the application rejects email-only identities and has no password-login route.

```sh
mkdir -p .local
umask 077
SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ./node_modules/.bin/supabase stack install --runtime native --frozen
SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ./node_modules/.bin/supabase stack start --runtime native --stack travel-map-e1-local --eager --exclude realtime,storage,functions,studio,analytics,pooler > .local/e1-supabase-start.log 2>&1
npm run build
npm run test:supabase
SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ./node_modules/.bin/supabase stack stop --stack travel-map-e1-local > .local/e1-supabase-stop.log 2>&1
```

Native runtime is experimental and verified on this Apple Silicon machine; it is
not evidence of Docker packaging or hosted Supabase behavior. First-time setup may
need approved public artifact downloads and OS/sandbox permission. Do not use
`supabase login`, `link`, remote bindings or hosted credentials.

Raw CLI status/logs contain generated local credentials. Keep them ignored and
private; do not paste them into documentation or chat. The test reads its own
status privately and restricts endpoint hosts to loopback. It creates/deletes its
own synthetic identity, flow-state fixtures, application database and restricted
role. It does not migrate Supabase's managed `auth` schema. Only test-owned records
are seeded there to simulate the **upstream Google result**, allowing actual Auth
PKCE validation/token issuance and `getUser` to run. This is not real Google login.
Missing status is reported as a skip, not success. These fixtures live only in tests.

## Configuration and database setup

Copy `.dev.vars.example` to ignored `.dev.vars.dev` for Worker configuration.
Copy `.env.example` to ignored `.env` for Node migration tools; never use a
migration/admin role as the Worker login. See E1_VALIDATION.md for exact role grants
and manual Google prerequisites. `dev`, `test` and future `prod` are separate
Wrangler environments, with no real cloud bindings or deployment routes.

Required identity settings are `APP_ORIGIN` (exact HTTPS origin), `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL` (restricted login), and `OAUTH_COOKIE_KEY`
(32 random bytes, lowercase hex). Only configured loopback development provider/DB
connections may use plaintext; remote PostgreSQL verifies TLS certificates. URL
query overrides are rejected. Production rejects loopback origins/endpoints.

```sh
npm run db:migrate -- status
npm run db:migrate -- up
npm run db:migrate -- down --allow-destructive-local
```

Migration CLI supports explicitly acknowledged disposable loopback databases named
`travel_map_dev` or `travel_map_test_<suffix>`, never hosted databases. `.env` must
set `LOCAL_DATABASE_ONLY=1`; ensure the port is not a tunnel to cloud. Each migration
is transactional with advisory locking and immutable paired up/down checksums.
`down` reverses only the latest migration and destroys that migration's data.
Initial schema requires no extensions; PostgreSQL supplies `gen_random_uuid()`.

## Architecture and security boundaries

- `src/index.ts` composes real adapters; `src/app.ts` handles HTTP routing/errors.
- `modules/identity`: official `@supabase/auth-js` 2.118.0 for Google-only PKCE,
  encrypted short-lived transaction cookies via `jose` 6.2.14, browser-bound state,
  database single-use consumption, live provider identity verification, application
  session/CSRF handling. Provider credentials remain only in request-local memory.
- `modules/projects`: strict input validation and opaque cursor pagination. Ownership
  comes from the session; active memberships are resolved in SQL on every request.
- `infrastructure/postgres.ts`: `pg` 8.16.3, Node-compatible Workers runtime, no global
  connection pool or authorization cache. Each RPC has its own bounded connection.
- `migrations/0002_identity.*`: transient OAuth records, owner-only RLS policies and
  SECURITY DEFINER functions. Runtime role gets only four specific EXECUTE grants;
  no direct table access, schema creation, superuser or BYPASSRLS. Function owner
  and migration role are trusted server authorities. Do not expose these functions
  through public PostgREST or grant them to browser `anon`/`authenticated` roles.

Application cookies are HttpOnly/Secure/host-only/SameSite=Lax. Sessions have
256-bit random tokens, database SHA-256 digests, seven-day absolute and 30-minute
sliding idle expiry. Logout revokes durably before clearing the cookie. New login
rotates/revokes the browser's old session. These are explicit initial technical
defaults, not new product requirements. `/me` returns a session-bound CSRF token;
Mutation requests (including POST and PATCH) require it in `X-CSRF-Token` plus exact `Origin`. No permissive CORS,
provider-JWT bootstrap, fake credentials or `/harness/*` routes exist.

See [module ownership](src/modules/README.md) and [E1 evidence/limits](E1_VALIDATION.md).
Trips and inherited authorization are implemented in E2.1; see below. Visits and map projections are implemented in E2.2 (below); E2.3 membership administration/settings/archive are implemented below. Media, uploads, quota and invitations remain deferred. Do not begin E2.4 without separate authorization.

## E2.1 — Trips and inherited authorization

Implemented: `GET/POST /api/v1/projects/{projectId}/trips` and `GET/PATCH /api/v1/trips/{tripId}`. See [contract](../docs/API_CONTRACT.md#e21-implemented-trip-contract-2026-11-04) and [validation evidence](E2_1_VALIDATION.md). O/A edit; creator Members never acquire an editing grant. Guest access is explicitly scoped to one Trip; no public route yet grants memberships.

`0003_trips_authorization.up.sql` adds `trips`/`trip_memberships`, FORCE RLS, private handlers and authenticated dispatcher actions. Apply through the existing migration runner **as the existing E1 migration/function owner**, not the application role. Preflight rejects different ownership, weakened RLS/table ACLs or unsafe RPC grantees; final checks reject unsafe default ACLs. Do not grant broader privileges to make migration pass. The application still receives only the existing four EXECUTE grants, no table or private-helper grants.

No migration was applied to persistent `travel_map_dev` during the isolated E2.1 implementation phase. A subsequent explicitly authorized operation applied 0003 on 2026-11-04 after owner/history verification and a protected local backup; see [persistent migration evidence](E2_1_VALIDATION.md#authorized-application-to-persistent-local-development--2026-11-04). For any future application, review owner identity and backup policy. The CLI commands above use operator-only `DATABASE_URL` in ignored `.env`, never Worker credentials; `LOCAL_DATABASE_ONLY=1` and loopback restrictions still apply. Do not paste credentials into command history. A known privileged owner must use their existing authorized credentials (or authorized SET ROLE); if unavailable, stop.

Migration `0003` down is destructive to Trip data and refuses database names other than `travel_map_test_<suffix>`. Do not run down against persistent development data; use backup/preservation and forward repair. It restores the exact E1 dispatcher and removes only E2.1 objects. Never reverse 0001/0002 to undo E2.1.

Run isolated regressions from `backend/`:

```sh
WRANGLER_LOG_PATH=.local/e21-check.log WRANGLER_SEND_METRICS=false npm run check
PG_BIN=/absolute/path/to/postgresql/bin WRANGLER_LOG_PATH=.local/e21-db-runtime.log WRANGLER_SEND_METRICS=false npm run db:local:test
```

The second command starts/stops its own disposable loopback cluster, seeds synthetic actors, tests forward/failed/down/reapply migrations and SQL/HTTP security; it never connects to `.env` or `travel_map_dev`. Requires existing PostgreSQL 17+ binaries and local process/network permissions. `npm run test:db` is intended only for an explicitly configured disposable administrative test target, not the application role or persistent data. E1 regression pins its original migration pair; E2.1 exercises the full chain. Local Supabase regression remains `npm run test:supabase` with an ignored, protected `SUPABASE_LOCAL_STATUS_FILE`; see E2.1 evidence for isolated-stack prerequisites.

## E2.2 — controlled Places, Visits and map projections

Seven endpoints are implemented, including authenticated Places search, Trip Visit list/create, Visit get/patch, Project map and Trip map. See [implemented DTO/filter contract](../docs/API_CONTRACT.md#e22-implemented-geography-contract-2026-11-04), [catalog provenance](catalog/README.md), and [E2.2 validation](E2_2_VALIDATION.md).

Only explicit Place UUIDs are accepted. The attributed GeoNames catalog has six localities across COL/TUR/USA, including independently identified homonyms; no worldwide coverage or inline-place resolver. Visits retain independent identities and PostgreSQL calendar dates (none/single/range). Owner/Admin or creator with current access may edit a Visit; other collaborators read/create within scope. P-03 Trip editing remains Owner/Admin-only. Guests have no Project map or other-Trip visibility. Photo projections are truthfully zero/null.

Exact Visit coordinates are disabled in both SQL and API pending consent/sharing/reconfirmation policy. All projections return confirmedCoordinates=null; approximate catalog coordinates never derive from Visits/EXIF. No precise-location logging is added.

Migration `0004_places_visits.up/down.sql` has been tested only in disposable local databases. **Do not run db:migrate up against travel_map_dev without separate approval**: the runner now sees 0004 as pending. Correct existing E1/E2.1 migration-owner context and preflight are required; no new runtime grants. Down restores the exact E2.1 dispatcher and is destructive to E2.2 data, allowed only for disposable travel_map_test_* databases. Keep persistent data and use forward repair, never automatic rollback.

Existing `npm run check` and `PG_BIN=<existing PostgreSQL 17+ bin> npm run db:local:test` include E2.2. Tests use synthetic users/Visits, a non-superuser owner, full rollback/reapply checks and 110 generated Visits/query plans. Native Supabase regressions use only the separately configured disposable test stack, never the Google-enabled development stack. No persistent development database or Docker networking is changed by this implementation.

## E2.3 membership administration and Project lifecycle

[Endpoint contract](../docs/API_CONTRACT.md#e23-implemented-collaboration-contract--2026-11-05)
and [validation record](E2_3_VALIDATION.md) describe the nine implemented routes.
Owner/Admin manage ordinary settings; only Owner promotes/demotes Admins and
archives. Project removal/departure atomically revokes all descendant explicit Trip
grants, retaining contributed content. Guest departure affects only that explicit
Trip grant. No restoration API exists; archival has no self-service undo.

Migration 0005 is **not applied to persistent travel_map_dev**. Continue using the
existing owner, LOCAL_DATABASE_ONLY=1, verified local target and backup procedure
before any separately approved persistent application. Do not run the generic `up`
command against the development database until that migration is authorized.
`npm run db:local:test` applies/rolls back/reapplies it only in generated disposable
databases. `npm run check` includes E2.3 validation tests; no dependencies added.

New SQL handlers retain the four-RPC boundary and fixed owner/search_path/UTC.
Runtime receives no direct tables/helpers. Minimal private audit events share each
mutation's transaction. No invitations, ownership transfer, restoration, photos or
frontend integration were added. Existing Google credentials and auth flows remain
unchanged; test users/session fixtures never create an HTTP login bypass.

## E2.4 invitations

Implemented contract and evidence: [API](../docs/API_CONTRACT.md),
[E2_4_VALIDATION](E2_4_VALIDATION.md). Owner/Admin issue Project Member or Trip Guest
links; recipients sign in through Google then explicitly POST acceptance using
existing CSRF protection. `/invite#<secret>` clears the fragment and opens Google
login separately; return to the original tab to accept. Reload loses the secret.
No email service or frontend application integration. No private inspection/roster.

Migration0006 remains **unapplied to travel_map_dev**. Use db:local:test for disposable
validation. Persistent application requires separately authorized target/owner/
checksum preflight and verified private backup. Never down persistent data.

## OpenAPI and Swagger UI — local development

Open **https://127.0.0.1:8789/api-docs**; spec at **/openapi.json**.
Use the same browser/profile as Google login. Sign in using the page link, return,
then Try it out → Execute on GET /api/v1/me or authorized domain operations. Cookies
remain HttpOnly; CSRF is automatic (leave placeholder `automatic` unchanged).
OAuth/invitation token operations are reference-only to keep secrets out of Swagger.

Only APP_ENV=dev on the exact HTTPS loopback origin serves docs; prod/test404.
No external CDN/validator or persistent credentials. npm run dev/build/typecheck
prepare pinned local assets automatically. API behavior and database remain unchanged.
[Usage, security, drift maintenance and actual checks](API_DOCS.md).

## E4.1 — Private media SQL foundation (local only)

`0007_media_foundation` adds domain/asset/intent/reservation/attempt/task records,
atomic accounting, SQL authorization, trash/restoration foundations and a separate
restricted maintenance group. No photo HTTP route, processor, storage adapter, media
delivery or scheduler is implemented. See [module security boundary](src/modules/media/README.md),
[E4.1 validation](E4_1_VALIDATION.md) and [future contract](../docs/E4_MEDIA_CONTRACT.md).

Do **not** run the normal development migration command for this increment.
`travel_map_dev` remains untouched. Use the existing installed PostgreSQL17+ binaries:

```sh
# From backend; supply only an existing binary directory, never a development URL.
PG_BIN=/absolute/path/to/postgresql/bin npm run db:media:test
```

This starts a NEW native cluster on a random127.0.0.1 port, with a server marker,
private generated data directory and marked test database. It rejects supplied
DATABASE_URL/connection overrides, persistent port57422, unexpected data directory,
marker or owner, and hosted endpoints. It runs E0–E4.1 disposable database regressions
and removes only its generated cluster after successful shutdown. It neither reads
.env nor reuses the Google-enabled Supabase stack. Test fixture credentials/data
are synthetic and no image bytes are processed. `npm run check` includes media
contract/safety checks, existing workerd/OpenAPI tests and a dry-run build.

The maintenance group must be preprovisioned by an authorized administrator before
a future separately approved migration, with the exact NOLOGIN/NOINHERIT/no-power/no-
membership profile documented in the module README. E4.1 provisions it only inside
the new test cluster. No persistent role or technical login/credential was created.
Down refuses any media/history/nonzero charge and accepts only marked disposable
E4.1 databases; no persistent down, deletion or migration is authorized here.
