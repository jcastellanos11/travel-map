# Travel Map — Local Native PoC Results

Date: 2026-11-01. Execution baseline: `724929efbe258848b7fce591bc69dd9cee7f7a5f`.

**Architecture decision: OPEN. No production stack is selected. No cloud resources were provisioned or deployed.**

## 1. Outcome and evidence boundaries

The explicitly authorized local work extended the previous reference experiments into actual Workers/D1, actual PostgreSQL, and actual local Supabase Auth/PostgREST/RLS execution. All six requested source documents were reviewed first: [PRD](PRD.md), [DATA_MODEL](DATA_MODEL.md), [AUTHORIZATION_MATRIX](AUTHORIZATION_MATRIX.md), [ARCHITECTURE](ARCHITECTURE.md), [POC_PLAN](POC_PLAN.md), and the previous version of this report. PoC IDs below refer to **POC_PLAN.md**, whose numbering differs from ARCHITECTURE.md's shorter PoC list.

| Workstream | Observed result | Important qualification |
|---|---|---|
| Environment and isolated dependencies | Installed and exercised; exact versions locked | Docker Desktop installation attempted twice, both rolled back at administrator-password requirements. |
| A: actual local Workers + D1 | **22/22 integration tests passed** | Actual workerd and local D1 binding, not `node:sqlite`. No remote D1 verification. |
| B: actual local Workers + PostgreSQL | **22/22 identical integration tests passed** | Actual ARM64 PostgreSQL 17.11 with independent connections, running through Supabase's experimental **native** runtime. **No Docker container was verified.** |
| Local Supabase Auth/JWKS/PostgREST/RLS | **11/11 tests passed** | Actual local provider components; synthetic password grants are only test transport, not the production Google login flow. |
| Worker B verifies local Supabase bearer JWT | **3/3 cases passed** | Valid JWTs map to fixture identities and scopes; altered signatures cannot fall back to a forged mock identity. |
| JWT expiry | **Passed** | Independent signature verification followed by an injected future verifier clock. |
| Logout security negative control | **Weakness reproduced** | JWT signature verification alone still allowed private reads after logout. This is not an acceptance pass. |
| Logout live-session-check variant | **Passed locally** | A separate experimental live Auth check denied subsequent reads; adds a service dependency/round trip. Not a selected production strategy. |
| Recovery | **D1/R2 restore, PostgreSQL dump/restore, Supabase restart passed** | Local mechanisms only, not provider-managed backup/retention guarantees. |
| Images local simulator | JPEG/PNG/WebP conversion and private R2 input worked; **HEIC failed** | Local HEVC decoder missing. Simulator also accepted a file above the proposed 20 MB limit. Neither result determines deployed Cloudflare Images behavior. |

**Status:** executable local phases were completed through the native fallback. The requested **Docker-specific packaging/container run remains blocked by host administrator interaction**, not silently counted as completed. The public cloud acceptance gates remain open. No real Google accounts, production services, personal images, paid services or billing were used. No commit or push was made.

Evidence terminology:

- **Verified local:** a recorded assertion/result from the indicated runtime.
- **Reference only:** earlier mock-policy/SQLite evidence; not native candidate validation.
- **Blocked:** an unavailable permission/runtime or a prohibited cloud dependency.
- **Not tested:** no acceptance claim; prerequisite or additional experiment stated.

## 2. Environment, installations and isolation

Observed host: macOS **26.6.2**, Apple Silicon/`arm64`, **16 GiB RAM**, Node **v24.21.0**, npm **11.19.0**, Python **3.9.6**. Initial filesystem free space was approximately **257 GiB**.

| Tool | Observed version / purpose |
|---|---|
| Wrangler | **4.156.0**, project-local |
| Miniflare | **5.20261023.3-beta**, locked Wrangler dependency |
| workerd ARM64 | **1.20261023.1** |
| Worker compatibility date | **2026-10-30**, newest supported date reported by the installed runtime |
| `pg` | **8.16.3** |
| Supabase CLI | **2.122.0**, project-local |
| PostgreSQL | **17.11**, `aarch64-apple-darwin25.3.0` |
| Local Supabase Auth | **v2.197.0**, locked native artifact |
| Local PostgREST | **v16.5**, locked native artifact |
| `jose` | **6.2.14** |
| `sharp` / libvips | **0.35.5 / 8.18.7** |
| `exifr` | **7.1.3** |

Tool manifests and integrity pins: [spikes/tools/package.json](../spikes/tools/package.json), [package-lock.json](../spikes/tools/package-lock.json). Supabase service versions, artifact checksums and platform mappings: [supabase.lock](../spikes/cloudflare-supabase/native-supabase/supabase/supabase.lock). The native stack is an explicitly experimental CLI feature; its version lock is essential to reproduction.

### Docker blocker and native fallback

Homebrew downloaded Docker Desktop **4.97.0,244584**, but installation failed when creating `/usr/local/bin` links using `sudo` in a noninteractive session. The official `--no-binaries` attempt still required `sudo` for a kubectl link and also rolled back. The application was not left installed. A specific user-interaction request was issued to run the installer in Terminal, open Docker and accept its license where applicable; that prerequisite remained unresolved during this run. No password was requested in chat, supplied, or bypassed.

Rather than claim PostgreSQL success from SQLite, a **separate** `native-supabase/` project was initialized using Supabase CLI's documented experimental native runtime for Apple Silicon. It downloaded checksum-pinned ARM64 archives and started real PostgreSQL, Auth, REST and local mail processes. Realtime, Storage, Functions, Studio, Analytics and Pooler capabilities were excluded because the experiments needed Auth/REST/DB only. R2/Images continued to use the same local Cloudflare bindings for both candidates.

This unblocked actual PostgreSQL and Supabase-specific behavior, but **does not prove Linux ARM64 container behavior or Docker health**. The prepared [container setup script](../spikes/tools/postgres-setup.mjs) was not executed successfully in a Docker runtime. The native database for the parity suite is `poc_candidate_b`; the RLS/Auth tests use the stack's separate default database. No pre-existing user database was accessed.

### Network and credential isolation

Workers listened on `127.0.0.1:8787` and `127.0.0.1:8788`. Supabase allocated loopback ports, including SQL `26958` and Auth/REST `27954` in this run; ports are runtime-assigned and not fixed requirements. A host `lsof` inspection verified the experiment's listeners and inspectors on **127.0.0.1**, including native service backends. Unrelated host listeners were neither altered nor attributed to this PoC.

Random database credentials, local API keys, JWTs, raw runtime logs and stack status stay in ignored `spikes/runs/`, `.dev.vars`, `.state` or `.wrangler` paths. Supabase also keeps local runtime preferences/cache outside the repository with separately approved host access. Reports contain normalized outcomes, not credential values. [final-audit.json](../spikes/evidence/native/final-audit.json) compares known generated secret values against nonignored candidate/report files and verifies protected paths unchanged. This is not a general repository-history secret audit.

Wrangler metrics were disabled. Public dependency/artifact/documentation downloads occurred; local tooling may obtain public runtime metadata. There was no account login, hosted-project link, remote binding, provider resource creation, or deployment. No claim of zero total outbound installation traffic is made.

## 3. Shared fixtures and experimental design

[fixtures.json](../spikes/shared/fixtures.json) and [scenarios.json](../spikes/shared/scenarios.json) remain the common input and expectation contract. They include owner/admin/member, an Italy-only guest, outsider/inactive identities, overlapping memberships, two principal trips, repeated Bogotá visits in the same and another trip, shared Place identity, photos from distinct authors, and independent quota responsibility.

The earlier **20/20 reference** tests remain in [tests.tap](../spikes/evidence/tests.tap) and [observations.json](../spikes/evidence/observations.json). They are historical algorithm evidence, not counted again as candidate-native passes. Native adapters share [native-handler.mjs](../spikes/shared/native-handler.mjs), generate schemas from [native-schema.mjs](../spikes/shared/native-schema.mjs), and execute the same [native-tests.mjs](../spikes/shared/native-tests.mjs).

The parity test transport uses explicit mock session labels and database session/user records. Caller-supplied JSON user/role values do not establish identity. A separate B bearer path verifies local Supabase JWTs with JWKS, issuer, audience and an ES256 allowlist, maps the subject to a fixture actor, then applies the same SQL scope checks. Invalid bearer credentials do not fall back to mock headers.

**Not production code:** loopback `/harness/*` routes deliberately allow trusted local setup, snapshots, state changes and failure injection without an application login. Scenario namespaces create independent disposable ledgers so race rounds do not interfere; they are **not** a production feature allowing a user multiple quotas. Mock sessions, test clock values and harness controls must never be deployed.

Unresolved product decisions in the authorization matrix remain unresolved. Permission tests exercise approved owner/admin/creator/author boundaries; unimplemented actions fail closed. No permanent schema, production endpoint or API contract is approved by these disposable experiments.

## 4. A/B native integration test results

Full machine-readable records: [D1 results](../spikes/evidence/native/d1-results.json), [PostgreSQL results](../spikes/evidence/native/postgres-results.json). Each has **22 PASS / 0 FAIL in its final parity run**, with per-case timings and counters.

| Test group | A: D1 | B: PostgreSQL | Observed acceptance evidence |
|---|---|---|---|
| Runtime and native DB request | Pass | Pass | HTTP request executed inside workerd and queried the actual binding/database. |
| Missing, invented and inactive mock sessions | Pass | Pass | No private response. |
| Direct foreign IDs, media variants, aggregates/project counts | Pass | Pass | Italy guest gets no Colombia data; denied result matches unknown-resource response. |
| Project inheritance, overlap and shared Place | Pass | Pass | Owner/admin/member see five project photos; overlapping permissions yield three distinct Colombia photos, without duplicated rows. |
| Owner-only project administration | Pass | Pass | Admin denied archive/admin-management/ownership capabilities reserved to owner. These are capability decisions, not a full management workflow. |
| Visit creator and original author/admin rights | Pass | Pass | Noncreator denied visit edit; ordinary member denied another author's original; authorized admin permitted. |
| Caller actor/role spoofing, SQL-like input and untrusted Origin | Pass | Pass | Forged fields/IDs do not grant access; cross-origin request denied. |
| Inactive ancestor/readiness state | Pass | Pass | Photo/visit/trip/project state suppresses normal private reads. |
| 100 quota race rounds | Pass | Pass | Exactly one 17 MB reservation succeeds per round; total used+reserved remains 497 MB. |
| Fail/cancel and real-byte completion | Pass | Pass | Reservation releases once; retry succeeds; original+display bytes charged once. |
| Actual-byte overflow | Pass | Pass | Failed completion rolls back, no asset rows created; explicit compensation releases reservation. |
| Native transaction/batch failure injection | Pass | Pass | Duplicate-key error after an initial insert rolls back the entire batch/transaction. |
| Abandoned committed reservation | Pass | Pass | Explicit expiry/reconciliation invocation releases it once and marks failure. No scheduler is claimed. |
| 7-success / 3-failure upload batch | Pass | Pass | Seven preserved; retry only three; final 10 uploads, 13 attempts, 20 asset rows, 11,000,000 bytes used, zero reserved. |
| Eight-process duplicate request/completion | Pass | Pass | Exactly one reservation and one completion; one photo/upload, two variants, 1,100,000 bytes charged. |
| Intentional duplicate and key conflicts | Pass | Pass | New operation produces another resource; altered content/target/estimate or conflicting completion does not double-charge. |
| Foreign scope and forged actor cannot reserve | Pass | Pass | Denied before ledger mutation. |
| Actual R2 object existence/byte finalization | Pass | Pass | Missing original/display prevents readiness; both existing objects finalize at measured size, **779 bytes**, then replay without charge. |
| Trash/restore | Pass | Pass | Trash retains quota; restore allowed within simulated 30 days, denied after 31 days. No physical purge implementation. |
| Invitation races/expiry/revocation | Pass | Pass | One active redemption succeeds; inactive/expired/revoked attempts denied; stored token is SHA-256, not plaintext. |
| Actual private media bytes and membership revocation | Pass | Pass | Exact HEIC/WebP bytes read via authorized Worker proxy; nonauthor original denied; next proxy GET denied after membership removal. |
| 100-visit API measurement | Pass | Pass | Authorized fixture query returns 100 photos for 100 visits; this is not a frontend/mobile performance acceptance test. |

### Transaction and concurrency semantics actually exercised

Test hypotheses use decimal bytes: 500,000,000 quota; 480,000,000 occupied; two reservations of 17,000,000. Every one of 100 native rounds per candidate produced one success/one rejection and **497,000,000 total bytes**. The first and last rounds use independent OS HTTP clients synchronized through IPC; the other 98 use concurrent HTTP requests. PostgreSQL opens an independent client connection per request. Eight-process upload races separately record process IDs. The earlier unsafe reference control reached **514,000,000** and remains evidence that check-then-write alone is unsafe.

A uses D1 SQL triggers and constraints to make operation creation/retry, reservation release and ready-state assets/accounting atomic within the native statement. B uses equivalent PostgreSQL triggers/constraints; the PostgreSQL trigger locks/conditionally updates the account row. B's explicit multi-statement failure probe uses a real `BEGIN`/`ROLLBACK`; A uses actual `D1Database.batch()`. The reference adapter's interactive SQLite `BEGIN IMMEDIATE` was **not transplanted into D1**.

The original and derived variants are required by the measured-object completion path; R2 HEAD sizes determine the charge. Other ledger stress tests intentionally use declared synthetic byte counts rather than transferring 17 MB per reservation. Object writes and SQL are still separate systems: a crash between them needs reconciliation; there is no distributed transaction. A check-then-commit authorization/revocation race across the entire request was not proven atomic.

Time/expiry inputs are injected for reproducibility. Invitation validity/order checks do not prove a production seven-day default implementation. Restoration models 30 days logically, not by waiting. Scheduled cleanup, physical purging, ownership/storage transfers and real file/batch acceptance are not implemented by this minimal backend experiment.

## 5. Supabase-specific evidence and identity boundaries

[Supabase results](../spikes/evidence/native/supabase-results.json): **11/11 passed**.

1. Local Auth health and creation/sign-in of five synthetic `example.invalid` identities.
2. Valid access token accepted; absent, invented and signature-tampered tokens rejected.
3. Independent `jose` verification against local JWKS: **ES256** signature, issuer and audience; incorrect issuer/audience rejected.
4. Domain fixtures and deny-default RLS/grants installed in the disposable stack DB. Fifteen experiment tables have RLS enabled; read policies use narrowly scoped `SECURITY DEFINER` helpers with empty `search_path` and explicit execution grants. No production policy approval implied.
5. Anonymous rows absent; outsider cannot enumerate another trip.
6. Italy guest sees two photos, zero Colombia rows, count `*/0` for denied ID and no project overview rows.
7. Project members inherit all five project photos; original media metadata remains author/admin only.
8. Attempts to promote a role, enumerate protected memberships or mutate a foreign photo return **403**.
9. Revoking membership removes next-request RLS visibility even while the JWT remains cryptographically valid.
10. Service-role control reads **all six fixture photos**, demonstrating RLS bypass. It must not be exposed to a browser or mistaken for domain authorization.
11. Logout returns **204**, refresh is rejected (**400**), and local Auth `/user` rejects the previous token (**403**) in this scenario. This does not mean an independent offline JWT verifier knows logout occurred.

[Worker JWT integration](../spikes/evidence/native/worker-jwt-results.json): **3/3 passed** using actual workerd and local Supabase identities. Guest/member scopes returned two/five photos; a modified signature with a forged mock-owner fallback header was denied. [Expiry check](../spikes/evidence/native/jwt-expiry.json) verifies a currently valid signed token is rejected with `ERR_JWT_EXPIRED` when the verifier clock advances two hours.

### Logout negative control and experiment variant

[JWT-only control](../spikes/evidence/native/session-jwt-only.json): private read **200**, logout **204**, subsequent private read still **200**. This deliberately reproduces a **security gap**: signature/claim verification alone is insufficient for an immediate post-logout denial requirement. It is not reported as a secure candidate acceptance pass.

[Live-session variant](../spikes/evidence/native/session-live-check.json): private read **200**, logout **204**, subsequent read **404**. The experimental Worker verifies the JWT and then queries local Auth's current `/user` session before resolving domain identity. This introduces an extra service round trip and availability dependency. It demonstrates one mitigation, **not a production identity/session architecture selection**. Application session records, revocation checks and bounded token lifetimes remain alternatives for later design.

No Google account, OAuth callback, real OIDC consent, state/nonce/PKCE flow or production CSRF/session transport was exercised. The local password grant does not alter the PRD's Google-only production requirement. B's parity SQL service role and Supabase's RLS/PostgREST path are distinct experimental access paths; a production design must decide and test their privilege boundaries explicitly.

## 6. Images, metadata, limits and private objects

The common synthetic HEIC is 723 bytes, 8×8, fictional GPS `(0,0)`, SHA-256 `ea6b660ac1761b1afde7a368fc756075f84b6fc74c98d0a193cf69f3c1824d89`. It was generated/decoded with the installed macOS codec in the earlier phase, not taken from a person or iPhone. The native run used `exifr` to independently extract the source TIFF GPS and a RIFF chunk reader to inspect generated WebP output.

[Local codec report](../spikes/evidence/native/local-media.json), [A Images report](../spikes/evidence/native/d1-images.json), [B Images report](../spikes/evidence/native/postgres-images.json):

| Probe | Actual local observation | What it establishes |
|---|---|---|
| TIFF with GPS → WebP | 56-byte WebP, only `VP8 ` chunk; no EXIF/XMP blocks | Verified for this synthetic output by a parser independent of the encoder; not all sensitive metadata/content cases. |
| JPEG, PNG, WebP | Local Images transformations returned WebP successfully | Local simulator codec compatibility for these small samples. |
| HEIC/HEVC | **Failed** in sharp and both Images simulators: HEVC decoder/plugin not built in | A shared local simulator limitation; neither proof of cloud failure nor permission to drop HEIC. |
| Disguised nonimage bytes | Rejected, mapped to experimental HTTP 422 | Local content decoding rejection, not a complete malicious-file/security assessment. |
| Valid PNG padded using an ancillary chunk to 19,900,000 / 20,000,000 / 20,000,001 bytes | All three accepted by local Images | Real input bytes were transferred, not just declared sizes. The local simulator does **not** enforce the assumed cloud 20 MB boundary. Production admission must enforce its own limit, and cloud boundary testing remains mandatory. |
| Private local R2 stream → Images | Passed for PNG without a public source URL | Actual local binding integration, not deployed bucket policy verification. |
| Ten concurrent small PNG transforms | Ten successful outputs per candidate | Tiny local workload only; not representative iPhone photo CPU/latency or billing. |
| Private original/display delivery | HEIC original and separately generated 56-byte WebP delivered only through authorized experiment proxy | R2 bytes and differentiated access checks exercised; no public bucket or signed URL created. |

The WebP used in media access tests came from TIFF conversion, **not successful HEIC conversion**. The padded PNGs have tiny pixel dimensions and a large ancillary payload; they do not represent 20 MB camera-image memory demand. HEIF distinct from the HEIC fixture, real iPhone variations, large dimensions, EXIF-confirmation UX and cloud derivative stripping remain unverified. No visual/browser inspection was performed. The harness's transformation route deliberately tests raw simulator behavior; it is not a production upload admission endpoint.

## 7. Failure recovery and persistence

- **D1 batch rollback:** native duplicate-key injection leaves the earlier statement uncommitted.
- **Committed abandoned reservation:** explicit expiry invocation releases reserved bytes once. No automatic cron/queue is running.
- **D1/R2 recovery:** [d1-recovery.json](../spikes/evidence/native/d1-recovery.json) records export via the local binding's Miniflare export pragma, import using Wrangler into an **independent** state directory, and copying quiesced local R2 state after stopping Worker A. Restored: used **11,000,000**, reserved **0**, **10 uploads**, **20 assets**, and exact **723 original bytes** with matching SHA-256. SQL backup: **249,273 bytes**. This local export mechanism is tooling-version-specific, not a validated remote D1 export/Time Travel strategy.
- **PostgreSQL recovery:** [postgres-recovery.json](../spikes/evidence/native/postgres-recovery.json) records native `pg_dump -Fc` and `pg_restore` to new database `poc_candidate_b_restore`. Restored the same **11 MB / zero reserved / 10 uploads / 20 assets**. Dump: **31,458 bytes**. Original DB was not deleted or replaced.
- **Supabase restart:** [supabase-restart.json](../spikes/evidence/native/supabase-restart.json) records stopping/restarting the named local stack, preserving valid local Auth state (**200**), guest RLS visibility (**two photos**) and the PostgreSQL ledger counters.

This verifies local recovery primitives. It does not prove remote backup retention, disaster recovery, thirty-day physical recoverability, geo-redundancy or reconciliation under every DB/object failure ordering. Purging collaborative contributions without required safeguards was not implemented or tested.

## 8. Resource and performance observations

[resources.json](../spikes/evidence/native/resources.json) records an actual point-in-time measurement:

| Observation | Result / caveat |
|---|---|
| Host RAM | **17,179,869,184 bytes (16 GiB)** |
| Isolated npm dependencies | **367,332 KiB (~359 MiB)** |
| Downloaded native-service cache | **1,931,596 KiB (~1.84 GiB)**; cache includes artifacts beyond active capabilities |
| D1 local state | **15,288 KiB (~14.9 MiB)** after multiple test runs |
| PostgreSQL candidate DB | **8,779,443 bytes**; separate restored DB **8,730,291** |
| Selected runtime RSS snapshot | Included in JSON; per-process RSS is not peak/unique RAM, excludes some wrappers and double-counts shared mappings |
| API query: 100 visits, 20 samples | A p50 **1.608 ms**, p95 **2.359 ms**; B p50 **4.789 ms**, p95 **8.344 ms**; JSON **2,514 bytes** |
| Quota round median | A **5.546 ms**, B **10.430 ms**; includes two competing HTTP requests and a snapshot read; first/last rounds also include process startup |
| Ten tiny image transforms | A **14.170 ms**, B **19.137 ms**; not large-camera-image performance |

These are single-machine localhost observations with warm services, different engine/storage interfaces and a deliberately simple B implementation opening one DB connection per request. They are not cloud latency, Worker CPU limits, pooler performance, throughput guarantees, statistical provider rankings or the mobile/4G useful-map target. No frontend was modified or run.

**Costs:** no cloud resources, accounts, billing or paid plans were enabled. Local downloads consume disk/network/electricity; Docker license eligibility still needs the user's acceptance if installation proceeds. No monthly provider bill or free-tier capacity was measured. The USD 0–10 production target remains unvalidated; no old pricing table is promoted to current measured evidence.

## 9. Commands and reproducibility

All repository code/configuration changes are under `spikes/`, except this requested report. No application dependency, frontend, production backend, approved requirement, commit or push changed.

### Installation and bootstrap

Observed installation attempts (Homebrew required approved host access):

```sh
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ANALYTICS=1 brew install --cask docker-desktop
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ANALYTICS=1 brew install --cask --no-binaries docker-desktop
```

Both failed/rolled back at sudo link creation; no container was started. npm first failed inside the sandbox with `ENOTFOUND`; the specifically approved external-network retry installed isolated tools. Its resolved exact versions are reproducible from the lock:

```sh
npm ci --prefix spikes/tools
node spikes/shared/generate-native.mjs
node spikes/tools/media-check.mjs
```

First installation used `npm install --save-dev --save-exact wrangler@4.156.0 pg@8.16.3 supabase@latest jose@latest sharp@latest exifr@latest` from `spikes/tools`; the saved manifest resolves all `latest` inputs to the exact versions in §2. npm reported **0 vulnerabilities** at install time, not a permanent security guarantee. It warned about install-script approval for esbuild/workerd; the installed ARM64 binaries nevertheless executed successfully. No global npm tools were installed.

### Native Supabase fallback

From `spikes/cloudflare-supabase/native-supabase/`, using the checked-in experimental configuration:

```sh
umask 077
SUPABASE_EXPERIMENTAL_STACK=1 ../../tools/node_modules/.bin/supabase stack install --runtime native
SUPABASE_EXPERIMENTAL_STACK=1 ../../tools/node_modules/.bin/supabase stack start --runtime native --stack travel-map-poc-native --eager --exclude realtime,storage,functions,studio,analytics,pooler > ../../runs/supabase-native-start.log 2>&1
```

On repetition use `stack install --runtime native --frozen` with the saved service lock. CLI output can contain local credentials: keep its raw logs ignored and do not paste them into documentation. The setup scripts read the structured local output privately. An earlier `supabase init` was run in the Docker-oriented `local-supabase/` folder; that configuration was copied/adapted into the distinct native project, with fixed ports and cloud S3/OpenAI environment references removed/disabled. No `supabase login` or `link` ran.

From repository root:

```sh
node spikes/tools/postgres-native-setup.mjs
```

This creates only `poc_candidate_b`, initializes the disposable schema, grants a `NOSUPERUSER NOBYPASSRLS` application role, and writes random credentials into ignored `.dev.vars`. Never run it against a different connection/environment.

### Workers and test execution

From `spikes/cloudflare-only/`:

```sh
WRANGLER_LOG_PATH=../runs/wrangler-a.log WRANGLER_SEND_METRICS=false ../tools/node_modules/.bin/wrangler d1 execute poc-db --local --config wrangler.jsonc --persist-to .state --file fixture.sql
WRANGLER_LOG_PATH=../runs/wrangler-a.log WRANGLER_SEND_METRICS=false ../tools/node_modules/.bin/wrangler dev --local --config wrangler.jsonc --ip 127.0.0.1 --port 8787 --persist-to .state
```

From `spikes/cloudflare-supabase/` in another terminal:

```sh
WRANGLER_LOG_PATH=../runs/wrangler-b.log WRANGLER_SEND_METRICS=false ../tools/node_modules/.bin/wrangler dev --local --config wrangler.jsonc --ip 127.0.0.1 --port 8788 --persist-to .state
```

From root, with services running:

```sh
node spikes/shared/native-tests.mjs d1
node spikes/shared/native-tests.mjs postgres
node spikes/tools/images-binding-test.mjs d1
node spikes/tools/images-binding-test.mjs postgres
node spikes/tools/supabase-tests.mjs
node spikes/tools/worker-jwt-test.mjs
node spikes/tools/expiry-check.mjs
node spikes/tools/session-revocation-test.mjs jwt-only
node spikes/tools/session-revocation-test.mjs live-check
```

Changes to `.dev.vars` must be loaded before bearer/session tests; a Worker reload/restart was necessary during the recorded run. Auth tests create fresh local identities and may encounter local rate limits on frequent repetition. Database/RLS roles and identities are synthetic and isolated.

Recovery commands from root:

```sh
# Stop Worker A first with Ctrl+C to quiesce its local object state.
node spikes/tools/d1-recovery.mjs
node spikes/tools/postgres-recovery.mjs
```

The PostgreSQL restore target must be new/empty; the recorded successful command used the new named restore DB, not a destructive reset. From the native stack folder, `SUPABASE_EXPERIMENTAL_STACK=1 ../../tools/node_modules/.bin/supabase stack restart --stack travel-map-poc-native` was followed by `node spikes/tools/supabase-restart-check.mjs` from root. Exact per-experiment counters/outcomes are in the linked JSON evidence.

Verification commands: `node spikes/tools/resources.mjs`, `node spikes/tools/final-audit.mjs`, `git diff --check`, and `git diff --exit-code HEAD -- frontend backend docs/PRD.md docs/DATA_MODEL.md docs/AUTHORIZATION_MATRIX.md docs/ARCHITECTURE.md docs/POC_PLAN.md`. Raw Wrangler debug logs are ignored because they may contain local proxy material; normalized reports are the review artifacts.

## 10. Failures and troubleshooting record

These failures were not silently converted into provider successes:

| Failure | Resolution / actual limitation |
|---|---|
| Homebrew lock EPERM, then sudo link failures in both Docker installs | Explicit host approval used; installer still required interactive administrator password. Docker remains blocked. |
| npm registry DNS blocked in sandbox | Specifically approved network retry installed only `spikes/tools`; no application manifests changed. |
| Wrangler/Supabase preference/log writes denied by sandbox | Specific host permissions requested. Wrangler log paths moved inside ignored spike paths. |
| Local runtime `listen EPERM`; initial local fetches failed | Specifically approved localhost runtime/test execution. Initial 0/20 connection failures are preserved in `d1-sandbox-failure.json`; these were not D1 correctness failures. |
| Runtime rejected compatibility date 2026-11-01 | Installed workerd reported maximum 2026-10-30; both configs pinned to that date. |
| D1 rejected `sqlite_version()` | Actual native first run: 19/20 passed, health probe failed. Replaced version introspection with binding-ready query; workerd version comes from its installed package. See `d1-first-native-run.json`. |
| Standard Supabase Docker startup failed: Docker not found | Preserved private startup log; used separately locked, explicitly experimental native runtime, never represented as Docker verification. |
| PostgreSQL setup report assumed nested endpoint keys | Database setup had succeeded; corrected metadata reporting using the parsed private connection URL and reran idempotently. |
| Worker bearer integration initially denied valid tokens | Captured `worker-jwt-first-failure.json` (1/3); explicitly loading/restarting with Auth configuration yielded 3/3. No signature check was bypassed. |
| HEIC decoding failed in native codecs/Images | Retained full normalized codec error; did not replace it with TIFF success or claim HEIC acceptance. |
| JWT-only verifier allowed read after logout | Preserved as negative control; live-session variant denied it. The production revocation mechanism remains undecided. |
| `wrangler d1 export --persist-to` rejected its flag | This Wrangler export command does not accept custom persistence location. Used its local-binding export mechanism against the actual source state, then native import into independent state. |
| Two transient root artifacts during tooling setup | `npm init --prefix` unexpectedly created a root package manifest; it was immediately removed and the spike manifest created explicitly. Miniflare created an auxiliary root `.wrangler/cache/cf.json`; it was moved to ignored spike storage, and the recovery script now sets spike cwd and `cf:false`. Final protected-path checks are clean. |
| Minor harness path/entrypoint mistakes | Incorrect initial Supabase CLI relative path, old sharp package entry path and a documentation patch-context mismatch were corrected before successful runs; no application code was altered. |

The earlier phase's failures remain in [initial-failures.json](../spikes/evidence/initial-failures.json). Credentials are not included in failure reports. Tests ran successfully only after the required specific sandbox permissions; protections were not bypassed automatically.

## 11. Acceptance coverage and remaining blockers

| POC_PLAN ID | Current local evidence | Still missing / status |
|---|---|---|
| POC-01 identity/session | Actual local Supabase Auth/JWKS/expiry/logout and Worker integration; mock identity for A/common parity | **Partial**. Real Google/OIDC callback/state/nonce/PKCE/CSRF, A's audited session/OIDC implementation and managed Auth behavior require further design/authorized sandbox testing. |
| POC-02 authorization | Native Worker SQL checks plus Supabase RLS, counts, original rights, revoked membership | **Locally verified subset**. Cloud private resource isolation, full mutation matrix and request/revocation races remain open. |
| POC-03 private HEIC/derivative | Exact local R2 bytes, differentiated proxy permissions, inspected TIFF→WebP | **Shared blocker**: HEIC fails in simulator; real cloud Images conversion/metadata stripping not tested. |
| POC-04 formats/20 MB | Actual JPEG/PNG/WebP, disguised bytes and padded PNG boundary transfers | **Partial**. Simulator accepts 20+ MB; HEIF, representative large HEIC/camera dimensions and native production admission still unverified. |
| POC-05 quota | 100 native race rounds per candidate, rollback/compensation, actual measured variant bytes | **Local pass**. Remote contention, capacity limits and broader crash/reconciliation orderings require follow-up. |
| POC-06 idempotency | Native partial batch, eight-process duplicate requests, immutable keys, intentional duplicates | **Local pass** for tested paths. Distributed image jobs/object failures beyond these probes remain open. |
| POC-07 invitation | Native atomic hash-based redemption, concurrent use, expiry/revocation | **Local pass subset**. Production authenticated invitation return flow/rate limits and exact seven-day defaults not built. |
| POC-08 media revocation | Next proxy GET denied; next RLS request denied; JWT logout weakness/mitigation measured | **Local pass subset**. Browser/CDN caches and already-issued signed URL lifetime not tested. Bytes already downloaded cannot be revoked. |
| POC-09 recovery | Local D1/R2 state restoration, pg_dump/restore, stack restart, logical trash retention | **Local pass subset**. Provider backup guarantees, physical purge safeguards and sustained recovery operations remain open. |
| POC-10 geographic query | Independent visits/shared Place and scoped, deduplicated photo results | **Local pass subset**, no global explorer or production endpoint implemented. |
| POC-11 cost/limits | Actual local resource consumption only | **Blocked for provider acceptance**. No cloud metering, request/CPU/storage/egress costs or managed pause/upgrade measurements. |
| POC-12 performance | 100-visit API and ten tiny image transformations measured | **Partial**. No representative camera workload or mobile/4G useful-map verification. |

Additional blockers: Docker installation/container health still requires the user's administrator interaction; no ARM64 Docker image was claimed tested. Full-stack native mode is experimental and does not cover Linux-container networking, managed Supabase pooling, hosted RLS configuration or service pause/recovery.

No closed-loop production upload admission, EXIF confirmation, transfer/purge administration, automatic orphan sweeper, real-file MIME allowlist enforcement or general error/observability system was built. The spike is intentionally smaller than the MVP. A passing local constraint test is not evidence that these unimplemented requirements are met.

## 12. Preliminary architectural comparison and next decision

| Dimension | A — Workers/D1 | B — Workers/PostgreSQL/Auth |
|---|---|---|
| Native local integrity | Tested safe reservations/replay/rollback/restore through D1 binding | Same invariants passed with real PostgreSQL transactions/connections and dump/restore |
| Authorization boundary | Worker-scoped SQL; no managed identity included | Worker-scoped SQL plus independently tested Auth/JWKS and RLS path; privileged bypass must be controlled |
| Identity/session complexity | Remains largely untested beyond mock session records; app-managed Google/session work is substantial | Local provider mechanics verified, but JWT-only logout is insufficient without a revocation policy |
| Operational friction | Smaller local setup; D1 API/export/tooling differences matter | Native fallback unblocked testing; Docker/admin and two-provider/network/pool behavior remain risks |
| Images/privacy | Same local HEIC decoder failure, local R2 success and cloud-validation gap | Same; selecting PostgreSQL/Supabase does not resolve Images/HEIC |
| Performance/cost | Lower observed localhost timings, not cloud proof | Extra local connection and optional session-check cost; no cloud/cost conclusion |
| Production readiness | Not approved | Not approved |

The plan's weighted security/media/integrity/operation/cost scores remain **N/D for production selection**: complete blocking acceptance and provider-cost evidence are absent. Local pass counts do not justify a weighted winner.

### Final regression and shutdown

[final-regression.json](../spikes/evidence/native/final-regression.json) records exit **0** for the final sequential D1 suite, PostgreSQL suite, Worker bearer integration and JWT expiry check after the last code changes. The report's API/race timings were refreshed from those final parity runs. Local document links and evidence JSON were validated; `git diff --check` passed. Protected application/requirement paths remain unchanged, and the known-generated-credential scan found no matches in nonignored review artifacts.

Both experiment Workers were stopped with Ctrl+C; the named Supabase native stack was stopped with `supabase stack stop --stack travel-map-poc-native` (exit **0**), preserving data and tools. [shutdown-check.json](../spikes/evidence/native/shutdown-check.json) records **no remaining listeners on the experiment API/database/mail ports**. A local Supabase management daemon may remain on its own loopback control port. No unrelated processes, containers or volumes were cleaned up. Resuming tests requires restarting the local services; no cloud step follows automatically.

**Recommended next technical decision:** specify and validate the session revocation boundary (offline JWT alone is demonstrably insufficient for immediate logout denial), then review a narrowly bounded **future cloud sandbox** plan for the shared HEIC/20 MB/private-media pipeline and remote transaction behavior. This report does not authorize that plan or spend. Docker/container reproduction can be completed after its host administrator prerequisite, without changing the verified native PostgreSQL results.

Keep ADR-001 runtime, ADR-002 persistence, ADR-003 identity/session and ADR-004 media **open**. Do not start production endpoints, frontend integration or deployment based on these local results alone.

Official references used to verify tool semantics, not substitute for experiments: [Workers local development](https://developers.cloudflare.com/workers/local-development/), [D1 binding/batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Images binding](https://developers.cloudflare.com/images/optimization/binding/), [Supabase native runtimes](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Docker license](https://docs.docker.com/subscription-billing/desktop-license/).
