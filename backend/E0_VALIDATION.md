# E0 validation record

Date: 2026-11-01. Repository baseline:
`dba7689f2d09c2f748cac4ae7b9934c9a52350cc`. Initial `git status --short` was
empty. Implementation follows decision #40 and the E0 section of
`docs/IMPLEMENTATION_PLAN.md`; the architecture comparison is closed.

## Actual environment

- macOS Apple Silicon; Node `v24.21.0`, npm `11.19.0`.
- Isolated backend dependencies: Wrangler 4.156.0, TypeScript 6.0.3, ESLint
  10.12.0, typescript-eslint 8.71.1, pg 8.16.3, @types/pg 8.15.5,
  @types/node 24.19.1, @eslint/js 10.0.1. Exact resolution in package-lock.json.
- Wrangler runtime: workerd 1.20261023.1, compatibility date 2026-10-30;
  transitive Miniflare 5.20261023.3-beta.
- Real PostgreSQL `17.11 on aarch64-apple-darwin25.3.0`, clang 21.1.7, 64-bit.
  Existing native binary cache was reused to initialize a **new standalone
  cluster**. No PoC database, credentials, Docker container or Supabase Auth
  service was reused or modified.

## Commands and results

Commands below run from `backend/`, except Git scope checks from repository root.
Wrangler commands were prefixed with `WRANGLER_SEND_METRICS=false` and a
`WRANGLER_LOG_PATH=.local/<operation>.log` to retain ignored local diagnostics.

| Exact command / action | Actual result |
|---|---|
| `npm install --no-fund --no-audit --cache .local/npm-cache` | Exit 0 after specific network/sandbox approval. Local package.json/lockfile created; no global installation. |
| `npm uninstall --save-dev miniflare --no-fund --no-audit --cache .local/npm-cache --offline` | Exit 0; removed unnecessary direct dependency after switching to Wrangler's supported test API. Its transitive simulator remains. |
| `npm ls --depth=0` | Exit 0; eight direct development dependencies resolved. No production npm dependency in E0. |
| `npm run types` | Exit 0 after specific loopback permission; generated worker-configuration.d.ts. |
| `npm run types -- --check` | Exit 0: types are up to date. |
| `npm run lint` | Exit 0; zero warnings. Also passed in final `check`. |
| `npm run typecheck` | Exit 0 for strict Worker and tooling/test configurations. Also passed in final `check`. |
| `npm run build` | Exit 0; local `wrangler deploy --dry-run --env test --outdir dist`. Calculated Worker size 2.67 KiB, gzip 1.09 KiB. No upload/deployment occurred. |
| `npm run check` | Final exit 0: lint + typecheck + build + **10/10 tests**, no skips. Actual local workerd startup/fetch included. |
| `PG_BIN=<existing-native-bin-directory> npm run db:local:test` | Exit 0: **8/8 test nodes** (one parent and seven subtests), no skips, against real PostgreSQL. Disposable server stopped and its directory removed. |
| `npm run dev` | Actual Wrangler local server started on 127.0.0.1:8789. Stopped through Wrangler's `x` exit command; process exited 0. |
| `curl --silent --show-error --include http://127.0.0.1:8789/health` | HTTP 200, `{"status":"ok"}`, private/no-store and security headers. |
| `curl --silent --show-error --include http://127.0.0.1:8789/api/v1/me` | HTTP 401, normalized `SESSION_REQUIRED`, fresh matching request ID, private/no-store. No session/login implemented. |
| `git diff --exit-code -- frontend docs spikes` | Exit 0: those paths unchanged. |
| `git diff --cached --name-only` | Empty: nothing staged. No commit/push performed. |
| `git status --short` | Only `?? backend/`; no existing tracked application/configuration changed. |

The existing binary directory used for the PostgreSQL command was:

```text
/Users/luffy/.supabase/cache/stack/slim-services/postgres/17.11.0.006-r0/darwin-arm64/fb7594525d712ab85b6da00d4d4854f8d0c9ba26b49b781a5fede0119362e917/bin
```

It is an installed executable location, not a credential or dependency path in
backend source/configuration. For another machine supply its own PG_BIN. The
test helper downloads nothing and creates state only beneath backend/.local/.

## Verified test coverage

HTTP/tooling tests cover liveness without infrastructure disclosure; denial of
private API paths with forged cookies, bearer and mock headers; absence of PoC
routes; 405/404/error normalization; internal exception redaction; server-generated
request IDs; known credential-pattern/build isolation; ignored secret-file paths
and absence of those paths in Git's index; disposable-database URL guards; and
deterministic paired migration checksums. Wrangler's test harness runs the built
Worker in actual workerd and checks health, private denial and absent harness.

Seven PostgreSQL scenarios cover:

1. Empty database and two independent concurrent migration clients: exactly one
   applies the initial migration; four domain tables exist.
2. Single owner source, invalid owner/member role, duplicate owner membership,
   protected account references and allowed trip-creation policy values.
3. Unique token digest, no raw session/provider-token columns and coherent expiry.
4. Unprivileged schema access denied; temporarily granting reads still exposes
   zero rows under RLS for every table. Temporary grants are rolled back.
5. Applied migration checksum drift rejected.
6. Failed DDL is rolled back with no partial table or applied-ledger entry.
7. Down removes only foundation; up re-creates an empty application schema.

## Failures, permission boundaries and limitations

- Initial sandbox `npm install` did not complete and was interrupted. An offline
  attempt failed `ENOTCACHED`; network-approved install then succeeded. Cache/log
  writes are now kept under backend/.local for reproducibility.
- npm reported unapproved lifecycle-script notices for platform tooling
  (workerd/esbuild and optional fsevents). No blanket approval or global tool
  installation was made; the installed platform executables successfully built
  and ran the Worker. A different package-manager policy may require explicit
  review of those scripts.
- Initial type generation failed `listen EPERM` in the sandbox. The explicitly
  approved loopback run succeeded. The same runtime permission was requested for
  tests, local PostgreSQL and the development server; no sandbox bypass was used.
- Two early runtime-test attempts failed Miniflare option validation. Miniflare 5
  does not accept the older constructor shape. Replaced direct use with the
  installed Wrangler `createTestHarness` API and removed the direct Miniflare
  dependency. The final runtime test passed.
- Sandbox curl could not reach the separately approved local listener. Repeating
  only the localhost requests with specific permission returned 200 and 401.
- Wrangler dev emitted a possible stale-types warning. The explicit same-env
  `wrangler types --env dev --check` subsequently exited 0 and confirmed current
  generated types; strict checking also passed. Record the warning rather than
  hand-editing generated types or disabling validation.
- `npm run test:db` without local connection configuration is designed to skip;
  the recorded database acceptance result came from `db:local:test`, with **no
  skipped tests**. Docker is not required for this verified path.
- No hosted Supabase schema/Auth/RLS integration, Google OAuth, runtime DB
  adapter, application-session lifecycle, membership/action service, R2/Images,
  dependency advisory audit, browser/device check, cloud latency/cost or
  deployment was performed. Artifact patterns do not establish a repository-
  history-wide secret audit. Those are not claimed as E0 results.

**E0 complete locally. E1 has not started.** No cloud resource, paid resource,
billing activation, frontend change, PoC rerun, commit or push was performed.
