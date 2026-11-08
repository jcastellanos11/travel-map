# E4.1 — Private media domain and SQL security foundation

Date: 2026-11-08. Baseline: `main`, `0f399bd` (E3.5 committed). **E4.1 only.**
No E4.2 implementation, persistent migration, deployment, paid resource, commit or push.

## Repository audit and scope

Inspected PRD, ADR-001, data/authorization/API/implementation documents, all E4.0
documents and spike README, migrations0001–0006, owner/RLS/ACL/dispatcher/audit and
connection/migration tools. E4.0 was present but uncommitted. Its four documents and
`spikes/e4-media/` remain preserved, as does the pre-existing Supabase configuration
change. No frontend, authentication/provider, Worker router, cookie, CSRF/Origin/CSP,
RLS on existing domain tables or Google configuration was altered.

Next migration was verified as **0007_media_foundation**, not assumed. All0001–0006
up/down pair checksums match the committed baseline, covered by a new checksum test.
The persistent `127.0.0.1:57422/travel_map_dev` database and Google-enabled Supabase
services were neither queried nor modified by this work. No private user media was
read, generated or stored; all new database fixtures/evidence are synthetic records.

## Implemented foundation

- Eight private FORCE-RLS tables: photos, photo_assets/artifact journal,
  user_media_quotas, upload_operations, upload_file_slots, quota_reservations,
  processing_attempts and media_tasks/outbox. Owner-only policies; RESTRICT FKs.
- Immutable Photo/Visit/creator/responsibility, upload intent/fingerprint/client slots,
  artifact keys/identity and settled reservation records; constrained lifecycle
  transitions and generation links. Deferred slot counts enforce1–10; activation
  requires three verified assets belonging to the current finalized attempt.
- Decimal constants10 /20000000 /500000000 /2592000; byte columns BIGINT with
  nonnegative, overflow-safe used/reserved≤limit checks. No MiB reinterpretation.
- Exact reservation/finalization/cleanup accounting, per-file independence, immutable
  intent replay/conflict, new fenced attempts only after confirmed prior cleanup.
- SQL media authorization via existing api_call/session identity; active ancestry and
  effective inherited/Guest role; creator/Owner/Admin metadata/trash/restore rights;
  archival restricted to current creator/O/A; no ordinary delivery while non-active.
- Trash30days keeps charge. Restore stages current-access availability verification,
  preserves identity and cannot beat an expired/claimed purge. Latest restore ticket
  only; old tickets cannot supply new-cycle evidence. Partial confirmed purge releases
  only that asset's charged bytes, exactly once.
- Separate bounded job claim/evidence authority; technical audit attribution, never
  fake user sessions. Existing audit history and append-only triggers preserved.

Binding representation/privacy decisions are encoded in domain constants and the
[separate media contract](../docs/E4_MEDIA_CONTRACT.md): archival JPEG95 opaque/PNG
alpha; display WebP2560/Q82; thumbnail WebP480/Q72; no crop/upscale; all identifying
metadata removed; no GPS/EXIF suggestions; HEIC/HEIF disabled. **No codec is enabled
or invoked by E4.1.** Output byte/dimension/codec containment budgets beyond approved
policy still require E4.2 verification, not assumptions from database checks.

## SQL and maintenance security review

The runtime account still executes exactly `oauth_begin`, `oauth_consume`,
`login_complete`, `api_call`. Existing actions keep their request/response behavior;
`/me.storage` retains its DTO shape but uses the authenticated user's ledger after
0007, default0/0/500000000. No new media HTTP path or OpenAPI operation exists.

Private media helpers are not runtime executable; fixed pg_catalog paths, UTC,
qualified objects, non-superuser migration/function owner and FORCE RLS are verified.
One deliberate exception to SECURITY INVOKER private helpers is the count-only
deferred slot constraint trigger: it executes at COMMIT after api_call's definer
frame exits, so it needs its own owner SECURITY DEFINER authority. It accepts no
ordinary arguments, has no runtime EXECUTE and no arbitrary query/data projection.

Maintenance group `travel_map_media_maintenance` must be preprovisioned NOLOGIN,
NOINHERIT, NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS. Preflight
rejects memberships in either direction, database ownership and existing domain
access. It does not repair privileges. The harness provisions this group **only in
the newly created test cluster**; no persistent role/login/credential was created.

Only `travel_map_jobs.claim(text)` and `travel_map_jobs.record(uuid,uuid,bigint,text,jsonb)`
are executable by that group, plus jobs-schema usage. No domain tables, application
RPCs or private helpers; no membership/session/owner/limit changes or arbitrary keys.
Tickets expose only recorded job artifacts needed for processing/cleanup. Claims
lease5minutes with20-claim cap, reservations15minutes; expiry fences work but does not
prove I/O settled or release quota. Exhausted jobs remain held pending future
reconciliation/operator workflow. Technical evidence cannot activate/restore a Photo;
a fresh authenticated user call and current access are required.

Lock order is session/account → charged quota → Project → Trip → Visit → operation
→ slot → Photo → reservation → attempt → task/assets. Existing membership/archive
exclusive Project locking remains unchanged. Media session expiry is rechecked after
lock waits, tested by absolute expiry during real parent contention. No database
transaction spans image processing or object-store I/O.

**Evidence limitation:** technical `processed`, `writes_settled`, `absent` and
`available` calls in these tests are explicitly synthetic trusted attestations. SQL
proves ticket/role/generation/manifest/accounting consistency, not actual image safety,
settled network I/O, object existence or physical deletion. A future processor/store
must independently establish those facts before calling this boundary. No permanent
test route, fake-login mode, trusted-byte assertion in user DTOs or service-role bypass.

## Isolation and migration evidence

`scripts/media-local-postgres.ts` never reads .env or accepts a supplied DATABASE_URL.
It creates a new native PostgreSQL17.11 ARM64 cluster under ignored `.local/e41-*`,
private socket/data directory and random127.0.0.1 port. Before migrations the harness
verifies protocol/URL, rejects port57422/hosted/persistent names, checks server marker,
data_directory, PostgreSQL version, database comment, current harness identity and
database owner. Database names alone do not authorize execution.

Only databases/roles created inside this new cluster are used. E4.1 migration runs
as a distinct NOSUPERUSER/NOLOGIN owner; runtime SQL uses a restricted application role;
maintenance tests assume the NOLOGIN group with harness-only SET SESSION AUTHORIZATION.
No technical credential or production authentication bypass is introduced.

Verified: fresh full migration, populated E3 upgrade, unchanged row counts/content
digests for users, sessions, OAuth transactions, Projects, Trips, Visits, Project/Trip
memberships, invitations and pre-existing audit history; wrong-owner/unsafe-maintenance
preflight rejection; injected failed-DDL atomicity; ledger/checksum validation;
empty-media down/reapply; exact previous dispatcher definition/owner/ACL restoration;
down refusal with media/history. Down itself also refuses non-E4.1-marked/nonlocal
targets. Purged history still prevents destructive rollback. No persistent down run.

Every successful full native invocation ends with “Only the generated E4.1 cluster
stopped and removed.” No unrelated container, volume, database or networking changed.

## Commands and final results

Run these **sequentially** from backend; do not regenerate shared Swagger/build assets
while native test processes import them. No tool/dependency installation required.

```sh
WRANGLER_LOG_PATH=.local/e41-check.log WRANGLER_SEND_METRICS=false npm run check > .local/e41-check-results.log 2>&1

PG_BIN=/Users/luffy/.supabase/cache/stack/slim-services/postgres/17.11.0.006-r0/darwin-arm64/fb7594525d712ab85b6da00d4d4854f8d0c9ba26b49b781a5fede0119362e917/bin WRANGLER_LOG_PATH=.local/e41-native-runtime.log WRANGLER_SEND_METRICS=false npm run db:media:test > .local/e41-native-results.log 2>&1
```

The native npm command prepares Worker/Swagger assets using the existing **dry-run**
build first, then starts the new cluster; it does not deploy. Sandbox approval was
required to bind loopback ports. No unrestricted host access was used without approval.

| Actual command | Final result |
| --- | --- |
| Backend `npm run check` with environment above | Lint/typecheck/dry-run build pass; **45 passed,0 failed,0 skipped**; OpenAPI3.1/parser/38-route drift and actual workerd/Swagger checks included |
| Backend `npm run db:media:test` with environment above | **157 passed,0 failed,0 skipped**;32 E4.1 Node-reported tests including parent,125 existing E0–E2.4 tests; real PostgreSQL and applicable workerd integration |
| `npm --prefix frontend run lint` | Exit0 |
| `npm --prefix frontend run typecheck` | Exit0 |
| `npm --prefix frontend test` | **200 passed,0 failed,0 skipped**; includes OpenAPI DTO drift |
| `npm --prefix frontend run test:build` | Normal/integration builds succeed; **3 passed,0 failed,0 skipped** build-isolation tests |
| `git diff --check` and new-file whitespace review | Exit0 |

Total final test counts: **405 passed**, zero failed/skipped in the commands above.
Counts are Node test reports, including parent tests; they are not a count of every
assertion. Logs are ignored/private `.local/e41-*` files; frontend logs live in
`frontend/.local/e41-{lint,types,tests,build}.log`. No codec PoC results from E4.0 are
counted as new E4.1 evidence.

Native coverage includes real independent connections and observed pg_stat_activity
lock waits: quota competition, same-key requests/finalization, double cleanup release,
restore/purge, member removal/finalization and logout/mutation. Other cases cover
exact500000000 reserved/committed boundaries, invalid/negative/overflow input,
uncertain/expired I/O, stale attempts/restore tickets, independent batch success/failure/
retry, transactional audit failure, role/Guest/cross-Project/same-Place isolation,
inactive ancestry, former creators, archival restrictions, pagination and post-lock
session expiry. Existing bootstrap/session/domain/invitation/logout actions are also
exercised against0007 using a synthetic verified-identity transport fixture.

Not executed: real Supabase provider suite, real Google/browser media flow, image
processing, object-store I/O, cloud or mobile performance tests. The historical
Supabase test remains pinned to its previous0001–0006 schema; no shared Auth service
was touched. No new browser functionality exists to manually accept yet.

### Failures and corrections

- Initial sandbox loopback EPERM: explicit approval obtained; new native cluster and
  workerd tests then ran locally. No security setting was relaxed.
- Initial deferred slot validation failed at COMMIT with table-permission denial.
  Corrected the count-only deferred trigger's execution context, retaining private
  EXECUTE ACLs and reviewing the extra SECURITY DEFINER boundary.
- Adding helpers initially triggered the ACL postflight before their explicit
  REVOKEs. Migration correctly failed atomically; moved revocation before postflight.
- New media types triggered the existing documentation drift gate. Reviewed actual
  unchanged HTTP coverage and refreshed reviewed hashes for foundation types/0007;
  production OpenAPI was not expanded to proposed endpoints.
- A concurrent native/build run reported108 pass/2 file failures because imports saw
  Swagger assets during regeneration. Preserved `.local/e41-native-parallel-failure.log`;
  sequential full rerun passed. The new native npm command prepares artifacts before
  running its tests. Existing asset-generation/application code was not refactored.

## File inventory

Created:

- migrations/0007_media_foundation.up.sql and .down.sql.
- src/modules/media/types.ts and README.md.
- scripts/media-local-postgres.ts and media-test-safety.ts.
- tests/media.integration.test.ts and media.test.ts.
- docs/E4_MEDIA_CONTRACT.md (repository docs directory) and this report.

Modified: backend/package.json; backend/openapi.sources.json; backend/API_DOCS.md;
backend/README.md; backend/src/modules/README.md; backend/tests/migration-safety.test.ts;
backend/tests/invitations.integration.test.ts; backend/tests/supabase.integration.test.ts;
docs/DATA_MODEL.md; docs/AUTHORIZATION_MATRIX.md; docs/API_CONTRACT.md;
docs/IMPLEMENTATION_PLAN.md. Historical regression migration boundaries were pinned
explicitly rather than accidentally applying0007 outside its isolated harness.
No old migration, lockfile, frontend or production OpenAPI change. Pre-existing
Supabase/E4.0 changes are excluded from this implementation inventory.

## Acceptance and remaining gates

E4.1 meets its **local SQL/domain-foundation acceptance criteria**. No persistent
migration is authorized or performed. No production-ready finalization, image safety,
object deletion/durability or complete E4 functionality is claimed.

Before E4.2: separately approve local ObjectStore and private processor transport,
verify hard OS memory/CPU/network containment, enabled codecs and all-output privacy,
real write/availability/deletion evidence, candidate-byte budgets and reconciliation.
Maintenance service-login binding/credential management and scheduled execution remain
unimplemented; do not broaden this group's grants to make integration convenient.
HEIC/HEIF stay disabled; R2/Images/cloud require separate explicit authorization.
E4.1 does not implement permanent retention/account transfer/backup-recovery workflows.
