# Frontend development

The private map-first React entry supports Google sign-in, server-verified
sessions, Project/Trip creation and history navigation (E3.2). E3.3 adds a compact
Trip Visit list, controlled Place selection, calendar dates and authorized Visit
creation/details/editing. E3.4 adds authorized Project/Trip map projections,
approximate catalog markers, grouped Visit selection and server-backed filters.
The existing React/Leaflet demo and the E3.1 GET-only diagnostic remain separate.
There is no private media integration.

E3.5 adds explicit **Manage members & invitations** in an authorized Project.
The management roster is requested only when opened; Owner/Admin permission is
checked by the server. Owner-only role changes, participant removal, paginated
invitation management and Project/Trip departure require explicit actions and
confirmation. Direct Trip views have no Project administration or participant list.

In Project management, choose a Project Member or loaded Trip Guest invitation
scope, then **New invitation** and **Create single-use invitation**. No email is
sent: the first authenticated holder can redeem the seven-day bearer link. Copy
privately before closing; the one-time link is kept only in the open creation
form. It is cleared on close/session/scope revalidation and cannot be recovered
from listings. The form also provides a separate non-secret app destination link.

Recipients use the existing `/invite#secret` page: its script removes the fragment,
Google login opens a separate tab, then they return to the original invitation tab
and explicitly accept. Do not reload that tab. The existing server page does not
redirect to the granted resource; after acceptance reopen `/app` and select the
Project, or use the separately shared canonical Trip app link. E3.5 does not modify
this backend-owned flow. Full endpoint matrix, limitations and multi-account
acceptance: [E3.5 validation](../docs/E3_5_VALIDATION.md).

Use Node 24.x and npm 11.x, with the existing local backend/Supabase configuration.
From the repository root:

```sh
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run test:build
npm --prefix backend run dev:frontend
```

Stop any existing Worker on port 8789 yourself first. The new command refuses an
occupied port; it never switches to a different authentication origin. It builds
static development assets and starts the existing local HTTPS Worker, with no
Vite network server or HMR:

- `https://127.0.0.1:8789/__local/integration/` — GET-only React diagnostic.
- `https://127.0.0.1:8789/app` — private application/sign-in.
- `/app/projects/{uuid}` and `/app/trips/{uuid}` — refreshable, authorized links.
- `https://127.0.0.1:8789/demo/` — isolated, unchanged travel demo.
- Existing `/api-docs`, `/openapi.json`, `/invite` and OAuth routes still belong to
  the Worker. An existing ignored `/__local/api-test/` installation is preserved.

Rebuild/restart the command after source changes. `npm run dev` in `frontend/`
remains a loopback-only standalone demo server; it is **not** the authenticated
integration origin. Normal `npm run build` produces separate demo `index.html`
and private `app.html`, excluding the local diagnostic. Production hosting is not
configured by this increment. Do not deploy the integration build or attach its
assets to production.

Google login uses the existing backend entry. Its unchanged callback returns to
`/`; the local root document continues to `/app` or a one-use validated Trip/Project
return path. Only that path and its ten-minute expiry use sessionStorage; no user
DTOs, credentials, CSRF or invitation tokens are stored. Storage-disabled browsers
fall back to `/app`; reopen a deep link manually if needed.

The private shell hides/discards content on session checks, confirmed 401,
dependency failures, backgrounding and logout. Network failures are not reported
as successful sign-out. Unsaved forms reset during access revalidation. Trip-only
readers never need a parent Project read. Owner/Admin creation remains enforced
by PostgreSQL; current Project DTOs do not report the viewer's Admin capability.
See [E3.2 validation and manual acceptance](../docs/E3_2_VALIDATION.md).

In an authorized Trip, use **New Visit**, choose a country and an API catalog
result, then optionally enter a name and calendar dates. Creation requires an
explicit submit. Select an existing Visit to inspect/edit it; non-creator Admin
capability is not exposed by the DTO, so the server decides on save. Visit
selection is in-memory within the Trip URL and resets on refresh/scope change.
Only COL/TUR/USA (six catalog Places) are currently available; there is no geocoder,
worldwide-coverage promise, precise GPS, Visit description or deletion UI.
See [E3.3 validation and acceptance steps](../docs/E3_3_VALIDATION.md).

Open a Project or Trip to load its authorized map (up to 100 Visits initially).
Use **Map filters** for country code, optional Project Trip and inclusive date
bounds, then explicitly apply or reset. **Load more map Visits** follows the
opaque cursor; counts and marker groups describe loaded results only. Click a
marker, then choose an individual Visit; the keyboard alternative is **Browse
loaded map Visits**. Project marker selection opens the authorized Trip and live
Visit detail without scanning Visit pages. Missing catalog coordinates appear in
the accessible list without an invented marker. The `/app` landing does not fetch
an all-Projects map. Filters/selection are in memory and reset on access
revalidation or navigation. See [E3.4 validation](../docs/E3_4_VALIDATION.md) for
actual test evidence and outstanding browser acceptance.

The diagnostic displays status and page counts only. Check health and session;
if session is 401, complete the existing Google login flow in another tab and
return. It does not provide login/logout controls or create any records. No
cookie/CSRF copying is needed. See [E3.1 validation](../docs/E3_1_VALIDATION.md) for
evidence, limitations and API usage.

The generated API DTOs come from `backend/openapi.json`. After a reviewed contract
change, run `npm run api:generate`; `npm run api:check` fails on drift. Types remain
separate from `features/trips/types.ts` (static demo) and Leaflet view models.
