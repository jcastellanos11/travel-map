# E3.5 — Collaboration UX and end-to-end acceptance

Date: 2026-11-08. Branch `main`; baseline `137d57c` (`feat(frontend): implement
E3.4 authorized map projections`). E3.4 was present and committed. The sole initial
working-tree change, `backend/supabase/config.toml`, was preserved, not inspected
for credential values or edited. No dependencies were added.

**Status:** collaboration UI implemented and locally automated-tested. **246 tests
passed, 0 failed, 0 skipped** in the four final suites below. Real-account E2E,
responsive/browser focus/clipboard acceptance and the mobile/4G gate remain pending.
Automatic scoped navigation after redemption is blocked by the unchanged server
landing contract; a separate app destination link provides a manual continuation.
Do not treat this as full browser acceptance or beta readiness.

The user reports E3.4 functional acceptance complete. Its historical report is
unchanged; its earlier pending browser observations are not new E3.5 evidence.

## Implementation and source review

Reviewed the current PRD/ADR, implementation plans, domain/authorization/API docs,
E3.1–E3.4 and E2.3/E2.4 reports, generated DTOs, Worker collaboration/invitation
validators/routes, server landing, migrations 0005/0006, dispatcher, audit rules,
current session/client/controller/navigation and map/Visit cleanup paths.
Implemented routes/OpenAPI supersede older draft examples: no Trip roster, public
invitation inspection, email binding/delivery, role/capability endpoint, ownership
transfer or restoration workflow was inferred from plans.

The compact Project panel provides:

- Explicit management opening, paginated active Project roster, role labels and
  stable user IDs without emails; Owner-only promotion/demotion; permitted removal.
- Project or loaded Trip invitation scope, paginated safe metadata, explicit
  issuance and revocation. Project listing includes descendant Trip invitations.
- A local creation form with a one-time sensitive link, direct-action Copy button,
  clear/close action and a separate canonical app link for after redemption.
- Confirmed Project departure and explicit-Guest Trip departure. The Owner has no
  leave action. Trip views never include Project management or a participant list.
- In managed Trip scope, explicit-grant revocation using a **known, verified user
  UUID**, with validation and confirmation. No Guest directory/profile lookup is
  invented; do not infer this ID from Visit authors or guess identities.

No Project settings/archive/delete/transfer UI, new routes, media, external service,
backend changes, migrations, persistent test mutations, deployment, commit or push.
The E3.4 map adapter/algorithms and E1 authentication/security code are unchanged.

## Implemented endpoint/capability matrix

Paths below are under `/api/v1`. Dedicated action requests use no body (also accepts
`{}` server-side); no role, actor, owner, recipient, expiry or lifecycle fields.
All mutations use the existing transport: current `/me` CSRF, same-origin credentials,
browser-supplied Origin, no automatic retry. SQL resolves the actor and scope.

| Method/path | Permission and request | Success/response |
| --- | --- | --- |
| GET `projects/{P}/members` | Active Project Owner/Admin; `limit`, opaque `cursor` | 200 `{items:[{userId,displayName,role,createdAt}],nextCursor}`; role Owner/Admin/Member, no emails/Guests |
| POST `projects/{P}/members/{U}/promote-admin` | Owner; target active Member | 204; becomes Admin |
| POST `projects/{P}/members/{U}/remove-admin` | Owner; target active Admin | 204; becomes Member |
| DELETE `projects/{P}/members/{U}` | Owner: non-Owner; Admin: ordinary Member | 204; membership and all explicit descendant grants revoked |
| POST `projects/{P}/leave` | Active Member/Admin; Owner forbidden | 204; same descendant revocation, contributions retained |
| DELETE `trips/{T}/members/{U}` | Project Owner/Admin; known target user ID | 204; explicit Guest grant only, inherited access unaffected |
| POST `trips/{T}/leave` | Active explicit Guest without inherited access | 204; own explicit grant revoked |
| GET `projects/{P}/invitations` | Owner/Admin; `limit`, cursor | 200 Invitation page for Project and its Trips |
| GET `trips/{T}/invitations` | Owner/Admin; `limit`, cursor | 200 Invitation page for this Trip |
| POST `projects/{P}/invitations` | Owner/Admin; no body | 201 InvitationIssued; ordinary Member access only |
| POST `trips/{T}/invitations` | Owner/Admin; no body | 201 InvitationIssued; one Trip Guest only |
| POST `projects/{P}/invitations/{I}/revoke` | Owner/Admin within Project ancestry | 204; unused invitation only, not existing membership |
| POST `trips/{T}/invitations/{I}/revoke` | Owner/Admin within Trip ancestry | 204; unused invitation only |
| POST `invitations/redeem` | **Existing server landing**, authenticated explicit POST `{token}` with Origin/CSRF | 200 `{scopeType,scopeId,result:access_granted\|already_has_access}` |

GET `/invite` remains existing context-free server HTML, not a new React route.
The React UI does not implement a second redemption transport. Existing `/me`,
Project/Trip/Visit/map/OAuth/logout requests remain unchanged.

UI lists request `limit=25`; backend default25/max100. Opaque cursors and ascending
creation-time/identity ordering are preserved. Pages load explicitly, deduplicate
by stable user/invitation ID, and never imply a full count or exhaust automatically.
Roster uses userId, not a fabricated membership UUID. Invitation DTO is exactly
`{id,scopeType,scopeId,createdAt,expiresAt,status}`; issuance adds invitationUrl once.

## Roles, permission limits and lifecycle

Project DTO has ownerUserId but **no viewer role/capabilities**. Known Owner facts
drive Owner controls. Other viewers are labelled only as having Project access.
An explicit management request loads a roster for actual management, not an automatic
capability probe. A successful management read is restricted to Owner/Admin by SQL;
non-Owners see only Admin-permitted controls. The viewer's roster role is shown only
if their row is in the loaded page; no extra pages are fetched just to find it.
Ordinary Members attempting to open management get safe server denial.

Direct Trip DTO does not identify Guest versus inherited membership. The Trip view
offers a clearly labelled Guest-only departure **request**, not an invented Guest
role. Inherited users receive server403. Owner/Admin Trip invitations and known-ID
Guest revocation are reached through an independently authorized Project panel and
its loaded Trips. Ownership of another Project never grants these affordances.
There is no Trip participant list, email lookup or author-derived member directory.

Role changes/removal refresh `/me`, Project/list/Trips/map and reopen fresh management
data only for the same verified actor/scope/generation. Departure acknowledgement
immediately discards the old scope before navigating `/app` and revalidating. No
content/creator ID is deleted or reassigned. In-flight mutation cancellation is not
proof of server rollback; refresh authoritative data before any explicit retry.

`collaborationCurrent` binds each panel to actor/Project/form-version/open state;
AbortControllers and request identities reject late reads/issuance/action responses.
Closing or changing scope, background/session revalidation, logout, account replacement
and access failure dispose the panel/form and clear invitation presentation. React
StrictMode setup/cleanup/restart and post-disposal requests are covered by tests.

401 clears all private state.403/404 discard affected Project/Trip/Visits/details/
map/groups/collaboration and navigate safely to `/app`, then reload only independently
authorized Projects. A forbidden administrative operation is **not** reported as
logout or proof that ordinary membership was revoked.400/409/429 show normalized
recoverable errors; network/503/protocol failure hides private state and offers
recovery without claiming server logout or successful departure. No authorization
cache, shared private-response cache, storage, polling or hidden permission probe.

Existing FORCE RLS, restricted role, four RPC functions, session/account→Project→
Trip→invitation→membership locks and append-only transactional audit remain backend
authority. E3.5 adds no grants, RPCs, audit payloads or SQL operations.

## Invitation confidentiality and acceptance

Only server-issued scope/metadata is submitted. Seven days and 256-bit random bearer
secrets/digest storage/single consumption remain backend rules. There is no recipient
email field/check: **the first authenticated holder wins**, even if the sender meant
a different account. Existing-access redemption consumes once while preserving roles;
fresh valid invitations can authorize rejoining as Member/Guest, never Admin.
Expired/revoked/consumed/unknown/invalid-issuer/archived-target redemption shares a safe
generic400; existing issuer-authority gate and account-scoped throttling remain.

`InvitationIssued` is returned only to the immediate form caller. Neither root
Snapshot nor CollaborationState retains invitationUrl. The form validates exact
HTTPS origin, `/invite`, no query/userinfo and a 43-character base64url fragment
before display/copy. Links never enter local/session storage, logs, history state,
analytics or third-party previews. Copy uses Clipboard API only on a direct click;
failure offers manual selection with an aria-live message. The user's clipboard
remains outside app memory; clear copied bearer links when finished.

Close/clear, changing invitation target, management close/reload, scope/account/session
changes and unmount discard the form/URL. Closing pending issuance aborts local work,
warns that the server may have completed, and offers metadata refresh, not an
automatic second invitation. Listing cannot recover URLs/digests; no resend API exists.

The existing `/invite#secret` script immediately replaces history with `/invite`,
keeps token in page memory, opens Google login in a separate noopener/noreferrer tab,
and requires return to the **original tab** for explicit acceptance. No GET mutation,
token in OAuth state/query, external requests or persistent continuation was added.
Refresh loses the secret. CSP remains nonce-only there and strict/self-only in the
private app. Authentication/cookies/PKCE/logout/Origin/CSRF are unchanged.

**Precise frontend-only blocker:** `backend/src/modules/invitations/landing.ts`
displays a generic success/already-access message but ignores returned scope for
navigation. It exposes no React handoff/hook or public inspection endpoint. React
cannot automatically route that document to its granted scope without changing the
backend-owned page or building a parallel invitation flow. Neither is authorized.
The creation form supplies a separate non-secret canonical app link: after acceptance
the recipient returns to `/app` and selects the refreshed Project, or opens that
separately shared `/app/trips/{T}` link. Trip Guest links require no parent Project.
This manual continuation is implemented guidance, **not** automatic scoped navigation.
The original landing also has no pending-submit lock; click Accept once. SQL remains
single-use, but competing page responses may produce confusing status. The consumed
secret remains in that document's memory until close; close after acceptance.

## Files created and modified

Added:

- `frontend/src/private/collaboration/controller.ts`
- `frontend/src/private/collaboration/Collaboration.tsx`
- `frontend/src/private/collaboration/ConfirmationDialog.tsx`
- `frontend/tests/collaboration.test.ts`
- `frontend/tests/invitation-flow.test.mjs`
- `docs/E3_5_VALIDATION.md`

Modified:

- `frontend/scripts/generate-api.mjs` — select existing roster/invitation schemas.
- `frontend/src/api/generated.ts` — generated from unchanged OpenAPI.
- `frontend/src/private/controller.ts` — collaboration lifecycle/guard/departure.
- `frontend/src/private/AppView.tsx`, `PrivateApp.tsx` — scoped UI/actions.
- `frontend/src/private/style.css` — compact rows/forms/native dialog styling.
- `frontend/package.json` — include new tests; no dependency/lockfile changes.
- `frontend/README.md`, `docs/IMPLEMENTATION_PLAN.md` — current scope/instructions.

All E3.1–E3.4 test assertions remain; no historical validation report was rewritten.
Pre-existing Supabase configuration is outside this E3.5 inventory.

## Automated evidence

Final commands, from repository root unless noted:

Installed runtime used: Node24.21.0, npm11.19.0. No tooling was installed or updated.

| Command | Actual result |
| --- | --- |
| `npm --prefix frontend run lint` | Exit0. |
| `npm --prefix frontend run typecheck` | Exit0. |
| `npm --prefix frontend test` | **200 passed,0 failed,0 skipped**:139 existing regressions +50 collaboration tests +11 landing-script simulations. |
| `npm --prefix frontend run api:check` | Pass as the first step of the frontend test command; generated DTOs match unchanged OpenAPI. |
| `npm --prefix frontend run test:build` | Normal production + local integration builds pass; **3 isolation tests passed,0 failed,0 skipped**. |
| In backend: `WRANGLER_LOG_PATH=.local/e35-check.log WRANGLER_SEND_METRICS=false npm run check` | Lint/typecheck/dry-run build pass; **40 unit/contract/workerd tests passed,0 failed,0 skipped**. |
| In backend: `WRANGLER_LOG_PATH=.local/e35-assets.log WRANGLER_SEND_METRICS=false npm run test:frontend` | Final local asset preparation/dry-run build; **3 real-workerd asset tests passed,0 failed,0 skipped**. |
| `git diff --check` | Pass. |

Ignored evidence: `frontend/.local/e35-tests.log`, `e35-build.log` and
`backend/.local/e35-check-results.log`, `e35-assets-results.log` (backend command
stdout redirected there). No real bearer links/credentials were generated for QA.
Initial backend sandbox run was38/40 because two loopback listeners failed EPERM;
authorized rerun outside the sandbox passed40/40. No permission/security broadening.

Implementation iterations caught erasable-TypeScript parameter properties, missing
SSR external-store snapshot and two overbroad privacy assertions. A proposed account
header was removed to preserve E3.2's existing profile-presentation regression.
Final runs pass all original assertions. StrictMode restart, disposed mutation guards,
same-name user identity display and cancelled-issuance uncertainty were reviewed.

Frontend tests use synthetic fetch/DTO/controller/SSR fixtures, including stale roles,
pagination, duplicate submission, known-ID Guest removal, Origin/CSRF transport,
401/403/404/error cleanup, account/history/scope races, retained map provenance,
one-time URL non-retention and storage/logging traps. Landing tests execute the
**existing** server script in a synthetic Node VM DOM/HTTP environment, not a real
browser or SQL transaction. The four invalid-lifecycle labels feed the same generic
response; they do not independently prove database expiration/consumption.

Real workerd validates routes, app/API CSP, no unsafe-inline/eval, no-store and
production docs/assets restrictions. OpenAPI validation/drift and migration checksum
regressions pass. PostgreSQL/Supabase suites were not rerun: backend/domain/Auth and
migrations are unchanged. Existing native concurrency/single-use/audit evidence is
historical E2.3/E2.4 evidence, not a new E3.5 test count.

## Browser evidence and pending performance

Host-managed native Firefox inspection found another active page. Attempting a
separate Travel Map tab was interrupted by the host because the user changed Firefox;
a handoff was requested. No E3.5 authenticated UI, clipboard, confirmation focus,
responsive layout or multi-account flow was exercised. No browser QA score is assigned.
No Google credentials, session cookies or CSRF values were extracted, and no real
account mutations/login/logout were automated.

NFR-01 remains a **pending beta gate**: useful first map view of100 Visits ≤4 seconds
under a documented mobile/4G profile. No representative browser/network/data fixture
was available for that measurement. Local Node timings are not substituted. A later
run must record browser/version,360px viewport, fixed network bandwidth/latency,
CPU throttle or none,100 authorized Visit distribution, cold/warm-cache policy,
start (Project selection)→end (markers and interaction usable), at least5 runs and
each result. Do not claim production or mobile performance from workerd unit tests.

## Local startup and cross-account manual acceptance

Keep the existing Supabase/PostgreSQL and ignored Worker environment configuration.
From repository root, stop an existing8789 Worker yourself before a fresh start:

```sh
npm --prefix backend run dev:frontend
```

Open **https://127.0.0.1:8789/app**. Same-origin HTTPS and existing Google callback
remain unchanged. No Vite/HMR/CORS changes. `/invite`, `/api-docs`, `/openapi.json`,
`/__local/integration/` and `/demo/` remain their existing routes. The asset regression
command prepared the current files; it did not stop/reconfigure existing services.

Use separate browser **profiles**, not merely tabs: A=Owner, B=Member/Admin, C=Guest
if available. The user chooses/logs into the Google accounts themselves. Use only
new, clearly labelled disposable acceptance Projects/Trips created explicitly by
the user. Record safe resource/user IDs and results privately, never bearer links,
cookie/header captures or raw CSRF. None of the following mutations were automated.

### A — Project invitation and ordinary Member

1. A signs in, creates/selects the dedicated acceptance Project and two Trips.
   Do not use valuable existing records. Open **Manage members & invitations**.
2. Choose **Project Member**, open **New invitation**, explicitly create. Privately
   copy the one-time link; note server expiry and its safe invitation ID. Refresh
   metadata to verify no secret is recoverable. Copy the separate app destination
   via its browser link if needed before leaving the creation flow.
3. B opens the bearer link in their own profile. Before Accept, confirm address
   is exactly `/invite` with fragment removed. Google sign-in opens another tab;
   B completes it, then returns to the **original invite tab**, without refresh.
   Confirm the chosen Google account before Accept: there is no recipient-email
   protection or automatic wrong-account rejection. Click Accept **once**.
4. Expect Access granted. Close that invite tab; return to `/app`, Refresh access,
   select the newly accessible Project and both Trips. Verify Visits/maps remain
   scoped. B's management attempt is forbidden safely; ordinary access is not logout.
5. A refreshes roster: B is Member, not Admin. Reopen the consumed link as B;
   Accept must return generic unavailable. A new invitation accepted by an already
   authorized B reports already-access and consumes once without changing role.

### B — Trip-only Guest

6. A selects a Trip scope in Project management and explicitly issues a Trip link.
   Share both the sensitive invitation and its separate non-secret Trip app link.
   C accepts through the same original-tab flow and opens `/app/trips/{T}`.
7. Verify only the authorized Trip, Visits, marker groups/details and filters; no
   parent Project name, sibling navigation/markers, Project map, roster or admin UI.
   Test refresh and Back/Forward. Owning some unrelated Project must not grant
   administration in this Trip. No Trip participant-list request should occur.
8. With only A/B accounts, create a **second disposable Project with two Trips**
   and invite B to just one Trip there. B's Project membership in the first Project
   cannot test Guest isolation there. Never remove valuable access to force a test.

### C — Owner/Admin actions and revocation

9. A selects B's verified roster row, **Appoint Admin**, review name/user ID and
   confirm. Refresh in B's profile. B can manage ordinary Members/invitations but
   sees no Owner promotion/demotion or Owner-removal control. Archive/settings/
   ownership actions are not part of this UI. A can demote B with confirmation.
   A third consenting Member permits testing Admin removal of an ordinary Member.
   To verify an Owner-only role mutation is rejected independently of hidden UI
   controls, B-Admin may use existing local Swagger on the **disposable** Project:
   POST promote-admin for the known test Member ID, leave automatic CSRF unchanged,
   expect403. Do not paste cookies/tokens or execute against valuable participants.
10. On disposable data only, A removes B's Project membership with confirmation.
    All descendant explicit grants must be revoked; contributed Visits retain
    creator attribution. B Refresh access/protected request must fail and clear
    Project/Trip/Visit/details/map/groups/collaboration, including after navigation.
    Do not expect downloaded copies to disappear. Fresh invitations are required
    to deliberately rejoin; consumed links cannot undo removal.
11. For a known Trip Guest, obtain the consenting test user's **user UUID** from
    their existing local Swagger `GET /api/v1/me` (displayed CSRF is redacted).
    Copy only the UUID, never cookie/CSRF values. A/B-Admin selects the managed Trip,
    expands known-ID Guest removal, verifies the UUID with that collaborator and
    confirms. Guest's next protected request must fail and clear private content.
    If that user independently inherits Project access, explicit-grant removal
    must **not** suppress inheritance. No Guest directory is fabricated.
12. Issue an unused invitation, revoke it with confirmation, then try acceptance:
    generic unavailable. A link consumed meanwhile may yield409 on revocation;
    the established membership must remain. Lists omit consumed/revoked/expired
    records. Do not edit production/local database clocks for expiry testing;
    seven-day expiry is a pending real-time browser case or existing isolated SQL
    evidence. Never modify persistent timestamps to force a pass.

### D — Departure, concurrency and accessible layout

13. In B's disposable shared Project, **Leave Project**, review and confirm. Expect
    `/app`, no old markers/Visits, later protected access denied, retained content
    visible to A. Owner has no leave control. In C's explicit Trip, request departure
    and confirm: only that grant is revoked. An inherited user trying Guest-only
    departure gets403 with safe cleanup, not a success or logout claim.
14. Use separate profiles concurrently: while B browses markers/details, A performs
    an explicitly approved test-role/removal action; B revalidates afterward. Rapid
    navigation/Back/Forward/late requests must not restore revoked data. Logout in
    one **disposable test profile** must not sign out another profile/account;
    the existing broadcast channel is profile-local and peers independently `/me`.
    No automatic real-user logout is part of agent validation.
15. At360,768,1440px, use keyboard to open/close management, traverse rows/pages,
    choose scope, validate UUID errors and open confirmation dialogs. Cancel should
    initially receive focus; Tab/Shift+Tab stay in native modal; Escape cancels
    before submission; focus returns to a surviving trigger. Check visible focus,
    no horizontal overflow with long names/URLs, readable roles/status/expiry and
    scrollable panels without blocking map controls. Test Copy success/denial and
    manual selection. Closing/backgrounding must clear the creation URL.
16. Verify `/demo/` remains isolated and all E3.1–E3.4 flows still work. Record
    actual profile, role, scope, result and failures without publishing secrets.

Cleanup: revoke only newly issued pending test invitations; test Members/Guests
may leave their disposable scopes or be explicitly removed by A. Do not archive,
delete, reset or transfer any valuable records. No Project/Trip deletion/restore
UI exists and Owner cannot leave: labelled disposable containers remain until a
separately approved cleanup workflow. Clear privately copied bearer links.

## Remaining decisions and E4 readiness

- Complete real-account, clipboard/modal/responsive and rejected-action acceptance.
  Automated fixtures do not assert real Google/profile behavior.
- Review a separately authorized minimal backend landing improvement for safe
  scoped navigation/pending-submit feedback; E3.5 did not change that page.
- Effective-role/own-membership and Trip participant-discovery DTOs are absent.
  Do not add them or infer roles in this increment. Known-ID Guest revocation is
  intentionally less convenient; no hidden directory or email lookup exists.
- Preserve the mobile/4G100-Visit/four-second gate before beta.
- E4 requires separate approval, private media/quota/idempotency work, HEIC/HEIF and
 20MB validation, derived metadata removal and pending privacy/consent decisions.
  R2/Images/resources/billing remain untouched. E4 and beta readiness are not claimed.
