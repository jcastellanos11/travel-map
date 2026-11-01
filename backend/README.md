# Travel Map backend — E1

Workers/TypeScript modular monolith under [decision #40](../docs/ADR-001-STACK.md).
E0 is committed; E1 adds Supabase Google OAuth/PKCE integration, opaque revocable
application sessions, identity synchronization and private projects. **Real Google
OAuth/browser acceptance is still pending manual provider configuration.** No
frontend integration, E2 entities, cloud resources or deployment is included.

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
16 tests. Regenerate with `npm run types` after changing compatibility settings.
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
runs E0/E1 SQL and workerd integration tests, and stops/removes only its generated
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
fallback exists. Root `/` has no UI; callback redirects there for future same-origin
frontend integration in E3. Until then, inspect `/api/v1/me` separately after login.

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
POST requests require it in `X-CSRF-Token` plus exact `Origin`. No permissive CORS,
provider-JWT bootstrap, fake credentials or `/harness/*` routes exist.

See [module ownership](src/modules/README.md) and [E1 evidence/limits](E1_VALIDATION.md).
R2/Images, travel/visit/photo entities, uploads, quota accounting, invitation and
retention workflows remain in their approved later stages. **Do not start E2
without the next instruction.**
