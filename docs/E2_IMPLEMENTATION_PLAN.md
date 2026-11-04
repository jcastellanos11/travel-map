# Travel Map — Proposed E2 Implementation Plan

Date: 2026-11-03. Updated: 2026-11-04. **E2.1 ONLY approved for implementation by the user. E2.2–E2.4 remain proposals, not implemented.**

Implementation evidence and exact results: [E2_1_VALIDATION](../backend/E2_1_VALIDATION.md). Historical E1 audit below describes the pre-E2.1 baseline.

Baseline commit: `b25701c223c8528d4bf3e655118961e0467e4232` (`feat(auth): implement Google OAuth and secure sessions`). Initial tracked worktree change: `backend/supabase/config.toml`; preserve it. This records the original planning baseline; subsequent E2.1 implementation is tracked separately.

## 1. Authority, scope and evidence

Inputs: [PRD](PRD.md), [DATA_MODEL](DATA_MODEL.md), [AUTHORIZATION_MATRIX](AUTHORIZATION_MATRIX.md), [ADR-001](ADR-001-STACK.md), [API_CONTRACT](API_CONTRACT.md), [original implementation sequence](IMPLEMENTATION_PLAN.md), [E1 validation](../backend/E1_VALIDATION.md), [backend guide](../backend/README.md), migrations, RPC transport, routes and tests.

The approved PRD and decisions #38/#40 remain authoritative. DATA_MODEL and the API contract are design drafts; unresolved matrix entries are not approved requirements. The latest user request brings **invitations and basic membership administration forward from the original E5 into this proposed E2**. Ownership transfer, destructive lifecycle operations and media remain later work. No stack comparison is reopened.

Evidence labels:

- **Verified — repository:** directly inspected implementation or documentation.
- **Verified — local catalog:** read-only inspection of the running `travel_map_dev` schema using the restricted application connection; no account rows selected or credential values displayed.
- **Session-confirmed:** real Google login succeeded; real Firefox logout produced 200 → 204 → 401 and durable revocation was independently confirmed in the preceding acceptance session. The user explicitly accepted that result.
- **Proposed / decision required:** future design, endpoints and tests in this document; none implemented or executed here.

**Documentation discrepancy:** E1_VALIDATION and README still describe real Google acceptance as pending. That statement predates the session-confirmed result; do not repeat Google login or change E1 authentication to start E2. Hosted deployment/performance and unrelated provider lifecycle guarantees remain unverified. Updating the historical E1 evidence is a separate documentation follow-up; it is not performed here.

## 2. Current E1 audit

| Finding | Evidence | Consequence for E2 |
|---|---|---|
| Google-only provider adapter, PKCE/state transaction, opaque server sessions, CSRF/Origin validation and logout exist. | [app.ts:24](../backend/src/app.ts#L24), `modules/identity/{provider,routes,security}.ts`; E1 acceptance above. | Preserve these paths, cookies, timeouts, identity mapping, CSP and revocation behavior. |
| Project create/list/get exist; owner is derived from session, and reads include current active project memberships. | [app.ts:51](../backend/src/app.ts#L51); `api_call` in [0002:67](../backend/migrations/0002_identity.up.sql#L67). | Extend domain functionality, not project/session bootstrap. |
| Owner is a single `projects.owner_user_id`; membership roles are only admin/member. Owner duplication and invalid retained ownership are constrained. | [0001:21](../backend/migrations/0001_foundation.up.sql#L21), `check_membership_owner`, `check_project_owner`, `protect_project_owner`. | Do not add an editable owner membership role or permit owner assignment in request JSON. |
| Membership storage and membership-aware reads exist; membership creation/removal/role changes do not have public routes. | [0001:40](../backend/migrations/0001_foundation.up.sql#L40); E1 integration tests seed memberships administratively. | SQL fixtures are not implemented collaboration features. |
| No Trip, TripMembership, Visit, Place, Invitation or Photo schema exists. | Both migrations and local catalog: exactly five domain/operational tables. | Add entities incrementally; absent E4 media entities are intentional. |
| Project lifecycle columns exist, but only active projects are returned; no archive/restore route exists. | `api_call` uses `p.status='active'`; current route allowlist. | A status column is not an implemented lifecycle workflow. |
| All five tables have RLS enabled and forced. Runtime has no direct table access, schema creation, superuser, BYPASSRLS, role creation or inheritance. | Verified local catalog; [0001:138](../backend/migrations/0001_foundation.up.sql#L138), [0002:16](../backend/migrations/0002_identity.up.sql#L16). | Preserve grants and posture on every new table/function. |
| RLS policies allow the trusted database function owner; they are not per-user tenant policies. RPC performs the user authorization. | `identity_owner ... TO CURRENT_USER USING (true)` created by migration owner; SECURITY DEFINER RPC. | Critical boundary: never expose tables or internal actor-based helpers to browser/runtime roles. |
| Runtime executes only oauth_begin, oauth_consume, login_complete and api_call; helper triggers are not executable by it. | Verified local function catalog; [postgres.ts:29](../backend/src/infrastructure/postgres.ts#L29). | Prefer keeping the existing four-function external surface. |
| Transport maps all non-session RPC error results to 404. | [postgres.ts:34](../backend/src/infrastructure/postgres.ts#L34). | New domain outcomes need an explicit safe error map; do not accidentally turn validation/conflicts into 404 or dependency failures. |
| Domain actions are concentrated in one SQL dispatcher and HTTP composition function. | `api_call`, `handleRequest`. | Extract module-owned internal domain handlers during their increments; avoid duplicating authentication. |

Existing automated coverage includes project isolation, membership loss, CSRF/Origin, unknown/expired/revoked sessions, logout, pagination, migrations and actual workerd/PostgreSQL/Supabase integration. Historical E1 results are 16 unit/runtime tests, 23 SQL/integration test nodes and five Supabase nodes, recorded in E1_VALIDATION. **Those suites were not rerun for this read-only audit.**

## 3. Actual schema versus DATA_MODEL

| Concept | Actual E1 representation | Planned disposition |
|---|---|---|
| User | UUID, unique stable Supabase subject, display name/email, account lifecycle and timestamps. | Reuse unchanged. Supabase subject is the approved identity adaptation, not missing Google identity support. |
| Project | UUID, owner FK, name, creation policy, status, archive/delete timestamps. | Reuse; add authorized management behavior. No public-sharing flag/API is needed: absence of public access is the private default. |
| ProjectMembership | Composite project/user key; admin/member; active/revoked; timestamps. | Reuse for role changes, revocation and controlled reactivation. Never delete contributions with membership rows. |
| Trip / TripMembership | Missing. | E2.1: project-owned trips and explicit trip-only guest relationships. |
| Place / Visit | Missing. | E2.2: normalized geographic identity and independent shared visits. |
| Invitation | Missing. | E2.4: private one-use, expiring, hashed project/trip grants. |
| Photo / PhotoAsset / quota/upload operations | Missing; `/me` currently reports initial zero usage. | E4; do not invent operational accounting or photo results in E2. |
| AppSession / OAuthTransaction | Implemented operational tables, outside the conceptual content diagram. | Preserve unchanged; they are necessary implementation entities, not domain discrepancies. |
| Domain audit events | Not implemented. | Proposed minimal security-event table in E2.3, not a new product user role. |

This comparison verifies schema structure and permissions, not the completeness of live business data. No production/hosted database was queried.

## 4. Shared implementation and security contract

**Proposed structure:** keep one Worker. Add module-owned trips, visits/places and collaboration request validators/services. Reuse `PostgresRepository.call` and the existing authenticated `api_call` signature. Its session/account guard remains authoritative; new action branches delegate to private internal SQL functions using only the actor resolved from that guard. Internal helpers are not callable by the application role and never accept a browser-selected identity as authority. Keep E1 me/logout and identity bootstrap behavior unchanged and regression-tested.

Every increment must:

1. Resolve the current session/account, then resource ancestry, effective membership, action and lifecycle state **inside the SQL operation**. Node prechecks and frontend capabilities cannot authorize a write.
2. Preserve FORCE RLS and owner-only policies on new private tables, explicit PUBLIC revocation, fixed search_path, schema-qualified SQL and UTC operational timestamps. Internal domain helpers can use SECURITY INVOKER under the authenticated dispatcher owner's context; no runtime EXECUTE grant to those helpers. Do not grant all functions/tables or use a service-role key to bypass domain authorization.
3. Apply migrations as the existing trusted function owner, or through an explicitly authorized operator assuming that role. Preflight owner/policy identities and ACLs; migration-role drift must abort, not be repaired by broader grants. CREATE OR REPLACE of the existing dispatcher must preserve its signature, ownership, ACL and E1 guards.
4. Keep exact Origin/CSRF enforcement for every new mutation and private/no-store responses. Map only whitelisted errors: missing session 401, hidden/unknown resource 404, forbidden action on a visible resource 403, validation 400, conflicts 409, throttling 429, dependency outage 503. No raw SQL/error detail.
5. Paginate/filter authorized rows, including counts, facets and cursor results. Reuse 25/default and 100/max unless a reviewed contract states otherwise. Never load unauthorized rows into React and hide them there.
6. Establish a documented lock order: existing session/account locks, then project, trip where needed, invitation where needed, and membership/visit rows; sort multiple IDs consistently. Domain operations take a project shared lock; membership/role/archive mutations take an exclusive project lock and recheck permission after acquiring it. Invitation target lookup is not authorization: lock the resolved project and re-read immutable invitation state before granting access. Test independent connections for races/deadlocks; keep waits bounded.
7. Preserve already-authorized in-flight semantics: once removal/archive/logout acknowledges, subsequent requests must see the new state. Do not promise to retract responses or data already delivered.

These are proposed domain extensions to the existing boundary, not a redesign of E1 authentication.

## 5. E2.1 — Trips and inherited authorization

**Outcome:** one project contains multiple independent trips, with project-wide access inheritance and isolated trip-only guest access.

**Proposed paired migration:** `0003_trips_authorization.up/down.sql`.

- `trips`: UUID primary key, non-null project FK, name, optional description, server-derived creator for provenance, lifecycle/timestamps. Project and creator references use RESTRICT; no cascade deletion. Project ID is immutable through API. Index `(project_id, created_at, id)` for scoped pagination.
- `trip_memberships`: unique `(trip_id,user_id)`, guest-only role, active/revoked status and timestamps; trip/user FKs and active user/trip index. No independent trip administrator role, no per-trip deny override and no owner duplication.
- Add private project/trip/action authorization helpers and narrow dispatcher actions. No HTTP grant shortcut or user-creation mock is introduced; tests may seed synthetic memberships administratively.

| Proposed API | Permission |
|---|---|
| `GET /api/v1/projects/{projectId}/trips` | O/A/M only; G cannot enumerate the project. |
| `POST /api/v1/projects/{projectId}/trips` | O/A; M only with all_project_members; G never. |
| `GET /api/v1/trips/{tripId}` | O/A/M inherited from the active parent or G of exactly that trip. |
| `PATCH /api/v1/trips/{tripId}` | O/A for title/description; P-03 Option A approved: members cannot edit, including creators. No project/status/creator reassignment. |

O = owner, A = project admin, M = project member, G = trip-only guest. Unknown/foreign ancestors never produce broader context. Initial responses to G omit project roster, other trips and aggregates; additional project context is gated by P-09.

**Acceptance/tests:** create two trips and retrieve distinct IDs/content; M inherits both without duplicated trip memberships; creation policy allowed/denied cases; G can read only its trip and cannot create/list another; country/location similarity grants nothing; inactive parent/member/session denied; crafted project/creator/role fields rejected; project membership precedence over G tested; no PUBLIC/direct SQL reads; new RPC actions deny cross-project calls even when invoked directly with the runtime SQL role. Run the unchanged E1 regression suite.

**Dependencies/gates:** E1 accepted. P-03 Option A approved by user on 2026-11-04: only O/A edit Trips, including member-created Trips. Visit creator/Admin rules remain reserved for E2.2.

**Rollback:** restore the preceding dispatcher definition, then remove E2.1 helpers/policies and new tables only after later dependent migrations are reversed. Never roll back 0001/0002. Destructive table rollback is permitted only in an explicitly disposable test database; populated development data requires preservation/forward repair.

## 6. E2.2 — Places, Visits and authorized map projections

**Outcome:** shared visits reference normalized places; repeated visits remain independent and calendar dates never shift with timezones.

**Proposed paired migration:** `0004_places_visits.up/down.sql`.

- Small `country_codes` reference with canonical code/display name; proposed alpha-3 codes match existing COL contracts. Provenance/license and source mapping must be reviewed before real import.
- `places`: stable UUID, country FK, locality/display name, optional region, optional independent approximate coordinate pair, optional source/provider ID. Only proven source identities receive a scoped unique constraint. **Never unique by city text alone**; do not merge homonyms/aliases or use a private exact visit point as catalog coordinates.
- `visits`: UUID, immutable trip FK, place FK, server-derived creator FK, optional visit name, calendar date mode/start/end, optional confirmed exact coordinate pair and confirmation metadata, lifecycle/timestamps. No uniqueness on place/trip/date: repeated visits are valid. RESTRICT protects retained contributions.
- Validate coordinate pairs/finite ranges in request and SQL. Use PostgreSQL DATE, not timestamptz, for visit dates. Proposed canonical single-date representation has start=end; none has both null; range has both dates with start<=end. Serialize as date strings directly from SQL, without a JavaScript Date conversion.
- Index visits by trip and stable pagination; place/country references and date predicates receive measured B-tree indexes. No PostGIS, geometry service or paid geocoder is required for these queries.

| Proposed API | Permission/behavior |
|---|---|
| `GET /api/v1/places?countryCode=COL&query=...` | Authenticated, controlled geographic catalog only; never private visit counts or user-derived suggestions. |
| `GET/POST /api/v1/trips/{tripId}/visits` | Read/create by current authorized trip collaborators, including G. |
| `GET /api/v1/visits/{visitId}` | Current trip/ancestor access. |
| `PATCH /api/v1/visits/{visitId}` | Creator **with current access**, or O/A of the parent project. Other M/G denied. |
| `GET /api/v1/projects/{projectId}/map` | O/A/M; authorized trip/country/date filters. |
| `GET /api/v1/trips/{tripId}/map` | Trip readers, including G; no project-wide aggregation. |

Prefer a resolved placeId; the draft inline-place DTO may be supported only through the approved controlled resolver. Ambiguous/unavailable matches must be reported, not silently merged or assigned invented coordinates. Start with controlled geographic fixtures/imports; do not expose a global place entry inferred solely from someone else's private visit. A limited catalog is not proof of worldwide locality coverage.

Date overlap is inclusive; any active temporal filter excludes undated visits. Proposed support for one-sided from/to bounds is explicit; reject invalid or reversed bounds. Country/trip filters must be scoped before counts/pagination. E2 maps can expose photoCount=0 and previewPhotoId=null because photos are not implemented; no demo photos or fictitious totals.

**Acceptance/tests:** repeated Bogotá visits across/within trips; same-named cities remain distinct; empty visits valid; none/single/range and leap-day/reversed/invalid date cases; timezone/DST round trips under UTC, Istanbul and a negative-offset timezone; inclusive overlap and undated exclusion; valid/invalid coordinates; G creates in own trip but cannot edit another creator's visit; O/A edits within scope only; creator loses editing on exit; every list/filter/map/count excludes other projects/trips and inactive ancestors. Exercise a 100-visit fixture and query plans locally, without claiming the final mobile/4G target was met.

**Dependencies/gates:** E2.1; geographic identity/catalog and exact-point consent/projection decisions below. City-only visits can proceed with approved controlled places while precise-point sharing remains denied. No implicit EXIF processing. DELETE/restore is deferred pending P-04 and contribution safeguards.

**Rollback:** restore E2.1 dispatcher first, reverse E2.2 helpers/policies, then visits before places/country reference. Never remove shared places still referenced by retained visits or import a destructive catalog replacement. Preserve/export populated data; prefer forward correction.

## 7. E2.3 — Membership administration, departure and owner-only archive

**Outcome:** owner/admin/member behavior becomes an actual API workflow rather than test-seeded rows.

**Proposed paired migration:** `0005_membership_management.up/down.sql`.

Reuse project_memberships; add private mutation handlers and a minimal append-only `domain_audit_events` table (actor/resource IDs, action, timestamp and non-sensitive transition metadata). No invite secrets, session digests, profile snapshots, request bodies or GPS in audit events. RLS and private function-owner access apply; runtime cannot edit/read the table directly. Audit retention is an operational decision, not the photo trash period.

| Proposed API | Rule |
|---|---|
| `GET /api/v1/projects/{id}/members` | O/A management roster; minimal IDs/display names/roles, no emails. Broader roster visibility is not presumed. |
| `POST /api/v1/projects/{id}/members/{userId}/promote-admin` | O only, target an active project member. |
| `POST /api/v1/projects/{id}/members/{userId}/remove-admin` | O only; demote to member without removing project membership. |
| `DELETE /api/v1/projects/{id}/members/{userId}` | Soft revocation: O may remove non-owner participants; A may remove ordinary members, never O/another A. No content/user deletion. |
| `POST /api/v1/projects/{id}/leave` | Self-departure for M/A; owner blocked until a separately approved transfer. Residual trip grants require the decision below. |
| `DELETE /api/v1/trips/{id}/members/{userId}` | O/A revoke explicit guest grant; cannot suppress inherited project access. |
| `POST /api/v1/trips/{id}/leave` | G revokes own explicit grant; M cannot opt out of inherited project access through this route. |
| `POST /api/v1/projects/{id}/archive` | O only; changes lifecycle atomically, preserves all descendants and storage responsibility. |
| `PATCH /api/v1/projects/{id}` | Name/creation policy only if P-02b is resolved or an explicit conservative owner-only policy is approved; no owner/status mass assignment. |

Business roles are data, **not PostgreSQL roles**. No database login is created per collaborator. Permission and target-role checks run after acquiring the project lock; concurrent promotion/removal cannot let A remove a newly promoted A. Voluntary A departure is distinct from appointing/demoting another administrator; clarify the self-departure edge at review if interpreting owner-only removal more broadly.

Archiving hides the project and descendants from normal reads and blocks new content/invitation operations. Existing E1 active-project visibility is preserved. Archive does not delete children, reset quotas or revoke unrelated login sessions. Restore/list-archived management remains deferred under P-01b; no purge or ownership-transfer shortcut is introduced.

**Acceptance/tests:** O promotes/demotes; A cannot promote/self-promote/remove another A or O/archive; M/G cannot manage membership; owner cannot leave/remove own ownership; voluntary M/A departure preserves authored visit rows and creator IDs; removed creators cannot edit retained visits; membership revocation takes effect on subsequent requests; remaining independent grants follow the approved decision; project archive denies all descendant routes and invitation writes while preserving rows; HTTP and direct-RPC tests reject cross-project target IDs. Concurrency tests cover role changes versus removals, removal versus visit write, archive versus create and last-session logout versus mutations. Persist non-sensitive audit entries only for committed changes.

**Dependencies/gates:** E2.1/E2.2 ancestry helpers; P-02b and departure semantics. P-01b restore is deliberately not required to implement the confirmed owner-only archive operation. If archive leaves no self-service restoration yet, document that limitation rather than invent restore rights.

**Rollback:** restore prior dispatcher/helpers and remove E2.3-only functions/policies. Memberships, roles and archive states changed by valid user operations must **not** be reset automatically. Preserve audit data on non-disposable systems; a fresh-database down test may drop its table. Operational rollback generally uses compatible old code plus forward repair.

## 8. E2.4 — Secure invitations and atomic redemption

**Outcome:** O/A can grant membership securely without private-content exposure. Project invitations are required by the latest request; trip-target invitations are proposed here using the same primitive to satisfy the PRD's guest scope. Confirm this resequenced scope at review.

**Proposed paired migration:** `0006_invitations.up/down.sql`.

`invitations`: UUID, issuer FK, unique SHA-256 token digest, nullable target_project_id / target_trip_id with an **exactly-one-target** constraint, server expiry/creation time, redemption actor/time and revocation actor/time. FKs use RESTRICT. Pending/accepted/revoked transitions are constrained; expiry is checked from database time, not a client flag. Index digest, targets and pending expiration as needed. Record redemption/revocation events in the private audit table.

| Proposed API | Rule |
|---|---|
| `POST /api/v1/projects/{id}/invitations` | Current O/A; target is that project or a trip verified to belong to it. Return raw secret once to authenticated issuer, private/no-store. |
| `GET /api/v1/projects/{id}/invitations` | O/A management projections; no raw token or digest. |
| `POST /api/v1/projects/{id}/invitations/{invitationId}/revoke` | Current O/A; only unconsumed links. Scope verified through target ancestry. |
| `POST /api/v1/invitations/redeem` | Authenticated, exact Origin + CSRF; secret in JSON body, never URL/query/header logs. |

Generate at least 256 random bits; retain only the digest. Default expiry is seven days from issuance. Shared links grant ordinary project membership or a trip guest grant, **never administrator status**; owner-only promotion stays a separate action. No email recipient binding is invented: first eligible authenticated redeemer wins, subject to the approved existing-member rule.

One transaction locks/rechecks project, invitation and destination membership; validates session, target state, expiry, revocation and applicable issuer policy; applies/reactivates membership; consumes once; writes an audit event. Any failure rolls back the whole grant. Concurrent calls through different connections cannot grant to two users. A replay cannot restore access after subsequent membership removal. Existing owner/admin roles must never be degraded or elevated by redemption. Proposed reactivation of a formerly revoked admin is as **member**, requiring fresh owner promotion to regain admin rights.

Use one generic INVITATION_INVALID outcome for invented/expired/used/revoked/unavailable links, without target metadata. Anonymous requests fail before revealing link validity. Add database-backed, bounded redemption throttling with no token logging; numeric thresholds and cleanup are technical choices for review, not approved product limits. No external email service, queue or additional cloud resource is needed.

**Acceptance/tests:** O/A issuance and revocation; M/G denial; forged cross-project trip target rejected; raw secret only in issuance response; DB/audit/log captures contain no raw secret; no pre-redemption resource access; seven-day boundary, expired/revoked/unknown cases; two simultaneous redeemers yield at most one new grant; concurrent revoke/redeem, archive/redeem and issuer-demotion/redeem follow the approved order; failure injection leaves neither a consumed-but-ungranted invite nor an unconsumed successful grant. Existing-member retries, owner/admin preservation, revoked-member rejoin and overlapping project/trip permissions are explicit scenarios. Invited G cannot list a project's other trips/maps/roster. All cases use synthetic accounts.

**Dependencies/gates:** E2.3; P-08 and issuer/departure decisions below. Browser invitation landing/deep-link UI is E3: return a token through the API now, but do not add a public token-preview route, put secrets into OAuth state/query strings or modify E1 login. A future share-link fragment/continuation strategy needs frontend review; this API increment does not claim that UI exists.

**Rollback:** disable issuance/redemption actions first and restore E2.3 dispatcher. Do not reverse legitimate memberships established by invitations or make consumed links usable again. Preserve invitation/audit evidence and revoked/used state on populated databases; remove tables only in disposable test rollbacks. Back up schema/data before any approved destructive operation.

## 9. Decisions required at review

These are proposals/gates, not silently adopted product rules. An unresolved subfeature remains denied/deferred while independent work proceeds.

| Question | Source / proposed treatment | Gate |
|---|---|---|
| Can a member who created a trip edit it? | P-03 Option A approved 2026-11-04: O/A-only editing, no permanent creator privilege. Visit rules are unchanged. | Resolved for E2.1. |
| Who changes ordinary project settings? | P-02b; propose owner-only initially; broader admin power needs approval. | E2.3 settings route. |
| Restore project / recover deleted Visit? | P-01b/P-04; restoration rights and Visit period are not decided. | Keep restore/delete/purge outside E2. |
| Already-member redemption and retry? | P-08; propose consume once without changing existing rights; same redeemer retry can acknowledge existing access only while it remains valid, never reinstate a revoked grant. | E2.4 transaction/results contract. |
| What if invitation issuer loses admin/membership before redemption? | Not specified; propose revalidate issuer's current O/A authority. Alternative persistence policy needs explicit approval. | E2.4. |
| Does project leave/removal also revoke explicit trip memberships? | Not specified. There are no deny overrides. Propose revoking all explicit descendant grants for a true project departure; otherwise document that independent guest access survives. Never promise total denial while preserving another active grant. | E2.3 departure/removal with overlapping grants; E2.4 retries. |
| What project context / participant details can G see? | P-09/P-10; propose trip-only data and minimal creator display projection; no project roster/email/statistics. | Guest DTOs; broader views deferred. |
| What is an authoritative Place identity/catalog? | DATA_MODEL §5; proposed controlled independent catalog, canonical country codes, stable UUIDs, source provenance, no name-only merging. Confirm coverage/import policy. | E2.2 real catalog and inline-place resolution. |
| How is exact-location confirmation shared? | Precise consent/projection details remain undefined. Propose city-only default; share confirmed exact points only after explicit consent to current trip collaborators. No silent EXIF-derived sharing. | E2.2 precise-point write/read; null/omitted until approved. |
| Single-day serialization and one-sided filters? | Proposed start=end canonical single date and inclusive open-ended filters above. | E2.2 API shape review. |

P-05 EXIF, P-06 ownership-transfer workflow and P-07 photo movement remain outside this scope. Pending audit retention, project-name/description lengths, rate thresholds and pagination DTO specifics should be documented as technical defaults at implementation review, not invented business permissions.

## 10. Security risks, evidence and release gates

| Risk | Severity | Required mitigation/evidence |
|---|---|---|
| SECURITY DEFINER/helper exposed with caller-selected actor, unsafe search_path or direct table grants | Critical | Fixed settings, no dynamic SQL dispatch, owner-only helpers, unchanged four-function runtime surface, permission catalog assertions and hostile direct-RPC tests. |
| Cross-project ancestry/aggregate leak, or G receiving project scope | Critical | Parent resolution and ACL before query/filter/count/page; guessed IDs/cursors/country filters and overlapping grants tested at HTTP and SQL boundaries. |
| Admin escalation, owner removal or archive by Admin | Critical | Dedicated owner-only operations, target-role recheck under lock, immutable owner fields, no admin-grant invitations. |
| Invitation replay/races or raw secret in request logs | High | Hash-only storage, atomic consumption/grant, generic errors, no public preview/query secret, sanitized log assertions and bounded throttling. |
| Permission check/write race or deadlock | High | Shared project locking protocol, deterministic order, independent connections/failure injection; no stale positive caches. |
| Visit/date/place corruption or precise-coordinate disclosure | High | DATE and SQL constraints, no name-based uniqueness, creator+current-scope check, consent gate and no private values in catalog/audit. |
| Departure/archive accidentally deletes third-party contributions | High | Revocation/state-only mutations, RESTRICT FKs, no content cascade or quota change; retained-row assertions. |
| Migration changes E1 auth or makes runtime role privileged | High | Existing migration files immutable; owner/ACL preflight, paired rollback tests, full E1 regression including logout and private denial. |
| Unbounded geography/map queries or audit/retention growth | Medium | Pagination, independent catalog, scoped indexes and query plans; short beta-scale workloads; review retention without adding paid services. |

For each increment, after approval: lint, strict typecheck, dry-run build, targeted unit tests, real PostgreSQL integration with independent connections, and actual workerd HTTP tests. Run E1 security regression; retain documented Supabase integration results for relevant adapter changes. Do not use production identities or reset the developer's existing database. CI synthetic fixtures remain distinct from real-browser acceptance. A skipped/unavailable runtime test is a blocker or limitation, not a pass.

Migration sequence is additive 0003 → 0004 → 0005 → 0006. Test forward from empty schema **and from an E1 database containing projects/sessions**, failed migration atomicity, latest-down/reapply and full reverse order in a disposable database. Down scripts restore preceding dispatcher definitions and ACLs; no CASCADE over E1/auth schemas, no role/owner reassignment, no modification of 0001/0002 checksums. Export/preserve data before populated-environment changes; prefer forward fixes over destructive downs. Deploying or running migrations outside an explicitly authorized local environment remains a separate approval.

E2 acceptance requires all four agreed increments, documented outcomes for the gated policies, preserved E1 behavior and proof of cross-user isolation at both HTTP and SQL boundaries. Do not call geography globally complete, media supported, or a gated feature finished based solely on synthetic fixtures.

## 11. Outside E2

- E1 authentication redesign, session-duration changes, CSP/CSRF weakening, browser-cookie extraction or a new identity provider.
- Frontend UI/Leaflet integration, invitation landing pages and email delivery (E3/later); no new public content sharing.
- Photo/PhotoAsset, R2/Images, HEIC/HEIF, EXIF, upload idempotency and quota accounting (E4).
- Hard deletion/purge, Visit trash/restore, trip lifecycle restoration, project restore, ownership/quota transfer and account deletion/author anonymization pending their rules and safeguards (later approved lifecycle work).
- Cross-project country/city photo explorer, per-photo geographic identity, moving photos between visits, real-time collaboration, payments, microservices, PostGIS or paid geocoding infrastructure.
- Hosted resources, deployment, billing activation, commit/push or touching existing local service/database data for this planning task.

## 12. Planning validation and next approval

Executed only repository reads, git status/commit inspection and a read-only local catalog transaction selecting table/column/function/RLS/role metadata. Five tables and four executable RPCs matched the E1 foundation; direct runtime table access and elevated role flags were false. No account data or secrets were printed. No dependency installation, build, application test rerun, migration or service restart was performed. Document links/scope checks validate this artifact only.

**Review requested:** confirm the E2.1–E2.4 sequence and collaboration resequencing; resolve or explicitly defer the gates in §9. Only after approval should implementation begin, starting with E2.1. Approval of this proposal is not authorization to change E1 authentication or deploy services.
