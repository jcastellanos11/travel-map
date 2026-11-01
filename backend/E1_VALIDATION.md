# E1 — Identity and first real data flow

Date: 2026-11-01. Baseline: `4923247b119c7c5300764cbb0ebf556a04167047`
(committed E0). **Local E1 implementation and automated acceptance pass. Real
Google OAuth/browser acceptance is pending; E1 is not yet fully accepted for live
Google use. E2 has not started.**

Reviewed PRD, DATA_MODEL, AUTHORIZATION_MATRIX, ADR-001, API_CONTRACT,
IMPLEMENTATION_PLAN, backend README and E0_VALIDATION. Decision #40 is followed;
no new platform comparison or PoC was introduced. Work stays under backend/.

## 1. Implemented HTTP surface

| Endpoint | Implemented behavior |
|---|---|
| `GET /health` | Existing public liveness, no provider/database readiness claim. |
| `GET /api/v1/auth/google/start` | Google-only official Supabase SDK initiation; S256 PKCE; 256-bit state; encrypted, HttpOnly browser transaction cookie; durable state digest/expiry and initiation limit. |
| `GET /api/v1/auth/callback` | Validates browser cookie/state, JWE lifetime and one-time SQL consumption; SDK code exchange then live `getUser`; verifies Google identity; syncs user and issues a new opaque session. Success redirects to fixed same-origin `/`, with no credential query parameters. |
| `GET /api/v1/me` | Current active application user, initial storage projection and session-bound CSRF token. No provider tokens or database fields. |
| `POST /api/v1/auth/logout` | Exact Origin + CSRF validation; durable current-session revocation before 204; expires session cookie. |
| `GET /api/v1/projects` | Current owned/active project-membership scope; bounded cursor pagination, default 25/max 100. No unauthorized items/counts. |
| `POST /api/v1/projects` | Strict JSON/body limits; derives owner from authoritative session; permits name and approved trip-creation-policy enum only. Returns 201. |
| `GET /api/v1/projects/{id}` | Same current scope; unknown/foreign/non-visible project returns uniform 404. This small E1 resource read supports direct-ID isolation testing. |

All private responses are `private, no-store` with generated request IDs and
security headers; errors are normalized and redact exceptions/connection details.
No permissive CORS, password-login endpoint, JWT-to-app-session exchange, debug or
PoC harness route exists. UI is untouched. Root `/` is reserved for future
same-origin frontend integration (E3), so this backend alone currently returns
404 there after a successful redirect; inspect `/me` separately.

## 2. Authentication and session design

- Runtime dependencies: official `@supabase/auth-js` **2.118.0** (Node >=22),
  `jose` **6.2.14**, `pg` **8.16.3**. Direct versions and dependency tree locked.
  Wrangler **4.156.0**, compatibility date **2026-10-30**, explicit
  `nodejs_compat`; Node **24.21.0**, npm **11.19.0** on Apple Silicon.
- SDK handles PKCE generation/storage conventions and code exchange; Worker
  receives no Google ID token and does not implement an OIDC protocol itself.
  The upstream Google/OIDC leg belongs to Supabase. Its state/nonce protections
  where applicable require actual configured-provider acceptance; nonce skipping
  is not enabled. The app independently enforces random state/browser binding,
  S256 PKCE and single-use transaction consumption. See [Google integration](https://supabase.com/docs/guides/auth/social-login/auth-google)
  and [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
- Request-scoped SDK storage is in memory. During initiation, only PKCE state is
  sealed into a ten-minute JWE cookie (`dir`/`A256GCM`, issuer/audience/expiry
  constrained). PostgreSQL holds a state digest, not the verifier or raw state.
  Provider access/refresh tokens remain in callback memory, never application
  cookies, database session rows, API responses or browser storage.
- After exchange, live `getUser(access_token)` establishes the provider subject;
  Google provider-controlled metadata, a Google identity and confirmed email are
  required. User-editable metadata supplies only a bounded display name, never
  identity/roles. Email is not the identity key; unique `supabase_auth_user_id`
  maps to a distinct application user. Inactive users are not reactivated by sync.
- App tokens contain 32 cryptographically random bytes; only SHA-256 digests are
  stored. Cookie: `__Host-travel-map-session`, Secure, HttpOnly, Path=/, no Domain,
  SameSite=Lax. New login revokes an existing browser session supplied by cookie;
  independent device sessions remain separate. No logout-all endpoint is added.
- Technical starting policy: **seven-day absolute**, **30-minute sliding idle**
  lifetime, enforced by authoritative database time. It is documented rather than
  silently treated as a product requirement. Each private operation checks the
  current session/account and scope without a positive authorization cache.
- `/me` exposes an HMAC-derived, per-session CSRF token; mutating requests require
  `X-CSRF-Token` and exact configured Origin, and reject cross-site Fetch Metadata.
  Comparisons use `node:crypto` timingSafeEqual. Duplicate session cookies fail
  closed. No session cookie is downgraded for local HTTP; development uses HTTPS.
- Session row locks serialize logout with operations already authorized. After
  logout acknowledgement, subsequent requests fail; in-flight responses and bytes
  already obtained cannot be recalled. DB/provider failures fail closed with
  sanitized dependency errors, never offline-JWT allow fallback.

## 3. SQL, permissions and migrations

`0001_foundation` is unchanged. New paired `0002_identity.up/down.sql` adds:

- Private `oauth_transactions`: digest/ten-minute lifetime, consumed/completed
  markers, rate key and index. Initiation is limited to ten/minute per hashed
  address, plus a 10,000-row guard. Expired entries are cleaned in bounded batches
  on subsequent initiation; this is not an independent scheduled retention job.
- Owner-only RLS policies and SECURITY DEFINER functions `oauth_begin`,
  `oauth_consume`, `login_complete`, `api_call`, all with fixed search_path and UTC
  timezone. Domain SQL is parameterized and filters scope before projection.
- Runtime role receives schema USAGE and EXECUTE on those four functions only.
  It has no direct SELECT/INSERT, CREATE, superuser, role-creation or BYPASSRLS
  permission. PUBLIC execution remains revoked. Migration/function owner is a
  trusted authority, not a runtime credential. Bootstrap functions trust identity
  verification in the Worker: never grant these functions to browser roles or
  expose the schema through public PostgREST.
- Session/account locks, current membership checks, default owner from session,
  and no duplicated owner membership. SQL timestamps are emitted in UTC, including
  pagination values; a Mac configured for Europe/Istanbul no longer breaks cursors.

Migration transactions, advisory locking and paired checksum drift checks remain
in force. E1 rollback removes its functions/policies/OAuth table and preserves E0
users/projects/sessions; reapply restores deny-by-default function grants, which
an operator must grant again. Foundation rollback is destructive and local-only.
No changes to Supabase's managed auth schema are application migrations.

## 4. Actual final validation

Commands run from backend/, except Git scope checks from the repository root.
Wrangler logs use ignored `.local` paths and metrics were disabled. Loopback and
registry access required specific sandbox permission; no restriction was bypassed.

| Command | Actual result |
|---|---|
| `npm run check` with `WRANGLER_LOG_PATH=.local/e1-final-check.log WRANGLER_SEND_METRICS=false` | Exit 0: lint, strict typecheck, dry-run build, **16/16 tests**, no skips. |
| `npm run lint`; `npm run typecheck` after the final integration-test additions | Both exit 0; no remaining ESLint error. |
| `npm run types -- --check` | Exit 0; generated runtime types current. |
| `npm run build` | Exit 0; final calculated bundle **583.84 KiB**, gzip **116.96 KiB**. No upload/deployment. Size is not a cloud CPU/performance measurement. |
| `PG_BIN=<existing PostgreSQL 17 bin> npm run db:local:test`, with local Wrangler log/metrics environment | Exit 0: **23/23 test nodes**: 21 scenarios and two parents, no skips. PostgreSQL **17.11 aarch64**. Worker build occurs first. Fresh cluster stopped and removed. |
| `WRANGLER_LOG_PATH=.local/e1-native-auth-runtime.log WRANGLER_SEND_METRICS=false npm run test:supabase` | Exit 0: **5/5 nodes**: four scenarios plus parent, no skips. Actual local Auth **v2.197.0-r0** and PostgreSQL, including workerd integration. |
| `npm audit --omit=dev --audit-level=high --cache .local/npm-cache` | Exit 0, **0 reported production dependency vulnerabilities** at execution time. Not a development-dependency/history/security certification. |
| `SUPABASE_EXPERIMENTAL_STACK=1 SUPABASE_TELEMETRY_DISABLED=1 ./node_modules/.bin/supabase stack install --runtime native --frozen` | Pinned lock validated; 12 cached service artifacts, zero downloads in this frozen check. CLI **2.122.0**, native runtime experimental. |
| Same environment, `supabase stack stop --stack travel-map-e1-local` | Named E1 stack stopped; no unrelated stack/container/volume cleanup. Local daemon infrastructure may remain independently. |
| `git diff --exit-code -- frontend docs spikes`; `git diff --cached --name-only` | Unchanged frontend/approved docs/PoCs; nothing staged. No commit/push. |

Unit/runtime checks cover secure credentials/cookies, state encryption/tampering/
expiry, Google-only SDK S256 initiation, trusted identity assertions, configuration
and input rejection, unconfigured private denial, normalized errors, ignored
secret paths and bounded artifact-pattern checks.

The SQL suite covers E0 migration regression plus E1 least privilege, user sync,
create/list/get isolation, owner injection, CSRF/Origin denial, membership removal,
DB outage denial, scoped pagination, logout and eight subsequent concurrent reads,
new-login persistence, unknown/expired/idle-expired/revoked sessions, inactive
accounts, callback state/replay races, OAuth expiry/non-Google denial, rate limit,
actual workerd SDK/pg/HTTP flow and reversible E1 migration.

The Supabase suite uses **actual local services**, not a replacement auth server:

1. Creates an administrative synthetic test account and exercises real Auth
   password-token transport/getUser; invalid tokens and email-only identities are
   denied by the application identity guard. Password transport is test setup only.
2. Seeds a synthetic upstream Google identity/result into test-owned Auth records.
   Real Auth verifies S256 and issues tokens; the real adapter calls getUser,
   creates an app session/project and revokes logout.
3. Real Auth rejects a wrong PKCE challenge with no new app session.
4. Repeats real PKCE → session → me → project → logout in actual workerd against
   local Auth and password-authenticated PostgreSQL. A deliberately wrong SQL
   password is rejected with `28P01` before the valid connection is tested.

These cases **do not prove Google authenticated anyone**. Test-only administrative
seeding substitutes precisely for the upstream Google result. No production route
or configuration accepts that shortcut. The separate E1 SQL suite's HTTP provider
fixture is explicitly synthetic transport; its results are not mislabeled as
Supabase or Google verification. Each suite removes its own app databases/roles
and identity/flow fixtures. No actual photographs or personal information is used.

## 5. Failures found and fixed

| Observed failure | Resolution |
|---|---|
| Local timezone emitted non-UTC project cursors; subsequent page rejected. | SQL functions set UTC and cursor validation preserves timestamp precision. Pagination now passes. |
| Workerd test URL was HTTP while configured origin required HTTPS. | Local Wrangler protocol and dev command use HTTPS; Secure cookies retained. |
| Harness automatically followed OAuth redirects, producing fixture 401 instead of observing 302. | Test requests use manual redirects. |
| Callback fetch worked in Node but failed in workerd. | Bind the supplied fetch implementation to globalThis; cross-runtime full flow passes. |
| Remaining ESLint `no-empty` error in status parser. | Documented catch for non-JSON CLI progress; lint now clean. |
| Control-character regex lint violation and strict typing mismatches during implementation. | Validate characters without banned regex; fix explicit fixture types/options. |
| OAuth state test compared protocol payload with JWT registered claims. | Return only validated state/storage/flow ID from the decrypt adapter. |
| Supabase fixture password exceeded its real 72-character maximum. | Shorten synthetic fixture credential; application still has no password route. |
| Manually seeded Auth flow returned 500 due to nullable provider-token fields mapped to strings. | Match installed Auth schema/model with empty synthetic provider-token strings. No production behavior bypass or auth schema alteration. |
| Dependency errors were originally indistinguishable from invalid authorization codes. | Provider unavailability/rate limiting maps to sanitized 503; bad codes remain 400. |

Previous interrupted/failed runs are not counted as passes. Native Supabase logs
and generated keys stay in ignored files; only sanitized results are documented.

## 6. Manual development and Google prerequisites

The [README](README.md) provides tested install/check/start/stop commands. Ordinary
API liveness and private denial work without provider configuration. Full login
requires the following **manual, separately authorized configuration**, not
provisioned by this work:

1. Prepare a new local `travel_map_dev` database and migration owner. Configure
   ignored `.env` using `.env.example`, `LOCAL_DATABASE_ONLY=1` and the actual
   loopback port (E1 Supabase default 57422). Run `npm run db:migrate -- up`.
   Migration CLI intentionally rejects hosted connections; hosted migration setup
   needs separate operational review/authorization.
2. In that application database, a trusted administrator creates a dedicated
   runtime login, prompts for a password, and grants only:

   ```sql
   CREATE ROLE travel_map_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
     NOREPLICATION NOBYPASSRLS NOINHERIT;
   -- In psql, set its password interactively: \password travel_map_api
   GRANT USAGE ON SCHEMA travel_map TO travel_map_api;
   GRANT EXECUTE ON FUNCTION
     travel_map.oauth_begin(text,text),
     travel_map.oauth_consume(text),
     travel_map.login_complete(text,jsonb,text,text),
     travel_map.api_call(text,text,jsonb)
     TO travel_map_api;
   ```

   Never grant membership in the migration-owner role, direct tables, BYPASSRLS,
   or these functions to public/browser roles. The test helper creates isolated
   temporary roles itself; do not reuse those roles for persistent development.
3. Copy `.dev.vars.example` to ignored `.dev.vars.dev`. Set exact HTTPS app origin,
   local Supabase URL, **public/publishable or legacy anon key**, restricted runtime
   database URL and a new 32-byte encryption key. The tests verified the native
   gateway's legacy anon key; no elevated key is required by production code.
   To replace the template key without printing a value:

   ```sh
   node --input-type=module -e 'import fs from "node:fs"; import {randomBytes} from "node:crypto"; const p=".dev.vars.dev"; const s=fs.readFileSync(p,"utf8"); if(!s.includes("REPLACE_WITH_64_HEX_CHARACTERS")) throw Error("Template placeholder missing; preserve existing key"); fs.writeFileSync(p,s.replace("REPLACE_WITH_64_HEX_CHARACTERS",randomBytes(32).toString("hex"))); fs.chmodSync(p,0o600);'
   ```

   Keep all actual values private. Do not copy SECRET_KEY/SERVICE_ROLE_KEY into
   Worker/frontend configuration. They are used only by the local administrative
   test fixture. Restart local Wrangler after changing variables.
4. An owner must explicitly authorize/configure a Google Cloud OAuth web client,
   consent screen/test users and credentials. Register the **Supabase Auth callback**
   as Google's redirect URI, e.g. local `http://127.0.0.1:57421/auth/v1/callback`,
   or the approved hosted project's `https://<project>.supabase.co/auth/v1/callback`.
   Do not register the Worker's callback in its place. A hosted Supabase project is
   not required for local provider testing, but Google configuration still is.
5. Enable Google in the chosen Supabase instance. Local template currently has it
   disabled. Supply its client secret via an ignored environment/secret reference,
   never a literal in tracked config. For live MVP, disable unused identity
   providers/password signup. Do not enable nonce skipping. Set Supabase Site URL
   and narrow redirect allowlist for the exact app callback; local config includes
   the callback prefix to accommodate state/SDK flow-ID query parameters. Verify
   the actual redirect behavior rather than assume the browser leg passed.
6. Trust a local HTTPS certificate in the test browser as needed, keep app/API
   same-origin, then manually exercise start → Google consent → Supabase callback
   → Worker callback → me → create/list project → logout → denied read → fresh
   login/persisted project. Verify Safari/Chrome cookies, Origin/CSRF, cancellation,
   state failure, replay and code/query redaction in all provider/proxy logs.
   No browser, Google account or hosted resource was used in this execution.

## 7. Remaining limits and acceptance status

- **Blocked/pending real Google acceptance:** no Google client/consent configuration,
  real account, actual upstream OIDC validation or browser cookie/callback test.
  Local seeding cannot close this gate. No hosted Supabase project was created.
- **Hosted operations unverified:** TLS/pooler behavior, connection/CPU limits,
  operational migration owner/grants, key rotation and deployed same-origin routing
  need ordinary integration acceptance in an authorized environment. Local timing
  and bundle size are not cloud performance/cost evidence.
- Application sessions are an independent authority. Supabase logout/Google
  revocation does not itself revoke app sessions; app logout does. Provider account
  deletion/ban synchronization beyond login is not implemented. Preserve explicit
  app-account revocation procedures and review lifecycle synchronization before beta.
- Cookie-key replacement invalidates in-flight OAuth transactions; established
  opaque sessions use database state and expire/revoke independently. No key ring,
  session-management UI or optional logout-all route is implemented.
- Initiation throttling is limited, uses the trusted edge connecting-IP header
  (local fallback shares one bucket), and is not a complete production abuse-control
  system. Edge/proxy header provenance and rollout limits need operational review.
- E1 exposes **active** projects only; archive/restore and other unresolved matrix
  actions stay closed until their approved stage. No trip-only guest schema exists
  yet, so no broad project access is inferred from it.
- `/me` storage values are initially zero with 500,000,000-byte quota because uploads
  do not exist. Real accounting is E4; no quota behavior is falsely claimed here.
- No R2/Images, photos, E2 data model, frontend integration, hosted backup, mobile
  performance, billing or deployment work occurred. Production dependency audit
  and artifact patterns are bounded checks, not a comprehensive penetration or
  repository-history secret audit.

**Conclusion:** all independently implementable E1 local functionality is complete
and tested. Real Google OAuth acceptance remains explicitly open; do not call E1
fully accepted for live use or proceed to E2 on the basis of synthetic fixtures.
