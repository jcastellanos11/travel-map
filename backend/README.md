# Travel Map backend — E0

Implementation foundation for [ADR-001, decision #40](../docs/ADR-001-STACK.md):
Workers/TypeScript, Supabase PostgreSQL/Google Auth, private R2/Images, modular
monolith. **E0 only:** local liveness and fail-closed HTTP boundary, initial
PostgreSQL schema and development tools. No Google flow, session issuance,
projects CRUD, media pipeline, cloud services or deployment are implemented.

## Requirements and installation

Run commands from `backend/`. Node **24.x** / npm **11.x** are required; tested
with Node 24.21.0 and npm 11.19.0. `.nvmrc` pins the tested Node version.

```sh
cd backend
npm ci
npm run types
npm run check
npm run dev
```

`npm ci` uses this directory's lockfile and isolated `node_modules`; it does not
install global tools or change frontend dependencies. Wrangler's workerd/esbuild
platform binaries must be allowed by your package-manager installation policy.
Do not approve arbitrary dependency lifecycle scripts or globally upgrade npm.

`npm run dev` starts Wrangler **locally**, on `http://127.0.0.1:8789`. Stop with
Ctrl-C. No Cloudflare login, Supabase project, Docker, R2 subscription or payment
method is needed. Runtime tests also open loopback listeners; a managed sandbox
may require specific permission for these operations. Do not bypass that prompt.

```sh
curl --fail http://127.0.0.1:8789/health
curl -i http://127.0.0.1:8789/api/v1/me
```

Expected: `200 {"status":"ok"}` and `401` with `error.code=SESSION_REQUIRED`.
`/health` is **liveness**, not a database/provider readiness check. All `/api/v1`
paths deny access even if supplied cookies/JWTs/mock headers; they are reserved,
not completed E1 endpoints. Other paths return normalized 404; unsupported health
methods return 405. Every response has a server-generated request ID and private
no-store/security headers. Errors never return internal exceptions or connection
details. No permissive CORS policy is configured; frontend integration is E3.

## Configuration and environments

| File / setting | Purpose |
|---|---|
| `wrangler.jsonc` | Separate `dev`, `test`, future `prod` names and `APP_ENV`; no remote bindings, routes, account IDs or secrets. Public workers.dev/previews disabled. |
| `.dev.vars.example` | Worker template, intentionally no credentials needed in E0. Future local secrets belong in ignored `.dev.vars.dev` / `.dev.vars.test`. |
| `.env.example` | Node-only local migration template. Copy to ignored `.env` and replace placeholders only for your own disposable database. Not read by Worker source. |
| `LOCAL_DATABASE_ONLY=1` | Explicit operator acknowledgement that the supplied database is disposable/local. |
| `PG_BIN` | Existing PostgreSQL 17+ `bin` directory for the optional disposable-cluster test helper. |

`prod` is a name placeholder, **not provisioned/configured for production**.
Do not put credentials in Wrangler `vars`, React, source, logs or documentation.
E1 will introduce reviewed runtime connection/identity configuration; no unused
Supabase elevated key is requested now. E4 will add private storage adapters;
R2/Images resources remain absent. This configuration is not a deployment gate:
do not run a real deploy command without separate authorization.

## Layout and dependency choices

```text
backend/
  src/index.ts                   Worker entry point
  src/app.ts                     Composition/routing/error boundary
  src/env.ts                     Runtime environment validation
  src/shared/http.ts             Normalized errors and response headers
  src/modules/system/            Public liveness
  src/modules/identity/          User/session types; deny boundary only
  src/modules/projects/          Project/membership types
  migrations/                    Paired up/down PostgreSQL SQL
  scripts/                       Node-only migration and disposable-PG tooling
  tests/                         HTTP, workerd, artifact and PostgreSQL tests
  worker-configuration.d.ts       Generated runtime types; regenerate on config changes
```

See [module boundaries](src/modules/README.md) and the approved
[implementation sequence](../docs/IMPLEMENTATION_PLAN.md). The future hierarchy
remains Project → Trip → Visit → Photo with reusable Place; E0 does not prematurely
create E2/E4 tables or migrate frontend demo data.

- No production npm dependency is needed for E0's native Fetch API. No router,
  ORM, Supabase SDK or hand-written OAuth implementation is introduced.
- Wrangler **4.156.0** builds and supplies the local workerd test harness. Its
  pinned dependency tree includes workerd **1.20261023.1** and Miniflare
  **5.20261023.3-beta**. Tests use Wrangler's `createTestHarness`, not the changing
  low-level Miniflare constructor. The beta simulator is a development dependency,
  not a production Worker package.
- `pg` **8.16.3** / `@types/pg` **8.15.5** are **development dependencies** for
  Node-only migration/tests; they are not bundled into the Worker. The runtime
  currently uses no Node APIs, so no `nodejs_compat` flag is necessary. E1 must
  verify compatibility and minimal database privileges when adding its adapter.
- TypeScript **6.0.3**, ESLint **10.12.0**, typescript-eslint **8.71.1** and Node's
  built-in test runner provide strict checking without another test framework.
  All direct versions are pinned; lockfile records transitive versions.

References: [Workers TypeScript/types generation](https://developers.cloudflare.com/workers/languages/typescript/),
[local runtime](https://developers.cloudflare.com/workers/local-development/),
[testing](https://developers.cloudflare.com/workers/testing/),
[Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).

## PostgreSQL migration and reversibility

`0001_foundation` creates a private `travel_map` schema and four tables:

- `users`: application ID distinct from unique stable `supabase_auth_user_id`;
  email is not the identity key, and no application password is stored. No FK
  to Supabase's internal `auth` schema is required for standalone local migration;
  identity bootstrap/deletion synchronization is E1 work.
- `projects`: one non-null owner FK, policy and lifecycle fields. Ownership is
  derived from this row, never a mutable membership role.
- `project_memberships`: unique project/user pair, admin/member only,
  revocation fields; a trigger prevents a duplicate owner membership. An ownership
  change requires resolving any destination membership transactionally first.
- `app_sessions`: unique SHA-256-shaped token digest, account FK, absolute/idle
  expiry, last seen and revocation timestamp. No raw token or provider refresh
  token column. Session issuance/validation, cookie policy and timeout durations
  are intentionally not implemented or selected by E0.

FKs restrict physical deletion; triggers protect retained project ownership and
update timestamps. Deactivation of a retained project's owner is rejected until
ownership is resolved; this is an invariant, not an account-deletion workflow.
Role/action decisions, assisted transfers, revocation races and account lifecycle
services still require their implementation stages.

All four tables enable and **force RLS**, with **no allow policies**. PUBLIC
schema/table/function privileges are revoked. No browser/PostgREST/API role is
granted access. This intentionally blocks reads/writes for an unprivileged app
connection until E1 adds reviewed authorization/privileges. Migration/test admin
credentials must never become Worker credentials. Superuser/BYPASSRLS can bypass
RLS, so their success does not prove application access is safe. See
[PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
No extensions are needed: PostgreSQL supplies `gen_random_uuid()`.

### Automatic disposable PostgreSQL test (recommended)

Use existing PostgreSQL 17+ binaries (Homebrew, an approved local installation or
the already-installed native runtime cache). No download/install is performed:

```sh
export PG_BIN=/absolute/path/to/postgresql/bin
npm run db:local:test
```

This creates a **new cluster** under ignored `.local/pg-e0-*`, initializes it with
synthetic `travel_map_e0` admin and local trust authentication, listens only on
127.0.0.1 at a free port, creates a random test database, executes the suite, drops
that database/temporary role, stops PostgreSQL and removes its own directory.
Trust authentication is exclusively for this short-lived synthetic cluster, not
a reusable development or production authentication recipe. Other local OS users
can reach loopback: do not use sensitive data. Never point `PG_BIN` at an
untrusted executable. If startup/shutdown fails, inspect only its `.local`
directory; stop that cluster with `pg_ctl -D <that-directory>/data -m fast -w stop`
before removing its files. Do not stop unrelated servers or clean global volumes.

### Your separately prepared disposable local database

An operator must create a **new** `travel_map_dev` database with a dedicated local
migration owner. Do not reuse any PoC or third-party database. Copy the template:

```sh
cp .env.example .env
# Edit .env locally; never paste its contents into logs or chat.
npm run db:migrate -- status
npm run db:migrate -- up
npm run db:migrate -- down --allow-destructive-local
```

The CLI rejects non-loopback hosts, URL query overrides, other database names and
missing explicit local acknowledgement. It permits `travel_map_dev` or
`travel_map_test_<suffix>` only. This does not detect a port forwarded to cloud;
the operator must ensure the endpoint really is local. Remote migration support
is intentionally absent in E0. Statement/lock timeouts bound local CLI waits.

Migrations run in transactions under a per-database advisory lock. A separate
private `travel_map_migrations.applied` ledger records version, checksum of **both**
directions and timestamp. Applied migrations are immutable: edit detection fails
closed; introduce a new migration instead. `status` does not initialize a schema.
`up` is repeatable; `down` reverses **only the latest** migration and is destructive.
The foundation down removes the four application tables/functions/schema, without
CASCADE or deleting another schema; the empty ledger remains for reapplication.
Use down only for disposable local data, never as a production data recovery plan.

`npm run test:db` uses the local `.env` connection only to locate/administer a local
server. It creates and drops a **different random test database**, never clears
the named database. It needs local CREATEDB/CREATEROLE privileges to test RLS and
must not run as a production role. Without a URL it explicitly skips; that is
not a database-validation pass. `npm run db:local:test` supplies its own isolated
admin/server and is the verified path.

## Checks and scope

```sh
npm run lint
npm run typecheck
npm test
npm run db:local:test   # PG_BIN required
```

`npm test` builds before testing; `npm run build` is literally
`wrangler deploy --dry-run --env test --outdir dist`: **local bundling only**, no
upload/deployment despite Wrangler's calculated “Total Upload” size label.
Output/state/logs are ignored. Do not remove `--dry-run`.

Tests cover actual workerd startup, liveness, private API denial even with forged
credentials, normalized errors, sanitized internal exceptions, missing harness
routes, secret-path ignore/index checks, known credential-pattern/build isolation,
local migration guards and paired checksums. PostgreSQL tests cover concurrent
migrators on an empty DB, basic ownership/session constraints, unprivileged/RLS
denial, drift rejection, failed-DDL rollback and down/up reapplication.

Artifact pattern checks are bounded regression checks, not a history-wide secret
audit. Nothing is staged/committed by the tooling. [E0 validation record](E0_VALIDATION.md)
lists actual commands/results, environment and initial failures. No hosted
Supabase behavior, Google OAuth, private media conversion, mobile frontend or
production security/performance certification is claimed. **Stop at E0; E1 is
the next separately requested implementation stage.**
