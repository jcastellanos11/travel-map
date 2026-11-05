# E2.3 — Membership Administration and Project Lifecycle

**Current local status:** migration 0005 is applied to `travel_map_dev`; 29 grouped
acceptance/security checks passed. The final section records the authorized migration,
backup, integrity evidence and verification limitations. Earlier sections retain the
implementation-phase evidence.

Validated locally on 2026-11-05, starting from commit `9976497`
(`feat(geography): implement E2.2 places visits and maps`).

**Implementation-phase result: E2.3 local acceptance criteria met.** Migration 0005 was
validated only in disposable databases at that stage; persistent `travel_map_dev`
application was pending until the separately authorized operation recorded below. E2.4 has not started. No deployment, frontend changes, dependency
installation, Docker networking changes, production data changes, commits or pushes.

## Interruption recovery and approved decisions

At resume, Git contained only a pre-existing change to `supabase/config.toml` and
three documentation additions recording approvals (AUTHORIZATION_MATRIX,
DATA_MODEL, E2_IMPLEMENTATION_PLAN). No 0005 migration or E2.3 code/tests existed.
Those additions were preserved, not repeated. The Supabase configuration change
was not edited or printed; local Google-enabled Docker services were not changed.

- P-02b Option A: Owner/Admin may edit Project name and the existing Trip creation
  policy only. No ownership/status/security-policy mass assignment.
- Departure Option A: revoke active Project membership and every active explicit
  descendant Trip grant atomically, including grants under inactive Trips. Preserve
  all authored Trips/Visits, creator IDs and future storage responsibility.
- P-01b Option B: Owner/Admin restoration rights are approved for a **future**
  workflow. E2.3 implements only Owner-controlled archive. There is no self-service
  restore endpoint, archived-project listing or restoration shortcut.

## File inventory

Created:

- `migrations/0005_membership_management.up.sql` and `.down.sql`.
- `src/modules/collaboration/routes.ts`, `validation.ts`, `README.md`.
- `tests/collaboration.test.ts`, `tests/collaboration.integration.test.ts`.
- `E2_3_VALIDATION.md` (this document).

Modified:

- `src/app.ts`: compose collaboration routing after existing authentication,
  Origin/CSRF checks and existing domain routes; E1 branches unchanged.
- `src/infrastructure/postgres.ts`: whitelist static errors for collaboration actions.
- `package.json`, `scripts/local-postgres.ts`: include E2.3 tests; no dependency changes.
- `tests/migration-safety.test.ts`: expect five migration pairs.
- `tests/geography.integration.test.ts`: pin its original four-migration chain so
  E2.2 down/reapply tests continue checking their intended version. Assertions retained.
- `README.md`, `src/modules/README.md`.
- `../docs/API_CONTRACT.md`, `AUTHORIZATION_MATRIX.md`, `DATA_MODEL.md`,
  `E2_IMPLEMENTATION_PLAN.md`.

Existing 0001–0004 migrations, identity module, project creation validation, Visit/
Trip handlers and frontend source remain unchanged. SHA-256 checks match the prior
records; automated immutability tests cover all four migration pairs. No lockfile,
Wrangler configuration or environment credential file was changed.

## Endpoints and validation

All paths below start with `/api/v1`. Authenticated sessions remain opaque,
server-side and revocable. All mutations retain exact Origin and X-CSRF-Token.

| Endpoint | Rule | Result |
|---|---|---|
| GET `projects/{id}/members` | Owner/Admin | 200 bounded roster |
| POST `projects/{id}/members/{userId}/promote-admin` | Owner; active Member target | 204 |
| POST `projects/{id}/members/{userId}/remove-admin` | Owner; active Admin target | 204, becomes Member |
| DELETE `projects/{id}/members/{userId}` | Owner non-Owner target; Admin ordinary Member only | 204, Project + descendant explicit grants revoked |
| POST `projects/{id}/leave` | Active Member/Admin self; Owner denied | 204, same atomic descendant revocation |
| DELETE `trips/{id}/members/{userId}` | Project Owner/Admin | 204, explicit Guest grant only |
| POST `trips/{id}/leave` | Active explicit Guest without inherited access | 204 |
| PATCH `projects/{id}` | Owner/Admin | 200 existing Project DTO |
| POST `projects/{id}/archive` | Owner only | 204 |

Roster projects only `userId`, `displayName`, `role`, `createdAt`; Owner is derived
from Project, never duplicated. Active accounts/memberships only, no email. Default
page 25/max 100; stable creation-time/userId cursor; authorization precedes projection.
Members receive 403 and Project-hidden Guests/outsiders 404.

Settings body: nonempty object containing only name and/or tripCreationPolicy.
Name trimmed, 1–200 Unicode scalar characters/no control characters; policy exactly
admins_only/all_project_members; omitted fields preserved;4096-byte budget. Dedicated
actions accept no body or `{}` only; no roles/actors/status fields or query parameters.
Worker and SQL independently validate input. workerd zero-byte streams are handled
as empty bodies; nonempty unexpected content is still rejected.

Wrong current role transition returns 409 only to an authorized Owner. Unknown,
revoked, inaccessible or inactive targets return 404. Visible forbidden actions 403,
invalid input 400, missing/invalid/expired/revoked sessions 401. Unexpected dependency
failures 503 carry static messages; raw SQL details never escape. Domain lock/
serialization conflicts map to 409; dispatcher/transport retains existing 503 behavior.

## Database and security boundary

0005 adds only `domain_audit_events` plus two private functions:
`collaboration_action(uuid,text,jsonb)` and trigger helper `audit_append_only()`.
Existing membership tables and lifecycle columns are reused. api_call receives one
explicit delegation branch; remaining E2.2 dispatcher body is preserved. Its owner,
ACL and security settings remain unchanged.

- All 11 domain/operational tables retain ENABLE/FORCE RLS and migration-owner policy.
- Runtime has no direct table access. Exactly four executable functions remain:
  oauth_begin, oauth_consume, login_complete, api_call. Actual permission denials
  and catalog checks verified; no service-role bypass or privileged runtime grants.
- New functions are SECURITY INVOKER, fixed pg_catalog search_path, timezone UTC,
  owned by the existing authorized migration owner; no runtime/PUBLIC EXECUTE.
- Session/account resolved/locked in api_call. Mutation handlers lock Project FOR
  UPDATE, required Trips in UUID order, then target membership/grant rows. Authority
  is checked after parent locking. Roster takes Project FOR SHARE.
- Revocation updates state only; explicit inherited access is never suppressed by a
  Trip grant. Project departure removes every existing descendant grant. Creator
  attribution alone never preserves editing after access loss.
- Archive changes only the Project lifecycle. Normal Project/Trip/Visit/map APIs
  hide descendants, new writes fail, and all contributions/memberships remain.
  No unrelated login sessions are revoked.
- Audit has actor FK(RESTRICT), resource ID/type, closed action enum, UTC timestamp
  and allowlisted server-built transition metadata. No names, emails, bodies,
  credentials, session digests, tokens or geography are stored. UPDATE/DELETE/
  TRUNCATE reject with 42501 even for ordinary owner DML. Trusted DDL owners can
  change triggers, so this is not tamper-proof storage against an operator.
- Audit insertion and domain mutation share one transaction. Injected audit failure
  returns sanitized 503 and rolls back Project membership plus every descendant grant.
  Explicit transaction rollback leaves neither role change nor audit event.

## Commands and actual results

Executed from `backend/`, using existing tools only:

```sh
node --version
npm --version
WRANGLER_LOG_PATH=.local/e23-check.log WRANGLER_SEND_METRICS=false npm run check
PG_BIN=/Users/luffy/.supabase/cache/stack/slim-services/postgres/17.11.0.006-r0/darwin-arm64/fb7594525d712ab85b6da00d4d4854f8d0c9ba26b49b781a5fede0119362e917/bin WRANGLER_LOG_PATH=.local/e23-db-runtime.log WRANGLER_SEND_METRICS=false npm run db:local:test
SUPABASE_LOCAL_STATUS_FILE=.local/e23-supabase-start.log WRANGLER_LOG_PATH=.local/e23-supabase-runtime.log WRANGLER_SEND_METRICS=false npm run test:supabase
```

| Check | Actual final result |
|---|---|
| Node/npm | v24.21.0 / 11.19.0 |
| Lint | Exit 0, no errors/warnings |
| Typecheck | Exit 0, Worker + tooling/tests strict TS |
| Build | Exit 0; Wrangler 4.156.0 `deploy --dry-run --env test --outdir dist`; 598.96 KiB, gzip 119.78 KiB; no deployment |
| Unit/artifact/workerd | 31 passed, 0 failed/skipped; Node duration 604.26 ms |
| PostgreSQL/HTTP/workerd | 104 records passed, 0 failed/skipped; 2333.38 ms |
| Native Supabase Auth regression | 5 records passed, 0 failed/skipped; 990.90 ms |
| Diff hygiene |`git diff --check` exit 0 |
| Old migration bytes |SHA-256 + unit checks unchanged 0001–0004 |

Total **140 passing Node test records = 134 leaf tests + 6 parent records**.
PostgreSQL breakdown: E0 7, E1 14, E2.1 24, E2.2 22, E2.3 32 leaf tests,
plus 5 parent records. Supabase has 4 leaf tests plus 1 parent. Unit suite 31 includes
4 new E2.3 tests. Durations exclude build/startup and are not production benchmarks.

Real PostgreSQL 17.11 ARM64 cluster uses random loopback port, max_connections=25.
The local helper creates and cleans only its own cluster/random test databases.
E2.3 upgrades use a synthetic non-superuser/NOBYPASSRLS/NOINHERIT migration owner
and separate restricted runtime login. No connection to travel_map_dev is made.

Native Supabase 2.122.0 test stack was started/stopped from
`backend/.local/e21-supabase` (pre-existing isolated, Google-disabled configuration):

```sh
umask 077
SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ../../node_modules/.bin/supabase stack start --runtime native --stack travel-map-e21-tests --eager --exclude realtime,storage,functions,studio,analytics,pooler > ../e23-supabase-start.log 2>&1
# Run test:supabase from backend/ as above, then stop only this named stack:
SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ../../node_modules/.bin/supabase stack stop --stack travel-map-e21-tests > ../e23-supabase-stop.log 2>&1
```

Both stack commands exited 0. Raw stack logs are private/ignored and were never
printed. Tests use real local GoTrue PKCE/getUser and actual workerd/pg against a
random application database with all five migrations. Only upstream Google identity
result is synthetic, seeded by the test administrator. No new real-Google browser
OAuth run is claimed. The user's running Docker Supabase/Worker were not restarted.

### Concurrency evidence

`tests/collaboration.integration.test.ts` uses independent PostgreSQL connections,
holds successful runtime RPC transactions uncommitted, starts a second HTTP request,
observes `pg_stat_activity.wait_event_type='Lock'`, then commits and asserts outcomes:

| First transaction | Waiting operation | Verified result |
|---|---|---|
| Owner promotes Member | Admin removes target |403; target remains Admin |
| Admin removes Member | Owner promotes target |404; no reactivation |
| Owner removes Member | Member creates Visit |404; no extra Visit |
| Member creates Visit | Owner removes Member |204 removal; committed Visit retained, later edits 404 |
| Owner archives Project | Admin creates Trip or Visit |404, both tested |
| Member leaves Project | Owner promotes target |404; no residual Trip grant access |
| Actor logs out | Same session removes Member |401; target remains authorized |

Additional tests cover deterministic revocation across multiple Trip grants,
inactive descendant grants, Guest departure vs inherited access, strict payloads,
policy immediacy, cross-Project guessing, hidden rosters, immutable Owner, retained
content/creator IDs, SQL authorization independently of HTTP, permission catalog
checks, audit failure injection and rollback. These verify ordering/correctness,
not distributed/cloud performance or invalidation of already downloaded data.

### Failures encountered and resolved

- An initial lint/typecheck invocation from repository root failed ENOENT (no root
  package.json); rerun from `backend/`. Lint then found an unused cursor alias and
  typecheck required TextDecoder's ignoreBOM option; both corrected.
- First sandboxed check:30 pass/1 fail, because workerd loopback listen was denied
  EPERM. Retried with the specific approved local-runtime permission; 31/31 passed.
- First PostgreSQL suite:101 pass/2 failing records (one E2.3 workerd child and its
  parent). A bodyless POST appeared as a non-null zero-byte stream, yielding 400
  instead of 204. Fixed the parser to recognize empty streams while keeping strict
  nonempty JSON validation; added the empty-body regression case. After adding one
  further payload/cross-Project case, final suite 104/104 passed.
- No remaining failed/skipped checks. No permission broadening or security bypass
  was used to resolve a failure.

## Migration safety and rollback

Verified through existing `migrate` runner, with LOCAL_DATABASE_ONLY=1 and generated
local test databases:

1. Existing 0001–0004 applied before upgrade, with populated users, sessions,
   Projects, memberships, Trips and Visits.
2. Wrong owner, weakened RLS, direct table grants and exposed private helper fail
   preflight without repair. Unsafe default function ACL also aborts transaction.
3. Failure injected after full 0005 SQL restores ledger, schema, dispatcher and ACL.
4. Forward 0005 preserves prior content/session access and dispatcher owner/ACL.
5. Latest down restores byte-equivalent E2.2 function definition/owner/ACL. Legitimate
   revoked membership state and retained content remain; down does not undo actions.
6. Reapply succeeds; full five-down/five-up succeeds in generated disposable fixtures.
7. A generated guard database with a non-test name refuses destructive down before
   changes. This does not touch or rename any persistent development database.
8. Runtime four-function surface, private helper isolation and FORCE RLS hold.

Disposable-only manual procedure, with an authorized owner connection supplied
privately and never using travel_map_api as migration owner:

```sh
# DATABASE_URL must identify a disposable loopback travel_map_test_<suffix>.
# Keep credentials in ignored operator configuration; do not paste them into logs.
LOCAL_DATABASE_ONLY=1 npm run db:migrate -- status
LOCAL_DATABASE_ONLY=1 npm run db:migrate -- up
# Destructive audit/schema down: disposable test database ONLY.
LOCAL_DATABASE_ONLY=1 npm run db:migrate -- down
LOCAL_DATABASE_ONLY=1 npm run db:migrate -- up
```

**Before persistent migration:** obtain separate application approval; verify intended
127.0.0.1:57422/travel_map_dev target, authorized existing owner, LOCAL_DATABASE_ONLY=1,
0001–0004 checksums and exactly 0005 pending; capture non-sensitive counts/integrity
checks; create/verify private backup. Apply only pending 0005 using the existing
runner, recheck ACL/RLS/RPC and data integrity, then perform approved non-destructive
acceptance. Stop on any prerequisite failure. Never run down on persistent data.
Operational rollback should preserve audit evidence and legitimate lifecycle changes
through a separately reviewed forward repair/compatible code path.

## Limitations and final scope review

- Persistent development migration and real-browser E2.3 acceptance remain pending.
  New E2.3 routes require 0005; prior E0–E2.2 routes keep existing behavior before it.
- No new participant can join through E2.3: issuance/invitations/reactivation are
  E2.4, unimplemented. Management tests seed synthetic memberships only in disposable DBs.
- Restoration permission is approved for Owner/Admin but no restoration workflow/API
  exists. Archive currently has no self-service undo. No ownership transfer.
- Audit retention/export/operational access require future review. No audit reader,
  configurable security policy or new rate limit was invented. Minimal indexes and
  bounded roster are implemented; no cloud scale/latency claim.
- Exact Visit coordinate consent remains disabled; geography/catalog limits and
  Visit creator/current-access rules remain unchanged. No photo/EXIF/storage work.
- Existing tests exercise historical migration boundaries; new E2.3 integration and
  Supabase regression exercise latest 0005. No fresh real Google login was necessary
  or performed, and no user's browser cookies/CSRF tokens were extracted.
- No E2.4, frontend, hosted resource, billing, Docker network, dependency or unrelated
  authentication changes. Existing pre-turn Supabase config modification preserved.

Next step: review 0005 and this evidence, then separately authorize backed up local
persistent migration and E2.3 manual acceptance. Do not begin E2.4 automatically.

## Authorized persistent local migration and acceptance — 2026-11-05

**Migration 0005 successfully applied to existing
`127.0.0.1:57422/travel_map_dev`.** This later operation was separately authorized
by the user and supersedes the implementation-phase pending-migration status above.
No destructive down migration, database reset, data deletion, role/password change,
permission broadening, real Project archival, service restart, Docker networking
change, frontend/authentication change, deployment, commit, push or E2.4 work occurred.
Previously completed implementation changes were preserved.

### Preflight and private backup

- Privately loaded existing local configuration, enforcing exactly host 127.0.0.1,
  port 57422 and database travel_map_dev. Verified running Docker container
  `supabase_db_travel-map-e1-local`, PostgreSQL image, published port and connected
  server address against its Docker network address. No remote target or tunnel.
- Existing authorized server credentials were read privately from that container.
  Database/table/function ownership and effective `SET ROLE travel_map_migrator`
  verified; migration owner is non-superuser, NOBYPASSRLS and NOINHERIT. Existing
  `travel_map_api` login remains separate and restricted, with no role memberships.
  Credentials were not printed or changed.
- Explicit `LOCAL_DATABASE_ONLY=1` supplied and checked; existing loopback/name/query
  safeguards retained. Migration npm subprocess used existing owner context through
  PGOPTIONS, never the application role. No environment file was edited.
- All four applied migration versions/checksums matched repository pairs. Exactly
  five migration pairs existed; only `0005_membership_management` was pending.
  Existing owner/RLS/ACL/private-helper preflight passed without repairs. Runtime
  already had exactly the four permitted executable RPCs before migration.
- Private ignored `.local/e23-dev-before.json` records old schema/owner/ACL/RLS/
  policy snapshots, four RPC bodies/settings, migration checksums and full-row
  aggregate integrity digests. No private row content, session material or account
  identity was printed. These snapshots were compared again immediately before up.

Preflight and final preserved counts:

| Table | Existing rows before and after acceptance |
|---|---:|
| users | 1 |
| projects | 3 |
| project_memberships | 0 |
| app_sessions | 3 |
| oauth_transactions | 1 |
| trips | 3 |
| trip_memberships | 0 |
| country_codes | 3 |
| places | 6 |
| visits | 3 |

New `domain_audit_events` has **0 rows after acceptance rollback**; no synthetic
membership, session, Project, Trip, Visit or audit event was permanently added.

Backup:
`backend/.local/backups/travel_map_dev-pre-0005-2026-11-05T15-26-54.507Z.dump`.
Full-database custom-format pg_dump archive, **82,402 bytes**, file 0600 and directory
0700, Git-ignore verified before creation and again before migration. SHA-256:
`9a2d6c4f883041610bf6cb087439c7322ec21db29a86fbeb1127390a76cf2e66`.

`pg_restore --list` verified expected tables and migration ledger;
`pg_restore --file=/dev/null` successfully read/decompressed the complete archive.
Size/hash were rechecked before up. This is **archive readability/structure
verification, not a test restoration**. The backup contains private development data
and must stay local, ignored and private. Database dump does not contain cluster-global
role passwords; any future restoration requires a reviewed role/ownership procedure.

### Exact local commands and migration result

Ignored, private orchestration helpers use existing scripts and capture/sanitize
command output. From `backend/`:

```sh
LOCAL_DATABASE_ONLY=1 node .local/e23-dev.mjs preflight
node .local/e23-dev-backup.mjs
LOCAL_DATABASE_ONLY=1 node .local/e23-dev.mjs apply
LOCAL_DATABASE_ONLY=1 node .local/e23-dev.mjs verify
LOCAL_DATABASE_ONLY=1 node .local/e23-dev-acceptance.mjs
LOCAL_DATABASE_ONLY=1 node .local/e23-dev.mjs verify
```

The migration helper invoked the actual existing commands with owner credentials
supplied privately only through subprocess environment:

```sh
npm run db:migrate -- status
npm run db:migrate -- up
npm run db:migrate -- status
```

Preflight status: 0001–0004. Up returned **only**
`["0005_membership_management"]`. Final status: 0001–0005 with all paired checksums
matching. Existing advisory locking, per-migration transaction, ledger and timeout
handling were used unchanged. No earlier migration was reapplied or edited.

All six orchestration commands above exited 0. Initial sandbox access could not
reach local Docker services; retried after specific local-service permission. No
database prerequisite/security check failed, and no permission was broadened.
The protected helpers are local evidence, not production routes or shipped tools.

### Security, preservation and acceptance evidence

**29 grouped acceptance/security checks passed, 0 failed.** These are additional
local acceptance checks, not a rerun of or addition to the earlier 140 Node test
records. The completed isolated suite was not repeated unnecessarily.

| Check | Actual result |
|---|---|
| Owner and runtime | Authorized migration owner verified; existing runtime password login succeeds without elevated flags or role memberships |
| RLS and ACL | All 11 private tables retain migration owner and ENABLE/FORCE RLS; runtime has no direct table privileges |
| RPC boundary | Exactly oauth_begin, oauth_consume, login_complete, api_call executable by runtime |
| Private helpers | Seven E2.2/E2.3 helpers retain owner, SECURITY INVOKER, pg_catalog search_path and UTC; actual unauthorized helper/table calls fail 42501 |
| History/schema | 0001–0005 checksums match; prior schema/ACL/RLS snapshots unchanged; prior RPC bodies unchanged except approved collaboration delegation |
| Existing data | All ten old-table full-row digests and counts unchanged after migration and again after acceptance rollback |
| Existing domain flow | Synthetic authenticated user, catalog, Project/Trip creation, Visits and scoped Project/Trip Maps succeed |
| Roster | Owner/Admin 200; minimal IDs/display names/roles, no emails; Member 403, Guest/outsider 404 |
| Roles | Owner promotion/demotion 204 with correct persisted-in-transaction target role |
| Admin restrictions | Promotion, archival and Owner removal 403 |
| Settings | Owner/Admin PATCH 200; Trip creation policy takes immediate effect; ownership mass assignment 400 |
| Member removal | Admin DELETE 204; all synthetic descendant grants revoked; retained Visit/creator unchanged; former creator edit 404 |
| Project departure | Member leave 204; both explicit Trip grants deny subsequent access; contributed Visit remains readable by Owner; Owner leave 403 |
| Guest departure | Own Trip leave 204 then 404; second explicit Trip still 200; contributed Visit retained |
| Guest administration | Admin explicit Guest DELETE 204 then access404 |
| Audit atomicity | Domain mutation adds audit event; SAVEPOINT rollback removes both change/event; final full rollback removes every synthetic event |
| Audit content | Correct synthetic actor/resource transitions; no names, profile/email/location data or credential material |
| Archive | Only synthetic Project archived; descendants/maps 404 and new Trip creation 404; content/membership counts retained; no restore route |
| CSRF/Origin/isolation | Wrong Origin/CSRF 403; cross-Project settings 404 |
| Logout/session | Archive leaves synthetic session valid; logout 204 then private me/catalog/roster 401 |
| Live Worker HTTPS | Health 200; missing-session me 401; valid-format unknown synthetic session me/roster 401 through real Worker/database boundary |
| Supabase | Existing Auth health 200/settings 200 with Google enabled; configuration untouched |
| Cleanup | Synthetic transaction rolled back; original content/session digests unchanged; audit table empty |

### Verification boundaries and remaining risks

Authenticated E2.3 acceptance used the **actual handleRequest composition, routes,
validation and PostgreSQL RPCs executing under travel_map_api**, through the existing
transaction-bound repository test port. Synthetic identities and initial memberships
were seeded by the authorized owner inside one transaction; all new membership,
settings, departure and archive operations used the real APIs. No mock-login route,
production test flag, authentication bypass or browser-cookie extraction was added.
Existing user accounts/sessions/Projects were never used for mutations or logout.

This is authenticated **handler+database acceptance**, not authenticated network/
browser acceptance through the running workerd process. Network checks against
`https://127.0.0.1:8789` verified health and missing/unknown sessions. The synthetically
generated unknown cookie was never logged and cannot authenticate. Self-signed TLS
verification bypass was restricted to this loopback development endpoint. Actual
workerd authenticated E2.3/PG integration remains supported by the prior isolated
suite; it was not repeated against committed fixtures in this persistent database.

No new real Google browser login or authenticated browser management sequence was
performed. If that additional pass is desired, the login URL is
`https://127.0.0.1:8789/api/v1/auth/google/start`; use normal interactive login, without
copying cookies. Mutation testing must still avoid existing content and requires an
explicitly approved temporary-data/cleanup strategy. No real Project should be
archived because restoration remains unimplemented.

The existing Docker all-interface port publication was observed and preserved;
connections used only loopback. Network hardening is a separate operational change.
Backup restoration remains untested; no hosted/cloud readiness or performance claim.

**Local environment is migrated and passes the controlled E2.3 acceptance checks.**
No failed migration/security checks remain. Authenticated live-browser E2.3 testing
and test restoration of the backup remain unverified. E2.4 is not started.
