# E4.1 private media SQL/domain foundation

No routes, processor, ObjectStore, local bridge, file bytes, scheduler, R2/Images
binding or usable upload/download system. `types.ts` is a domain contract, not a
claim of callable HTTP support. Production OpenAPI remains E0–E2.4 HTTP coverage.

## Schema and authority

Migration `0007_media_foundation` adds owner-only FORCE-RLS tables: photos,
photo_assets (also the artifact journal), user_media_quotas, upload_operations,
upload_file_slots, quota_reservations, processing_attempts and media_tasks (outbox).
All domain FKs RESTRICT. Photos keep stable Visit/creator/quota identity; operation
intent, slots, assets, attempt links and reservation settlements are immutable.
Constrained state changes, deferred 1–10 slot counts and a three-verified-asset
activation guard supplement handler authorization. Asset keys are allocated before
future writes and never included in user DTOs.

Application role retains exactly four RPCs. `api_call` dispatches private media
actions with actor and session derived from the locked session. JSON cannot supply
identity/roles/manifest/accounting evidence. Media rechecks session expiry after
potential lock waits; existing authentication actions are unchanged. `/me.storage`
keeps its shape and reads the caller's ledger, defaulting to0/0/500000000.

Lock order: session/account → charged quota row → Project → Trip → Visit → operation
→ slot → Photo → reservation → attempt → task/asset. Non-owner administration first
resolves the charged account from immutable Photo ancestry. Project revocation and
archival keep their existing exclusive locks. No lock spans external I/O.

All private helpers use fixed pg_catalog paths and UTC, are schema-qualified and
not runtime executable. The deferred `media_slot_bound` trigger alone needs its own
SECURITY DEFINER authority because it fires at COMMIT, after api_call's definer frame
has returned; it only verifies the recorded operation's slot count. Immediate private
domain helpers are SECURITY INVOKER. Jobs entry points are separately reviewed
SECURITY DEFINER functions owned by the existing non-superuser migration owner.

## Foundation application actions (SQL only)

| `api_call` action | Data / permission |
| --- | --- |
| media.begin | visitId, idempotencyKey, files[{clientFileId,declaredBytes,declaredMime?}]; active authorized Trip reader, including explicit Guest; contributor derived server-side |
| media.operation | id; uploader with current Visit access; returns bounded slot state, never internal keys/fingerprints |
| media.reserve | slotId, reservedBytes; same uploader, exact integer≤500000000; locks/charges reservation once; supplied value is a capacity ceiling, not proof of stored bytes |
| media.finalize | slotId only; current uploader, live session and ancestry; requires current trusted ready/settled attempt and exactly three verified assets; exact sum≤reservation |
| media.cancel | slotId; uploader with current access; fences and queues cleanup; never releases uncertain capacity |
| media.list | visitId, optional active/trashed state, limit1–100, paired cursorTime/cursorId; limit+1 items for existing server cursor layer; trash filtered to own photos or O/A |
| media.get | id; active photo, authorized Trip reader; safe metadata only |
| media.archival | id; current creator or Project O/A; authorization result only, no file/key |
| media.describe | id, description nullable≤2000; current creator or O/A, active photo |
| media.trash | id; current creator or O/A; immediately hides ordinary reads, keeps charge, starts30day deadline |
| media.restore | id; current creator/O/A before deadline and active ancestry; stages a restore task, then requires latest task's trusted availability before activation |

Errors are safe symbolic SESSION_REQUIRED, VALIDATION_ERROR, RESOURCE_NOT_FOUND,
ACTION_FORBIDDEN, OPERATION_CONFLICT and QUOTA_EXCEEDED. No new HTTP mapping is enabled.
Future HTTP routes must use existing Origin/CSRF and safe transport conventions.

## Technical principal and evidence

Preprovisioned group `travel_map_media_maintenance`: NOLOGIN/NOINHERIT, no superuser,
create-role/database, replication or RLS bypass, no role memberships in either
direction, no database ownership or existing domain privileges. Migration fails on
unexpected privileges; it does not repair roles. No service login/credentials created.
Future membership to a dedicated restricted service login requires separate review.

Only schema usage plus these two functions are granted:

- `travel_map_jobs.claim(kind text)`: one eligible process/cleanup/restore/purge ticket,
  bounded eight-candidate scan. Includes recorded asset IDs/keys for that job only;
  no Project/Trip/Visit names, rosters, profiles or arbitrary-resource browse.
- `travel_map_jobs.record(task uuid, claim uuid, generation bigint, action text,
  evidence jsonb)`: current ticket/generation only. `processed` accepts three
  checked asset manifests with sanitizedPolicy=sanitized-v1 and writesSettled=true;
  `writes_settled` attests fenced cleanup I/O is finished; `absent` accepts a recorded
  asset ID, not a key/path/URL; `available` verifies all three recorded restore assets.

Claims lease5minutes, max20 claims/task; reservations lease15minutes. These are
operational SQL defaults, not new user quota limits. Expired processing is fenced
into cleanup, never reissued to a second writer. Expiration or missing HEAD alone
never releases quota. Cleanup holds reservation until all candidate absences are
confirmed after settled writes; a new attempt gets new keys/generation only after
cleanup. Purge releases each confirmed deleted asset's exact bytes once. Restore
and purge serialize; only the latest restore ticket can provide availability proof.
Retries exhausted at20 remain held for future reconciliation/operator review; no
unbounded automatic retry or scheduler is implemented.

The technical principal cannot create sessions, call application/private helpers,
read/write domain tables, change memberships/ownership/limits, choose keys or activate
Photos. Activation/restoration require a current user's authenticated api_call.
Technical cleanup/purge audit events use actor_id=NULL with explicit non-credential
technical attribution; user actions retain their real actor. Audit remains append-only.

**Trusted testimony boundary:** E4.1 checks provenance and consistency of evidence,
not actual files. The tests submit synthetic manifests through this restricted role;
there is no processor/storage adapter capable of validating real bytes yet. Future
code must verify hashes, privacy, object availability, settled I/O and confirmed
deletions before making these calls. No user-supplied assertion can replace that.

## Testing and rollback

Use `npm run db:media:test` with existing PG_BIN; never a development DATABASE_URL.
The launcher creates a new marked native cluster on a random loopback port and
removes only that cluster. URL, port, database comment, server marker, directory and
owner are verified before E4.1 migrations. Old regression suites stay pinned to
their historical migration increments inside the same new cluster.
The npm command prepares the dry-run Worker/Swagger artifacts first. Run it after
`npm run check`, not concurrently with another build that rewrites shared artifacts.

Down is allowed only in marked E4.1 disposable databases without media/operations,
nonzero quota or photo audit history. It restores the prior dispatcher definition,
owner, ACLs and audit schema. Even purged media history refuses down: use a separately
reviewed forward recovery, never discard retained history/possible external objects.
No persistent migration or rollback is authorized by E4.1 testing.
