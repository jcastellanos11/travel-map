# Frontend development

E3.2 adds a private map-first React entry with Google sign-in, server-verified
sessions, Project/Trip creation and history navigation. The existing React/Leaflet
demo and the E3.1 GET-only diagnostic remain separate. No private Visit markers,
Visit forms or media integration are included.

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

The diagnostic displays status and page counts only. Check health and session;
if session is 401, complete the existing Google login flow in another tab and
return. It does not provide login/logout controls or create any records. No
cookie/CSRF copying is needed. See [E3.1 validation](../docs/E3_1_VALIDATION.md) for
evidence, limitations and API usage.

The generated API DTOs come from `backend/openapi.json`. After a reviewed contract
change, run `npm run api:generate`; `npm run api:check` fails on drift. Types remain
separate from `features/trips/types.ts` (static demo) and Leaflet view models.
