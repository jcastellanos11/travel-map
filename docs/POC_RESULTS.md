# Travel Map — Phase 0 / Phase 1 PoC Results

Date: 2026-11-01. Baseline commit: `46b7b4259a50f0d0ac5f3013116103cdab12b995`.

**Decision: OPEN. Neither candidate is selected or approved for production.**

## 1. Scope, sources and evidence standard

Read before implementation: [PRD](PRD.md), [DATA_MODEL](DATA_MODEL.md), [AUTHORIZATION_MATRIX](AUTHORIZATION_MATRIX.md), [ARCHITECTURE](ARCHITECTURE.md), [POC_PLAN](POC_PLAN.md). The frontend audit was also reviewed. Input document SHA-256 hashes are recorded in [environment.json](../spikes/evidence/environment.json).

The current user instruction explicitly authorizes isolated phase 0/1 spike code. It supersedes the plan's earlier requirement to request approval before creating the suggested spike folders. It does **not** authorize deployment, cloud resources, real credentials, global tools, project dependency changes, or a production backend. No such actions were taken. The existing frontend, backend directory, configuration, dependency manifests, lockfiles and input documents were not modified. The only work outside `spikes/` is this explicitly requested report.

At the start, `ARCHITECTURE.md`, `AUTHORIZATION_MATRIX.md`, `DATA_MODEL.md`, `FRONTEND_AUDIT.md` and `POC_PLAN.md` were already untracked files. Their pre-existing status must not be mistaken for changes made by this task. No commit or push was performed.

Evidence levels:

- **LOCAL PASS**: the specified reference experiment actually executed and its assertions passed. It is not provider validation.
- **BLOCKED**: required runtime/service is unavailable or cloud access is outside authorization; prerequisites are specified below.
- **NOT EXECUTED**: outside these minimal local experiments, including later phases.
- **DOCUMENTED**: an official capability/semantic description, not an experiment result.

PoC numbering in this report follows **POC_PLAN.md §5**, not the different shorter list in ARCHITECTURE.md §12.

## 2. Executive outcome

| Workstream | Result |
|---|---|
| Phase 0: reusable synthetic fixture/expectation contract | **Completed locally**: roles, two principal Italy/Colombia trips plus repeated-city and cross-project controls, independent visits, shared Place, authors and quota owners, failure/retry/intentional duplicates, decimal-byte hypotheses, synthetic HEIC/GPS fixture. |
| Phase 1: reference permission and integrity experiments | **20/20 LOCAL PASS**, including separate-process races and rollback injection. |
| A: actual Workers + local D1 binding | **BLOCKED**: no available Wrangler/workerd runtime or local binding harness. |
| B: actual Workers + local PostgreSQL/Supabase | **BLOCKED**: Workers runtime, PostgreSQL server/client, Docker and Supabase CLI unavailable. |
| Real Google/Supabase Auth, R2, Images, cloud databases | **NOT EXECUTED / BLOCKED for acceptance**: real services require separately authorized sandbox setup; no cloud resources or credentials used. |
| Final architecture / weighted winner | **Undetermined**: candidate-native and shared cloud blocking criteria remain unverified. |

This is **not** a claim that full candidate-specific phase 1 passed. The useful local subset was executed, while unavailable native comparisons are recorded as blocked. The shared SQLite ledger is intentionally **not substituted for D1 or PostgreSQL evidence**. The same reference result is not counted as two independent candidate passes.

## 3. Environment and isolated artifacts

Observed: macOS/darwin arm64; Node `v24.21.0`; npm `11.19.0`; Python `3.9.6`; Node's built-in SQLite `3.53.4`. All executable code uses installed runtimes and built-in modules only. No application or spike dependencies were installed; there is no new package manifest/lockfile.

The environment probe searches PATH for `wrangler`, `workerd`, `docker`, `psql`, `postgres`, `initdb`, `supabase`, `heif-enc`, `exiftool`, `magick`, `sips`, and `sqlite3`. Only `/usr/bin/sips` and `/usr/bin/sqlite3` were found. Frontend `node_modules/.bin` also has no Wrangler, workerd or Supabase executable. These observations establish unavailability in the inspected environment, not absence from every possible filesystem location. No attempt was made to connect to an existing database or discover credentials.

| Artifact | Purpose / evidence |
|---|---|
| [spikes/README.md](../spikes/README.md) | Reproduction and non-production boundaries |
| [shared/fixtures.json](../spikes/shared/fixtures.json) | Synthetic actors, hierarchy, memberships, shared places, photos and upload inputs |
| [shared/scenarios.json](../spikes/shared/scenarios.json) | Independent expected outcomes and deferred policy decisions |
| [shared/policy.ts](../spikes/shared/policy.ts) | Reference permission evaluator and mock session lookup |
| [shared/sqlite-reference.ts](../spikes/shared/sqlite-reference.ts) | Disposable SQLite quota/upload ledger; not a candidate adapter |
| [shared/concurrent-child.ts](../spikes/shared/concurrent-child.ts) | Independent OS-process operations and intentional unsafe/crash controls |
| [shared/experiments.test.ts](../spikes/shared/experiments.test.ts) | Executable Node test assertions |
| [shared/media_fixture.py](../spikes/shared/media_fixture.py) | Synthetic TIFF/GPS generation, local HEIC encoding/decoding, GPS parser |
| [cloudflare-only](../spikes/cloudflare-only/README.md) | A-specific capability/blocker record and next local prerequisites |
| [cloudflare-supabase](../spikes/cloudflare-supabase/README.md) | B-specific capability/blocker record and next local prerequisites |
| [evidence/tests.tap](../spikes/evidence/tests.tap) | Actual 20-test TAP output with durations |
| [evidence/observations.json](../spikes/evidence/observations.json) | State counters, process IDs, race outcomes and timings |
| [evidence/environment.json](../spikes/evidence/environment.json) | Versions, tool availability, input-document hashes |
| [evidence/media-fixture.json](../spikes/evidence/media-fixture.json) | Encoder/decoder commands, outputs, fixture hash and GPS evidence |
| [evidence/initial-failures.json](../spikes/evidence/initial-failures.json) | Initial harness/codec failures and their resolutions |
| [evidence/final-scope-check.json](../spikes/evidence/final-scope-check.json) | Unchanged input-document hashes, frontend/backend diff and final repository status |

Disposable SQLite files live only in ignored `spikes/runs/`, with a fresh database per experiment; latest run path is included in observations. The intentionally unsafe table is confined to a disposable test database. No HTTP listener, deployed handler, permanent migration, public asset integration, or production service was implemented.

## 4. Phase 0: contract and fixtures

### Actors and domain fixtures

The fixture includes owner, project administrator, project member, Italy-only guest, outsider, overlapping project/trip member, and inactive-account controls. There is one main project with Italy and Colombia trips, a second Colombia trip to test repeated places across trips, and a separate project to detect cross-project leaks.

Three independent authorized Bogotá visits share `place-bogota`; two belong to the same trip and the third to another trip. Rome's visit was created by the guest and has photos by two distinct authors. Photo authorship and quota responsibility are separate fields. Data are entirely synthetic; no existing sample photos or personal records were read into the experiments.

Expected results include: guest sees two Italy photos, no Colombia photos, no main-project overview/count permission; full project members see five main-project photos; overlapping memberships return three Bogotá photos once each. Client-supplied roles are not accepted. Mock sessions are predictable fixture labels resolved locally; they are **not secrets or secure authentication** and must never be deployed.

### Product decisions left unresolved

The matrix's pending project restore/settings, trip edit, Visit-retention, sensitive EXIF, ownership-transfer workflow, already-member invitation, guest project-context and participant-list decisions remain pending. Untested/unimplemented actions fail closed in the reference evaluator; this is an experimental limitation, **not approval of a new product rule**. Photo moving remains outside the experiment/MVP pending its specified decision. Only approved owner-only archive/admin-management restrictions were asserted.

### Byte and file hypotheses

Tests use decimal MB: `1 MB = 1,000,000 bytes`; quota `500,000,000`; occupied `480,000,000`; competing reservations `17,000,000` each. Declared file size `19,900,000` and `20,000,000` are accepted by the reference metadata predicate; `20,000,001` is rejected. Ten declared files are accepted, eleven rejected. These are **metadata-only assertions**, not actual 20 MB decoding/upload/processing or content sniffing, and do not amend the approved PRD's units by inference.

### Synthetic HEIC with fictional GPS

`media_fixture.py` writes an 8×8 flat RGB TIFF with GPS `(0, 0)`, verified by its independent TIFF IFD parser. Installed macOS `sips` encodes HEIC and decodes it back to TIFF. The parser finds the GPS TIFF payload in the HEIC and the decoded TIFF preserves the fictional coordinates. System `file` identifies the result as HEIF/HEVC; roundtrip TIFF dimensions are 8×8.

Observed HEIC: **723 bytes**, SHA-256 `ea6b660ac1761b1afde7a368fc756075f84b6fc74c98d0a193cf69f3c1824d89`. This hash is an observed artifact fingerprint, not a guarantee of byte-identical output from other OS/codec versions.

**LOCAL PASS for fixture generation/codec roundtrip only.** No visual inspection was performed. The small parser reads TIFF GPS structures and scans embedded TIFF signatures; it is not a general HEIF validator or production EXIF library. The fixture is not an actual iPhone camera file. No WebP derivative was produced and no claim of GPS stripping, Cloudflare format acceptance, or EXIF-suggestion processing is made.

## 5. Phase 1: local authorization evidence

All tests below ran once against the **shared in-memory reference policy**. No Worker request parser, SQL authorization query, RLS policy, JWT/OIDC implementation, object-store GET, CDN cache, or browser was exercised.

| Test | Expected | Observed |
|---|---|---|
| AUTH-01 | Missing/invented/inactive/revoked mock identity cannot read | **LOCAL PASS**; denied before private result |
| AUTH-02 | Italy-only guest cannot obtain Colombia by direct ID, metadata, thumbnails, display/original, trip/map/count operation, or project overview | **LOCAL PASS**; uniform denial body matches unknown ID; guest geographic Colombia result/count is zero |
| AUTH-03 | Owner/admin/member inherit main-project trip access; no unrelated project access | **LOCAL PASS**; five main-project photos; outsider excluded |
| AUTH-04 | Admin cannot archive project, manage admins or transfer ownership | **LOCAL PASS**; those capabilities restricted to owner |
| AUTH-05 | Member creates trip only when project policy permits; trip-only guest never does | **LOCAL PASS** for both policy settings |
| AUTH-06 | Shared visit creator, photo author and project admin rights differ | **LOCAL PASS**; noncreator cannot edit visit, nonauthor member cannot download other's original/trash it, authorized admin can |
| AUTH-07 | Removing guest membership denies subsequent reads despite authorship/quota responsibility | **LOCAL PASS**; no visible photos, quota attribution preserved |
| AUTH-08 | Shared Place does not merge visits or duplicate photos through overlapping membership paths | **LOCAL PASS**; three visit IDs, two trips, three distinct authorized Bogotá photos |
| AUTH-09 | Inactive ancestor or non-ready photo suppresses normal reads | **LOCAL PASS** for project/trip/visit state and trashed photo controls |

The aggregate/query helper checks permission before including a photo in filtered/countable results, rather than returning private rows to React. The direct-resource helper returns no object data on denial. **Limitations:** responses are function-level reference values, not actual API/media responses. Uniform response bodies do not demonstrate timing/enumeration resistance. Revocation tested only the next permission decision, not races against an in-flight operation, issued bearer URLs, downloaded bytes, or frontend cache disposal.

## 6. Phase 1: quota concurrency and upload idempotency

### Experiment implementation and atomic boundary

The local SQLite ledger keeps an account row (`used`, `reserved`, `quota`), upload operation/file rows, and synthetic asset byte rows. It uses parameterized SQL, a `(user, operation, file)` unique key, per-row checks, and `BEGIN IMMEDIATE` transactions. A conditional account update reserves only if `used + reserved + estimate <= quota`; account mutation and operation state insert/update commit together.

Completion atomically adds **original + display** bytes, releases estimated reservation and records two unique asset rows. A `ready` replay must match committed variant byte counts. Failed file retry keeps identity, reacquires a reservation and increments attempts; replaying completed files changes neither attempts nor bytes. Reusing the same operation/file for different content, target visit or estimate is rejected. New operation identity allows an intentional duplicate with the same content fingerprint.

This prototype trusts caller-established identity and authorization and synthetic content/byte declarations. The policy and ledger are deliberately separate primitives; **atomic request-level authorization-to-ledger integration is not tested**. Asset rows do not prove actual objects exist or that bytes were verified. The local schema, deterministic synthetic photo keys and state machine are incomplete/disposable, not approved production persistence design.

### Actual results

| Test | Expected | Observed |
|---|---|---|
| QUOTA-01: intentionally unsafe check-then-write control | Two prechecks see 20 MB free, then both add 17 MB | **Counterexample reproduced**: `480,000,000 + 34,000,000 = 514,000,000`. Test passes because it detects the unsafe result. |
| QUOTA-02: protected race, ten repetitions | One acceptance and one rejection per round | **LOCAL PASS**: 20 distinct child processes, 10/10 rounds yield one `reserved` and one `quota_denied`; final total is `497,000,000` each time. |
| QUOTA-03: fail/cancel and actual finalization | Release once, retry safely, charge actual variants once | **LOCAL PASS**: duplicate release is no-op; 17 MB estimate becomes 16 MB actual; final used `496,000,000`, reserved zero; repeated completion no charge. |
| QUOTA-04: actual bytes exceed remaining capacity | No partial completion/asset rows; reservation can be released | **LOCAL PASS**: over-limit completion rolls back; used remains 480 MB, reservation 17 MB until explicit failure release; zero assets created. |
| QUOTA-05: process termination midtransaction | No committed reservation without operation | **LOCAL PASS**: child exits deliberately with code 17 after counter mutation before commit; reopened/other connection sees used 480 MB, reserved zero, no upload/assets. |
| UPLOAD-01: 10 files, 7 successes/3 failures | Preserve seven; retry only three; no duplicate IDs/charge | **LOCAL PASS**: initially 7 ready, 3 failed, used 7.7 MB; finally 10 ready, 13 total file attempts, 20 asset rows, used 11 MB, reserved zero. Replays retain state. |
| UPLOAD-02: eight concurrent duplicate requests | Exactly one reservation and one completion | **LOCAL PASS**: eight child processes race to reserve, then another eight race to complete; one upload, two asset rows, used 1.1 MB, reserved zero. |
| UPLOAD-03: intentional repeat content, new operation | Two photos and two charges | **LOCAL PASS**: two upload/photo identities; used 2.2 MB. |
| UPLOAD-04: same key with changed input or completion sizes | Conflict, no extra charge | **LOCAL PASS**: content/target/estimate changes and conflicting completion rejected. |
| UPLOAD-05: user-scoped operation key | Same key in two users' namespaces is independent | **LOCAL PASS**: two rows and distinct reservations. |
| VALIDATION-01: declared limits | Decimal size and batch boundaries respected | **LOCAL PASS for metadata predicate only**; actual binary validation remains untested. |

Processes are created with `fork`; an IPC barrier waits for all children before releasing their operations, and evidence records child PIDs. The unsafe control places its read before the barrier; protected writes rely on real local SQLite locking/constraints, not an in-process JavaScript mutex or sequential `Promise` imitation.

The failed-completion case demonstrates transactional rollback plus **explicit compensation**, not automatic cleanup. A crash **after a successful committed reservation** can leave it outstanding: no reservation-expiry scheduler or DB/object reconciliation worker is implemented. No object-store/database distributed atomicity or automatic orphan cleanup is claimed.

### Local timing, not cloud performance

Recorded suite duration: **802.88775 ms** for 20 tests. Protected two-process race rounds measured **42.238–44.540 ms**, median **42.514 ms**, including process startup/barrier and local DB operations. These are single-machine harness observations, not database-only latency, Worker CPU, cloud RTT, sustained-load benchmarks or a statistical service performance comparison. They do not establish the PRD's ≤4-second mobile-map objective.

## 7. Candidate comparison: what is and is not supported

| Dimension | A — Workers + D1 | B — Workers + Supabase PostgreSQL/Auth |
|---|---|---|
| Same policy/fixtures available | Shared reference tests ready; no independent A-native run | Identical shared reference tests ready; no independent B-native run |
| Workers execution | **BLOCKED**: runtime unavailable | **BLOCKED**: runtime unavailable |
| Database transaction experiment | Actual D1 binding **not run**; SQLite is supporting reference evidence only | Actual PostgreSQL/RLS **not run**; SQLite is not PostgreSQL evidence |
| Identity | Only mock session lookup tested; app-managed Google/session security unverified | Only same mock tested; no Supabase JWT verification or Auth service exercised |
| Quota/idempotency | Candidate-native atomic account/operation/asset handling remains unverified | Candidate-native transactions, conflicts, isolation and unique-key behavior remain unverified |
| DB authorization | No D1 permission query executed | No RLS/grant/role/RPC policy executed |
| Media | Same untested R2 + Images requirements | Same untested R2 + Images requirements; managed Auth does not remove them |
| Operations | No local Workers compatibility or remote capacity/recovery evidence | Same plus no pool/RPC/network or pause/recovery evidence |
| Measured costs | No provider workloads or metering | No provider workloads or metering |
| Selection readiness | **Not ready** | **Not ready** |

### Transaction semantics: documented differences, not candidate results

- **A / DOCUMENTED:** D1 exposes prepared statements and `batch`; Cloudflare documents ordered batched execution and rollback on a failed statement. This is a different interface from a local synchronous SQLite connection held across interactive JavaScript decisions. A port must demonstrate that conditional quota rejection, operation creation/retry and failures cannot commit inconsistently; zero affected rows is not automatically a SQL exception. The current `BEGIN IMMEDIATE` reference is not claimed D1-compatible. [D1 binding documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- **B / DOCUMENTED:** PostgreSQL isolation and concurrent-update behavior must be considered explicitly; merely using PostgreSQL does not prove a safe read-then-write quota algorithm. Candidate tests must choose/test transaction and connection boundaries, guarded updates and conflict handling. [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- **B / DOCUMENTED:** Supabase RLS depends on grants, roles and policies; privileged service-role access can bypass it. A Worker using elevated database access therefore still needs tested scoped authorization, or a deliberately constrained execution path. No RLS or RPC design has been chosen here. [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)

Official documentation was consulted read-only to distinguish these semantics, not to replace missing runtime tests. No pricing refresh or provider cost assertion is made from this consultation.

### Weighted dimensions from the plan

| Dimension | Weight | A | B |
|---|---:|---|---|
| Identity, authorization and private media | 30% | N/D | N/D |
| HEIC/EXIF/private media/retries | 25% | N/D | N/D |
| Candidate data integrity and recovery | 20% | N/D | N/D |
| Operations, reproducibility, backup | 15% | N/D | N/D |
| Cost and growth | 10% | N/D | N/D |

No weighted total is calculated: reference algorithm passes are insufficient to grade a provider. Native/cloud prerequisites are **blocked**, not evidence that either architecture is incapable of meeting the requirements.

## 8. Acceptance coverage against POC_PLAN.md

| Plan ID | Local evidence | Acceptance status / missing evidence |
|---|---|---|
| POC-01 identity/session | AUTH-01 models identity rejection/logout | **BLOCKED overall**: real Google flow, OIDC state/nonce/PKCE/CSRF as applicable; Supabase issuer/audience/signature/expiry, refresh/revocation; no real auth implementation. |
| POC-02 authorization | AUTH-02–09 model scopes/ancestors/actions/aggregates | **PARTIAL LOCAL**; actual Worker, DB query/RLS and HTTP/private file isolation blocked. |
| POC-03 original/derivative | Synthetic HEIC with GPS created and decoded locally | **BLOCKED overall**: no private R2 upload/GET, Images WebP output or independent derivative metadata inspection. |
| POC-04 formats/20MB | Declared-size predicate tests; 723-byte HEIC fixture | **BLOCKED overall**: JPEG/PNG/WebP/HEIC/HEIF content sniffing, disguised files, dimensions and 19.9/20/20+ MB actual processing not exercised. HEIF distinct from HEIC remains untested. |
| POC-05 quota race | Negative control + 10 protected races + release/actual-byte/crash rollback | **LOCAL REFERENCE PASS; A/B native BLOCKED**. Remote contention, failures and reservations after commit unverified. |
| POC-06 idempotency | Partial batch, concurrent replay, input conflicts and intentional duplicates | **LOCAL REFERENCE PASS; A/B native BLOCKED**. Object upload, image jobs and lost object-store responses untested. |
| POC-07 invitations | No invitation algorithm implemented | **NOT EXECUTED**: atomic authenticated redemption, hashed token storage, expiry/revocation and concurrent one-use outcomes need separate experiment. |
| POC-08 media revocation | AUTH-07 denies next reference permission check | **PARTIAL LOCAL**: actual media GETs, issued URL exposure window, CDN/browser cache and open gallery not tested. Cannot revoke already downloaded bytes. |
| POC-09 recovery | Only uncommitted local transaction rollback injected | **NOT EXECUTED for acceptance**: trash/30-day restore, parent-state recovery, object reconciliation and metadata+object backup restoration untested. |
| POC-10 geographic query | Shared Place + independent visits + authorized photo projection | **LOCAL REFERENCE PASS**; no native SQL query, pagination or production/future-global API built. |
| POC-11 costs/limits | Byte math and local durations only | **NOT EXECUTED for provider acceptance**: no requests, DB metering, R2 operations, transformations, egress, pause/upgrade or bill measurement. |
| POC-12 performance | Small local harness timing | **NOT EXECUTED for acceptance**: no 100-visit API benchmark, ten real image processing jobs, frontend integration or mobile 4G test. |

The plan's blocking acceptance criteria are still open. A local policy pass or metadata predicate is not an approved provider P0 pass.

## 9. Commands, failures and reproduction

Commands were run from the repository root unless stated. Environment/repository checks included `git status --short`, `git log -1 --format='%H%n%s'`, `node --version`, `npm --version`, `python3 --version`, `command -v` for the tools listed above, `sips --formats`, a Node in-memory `sqlite_version()` query and Python module availability checks. `PIL`, `pillow_heif`, `psycopg` and `psycopg2` were absent; no modules were installed.

Runnable local sequence, using the observed installed runtimes:

```sh
node spikes/shared/probe.mjs
node --test --test-reporter=tap spikes/shared/experiments.test.ts > spikes/evidence/tests.tap
python3 spikes/shared/media_fixture.py
file spikes/fixtures/*
git diff --exit-code -- frontend backend
```

- Final environment probe: exit **0**, environment and candidate capability JSON written only within `spikes/`.
- Test run: exit **0**, **20 pass / 0 fail / 0 skipped**, TAP and observations retained. Each run creates fresh ignored local DB files. No test executable fetches external services or reads credential variables.
- Media fixture: script exit **0**, encoder and decoder exit **0** on the successful run. **Inspect `heicGPSFixture` and the per-command exits**: script exit zero alone can also mean a documented blocked codec result.
- `file spikes/fixtures/*`: exit **0**; reports HEIF/HEVC HEIC and 8×8 TIFFs. No visual inspection implied.
- Scope check: `git diff --exit-code -- frontend backend`: exit **0**, no tracked changes there. Input document hashes are retained to verify unchanged sources.

Failures were preserved in [initial-failures.json](../spikes/evidence/initial-failures.json), not silently omitted:

1. Initial test command failed before execution because output redirection raced creation of `spikes/evidence/`. Shell exit 1, no assertions ran. The probe was allowed to finish, then tests ran successfully in sequence.
2. Sandboxed HEIC encoding returned **sips exit 13**, with IOSurface/sysctl and temporary-file errors. The script correctly recorded a blocked media result; it did not invent HEIC success. User-approved execution of the **same local fixture script outside the sandbox** then succeeded. No software, cloud resource or personal image was introduced. The codec may need similar host permissions on reproduction.
3. Adding document hashing initially resolved `docs/PRD.md` against the wrong parent and the probe exited 1 with `ENOENT`. The relative path was corrected within the spike and the probe reran successfully; no external file was written.

These were harness/environment failures, not observed D1/PostgreSQL failures. No candidate-native commands were run because their prerequisites were absent. The Node test tool/framework and the ledger use built-in modules; frontend lint/build were not rerun because the frontend was neither modified nor part of these experiments. No deployment commands, cloud resource commands or package installations were executed.

## 10. Blockers and prerequisites

| Blocker | A/B | To unblock a future local or remote experiment |
|---|---|---|
| Workers runtime unavailable | Both | Explicit authorization for pinned isolated development tools in the spike; local Wrangler/workerd-compatible test harness. No frontend dependency changes and no remote bindings. |
| Actual D1 semantics untested | A | Local D1 binding and disposable state; implement native guarded/batched operations and re-run identical race, replay and rollback fixtures. Remote D1 needs later sandbox authorization. |
| PostgreSQL runtime/client unavailable | B | Explicit authorization for isolated PostgreSQL binaries/container and a client/driver; new disposable local DB. Test actual concurrent connections and constraints. No access to existing databases. |
| Supabase local stack unavailable | B | Supported CLI/container runtime if local Auth/RLS/API behavior is to be tested. Plain PostgreSQL alone does not validate Supabase Auth. |
| Real Google/OIDC/Supabase authentication absent | Both | Separate auth spike; pinned compatible verification library; owner-managed sandbox Google/Supabase configuration, redirect origins, test identities and secrets through approved local secret management. Never put credentials in chat or Markdown. |
| R2/Images processing and protected requests untested | Both | Express authorization for sandbox resources; private bucket/bindings, validated 19.9/20/20+ MB synthetic files, HEIF/HEIC variations, independent EXIF inspector and actual original/derived access tests. No public source URL. |
| Recovery/reconciliation/uncommitted vs committed failures | Both | Add synthetic post-commit crash/expiry/reconciliation and restore tests in local candidate adapters; actual DB/object restore requires later sandbox resource approval. |
| Cost, limits and production-like latency | Both | Representative workloads and approved sandbox telemetry. Validate live quotas/plans then; no upgrade, billing method or resource creation is authorized here. |

No cloud credentials were requested, read, printed or stored. Documentation browsing involved official public pages only. The experiment harness itself made no external network requests. Resources provisioned/deployed: **zero**. No service usage was generated by these experiments; that does **not** establish a projected monthly cost of USD 0 or prove the USD 0–10 target. Five users × 500,000,000 bytes is only a **2.5 GB capacity hypothesis**, excluding backups/operational overhead and not measuring provider billing.

## 11. Findings, limitations and next milestone

1. **Verified locally:** scope/role/ancestor/author rules can be expressed and tested with shared fixtures. Original permissions must remain distinct from optimized-image read permissions; author/quota attribution alone does not restore access after membership loss.
2. **Verified locally:** an unsafe check-then-write ledger oversubscribes quota. A conditional update, constraints and an atomic account/operation boundary prevented it in local SQLite. This algorithmic evidence does not establish D1 binding or PostgreSQL behavior.
3. **Verified locally:** operation identity scoped by user and file separates retries from intentional duplicate content. Partial successes and concurrent repeated completion preserve one charge in the reference. The experiment does not perform actual image/object uploads.
4. **Verified locally:** a fictional-GPS HEIC fixture is available for later processing experiments. Real iPhone/HEIF edge cases, 20 MB compatibility, EXIF suggestions and derivative metadata removal remain shared blockers for both candidates.
5. **Unresolved:** neither runtime-specific data integrity nor identity/private-media integration was executed. No meaningful candidate score, cost winner or final architecture follows from this work.

ADR guidance (no ADR selected):

- **ADR-001 runtime:** keep open; obtain an authorized local Workers harness and test compatibility/behavior before adopting it.
- **ADR-002 persistence:** keep open; port the minimal integrity fixture to real local D1 and PostgreSQL and compare native transaction/error semantics with parity.
- **ADR-003 identity/session:** keep open; mock identities say nothing about OIDC/JWT correctness or session security. Plan separate compatible verifier and lifecycle tests.
- **ADR-004 media:** keep open; use the synthetic fixture to verify private R2 → Images processing plus independently inspected derivative output when sandbox use is authorized. B does not resolve this shared dependency.

**Recommended next milestone:** unblock the two **local candidate-native runtimes** with explicit isolated-tool authorization, then re-run the same fixtures against actual D1 and PostgreSQL before requesting any phase 2 cloud sandbox. Keep all product decisions marked pending, the frontend unchanged, and production selection deferred. Passing these reference tests is preparation for that comparison, not permission to implement or deploy the backend.
