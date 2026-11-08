# E4 — Proposed incremental implementation plan

Date: 2026-11-08. **E4.0 research complete; no later increment started.** This plan
requires review and separate implementation authorization. It does not approve cloud
resources, billing, deployment, persistent migration or new production capabilities.

Sources: [media architecture](E4_MEDIA_ARCHITECTURE.md), [security](E4_MEDIA_SECURITY.md),
[codec results](E4_CODEC_VALIDATION.md), current ADR-001, implemented E1–E3.5 contracts.
Only the three documents above and this plan define **proposals**, not new API behavior.

## E4.0 outcome and decision register

E3.5 is committed at `0f399bd` on `main`. Existing Supabase configuration modification
was preserved. E4.0 added only these four documents and `spikes/e4-media/`; it did
not change application code, migrations, production OpenAPI, dependencies or lockfiles.
All experiments use synthetic fixtures and local isolated storage/runtime emulation.

| Decision | Status / recommendation |
| --- | --- |
| Private default, Visit ancestry, live authorization on every media request | **Approved requirement**; preserve inherited Project/explicit Trip Guest semantics |
| ≤10 files, ≤20 MB/file, ≤500 MB/user, trash 30 days | **Approved requirement**; recommend decimal integer constants 10 / 20,000,000 / 500,000,000 and explicit byte wording; exact interpretation awaits contract review |
| All archival/display/thumbnail metadata sanitized, no GPS feature | **Approved E4.0 requirement**, supersedes historical unsanitized-original/EXIF-suggestion proposals for beta |
| Sanitized archival format/quality | **Proposed:** native oriented dimensions; JPEG95/4:4:4 opaque, PNG alpha; approve lossy archival meaning and user-facing wording |
| Display/thumb | **Proposed:** WebP inside2560/Q82 and inside480/Q72; alpha preserved, no crop/upscale |
| Image safety/output limits | **Proposed:** 40 MP/12k edge, reject animation/multipage/HDR/16-bit/unsupported orientation; 64 MB+4 MB+0.5 MB outputs; requires hard-memory/corpus verification and policy approval |
| Local processor | **Proposed:** isolated Node24/Sharp child, low privilege/no network, concurrency1, 30s hard watchdog and OS memory cap; no native Sharp inside workerd |
| Local storage | **Proposed:** private ObjectStore; Worker-facing local R2 emulator, or explicitly approved local processor bridge to Node filesystem; no public asset path |
| HEIC/HEIF | **Gate remains:** installed portable decoder unsupported; macOS synthetic chain only partially verified; fail closed until chosen runtime passes |
| Quota responsibility | Contributor initially, retained on departure; exact atomic SQL design must preserve separate creator/responsible identity |
| Per-file batch outcomes | **Proposed:** independent files, bounded sequential admission/reservation; no all-or-nothing batch or unbounded simultaneous raw input |
| Reservation expiry/idempotency | **Proposed:** 15min lease, fenced attempts, immutable intent; keep reservation until uncertain writes are settled/deleted |
| Background job identity | **Approval required:** narrowly scoped technical principal, no fake sessions/service-role/direct domain-table access; application role keeps four RPCs |
| Restore/trash management | **Proposed:** creator with current access or O/A; same ancestry/creator; before30days; no delivery while trashed; scope/privacy projection needs review |
| Cloud R2/Images | **Separately authorized sandbox only**; no E4.0 activation; no hosted support or cost pass claim |
| Backups, account removal, anonymization/transfer | Existing retention constraints remain; operational retention/crypto/recovery policy and exceptional ownership workflows require separate decisions, not silent implementation |

## E4.1 — Contract, domain and security foundation

**Dependencies:** approve byte units, derivative/archive semantics, resource/rejection
policy, local processor transport/storage choice, maintenance identity and restoration
rules. Unrelated unresolved account-deletion/ownership features stay disabled.

Proposed scope:

- Review exact media DTOs, error codes, paths (`archive` versus historical `original`),
  per-file outcomes/idempotency semantics and server-derived per-photo capabilities.
  Update production OpenAPI only after this contract is approved.
- Introduce minimal modular domain types/ports and a separately reviewed reversible
  migration for Photo, PhotoAsset, quota ledger/reservation, upload slots/attempts and
  durable cleanup journal/outbox. Choose migration number from actual history then;
  never edit 0001–0006 or apply to persistent development without separate approval.
- Implement private SQL authorization/state-transition primitives through existing
  `api_call`, with fixed search paths, qualified objects, owner ACLs and FORCE RLS.
  Define the separate job-principal boundary before enabling job/cleanup actions.
- Adopt deterministic session/account/quota → Project → Trip → resource locking;
  explicit RESTRICT FKs, exact BIGINT accounting, stable per-file identities and
  transactional append-only audit events. No objects or cloud resources yet.

Acceptance: forward/populated/failure-atomic/down/reapply migration tests only in
disposable DBs; checksum/owner/ACL/FORCE-RLS/four-app-RPC tests; real independent-
connection quota/idempotency/role/revocation races; no direct runtime tables, arbitrary
actor, raw SQL error, GPS columns or public media access. Reversible down must refuse
unsafe content loss; rollback/recovery plan must account for future external objects.
Stop before persistent migration. No claim that E4.0's in-memory queue satisfies this.

## E4.2 — Contained local processing and private storage adapters

**Dependencies:** E4.1 ports/security design; approved local runtime and resource caps.

- Implement private local ObjectStore adapter in the approved development topology,
  persistent only outside Vite/Worker public roots. Configure local emulation only;
  no production R2 bindings. Port supports bounded known-length streams, immutable
  writes, checksum/head/existence and idempotent deletion, without requiring rename.
- Implement the Node processor boundary with no arbitrary URL/path commands, network
  denial, actual OS memory/CPU/process limits, fenced job output and safe temp policy.
  No durable unsanitized user bytes; all stored variants must pass independent output
  checks. Do not copy the research harness into production imports.
- Verify representative synthetic/licensed JPEG/PNG/WebP cases and adversarial
  containers. Keep HEIC/HEIF disabled until portable decoder/privacy/resource proof.

Acceptance: GPS/IPTC/XMP/comment/ICC stripping on all variants; orientation/color/alpha
checks; actual20MB and dimension boundaries; maximum approved dimensions/10-file
stress; kill/restart/disk-full/temp exposure tests; artifact/build isolation. HEVC
needs genuinely diverse valid sources and complete metadata verification in selected
runtime. No cloud adapter certification from emulator results.

## E4.3 — Authorized upload, quota and private retrieval

**Dependencies:** E4.1 SQL primitives and E4.2 contained processor/storage.

- Add only approved same-origin upload-operation/content/finalization/status/retry
  and active-photo list/detail/private variant/archive routes. Reuse existing session,
  CSRF/Origin/safe error/pagination conventions and typed contracts.
- Reserve before accepting each file, cap observed bytes, sanitize all variants,
  journal writes, finalize exact verified asset sum under live authorization. Preserve
  independent outcomes within a ten-file operation; replay uncertain requests safely.
- Private retrieval authorizes every request including downloads; no public object
  URLs, shared cache or third-party transform URLs. Current creators/O/A only archive;
  authorized Trip readers see derivatives. No raw originals or metadata suggestions.

Acceptance: full O/A/M/G/former-user matrix through HTTP and direct SQL; CSRF/Origin/
session/logout tests; archive restrictions, guest scope and no-disclosure pagination;
parallel finalization/reservation/removal/archive/logout tests; fail at every SQL/I/O
boundary; quota invariant and journal reconciliation. No bytes published until all
required assets are verified. Native memory and recovery gates block unsafe uploads.

## E4.4 — Private gallery and upload UX

**Dependencies:** approved implemented E4.3 contracts; existing E3 typed client.

- Separate authenticated Visit photo models from static demo gallery. Explicit user
  file selection, max-ten guidance and per-file results; no auto-created photos.
- Show private display/thumb, description and permitted sanitized-archive actions;
  accessible loading/errors/retry/cancel and truthful photo counts/previews only from
  authorized backend projections. Any count/projection contract change requires
  explicit scope review; no invented frontend aggregates.
- Keep credentials/DTOs/blobs out of persistent storage; revoke object URLs and cancel
  requests on scope/session loss. No EXIF GPS feature or exact-coordinate fields.

Acceptance: creator/Admin/Member/Guest UI affordances with server final authority;
stale account/scope responses and revoked access clear media; safe MIME/download
headers, no-store/cache checks; keyboard/360/768/1440 layout; demo/build isolation;
real browser participation for Google/account tests, no credential automation.

## E4.5 — Trash, restoration, purge and reconciliation

**Dependencies:** E4.1 maintenance authority; E4.3 asset journal/ledger; approved
retention/backup policy. No restoration of archived Projects introduced.

- Add approved trash/restore/management-list operations; all ordinary delivery stops
  immediately on trash and charge remains. Restore same identity/Visit/creator only
  with current rights, active ancestry, available assets and deadline eligibility.
- Implement bounded idempotent cleanup worker/manual local runner, fenced claims,
  partial-deletion bookkeeping and reconciliation. Never unreserve unknown active
  writes, delete arbitrary objects or release quota before deletion confirmation.
- Controlled-clock disposable tests; future Cron integration is design-only until
  separately deployed/authorized. No schedule or host automation in E4.0.

Acceptance: exact30day boundaries, restore/purge races, retained contributed content,
revoked creator/admin cases, partial delete/restart/missing object, audit rollback,
charged-byte reconciliation; purge cannot touch active/foreign-generation assets.
Backup restore/retention promises must match actual sanitized backup behavior.

## E4.6 — Beta security, format, performance and cost gates

**Dependencies:** E4.1–E4.5 local gates; explicit authorization for real-account
participation and any later cloud sandbox/resources/billing. Cloud remains optional
and blocked until approved; do not bundle it into a local implementation approval.

- Complete cross-account local browser upload/read/archive/trash/restore/revocation
  acceptance with user-operated accounts and disposable records. Test stale caches,
  history, response races, keyboard/mobile layouts and private/demo separation.
- Real PostgreSQL crash/race load and processor maximum-dimension/memory/fuzz/security
  review; document enabled formats, known rejected subtypes and fail-closed behavior.
- If separately approved, sandbox private R2 + real Images bindings with synthetic
  GPS-bearing HEIC/HEIF, all safe outputs, 19.9m/20m/above-limit actual bytes, authorized
  download/isolation, object consistency and failure recovery. Record actual meter,
  region/runtime, limits and costs, then follow an approved scoped cleanup plan.
- Preserve the E3.4 pending mobile/4G gate: useful first map of100 Visits within4s,
  defined representative browser/network/CPU and repeated runs. E4.0 Node timings do
  not satisfy it. Add photo-specific performance objectives only after approval.

Acceptance: no critical privacy/auth/accounting issues; enabled-format proof in the
actual intended runtime; cost/usage within approved budget, no automated paid fallback;
documented recovery/backup/on-call limits and residual risks. No “production ready”
claim from local tests, emulation, vendor documentation or a single benchmark.

## Current validation and next decision

Final E4.0 evidence: **32 codec + 20 security/isolation + six local workerd assertions
=58 passed**, plus **200 frontend + three build-isolation +40 backend regression
tests=243 passed**; total **301 pass/0 fail/0 skipped**. Frontend/backend lint/typecheck,
normal/integration builds, DTO/OpenAPI checks and final whitespace check pass. Initial
failures and unsupported capabilities remain documented, not erased by final counts.
No media DB tests, application-media endpoints, real-account/browser E4 tests or cloud
tests exist yet. [Exact commands and limitations](E4_CODEC_VALIDATION.md).

Recommended next technical decision: review and approve the contract/runtime/job-
authority choices above, especially the sanitized archival meaning and processor
containment. **E4.1 is ready for architecture review, not unconditional implementation.**
HEVC support, hard memory containment and real cloud privacy/cost remain gates. Any
approval can scope independent foundations while disabled features remain blocked.
Do not automatically start E4.1, migrate persistent data, deploy, commit or push.
