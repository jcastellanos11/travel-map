# E2.1 — Trips and inherited authorization

Date: 2026-11-04. Scope: E2.1 only. Baseline commit: `119100053246583f334b8c70049942a1184b5c45`. No E2.2–E2.4, frontend changes, deployment, cloud provisioning, dependency installation, commits or pushes.

## Implemented behavior

| Endpoint | Result | Authorization inside SQL |
|---|---|---|
| GET `/api/v1/projects/{projectId}/trips` | 200 `{items,nextCursor}` | Active Project Owner/Admin/Member only |
| POST `/api/v1/projects/{projectId}/trips` | 201 Trip | Owner/Admin; Member only with existing `all_project_members` policy |
| GET `/api/v1/trips/{tripId}` | 200 Trip | Inherited Project access, or active explicit Guest of this Trip |
| PATCH `/api/v1/trips/{tripId}` | 200 Trip | Owner/Admin only, including Trips created by Members |

P-03 Option A was explicitly approved by the user for this increment: authorship does not grant Members editing privileges. Recorded in AUTHORIZATION_MATRIX and E2_IMPLEMENTATION_PLAN. This does not alter future Visit creator/Admin rules.

Trip projection: `id,projectId,createdByUserId,name,description,status,createdAt,updatedAt`. Guest sees no parent roster, emails, other Trips or counts. POST/PATCH whitelist only name/description; path supplies immutable parent/Trip identity, authenticated SQL actor supplies creator. Name is trimmed and bounded to 200 Unicode code points; description is nullable and bounded to 2000. JSON body budget 16,384 bytes; malformed payloads, invalid text and privileged fields return 400. PATCH omission preserves a field; null clears description.

List pagination reuses the unchanged Project algorithm: default 25, max 100, opaque cursor, ascending `(created_at,id)`, limit+1 query after parent authorization and filtering active Trips. It does not promise a snapshot across pages or total counts. Unknown/hidden/inactive resources return 404; forbidden actions on visible resources 403; authentication failures 401; validated conflicts 409; dependency failure 503. Error messages are static whitelisted text; raw SQL errors are masked.

## Files and responsibilities

Created:

- `migrations/0003_trips_authorization.up.sql`, `.down.sql`: schema, owner/ACL preflight, private handlers and dispatcher extension/restoration.
- `src/modules/trips/{types,validation,routes}.ts`: DTO, bounded strict input parser, four routes.
- `src/shared/pagination.ts`: existing E1 pagination/UUID logic moved unchanged and re-exported from Projects.
- `tests/trips.test.ts`, `tests/trips.integration.test.ts`: unit, native SQL/HTTP/workerd, concurrency and migration tests.
- This evidence document.

Modified:

- `src/app.ts`: delegates previously unmatched routes to Trip router after existing E1 authentication/Origin/CSRF handling; original E1 branches unchanged.
- `src/infrastructure/postgres.ts`: Trip-action-only safe error classification; existing E1 classification unchanged.
- `src/modules/projects/validation.ts`: re-exports shared pagination; Project input parser unchanged.
- `package.json`, `scripts/local-postgres.ts`: include Trip tests; no dependency or lockfile changes.
- `tests/e1.integration.test.ts`: pins original first two migrations so original E1 down/up regression remains meaningful; assertions unchanged. E2.1 and Supabase tests exercise full migration chain.
- `tests/migration-safety.test.ts`: expects three paired migrations.
- `README.md`, `src/modules/README.md`, and `../docs/{API_CONTRACT,AUTHORIZATION_MATRIX,DATA_MODEL,E2_IMPLEMENTATION_PLAN}.md`: implemented scope and P-03.

The pre-existing modification to `supabase/config.toml` was preserved, not authored by this task. No persistent secret/config values appear here.

## Database schema and safety boundary

`trips`: UUID PK, required Project and creator FKs, name/description, lifecycle status, UTC operational timestamps, archive/delete coherence checks. Parent pagination and creator indexes, touch trigger. `trip_memberships`: `(trip_id,user_id)` PK, Guest-only role, active/revoked status and coherent revoked timestamp, active-user index and touch trigger. All retained-content FKs are RESTRICT, no cascade deletion.

Project access is inherited dynamically; no duplicated Project membership rows in trip_memberships. Revoked Guest grants cannot deny active inherited access. Inactive account, parent, Trip or sole membership cannot authorize a read. No lifecycle, invitation, membership-management or guest-grant HTTP API exists in this increment; tests administratively seed synthetic grants only.

The runtime surface remains exactly four existing functions: `oauth_begin`, `oauth_consume`, `login_complete`, `api_call`. Session/account are resolved in the unchanged E1 dispatcher guard. New actions delegate to private SECURITY INVOKER `trips_action`; `trip_dto` is also private. Runtime cannot invoke either helper or select/write tables. FORCE RLS and owner-scoped policies protect both new tables; SECURITY DEFINER dispatcher owner, signature and ACL are preserved. Functions have fixed `search_path=pg_catalog`, UTC and schema-qualified references. No service-role key authorizes application domain requests.

Migration preflight requires the existing E1 function/table owner, owner-scoped FORCE RLS policies, no direct non-owner table ACLs, safe existing RPC definitions/grantees and private schema ACLs. It aborts with 42501 on drift; no role privilege repair occurs. A final transactional check also aborts if custom default privileges expose new tables/helpers. Tests use a non-superuser migration owner and separate NOINHERIT/NOBYPASSRLS runtime role. Supabase regression additionally exercises its existing administrative migration-owner context; runtime remains restricted.

Lock order is session/account → active Project → Trip if applicable → current membership. Parent shared locks serialize policy/archive changes; Trip patches lock the row; membership reads lock the current grant. Independent-connection tests hold locks, change policy/revoke membership, then verify the waiting operation rechecks current state. Already delivered responses cannot be retracted; no authorization cache is introduced. Future E2.3 membership/archive mutations must retain the documented parent-exclusive lock order.

## Migration operation and rollback

Use existing migration runner and existing authorized owner credentials in an ignored operator environment, never application credentials:

```sh
cd backend
npm run db:migrate -- status
npm run db:migrate -- up
```

Requires `LOCAL_DATABASE_ONLY=1`, an acknowledged loopback target and correct existing owner. Stop on preflight failure; do not grant superuser, BYPASSRLS, direct table access or role inheritance to make it pass. The migration runner locks and validates paired checksums, then wraps each migration and ledger update in a transaction.

No migration, rollback or fixture was applied to `travel_map_dev`. Its contents were not reset, deleted or overwritten. Original E0/E1 SQL migration bytes/checksums are unchanged, verified by unit checks and SHA-256 comparison.

`0003` down restores the exact E1 api_call definition/ACL, drops only private E2.1 helpers and then TripMembership/Trip tables, without CASCADE. It is destructive to Trip data and refuses names other than `travel_map_test_<suffix>`, even if the generic CLI permits travel_map_dev. Only in disposable tests:

```sh
npm run db:migrate -- down --allow-destructive-local
npm run db:migrate -- up
```

Never run this down against persistent data; prefer preservation/backup and forward repair. Reverse future dependent migrations before E2.1. Do not reverse E1 to undo E2.1.

## Executed validation

Installed tools reused: Node.js 24.21.0, npm 11.19.0, TypeScript 6.0.3, ESLint 10.12.0, Wrangler 4.156.0, pg 8.16.3, Supabase CLI 2.122.0, PostgreSQL 17.11 (ARM64 macOS). No tools installed or upgraded. Local networking/CLI home-state operations required explicit sandbox approval; no sandbox bypass was used.

Commands from `backend/`:

```sh
WRANGLER_LOG_PATH=.local/e21-check.log WRANGLER_SEND_METRICS=false npm run check
PG_BIN=/Users/luffy/.supabase/cache/stack/slim-services/postgres/17.11.0.006-r0/darwin-arm64/fb7594525d712ab85b6da00d4d4854f8d0c9ba26b49b781a5fede0119362e917/bin WRANGLER_LOG_PATH=.local/e21-db-runtime.log WRANGLER_SEND_METRICS=false npm run db:local:test
SUPABASE_LOCAL_STATUS_FILE=.local/e21-supabase-start.log WRANGLER_LOG_PATH=.local/e21-supabase-runtime.log WRANGLER_SEND_METRICS=false npm run test:supabase
```

The PG_BIN path is machine-specific; substitute an existing compatible PostgreSQL 17+ bin directory elsewhere. The disposable helper starts its own random-port loopback cluster and removes only that generated cluster after successful stop. It ignores `.env` database credentials.

| Executed check | Exact successful result |
|---|---|
| ESLint | Exit 0, zero errors/warnings |
| TypeScript app/tools | Exit 0 |
| Build | Wrangler `deploy --dry-run --env test --outdir dist`, exit 0; no deployment. Bundle 588.16 KiB / gzip 117.83 KiB |
| Unit/artifact/native workerd | 22 passed, 0 failed, 0 skipped |
| Disposable PostgreSQL | 48 records passed, 0 failed, 0 skipped: E0 7 child tests, E1 14, E2.1 24, plus 3 parent records |
| Local Supabase Auth/workerd | 5 records passed, 0 failed, 0 skipped: 4 child tests plus 1 parent |

Combined: **75 passing Node test records (71 leaf test cases and 4 parent records)**, not 75 independent leaf tests. Tests are correctness/security checks, not production performance benchmarks. Successful disposable suite elapsed about 1.22s; native Auth suite about 1.04s on this machine, excluding setup/build. No cloud/load/latency claims.

Security and migration cases executed: populated E1 forward upgrade; full-chain empty database; wrong owner; weakened RLS; unsafe direct grants; unsafe default helper ACL; injected mid-migration failure with transactional rollback/unchanged ledger and dispatcher; down/reapply; persistent-name down refusal using a separate disposable `travel_map_guard_*` database (not the user's database); exact dispatcher restoration; four-function-only surface; direct table/helper denial; forced RLS even after temporary SELECT grant in rolled-back test transaction; Owner/Admin/Member/Guest/foreign/revoked/inactive authorization; SQL calls independent of HTTP; creator/policy rules; deterministic tied-timestamp pagination; invalid/mass-assignment payloads; CSRF/Origin/security headers; two independent edits; policy/revocation races; invalid/expired/revoked sessions and logout. E1 regressions retain Google-only SDK, state/PKCE replay/expiry, rate limit, project isolation and session revocation checks.

### Local Supabase isolation and limitations

A separate ignored `.local/e21-supabase/supabase/config.toml` was prepared with project_id `travel-map-e21-tests`, separate 584xx ports (API 127.0.0.1:58421), Google disabled and no external credential references. Its lockfile reused installed artifacts. The existing Docker development stack, 574xx ports and real Google credentials were not changed. Start/stop commands ran from `.local/e21-supabase/`, with `umask 077` and logs redirected to protected ignored files (raw CLI status contains local keys and must not be printed or committed):

```sh
SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ../../node_modules/.bin/supabase stack start --runtime native --stack travel-map-e21-tests --eager --exclude realtime,storage,functions,studio,analytics,pooler > ../e21-supabase-start.log 2>&1
SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ../../node_modules/.bin/supabase stack stop --stack travel-map-e21-tests > ../e21-supabase-stop.log 2>&1
```

The named test stack was stopped after regression; its isolated data/logs remain local and ignored. Never use `--all`. To reproduce, prepare an isolated credential-free config first; do not copy real provider secrets or point this fixture suite at persistent development services.

Native Supabase actually verified getUser tokens, exchanged S256 authorization codes, rejected mismatched PKCE, and integrated app identity/projects/logout with workerd and password-authenticated PostgreSQL. Only the upstream Google result was synthetically seeded in test-only Auth tables; there is no production mock route or provider bypass. This does not constitute a fresh Google browser acceptance test. The prior real Google login/logout was user-confirmed and was not repeated.

### Failures resolved during execution

The first disposable suite reported 40 passed / 7 failed records (six E2.1 child failures plus their parent). A PL/pgSQL variable reference in the Guest path was mistaken for a table qualifier; it now uses an unambiguous local variable. The lock-observation tests initially read a cached statistics snapshot inside their observer transaction; they now clear that snapshot before polling. Rerun passed 47/47 records; adding the default-ACL safety regression produced the final 48/48 result above.

A Supabase help command initially hit sandbox EPERM writing CLI telemetry state; rerun with explicit approval succeeded. An initial isolated-stack setup was incomplete (configuration preparation stopped on an environment-reference safeguard); that start returned a native database preparation error. After writing the complete credential-free config, the named stack started and Auth tests passed. No failed result is claimed as verification. No credential values were printed from config/status logs.

## Completion and remaining work

E2.1 acceptance criteria are met locally. No unresolved E2.1 test failures. At the end of the implementation phase, persistent development migration remained an operator step. It was subsequently explicitly authorized and completed below. Optional real-browser Trip acceptance remains separate. Hosted PostgreSQL/Workers behavior, production scale, browser/mobile UI and real provider behavior beyond prior accepted Google flow were not tested in this increment.

Out of scope and not implemented: Places/Visits/maps (E2.2), membership administration/archive APIs (E2.3), invitations/redemption (E2.4), photos/media/quota (E4), frontend integration (E3), deployments and additional identity providers. Lifecycle columns do not imply lifecycle APIs. Guest grants are storage/authorization only until approved collaboration APIs exist. E2 as a whole is not complete.

Implementation-phase next step was migration review/application. That application is now completed below. Begin E2.2 only after separate authorization and resolution of its documented gates.

## Authorized application to persistent local development — 2026-11-04

**Result: migration 0003 successfully applied to the existing `travel_map_dev`.** This is a later, explicitly user-authorized operation, distinct from the disposable implementation tests above. No down migration, database reset/deletion, role grants, password changes, frontend/authentication changes, deployment, commits or E2.2 work occurred.

### Preflight and target verification

- Destination: `127.0.0.1:57422/travel_map_dev`, verified against running Docker container `supabase_db_travel-map-e1-local`, image `public.ecr.aws/supabase/postgres:17.11.0.006`.
- Docker mapping and connected PostgreSQL server address/port matched the same container (container address 172.18.0.2, PostgreSQL port 5432). No hosted endpoint or tunnel was used.
- Existing server-admin credentials were read privately from that container's environment, then the migration connection assumed the existing `travel_map_migrator` role. Database, E1 tables, migration ledger and dispatcher all had that owner. Owner assumption succeeded; the owner is not superuser, BYPASSRLS or INHERIT. No credentials were printed, saved in tracked files or granted/replaced.
- The application continued using the existing password-authenticated restricted `travel_map_api`, not server-admin credentials.
- `LOCAL_DATABASE_ONLY=1` was explicitly supplied to every migration/check command and validated through the existing `localDatabaseUrl` safeguard. The existing `.env` did not contain that setting; it was not edited or relied upon for this operation.
- Existing runner `scripts/migrations.ts` verified 0001/0002 history against the local paired checksums. Exactly three approved migrations were available; only 0003 was pending. No history/checksum overrides.
- E1 preflight counts: users 1, projects 0, project_memberships 0, app_sessions 1, oauth_transactions 1. Aggregate row-content digests were saved privately for before/after comparison; no row contents, token digests, cookies or identities were printed.

Initial address checks stopped safely before any migration: Docker publishes to `0.0.0.0`/`::` rather than a loopback-only binding, and PostgreSQL's address text includes `/32`. Inspection confirmed the intended local mapping; normalized server address then matched the container. Docker's pre-existing all-interface publication was not changed. Connection remained explicitly to 127.0.0.1; restricting Docker publication to loopback remains an operational follow-up, not a change made here.

### Backup before mutation

- Full database custom-format `pg_dump`, using the PostgreSQL tools inside the verified container.
- Local path: `backend/.local/backups/travel_map_dev-pre-0003-2026-11-04T15-02-36.854Z.dump`.
- Size: 33,394 bytes. File permissions 0600; backup directory 0700; Git-ignore verified.
- SHA-256: `122546de749d029d9e7a61dd6cc643538dea0243c0fce936dad0a3c63dca6645`.
- `pg_restore --list` verified the expected catalog entries. `pg_restore --file=/dev/null` successfully read/decompressed the full archive. File size/hash were rechecked immediately before migration.
- This verifies archive readability, not a test restoration. No restore was run. The dump preserves database objects/data/ACL references, not cluster-global role passwords; restoration requires the existing roles or a separately reviewed owner/ACL restoration procedure. Backup contains private development data and must remain local, ignored and access restricted.

### Exact local orchestration and results

Protected, ignored `.local/e21-dev-{migration,backup,verify}.mjs` helpers privately load the existing local configuration/credentials. They do not modify application source or configuration. The migration helper imports the **existing** `migrate` runner, validates the full approved chain and invokes `migrate(db,'up',migrations)` under the existing owner; it does not execute an alternative ad-hoc migration implementation.

Commands from `backend/` (each returned exit 0 after the preflight issues above were resolved):

```sh
LOCAL_DATABASE_ONLY=1 node .local/e21-dev-migration.mjs inspect
node .local/e21-dev-backup.mjs
LOCAL_DATABASE_ONLY=1 node .local/e21-dev-migration.mjs apply
LOCAL_DATABASE_ONLY=1 node .local/e21-dev-migration.mjs verify
LOCAL_DATABASE_ONLY=1 node .local/e21-dev-verify.mjs
LOCAL_DATABASE_ONLY=1 node .local/e21-dev-migration.mjs verify
```

`apply` returned exactly `["0003_trips_authorization"]`. Final history is `0001_foundation`, `0002_identity`, `0003_trips_authorization`; all three paired checksums match. The pre-migration checksums and backup manifest remain private in `.local/`. These one-operation helpers are local evidence, not shipped backend functionality.

### Post-migration checks: 15 passed, 0 failed

1. Existing restricted runtime password login works; no superuser/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS/INHERIT flags or role memberships.
2. All seven private domain/operational tables retain the expected migration owner, ENABLE/FORCE RLS and no runtime table privileges.
3. New owner-only policies and absence of non-owner table ACLs verified.
4. Runtime EXECUTE surface is still exactly oauth_begin, oauth_consume, login_complete, api_call.
5. Definer/invoker settings, ownership, fixed pg_catalog search paths and UTC verified for RPCs/new helpers.
6. E1 SQL function bodies match migration 0002 exactly, except the approved Trip delegation branch in api_call.
7. Actual runtime SQL SELECT attempts on E1/new tables and EXECUTE on both private Trip helpers fail with 42501.
8. Four RESTRICT foreign keys, five indexes (including PK indexes) and two touch triggers verified for the new tables.
9. Unknown session SQL call rejects with SESSION_REQUIRED.
10. E1 authenticated `/me` succeeds using a rollback-only synthetic session through the actual request handler and SQL boundary.
11. E1 project creation/read succeeds in that same rollback-only transaction.
12. All four Trip endpoints succeed through the actual handler and migrated database.
13. Wrong Origin and wrong CSRF token each return 403.
14. Logout returns 204; subsequent `/me` and Trip access return 401.
15. The entire synthetic smoke transaction is rolled back; trips and trip_memberships remain empty.

Authenticated smoke requests used the existing in-process request-handler dependency port with a transaction-bound repository executing actual SQL under `travel_map_api`. No HTTP mock-login route, production test mode or provider bypass was added. This is handler+SQL verification, not an authenticated browser/network OAuth test. Only temporary synthetic user/session/project/Trip records were created inside the rolled-back transaction; existing user sessions were never used or revoked by these tests.

Final verification repeated **after** the smoke rollback: E1 row counts and aggregate content digests all match the pre-migration snapshot. Existing users, projects, memberships, sessions and OAuth transactions were preserved. No permanent sample data remains.

Separately, Node HTTPS GETs against the already-running Worker at `https://127.0.0.1:8789` returned `/health` 200 and unauthenticated `/api/v1/me` 401. Certificate verification was bypassed only for this self-signed loopback development certificate. The Worker was not restarted or reconfigured. No new real-Google browser login was claimed or attempted; prior user-confirmed acceptance remains the provider evidence. Earlier complete regression suites were not unnecessarily repeated for this migration-only operation.

Remaining limitations: backup has not been test-restored; Docker's existing PostgreSQL host binding includes all interfaces; real-browser Trip acceptance and hosted behavior remain outside this operation. No migration blocker remains. E2.1 is locally migrated; E2.2 is not started.
