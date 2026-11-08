# E4.1 media foundation contract

Approved decisions recorded before implementation (2026-11-08). This document
supersedes historical E4 examples retaining raw originals or suggesting EXIF-derived
locations/dates. It does not add callable HTTP endpoints to production OpenAPI.

## Binding policy

Private Photo → existing Visit → Trip → Project. Initial creator and separate quota
responsible user are the authenticated contributor. Both remain immutable; departure
preserves content/attribution/charge. No exact GPS, EXIF storage or suggestions. HEIC
and HEIF disabled until the separate portable-codec/OS-containment gates pass.

Constants are decimal integers: batch10, input20,000,000 bytes/file, user500,000,000
bytes, trash2,592,000 seconds. Count every stored variant, trash and active reservation.
Archival is reconstructed JPEG95 opaque/PNG alpha; display WebP inside2560/Q82;
thumbnail WebP inside480/Q72; orient/aspect-preserve, no crop/upscale; all stripped
of identifying metadata. No processing, object adapter, bridge or delivery in E4.1.

## Lock and authority review

Existing api_call locks session FOR UPDATE then account FOR SHARE. New media actions
then lock the charged user's quota row, Project FOR SHARE, Trip FOR SHARE and Visit,
then operation/slot/Photo/attempt/task rows in deterministic ancestry order. Project
management continues taking exclusive Project locks. Metadata reads never lock quota
after Project. Maintenance takes account/quota before Project/Trip/resources too.
No transaction spans external I/O. Helpers receive an actor only from api_call;
client-supplied actor, ownership, role, manifest and stored byte totals are rejected.

The dedicated `travel_map_media_maintenance` group is NOLOGIN, NOINHERIT, NOSUPERUSER,
NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, not a member of another role.
Provisioning is an explicit owner prerequisite, never migration privilege repair.
No credentials or runtime membership are created. Its only application-schema access
is a private jobs schema and bounded claim/evidence RPCs; no domain tables or user
RPCs. The disposable harness alone assumes it to test grants. Real service-login
binding, credential storage and processor transport remain future work.

Maintenance may attest only against a leased recorded task/generation and recorded
assets. It cannot choose keys, actors, ownership or quota limits. SQL evidence is
trusted technical testimony, not proof of real object writes/deletions. Activation
and restoration require a fresh authenticated user call and current resource access.
Expired/uncertain writes keep reservations until fenced, settled and confirmed absent.
No retry gets new object capacity while earlier candidates remain unresolved.

## Public HTTP proposal (not implemented)

All paths below use `/api/v1`; mutations require current session, existing Origin and
X-CSRF-Token. Content streams also count actual bytes. Reads require live ancestry.
No raw keys, EXIF, GPS, filesystem paths, technical claims or credential data in DTOs.

| Method/path | Future contract |
| --- | --- |
| POST `/visits/{visitId}/upload-operations` | Idempotency-Key; `{files:[{clientFileId,declaredBytes,declaredMime?}]}`, 1–10; no raw filenames |
| PUT `/upload-operations/{operationId}/files/{fileId}/content` | One bounded binary stream; no multipart200MB batch or public storage URL |
| POST `.../files/{fileId}/finalize` | No client manifest/size; server consumes verified fenced evidence |
| GET `/upload-operations/{operationId}`; POST `.../files/{fileId}/retry` | Current uploader/current Visit access only; no automatic mutation retry |
| GET `/visits/{visitId}/photos` | Active authorized items + opaque nextCursor; management trash projection only creator or O/A |
| GET/PATCH `/photos/{photoId}` | Safe metadata; PATCH description only, current creator or Project O/A |
| GET `/photos/{photoId}/media/{thumbnail\|display}` | Authorized derivative, private/no-store, nosniff; no reusable object URL |
| GET `/photos/{photoId}/archive` | Sanitized reconstructed archival, current creator or O/A only |
| DELETE `/photos/{photoId}`; POST `/photos/{photoId}/restore` | Trash keeps charge; restore current creator/O/A before deadline with fresh trusted availability proof |

Proposed safe Photo DTO: id, visitId, createdByUserId, description, status, UTC
createdAt/updatedAt, permitted trashedAt/purgeAfter, server-derived capabilities.
Asset metadata returned publicly is limited to variant, contentType, width, height
and byteLength when authorized; no storage keys, SHA256 or technical task data.
Use existing items/nextCursor and safe 400/401/403/404/409/429/503 conventions;
413/415/422 remain future upload-contract additions. No HTTP media route is enabled
by E4.1. Existing OpenAPI stays authoritative for implemented routes.

## Foundation-only SQL actions

`api_call` may dispatch authenticated `media.*` domain operations for tests/future
services; the HTTP router does not expose them. SQL list cursors use the established
internal cursorTime/cursorId pair, never browser-selected actor or authority. Technical
evidence must arrive through the separate jobs boundary, not media.finalize payloads.
The module README and E4_1_VALIDATION record exact implemented actions and limitations.
