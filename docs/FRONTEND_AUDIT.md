# Travel Map Frontend Technical Audit

Audit date: 2026-11-01. Baseline commit: `46b7b4259a50f0d0ac5f3013116103cdab12b995` — `Organizacion de proyecto para iniciacion de backend` (2026-11-01 10:22:31 +0300).

Scope: repository and installed dependency inspection, static data checks, lint, TypeScript checks, and a production bundle written outside the repository. Application source, configuration, manifests, and lockfiles were not changed. This document is the only intended repository change. No dependencies were installed, no deployment commands were run, and no commit or push was performed.

Evidence labels used throughout:

- **Verified**: directly supported by the inspected repository, installed source, or recorded command output. This does not imply browser execution.
- **Inferred**: architectural consequence or likely behavior derived from verified implementation; not reproduced at runtime.
- **Requires validation**: needs browser/device execution, external-service checks, performance measurement, security testing, or a design decision.

Severity: **Critical** = gate before private multi-user release; **High** = significant integration, correctness, or accessibility issue; **Medium** = reliability, maintainability, or usability issue; **Low** = cleanup/documentation issue. Missing MVP functionality is distinguished from an exploitable defect in the current public demo.

## 1. Executive Summary

**Verified.** [PRD.md](PRD.md), version 1.0, was read before application inspection. It approves a private beta with Google Sign-In, projects, trips, visits, private photos, scoped collaboration, quotas, recovery, and assisted administrative processes. It explicitly excludes migration of current sample content: new accounts begin empty. No existing `docs/FRONTEND_AUDIT.md` was present.

**Verified.** The frontend is a compact React/Vite SPA with a minimalist polygon map. Its journal consists of five statically imported records, two country codes, and fifteen publicly served WebP images. The repository has an empty `backend/` directory and no implemented backend, account system, mutation forms, project navigation, or authorization boundary.

**Inferred — High.** The main integration challenge is domain alignment, not replacing an array with a fetch. Current `Trip` means one city-level memory with embedded photos; the approved model makes a trip a collection of independent visits under a project. Selection, markers, counts, dates, and panel presentation must adopt visit identity before multi-trip data can be represented accurately.

**Verified / Inferred — Critical release gate.** Existing asset delivery is public and the app unconditionally mounts its journal. Neither is a privacy boundary. A private release needs server-enforced resource authorization, protected originals/derivatives, session lifecycle handling, and scoped cache disposal. Client-side filtering alone cannot satisfy the PRD.

**Verified.** Lint, both TypeScript configurations, and production bundling pass with installed dependencies. **Requires validation.** Runtime rendering, boundary downloads/CORS, keyboard behavior, mobile operation, and all PRD performance/security acceptance criteria remain untested in this audit.

## 2. Repository Structure

**Verified.** The current structure differs from earlier root-level frontend layouts:

```text
travel-map/
├── .gitignore
├── README.md                      Older demo documentation
├── docs/
│   ├── PRD.md                     Approved product requirements
│   └── FRONTEND_AUDIT.md           This audit
├── backend/                       Empty; no tracked implementation
└── frontend/
    ├── package.json / package-lock.json
    ├── index.html / vite.config.ts
    ├── eslint.config.js
    ├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
    ├── src/
    │   ├── main.tsx / App.tsx
    │   ├── index.css               Active stylesheet, including Leaflet CSS
    │   ├── App.css                 Present but not imported
    │   ├── assets/                 react.svg, vite.svg, hero.png
    │   ├── components/WelcomeModal.tsx
    │   └── features/
    │       ├── map/
    │       │   ├── components/WorldMap.tsx
    │       │   ├── components/LocalBoundaries.tsx
    │       │   ├── components/CityMarkers.tsx
    │       │   ├── components/MapLegend.tsx
    │       │   └── data/localBoundaries.ts
    │       └── trips/
    │           ├── components/CountryMemoriesPanel.tsx
    │           ├── components/PhotoGallery.tsx
    │           ├── data/trips.ts
    │           └── types.ts
    ├── public/
    │   ├── data/countries.geojson
    │   ├── images/{colombia,turkiye}/...
    │   └── favicon.svg / icons.svg
    ├── docs/                      Older roadmap, release notes, screenshots
    ├── node_modules/              Installed, ignored
    └── dist/                      Existing generated output, ignored
```

**Verified.** `git ls-files` and the non-generated file inventory contain no CI workflow, container specification, deployment manifest, test configuration, root npm workspace, root package manifest, or repository `AGENTS.md`. `backend/` is not a functioning service. Commands must currently run from `frontend/`.

**Verified — Low.** Root README links and local setup instructions still assume the old layout: `docs/ROADMAP.md`, `docs/releases/`, screenshot paths, and root-level npm commands. Actual historical documents are under `frontend/docs/`. **Recommendation:** update documentation paths and distinguish the approved PRD from the older exploratory roadmap in a later change; this audit does not edit them.

## 3. Technology Stack

**Verified.** Versions below were compared across `frontend/package.json`, lockfile v3, and installed `node_modules/*/package.json`. Every listed locked version matched the installed version; `npm ls --depth=0` passed.

| Direct dependency | Declared range | Locked / installed | Responsibility |
|---|---|---|---|
| react | `^19.2.8` | 19.3.0 | UI, effects, local state |
| react-dom | `^19.2.8` | 19.3.0 | DOM root and portals |
| leaflet | `^1.9.4` | 1.9.4 | Map engine, geometry, tooltips, camera |
| react-leaflet | `^5.0.0` | 5.0.0 | React map components and context |
| @eslint/js | `^10.0.1` | 10.0.1 | Base lint rules |
| @types/geojson | `^7946.0.16` | 7946.0.16 | Geometry types |
| @types/leaflet | `^1.9.22` | 1.9.22 | Leaflet types |
| @types/node | `^24.13.3` | 24.19.1 | Tooling types |
| @types/react | `^19.2.18` | 19.3.0 | React types |
| @types/react-dom | `^19.2.7` | 19.3.0 | DOM bindings types |
| @vitejs/plugin-react | `^6.1.1` | 6.1.2 | Vite React integration |
| eslint | `^10.10.0` | 10.12.0 | Static linting |
| eslint-plugin-react-hooks | `^7.1.1` | 7.1.1 | Hook rules |
| eslint-plugin-react-refresh | `^0.5.6` | 0.5.7 | Fast-refresh constraints |
| globals | `^17.12.0` | 17.13.0 | Browser global definitions |
| typescript | `~6.0.2` | 6.0.3 | Compile-time checks |
| typescript-eslint | `^8.69.0` | 8.71.1 | TypeScript lint integration |
| vite | `^8.3.0` | 8.3.4 | Dev server and production bundler |

**Verified.** Runtime tools: Node.js `v24.21.0`, npm `11.19.0`. Installed Vite specifies Node `^20.19.0 || >=22.12.0`; installed ESLint specifies `^20.19.0 || ^22.13.0 || >=24`. The current runtime satisfies both. There is no application `engines` declaration or checked-in Node version pin.

**Verified.** Scripts: `dev: vite`, `build: tsc -b && vite build`, `lint: eslint .`, `preview: vite preview`. There is no test or standalone type-check script. Vite enables only the React plugin and uses `base: '/'`; there is no API proxy configuration. Production is a static build, not SSR.

**Verified — Medium.** Browser TypeScript targets ES2023 with DOM APIs, bundler module resolution, React JSX, no emit, and unused-variable checks. Node configuration checks `vite.config.ts`. Neither enables `strict`; both skip library checks. ESLint applies recommended JS/TypeScript, hooks, and refresh rules, with `dist` ignored, but no type-aware project configuration. **Recommendation:** introduce strictness and API response validation incrementally, with an explicit supported browser/runtime matrix.

**Verified / Requires validation.** README names Cloudflare hosting and links a `workers.dev` demo, but no Wrangler configuration, deployment script, headers/CSP configuration, redirect rules, or hosting workflow is tracked. Provider state, deployed revision, live headers, deep-link fallback behavior, and production availability were not checked. A README hosting claim is not deployment verification.

## 4. Application Architecture

**Verified.** Active bootstrap: [frontend/index.html](../frontend/index.html) → module `/src/main.tsx` → `createRoot(document.getElementById('root')!)` → `StrictMode` → [App](../frontend/src/App.tsx). `main.tsx` imports only `index.css`; that stylesheet imports Leaflet CSS. `App` renders `WorldMap` and the unconditional personal `WelcomeModal` as siblings.

```text
App
├── WorldMap
│   ├── MapContainer
│   │   ├── GeoJSON: all countries
│   │   ├── Pane(410) → LocalBoundaries → GeoJSON + status DOM
│   │   └── Pane(420) → CityMarkers → CircleMarker + Tooltip
│   ├── MapLegend
│   └── CountryMemoriesPanel → PhotoGallery → native dialog
└── WelcomeModal
```

**Verified.** Complete application logic inventory:

| File/component | State/hooks and functions | Responsibility |
|---|---|---|
| [WorldMap](../frontend/src/features/map/components/WorldMap.tsx) | `useState` countries/country/trip; `useRef` map; mount `useEffect`; `loadCountries`, `getCountryStyle`, `handleSelectTrip`, `handleBackToCountry`, `handleClose` | Data loading, journal filtering, geographic interaction, page composition |
| [LocalBoundaries component](../frontend/src/features/map/components/LocalBoundaries.tsx) | `useMap`; load-state union; retry counter; abortable `useEffect` | Country subdivision loading, minimal styling, hover/click navigation, attribution/status |
| [localBoundaries data module](../frontend/src/features/map/data/localBoundaries.ts) | `loadLocalBoundaries`, module `Map` cache; `BoundaryMetadata`, exported `LocalBoundaries` interface | Public external-data access and shallow validation |
| [CityMarkers](../frontend/src/features/map/components/CityMarkers.tsx) | Props only; click callback | One circle and permanent label per current record |
| [MapLegend](../frontend/src/features/map/components/MapLegend.tsx) | Props only | Country and story counts |
| [CountryMemoriesPanel](../frontend/src/features/trips/components/CountryMemoriesPanel.tsx) | `useState(collapsed)`; callbacks | Country/selected-memory view, story cards, mobile expansion |
| [PhotoGallery](../frontend/src/features/trips/components/PhotoGallery.tsx) | `useState(activeIndex)`, dialog `useRef`/`useEffect`; `getPhotoUrl`, `navigate`, `handleKeyDown` | Thumbnails, cyclic viewer navigation, dialog synchronization |
| [WelcomeModal](../frontend/src/components/WelcomeModal.tsx) | `useState(isOpen)` | Personal dedication, dismissed until component remount |
| [trips types/data](../frontend/src/features/trips/types.ts) | `Trip`, `Photo`; static array in `data/trips.ts` | Demo domain and content |

**Verified.** There are no custom hooks, contexts/providers, application API client, route definitions, auth adapter, form/validation layer, persistent browser storage, upload service, or shared utility directory. The only extracted network utility is the geographic boundary loader. No state-management library is present; introducing one is not a prerequisite for integration.

**Inferred — High.** `WorldMap` is both geographic renderer and application coordinator, importing trip content directly and owning domain selection. **Recommendation:** introduce a project/trip-aware page coordinator and a typed data-to-map adapter; pass authorized visit view models to rendering components. Keep Leaflet-specific camera/geometry logic separate from identity and domain orchestration.

## 5. Data Flow Analysis

**Verified.** The journal flow is:

1. `features/trips/data/trips.ts` exports a mutable `Trip[]`; `WorldMap` imports it synchronously into the client bundle.
2. Module-level `visitedCountries` derives a `Set` of country codes once from the imported array. It drives country fills and legend country count; `trips.length` drives story count.
3. Country polygon click clears `selectedTrip` and sets `{code, name}`. `countryTrips` filters by country code. An unvisited country still opens the empty panel and attempts local-boundary loading.
4. `CityMarkers` receives all matching country records. Marker click calls `handleSelectTrip(trip)`, stores the entire record object, and flies to its required coordinates at zoom 8.
5. `displayedTrips` contains either all country records or only the matching selected ID. The panel receives it plus back/close callbacks.
6. Panel renders city, title, raw start-date string, description, and nested photos. `endDate` exists in the type but is never displayed or used in filtering.
7. Gallery prefixes every photo path with Vite `BASE_URL`; browser image requests fetch public files. Its viewer reuses the same URL as the thumbnail.
8. Back clears record selection and fits bounds around country records, not the country's full polygon. Close clears both selections and flies to world center `[20, 0]`, zoom 2.

**Verified.** Country selection changes the country GeoJSON key, recreating its layers and event closures. Panel key includes country and selected record ID, so selection changes remount the panel and galleries, resetting collapse, scroll/viewer component state. `LocalBoundaries` is keyed by country and loads independently of journal data. Local polygon click changes only camera bounds; it does not select or filter memories by municipality.

**Inferred — High.** Module-level visited counts, selected object snapshots, and nested immutable-looking demo data will become stale or incorrectly scoped under fetching, editing, deletion, and permission changes. **Recommendation:** derive counts from authorized query results, select stable visit IDs, reconcile selection after refresh/removal, and distinguish empty/loading/error/forbidden states. Do not infer authorization from which country or project is currently selected.

## 6. Existing Domain Models

**Verified.** [types.ts](../frontend/src/features/trips/types.ts) defines only:

```ts
Photo = { id: string; url: string; alt: string }
Trip = {
  id: string; title: string; countryCode: string; countryName: string;
  city: string; coordinates: [number, number]; startDate: string;
  endDate?: string; description: string; photos: Photo[];
}
```

This is a summary of current types, not a proposed schema. Coordinates are passed directly to Leaflet as latitude/longitude, unlike GeoJSON coordinate arrays, which use longitude/latitude.

| PRD concept | Current evidence — Verified | Architectural consequence/recommendation — Inferred |
|---|---|---|
| User | Absent | Introduce session identity, contributor display, and capabilities without trusting client role flags for authorization. |
| Project | Absent | Add authorized project selection and project overview; new accounts start empty. |
| Trip | Current record has a single city, required coordinates/date, and embedded photos | Preserve “trip” for the PRD aggregate; do not equate existing records with future trips in integration contracts. |
| Visit | Absent as a named type; existing record is closest semantically | Give each visit independent identity and parent-trip context; never key or merge by city name alone. |
| Optional place/coordinates | Coordinates required, no place identifier or precision/consent fields | Separate city identity/approximate display location from optional precise location and user consent. |
| Optional day/range/no date | Required start date, optional unvalidated end date | Define date-only semantics and validation; undated visits remain in overview and are excluded when a temporal filter is active. Use interval overlap, not only start-date inclusion. |
| Photo | Public URL and alt only | Add lifecycle, authorship, description, access/variant metadata, and independently retriable upload state at the contract/view-model boundary. |
| Membership/invitation | Absent | Represent project-wide and trip-only access; support expired/revoked/consumed invitation outcomes. |
| Quota/archive/trash | Absent | Add quota and lifecycle states while leaving enforcement/accounting to the server. |

**Verified — Medium.** The data has five distinct record IDs and all referenced photo files exist. IDs are manually authored; the Bogotá ID's year differs from its start-date year, and a record uses the regional name “Meta” in `city`. No geographic accuracy or date correctness was independently verified. **Recommendation:** define durable opaque identifiers and a place-selection/normalization policy; do not migrate these samples into new accounts, per PRD §2.

## 7. React and Leaflet Integration

**Verified.** `MapContainer` establishes Leaflet context and a ref to the map instance. Initial center is `[20, 0]`, zoom 2, minimum 2, maximum 12; built-in zoom buttons are disabled and `worldCopyJump` is enabled. The active application has no raster/tile layer. Countries and subdivisions use flat colors and vector outlines, preserving the minimalist intent.

**Verified.** `WorldMap.loadCountries` fetches `BASE_URL + data/countries.geojson`, checks HTTP status, asserts the JSON as `FeatureCollection`, and aborts on unmount. The local dataset has 177 features and is 838,726 bytes. It reads `ADM0_A3` and `ADMIN`; country styles distinguish unvisited/visited/selected. Imperative `L.Path` hover handlers adjust styles, while country clicks use polygon bounds and 60-pixel symmetric padding with maximum zoom 6.

**Verified.** Pane z-indices separate local geometry (410) from trip markers (420). `CircleMarker` selection alters radius/fill; labels are permanent React-rendered tooltips. `LocalBoundaries` accesses the map through `useMap`; local polygons use white 0.7-pixel outlines, no base fill, subtle hover fill, and click-to-bounds with maximum zoom 11. `bubblingMouseEvents={false}` prevents those clicks bubbling into map events. Its tooltip content is an element populated with `textContent`.

**Verified.** `loadLocalBoundaries(countryCode, signal)`:

- Accepts three uppercase letters and queries the geoBoundaries `current/gbOpen/{code}/ALL/` metadata URL for any selected code, not a fixed country whitelist.
- Prefers the first layer whose canonical label matches municipal/commune/city/township terms; otherwise selects ADM2. It does not fall back to ADM1.
- Downloads simplified GeoJSON; rewrites GitHub `/raw/` URLs to the raw-content host; requires HTTPS.
- Checks collection shape and Polygon/MultiPolygon type names, but not coordinate nesting, finiteness, bounds, metadata source/license field types, or response size.
- Caches up to three successful countries in insertion order. Reads do not refresh order, so this is not LRU. There is no TTL, negative cache, or in-flight deduplication.

**Verified.** The component wraps loading with an abort controller, a 45-second timeout, a disposal guard, loading/ready/empty/error states, a retry button, and source/license disclosure. Country changes unmount the loader; the cache survives in the module. Unlike geographic data, future private queries must not survive logout/access loss indiscriminately.

**Verified / Requires validation — High.** ADM2 is a generic administrative fallback, not a guaranteed city boundary. Natural Earth codes and third-party country coverage may differ, and simplified local coastlines need not align with the world geometry. **Recommendation:** treat this as optional geographic context, independent of visit identity; document country/code mapping, available administrative levels, and unavailable-data behavior. Validate representative countries and cross-origin downloads; do not promise universal municipal coverage from this heuristic.

**Verified / Inferred — Medium.** The status UI is ordinary DOM inside the `Pane` containing `LocalBoundaries`. Installed `react-leaflet/lib/Pane.js` renders children with `createPortal` into a Leaflet pane. Thus the status participates in map-pane positioning/stacking rather than being a normal page overlay; its buttons/links also lack map-event propagation isolation. **Recommendation:** put status/retry/attribution in a page overlay or proper Leaflet control. **Requires validation:** reproduce position drift, clipping, click propagation, and mobile stacking during pan/zoom.

## 8. Photo and Asset Handling

**Verified.** Fifteen WebP files under `frontend/public/images/` total 5,069,786 bytes (~4.83 MiB). They are referenced by relative strings in `trips.ts` and copied as public assets into production output. No upload, conversion, EXIF inspection, processing queue/status, progress, original download control, or deletion/recovery feature exists.

**Verified.** `PhotoGallery.getPhotoUrl(path)` blindly concatenates `BASE_URL` and `path`. With `base: '/'`, current paths resolve to `/images/...`. This does not handle API-provided absolute URLs, signed URLs, or already-prefixed paths correctly. Thumbnail buttons use `loading="lazy"` and CSS 4:3 crops; the full viewer displays the same resource using `object-fit: contain`. There are no responsive image variants, explicit image dimensions, error handlers, expiry refresh, or loading placeholders. Alt text is also used as visible caption; optional description is not a separate concept.

**Inferred — Critical release gate.** Static `public/` assets cannot become private merely by hiding the gallery or adding a login screen. **Recommendation:** private uploads must be delivered through an authorized access mechanism with explicit original/derivative policies, expiry/revocation behavior, and caching rules. Do not embed permanent private storage credentials or original URLs in the bundle. New-account empty state must replace the demo journal in the authenticated product.

**Inferred — High.** A standard `<img src>` does not attach an application-specific bearer authorization header. The media contract must support the chosen protected delivery mechanism or a controlled blob-fetch lifecycle; revoke object URLs when appropriate. Keep asset path resolution separate from remote media URL handling. Handle expired/revoked access by clearing viewer state, rechecking authorization, and obtaining permitted replacements without logging private URLs.

**Verified PRD requirement / Inferred adaptation.** Preserve JPEG/PNG/WebP/HEIC/HEIF acceptance, up to 10 files per operation and initially 20 MB per file, independent file outcomes/progress, processing readiness, quota ownership, safe retries, and EXIF suggestions with confirmation. These need a new upload workflow, not an extension of the existing thumbnail loop alone. Display optimized derivatives stripped of sensitive metadata; originals remain private and separately authorized. Do not silently drop HEIC or EXIF scope because current browsers/gallery code only show WebP.

## 9. Reusable Components

| Component/module | Assessment | Needed changes |
|---|---|---|
| `MapLegend` | **Verified:** already receives counts through props; highly reusable | Restore active styles; supply scoped counts and agreed visit/trip terminology. |
| `PhotoGallery` | **Inferred:** reusable display/viewer foundation | Remote/private URL adapter, variants, readiness/access states, caption separation, stable identity under refresh and removal. |
| `CityMarkers` | **Inferred:** reusable renderer after domain adaptation | Receive visit/location view models; handle optional coordinates, coincident visits and dense labels, keyboard alternatives. |
| `CountryMemoriesPanel` | **Inferred:** reusable sidebar/bottom-sheet shell | Separate visit card presentation from trip context; optional/range dates, capabilities, loading/error states and deliberate state retention. |
| `WorldMap` | **Verified:** valuable Leaflet behavior, tightly coupled to static journal | Extract orchestration/data acquisition; make authorization scope, filters and selection explicit inputs. |
| `LocalBoundaries` / loader | **Inferred:** reusable public geographic context | Move status DOM outside pane; strengthen validation, coverage handling and request/cache controls. |
| `WelcomeModal` | **Verified:** personal dedication, not product onboarding | Retain only for an explicit demo experience or replace with accessible product onboarding; never use it as an auth gate. |
| CSS palette, gallery grid, dialog layout | **Inferred:** reusable visual foundation | Consolidate duplicate rules, activate needed styles, preserve minimal map presentation, verify devices. |

**Verified.** No generic button/form/dialog library or reusable authenticated shell exists. Reuse should preserve the working map and gallery interaction patterns without carrying their demo data assumptions into API contracts.

## 10. Backend Integration Readiness

**Verified.** The frontend has no application API calls today. The only fetches load public geographic data. There is no session bootstrap, server-state cache, resource authorization check, API environment configuration, refresh policy, mutation error model, or persistent routing contract.

**Inferred.** Recommended integration boundaries below are responsibilities and decisions to formalize, not endpoints, database schemas, or a backend stack selection:

| Boundary | Current seam | Contract/design work required |
|---|---|---|
| Identity/session | `main.tsx` / `App.tsx`, before private journal mount | Session bootstrap, Google identity handoff, authenticated/unauthenticated/loading/error states, logout/session expiry, return from invitation/login. Choose credential transport later; enforce identity server-side. |
| Authorized scope | New page coordinator above `WorldMap` | Own project/trip selection, listing only accessible resources, trip-only entry for guests, server-authorized aggregate overview, stable navigation and deep-link errors. |
| Read/query layer | Replace direct `trips.ts` import in `WorldMap` | Typed results/adapters, cancellation, pagination/aggregation, filter semantics, consistent errors and request identifiers without private-data logging. |
| Map view model | `countryTrips`, `displayedTrips`, `visitedCountries`, `CityMarkers` props | Authorized visits with stable IDs; consistent coordinate order and optional-location policy; derived counts; explicit selected visit. Geography stays independent/public. |
| Forms/mutations | No existing seam beyond future page/panel actions | Project/trip/visit editing, validation, pending/error/conflict states, server-confirmed updates and scoped cache invalidation. |
| Media read/access | `PhotoGallery.getPhotoUrl` and `Photo` | Distinct thumbnail/display/original access, expiry/refresh, deleted/processing/failed states and author/admin capabilities. |
| Upload lifecycle | New upload feature associated with a visit | Per-file progress/outcome, operation identity, intentional repeat vs retry, processing status, quota rejection, cancellation and resumable UI state where designed. |
| Collaboration | New membership/invitation surfaces | Project-wide vs trip-only scope, server-confirmed actions, single-use seven-day links, authenticated redemption, expiry/revocation outcomes. |
| Archive/trash/account lifecycle | New management surfaces; panel/gallery invalidation | Thirty-day recoverability, purge/restore states, author quota attribution and assisted procedures with clear user outcomes. |

**Inferred — Critical release gate.** Every project/trip/visit/photo read or mutation, aggregate count, and file request must be authorized by the server. Frontend capabilities are UX hints only. A trip-only guest must not receive other trip data and then rely on the map to hide it. Cache keys must include authenticated identity and resource/filter scope; logout, membership revocation, or resource removal must clear sensitive state and close stale viewers. Handle unauthorized, forbidden, missing, and deleted resources deliberately without leaking their contents.

**Requires validation.** Session transport determines additional controls: cookie-based requests need appropriate CSRF, cookie and origin protections; token-based approaches require a considered storage/exposure strategy. CORS, CSP, redirect handling, invitation URL redaction, and private-image caching require deployment and threat-model decisions. No particular strategy is selected here.

**Verified / Inferred — High.** PRD-required filters, authenticated project overview, repeated city visits, invitations, quota feedback, and mutation flows are absent. Plan them as new integration surfaces. Avoid mapping a future trip ID onto `selectedTrip` unchanged: that variable currently identifies a single map memory.

## 11. Technical Debt and Security Risks

The following findings supplement the domain/privacy release gates above. Severity describes impact in the intended product, not a claim of an exploited vulnerability.

| ID | Classification / severity | Evidence and impact | Actionable recommendation |
|---|---|---|---|
| F01 | **Verified — High** | `main.tsx` imports `index.css`; no source imports `App.css`. Legend positioning/colors, country tooltip styling and legend mobile hiding exist only in `App.css`. | Consolidate active styles deliberately; do not import all starter CSS without reviewing it. Browser-check the legend after repair. |
| F02 | **Verified — Medium** | `index.css` defines panel/header/back styles multiple times, with competing 600/767px rules. Starter `.country-info` and unused `src/assets`/`App.css` material remain. | Consolidate component styles and breakpoints; remove confirmed unused demo assets in an authorized refactor. |
| F03 | **Verified — High** | `WorldMap.loadCountries` handles failure only with `console.error`; JSON gets only a type assertion. No map loading/error/retry view exists. | Add visible request states and runtime geographic validation with safe diagnostics. |
| F04 | **Verified — Medium** | Boundary loader's predicate does not validate all fields asserted by `BoundaryMetadata`; geometry type checks omit coordinates. No size/feature budget exists. | Validate input structures and finite coordinate ranges; constrain download/render cost and retain graceful fallback. |
| F05 | **Verified / Inferred — Medium** | Metadata-selected download URLs are HTTPS but have no host allowlist. Requests disclose public country selection to external services; no application credential is attached. Not evidence of server-side SSRF. | Decide trusted source hosts and CSP/connect policy; never reuse a credential-injecting private API client for arbitrary geometry URLs. Document external service dependence. |
| F06 | **Verified / Inferred — Medium** | Global GeoJSON remounts per country selection; all local polygons render together; each marker has a permanent label; cache is count-bounded, not byte-bounded. | Measure with representative geometry and 100 visits before optimizing; consider targeted layer updates, label density rules, and size-aware geographic caching. |
| F07 | **Verified — High** | `WelcomeModal` has dialog ARIA but no focus trap, initial/return focus, Escape handler or background inertness. It appears every reload. | Use accessible modal behavior and intentional onboarding persistence; test keyboard/screen-reader operation. |
| F08 | **Verified / Inferred — High** | Country/local polygons and circle markers are driven by pointer events; no explicit keyboard activation, accessible feature names, or equivalent visit-selection list action exists. | Provide keyboard-accessible selection/navigation outside the map and appropriate map feature semantics. Verify Leaflet/browser output rather than assuming accessibility. |
| F09 | **Verified — Medium** | Reduced motion is respected by local-boundary navigation and some CSS, but `WorldMap` camera handlers always use animated flights. Gallery hover scaling lacks a reduced-motion override. | Apply one motion policy to all camera and image interactions. |
| F10 | **Verified / Inferred — Medium** | Gallery selection is an array index; effect depends only on index. Shrinking/reordering asynchronously supplied photos can leave wrong/stale viewer content. Empty photos return no dialog; no remote-image error state exists. | Track stable photo identity, reconcile on data/access changes, and close/fallback predictably. Reproduce updates while the dialog is open. |
| F11 | **Verified — Medium** | `html lang="en"`, English controls, and Spanish content/statuses coexist; dates are raw strings. | Define localization/date formatting and language markup, keeping accessible labels consistent. |
| F12 | **Verified / Requires validation — Medium** | Local status lives in a moving pane; camera fits use symmetric padding unaware of the 400px sidebar or mobile sheet. | Move status to a viewport overlay; use layout-aware camera padding and verify targets remain visible. |
| F13 | **Verified / Inferred — Medium** | Country names are passed as strings to `layer.bindTooltip`; installed Leaflet `src/layer/DivOverlay.js` assigns string content to `innerHTML`. Current names come from checked-in data, not user input. | Use text-only DOM nodes for any future untrusted label; preserve the local-boundary tooltip's `textContent` approach. No current user-input XSS was demonstrated. |
| F14 | **Verified — Medium** | No test command/framework, CI gates, strict TypeScript, runtime domain validator, or error boundary exists in the tracked app. | Add targeted automated checks and release gates around domain adapters, navigation, authorization outcomes and media lifecycle. |
| F15 | **Verified / Requires validation — Medium** | README calls geodata Natural Earth; local loader shows geoBoundaries source/license. No tracked deployment/legal attribution policy demonstrates completeness across sources. | Review data provenance, required attribution visibility, selected-country sources and licenses before release. No legal compliance conclusion is made here. |
| F16 | **Verified — Low** | Root README paths/setup no longer match repository organization; no deployment configuration or Node pin is tracked. | Document frontend working directory, supported runtime and actual hosting/build setup; add reproducible CI later. |

**Verified.** Current React text rendering and `textContent` for local labels are positive boundaries. There is no implemented auth/token storage or application secret-loading mechanism to assess. **Requires validation.** Dependency vulnerability status, repository-history secret exposure, live security headers, image EXIF content, and third-party availability were not audited. No assertion that the repository or dependency tree is free of secrets/vulnerabilities is made; no environment variable values were read or included.

Responsive/mobile analysis:

- **Verified.** `index.css` makes the map `100vw × 100dvh` with overflow hidden. Desktop panel's later active rules use up to 400px width and 24px offsets. At ≤767px it becomes a bottom sheet with up to 75dvh height, safe-area padding, an expand/collapse button and 160px collapsed maximum. This is button-driven, not a drag/swipe sheet.
- **Verified.** Gallery uses two columns with `minmax(0, 1fr)` and 4:3 thumbnails. Viewer uses viewport-limited width/height and smaller padding at ≤600px. Panel content scrolls with `min-height: 0` and `overscroll-behavior: contain`.
- **Verified.** The 65dvh override and mobile legend hiding in `App.css` are inactive. At exactly 768px the desktop panel rules apply. `viewport-fit=cover` is not set in `index.html`, despite safe-area CSS.
- **Requires validation.** Test 360, 768 and 1440px; iPhone Safari and Android Chrome; landscape/short viewports; browser chrome/dynamic viewport changes; touch pan/pinch vs sheet scroll; long names/captions; zoom/large text; focus visibility; dialog focus/Escape/backdrop behavior; safe areas; panel resize after collapse; map status/legend overlap and camera target occlusion. `overflow: hidden` may conceal inaccessible overflow rather than prove a layout fits.
- **Requires validation.** Measure PRD NFR-01's useful map with 100 visits in ≤4 seconds on a documented mobile/4G profile. Five sample records and build size are not evidence of meeting this target. Existing release screenshots are historical assets, not current runtime verification.

## 12. Validation Results

**Verified.** Initial `git status --short` was empty. Active commit and timestamp are recorded at the top. Installed dependencies were already present. Commands below ran without installing anything. No defined test command exists, so no tests were run.

| Command / working directory | Result | Limits |
|---|---|---|
| `pwd`; `git status --short`; `git log -1 --format='%H%n%s%n%ci'` / root | Success; clean baseline and identified commit | Repository snapshot, not deployed revision |
| `git ls-files`; `rg --files --hidden -g '!node_modules' -g '!.git' -g '!dist' -g '!*.webp' -g '!*.png' -g '!*.geojson' -g '!*.svg'` / root | Success; tracked and non-generated text inventory inspected | Asset structure inspected separately; no history-wide security scan |
| `node --version`; `npm --version` / root | `v24.21.0`; `11.19.0` | Current machine only |
| `npm ls --depth=0` / frontend | Exit 0, all direct dependencies resolved | No vulnerability/advisory audit |
| `npm run lint` / frontend | Exit 0, no reported findings | Configured static rules only; not accessibility or runtime correctness |
| `./node_modules/.bin/tsc -p tsconfig.app.json --incremental false --noEmit` / frontend | Exit 0 | Current non-strict app configuration |
| `./node_modules/.bin/tsc -p tsconfig.node.json --incremental false --noEmit` / frontend | Exit 0 | Tooling configuration only |
| Temporary-output Vite build, command below / frontend | Exit 0; 66 modules; 151ms reported bundling time | No production server/browser/network verification |
| Read-only Node scripts, below / root | Five records, two countries, fifteen photos, five distinct record IDs; zero missing image paths | No image visual, EXIF or geographic accuracy verification |

Exact production build command:

```sh
audit_build_dir=$(mktemp -d /private/tmp/travel-map-audit.XXXXXX)
./node_modules/.bin/vite build --configLoader runner --outDir "$audit_build_dir" --emptyOutDir
```

Output directory was `/private/tmp/travel-map-audit.VNCRCY`. Reported bundle sizes: HTML 0.46 kB (gzip 0.29), CSS 23.45 kB (gzip 8.50), JS 388.30 kB (gzip 118.24). These do not include the total cost of public photos or downloaded geometry. Bundler execution time is not first-render/load time.

**Verified.** The literal `npm run build` script was not executed because `tsc -b` writes build-info files under repository `node_modules/.tmp`, and Vite normally writes `frontend/dist` and may bundle its config to a temporary repository location. Instead, its two validation responsibilities were run separately with non-emitting/non-incremental TypeScript and Vite's runner config loader plus output outside the repository. This preserves the only-document-change constraint; it does not validate the default script's build-info/output behavior.

Exact static record/path check:

```sh
node --input-type=module -e 'import fs from "node:fs"; import {trips} from "./frontend/src/features/trips/data/trips.ts"; let missing=0;for(const t of trips)for(const p of t.photos)if(!fs.existsSync("frontend/public/"+p.url))missing++; console.log(JSON.stringify({records:trips.length,countries:new Set(trips.map(t=>t.countryCode)).size,photos:trips.reduce((n,t)=>n+t.photos.length,0),missingPhotoPaths:missing,uniqueTripIds:new Set(trips.map(t=>t.id)).size}));for(const name of ["vite","eslint","typescript"]){const p=JSON.parse(fs.readFileSync("frontend/node_modules/"+name+"/package.json"));console.log(name,JSON.stringify(p.engines))}'
```

Additional read-only inspections compared package ranges/lock/installed versions, parsed country feature count, summed WebP file bytes, traced imports/hooks/fetches with `rg`, and read installed Leaflet tooltip and React Leaflet pane implementations. No command printed credentials or environment variable values.

**Verified.** Final scope checks: `git status --short` showed only `?? docs/FRONTEND_AUDIT.md`; `git diff --exit-code` and `git diff --check` exited 0, confirming no tracked source/configuration/lockfile changes. A read-only Python check confirmed all 14 numbered sections, resolved all local Markdown document links, and found no trailing whitespace. The audit file is new/untracked, so its structure/whitespace was checked separately from `git diff`.

**Requires validation / not executed.** No browser, preview/dev server, live demo, external API/CORS download, mobile/device, screen-reader, end-to-end, performance profile, penetration test, or deployment execution was performed. There were no failures/blockers in the commands actually run. External-service behavior remains unverified rather than blocked by a demonstrated network failure in this audit. No results from earlier conversations are substituted for this audit's validation.

## 13. Recommended Refactoring Priorities

Recommendations are **Inferred** from verified code and PRD requirements. They authorize no implementation in this audit.

1. **P0 — Agree the domain and authorization contracts.** Distinguish project, trip, visit and photo; define stable IDs, date/coordinate semantics, project-wide versus trip-only capabilities and empty-account behavior. Produce a resource/permission matrix and representative response/error examples before choosing implementation technology. This is a Critical private-release gate.
2. **P0 — Specify private media and session lifecycle.** Define authenticated reads, original/derivative access, revocation/expiry, logout/cache disposal, processing states, safe retries and quota attribution. Include PRD deletion/retention/ownership cases. This is a Critical private-release gate.
3. **P1 — Separate page orchestration from Leaflet rendering.** Replace static imports through a typed visit view-model seam, not direct domain fetching in marker components. Derive scoped counts and selection by ID; introduce project/trip navigation and query/loading/error boundaries. Preserve the minimal vector map.
4. **P1 — Establish contract and integration tests.** Cover repeated city visits, no-date/day/range handling and overlap filters, optional exact coordinates, permission-denied/expired sessions, partial upload retries, removed/revoked photos, and server-confirmed mutations. Add a defined test command and CI checks in a later authorized change.
5. **P1 — Fix existing usability/accessibility gaps.** Restore intended active legend styling, consolidate breakpoints, move geographic status out of the pane, implement accessible modal and keyboard alternatives, and make camera framing layout-aware. Validate 360/768/1440px and target devices.
6. **P2 — Harden public geography and measure cost.** Validate source metadata/geometry, define coverage/code policy, attribution, bounded cache/render costs, and graceful degradation. Benchmark NFR-01 before deciding on clustering, lazy data partitioning or other optimizations.
7. **P2 — Improve reproducibility and documentation.** Align root README paths, runtime pinning, type-check command, strictness, CI and verified deployment documentation. Select infrastructure only after contracts and operational requirements are clear.

## 14. Open Architectural Questions

All items below **Require validation** or design. They refine the approved PRD; they do not reopen its Google Sign-In, hierarchy, privacy, format, quota, or collaboration requirements.

1. What is the stable place identity and canonical country-code policy across the country polygons, local boundaries, city search and visit records? How are territories, alternate names and unavailable municipal geometry represented?
2. For a visit without exact coordinates, which approximate city location is displayed, how is approximation communicated, and how is it kept separate from confirmed private GPS data?
3. How will authorized project overview queries, trip-only entry points, filtering and counts be delivered efficiently without exposing unauthorized records? What pagination/aggregation behavior preserves accurate counts and camera bounds?
4. What date-only and interval representation will preserve undated/day/range distinctions and the PRD overlap rules without timezone shifts?
5. Which session transport, credential renewal, logout/revocation, deep-link return and cross-origin deployment arrangements will be adopted? What state must be cleared immediately on access changes?
6. What protected delivery, browser caching and expiry policy applies separately to thumbnails, display images and originals? What revocation guarantees are achievable, including already-downloaded content?
7. How will upload-operation identity, per-file processing status, quota reservation/release and intentional duplicate uploads be communicated to the frontend without accidental retry duplication?
8. How will concurrent edits, permission loss, archive/trash/restore and collaborator removal invalidate currently visible map/panel/viewer state? Is polling sufficient for the beta's processing/collaboration feedback, or is another update mechanism justified?
9. Which original-download and content-management capabilities should be exposed to clients, while still enforcing every decision server-side? How will assisted account deletion/ownership/storage transfer procedures be reflected in user-visible states?
10. What representative devices, 4G profile, geometry coverage and 100-visit fixture will establish the performance and responsive acceptance baseline? Which accessibility checks become automated release gates?
11. What is the actual deployment/build setup after the `frontend/` relocation, including route fallback, security headers, error reporting/redaction, trusted geographic hosts and attribution? No provider or backend stack is selected by this audit.

**Recommended next step — Inferred.** Use this audit and the PRD to write a stack-neutral integration contract and authorization/lifecycle matrix, then validate the existing map/gallery in target browsers. Preserve the viable presentation layer while designing identity, visits and private media as explicit new boundaries.
