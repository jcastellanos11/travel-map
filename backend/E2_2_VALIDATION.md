# E2.2 — Places, Visits and authorized map projections

Date: 2026-11-04. Baseline commit: `af43da2e52e97ba0558056fc237a703f816c417a`.
Scope: E2.2 only; **implemented and locally validated for the non-gated scope**.
Exact Visit coordinate storage/sharing and inline-place resolution remain disabled.
Migration 0004 was not applied during isolated implementation. It was subsequently
explicitly authorized and applied on 2026-11-05; see the local acceptance record below.

## Approved decisions and remaining gates

- **D1 (approved):** city/region default and independent approximate catalog points.
  Exact Visit points need explicit confirmation and enforceable visibility. Actor,
  audience, reconfirmation after edits, consent withdrawal and revocation semantics
  are not defined. No new consent policy is invented: SQL requires every exact-point/
  confirmation/visibility column null, API rejects non-null confirmedCoordinates,
  DTOs always return null. Even a client assertion of confirmation grants nothing.
  Enabling this subfeature requires a separately approved policy and new migration.
- **D2 (approved):** PostgreSQL DATE, none/single/range, start=end for single, ordered
  complete range, inclusive independently supplied from/to and exclusion of undated
  Visits under active date filters. Serialize dates directly as strings, not JS Date.
- **D3 (approved):** stable UUIDs, canonical alpha-3 countries, independently sourced
  controlled catalog, explicit identity and no name-only merges. Initial GeoNames
  CC-BY-4.0 subset is six localities across COL/TUR/USA, with source IDs, download
  hashes, transformations and attribution in [catalog/README.md](catalog/README.md)
  and [snapshot](catalog/geonames-subset.json). No worldwide-coverage claim, live
  geocoder, paid service, or inferred coordinates. Country labels are source labels;
  region is the source admin1 code, not a translated label.
- Guest projection follows existing minimal-scope defaults: only authorized Trip
  Visits/markers and independent catalog fields; no Project name/roster/emails,
  unrelated Trips, global totals or private suggestions. Visit DTO retains its
  creator UUID; map DTO omits creator/name/Project context. Broader participant/
  Project context remains gated by P-09/P-10.
- No text resolver is enabled. Search returns explicit candidates (including
  homonyms); clients must choose placeId. Unknown IDs/inline-place objects fail 400.
  Catalog expansion/provider reconciliation needs reviewed provenance and stable
  identity mapping; this is a limited bootstrap catalog, not a final worldwide provider.

## Implemented endpoints and contracts

| Endpoint | Authorization | Success |
|---|---|---|
| GET `/api/v1/places?countryCode=COL&query=...` | Active session; independent catalog only | 200 page |
| GET `/api/v1/trips/{tripId}/visits` | Active inherited O/A/M or explicit Guest of Trip | 200 page |
| POST `/api/v1/trips/{tripId}/visits` | Same collaborators including Guest | 201 Visit |
| GET `/api/v1/visits/{visitId}` | Current active ancestry access | 200 Visit |
| PATCH `/api/v1/visits/{visitId}` | Creator with current access, or Project O/A | 200 Visit |
| GET `/api/v1/projects/{projectId}/map` | Active Project O/A/M; never trip-only Guest | 200 map page |
| GET `/api/v1/trips/{tripId}/map` | Authorized Trip readers including its Guest | 200 map page |

Authoritative details/examples: [implemented API contract](../docs/API_CONTRACT.md#e22-implemented-geography-contract-2026-11-04).
POST requires placeId; optional nullable name, complete date object and null-only
confirmedCoordinates. Name max 200 Unicode code points, no controls, trimmed; no
Visit description field in this increment (DATA_MODEL specifies optional name).
Body max 16,384 bytes. PATCH must contain at least one permitted field; omission
preserves a field, name:null clears it. Place may change; Trip/Project/creator/status
cannot be assigned. Creator is always the SQL-authenticated actor.

Lists use existing 25/default, 100/max, ascending `(created_at,id)` keyset pagination,
limit+1 and `{items,nextCursor}`. Map uses visitId for its cursor ID. Dates stay
YYYY-MM-DD strings (years 0001–9999). Map filters are countryCode/from/to, and
tripId only on Project map; a hidden/foreign/inactive Trip filter returns 404.
Place countryCode is required and uppercase alpha-3; unsupported/invalid codes
return 400. Query is optional literal case-insensitive substring, <=100 code points,
not accent folding/wildcards. Unsupported/duplicate/malformed filters return 400.
A supported country with no search matches returns an empty page.

Map items represent individual Visits: visitId,tripId,place,confirmedCoordinates,
date,photoCount,previewPhotoId,createdAt. Repeated locations remain separate Visits.
Photos do not exist yet: photoCount=0, previewPhotoId=null everywhere. No fake totals,
assets, unbounded facet aggregation, Project metadata or user-derived catalog data.
Pagination is not a cross-request snapshot. No frontend/Leaflet implementation.

## Database schema and security

Migration pair: `0004_places_visits.up.sql` / `0004_places_visits.down.sql`.

- `country_codes`: canonical alpha-3 key, display name, source attribution.
- `places`: stable UUID, country RESTRICT FK, locality, optional region, independent
  optional approximate WGS84 pair, optional scoped source/provider identity and URL,
  creation timestamp. Unique source/provider pair, **no city-name uniqueness**.
  Country/pagination index; seed is the reviewed subset embedded in this migration.
- `visits`: UUID, RESTRICT Trip/Place/creator references, nullable optional name,
  date mode and DATE boundaries, lifecycle and UTC timestamps, touch trigger.
  No Place/Trip/date uniqueness. Pair/range/finite coordinate checks and DATE coherence
  checks reject partial points, NaN/Infinity, invalid ranges, single missing end,
  infinities and out-of-contract date years. Exact fields are additionally constrained
  all null while policy is pending. Confirmation actor FK also uses RESTRICT.
- Scoped active Trip pagination and date indexes; Place/creator/confirmation-actor FK
  indexes. No PostGIS/extensions or external services required.

All new tables ENABLE/FORCE RLS with owner-only policies, PUBLIC revoked, no direct
runtime access. Runtime still executes exactly four RPCs: oauth_begin, oauth_consume,
login_complete, api_call. Private SECURITY INVOKER helpers: geography_action,
place_dto, visit_dto, valid_calendar, valid_visit_date. All have fixed pg_catalog
search_path, UTC, expected ownership, no runtime/PUBLIC EXECUTE. Existing migration
owner/table/ACL checks are retained and extended through E2.1; drift in helper
settings/ACL/signatures aborts. Final default-ACL checks abort atomically rather than
silently granting/revoking unrelated privileges.

SQL resolves session/account in the unchanged E1 guard. Trip Visit/map access reuses
E2.1 private trips_action to resolve active Project/Trip, inherited membership or
explicit Guest under the existing locks. Creator status alone grants no access.
Project map explicitly checks active parent and current owner/membership before
querying/filtering. Trip filter is checked against that same parent. No caller actor
ID is accepted. E2.1 P-03 remains Owner/Admin-only Trip editing.

Lock order: session/account → parent → Trip → current membership → Visit when needed.
Visit patch takes row lock; parent/membership locks prevent stale grants through
concurrent changes. The future E2.3 mutations must retain the exclusive-parent lock
protocol. E1 Origin/CSRF/CSP/cookies/logout and existing Project/Trip handlers remain
unchanged. Safe domain errors use static 400/403/404/409/503 messages; authentication
401 and existing E1 rate/429 behavior retained. No raw SQL details are returned.
No GPS, request-body, EXIF or audit logging is added. Hosted platform/access-log
configuration remains unverified; no claim is made about future infrastructure logs.

## Files created and modified

Created:

- `migrations/0004_places_visits.{up,down}.sql`.
- `catalog/{README.md,geonames-subset.json}`.
- `src/modules/geography/{routes,validation,types}.ts`.
- `tests/geography.test.ts`, `tests/geography.integration.test.ts`.
- `E2_2_VALIDATION.md` (this file).

Modified:

- `src/app.ts`: delegates otherwise unmatched routes to geography, after unchanged
  E1 authentication/Origin/CSRF boundary and existing Trip routing.
- `src/infrastructure/postgres.ts`: reuses safe Trip domain error mapping for
  places/visits/maps actions; E1 error behavior unchanged.
- `package.json`, `scripts/local-postgres.ts`: include new tests; no dependencies
  installed/changed, no lockfile modifications.
- `tests/migration-safety.test.ts`: four pairs expected.
- `tests/trips.integration.test.ts`: pins original first three migrations, including
  its guard-database test, so E2.1 down/up assertions continue testing E2.1. Original
  assertions/semantics retained; E2.2 tests and Supabase exercise all four migrations.
- `README.md`, `src/modules/README.md`, `../docs/{DATA_MODEL,API_CONTRACT,
  AUTHORIZATION_MATRIX,E2_IMPLEMENTATION_PLAN}.md`: current scope, contracts/gates.

Pre-existing `supabase/config.toml` modification preserved, not changed by this task.
No frontend, identity module, E1/E2.1 migration, .env or production service changes.
No commits, pushes, cloud deployments, resources, billing or Docker network changes.

## Executed checks and exact results

Reused installed Node 24.21.0 / npm 11.19.0, TypeScript 6.0.3, ESLint 10.12.0,
Wrangler 4.156.0, pg 8.16.3, PostgreSQL 17.11 ARM64 macOS, Supabase CLI 2.122.0.
Sandbox approvals were obtained for loopback runtimes/CLI state and public source
downloads. No tools/dependencies were installed or upgraded.

Commands from `backend/`:

```sh
WRANGLER_LOG_PATH=.local/e22-check.log WRANGLER_SEND_METRICS=false npm run check
PG_BIN=/Users/luffy/.supabase/cache/stack/slim-services/postgres/17.11.0.006-r0/darwin-arm64/fb7594525d712ab85b6da00d4d4854f8d0c9ba26b49b781a5fede0119362e917/bin WRANGLER_LOG_PATH=.local/e22-db-runtime.log WRANGLER_SEND_METRICS=false npm run db:local:test
SUPABASE_LOCAL_STATUS_FILE=.local/e22-supabase-start.log WRANGLER_LOG_PATH=.local/e22-supabase-runtime.log WRANGLER_SEND_METRICS=false npm run test:supabase
```

| Check | Final executed result |
|---|---|
| ESLint | Exit 0, no warnings/errors |
| TypeScript application/tools | Exit 0 |
| Build | Exit 0, `wrangler deploy --dry-run --env test --outdir dist`; no deployment; 594.64 KiB / gzip 119.07 KiB |
| Unit/artifact/workerd | 27 passed, 0 failed/skipped |
| Disposable PostgreSQL/HTTP/workerd | 71 records passed, 0 failed/skipped: E0 7, E1 14, E2.1 24, E2.2 22 child tests, plus 4 parents |
| Native Supabase PKCE/identity/logout/workerd | 5 records passed, 0 failed/skipped: 4 children + parent |
| Git scope/whitespace review | git diff --check clean; identity/frontend/0001–0003/lockfile diffs empty |

Total: **103 passing Node test records = 98 leaf test cases + 5 parent records**.
No skipped infrastructure tests claimed as passes. Successful final suite times:
unit/runtime ~0.69s, disposable PostgreSQL ~2.01s, Supabase ~1.23s, excluding
setup/build. These are correctness checks, not production latency/load benchmarks.

Coverage executed includes homonyms/source IDs; seed/snapshot coordinate agreement;
repeated Visits and same Place across Trips; missing/ambiguous/invalid Places;
no/single/range/leap/reversed/invalid dates; UTC/Europe-Istanbul/America-Los_Angeles
round trips; inclusive and one-sided date filters/undated exclusion; scoped country/
Trip/cursor projections; O/A/M/G read/create/edit; creator/current-access and retained
content on membership loss; inactive parents/account; cross-project/Trip denial;
Guest Project-map denial; null-only exact GPS even with claimed confirmation;
no catalog private-data dependence; table/helper denial and temporary-grant FORCE
RLS; mass assignment/actor spoofing; CSRF/Origin/headers; concurrent complete edits
and revocation race; all seven endpoints in actual workerd; auth/session/logout;
E0/E1/E2.1 regressions; owner/RLS/ACL/helper/default-ACL drift; migration atomicity,
restoration, reapply and complete disposable reverse/fresh-forward chain.

Supabase regression verified real local Auth getUser, S256 code exchange, mismatched
PKCE rejection, mapped identity and application logout. Only the **upstream Google
result** is synthetically seeded by the isolated test administrator; no production
route/mock login/bypass is added. This is not a fresh real-Google browser test.
Prior user-confirmed Google acceptance remains historical provider evidence.

### Query plans and bounded fixture

`tests/geography.integration.test.ts` inserts 110 synthetic single-day Visits and
checks all pages of Trip Visits/maps (17 per page), deterministic tied-timestamp
ordering and absence of foreign scope/cursor leakage. It runs ANALYZE on its own
fixture tables, then EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) for the scoped join/filter/
order/limit query used by map selection. A second plan sets enable_seqscan=off
inside a rolled-back transaction solely to check index eligibility.

Ignored local evidence: `.local/e22-evidence/query-plans.json`. The final natural
plan uses Limit → Sort → Nested Loop/Hash Join with small-table sequential scans,
26 result rows, 110 matching generated-date rows; measured planning ~0.705ms,
execution ~0.049ms on this synthetic machine run. The diagnostic index-eligibility
plan uses an active Trip pagination/date index; it is not the natural planner
choice and was not used to claim speed. Inner selection is scoped before bounded
JSON aggregation (maximum limit+1=101); no totals/facets over unauthorized resources.
This does not establish production scale, 4G/mobile performance or hosted plans.

### Isolated Auth/runtime lifecycle and public source acquisition

Only random generated `travel_map_test_*` databases (and disposable guard databases)
were created/modified in the generated PostgreSQL cluster; it was stopped and its
own directory removed after tests. No travel_map_dev connection/migration or Docker
service/network change occurred.

Reused the separately configured, Google-disabled native test stack under ignored
`.local/e21-supabase/` (API 127.0.0.1:58421), not the existing Google-enabled 574xx
Docker development stack. Commands from that isolated directory, umask 077:

```sh
SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ../../node_modules/.bin/supabase stack start --runtime native --stack travel-map-e21-tests --eager --exclude realtime,storage,functions,studio,analytics,pooler > ../e22-supabase-start.log 2>&1
SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ../../node_modules/.bin/supabase stack stop --stack travel-map-e21-tests > ../e22-supabase-stop.log 2>&1
```

The named isolated stack was stopped after tests; no --all or broad cleanup. Logs
contain generated local keys, are ignored/private, and must not be pasted/committed.
Supabase tests clean their own synthetic Auth users/flow rows, random application
database and runtime role. Native service data/logs remain isolated and ignored.

Public source files were downloaded with `curl --fail --silent --show-error --location`
from the three official URLs recorded in catalog/geonames-subset.json into ignored
`.local/e22-geonames/`. Initial sandbox DNS failure was retried with explicit network
approval. GeoNames official readme confirmed CC-BY-4.0; subset/source hashes and
attribution are included in project files. No account, service signup or API key.
Daily upstream artifacts can change; migration seed is pinned in repository content.

### Failures resolved

Initial type checks caught required TextDecoder ignoreBOM typing and a workerd
harness Request-type mismatch; both were corrected without weakening validation.
The first disposable run had 64 passed / 6 failed records: four children plus two
parents. Causes were test errors: expecting denial of a foreign user's own Trip;
passing a Node Request object to the Miniflare harness instead of URL/init; an
expired-session fixture violating existing E1 lifetime constraints; and the E2.1
guard test accidentally applying all four migrations while asserting three. All
were corrected (scope expectations, URL/init adapter, coherent synthetic timestamps,
original migration-chain pinning). Subsequent suite passed 70/70; adding the E2.2
rollback-guard test and expanded preflight checks produced final 71/71 above.
No failed command is represented as validation success.

## Migration and rollback procedure

No persistent migration is authorized in this implementation. The existing generic
runner now sees 0004 as pending: **do not run up against travel_map_dev automatically**.
A future separately approved application must first verify exact loopback target,
existing authorized owner, paired 0001–0003 history/checksums, backup/readability,
ACL/RLS preflight and data preservation, following the E2.1 operational precedent.
Never use Worker credentials, expand grants, disable FORCE RLS or reset a database.

For disposable testing only, existing tooling under the existing authorized owner:

```sh
# Ignored operator configuration must target a disposable loopback test database:
# DATABASE_URL=<owner connection to travel_map_test_suffix>, LOCAL_DATABASE_ONLY=1
npm run db:migrate -- status
npm run db:migrate -- up
npm run db:migrate -- down --allow-destructive-local
npm run db:migrate -- up
```

0004 down restores the exact E2.1 dispatcher definition/signature/owner/ACL, drops
private geography helpers, then Visits → Places → countries. No CASCADE. It refuses
names outside travel_map_test_*; this refusal was executed against a separately
created disposable travel_map_guard_e22_* database, never against travel_map_dev.
Failure injection (missing function after complete up SQL) verified atomic rollback
of schema/seed/dispatcher/ledger. Forward from populated E2.1, latest down/reapply,
and complete 0004→0001 reverse / 0001→0004 fresh forward were actually executed only
in generated disposable databases. Existing owner/role posture remains unchanged;
a full schema recreation requires normal narrow runtime provisioning, not broad grants.

Existing migration bytes remain unchanged; unit tests and SHA-256 compare verify
all six original files. 0003 hashes:
up `eb25f5973b4001a507c959e97ba2e87fbf690043a6f3784e5018bd28efce6266`,
down `5e2ebc7711503bdbc8ea758039bac3407d0436c1c4892a592e39ed537d96194d`.
A source comparison verified the 0004 dispatcher is exactly 0003 plus one approved
E2.2 delegation branch; prior E1 guards/Project/Trip operations are unchanged.

## Completion and limitations

E2.2's non-gated Places/Visits/map scope meets local acceptance criteria. No unresolved
test failures or migration/security blockers. Exact Visit points are intentionally
**not enabled** pending the privacy policy above. Inline-place resolver/automatic
catalog creation and worldwide coverage are not implemented. Region labels, aliases,
accent-insensitive search and cross-provider reconciliation need future catalog work.
Browser/frontend acceptance, hosted behavior, production performance and infrastructure
logging remain unverified, not inferred from local tests.

No E2.3 membership/archive, E2.4 invitations, deletion/trash/restore, EXIF, storage,
photos/quota, frontend, new auth providers, cloud resources or deployment. No personal
photos, real identities or Google accounts used for new tests. E2 as a whole is not
complete. Next: review this diff/contracts/catalog limitations and pending exact-point
policy; separately authorize a backed-up 0004 local development migration if desired.
Do not begin E2.3/E2.4 automatically.

## Authorized local development migration and acceptance — 2026-11-05

**Migration 0004 successfully applied to existing `127.0.0.1:57422/travel_map_dev`.**
This later operation was explicitly authorized by the user, separately from the
isolated implementation above. No down migration, reset, drop/recreate, role/password
change, Docker networking change, frontend/authentication change, deployment, commit,
push or E2.3/E2.4 work occurred. Only this validation document was changed in tracked
implementation content during this operation; previous implementation changes and
the pre-existing Supabase configuration modification were preserved.

### Preflight and backup

- Verified running Docker `supabase_db_travel-map-e1-local`, its PostgreSQL image,
  port mapping and connected server address match the intended local container.
  Connection was explicitly to 127.0.0.1:57422, database exactly travel_map_dev.
  Existing Docker all-interface publication was not altered; no remote/tunnel used.
- Existing authorized server-admin credentials were privately read from that local
  container. Migration commands assumed the existing **travel_map_migrator** owner
  using PGOPTIONS role selection, verified before execution. Effective owner is
  non-superuser, NOBYPASSRLS, NOINHERIT; travel_map_api was not the migration role.
  Runtime retained its separate existing restricted password/login and grants.
- Explicit LOCAL_DATABASE_ONLY=1 supplied and verified. Existing runner loopback/name/
  query-override restrictions remained in force; no .env or Worker credentials edited.
- Exactly 0001_foundation, 0002_identity, 0003_trips_authorization were applied; their
  paired checksums matched. Only approved 0004_places_visits was pending; exactly
  four local migration pairs existed. SQL owner/RLS/ACL/helper preflight passed.
- Protected ignored `.local/e22-dev-before.json` records schema snapshots (ownership,
  ACL, RLS, policies, columns and constraints), RPC bodies/settings/ACLs, migration
  history/checksums and complete-row aggregate digests. No private account/session
  values or raw row content were printed.
- Preflight E1/E2.1 row counts: users=1, projects=0, project_memberships=0,
  app_sessions=1, oauth_transactions=1, trips=0, trip_memberships=0.

Backup: `backend/.local/backups/travel_map_dev-pre-0004-2026-11-05T12-52-49.944Z.dump`.
Full-database custom-format pg_dump using the verified container's PostgreSQL tools;
50,689 bytes, file 0600, directory 0700, Git-ignore verified. SHA-256:
`dd688f1b746d3907d4fbb9154dd70426597a836e743aa22fc83d1e26391a3e0a`.
`pg_restore --list` verified expected archive structure and
`pg_restore --file=/dev/null` read/decompressed the archive successfully. Size/hash
were rechecked before migration. This is archive validation, **not a test restore**.
No restoration was attempted. It contains private development data and must remain
local/ignored/private; cluster-global role passwords are not part of a database dump.

### Executed migration commands and preservation

Ignored local orchestration `.local/e22-dev.mjs` invokes these **actual existing npm
commands**, with owner DATABASE_URL supplied only in child-process environment and
PGOPTIONS selecting the existing authorized owner (no secrets in argv/output):

```sh
npm run db:migrate -- status
npm run db:migrate -- up
npm run db:migrate -- status
```

Preflight status returned exactly 0001–0003. Up returned exactly
`["0004_places_visits"]`. Final status returned 0001–0004, all paired checksums
matching. No earlier migration was reapplied or edited. Runner advisory locking,
transactional application/ledger and existing timeout/error handling were used.

Local orchestration commands from backend/:

```sh
LOCAL_DATABASE_ONLY=1 node .local/e22-dev.mjs preflight
node .local/e22-dev-backup.mjs
LOCAL_DATABASE_ONLY=1 node .local/e22-dev.mjs apply
LOCAL_DATABASE_ONLY=1 node .local/e22-dev.mjs verify
LOCAL_DATABASE_ONLY=1 node .local/e22-dev-acceptance.mjs
LOCAL_DATABASE_ONLY=1 node .local/e22-dev.mjs verify
```

All returned exit 0. Post-migration and post-acceptance comparisons both confirmed
unchanged E1/E2.1 row counts/content digests and schema snapshots. Existing RPC
ownership, ACLs, fixed settings and source bodies match the preflight snapshot,
except api_call's approved E2.2 delegation. Existing personal user/session/OAuth
records were never used for tests or revoked. No permanent sample data remains.

### Schema, security and acceptance results

**22 grouped acceptance/security checks passed, zero failed.** This operation did
not rerun or add to the earlier 103 isolated Node test records; these are separate
controlled acceptance checks, not a new full regression-suite count.

| Area | Actual result |
|---|---|
| Catalog/schema | country_codes=3, places=6, visits=0 after rollback; all six source IDs/country/name/approximate points match pinned snapshot |
| Restricted runtime | Existing password login succeeds; no superuser/role administration/BYPASSRLS/INHERIT or role memberships |
| RLS/table access | All ten domain/operational tables retain expected owner and FORCE RLS; runtime has no direct table privileges; actual new-table SELECT denied 42501 |
| RPC/helper boundary | Exactly four runtime-executable RPCs; all five new private helpers reject EXECUTE; owner, SECURITY INVOKER, pg_catalog search paths and UTC verified |
| Health/me | Actual handler health=200, unauthenticated me=401, synthetic authenticated me=200 |
| Places | Authenticated COL search=200, two valid independent catalog Places |
| Project/Trip | Synthetic Owner creates each through existing POST APIs (201) with server-derived ownership/ancestry |
| Visit creation/list | Authorized Member creates a leap-day Visit (201), correct creator and calendar strings; Trip Guest list returns only that Visit |
| Trip map | Correct Visit marker; confirmedCoordinates=null, photoCount=0, previewPhotoId=null; no Project metadata |
| Project map | Country/inclusive-date filtered projection includes only its authorized Visit, excludes synthetic foreign Project's Visit |
| Edit permissions | Creator/current access, Owner and Admin PATCH=200; another Member/Guest PATCH=403 |
| Creator revocation | After transaction-only membership revocation, creator PATCH=404; Owner can still read retained Visit |
| Exact coordinates | Non-null point with claimed confirmation PATCH=400 |
| Unauthorized scope | Trip-only Guest Project map, unrelated resource access and cross-project Trip filter all return 404 |
| CSRF/Origin | Wrong Origin or token PATCH=403 |
| Logout | Synthetic Owner logout=204; subsequent me/catalog/map=401 with same session |
| Rollback | Entire synthetic transaction rolled back; final E1/E2.1 digests unchanged and Visits empty |
| Live Worker | Existing HTTPS 127.0.0.1:8789 health=200, unauthenticated me=401 |

Authenticated acceptance used synthetic user/session fixtures inside a single
rolled-back database transaction, with the **actual handleRequest routes and SQL
RPCs under travel_map_api** through the existing transaction-bound repository test
port. Membership fixtures were seeded under the existing authorized owner only
inside that transaction because membership-management APIs do not exist yet.
Every application call executed the existing session guard, authorization and
CSRF/Origin checks. No authentication bypass route/test mode, browser-cookie
extraction or permanent mock was introduced. The generated sessions and synthetic
content were never committed. Rollback also undid synthetic logout/revocation state.

This is handler+database acceptance, **not authenticated network/browser OAuth
acceptance**. The existing live Worker was checked over HTTPS only for health and
unauthenticated me; self-signed certificate bypass was restricted to loopback.
A fresh Google login and authenticated browser-to-Worker endpoint sequence were
not performed and are not claimed. Interactive login was unnecessary for the
permitted rollback-scoped checks. Prior real-Google acceptance remains historical.
If a browser acceptance pass is desired later, open
`https://127.0.0.1:8789/api/v1/auth/google/start`; that is separate from these results.

Existing Supabase services were reused unchanged. Additional read-only requests to
127.0.0.1:57421 returned Auth health=200 and settings=200 with Google enabled=true;
keys/credential values/settings payload were not printed. No service restart,
container/volume/user deletion, network change or paid resource was needed.

### Remaining limitations and E2.3 readiness

No failed migration, database or security checks in this operation. Local backend is
migrated and ready for **E2.3 architecture/scope review and separately authorized
implementation**, with the existing privacy/catalog limits intact. E2.3/E2.4 were
not begun. A fresh authenticated browser/network pass and backup test restoration
remain unverified; neither is implied by transaction-scoped tests/archive readability.
Exact-coordinate sharing remains deliberately disabled pending policy; catalog is
still only six localities/three countries. No production/cloud readiness claim.
