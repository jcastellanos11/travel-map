# E3.4 — Authorized map projections and Leaflet integration

## Status and repository baseline

Implemented locally on `main`, starting at `cbe2b29` (`feat(frontend): implement
E3.3 places and visits`). E3.3 was present and committed. The only pre-existing
working-tree change was `backend/supabase/config.toml`; it was preserved and is
not part of this increment. No dependencies were installed or added.

Automated validation on 2026-11-07: **185 tests passed, 0 failed, 0 skipped**
across the four suites below. Authenticated browser acceptance, responsive
360/768/1440 testing and the mobile/4G performance target remain **unverified**.
Implementation and automated validation do not constitute full browser acceptance.

No backend source, OpenAPI contract, authentication, migration, database, OAuth
configuration, deployment or production-hosting configuration was changed.
No login/logout or persistent domain mutations were performed during validation.
E3.5 and E4 were not started.

## Contracts reviewed and consumed

Current `backend/openapi.json`, geography route/validation code and migration
`0004_places_visits.up.sql` were checked against the current frontend API types
and E3.1–E3.3 controller/navigation. PRD, architecture/stack, domain model,
authorization matrix, API contract and implementation plans remain authoritative
for product boundaries. Historical E3.3 instructions to finish browser acceptance
before E3.4 are not evidence that it occurred; this increment was separately
authorized by the current request.

| Existing endpoint | Usage |
| --- | --- |
| `GET /api/v1/projects/{projectId}/map` | Authorized active Project projection; optional `countryCode`, `tripId`, `from`, `to`, `limit`, `cursor`. |
| `GET /api/v1/trips/{tripId}/map` | Authorized single-Trip projection; the same parameters except `tripId`. |
| `GET /api/v1/trips/{tripId}` | Revalidate Trip when following a Project marker; no required parent Project fetch. |
| `GET /api/v1/visits/{visitId}` | Live Visit detail after current Trip/map provenance checks. |

Existing `/me`, Project/Trip lists and E3.3 Visit requests continue through the
unchanged E3.1 same-origin client. No map writes or additional endpoints exist.

Both projections are `{ items: MapMarker[], nextCursor: string | null }`.
The marker contains `visitId`, `tripId`, `place`, `date`, operational `createdAt`
and truthful empty media fields (`photoCount: 0`, `previewPhotoId: null`).
`confirmedCoordinates` is currently null. The projection does **not** supply
Visit names, Trip names, viewer capabilities, total counts or participant data.
The UI does not invent these fields.

## Adapter, markers and bounded loading

- `private/map/model.ts::adaptMarker` decodes the actual generated schema, checks
  calendar consistency and retains stable Visit/Trip/Place IDs. It emits a small
  Leaflet presentation model separate from API DTOs. Only catalog approximate
  coordinates become `[latitude, longitude]`; null coordinates remain unlocated.
  Missing, unpaired, non-finite and out-of-range points fail closed. Exact Visit
  coordinates, media and source/profile fields are omitted from map state.
- `groupVisits` sorts by stable Visit ID and groups positions within 32 projected
  pixels at the current zoom, including world-X wrapping. An actual member's
  catalog point anchors the marker: no invented centroid or offset. Different
  Places and Trips can share a marker without merging Visit identity. Zooming
  recomputes groups. No clustering dependency or geocoder was introduced.
- `AuthorizedMarkers` uses existing Leaflet CircleMarkers/Tooltips, selected
  feedback and neutral **loaded Visits** counts. Clicking any marker reveals an
  individual Visit chooser; it never selects an arbitrary repeated Visit.
- Each request uses the existing API maximum `limit=100`. The initial page is
  bounded; **Load more map Visits** explicitly follows the opaque cursor. There
  is no automatic pagination loop. Pages deduplicate by Visit ID, never Place.
  Counts/group sizes describe loaded rows only; unloaded results are announced.
  Additional explicitly loaded pages accumulate in memory without a new global
  cache. Query cursors are not a database snapshot; Refresh reloads page one.
- Unlocated Visits remain available in **Browse loaded map Visits**, with no
  fabricated pin or camera target. This labelled, keyboard-accessible list is
  also the equivalent interaction for map markers. Chooser/detail focus moves
  after explicit selection. No photos, GPS, demo data or private-media requests
  enter the private marker layer.

## Scope, selection and state isolation

`/app` has a neutral world map and makes no all-Projects projection request.
Project and Trip routes retain the E3.2 History API URLs. A Trip-only Guest uses
their Trip endpoint, Trip map and Trip Visit endpoints, plus the existing global
list of their independently authorized Projects. No parent Project details,
sibling Trips, Project map or roster are requested or fabricated for Guests.

`AppController::openMapVisit` accepts only a Visit in the current loaded map.
For a Trip marker, current Trip map provenance allows live Visit detail even
when the Visit is absent from the E3.3 list page. For a Project marker, a one-use
navigation intent opens the canonical Trip route, rechecks actor/generation and
Trip's Project ancestry, then retrieves the Visit. The live Visit response must
match both ID and Trip. Neither every Visit page nor every map page is fetched
to locate it. If it is outside the newly loaded Trip map page, details remain
available and the map explicitly explains the absent marker. No coordinate is
inferred from detail data. Arbitrary IDs are not accepted as navigation proof;
SQL remains the authority for each request.

Map request keys, AbortControllers and existing session/scope generations reject
stale filter, pagination, navigation and account responses. Scope changes discard
markers, chooser and selection. A confirmed 401 clears private state; map or
detail 403/404 clears the affected scope. Network/503/protocol failures hide
private content and offer recovery without claiming successful logout. 400/429
map errors discard markers and allow retry. Existing error normalization avoids
displaying raw server messages. No DTOs or filters enter persistent storage.

The reusable BaseWorldMap preserves country presentation. Its private layer is
hidden/inert during access checks and pending scope loads. Initial scope framing
uses only actual coordinates; same-account/same-route revalidation and pagination
do not issue a new camera move. Fit, marker/Visit selection and applying filters
are explicit camera actions. Confirmed session/access failures reset the private
camera. Reduced-motion settings are respected for new selection animations.
The public WorldMap, CityMarkers, LocalBoundaries and demo content are unchanged.

## Filters and calendar dates

Compact Apply/Reset controls expose only implemented parameters: uppercase
alpha-3 country code, Project-only Trip selector, independent `from`/`to` bounds.
Trip choices use existing loaded authorized Trip-list pages; additional choices
require **Load more Trips**. No sibling selector appears in a Trip/Guest view.
The controlled catalog remains six Places in COL/TUR/USA; the filter is not a
claim of worldwide catalog coverage. Unknown catalog countries may return 400.

Bounds use `YYYY-MM-DD` strings and the existing calendar validator, including
leap days; invalid/reversed ranges are rejected before a request. SQL applies
inclusive overlap (`end >= from`, `start <= to`). Undated Visits are included
without a date bound and excluded when either bound is active. All filters go
to the server. `matchesProjection` rejects a contradictory response as a whole;
it is not a substitute for server authorization or client-only filtering.
Filters are applied explicitly, are not stored in the URL and reset on session
revalidation/navigation. Local invalid drafts leave previous applied results
visible with an explanation; new valid requests clear previous map results.

## Exact file inventory

Added:

- `frontend/src/private/map/model.ts`
- `frontend/src/private/map/MapControls.tsx`
- `frontend/src/features/map/components/AuthorizedMarkers.tsx`
- `frontend/tests/map.test.ts`
- `docs/E3_4_VALIDATION.md`

Modified:

- `frontend/src/private/controller.ts`
- `frontend/src/private/PrivateApp.tsx`
- `frontend/src/private/AppView.tsx`
- `frontend/src/private/style.css`
- `frontend/src/private/visits/TripVisits.tsx`
- `frontend/src/features/map/components/BaseWorldMap.tsx`
- `frontend/tests/private.test.ts`
- `frontend/tests/visits.test.ts`
- `frontend/package.json` — add map tests to existing command only.
- `frontend/README.md`
- `docs/IMPLEMENTATION_PLAN.md` — separately approved E3.4 boundary.

Pre-existing Supabase configuration changes remain outside this inventory.
Generated/ignored build assets and test logs are not source changes.

## Automated evidence

Commands below are from repository root unless noted. All final commands exited
0. The backend build uses the existing Wrangler **dry-run** command; no deployment
occurred. Tests use synthetic fixtures and disposable local workerd harnesses;
no persistent database was accessed by these suites.

| Command | Actual result |
| --- | --- |
| `npm --prefix frontend run lint` | Pass, no lint errors. |
| `npm --prefix frontend run typecheck` | Pass. |
| `npm --prefix frontend test` | **139 passed, 0 failed, 0 skipped**; includes 47 E3.4 tests and existing E3.1–E3.3 regressions. Generated OpenAPI DTO drift check passes. |
| `npm --prefix frontend run test:build` | Normal production and local integration builds pass; **3 isolation tests passed, 0 failed, 0 skipped**. |
| In `backend/`: `WRANGLER_LOG_PATH=.local/e34-check.log WRANGLER_SEND_METRICS=false npm run check` | Backend lint/typecheck/dry-run build pass; **40 tests passed, 0 failed, 0 skipped**, including OpenAPI validation/route drift and real-workerd HTTP/docs checks. |
| In `backend/`: `WRANGLER_LOG_PATH=.local/e34-asset-check.log WRANGLER_SEND_METRICS=false npm run test:frontend` | Prepares current local assets and dry-run build; **3 real-workerd asset tests passed, 0 failed, 0 skipped**. |
| `git diff --check` | Pass. |

The backend commands were captured in ignored
`backend/.local/e34-regression-results.log` and `e34-asset-results.log`; frontend
test/build logs are under `frontend/.local/e34-*.log`. Initial sandbox runs
rejected loopback listeners (`listen EPERM`): backend check was 38/40, asset suite
0/3. Authorized reruns outside the sandbox produced the passing final counts
above. No security settings were weakened to get tests to pass.

Coverage includes malformed/missing coordinates, latitude/longitude order,
repeated/same-position Visits across Trips, deterministic grouping, map selection
beyond both loaded Visit/map pages, account/navigation changes during selection,
live Visit 403/404, Guest request isolation, supported filters/date overlap,
explicit pagination, stale requests, suspension/logout with synthetic sessions,
unmount, safe errors and accessible React markup. Existing calendar tests cover
UTC, Europe/Istanbul and a negative-offset timezone. SSR/controller tests do not
prove Leaflet rendering, browser focus, layout or actual Back/Forward behavior.

The final synthetic 100-Visit adapter/grouping diagnostic measured **0.66 ms**
in local Node. It excludes network, authentication, geography download, React
rendering and Leaflet. It is **not** evidence for the 100-Visit/four-second target
under a representative mobile/4G browser profile. Production app JS is 63.60 kB
(17.04 kB gzip), plus the shared 372.87 kB chunk (113.05 kB gzip); no production
performance or hosting acceptance is claimed.

Build checks verify separate private/demo import graphs, no bundled synthetic
identities/credentials/source maps and no production local diagnostic. Real
workerd verifies strict app CSP without unsafe-inline/unsafe-eval, private/no-store
HTML, unchanged API JSON CSP and existing API/invite/demo/docs route boundaries.
Default production configuration exposes no app/debug/docs assets. This is HTTP
header evidence, not a browser CSP-console rendering test. PostgreSQL/Supabase
integration suites were not rerun: no backend/schema/auth changes were made.

## Local startup and browser acceptance

Existing local service checks returned HTTP **200** for `/health` and `/app`.
These status-only requests do not prove React rendering or authenticated maps.
The current assets were prepared by `test:frontend`; no existing Worker was
stopped or replaced. Firefox inspection was attempted, but the host reported
that the user was actively interacting with Firefox. No authenticated E3.4 UI
flow, marker rendering, filter interaction or responsive view was verified; no
browser QA score is assigned. Browser acceptance remains pending user handoff.

For a fresh local start, keep the documented Supabase/PostgreSQL services running
and stop an existing port-8789 Worker yourself before starting:

```sh
npm --prefix backend run dev:frontend
```

It builds assets and serves through the unchanged local Worker HTTPS origin,
without Vite HMR/CORS or authentication changes. Open
**https://127.0.0.1:8789/app**. The Google entry/callback and root continuation
remain unchanged. Do not deploy this integration asset directory.

Manual acceptance (use existing data; all map operations below are GET-only):

1. Complete Google login yourself if required. Select an authorized Project with
   existing Visits; verify its markers and loaded-only count. `/app` alone must
   not show demo markers or an all-Projects aggregate.
2. Open a Trip; verify only that Trip's Visits. Refresh its canonical URL.
3. Click a marker, choose an individual Visit and verify the live detail panel.
   Repeat for a marker containing repeated Visits, including Visits from different
   Trips in a Project. Each chooser entry must open its own stable Visit ID.
4. Exercise a Visit absent from the first E3.3 list page, if available. It must
   open without automatically traversing all list pages. When the new Trip map
   page does not include it, expect the explicit missing-marker notice.
5. Apply country and Project-only Trip filters; Reset. Test `from`, `to`, both
   bounds and invalid/reversed dates. Verify inclusive overlap and that an undated
   Visit disappears when either date bound is active.
6. Use **Load more map Visits** when a cursor exists. Verify no duplicate Visit
   entries and truthful loaded counts/groups. Do not infer a global total.
7. Switch Projects/Trips rapidly and use Back/Forward. Old markers/details must
   disappear during revalidation and never replace the new scope. Pan the map;
   unrelated same-route session checks should not force a new camera view.
8. With a separate already-authorized Trip-only Guest account, open its direct
   Trip URL. Verify no parent Project name, sibling markers, Project map/Trip
   filter or management roster. Do not grant access or change memberships for QA
   without explicit user participation.
9. Use **Browse loaded map Visits** by keyboard; verify focus on chooser/detail,
   visible focus and all filter labels/messages. Check 360px, 768px and 1440px
   viewports, panel scrolling, marker visibility and Fit. Check the browser console
   for rendering/CSP errors without copying credentials or sensitive payloads.
10. Open `/demo/`; verify its existing sample map remains independent. Confirm
    existing diagnostic/docs/invitation URLs still work locally. Do not sign the
    real user out or mutate persistent records merely to complete these checks.

If test accounts lack repeated Visits, pagination or Guest access, those browser
cases remain pending until the user supplies approved fixtures. Automated
synthetic tests cover the mechanics but do not replace real browser acceptance.

## Limitations and E3.5 handoff

- Complete the browser matrix above, including real Guest isolation and 4G/100
  Visits measurement, before claiming full E3.4 acceptance.
- Filters/Visit selection remain ephemeral; canonical routes are unchanged.
  Initial Project map waits for the existing authorized Trip-list request.
- Approximate catalog coverage is limited. No new geographic identities or
  coordinates are inferred, and no precise Visit GPS is supported.
- Grouping is intentionally simple and quadratic in loaded marker count. The
  first page is bounded at 100; only explicitly requested further pages accumulate.
  Measure larger real datasets before considering any clustering dependency.
- No cross-Project explorer, media, exact-coordinate sharing, new capabilities,
  backend policy or production hosting was introduced. Review the separately
  approved E3.5 scope after acceptance; do not start it automatically.
