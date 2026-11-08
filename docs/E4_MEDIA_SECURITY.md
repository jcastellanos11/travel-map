# E4.0 — Media security and lifecycle proposal

Date: 2026-11-08. **No production media security implementation.** Read alongside
[architecture](E4_MEDIA_ARCHITECTURE.md), [codec evidence](E4_CODEC_VALIDATION.md) and
[implementation gates](E4_IMPLEMENTATION_PLAN.md). Verified means an identified local
experiment passed; it never means the complete future application was proven safe.

## Trust boundaries and privacy invariant

Existing E1–E3.5 controls remain unchanged: opaque HttpOnly sessions, server logout
and revocation, Google/PKCE, HTTPS same-origin, CSRF/Origin, PostgreSQL restricted
RPCs/FORCE RLS and private React scope cleanup. Media must inherit these controls,
not use direct browser storage credentials, public buckets or client-side ACL filtering.

Future boundaries are browser→Worker, Worker→SQL, trusted processor→private object
adapter, and technical job runner→fenced job operations. A photo is a private child
of Visit→Trip→Project; storage keys and image validity never confer authorization.
An attacker controls upload bytes, declared type/size/name, URLs/IDs, retries,
concurrency and potentially a previously authorized browser. Membership and session
state can change during any operation.

**Approved beta invariant:** no precise GPS feature or retained EXIF GPS, even in the
archival copy. No EXIF-derived Place/Visit/date mutation. Reconstruct all stored
variants from oriented sRGB pixels; reject unsupported/unsafe images. Do not durably
quarantine raw user uploads. Synthetic GPS-bearing test fixtures are not an exception
permitting production raw storage. GPS visible in the photographed scene itself
cannot be removed by metadata stripping; do not promise visual anonymization.

## Proposed authorization matrix

**Unverified application design**, derived from existing approved roles. O=active
Project Owner, A=active Admin, M=active Member, G=active explicit Trip Guest.
Every permission also requires a valid session, current access and active ancestry.
Author means **this photo's creator**, not the Visit or Trip creator.

| Operation | O | A | M | G | Former member/outsider |
| --- | --- | --- | --- | --- | --- |
| Active photo minimal metadata | Yes | Yes | Authorized Trip | Explicit Trip only | No |
| Thumbnail/display | Yes | Yes | Authorized Trip | Explicit Trip only | No |
| Upload into existing Visit | Yes | Yes | Authorized Trip | Explicit Trip only | No |
| Download sanitized archival | Yes | Yes | Own contribution only | Own contribution only | No, even if creator |
| Edit description / move to trash | Yes | Yes | Own contribution only | Own contribution only | No |
| Management trash metadata / restore | Yes | Yes | Own contribution only | Own contribution only | No |
| Ordinary delivery of trashed photo | No | No | No | No | No |
| Permanently purge before deadline | No | No | No | No | No |
| Purge expired trash | Technical maintenance authority only; no browser role | Same | Same | Same | No |
| Manage retained contribution after creator leaves | Yes, subject to valid ancestry | Yes, same | Existing ordinary rights only | Existing explicit-Trip rights only | Departed creator has no access |

Restore eligibility is additionally constrained by the 30-day deadline and available
assets; exact workflow approval is required. No restoration of archived Projects or
Trips is introduced. Admin cannot gain Owner powers via photos. Guests never obtain
Project name/settings/roster/maps, sibling Trips or unrelated author details.
Minimal authorship must follow P-09/P-10: relevant safe author fields only, no emails.

Photo creator and quota responsibility remain separate columns. Initially charge the
authenticated contributor; leaving/removal retains their authored content and storage
charge. No automatic transfer, deletion or orphaned responsible user. Account deletion,
anonymization/consented transfer and unavailable-account quota policy remain separate
approval gates; do not invent them in E4.1.

**Verified reference mechanics only:** five role truth-table tests and a guard-before-
storage test pass in `spikes/e4-media/security.test.mjs`. That guard takes synthetic
trusted context; it is not SQL, session authentication, an API or a production policy
implementation. Real direct-RPC/HTTP role tests must be added in E4.1–E4.3.

## Private delivery

Recommendation: every GET/HEAD and any future conditional/range request resolves the
session and live SQL authorization before lookup/stream or existence information.
No reusable public object URLs, static asset paths, external image proxy URLs or shared
cache. Use `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, verified image types and generic safe download names.
Do not add CORS or alter existing CSP/cookies. Start without range/304 optimizations;
if later introduced, authorize before all 206/304 responses. Treat image dimensions,
counts and photo existence as private too.

Unauthenticated→401; hidden/cross-scope/unavailable→safe 404; forbidden action on a
visible resource→403. Never put database errors, object paths or filenames in error
responses. Avoid authorization caches. A delivery authorized before a concurrent
revocation may already be in flight; subsequent requests must fail. No promise to
retract bytes previously downloaded, saved by a recipient or retained in an open
browser. Future React gallery must clear private metadata/blobs and revoke object
URLs on logout/401/scope loss, cancel pending work and resist late responses. Do not
reuse the demo gallery's public-path cache model.

## Byte limits and atomic quota proposal

**Recommended explicit decimal contract, requiring approval:**

```text
MAX_BATCH_FILES = 10
MAX_INPUT_FILE_BYTES = 20_000_000
USER_MEDIA_QUOTA_BYTES = 500_000_000
TRASH_RETENTION_SECONDS = 2_592_000  # 30 × 24 hours
```

UI wording: “20 MB per file (20,000,000 bytes), 500 MB stored per user.” Do not label
these values MiB; 20 MiB is 20,971,520 bytes. Enforce actual byte counting, not merely
Content-Length. The existing `/me` 500,000,000 value supports this recommendation,
but API planning text explicitly left MB/MiB unresolved. No current limit was changed.

**Proposed additional bounds:** three per-file variant caps totalling 68,500,000
bytes; 15-minute reservation/processing lease; bounded retries and global/per-user
in-flight work. These are research settings requiring review, not approved quotas.
The input size limit does not imply a 20 MB stored total: decoding/re-encoding may
expand it. Account for exact archival + display + thumbnail + trash + candidates
covered by reservations. Internal sanitized backups have a separate operational
budget, consistent with the existing PRD's exclusion of backups from user quota;
do not use this exception to hide normal derivatives/orphans as “backups.”

### Reservation/finalization protocol (not SQL implemented)

1. Validate authenticated current Visit access and 1–10 descriptors. Create an
   idempotent operation with unique client file slots, without accepting bytes yet.
2. Just before each file stream, lock account/session then its quota row, then
   Project/Trip/resource in the agreed order. Check current membership after locks.
   Atomically reserve the configured worst-case output total if
   `used + reserved + R <= 500_000_000`. Reject/queue without accepting raw bytes if
   capacity is unavailable. Avoid reserving ten worst-case files all at once; that
   would reject a fresh account unnecessarily. Proposed independent per-file results
   and sequential processing allow earlier actual totals to free reservation slack.
3. Commit the reservation and fenced attempt journal before I/O. Outside SQL
   transactions, stream bounded input, verify/decode/sanitize, then write immutable
   candidate assets. Never hold Project locks while a codec runs.
4. Finalization reacquires the same locks, rechecks session/access/active ancestors,
   verifies trusted completion of exactly the required variants, size/hash/policy
   and settled writer. Atomically change reservation R to exact used total once,
   activate one Photo and its manifest, and append one committed audit transition.
   Output total greater than R fails closed; do not expand quota silently.
5. Failed/expired attempts become cleanup-pending, not immediately unreserved.
   Fence late work, settle writes, delete candidate objects, verify absence, then
   release reservation exactly once. Ambiguous write outcomes retain reservations
   and raise reconciliation/operational alerts until resolved.

A retry must not create a second full set of candidates under the first attempt's
single reservation. Settle/delete the previous attempt before reusing its budget,
or acquire additional capacity covering every coexisting candidate/temp byte. A
verified already-written asset is reused without another durable write. Fencing
prevents activation by old workers but does not itself stop their I/O or reclaim
bytes. This is an explicit future integration invariant, not covered by the current
in-memory reference implementation.

Use PostgreSQL BIGINT for counts and explicit nonnegative/check invariants. Lock or
compare-and-swap the quota row in every transition, including cleanup and restoration.
Use one consistent order for all new handlers; do not acquire quota after Project in
one path and before Project elsewhere. Multi-user/multi-asset locks are deterministic.
Existing SQL session/logout and exclusive Project revocation/archive locking must
continue to serialize correctly. A background job cannot authorize new uploads after
membership loss merely because it holds an old processing lease.

**Idempotency:** key scoped to authenticated user + operation + Visit with a canonical
request fingerprint/policy version. Same intent reuses one slot/Photo/reservation;
changed intent conflicts. Verify upload digest privately; never expose a cross-user
hash-dedup oracle. A retry gets a new fenced attempt/key, not a second charge. A new
intentional operation with identical pixels remains a separate photo and charge.
No automatic retries of uncertain user mutations without querying/replaying state.

**Verified reference only:** concurrent Promise reservations admit seven 68.5 MB
slots (479,500,000 bytes) and reject the others; duplicate finalization, changed
intent, partial-batch independence, output expansion and unsafe release checks pass.
The reference uses an in-memory serialized queue, not PostgreSQL independent
connections. Database quota contention, rollback, process crashes and HTTP retries
remain Unverified and must not be represented as native E4 SQL evidence.

## Lifecycle, restoration and retention

Proposed transitions; all operational clocks use server UTC. Visit calendar dates are
not used for retention and never converted to timestamps.

```text
pending_upload -> processing -> active
pending_upload/processing -> failed_rejected -> cleanup_pending -> settled_failed
active -> trashed -> restoring -> active
trashed -> expired_purge_pending -> purged
restoring -> trashed       (validation/asset failure)
```

Pending/processing/failed/trashed/restoring/expired states never use ordinary delivery.
Failure metadata is minimal, no payload snippets. Trash transition atomically records
`trashed_at`, `purge_after=trashed_at+30 days`, blocks ordinary media and keeps quota.
No counter release or object removal on trash, departure or Project archival.

Proposed restore: creator with current access or O/A, active Visit/Trip/Project,
`now < purge_after`, all assets verified; preserve the same Photo, Visit, creator,
description and original attribution. No moving to a different Visit or transfer of
responsibility. Acquire a fenced restoring lease and recheck clock/access before
activating. At the deadline, an exclusive purge claim wins against restore; restore
must never revive an asset while deletion is in flight. Repeated trash starts a new
30-day retention interval only after a valid restoration; monitor abuse and keep
bytes charged. Future rate limits must not silently shorten approved retention.

Purge workers claim only expired recorded assets with correct attempt generation and
no legal/backup hold; verify target keys against the asset journal. Partial deletion
is retryable. Release each asset's charged bytes only after confirmed deletion and an
idempotent SQL transition. Do not release an entire photo on a partial delete. A SQL
failure after deletion causes conservative temporary overcharge, repaired by
reconciliation. Never purge active retained contributions just because a creator left.

**Verified limited reference:** a controlled millisecond clock tests restoration just
before 30 days, denial at the deadline, trash quota retention, purge claim, deletion
confirmation and idempotent release. No real scheduled job was created or run. Future
local testing should inject a trusted test clock into an isolated maintenance runner,
not accept clock/deadline overrides from browser requests. Later Cloudflare Cron can
trigger bounded batches only after deployment/job-principal approval. Backup expiry,
legal holds and recoverability promises still require an operational retention policy.

## Threat model and required tests

All controls below are **proposed** unless evidence is explicitly cited. Severity
assumes an Internet-facing private-media service; no such routes were introduced.

| Threat / severity | Prevention | Detection | Recovery | Required evidence |
| --- | --- | --- | --- | --- |
| Unauthorized upload / High | Live session + Origin/CSRF + SQL Visit access, server creator | Safe denied-action metrics | Cancel/fence pending job, settle reservation | Real HTTP/direct-RPC role matrix; CSRF/Origin tests |
| Unauthorized download / Critical | Authorize each variant/archive request; no public URL | Count denials, no private content logs | Disable delivery, investigate exposure | O/A/M/G/outsider GET/HEAD/range tests |
| Cross-Project or Guest leakage / Critical | Full ancestry in SQL before counts/list/media; Guest only explicit Trip | Scope-isolation assertions | Clear affected UI, revoke/fix faulty scope | Same Place/different Projects, guessed IDs, roster/map denial |
| Revoked membership / High | Recheck after locks; no ACL cache; late finalization denied | Revocation race tests | Fence job, hide/clear stale UI | Removal/logout/archive during upload/read/finalize |
| Guessable/traversal keys / High | 256-bit random keys, no user paths, no direct storage access | Invalid key/symlink failures | Scoped quarantine/repair | LocalStore traversal/NOFOLLOW tests pass; R2 auth still pending |
| Forged MIME/polyglot / High | Magic + strict allowed container + full decode; safe output types | Reject reason counts only | Destroy unpublishable outputs | Declared mismatch/vector/truncation tests pass; broader corpus pending |
| Malicious codec/RCE / Critical | Patched native codecs, low privilege, no network, OS isolation | Crashes/resource alarms, dependency/SBOM review | Kill/fence job, patch, retry safe input | Host sandbox/codec fuzz tests not yet performed |
| Decompression bomb / High | Input counter, pixel/edge/page/bit-depth limits, memory/CPU cap | RSS/timeout/budget telemetry | Kill, settle writer and cleanup | 50 MP compressed rejection passes; 40 MP max-resource proof pending |
| GPS/metadata leakage / Critical | Raw-pixel barrier, fresh encoders, independent output audit for ALL variants | Synthetic metadata sentinel checks | Stop delivery, reprocess safe or reject | JPEG/PNG/WebP verified; HEVC/cloud not certified |
| Orientation/color loss / Medium | Apply EXIF orientation and ICC→sRGB before stripping | Pixel comparisons | Reject ambiguous/unsupported content | Eight EXIF orientations/P3/alpha pass; XMP/HDR corpus pending |
| Unsafe transforms/SSRF / High | No client URL/path input; fixed variants, no arbitrary transform arguments | Unexpected dependency/network checks | Disable faulty processor | Network-denial and malicious transform tests required |
| Temporary-file exposure / Critical | No durable raw user input; private sanitized temp roots; no assets mapping | Scope/build checks, private directory audit | Scoped deletion only; exposure response | 0700/0600/atomic publish verified; disk dump/swap policy pending |
| Stale private browser/cache / High | no-store, no shared cache, abort/generation guards, revoke Blob URLs | Browser cache/session tests | Hide/revalidate private UI | Future real browser revocation/logout test; not done in E4.0 |
| Concurrent quota bypass / High | BIGINT locked ledger + reservations + exact atomic finalize | Ledger invariant/reconciliation | Freeze affected uploads, conservative repair | Reference concurrency passes; real PostgreSQL contention required |
| Idempotency failure / High | User/Visit-scoped intent key + fingerprint + fenced slot | Duplicate-key/charge alerts | Replay authoritative state, reconcile duplicates | Reference replay/conflict passes; HTTP/SQL fault injection required |
| Orphaned or late objects / High | Candidate journal before PUT; fenced attempts; bounded sweep | Compare journal/object inventory | Settle writes, delete known candidates, then release | Injected filesystem failure verified; ambiguous cloud PUT pending |
| SQL/object inconsistency / High | No assumed distributed tx; verified manifest + outbox | Missing/hash-mismatched assets | Disable delivery, repair/reconcile | Crash windows around every I/O/commit required |
| Trash/restore abuse / High | Charge trash, current-access checks, deadline/fence exclusion | Repeated transitions/failures | Keep hidden, settle/repair under lock | Reference deadline passes; restore/purge SQL race required |
| Wrong permanent cleanup / Critical | Only expired recorded keys; deterministic claims; no client keys | Dry-run candidate counts and audit reconciliation | Stop job; restore sanitized backup if retention permits | Controlled clock, partial delete, wrong-generation and active-photo denial required |
| Sensitive logs/audits / High | Allowlist IDs/actions/counts; no body/EXIF/filename/token/checksum/URL logging | Sentinel scans and audit schema checks | Restrict logs, remove via approved incident policy | No application logging added; future request/audit leakage tests required |
| Job-principal escalation / Critical | Narrow job claims/finalization only, fixed ACL/search_path, no service-role | Principal/ACL and task provenance checks | Revoke technical credential, fence leases | Architecture decision and native privilege tests required |
| Resource/cost exhaustion / High | Per-user and global admission, bounded retries, output caps, no unsafe fallback | Queue/RSS/cost/budget alarms | Pause new processing, retain correct quota | Native limits/10-file stress + later actual cost meter pending |

## Security validation boundary

The 20-test security/isolation result includes **18 local storage/reference tests and
two source/build isolation tests**; it is not 20 real-media authorization tests.
Codec assertions independently verify container sanitization, but no finite synthetic
corpus establishes parser exploit resistance. Workerd probes have no application
identity routes and never connect to SQL. Existing backend tests were rerun, but no
new media routes exist to exercise. No credentials, cookies, CSRF values, user photos
or database records were logged/read by this PoC.

Before E4.1 approval: resolve decimal units, variant/resource/rejection policy,
processor containment/transport, technical job authority, restore/trash management
projection and retention/backup policy. Before beta: prove real HTTP+SQL authorization,
quota contention, crash recovery, private delivery/cache behavior and enabled codecs.
The current evidence is sufficient to identify these gates, not to waive them.
