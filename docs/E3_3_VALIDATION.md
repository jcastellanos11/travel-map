# E3.3 — Places and Visits frontend integration

Date: 2026-11-07. Starting commit: `cd4f853` (committed E3.2).

**Status:** implementation and automated local validation complete; real browser
creation/editing/Guest acceptance remains manual. No E3.4 or E4 implementation.
The only pre-existing working-tree change was `backend/supabase/config.toml`,
which was preserved. No commit/push, install, deployment, cloud resources or
persistent domain mutations were performed.

## Implementation and navigation

The existing map-first application now includes `TripVisits` within an authorized
Trip: bounded/paginated list, explicit New Visit action, Place search/selection,
nullable name, all three date modes, selected Visit details and edit form.
Empty/loading/error/saved states use semantic controls and announcements. Forms
are inline, labelled and keyboard accessible, with associated validation feedback;
no modal, dashboard, map redesign, invented markers or photo projections.

Visit selection deliberately remains **in memory inside the existing Trip URL**,
`/app/trips/{tripId}`. There is no new Visit route, nested Project dependency,
hash routing or hosting rewrite. Details may be fetched only for a Visit ID in
the current Trip's loaded list. A known foreign ID causes no detail request.
Returned list/detail/write DTOs are also checked against the captured Trip and
Place identity before publication. Visit pagination uses stable Visit IDs, never
merges repeated Places, and does not scan unbounded pages to resolve an ID.

Browser refresh/Back/Forward retain E3.2's Trip navigation and revalidate access;
Visit selection/editor/search clear and the Trip Visit list reloads. After a
successful creation, the first Trip page refreshes and the server-acknowledged
Visit appears in details. Because ordering is ascending `(createdAt,id)`, a newly
created row may be beyond page one; use **Load more Visits** to reach it. No totals
are inferred and no unbounded fetch is used to force the new row into page one.

## Authoritative contracts

Reviewed PRD/model/matrix/API and implementation plans, E3.1/E3.2 reports, OpenAPI,
`geography/routes.ts`, `geography/validation.ts` and the SQL `geography_action`
authorization/DTO behavior. Current implemented contract supersedes earlier
inline-place/description/DELETE examples. No requirements were silently changed.

| Endpoint | Consumed shape/behavior |
| --- | --- |
| GET `/api/v1/places` | Required uppercase alpha-3 `countryCode`, optional literal `query` (100 Unicode characters max), `limit=25`, optional opaque `cursor`; `{items:Place[],nextCursor}` |
| GET `/api/v1/trips/{tripId}/visits` | Authorized Trip list; limit/cursor page of Visit DTOs |
| POST `/api/v1/trips/{tripId}/visits` | Explicit `{placeId,name,date}`; 201 Visit |
| GET `/api/v1/visits/{visitId}` | Selected current-list Visit; 200 Visit |
| PATCH `/api/v1/visits/{visitId}` | Nonempty changed subset of `{placeId,name,date}`; 200 Visit |

Existing E3.2 identity/Project/Trip endpoints remain in use. Generated API contracts
now include VisitCreate and VisitPatch from the **unchanged** OpenAPI source.
No actor, Trip/Project reassignment, ownership, role, lifecycle, description, GPS
or media fields are sent. Requests construct permitted fields explicitly. Empty
edits do not issue PATCH. Changed-field projection avoids resending untouched
fields; there is no new version/ETag/concurrent-edit conflict policy. Simultaneous
changes to the same field retain the backend's current behavior.

Place DTOs retain id/countryCode/countryName/city/region/source/approximateCoordinates/
createdAt. Visit DTOs retain the implemented ancestry/creator/name/status/place/
date/operational timestamp fields. Coordinate and photo fields in existing DTOs
are not used to add GPS, photo UI or markers. Optional Visit **description is not
implemented** by the API; this UI offers only the supported nullable name.

## Controlled catalog and identity

Current coverage is exactly the reviewed six-Place GeoNames snapshot: Bogotá,
Medellín, Ankara, Istanbul and two distinct Springfields (USA region codes IL/MA),
across COL/TUR/USA. See [catalog provenance](../backend/catalog/README.md).
UI country choices and coverage copy reflect this snapshot, not a countries API
or worldwide discovery. Catalog expansion needs separate backend/catalog work.

Only authenticated API results/current verified Visit Place references may supply
a selected stable UUID. City names never become resource identity; homonyms have
distinct radio values/keys and country/region labels, without auto-selection.
Names/query results are not combined with private travel suggestions or counts.
Region is a provider code, not an invented translated region name. Attribution
links identify GeoNames/CC BY 4.0; no external geography request is performed.

Search debounces 250ms, aborts on input changes/closing/scope loss, clears the
previous selection/results when the user changes country/query, and guards late
responses. Place pagination belongs only to its exact country/query. Empty results
and unavailable/invalid catalog queries are explicit; no Place creation, inline
resolver, geocoding or automatic fallback to a guessed city.

Exact Visit coordinates remain disabled. No latitude/longitude, EXIF or consent
UI is provided, and no GPS field enters mutation JSON. Approximate catalog points
are not copied into private Visit coordinates or displayed as markers.

## Calendar dates

The form uses HTML date inputs' **string values**, never valueAsDate, Date,
timestamps, locale parsing or timezone conversion:

- none → `{mode:'none',start:null,end:null}` (ignores stale hidden form boundaries).
- single → identical valid `YYYY-MM-DD` boundaries.
- range → both Gregorian dates, `start <= end`, inclusive, including equal bounds.

Pure validation checks years 0001–9999, leap years/century rules, real month/day
limits and reversed/missing boundaries. Optional blank name becomes null;
nonempty names are trimmed and limited to 200 Unicode code points, no controls
or invalid surrogate characters. UI date labels show canonical strings directly.
Edit comparison checks date values, not JSON property order; PostgreSQL JSONB key
ordering cannot create a false changed-date update. Backend remains final validator.

## Authorization, errors and state isolation

The existing session, same-origin credentials, transient CSRF acquisition,
HttpOnly cookie, Origin/CSP and SQL/RLS boundaries are unchanged. No privileged
key, session secret, CSRF value or private DTO is persisted/logged.

Any authorized Trip collaborator, including an explicit Guest, can request Visit
creation. Creator identity derives exclusively from the server session. Editing
requires current access plus creator or Project Owner/Admin authority in SQL.
The Visit DTO has no effective Admin/canEdit field: creator-specific wording uses
the returned creator ID, and other viewers see **Edit Visit (Owner/Admin only)**
with an explicit server-permission explanation. No role is fabricated, cached
from a Project or discovered through a roster/parent probe. Other Members/Guests
may receive a safe 403 when they explicitly attempt a save; no new capability API.

The app never needs Project details/sibling Trips/rosters/maps to operate this
Trip workspace. Each asynchronous list/detail/search/mutation captures its Trip,
session generation and AbortSignal. Scope changes cancel requests and discard
selection, catalog, forms and pending state. Late results cannot replace a newer
Trip/account even if an underlying transport ignores cancellation.

- 401 clears all private application state and selection using E3.2's session-loss
  behavior. No successful logout is claimed by a network failure.
- 403/404 Visit resource failures clear the affected Trip workspace and provide
  safe recovery, not hidden-resource metadata or raw server messages.
- Network and 503 failures have distinct safe wording, hide private presentation
  and offer access revalidation; they do not masquerade as expired authentication.
- Validation/conflict/rate-limit responses remain explicit, recoverable feedback;
  there are no automatic mutation retries. Cancellation cannot undo an already
  committed write; recheck the list before intentionally retrying an uncertain save.

## Automated evidence

Node 24.21.0/npm 11.19.0, no new dependencies or lockfile changes. Synthetic fetch
fixtures exercise the real typed client, request projection, controller and React
server-rendered views. These are not full browser DOM-event or SQL authorization
tests. Existing backend tests remain the relevant regression evidence; no new
backend behavior or database migration was necessary.

| Exact command | Actual result |
| --- | --- |
| `npm --prefix frontend run lint` | Passed |
| `npm --prefix frontend run typecheck` | Passed (including strict API/private/tests) |
| `npm --prefix frontend test` | 92 passed, 0 failed/skipped; 20 E3.1 + 33 E3.2 + 31 Visit/catalog + 8 calendar tests; includes OpenAPI drift check |
| `npm --prefix frontend run test:build` | Production and integration builds passed; 3 import-graph/build isolation tests passed, 0 failed/skipped |
| From frontend: `TZ=UTC node --test .local/tests/tests/calendar.test.js` | 8 passed, 0 failed/skipped |
| From frontend: `TZ=Europe/Istanbul node --test .local/tests/tests/calendar.test.js` | 8 passed, 0 failed/skipped |
| From frontend: `TZ=America/Bogota node --test .local/tests/tests/calendar.test.js` | 8 passed, 0 failed/skipped (negative UTC offset) |
| From backend: `WRANGLER_LOG_PATH=.local/e33-check.log WRANGLER_SEND_METRICS=false npm run check` | Lint/typecheck/dry-run build; 40 backend regression tests passed, 0 failed/skipped |
| `node backend/scripts/frontend-dev.ts --prepare-only` | Built/prepared existing local assets; no new server started |
| `git diff --check` | Passed |

Coverage includes Place success/empty/invalid/unsupported/pagination/homonyms,
cancelled searches, all date modes, Unicode/Place validation, repeated Visits,
partial/unchanged edits, creator and server-authoritative Admin behavior, Guest
creation request boundaries, 400/401/403/404/409/429/503/network cases, foreign DTO
rejection, late list/detail/search/save responses, Trip refresh/history cleanup,
form labels and no GPS/media/privileged inputs. Rate/error responses are synthetic
handling tests, not a claim of new runtime rate limiting. The calendar reruns are
repeat executions of the same eight tests, not 24 new unique tests.

Existing E3.2 tests received only a fixture for the newly authorized Visit-list GET
and its expected Guest request set. Earlier assertions remain. Build tests inspect
private/demo import graphs, production diagnostic exclusion and fixture/secret/
source-map absence. Demo JS/CSS remains unchanged. Backend's 40 tests include real
workerd, OpenAPI, HTTP/session/security guards and migration-byte integrity.
PostgreSQL/Supabase integration suites were not rerun: backend/auth/SQL is unchanged.
Their earlier results are not counted here. Wrangler builds are dry-run only.

An initial typecheck caught the deliberately crafted forbidden-GPS test object
being rejected by the generated DTO type; the malicious fixture now explicitly
simulates an untyped caller. No production type was relaxed. Review also added a
JSON-key-order-independent date comparison and unchanged-edit regression.

## Browser acceptance and startup

Use the existing same-origin launcher; do not start a second Worker on 8789:

```sh
npm --prefix backend run dev:frontend
```

Open **https://127.0.0.1:8789/app**. In this run the existing local Worker was
reused and its ignored static assets prepared; no credentials, services, networking
or hosting configuration changed. E3.3 browser interaction remains **unverified**:
a read-only browser handoff was requested while the browser was in use elsewhere.
No real Visit creation, edit, Guest mutation, credential entry, cookie extraction
or logout was performed. E3.2 historical browser results are not E3.3 evidence.
No E3.3 browser QA score is assigned before exercising its actual UI.

Manual acceptance (all writes require your own explicit submit):

1. Sign in through **Continue with Google**. Select an authorized Project/Trip or
   open its existing `/app/trips/{id}` link. Expect the Trip's Visits or honest
   empty state, no Project metadata in a Guest-only entry and no Visit markers.
2. Click **New Visit**. Choose USA and search `Springfield`. Expect two separate
   candidates with IL/MA region codes. Type rapidly/change country and verify old
   results/selection do not remain active. Search a nonexistent locality and expect
   an empty result, not automatic Place creation. COL searches require accents
   where applicable (for example `Bogotá`); search is not transliterated.
3. Select one actual result. Optionally enter a Visit name. Choose **No date** and
   explicitly click **Create Visit**. Expect saved details and refreshed list.
4. Create a separate Visit with **Single date**, for example 2024-02-29. Then one
   with **Date range**, for example 2024-02-29 through 2024-03-01. Verify missing,
   invalid or reversed ranges fail locally before a request. Never enter real GPS.
5. Refresh the Trip URL. Reopen saved Visits from its list; use **Load more Visits**
   if needed. Dates must remain the same calendar days. Repeated Places remain
   separate Visit entries. Selection itself intentionally resets on refresh.
6. Open a Visit you authored with current access. Click **Edit Visit**, change its
   name/date or choose another catalog Place, then explicitly save. Verify refreshed
   list/details. Clear name or select No date to test null clearing. Unchanged save
   should prompt for a change without PATCH. There is no delete/restore action.
7. Switch to another authorized Trip while a list/search is loading; use Back and
   Forward. Old Visits, Place selection and edit forms must not appear under the
   new Trip. A known foreign Visit ID has no direct URL/lookup action here.
8. With a separate **existing** Trip-only Guest account, use only its authorized
   Trip link. Explicitly create a synthetic Visit there. Verify no parent Project,
   siblings, roster or Project map is requested/displayed. Do not create new grants
   automatically for this acceptance; use separately approved collaboration tools.
9. As another Member/Guest, select someone else's Visit. The Owner/Admin-only edit
   explanation must not claim permission. An explicit unauthorized save should get
   safe 403; access loss/hidden IDs should get safe 404 and clear context. Use only
   disposable test content and user-controlled accounts for these checks.
10. Test desktop/mobile panel scrolling, radio selection and date fields with the
    keyboard. E3.2 focus/background access checks conservatively reset unsaved forms;
    return and reopen them after revalidation if needed. Do not disable CSP/CSRF or
    sign out solely for automated QA. Synthetic tests cover expiry/outages.

Leave disposable test Visits for review. No supported deletion/cleanup UI exists;
do not delete persistent rows manually or archive real Projects to clean up.

## Files and remaining boundary

Created:

- `frontend/src/private/visits/PlacePicker.tsx`, `VisitForm.tsx`, `TripVisits.tsx`,
  `forms.ts`, `types.ts`.
- `frontend/tests/calendar.test.ts`, `frontend/tests/visits.test.ts`.
- `docs/E3_3_VALIDATION.md`.

Modified:

- `frontend/src/private/controller.ts`, `AppView.tsx`, `PrivateApp.tsx`, `style.css`.
- `frontend/scripts/generate-api.mjs`, `frontend/src/api/generated.ts`.
- `frontend/package.json`, `frontend/tests/private.test.ts`, `frontend/README.md`.
- `docs/IMPLEMENTATION_PLAN.md`.

Unchanged: E3.1 transport, E3.2 routes/OAuth continuation/session lifecycle,
Leaflet components/map data, public demo, backend handlers/configuration/OpenAPI,
SQL/migrations/permissions, credentials and lockfiles. Supabase config diff predates
this task. No historical validation report was edited.

Before E3.4: finish real-browser acceptance above and review the authorized map
projection/marker adapter separately. It must preserve Trip/Guest boundaries,
bounded pagination and independent Visit identity, including selection of markers
whose Visits may not be in the current list page. No marker integration, private
photos/storage, catalog expansion, capability API or new concurrency policy is
claimed by E3.3. Map remains an empty authorized presentation boundary.
