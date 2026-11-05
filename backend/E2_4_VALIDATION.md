# E2.4 — Invitations and Collaboration

**Current local status:** migration0006 is applied to travel_map_dev;24 grouped
acceptance/security checks passed. See the final persistent-migration and manual
browser procedure sections.

The implementation-phase record below originally validated only disposable DBs.
During that implementation phase, only disposable local databases were used. No persistent data, OAuth configuration,
Docker networking, frontend application, dependencies, deployment, billing, commits
or pushes were changed. Pre-existing supabase/config.toml modification preserved.

## Approved decisions and behavior

P-08/P-09/P-10 Option A were recorded before implementation in authorization matrix,
data model, API contract and E2 plan. Existing effective access is preserved: no
Owner duplication, role downgrade, Admin promotion or duplicate Guest record.
Existing-access redemption returns already_has_access AND consumes the invitation.
Replay always fails, even by the same account and after subsequent membership removal.
Fresh valid redemption explicitly authorizes Member/Guest rejoining; former Admin
rejoins as Member. Trip Guest receives only authorized Trip/content/author IDs, no
Project name/details/maps/settings/rosters or unrelated participants/emails.

Issuer persistence policy remains unspecified: fail closed unless issuer is still
an active account with current Project Owner/Admin authority. This conservative gate
is documented, not a claim that all future issuer-lifecycle policy is resolved.

## File inventory

Created:
- migrations/0006_invitations.up.sql and .down.sql.
- src/modules/invitations/routes.ts, landing.ts, README.md.
- tests/invitations.test.ts, invitations.integration.test.ts.
- E2_4_VALIDATION.md.

Modified:
- src/app.ts: invitation routing and dedicated context-free landing response.
- src/infrastructure/postgres.ts: scoped safe invitation errors (400/429 included).
- package.json: test discovery only; no dependency/lockfile changes.
- scripts/local-postgres.ts: E2.4 tests and disposable max_connections50.
- tests/collaboration.integration.test.ts: pin original five migrations, preserving
  E2.3 tests/guard assertions rather than accidentally testing0006 as0005.
- tests/migration-safety.test.ts: six pairs expected.
- README.md, src/modules/README.md and docs/API_CONTRACT.md, DATA_MODEL.md,
  AUTHORIZATION_MATRIX.md, E2_IMPLEMENTATION_PLAN.md.

0001–0005 are byte-identical to HEAD, checked directly and through immutability tests.
Existing identity/security/provider modules were not modified.

## Endpoints and browser flow

See the implemented contract at the end of docs/API_CONTRACT.md. Under /api/v1:

| Operation | Endpoint | Result |
|---|---|---|
| Issue Project Member | POST projects/{id}/invitations |201, one-time invitationUrl |
| Issue Trip Guest | POST trips/{id}/invitations |201, one-time invitationUrl |
| List active Project/descendant invitations | GET projects/{id}/invitations |200 paginated safe metadata |
| List active Trip invitations | GET trips/{id}/invitations |200 paginated safe metadata |
| Revoke within Project | POST projects/{id}/invitations/{invitationId}/revoke |204 |
| Revoke within Trip | POST trips/{id}/invitations/{invitationId}/revoke |204 |
| Redeem | POST invitations/redeem, exactly {token:string} |200 scopeType/scopeId/result |

Management requires active Owner/Admin. Empty or {} issuance/revocation payloads;
role, expiry override, actor and target mass assignment rejected. Standard cursor
pagination25/default,100/max. Listings include id/scopeType/scopeId/createdAt/
expiresAt/status; no issuer profiles, recipient credentials, token/digest/URL.

GET /invite is a minimal server-owned continuation page with no private inspection.
URL is same-origin /invite#secret. Script immediately replaces history to /invite,
retains secret only in page memory, and sends no third-party requests. Google login
opens an independent tab with noopener/noreferrer; existing OAuth state/PKCE/callback
and HttpOnly cookie remain unchanged. Return to original page and click Accept.
It fetches /me CSRF token and explicitly POSTs same-origin redeem. No GET mutation.
Reload loses the secret: reopen original link. No token in cookies/sessionStorage,
OAuth state, redirect query, API GET URL, server logs or audit. No auto-redemption.

Page has no-store/no-referrer, nonce-only script-src, connect-src self, base-uri none,
form-action none and frame-ancestors none. Existing API CSP default-src none remains
unchanged. This deliberately scoped HTML policy enables only the necessary page
script; there are no framework/assets/third-party dependencies. Clipboard delivery
is manual copying of the issuance URL; no email or application UI integration.

## Schema, SQL boundary and lifecycle

invitations: UUID, exactly-one Project/Trip RESTRICT FK, unique SHA-256 digest,
issuer FK, server UTC creation/expiry (seven days), paired redemption/revocation
actor and timestamp, constraints excluding simultaneous redemption/revocation.
Index by target/time/id and unique digest. No plaintext token column.
invitation_attempts: one counter/window per user;30 redemption attempts/minute,
31st returns429. Counter is account-scoped (across sessions), not keyed by/logging
secret. One row/account bounds cardinality; account lifecycle cleanup is future work.

Both tables ENABLE/FORCE RLS with owner-only policies and no runtime table access.
Private invitation_dto/invitations_action use SECURITY INVOKER, fixed pg_catalog/UTC
and no PUBLIC/runtime EXECUTE. Existing four-function runtime surface preserved.
api_call adds an explicit invitation delegation only. Actor always comes from session.

Session/account locks and account counter precede Project FOR UPDATE, Trip where
applicable, invitation FOR UPDATE, membership rows. Recheck current actor/issuer,
ancestry and expiration under locks. Shared parent protocol serializes membership
removal, archival, issuance/redeem/revoke. A committed removal after redemption wins;
a valid unused fresh invitation can authorize rejoining, consumed links cannot.

Pending invitation is consumed or revoked once; expiry is derived from server time.
Invalid/expired/revoked/consumed/inactive-target/issuer-invalid redemption uses generic
400 INVITATION_INVALID without scope metadata. Management wrong roles403 when
resource visible, hidden404, already consumed/revoked/expired revocation409. No
membership revocation through invitation revocation. Unexpected SQL failures503 with
static responses, domain contention409. No privileged runtime or service-role bypass.

Existing audit action constraints admit invitation_issued/revoked/redeemed; target
Project/Trip is the resource and metadata is empty. No secret/digest/profile/location.
Append-only triggers retained. Domain and audit commit or roll back together.

## Automated evidence

Existing tools: Node24.21.0/npm11.19.0, Wrangler4.156.0, PostgreSQL17.11 ARM64,
Supabase CLI2.122.0. No installation/update. From backend/:

```sh
WRANGLER_LOG_PATH=.local/e24-check.log WRANGLER_SEND_METRICS=false npm run check
PG_BIN=/Users/luffy/.supabase/cache/stack/slim-services/postgres/17.11.0.006-r0/darwin-arm64/fb7594525d712ab85b6da00d4d4854f8d0c9ba26b49b781a5fede0119362e917/bin WRANGLER_LOG_PATH=.local/e24-db.log WRANGLER_SEND_METRICS=false npm run db:local:test
SUPABASE_LOCAL_STATUS_FILE=.local/e24-supabase-start.log WRANGLER_LOG_PATH=.local/e24-supabase-runtime.log WRANGLER_SEND_METRICS=false npm run test:supabase
```

| Check | Final actual result |
|---|---|
| Lint/typecheck |Exit0; rerun after last test additions, no warnings/errors |
| Build |Exit0; wrangler deploy --dry-run --env test --outdir dist,604.23KiB/gzip121.18KiB; no deployment |
| Unit/artifact/workerd |33 passed,0 failed/skipped;591.26ms |
| Real PostgreSQL/HTTP/workerd |125 records passed,0 failed/skipped;2643.33ms |
| Actual local Supabase Auth/PKCE/workerd |5 records passed,0 failed/skipped;1097.36ms |
| Diff/migration bytes |git diff --check passes;0001–0005 equal HEAD |

Total **163 passing Node records =156 leaf tests +7 parents**. PostgreSQL has119
leaf tests: E0 7, E1 14, E2.1 24, E2.2 22, E2.3 32, E2.4 20, plus6 parents.
Supabase has4 leaf tests plus1 parent. Timings exclude startup/build and are not
production/cloud performance estimates.

Test failures resolved: unused copied fixture helper caught by lint/typecheck and
removed. First expanded DB run117/119 records passed; E1 logout child/parent failed
under parallel load with test max_connections25. Raising only disposable-cluster
limit to50 yielded123/123, then125/125 after final migration/role cases were added.
Connection exhaustion is the inferred cause; original E1 behavior/assertions were
not changed. No security safeguard was weakened. No final failed/skipped tests.

Actual native Supabase tests use the pre-existing Google-disabled isolated stack,
not the user's Docker development stack. From .local/e21-supabase:

```sh
umask 077
SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ../../node_modules/.bin/supabase stack start --runtime native --stack travel-map-e21-tests --eager --exclude realtime,storage,functions,studio,analytics,pooler > ../e24-supabase-start.log 2>&1
# Run test:supabase from backend/, then stop only the named stack:
SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ../../node_modules/.bin/supabase stack stop --stack travel-map-e21-tests > ../e24-supabase-stop.log 2>&1
```

Start/stop exited0, raw logs private/ignored and not printed. Actual GoTrue verifies
PKCE/getUser/session integration on latest0006 in a random DB. Only upstream Google
identity result is synthetic, seeded by test admin; no production login bypass.

## Concurrency and failure evidence

Independent transactions hold a successful runtime RPC before commit; a second
HTTP/SQL connection waits, observed as pg_stat_activity wait_event_type Lock:
- First redemption wins; second actor gets400 and no membership.
- Revocation first blocks redemption400; redemption first makes revoke409.
- Redemption then E2.3 removal: removal204, stale token400 and later Trip404.
- Owner demotes issuer: queued redemption400 (conservative current-authority gate).
- Archive first: queued redemption400.

Audit failure injection returns503 and leaves token unconsumed/no new membership.
Tests cover Project inheritance, Trip-only geography/author visibility, Owner/Admin/
Member/Guest existing access, revoked Admin rejoining as Member, token uniqueness,
fixed expiry, digest-only table contents, safe listings, direct crafted RPC fields,
CSRF/Origin/session denial, rate limits, actual workerd issuance and landing CSP.
Tests inspect audit/table data for absent tokens/digests. No server request-body
logging is introduced; hosted platform logging has not been evaluated.

## Migration safety and next authorization

0006 forward applies as an existing non-superuser migration owner to populated E2.3
users/sessions/Projects/Trips/Visits/memberships and an existing audit event. Wrong
owner is refused. Injected missing function after complete up SQL atomically rolls
back new tables/dispatcher/ledger without losing audit history. Down restores exact
E2.3 dispatcher definition/owner/ACL, retains audit/membership effects; reapply passes.
Full six-down/six-up passes on disposable fixtures. A separately generated non-test
name DB refuses down; no persistent DB was touched. Final direct SQL checks retain
FORCE RLS, no runtime table access and exactly four executable RPCs.

Down guard permits only travel_map_test_*; invitation tables/counters removed only
there. Audit old action/scope constraints restored NOT VALID to retain historical
invitation events; new writes obey old constraints. No append-only history deletion
or membership reversal. Persistent rollback requires forward repair preserving evidence.

Before a separately authorized persistent application: verify exact local target,
authorized owner, LOCAL_DATABASE_ONLY=1,0001–0005 history/checksums, only0006 pending,
counts/integrity, private verified backup; then existing db:migrate status/up/status,
security checks and non-destructive acceptance. Never use down on travel_map_dev.

Manual browser acceptance (including real Google in a separate tab, fragment removal,
referrer/history behavior and explicit redemption) remains unverified. Test it after
separately authorized migration using approved synthetic fixtures only. Existing
browser accounts/content were not used. No hosted/deployment/cost claim.

Local backend acceptance criteria are met with the documented conservative issuer
gate and manual browser validation pending. No email, private inspection endpoint,
general participant roster, E2.5, restoration, ownership transfer, media, frontend
application integration or cloud resources were implemented.

## Authorized persistent local migration and acceptance — 2026-11-05

**0006_invitations is applied to existing 127.0.0.1:57422/travel_map_dev.**
This later, explicit user authorization supersedes the implementation-phase pending
status above. Only this validation document was updated in tracked implementation
content for this operation; existing worktree changes and Supabase config preserved.
No real-account membership/content mutations, database reset, destructive down,
permission broadening, service restart, Docker networking change, frontend change,
deployment, commit, push or E2.5 work occurred.

### Verified target, history and backup

- Connected only to127.0.0.1:57422/travel_map_dev. Verified running
  supabase_db_travel-map-e1-local Docker PostgreSQL container, published port and
  connected server address against container network address; no remote target.
- Existing authorized container credentials privately loaded; effective migration
  role travel_map_migrator verified as existing database/table/function owner,
  non-superuser, NOBYPASSRLS, NOINHERIT. Runtime travel_map_api remains separately
  restricted, with no role memberships. No credentials printed or changed.
- LOCAL_DATABASE_ONLY=1 explicitly enforced. Existing runner rejects remote/name/
  query-override targets. Applied0001–0005 checksums matched; six pairs available,
  only0006 pending. Owner/ACL/RLS/helper preflight passed without repairs.
- Private ignored .local/e24-dev-before.json records counts, full-row aggregate
  digests, old schema/RLS/ACL/policy/constraint snapshots, history and RPC bodies.
  Existing11 tables included audit history. No private content or account ID printed.

Full private backup:
`backend/.local/backups/travel_map_dev-pre-0006-2026-11-05T19-24-24.332Z.dump`.
Custom-format pg_dump, **99,965 bytes**, file0600/directory0700, Git-ignore verified
before creation and before application. SHA-256:
`a9e5b8411d922e806d12dd30380e697b23b4a2f71905ccf6707fe0c4179746a5`.
pg_restore --list verified expected schema/table/ledger structure and
pg_restore --file=/dev/null read/decompressed the complete archive successfully.
Size/hash rechecked before up. This is archive readability verification, **not a
restoration test**. Private data stays local/ignored; cluster role passwords are not
included in a database dump. Future restoration needs reviewed role/owner setup.

Commands from backend/, all exited0:

```sh
LOCAL_DATABASE_ONLY=1 node .local/e24-dev.mjs preflight
node .local/e24-dev-backup.mjs
LOCAL_DATABASE_ONLY=1 node .local/e24-dev.mjs apply
LOCAL_DATABASE_ONLY=1 node .local/e24-dev.mjs verify
LOCAL_DATABASE_ONLY=1 node .local/e24-dev-acceptance.mjs
LOCAL_DATABASE_ONLY=1 node .local/e24-dev.mjs verify
```

These ignored private helpers invoke the actual existing npm migration runner,
providing owner credentials only in subprocess environment and setting existing
role through PGOPTIONS:

```sh
npm run db:migrate -- status
npm run db:migrate -- up
npm run db:migrate -- status
```

Up returned exactly `["0006_invitations"]`; final ledger0001–0006, all checksums
matching. No earlier migration reapplied/edited. Existing advisory lock and atomic
migration/ledger transaction retained. No prerequisite/security check failed.

### Preservation and security

| Table | Original count, unchanged after migration and final rollback |
|---|---:|
| users |1|
| projects |3|
| project_memberships |0|
| app_sessions |3|
| oauth_transactions |1|
| trips |3|
| trip_memberships |0|
| country_codes |3|
| places |6|
| visits |3|
| domain_audit_events |0|

All original full-row digests match before/after. New invitations and
invitation_attempts each have0 rows after acceptance. No permanent synthetic data.
Existing schema/security preserved except approved audit action/scope constraint
extensions; old RPC bodies preserved except the explicit invitation dispatch branch.
All13 private tables retain correct owner/FORCE RLS/no runtime table grants. Exactly
four executable runtime RPCs retained. All nine private E2.2–E2.4 helpers retain
owner, SECURITY INVOKER, pg_catalog/UTC; actual forbidden table/helper execution
failed42501. Invitation FK/cross-scope/lifecycle/digest constraints are validated.

### Controlled acceptance:24 grouped checks passed,0 failed

Actual handleRequest routes/validation and SQL RPCs under travel_map_api were used
through the existing transaction-bound repository port. Initial synthetic accounts,
sessions and membership fixtures were seeded under the existing migration owner
inside one transaction. No HTTP login bypass, fake production session mechanism,
real browser cookie extraction or personal user mutation. Entire transaction rolled
back, including synthetic logout, all memberships/content/invitations and audit.

Verified:
- Owner/Admin issuance for Project Member and Trip Guest; exact seven-day expiry.
- Database contains only token digest, never plaintext token.
- Safe paginated listing excludes secret/digest/full link.
- Project redemption grants ordinary Member and inherited access to both Trips.
- Trip redemption grants one Trip only; Project/map/roster/sibling/participant
  endpoints deny404.
- One-time consumption; replay400. Existing Owner/Admin/Member/Guest access preserved
  and acknowledged, while the invitation is consumed; no duplicate Owner or Admin promotion.
- Revocation204 prevents redemption; consumed revoke409 leaves membership intact.
- Transaction-only synthetic expiry causes generic400.
- Consumption and audit roll back together to SAVEPOINT; all audit records exclude
  raw tokens/digests. Final full rollback restores empty new tables and audit baseline.
- Wrong Origin/CSRF403, missing authentication401; synthetic logout revokes immediately.
- Actual live HTTPS /health200, /invite200, unauthenticated /me401,
  incomplete /api/v1/auth/callback400. Landing nonce CSP/no-referrer/history-clearing
  code and Google-start link verified in returned HTML.

Concurrent single-use/revoke/remove/archive/issuer-demotion evidence is retained from
prior isolated E2.4 tests using independent connections and observed lock contention.
Those tests were not unnecessarily repeated against persistent fixtures. The earlier
163 Node records remain the regression-suite evidence;24 grouped checks here are
separate local acceptance evidence, not24 new automated Node test cases.

**Verification boundary:** authenticated handler+PostgreSQL acceptance, anonymous
live workerd route checks. No new authenticated network/browser Google continuation
was performed. Google-start route implementation and page link inspected; a fresh
start request was deliberately not issued because it creates a durable OAuth transaction.
No real-account login/membership changes were made. Self-signed TLS bypass was used
only for loopback HTTPS verification. Live services were reused without restart.

## Manual browser acceptance — user-operated, two Google accounts

This is a procedure to execute, **not a claim that browser tests passed**. Use test
Google accounts A(Owner), B(recipient), plus C(Guest) if available. Use distinct
browser profiles or Firefox containers; tabs within one profile share the same
opaque session and are insufficient to isolate accounts. Confirm /me in each profile
before every set of account-sensitive actions. Do not automate credential entry,
copy cookies/CSRF tokens or export Network HAR containing invitation credentials.

### Preparation and existing interface

1. Open `https://127.0.0.1:8789/health`:200. Open `/invite` without a fragment:
   generic invitation page, no private metadata. Accepting without a token gives a
   safe message and does not grant access.
2. In profileA open `https://127.0.0.1:8789/api/v1/auth/google/start`, choose accountA
   yourself, then open `https://127.0.0.1:8789/__local/api-test/`.
   This existing ignored, loopback-only asset interface provides user/Project/Trip
   operations. Its source/location/isolation is documented in .local/E22_API_TEST.md.
   Do not run fetch from the /me JSON page: its restrictive API CSP is intentional.
3. View user; explicitly create **new** Project named `E24 MANUAL TEST <date>` and
   two Trips (`Invited Trip`, `Sibling Trip`). Record only IDs locally. Never select
   an existing personal Project for these mutations. Data creation happens only
   when you click Create; the agent did not create these real-account fixtures.

Additional read-only readiness check: the existing /__local/api-test/ returned200
with connect-src self CSP. This check is separate from the24 grouped checks above.

No file update is required for the following console procedure. Paste this trusted
helper in DevTools Console **on the existing local API test page** in each profile.
It uses the browser HttpOnly cookie automatically, keeps CSRF local to the function,
and returns sanitized JSON. Issuance shows its one-time bearer link in a copy prompt
instead of printing it to console. Cancel/close the prompt after privately copying
it; do not paste the link into chats, shell commands or logs.

```js
async function tm(path, method = 'GET', body) {
  if (location.origin !== 'https://127.0.0.1:8789'
      || !path.startsWith('/api/v1/')) throw Error('Local API page required');
  const headers = {};
  if (method !== 'GET') {
    const me = await fetch('/api/v1/me', {credentials: 'same-origin'});
    if (!me.ok) return {status: me.status, message: 'Sign in first'};
    const identity = await me.json();
    headers['X-CSRF-Token'] = identity.csrfToken;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method, credentials: 'same-origin', headers,
    ...(body === undefined ? {} : {body: JSON.stringify(body)})
  });
  const data = response.status === 204 ? {} : await response.json();
  if (data.invitationUrl) {
    prompt('Copy this private invitation link once:', data.invitationUrl);
    delete data.invitationUrl;
  }
  delete data.csrfToken;
  return {status: response.status, data};
}
```

Replace P,T,S,I,U below with your new test Project, invited Trip, sibling Trip,
invitation and recipient UUIDs (identifiers are not credentials). Console does not
expand those placeholders automatically; substitute them in each path.

### Project membership and single use

4. OwnerA issues a Project invitation:

```js
await tm('/api/v1/projects/P/invitations', 'POST')
```

Expected201; privately copy prompt link, record safe invitation ID I. GET the same
path lists pending metadata without secret/digest/URL. No membership exists yet.

5. Open that private invitation URL in profileB. Verify address becomes exactly
   `https://127.0.0.1:8789/invite` before clicking Accept. Click Google sign-in in
   that page: a separate tab opens. Select accountB yourself. After OAuth completes,
   return to the **original invitation tab**; do not reload it. Click Accept.
   Expected `Access granted`. The secret stayed in the original tab's memory and
   never entered the Google URL, OAuth state, API GET or referrer.
6. In profileB open the local API test page; View user confirms B. List Projects/
   Trips or use helper calls:

```js
await tm('/api/v1/projects/P')
await tm('/api/v1/trips/T')
await tm('/api/v1/trips/S')
await tm('/api/v1/projects/P/members')
```

Expected200,200,200,403 respectively. OwnerA roster GET members returns200 and B as
ordinary member, never Admin. Preserve Owner/Admin existing roles.
7. Reopen the original consumed link privately in profileB and Accept again:
   safe unavailable/already-used message; no additional membership. For P-08 issue
   a **fresh** Project link as A and accept as B: `already have access` message,
   that fresh link consumed once, existing role unchanged.

### Trip Guest scope

8. If profileC/test accountC is available, OwnerA issues a Trip link:

```js
await tm('/api/v1/trips/T/invitations', 'POST')
```

Redeem in profileC using the same separate-tab Google flow. In C, GET T/Visits/Map
returns200, while siblingS, ProjectP, ProjectP/map, ProjectP/members and T/members
all return404. Project settings PATCH with a valid ordinary field also404. No
participant names/emails/Project name is projected. Visible Visit DTOs may contain
only relevant creator IDs. With no Visits, an empty authorized projection is valid.

With **only two accounts**, B already inherits P and cannot prove Guest isolation
there. OwnerA can explicitly create a second clearly labeled disposable test Project
with two Trips and invite B to one of those Trips only. Repeat the Guest checks in
that separate Project. Do not remove real memberships to force a Guest scenario.

### Revocation, expiry and safe cleanup

9. Issue a fresh link but do not redeem it; OwnerA revokes it:

```js
await tm('/api/v1/projects/P/invitations/I/revoke', 'POST')
```

Expected204; opening/redeeming it as B gives the generic unavailable message. Revoking
consumed I gives409 and does not revoke membership. Expiry lasts seven days; do not
alter real database timestamps. Actual expired-token rejection was verified with
rollback synthetic fixtures above; waiting seven days is optional browser coverage.
10. Cleanup only the recorded disposable test scopes. Unused pending invitations
   can be listed and revoked by A. B leaves only its new test Project:

```js
await tm('/api/v1/projects/P/leave', 'POST')
```

Expected204; later Project/Trip requests404, authored contributions retained. GuestC
(or B in the separate Guest-test Project) leaves only its explicitly invited Trip:

```js
await tm('/api/v1/trips/T/leave', 'POST')
```

Expected204 then Trip404. OwnerA can instead remove only the recorded test participant
using existing E2.3 routes. Do not remove unrelated users or transfer ownership.
11. In each test profile, use the interface Logout; subsequent View user401. Clear
   privately copied bearer links when finished. Do not publish response screenshots
   containing links, tokens, account data or Network request bodies.

**Cleanup limitation:** no Project/Trip deletion API exists and Owner cannot leave.
The dedicated disposable Project/Trips must remain clearly labeled; no automated SQL
cleanup or archival is proposed. Do not archive existing real Projects. A later
separately approved lifecycle/cleanup workflow is needed to remove test containers.

If repeated testing merits buttons, the smallest proposed future UI change is to
add invitation issue/list/revoke and roster controls only to ignored
.local/e22-api-assets, enabled solely by the existing localhost Wrangler --assets
command. It must keep no-store, hash/nonce CSP, same-origin fetch and memory-only
CSRF, with no token logs/production binding. **No such interface modification was
made in this task.** The console procedure needs no deployment or code change.

### Remaining risks and status

Local migration and controlled acceptance passed. Real-browser Google account
selection, popup/continuation, URL-history behavior and account isolation remain for
your explicit participation. Backup has not been test-restored. Existing Docker
all-interface port publication was observed and preserved; connections used loopback.
Issuer-current-authority gate remains conservative pending broader policy review.
No new cloud/resource/performance claim or E2.5 work.
