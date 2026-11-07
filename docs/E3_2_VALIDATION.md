# E3.2 — Authentication and private navigation

Date: 2026-11-07. Starting commit: `fc2b608` (E3.1).

**Status:** implemented and locally automated-tested; real-account creation,
Guest and logout browser acceptance require user participation. No E3.3 work.
The user confirms E3.1 is locally accepted; its historical report still records
the earlier pending browser handoff and was not rewritten as new test evidence.

## Decisions and implementation

- **E3.2-D01:** map-first private entry, compact selector and Trip links, retaining
  the existing palette/Leaflet interaction. Public world geometry only; no demo
  memories, invented visit counts, media or authorized Visit markers.
- **D02:** explicit Project creation (name, tripCreationPolicy) and Trip creation
  (name, optional description), no editing/admin/archive/invitation interfaces.
- **D03:** History API, `/app`, `/app/projects/{uuid}`, `/app/trips/{uuid}`.
  Direct refresh, popstate and controlled invalid-route handling. No hash router.
- **D04:** existing typed client, React state/effects/useSyncExternalStore and
  AbortController. One small controller owned by the mounted private application,
  no global singleton private cache, router/state dependency or new package.

Separate HTML/module entries keep existing App/WorldMap/demo content unchanged.
`BaseWorldMap` composes existing Leaflet/React-Leaflet primitives and public
country geometry, with neutral colors, hover/country framing and zoom controls.
It imports no demo Trip data, private DTOs or photo components. The public map
stays mounted across navigation; session-dependent controls mount only after /me
success. Anonymous/rechecking views make map controls inert. No external geography
provider or private media requests are made by this map.

## Contracts and review findings

Authoritative sources are current OpenAPI plus implemented Worker/SQL behavior.
Earlier plans contain historical examples (inline Places, photo/deletion APIs,
future capabilities) that are not implemented contracts. PRD/audit references to
an unchosen stack/empty backend are historical, superseded by ADR-001/E0–E2.4.

**Capability gap:** Project DTO is id/ownerUserId/name/tripCreationPolicy/status/
createdAt, without viewer role or canCreateTrip. The UI knows Owner and
all_project_members affordances. For admins_only and a non-Owner viewer, it
explains the restriction and lets the server decide on an explicit save. It does
not assume Admin status, probe management rosters or hide the form from real
Admins merely because role is unknown. A Member's denied POST produces safe
feedback. A future minimal capability projection needs separate contract review;
no API/auth policy was changed to obtain it.

Trip DTO exposes only existing authorized Trip fields. Direct Trip navigation
requests /me, the user's own paginated Project list, and that Trip. It never
requests the Trip's parent, siblings, maps, settings, roster or participant list.
The parent Project is not fabricated in the selector or shown from cache. A Guest
can still create their own independent Project like any authenticated user.

Generated types now also include ProjectCreate and TripCreate from OpenAPI.
Form checks enforce trimmed names, Unicode limits/control rules, optional
description and supported policies. Requests explicitly construct allowed fields;
crafted ownership/actor/role/lifecycle/parent properties cannot be mass-assigned.
Backend validation and authorization remain final authority. Pagination is
bounded, deduplicated by stable ID and reauthorized by the server on every page.

Consumed endpoints:

| Method | Path |
| --- | --- |
| GET (browser redirect) | `/api/v1/auth/google/start` |
| GET | `/api/v1/me` |
| POST | `/api/v1/auth/logout` |
| GET, POST | `/api/v1/projects` |
| GET | `/api/v1/projects/{projectId}` |
| GET, POST | `/api/v1/projects/{projectId}/trips` |
| GET | `/api/v1/trips/{tripId}` |

No Visit/Place/map/media/admin/invitation API is consumed by the private shell.

## Same-origin routing and OAuth continuation

From repository root, with the existing local Auth/database and ignored Worker
environment already configured:

```sh
npm --prefix backend run dev:frontend
```

Use **https://127.0.0.1:8789/app**. One Worker at a time; the launcher refuses an
occupied port. It builds assets without HMR/Vite network exposure. In this run the
existing Worker on that same asset directory was reused safely; no services,
Docker networking, credentials or providers were restarted/reconfigured.

The dev launcher copies the private document to root `index.html` and writes only
two internal asset rewrites: `/app → /` and `/app/* → /`, status 200. Browser URL
stays intact. API, OAuth callback, /invite, /api-docs, /openapi.json, /demo/ and
/__local/integration/ retain their handlers. Invalid `/app/...` paths render a
controlled not-found after authentication; invalid API routes remain JSON errors.

The existing callback still sets the same cookies and redirects to `/`. Root's
external frontend module replaces the URL with /app or a validated continuation
before mounting React. On a normal same-tab sign-in click, only a canonical
Project/Trip path and a ten-minute expiry are written to sessionStorage. This is
navigation intent, never proof of authentication. It is consumed/removed once,
rejects external URLs/query/fragment/unknown routes and needs a fresh /me result.
If storage is unavailable, login still works and lands on /app; reopen the desired
deep link. Modified/new-tab sign-in uses the browser's normal link behavior and
may land on /app; the original tab's link remains usable after focus revalidation.
No OAuth state, PKCE, callback validation, session creation or cookie change.

Private documents use self-only script/style/connect, self/data images, no forms,
no frames/base URI, no referrer and private/no-store. Public demo CSP is separate;
private API CSP remains unchanged. No unsafe-inline/eval/CORS exception. Local
assets/compiled tests are ignored. Normal production build has demo index.html
and private app.html, but excludes the diagnostic. Production hosting/deep-link/
root configuration is deliberately **not implemented or claimed verified**.

## Session and privacy lifecycle

- /me establishes the server actor; CSRF is stripped from public user state.
  No cookie access, frontend Supabase SDK, passwords, persistent DTO storage or
  credential logging. Existing same-origin JSON transport handles mutations.
- Navigation and focus/pageshow/visibility recovery revalidate /me and reload
  current authorized data. In-memory DTOs and forms are discarded while checking;
  this conservatively resets unsaved forms on access refresh.
- Confirmed 401 after a verified session clears all data, cancels requests,
  replaces selection with /app and shows sign-in. Initial anonymous deep links
  retain only their URL for login continuation. No permission inferred from URLs.
- Network/503/protocol failures hide private presentation and show recoverable
  access-verification failure, never successful sign-out/expiration. 403/404 clear
  affected context and refresh the selector from the backend.
- Requests have session generations and per-operation AbortControllers. Late
  responses cannot repopulate another scope/account, even if transport ignores
  abort. Unmount aborts requests, clears snapshots and removes listeners.
- Background/pagehide clears private DOM/state (flushSync before BFCache), visible
  recovery revalidates. A same-origin BroadcastChannel carries only an invalidation
  signal after UI logout; peers independently recheck /me. No credentials/IDs/DTOs
  are broadcast. There is no server push/polling claim: out-of-band backend
  revocation is discovered on the next protected request or access revalidation.
- Logout immediately hides presentation but acknowledges sign-out only after
  server 204. Failed logout explicitly says server revocation is unconfirmed and
  offers retry/session recovery. A 401 reports an already-invalid session instead.
  Aborting any mutation cannot undo a committed server operation; no auto retry.

Existing migrations 0001–0006, SQL/RLS/RPC boundary, authentication code, backend
routes and OpenAPI are unchanged. The pre-existing uncommitted Supabase config
change remains untouched. No persistent domain data was created or modified.

## Automated validation

Node 24.21.0/npm 11.19.0; no installs or lockfile changes.

| Command | Actual result |
| --- | --- |
| `npm --prefix frontend run lint` | Passed |
| `npm --prefix frontend run typecheck` | Passed, including strict private/API/test checking |
| `npm --prefix frontend test` | 53 passed, 0 failed/skipped: 20 existing client + 33 private/controller/rendering tests; includes api:check |
| `npm --prefix frontend run test:build` | Both production/integration builds passed; 3 build-isolation tests passed, 0 failed/skipped |
| From backend: `WRANGLER_LOG_PATH=.local/e32-check.log WRANGLER_SEND_METRICS=false npm run check` | Lint/typecheck/dry-run build; 40 regression tests passed, 0 failed/skipped |
| From backend: `WRANGLER_LOG_PATH=.local/e32-asset-check.log WRANGLER_SEND_METRICS=false npm run test:frontend` | Prepare/build; 3 real HTTPS workerd asset tests passed, 0 failed/skipped |
| `git diff --check` | Passed |

Private tests exercise actual generated DTO decoding/API transport with synthetic
responses, controller async races and React server-rendered views. They verify
session/401/503/logout/account changes, scoped cancellation, Project/Trip pagination,
creation/forbidden/validation/mass assignment, Guest request boundaries, History
adapter, continuation validation, form labels/feedback and lifecycle cleanup.
They are **not** browser DOM event/device tests or a claim of full end-to-end OAuth.
Existing TypeScript compiles JSX tests into ignored .local/tests using the existing
compiler/React server renderer; no test framework or DOM dependency was added.

Real workerd tests use no provider/DB credentials or persistent database. They
verify root/app/deep/invalid-app documents, assets/CSP/no-store, API JSON, /invite,
Swagger/spec, diagnostic/demo and default production denial. SQL/Supabase suites
were not rerun: database/auth implementations are unchanged; historical counts
are not reused as current evidence. All backend builds were dry-run only.

Intermediate failures corrected: TypeScript declarations/literal fixtures and one
lint escape; build test assumed /me remained in the diagnostic entry rather than
following its new shared client chunk; app.html rewrite caused a canonicalization
loop; the new harness initially used HTTP, correctly failing HTTPS-only Swagger
expectation. Fixed the rewrite target and harness HTTPS, never weakened CSP or
documentation gating. Sandbox EPERM on isolated listeners was rerun with specific
local-runtime permission; it was not treated as a passing run.

## Browser evidence and manual acceptance

Host-managed native Firefox QA, no installed browser tooling, cookie/profile
imports, credential entry or security-warning bypass. Actual observations:

- `/app` renders the minimal sign-in experience with the exact existing Google
  entry link. No valid session was available at that observation.
- Read-only localhost document check confirmed HTTP 200, strict private CSP,
  private/no-store and no redirect loop. Self-signed TLS exception was limited to
  command-line loopback checking; browser protections unchanged.
- After the user-controlled login handoff, Firefox showed the authenticated shell.
  Existing Project selection, an empty Trip list, switching to another Project,
  opening an existing Trip, direct Trip refresh and browser Back/Forward worked.
  This verifies real GET-based session/data integration; no cookie/CSRF extraction.
- Opening root `/` in a new tab continued to canonical `/app` and the authenticated
  shell using the existing browser cookie. This tests the frontend continuation
  document independently of a complete new OAuth transaction.
- The direct Trip view had no parent heading, sibling list or Trip-creation form.
  This account was not established to be a Trip-only Guest; a separate Guest
  account remains a manual acceptance requirement. Synthetic tests independently
  assert the exact Guest request set and absence of parent context.
- Firefox Responsive Design Mode visually checked the authenticated Trip view at
  committed 360px and 768px widths: map, selector, account controls and bounded
  panel fit without visible horizontal content overflow. Expanded the Project form
  and verified labels/controls without submitting it. At 1440px the emulated
  viewport exceeded the host display; only a partial desktop screenshot was
  inspected, so full 1440px usability/overflow remains manual verification.
  Responsive mode and its original width were restored afterward. This is Firefox
  emulation, not evidence of Safari/iPhone/Android behavior.
- No real Project/Trip creation or logout was performed by the agent. Full new
  Google-login/deep-link-return and real logout acceptance remain manual; observing
  a valid session does not itself verify every OAuth browser transition.

Browser QA **4/5** for the tested subset: anonymous and authenticated GET navigation,
refresh/history and mobile/tablet layout work; creation, logout, separate Guest,
full desktop and target-device acceptance remain pending. Focus revalidation
conservatively resets open/unsaved forms when returning from browser chrome or
another window; a first click after returning may trigger revalidation before
reopening a form. No production or Safari/iOS/Android claim.

Manual procedure (explicit user actions, use only your disposable test content):

1. Open /app without a valid session (separate browser context if preserving a
   current session). Expect sign-in, no private selector/data. Review any local
   certificate prompt yourself.
2. Click **Continue with Google**, enter credentials yourself. Expect the unchanged
   callback to /, then frontend /app continuation and server-validated shell.
3. Choose an existing authorized Project. Check its Trips and **Load more** where
   applicable. Switch Projects while loading; previous names/Trips must not appear
   under the new selection. Use **Refresh access** for explicit revalidation.
4. Open **New Project**, submit an invalid name and check field feedback. Then
   explicitly create a disposable named Project with the desired creation policy.
   It should be selected, including when beyond the first list page.
5. Open **New Trip**, create a disposable named Trip and optional description.
   Expect its /app/trips/{uuid} URL. No Visits/photos/markers are created.
6. Copy that Trip URL, refresh, then use browser Back/Forward. Open another Project
   using the selector. The URL and authorized context must stay consistent.
7. Start at an authorized Trip URL in an unauthenticated test context, sign in
   normally and verify same-tab return to the Trip (storage-disabled/new-tab login
   may require reopening the URL). Never copy cookies or CSRF values.
8. With a separate account that already has only a Trip grant, open that Trip link.
   Expect only Trip name/description; no parent name/siblings/rosters/maps. Its
   own Project list may be empty. An inaccessible Trip/Project must show a safe
   unavailable state. Create no new invitation or membership for automated QA.
9. At viewport widths 360, 768 and 1440, check keyboard selector, details/forms,
   associated error messages, visible focus and panel scrolling without horizontal
   page overflow. Verify zoom/pan and that no demo or private Visit markers appear.
10. When **you** choose to end the session, click **Sign out**. Expect acknowledged
    sign-out, no private names/forms/selection. Back/Forward/refresh must not restore
    them. GET /api/v1/me should now return 401. Do not simulate failures by disabling
    security protections; automated fixtures cover logout failure/expiry/network.
11. Keep disposable records for review. E3.2 provides no archive/delete cleanup
    interface, so use only separately approved supported cleanup operations later;
    never archive a real Project just for this test.

## File inventory and next boundary

Created: frontend/app.html; frontend/src/private/{main.tsx,PrivateApp.tsx,
AppView.tsx,CreationForms.tsx,controller.ts,navigation.ts,forms.ts,style.css};
frontend/src/features/map/components/BaseWorldMap.tsx; frontend/tests/private.test.ts;
frontend/tsconfig.tests.json; backend/tests/frontend-assets.test.ts;
docs/E3_2_VALIDATION.md.

Modified: frontend/{package.json,vite.config.ts,eslint.config.js,tsconfig.api.json,
README.md,scripts/generate-api.mjs,src/api/generated.ts,tests/build.test.mjs};
backend/{package.json,scripts/frontend-dev.ts,README.md}; docs/IMPLEMENTATION_PLAN.md.
Existing demo App/main/components/static data are unchanged.

Before E3.3: complete manual acceptance, review the next scope separately and
decide whether a minimal server capability DTO is needed for better affordances.
No later increment, Visit form, map-data adapter, media, administration, invitation
rewrite, deployment, provisioning, migration, billing, commit or push was performed.
